import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/db/connection.js';
import { createSqliteRepository } from '../src/repositories/sqlite.js';
import { apiClient, startApp } from './http-helpers.js';

const ATTEMPTS = 50;

function withTierReadBarrier(repository) {
  let armed = false;
  let arrivals = 0;
  let release;
  let gate = Promise.resolve();

  return Object.freeze({
    ...repository,
    arm() {
      arrivals = 0;
      gate = new Promise((resolve) => {
        release = resolve;
      });
      armed = true;
    },
    disarm() {
      armed = false;
    },
    async getTier(id) {
      const tier = await repository.getTier(id);
      if (!armed) return tier;
      arrivals += 1;
      if (arrivals === ATTEMPTS) release();
      await gate;
      return tier;
    },
  });
}

test('50 simultaneous SQLite booking requests for the last seat produce one booking and 49 SOLD_OUT errors', async () => {
  const database = createDatabase(':memory:');
  const baseRepository = createSqliteRepository(database);
  const repository = withTierReadBarrier(baseRepository);
  let server;

  try {
    server = await startApp({ database, repository });
    const api = apiClient(server.url);
    const startsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const eventResponse = await api.post('/api/events', {
      title: 'Oversell regression', city: 'Lagos', venue: 'Hall', startsAt,
    });
    assert.equal(eventResponse.status, 201);
    const eventId = eventResponse.body.event.id;
    const tierResponse = await api.post(`/api/events/${eventId}/tiers`, {
      name: 'Last seat', priceCents: 500, capacity: 1,
    });
    assert.equal(tierResponse.status, 201);
    const tierId = tierResponse.body.tier.id;
    assert.equal((await api.post(`/api/events/${eventId}/publish`)).status, 200);

    repository.arm();
    const responses = await Promise.all(Array.from({ length: ATTEMPTS }, (_, index) =>
      api.post('/api/bookings', {
        eventId,
        tierId,
        quantity: 1,
        customer: `Attendee ${index + 1}`,
      }, { 'x-user-id': `attendee-${index + 1}` })));
    repository.disarm();

    const succeeded = responses.filter((response) => response.status === 201);
    const soldOut = responses.filter((response) => response.status === 409);
    assert.equal(succeeded.length, 1);
    assert.equal(soldOut.length, 49);
    for (const response of soldOut) assert.equal(response.body.error.code, 'SOLD_OUT');

    const tier = await baseRepository.getTier(tierId);
    assert.equal(tier.sold, 1);
    assert.ok(tier.sold <= tier.capacity);
    assert.equal((await baseRepository.listBookings({ eventId })).length, 1);
  } finally {
    if (server) await server.close();
    else database.close();
  }
});
