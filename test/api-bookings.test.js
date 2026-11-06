// api-bookings.test.js: the booking routes, over real HTTP.
//   POST /api/bookings                      book tickets (S06)
//   GET  /api/bookings/:reference           find a booking by its code
//   POST /api/bookings/:reference/cancel    cancel it, give the seats back

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { listBookings } from '../src/domain/inventory.js';
import { apiClient, expectError, startApp } from './http-helpers.js';

const startsInDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

describe('the booking API', () => {
  let server;
  let api;
  before(async () => {
    server = await startApp();
    api = apiClient(server.url);
  });
  after(() => server.close());

  // A published event with one tier. Returns the ids, and helpers.
  async function setup({ capacity = 3, priceCents = 500_000, publish = true, title = 'Booking Test' } = {}) {
    const event = (await api.post('/api/events', { title, city: 'Lagos', venue: 'Hall', startsAt: startsInDays(30) })).body.event;
    const tier = (await api.post(`/api/events/${event.id}/tiers`, { name: 'General', priceCents, capacity })).body.tier;
    if (publish) await api.post(`/api/events/${event.id}/publish`);
    const book = (quantity, customer = 'Ada', extra = {}) => api.post('/api/bookings', { eventId: event.id, tierId: tier.id, quantity, customer, ...extra });
    const seatsLeft = async () => (await api.get(`/api/events/${event.id}`)).body.event.tiers[0].seatsLeft;
    return { event, tier, book, seatsLeft };
  }

  describe('POST /api/bookings (S06: book tickets)', () => {
    test('201 Created: a PENDING booking for 2 seats, priced in whole cents, with a Location header; 1 seat is left', async () => {
      const { book, seatsLeft } = await setup({ capacity: 3 });
      const res = await book(2);
      assert.equal(res.status, 201);
      assert.deepEqual(Object.keys(res.body), ['booking']);
      const { booking } = res.body;
      assert.equal(booking.status, 'pending');
      assert.equal(booking.quantity, 2);
      assert.equal(booking.totalCents, 1_000_000);
      assert.ok(Number.isSafeInteger(booking.totalCents));
      assert.equal(booking.customer, 'Ada');
      assert.match(booking.reference, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      assert.equal(res.headers.get('location'), `/api/bookings/${booking.reference}`);
      assert.deepEqual(booking.history.map((h) => h.status), ['pending']);
      assert.equal(await seatsLeft(), 1);
    });

    test('the Location header leads to the booking', async () => {
      const { book } = await setup();
      const res = await book(1);
      const found = await api.get(res.headers.get('location'));
      assert.equal(found.status, 200);
      assert.equal(found.body.booking.id, res.body.booking.id);
    });

    test('with 1 seat left, booking 2 -> 409 SOLD_OUT, and nothing changes', async () => {
      const { event, book, seatsLeft } = await setup({ capacity: 3 });
      await book(2);
      const count = listBookings(server.store, { eventId: event.id }).length;
      const res = await book(2);
      expectError(res, 409, 'SOLD_OUT');
      assert.match(res.body.error.message, /Only 1 left/);
      assert.equal(await seatsLeft(), 1);
      assert.equal(listBookings(server.store, { eventId: event.id }).length, count);
    });

    test('a quantity of 0, a negative, a fraction, more than 10, or text -> 400 VALIDATION, and nothing is saved', async () => {
      const { event, book, seatsLeft } = await setup({ capacity: 50 });
      for (const quantity of [0, -1, 1.5, 11, 100, '2', null, undefined, true, [1]]) {
        const res = await book(quantity);
        expectError(res, 400, 'VALIDATION');
        assert.match(res.body.error.message, /quantity/);
      }
      assert.equal(await seatsLeft(), 50);
      assert.equal(listBookings(server.store, { eventId: event.id }).length, 0);
    });

    test('1 and 10 tickets are allowed', async () => {
      const { book } = await setup({ capacity: 50 });
      assert.equal((await book(1)).status, 201);
      assert.equal((await book(10)).status, 201);
    });

    test('a missing or blank customer, eventId or tierId -> 400 VALIDATION', async () => {
      const { event, tier } = await setup();
      const good = { eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Ada' };
      for (const field of ['eventId', 'tierId', 'customer']) {
        for (const value of [undefined, '', '  ', null, 7]) {
          const body = { ...good, [field]: value };
          if (value === undefined) delete body[field];
          expectError(await api.post('/api/bookings', body), 400, 'VALIDATION');
        }
      }
    });

    test('a body that is not an object, or no body -> 400, never a 500', async () => {
      for (const junk of [null, [], 5, 'text', true]) expectError(await api.post('/api/bookings', junk), 400, 'VALIDATION');
      expectError(await api.call('POST', '/api/bookings'), 400, 'VALIDATION');
    });

    test('an event or a tier that does not exist -> 404 NOT_FOUND; a tier of ANOTHER event too', async () => {
      const a = await setup({ title: 'A' });
      const b = await setup({ title: 'B' });
      expectError(await api.post('/api/bookings', { eventId: 'nope', tierId: a.tier.id, quantity: 1, customer: 'Ada' }), 404, 'NOT_FOUND');
      expectError(await api.post('/api/bookings', { eventId: a.event.id, tierId: 'nope', quantity: 1, customer: 'Ada' }), 404, 'NOT_FOUND');
      expectError(await api.post('/api/bookings', { eventId: a.event.id, tierId: b.tier.id, quantity: 1, customer: 'Ada' }), 404, 'NOT_FOUND');
    });

    test('the fields a client may NOT set (status, totalCents, reference, history...) are ignored', async () => {
      const { book } = await setup({ capacity: 5, priceCents: 500_000 });
      const res = await book(2, 'Ada', { status: 'paid', totalCents: 1, reference: 'AAAA-AAAA', id: 'hacked', history: [], createdAt: '1999-01-01', priceCents: 1 });
      assert.equal(res.status, 201);
      const { booking } = res.body;
      assert.equal(booking.status, 'pending');
      assert.equal(booking.totalCents, 1_000_000);
      assert.notEqual(booking.reference, 'AAAA-AAAA');
      assert.notEqual(booking.id, 'hacked');
      assert.equal(booking.history.length, 1);
      assert.notEqual(booking.createdAt, '1999-01-01');
    });

    test('a DRAFT event cannot be booked: 409 INVALID_STATE', async () => {
      const { book } = await setup({ publish: false });
      expectError(await book(1), 409, 'INVALID_STATE');
    });

    test('unpublishing stops NEW bookings but keeps the old ones', async () => {
      const { event, book } = await setup();
      const first = (await book(1)).body.booking;
      await api.post(`/api/events/${event.id}/unpublish`);
      expectError(await book(1, 'Bola'), 409, 'INVALID_STATE');
      assert.equal((await api.get(`/api/bookings/${first.reference}`)).status, 200);
    });

    test('broken JSON -> 400 BAD_JSON; not sent as JSON -> 415', async () => {
      expectError(await api.postRaw('/api/bookings', '{"quantity": 2,'), 400, 'BAD_JSON');
      expectError(await api.postRaw('/api/bookings', '{"quantity": 2}', { 'Content-Type': 'text/plain' }), 415, 'UNSUPPORTED_MEDIA_TYPE');
    });

    test('an event that has already started -> 409 EVENT_STARTED', async () => {
      let now = Date.now();
      const clocked = await startApp({ now: () => now });
      try {
        const c = apiClient(clocked.url);
        const event = (await c.post('/api/events', { title: 'Soon', city: 'Lagos', venue: 'V', startsAt: new Date(now + 3_600_000).toISOString() })).body.event;
        const tier = (await c.post(`/api/events/${event.id}/tiers`, { name: 'GA', priceCents: 100, capacity: 5 })).body.tier;
        await c.post(`/api/events/${event.id}/publish`);
        const body = { eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Ada' };
        assert.equal((await c.post('/api/bookings', body)).status, 201); // an hour before the start
        now += 2 * 3_600_000; // two hours later: the event has begun
        expectError(await c.post('/api/bookings', body), 409, 'EVENT_STARTED');
      } finally {
        await clocked.close();
      }
    });

    test('PUT and DELETE on this URL are 405 (Allow: POST)', async () => {
      const res = await api.call('DELETE', '/api/bookings', {});
      expectError(res, 405, 'METHOD_NOT_ALLOWED');
      assert.equal(res.headers.get('allow'), 'POST');
    });
  });

  describe('NO OVERSELLING, even when many requests arrive at the same moment', () => {
    test('20 parallel bookings for 5 seats: exactly 5 succeed, 15 get SOLD_OUT, 0 seats are left', async () => {
      const { event, tier, seatsLeft } = await setup({ capacity: 5, title: 'Stampede' });
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => api.post('/api/bookings', { eventId: event.id, tierId: tier.id, quantity: 1, customer: `Person ${i}` })),
      );
      const succeeded = results.filter((r) => r.status === 201);
      const refused = results.filter((r) => r.status === 409);
      assert.equal(succeeded.length, 5);
      assert.equal(refused.length, 15);
      for (const r of refused) assert.equal(r.body.error.code, 'SOLD_OUT');
      assert.equal(new Set(succeeded.map((r) => r.body.booking.reference)).size, 5); // five different codes
      assert.equal(await seatsLeft(), 0);
      assert.equal(listBookings(server.store, { eventId: event.id }).length, 5);
    });

    test('parallel bookings of different sizes never take more seats than exist', async () => {
      const { event, tier, seatsLeft } = await setup({ capacity: 10, title: 'Mixed stampede' });
      const results = await Promise.all([3, 4, 5, 2, 6, 1, 3, 4].map((quantity, i) =>
        api.post('/api/bookings', { eventId: event.id, tierId: tier.id, quantity, customer: `P${i}` })));
      const taken = results.filter((r) => r.status === 201).reduce((sum, r) => sum + r.body.booking.quantity, 0);
      assert.ok(taken <= 10);
      assert.equal(await seatsLeft(), 10 - taken);
      for (const r of results.filter((x) => x.status !== 201)) assert.equal(r.body.error.code, 'SOLD_OUT');
    });
  });

  describe('GET /api/bookings/:reference', () => {
    test('returns the booking; capitals and the hyphen do not matter', async () => {
      const { book } = await setup();
      const { booking } = (await book(1)).body;
      for (const form of [booking.reference, booking.reference.toLowerCase(), booking.reference.replace('-', ''), booking.reference.replace('-', '%20')]) {
        const res = await api.get(`/api/bookings/${form}`);
        assert.equal(res.status, 200, form);
        assert.equal(res.body.booking.id, booking.id);
      }
    });

    test('an unknown reference -> 404 NOT_FOUND', async () => {
      expectError(await api.get('/api/bookings/ZZZZ-ZZZZ'), 404, 'NOT_FOUND');
      expectError(await api.get('/api/bookings/nope'), 404, 'NOT_FOUND');
      expectError(await api.get(`/api/bookings/${'A'.repeat(3000)}`), 404, 'NOT_FOUND');
    });

    test('O, I and L typed for 0 and 1 still find the booking (the codes are read aloud)', async () => {
      const { book } = await setup({ capacity: 300 });
      let booking;
      do { booking = (await book(1)).body.booking; } while (!/[01]/.test(booking.reference));
      const misread = booking.reference.replace(/0/g, 'O').replace(/1/g, 'I');
      assert.equal((await api.get(`/api/bookings/${misread}`)).body.booking.id, booking.id);
    });

    test('POST on this URL is 405', async () => {
      expectError(await api.post('/api/bookings/ABCD-EFGH', {}), 405, 'METHOD_NOT_ALLOWED');
    });
  });

  describe('POST /api/bookings/:reference/cancel', () => {
    test('200: the booking is cancelled and its seats come back', async () => {
      const { book, seatsLeft } = await setup({ capacity: 3 });
      const { booking } = (await book(2)).body;
      assert.equal(await seatsLeft(), 1);
      const res = await api.post(`/api/bookings/${booking.reference}/cancel`);
      assert.equal(res.status, 200);
      assert.equal(res.body.booking.status, 'cancelled');
      assert.deepEqual(res.body.booking.history.map((h) => h.status), ['pending', 'cancelled']);
      assert.equal(res.body.seatsLeft, 3);
      assert.equal(await seatsLeft(), 3);
      assert.equal((await api.get(`/api/bookings/${booking.reference}`)).body.booking.status, 'cancelled'); // the record is kept
    });

    test('the answer does not reveal who is waiting (another customer\'s name is private)', async () => {
      const { book } = await setup({ capacity: 1 });
      const { booking } = (await book(1)).body;
      const res = await api.post(`/api/bookings/${booking.reference}/cancel`);
      assert.deepEqual(Object.keys(res.body).sort(), ['booking', 'seatsLeft']);
    });

    test('cancelling twice -> 409 ALREADY_CANCELLED, and the seats are NOT given back twice', async () => {
      const { book, seatsLeft } = await setup({ capacity: 3 });
      const { booking } = (await book(2)).body;
      await api.post(`/api/bookings/${booking.reference}/cancel`);
      expectError(await api.post(`/api/bookings/${booking.reference}/cancel`), 409, 'ALREADY_CANCELLED');
      assert.equal(await seatsLeft(), 3);
    });

    test('an unknown reference -> 404', async () => {
      expectError(await api.post('/api/bookings/ZZZZ-ZZZZ/cancel'), 404, 'NOT_FOUND');
    });

    test('freed seats can be booked by someone else', async () => {
      const { book } = await setup({ capacity: 2 });
      const first = (await book(2)).body.booking;
      expectError(await book(1, 'Bola'), 409, 'SOLD_OUT');
      await api.post(`/api/bookings/${first.reference}/cancel`);
      assert.equal((await book(2, 'Bola')).status, 201);
    });

    test('GET on this URL is 405 (Allow: POST)', async () => {
      const res = await api.get('/api/bookings/ABCD-EFGH/cancel');
      expectError(res, 405, 'METHOD_NOT_ALLOWED');
      assert.equal(res.headers.get('allow'), 'POST');
    });
  });
});
