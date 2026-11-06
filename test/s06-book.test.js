// S06: As an attendee, I want to book a number of tickets from a tier, so that I get a place.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStore, createEvent, addTier, bookTickets, listBookings, listEvents, publishEvent,
  MAX_TICKETS_PER_BOOKING,
} from '../src/domain/inventory.js';
import { code, inDays, publishedEvent } from './helpers.js';

const seatsLeft = (store) => listEvents(store)[0].tiers[0].seatsLeft;
const book = (ctx, quantity, customer = 'Ada') =>
  bookTickets(ctx.store, { eventId: ctx.event.id, tierId: ctx.tier.id, quantity, customer });

test('S06: with 3 seats left, booking 2 creates a pending booking for 2 seats, priced in whole cents, and 1 seat is left', () => {
  const ctx = publishedEvent({ capacity: 3, priceCents: 500_000 });
  const booking = book(ctx, 2);

  assert.equal(booking.status, 'PENDING');
  assert.equal(booking.quantity, 2);
  assert.equal(booking.totalCents, 1_000_000); // 2 x 500000, an exact integer
  assert.ok(Number.isSafeInteger(booking.totalCents));
  assert.equal(seatsLeft(ctx.store), 1);
  assert.match(booking.reference, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
});

test('S06: with 1 seat left, booking 2 is rejected with SOLD_OUT and nothing changes', () => {
  const ctx = publishedEvent({ capacity: 3 });
  book(ctx, 2); // 1 seat left
  const before = { seats: seatsLeft(ctx.store), bookings: listBookings(ctx.store).length };

  assert.equal(code(() => book(ctx, 2)), 'SOLD_OUT');

  assert.deepEqual({ seats: seatsLeft(ctx.store), bookings: listBookings(ctx.store).length }, before);
});

test('S06: a quantity of 0, a negative, a fraction or more than 10 is rejected with VALIDATION', () => {
  const ctx = publishedEvent({ capacity: 50 });
  for (const quantity of [0, -1, 1.5, 0.1, 11, 100, '2', NaN, Infinity, undefined, null]) {
    assert.equal(code(() => book(ctx, quantity)), 'VALIDATION', `quantity=${String(quantity)}`);
  }
  assert.equal(listBookings(ctx.store).length, 0); // nothing was saved
  assert.equal(seatsLeft(ctx.store), 50);
});

test('S06: the limits themselves are allowed: 1 and 10 tickets', () => {
  const ctx = publishedEvent({ capacity: 50 });
  assert.equal(book(ctx, 1).quantity, 1);
  assert.equal(book(ctx, MAX_TICKETS_PER_BOOKING).quantity, 10);
  assert.equal(seatsLeft(ctx.store), 39);
});

test('S06: the total stays an exact whole number even at the biggest allowed price', () => {
  const store = createStore();
  const event = createEvent(store, { title: 'Pricey', city: 'Lagos', venue: 'V', startsAt: inDays(5) });
  const max = Math.floor(Number.MAX_SAFE_INTEGER / 10);
  const tier = addTier(store, event.id, { name: 'Gold', priceCents: max, capacity: 10 });
  publishEvent(store, event.id);
  const booking = bookTickets(store, { eventId: event.id, tierId: tier.id, quantity: 10, customer: 'Ada' });
  assert.ok(Number.isSafeInteger(booking.totalCents));
  assert.equal(booking.totalCents, max * 10);
});

test('S06: a booking needs a customer name, and a tier that belongs to the event', () => {
  const ctx = publishedEvent();
  assert.equal(code(() => book(ctx, 1, '   ')), 'VALIDATION');
  assert.equal(code(() => bookTickets(ctx.store, { eventId: ctx.event.id, tierId: 'nope', quantity: 1, customer: 'Ada' })), 'NOT_FOUND');
  assert.equal(code(() => bookTickets(ctx.store, { eventId: 'nope', tierId: ctx.tier.id, quantity: 1, customer: 'Ada' })), 'NOT_FOUND');
});

test('S06: two bookings never share a reference code', () => {
  const ctx = publishedEvent({ capacity: 300 });
  const refs = new Set();
  for (let i = 0; i < 300; i++) refs.add(book(ctx, 1).reference);
  assert.equal(refs.size, 300);
});
