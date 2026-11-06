// error-codes.test.js: every error code the domain can throw, each triggered for real.
// If someone adds a new code to errors.js and forgets a test, the last test here fails.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError, ErrorCode } from '../src/domain/errors.js';
import {
  createStore, createEvent, addTier, publishEvent, bookTickets, cancelBooking, findBookingByReference,
  joinWaitlist, transitionBooking,
} from '../src/domain/inventory.js';
import { code, inDays, publishedEvent } from './helpers.js';

// Each entry makes a fresh situation and returns a function that should throw that code.
const TRIGGERS = {
  VALIDATION: () => () => createEvent(createStore(), {}),
  NOT_FOUND: () => () => findBookingByReference(createStore(), 'ZZZZ-ZZZZ'),
  SOLD_OUT: () => {
    const { store, event, tier } = publishedEvent({ capacity: 1 });
    return () => bookTickets(store, { eventId: event.id, tierId: tier.id, quantity: 2, customer: 'Ada' });
  },
  ALREADY_CANCELLED: () => {
    const { store, event, tier } = publishedEvent();
    const b = bookTickets(store, { eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Ada' });
    cancelBooking(store, b.reference);
    return () => cancelBooking(store, b.reference);
  },
  SEATS_AVAILABLE: () => {
    const { store, event, tier } = publishedEvent();
    return () => joinWaitlist(store, { eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Ada' });
  },
  WAITLIST_FIRST: () => {
    const { store, event, tier } = publishedEvent({ capacity: 1 });
    const b = bookTickets(store, { eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Ada' });
    joinWaitlist(store, { eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Waiting' });
    cancelBooking(store, b.reference); // a seat is free, but Waiting is ahead
    return () => bookTickets(store, { eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Stranger' });
  },
  ALREADY_WAITING: () => {
    const { store, event, tier } = publishedEvent({ capacity: 1 });
    bookTickets(store, { eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Ada' });
    joinWaitlist(store, { eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Bola' });
    return () => joinWaitlist(store, { eventId: event.id, tierId: tier.id, quantity: 1, customer: 'bola' });
  },
  EVENT_STARTED: () => {
    let now = Date.parse('2026-01-01T00:00:00Z');
    const store = createStore({ now: () => now });
    const event = createEvent(store, { title: 'E', city: 'Lagos', venue: 'V', startsAt: '2026-01-02T00:00:00Z' });
    const tier = addTier(store, event.id, { name: 'GA', priceCents: 100, capacity: 5 });
    publishEvent(store, event.id);
    now = Date.parse('2026-01-03T00:00:00Z'); // the event is over
    return () => bookTickets(store, { eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Ada' });
  },
  INVALID_TRANSITION: () => {
    const { store, event, tier } = publishedEvent();
    const b = bookTickets(store, { eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Ada' });
    cancelBooking(store, b.reference);
    return () => transitionBooking(store, b.reference, 'paid'); // paying a cancelled booking
  },
  INVALID_STATE: () => {
    const store = createStore();
    const event = createEvent(store, { title: 'E', city: 'Lagos', venue: 'V', startsAt: inDays(5) });
    return () => publishEvent(store, event.id); // no tiers yet
  },
};

for (const [expected, arrange] of Object.entries(TRIGGERS)) {
  test(`error code ${expected} can be triggered, and is a proper DomainError`, () => {
    const action = arrange();
    assert.equal(code(action), expected);
    try {
      action();
    } catch (e) {
      assert.ok(e instanceof DomainError && e instanceof Error);
      assert.equal(e.name, 'DomainError');
      assert.equal(typeof e.message, 'string');
      assert.ok(e.message.length > 0);
      assert.equal(typeof e.details, 'object');
    }
  });
}

test('every code in ErrorCode has a test above (add a trigger when you add a code)', () => {
  assert.deepEqual(Object.keys(TRIGGERS).sort(), Object.keys(ErrorCode).sort());
  for (const [key, value] of Object.entries(ErrorCode)) assert.equal(key, value); // the code equals its own name
});
