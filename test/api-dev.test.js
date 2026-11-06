// api-dev.test.js: the PRACTICE-ONLY route that moves a booking along its life cycle:
//   POST /api/dev/bookings/:reference/transition   { "to": "paid" }
// It exists only in demo mode. Over HTTP it lets us (and Postman) see the state machine refuse illegal moves.

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BOOKING_STATES, BookingState, canTransition } from '../src/domain/bookingStateMachine.js';
import { apiClient, expectError, startApp } from './http-helpers.js';

const startsInDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

describe('without demo mode, the practice route does not exist', () => {
  let server;
  let api;
  before(async () => { server = await startApp(); api = apiClient(server.url); });
  after(() => server.close());

  test('it is an unknown /api path: 404 NOT_FOUND (not 405, not 200)', async () => {
    expectError(await api.post('/api/dev/bookings/ABCD-EFGH/transition', { to: 'paid' }), 404, 'NOT_FOUND');
    expectError(await api.get('/api/dev/bookings/ABCD-EFGH/transition'), 404, 'NOT_FOUND');
  });

  test('a real booking cannot be paid through it', async () => {
    const event = (await api.post('/api/events', { title: 'E', city: 'Lagos', venue: 'V', startsAt: startsInDays(5) })).body.event;
    const tier = (await api.post(`/api/events/${event.id}/tiers`, { name: 'GA', priceCents: 100, capacity: 5 })).body.tier;
    await api.post(`/api/events/${event.id}/publish`);
    const { booking } = (await api.post('/api/bookings', { eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Ada' })).body;
    expectError(await api.post(`/api/dev/bookings/${booking.reference}/transition`, { to: 'paid' }), 404, 'NOT_FOUND');
    assert.equal((await api.get(`/api/bookings/${booking.reference}`)).body.booking.status, 'pending');
  });
});

describe('in demo mode', () => {
  let server;
  let api;
  before(async () => { server = await startApp({ devRoutes: true }); api = apiClient(server.url); });
  after(() => server.close());

  async function newBooking(quantity = 2, capacity = 5) {
    const event = (await api.post('/api/events', { title: `Life cycle ${Math.random()}`, city: 'Lagos', venue: 'V', startsAt: startsInDays(10) })).body.event;
    const tier = (await api.post(`/api/events/${event.id}/tiers`, { name: 'GA', priceCents: 100, capacity })).body.tier;
    await api.post(`/api/events/${event.id}/publish`);
    const { booking } = (await api.post('/api/bookings', { eventId: event.id, tierId: tier.id, quantity, customer: 'Ada' })).body;
    const move = (to) => api.post(`/api/dev/bookings/${booking.reference}/transition`, { to });
    const status = async () => (await api.get(`/api/bookings/${booking.reference}`)).body.booking.status;
    const seatsLeft = async () => (await api.get(`/api/events/${event.id}`)).body.event.tiers[0].seatsLeft;
    return { event, tier, booking, move, status, seatsLeft };
  }

  // The legal route from pending to each state, so a test can start a booking in any state.
  const ROUTE = {
    [BookingState.PENDING]: [],
    [BookingState.PAID]: ['paid'],
    [BookingState.CANCELLED]: ['cancelled'],
    [BookingState.REFUNDED]: ['paid', 'refunded'],
    [BookingState.CHECKED_IN]: ['paid', 'checked_in'],
  };

  test('the happy path: pending -> paid -> checked_in, with the history recorded', async () => {
    const b = await newBooking();
    const paid = await b.move('paid');
    assert.equal(paid.status, 200);
    assert.equal(paid.body.booking.status, 'paid');
    const checkedIn = await b.move('checked_in');
    assert.equal(checkedIn.status, 200);
    assert.deepEqual(checkedIn.body.booking.history.map((h) => h.status), ['pending', 'paid', 'checked_in']);
    assert.equal(await b.seatsLeft(), 3); // a checked-in booking still holds its seats
  });

  test('PAYING A CANCELLED BOOKING is refused: 409 INVALID_TRANSITION, and nothing changes', async () => {
    const b = await newBooking();
    await api.post(`/api/bookings/${b.booking.reference}/cancel`);
    const seatsBefore = await b.seatsLeft();
    const res = await b.move('paid');
    expectError(res, 409, 'INVALID_TRANSITION');
    assert.match(res.body.error.message, /cancelled booking cannot become paid/);
    assert.equal(await b.status(), 'cancelled');
    assert.equal(await b.seatsLeft(), seatsBefore);
  });

  test('a refund gives the seats back; cancelling a paid booking does too', async () => {
    const a = await newBooking(2, 5);
    await a.move('paid');
    assert.equal(await a.seatsLeft(), 3);
    await a.move('refunded');
    assert.equal(await a.seatsLeft(), 5);

    const c = await newBooking(2, 5);
    await c.move('paid');
    const cancelled = await api.post(`/api/bookings/${c.booking.reference}/cancel`);
    assert.equal(cancelled.status, 200);
    assert.equal(await c.seatsLeft(), 5);
  });

  test('a booking that was checked in cannot be cancelled: 409 INVALID_TRANSITION (not ALREADY_CANCELLED)', async () => {
    const b = await newBooking();
    await b.move('paid');
    await b.move('checked_in');
    expectError(await api.post(`/api/bookings/${b.booking.reference}/cancel`), 409, 'INVALID_TRANSITION');
    assert.equal(await b.status(), 'checked_in');
  });

  // Every one of the 25 (from, to) pairs, over HTTP: 5 must work, 20 must be refused with 409 and change nothing.
  for (const from of BOOKING_STATES) {
    for (const to of BOOKING_STATES) {
      const allowed = canTransition(from, to);
      test(`over HTTP: ${from} -> ${to} is ${allowed ? 'allowed (200)' : 'refused (409 INVALID_TRANSITION)'}`, async () => {
        const b = await newBooking();
        for (const step of ROUTE[from]) assert.equal((await b.move(step)).status, 200);
        const seatsBefore = await b.seatsLeft();

        const res = await b.move(to);

        if (allowed) {
          assert.equal(res.status, 200);
          assert.equal(res.body.booking.status, to);
        } else {
          expectError(res, 409, 'INVALID_TRANSITION');
          assert.equal(await b.status(), from);
          assert.equal(await b.seatsLeft(), seatsBefore);
        }
      });
    }
  }

  test('a missing or non-text "to" -> 400 VALIDATION; a state that does not exist -> 409 INVALID_TRANSITION', async () => {
    const b = await newBooking();
    for (const body of [{}, { to: null }, { to: 5 }, { to: '' }, { to: ['paid'] }, null, [], 'paid']) {
      expectError(await api.post(`/api/dev/bookings/${b.booking.reference}/transition`, body), 400, 'VALIDATION');
    }
    expectError(await api.call('POST', `/api/dev/bookings/${b.booking.reference}/transition`), 400, 'VALIDATION');
    for (const to of ['teleported', 'PAID', 'Paid', 'toString', '__proto__']) expectError(await b.move(to), 409, 'INVALID_TRANSITION');
    assert.equal(await b.status(), 'pending');
  });

  test('an unknown reference -> 404; GET on this URL is 405', async () => {
    expectError(await api.post('/api/dev/bookings/ZZZZ-ZZZZ/transition', { to: 'paid' }), 404, 'NOT_FOUND');
    const res = await api.get('/api/dev/bookings/ZZZZ-ZZZZ/transition');
    expectError(res, 405, 'METHOD_NOT_ALLOWED');
    assert.equal(res.headers.get('allow'), 'POST');
  });
});
