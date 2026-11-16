// services.test.js: the service layer (no HTTP anywhere in these tests).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockPaymentGateway } from '../src/lib/mockPaymentGateway.js';
import { createMemoryRepository } from '../src/repositories/memory.js';
import { createServices } from '../src/services/index.js';
import { queryToCriteria } from '../src/services/eventService.js';
import { seedDemoData } from '../src/services/demoData.js';

const future = () => new Date(Date.now() + 10 * 86_400_000).toISOString();
const fixture = (options = {}) => {
  const repository = createMemoryRepository();
  const services = createServices({
    repository,
    paymentGateway: createMockPaymentGateway(),
    ...options,
  });
  return { repository, services };
};

test('health.check() answers { status: "ok" }', () => {
  const { services } = fixture();
  assert.deepEqual(services.health.check(), { status: 'ok' });
});

test('the services object and each service are frozen', () => {
  const { services } = fixture();
  assert.throws(() => { services.health = null; }, TypeError);
  assert.throws(() => { services.health.check = () => 'hacked'; }, TypeError);
});

test('services require injected persistence and payment dependencies', () => {
  assert.throws(() => createServices(), /repository/);
  assert.throws(() => createServices({ repository: createMemoryRepository() }), /payment gateway/);
});

test('queryToCriteria: URL text becomes numbers and booleans, and unknown options are refused', () => {
  assert.deepEqual(queryToCriteria({ maxPriceCents: '500000', onlyAvailable: 'true', city: 'Lagos', sort: 'price' }), {
    criteria: { q: undefined, city: 'Lagos', from: undefined, to: undefined, maxPriceCents: 500000, onlyAvailable: true },
    sort: 'price',
  });
  assert.equal(queryToCriteria({ onlyAvailable: 'false' }).criteria.onlyAvailable, false);
  assert.deepEqual(queryToCriteria({ q: '', city: '', sort: '', maxPriceCents: '' }).criteria.q, undefined);
  assert.equal(queryToCriteria().sort, 'date');
  assert.equal(queryToCriteria({ maxPriceCents: '9.99' }).criteria.maxPriceCents, '9.99');
  assert.throws(() => queryToCriteria({ cityy: 'Lagos' }), { code: 'VALIDATION' });
});

test('the event service creates, publishes, searches and details events through the repository', async () => {
  const { services } = fixture();
  const { events } = services;
  const event = await events.create({ title: 'Jazz', city: 'Abuja', venue: 'Park', startsAt: future() });
  assert.equal(event.status, 'draft');
  assert.deepEqual(await events.search({}), { count: 0, events: [] });
  await assert.rejects(events.publish(event.id), { code: 'INVALID_STATE' });
  const tier = await events.addTier(event.id, { name: 'GA', priceCents: 1000, capacity: 5 });
  assert.equal(tier.seatsLeft, 5);
  assert.equal((await events.publish(event.id)).status, 'published');
  assert.equal((await events.search({ q: 'jazz' })).count, 1);
  assert.equal((await events.get(event.id)).tiers[0].seatsLeft, 5);
  await assert.rejects(events.get('nope'), { code: 'NOT_FOUND' });
  await assert.rejects(events.search({ sort: 'popularity' }), { code: 'VALIDATION' });
});

test('the booking service books, pays, finds, cancels and refuses invalid state changes', async () => {
  const { services } = fixture();
  const { events, bookings } = services;
  const event = await events.create({ title: 'Jazz', city: 'Abuja', venue: 'Park', startsAt: future() });
  const tier = await events.addTier(event.id, { name: 'GA', priceCents: 1000, capacity: 3 });
  await events.publish(event.id);

  const booking = await bookings.book(
    { eventId: event.id, tierId: tier.id, quantity: 2, customer: 'Ada' },
    'user-1',
  );
  assert.equal(booking.status, 'pending');
  assert.equal((await bookings.get(booking.reference.toLowerCase(), 'user-1')).id, booking.id);
  assert.equal((await bookings.pay(booking.reference, 'user-1', {})).status, 'paid');
  await assert.rejects(bookings.pay(booking.reference, 'user-1', {}), { code: 'INVALID_TRANSITION' });
  await assert.rejects(bookings.cancel(booking.reference, 'user-1'), { code: 'INVALID_TRANSITION' });
});

test('demo data seeds four published events and one draft through the event service', async () => {
  const { services } = fixture();
  const seeded = await seedDemoData(services.events);
  assert.equal(seeded.length, 5);
  assert.equal((await services.events.search({})).count, 4);
  assert.equal((await services.events.search({ q: 'Ibadan' })).count, 0);
  assert.ok((await services.events.search({})).events.every((event) => Date.parse(event.startsAt) > Date.now()));
});
