import test from 'node:test';
import assert from 'node:assert/strict';
import { apiClient, expectError, startApp } from './http-helpers.js';

async function setup(t, capacity = 1) {
  const server = await startApp();
  t.after(() => server.close());
  const api = apiClient(server.url);
  const event = (await api.post('/api/events', {
    title: 'Waitlist API',
    city: 'Lagos',
    venue: 'Test Hall',
    startsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  })).body.event;
  const tier = (await api.post(`/api/events/${event.id}/tiers`, {
    name: 'General',
    priceCents: 500,
    capacity,
  })).body.tier;
  await api.post(`/api/events/${event.id}/publish`);
  return { api, event, tier };
}

const waitlistPath = (eventId, tierId) => `/api/events/${eventId}/tiers/${tierId}/waitlist`;

test('waitlist routes keep FIFO order, reject duplicate names and stop direct booking from jumping the queue', async (t) => {
  const { api, event, tier } = await setup(t);
  const booked = await api.post('/api/bookings', {
    eventId: event.id,
    tierId: tier.id,
    quantity: 1,
    customer: 'Ada',
  }, { 'x-user-id': 'buyer' });
  assert.equal(booked.status, 201);

  const first = await api.post(waitlistPath(event.id, tier.id), {
    customer: 'Chidi',
    quantity: 1,
  }, { 'x-user-id': 'chidi-id' });
  assert.equal(first.status, 201);
  assert.equal(first.body.position, 1);

  const duplicate = await api.post(waitlistPath(event.id, tier.id), {
    customer: ' chidi   ',
    quantity: 1,
  }, { 'x-user-id': 'another-id' });
  expectError(duplicate, 409, 'ALREADY_WAITING');

  const second = await api.post(waitlistPath(event.id, tier.id), {
    customer: 'Dayo',
    quantity: 2,
  }, { 'x-user-id': 'dayo-id' });
  assert.equal(second.body.position, 2);

  const list = await api.get(`/api/events/${event.id}/waitlists`);
  assert.deepEqual(list.body.waitlists[0].entries.map(({ customer, position, isMine }) => ({
    customer, position, isMine,
  })), [
    { customer: 'Chidi', position: 1, isMine: false },
    { customer: 'Dayo', position: 2, isMine: false },
  ]);
  expectError(await api.get(`/api/events/${event.id}/waitlists`, { 'x-user-id': 'other-organizer' }), 403, 'FORBIDDEN');
  assert.equal((await api.get(`/api/events/${event.id}`)).body.event.tiers[0].waitlistSize, 2);

  const jump = await api.post('/api/bookings', {
    eventId: event.id,
    tierId: tier.id,
    quantity: 1,
    customer: 'Stranger',
  }, { 'x-user-id': 'stranger' });
  expectError(jump, 409, 'WAITLIST_FIRST');
});

test('only the entry owner can leave, and leaving reports the next person', async (t) => {
  const { api, event, tier } = await setup(t);
  await api.post('/api/bookings', {
    eventId: event.id,
    tierId: tier.id,
    quantity: 1,
    customer: 'Ada',
  }, { 'x-user-id': 'buyer' });
  const first = await api.post(waitlistPath(event.id, tier.id), {
    customer: 'Chidi',
    quantity: 1,
  }, { 'x-user-id': 'chidi-id' });
  await api.post(waitlistPath(event.id, tier.id), {
    customer: 'Dayo',
    quantity: 1,
  }, { 'x-user-id': 'dayo-id' });

  const path = `${waitlistPath(event.id, tier.id)}/${first.body.entry.id}`;
  expectError(await api.call('DELETE', path, undefined, { 'x-user-id': 'someone-else' }), 404, 'NOT_FOUND');
  const left = await api.call('DELETE', path, undefined, { 'x-user-id': 'chidi-id' });
  assert.equal(left.status, 200);
  assert.equal(left.body.removed.customer, 'Chidi');
  assert.equal(left.body.nextInLine.customer, 'Dayo');
});

test('booking the next person is strict FIFO and removes the entry only after a successful reservation', async (t) => {
  const { api, event, tier } = await setup(t, 3);
  const original = await api.post('/api/bookings', {
    eventId: event.id,
    tierId: tier.id,
    quantity: 2,
    customer: 'Ada',
  }, { 'x-user-id': 'buyer' });
  const first = await api.post(waitlistPath(event.id, tier.id), {
    customer: 'Chidi',
    quantity: 2,
  }, { 'x-user-id': 'chidi-id' });
  await api.post(waitlistPath(event.id, tier.id), {
    customer: 'Dayo',
    quantity: 1,
  }, { 'x-user-id': 'dayo-id' });

  const promote = `/api/events/${event.id}/tiers/${tier.id}/waitlist/next/book`;
  expectError(await api.post(promote, undefined, { 'x-user-id': 'chidi-id' }), 409, 'SOLD_OUT');
  expectError(await api.post(promote, undefined, { 'x-user-id': 'someone-else' }), 404, 'NOT_FOUND');
  assert.deepEqual((await api.get(`/api/events/${event.id}/waitlists`)).body.waitlists[0].entries.map((entry) => entry.customer), [
    'Chidi',
    'Dayo',
  ]);

  await api.post(`/api/bookings/${original.body.booking.reference}/cancel`, undefined, { 'x-user-id': 'buyer' });
  const bookedNext = await api.post(promote, undefined, { 'x-user-id': 'chidi-id' });
  assert.equal(bookedNext.status, 200);
  assert.equal(bookedNext.body.booking.customer, 'Chidi');
  assert.equal(bookedNext.body.booking.userId, undefined);
  assert.deepEqual((await api.get(`/api/events/${event.id}/waitlists`)).body.waitlists[0].entries.map((entry) => entry.customer), ['Dayo']);
  assert.equal((await api.get(`/api/events/${event.id}`)).body.event.tiers[0].sold, 2);
});

test('a waitlist cannot be joined when seats are immediately available', async (t) => {
  const { api, event, tier } = await setup(t, 2);
  expectError(await api.post(waitlistPath(event.id, tier.id), {
    customer: 'Chidi',
    quantity: 1,
  }), 409, 'SEATS_AVAILABLE');
});
