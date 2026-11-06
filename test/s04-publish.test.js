// S04: As an organizer, I want to publish and unpublish an event, so that I control when it goes public.
//
// !! The acceptance criteria for S04 are written by YOUR CLASS, in pairs. The three below are a PROPOSED DRAFT,
// !! built from the rules in the Build 2 prompt. Replace them with your own, then change these tests to match.
// !! The tests marked "(extra)" are not criteria: they pin down edge cases.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStore, createEvent, addTier, publishEvent, unpublishEvent, listEventSummaries,
  bookTickets, findBookingByReference,
} from '../src/domain/inventory.js';
import { code, inDays } from './helpers.js';

function setup({ withTier = true } = {}) {
  const store = createStore();
  const event = createEvent(store, { title: 'Jazz Night', city: 'Abuja', venue: 'Jabi Lake', startsAt: inDays(14) });
  const tier = withTier ? addTier(store, event.id, { name: 'General', priceCents: 800_000, capacity: 10 }) : null;
  return { store, event, tier };
}

test('S04 (proposed 1): publishing a draft event that has a tier puts it on the public list', () => {
  const { store, event } = setup();
  assert.deepEqual(listEventSummaries(store), []); // hidden while a draft
  const published = publishEvent(store, event.id);
  assert.equal(published.status, 'published');
  assert.deepEqual(listEventSummaries(store).map((e) => e.id), [event.id]);
});

test('S04 (proposed 2): publishing an event with no ticket tiers is rejected with INVALID_STATE, and it stays a draft', () => {
  const { store, event } = setup({ withTier: false });
  assert.equal(code(() => publishEvent(store, event.id)), 'INVALID_STATE');
  assert.deepEqual(listEventSummaries(store), []);
  assert.equal(listEventSummaries(store, { publishedOnly: false })[0].status, 'draft');
});

test('S04 (proposed 3): unpublishing takes the event off the public list, stops new bookings, and keeps old ones', () => {
  const { store, event, tier } = setup();
  publishEvent(store, event.id);
  const booking = bookTickets(store, { eventId: event.id, tierId: tier.id, quantity: 2, customer: 'Ada' });

  const result = unpublishEvent(store, event.id);
  assert.equal(result.status, 'draft');
  assert.deepEqual(listEventSummaries(store), []);
  assert.equal(code(() => bookTickets(store, { eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Bola' })), 'INVALID_STATE');
  assert.equal(findBookingByReference(store, booking.reference).quantity, 2); // the earlier booking is still there
});

test('S04 (extra): an event id that does not exist is NOT_FOUND for publish and unpublish', () => {
  const { store } = setup();
  assert.equal(code(() => publishEvent(store, 'nope')), 'NOT_FOUND');
  assert.equal(code(() => unpublishEvent(store, 'nope')), 'NOT_FOUND');
});

test('S04 (extra): publishing twice is harmless, and the event can be published again after unpublishing', () => {
  const { store, event } = setup();
  publishEvent(store, event.id);
  assert.doesNotThrow(() => publishEvent(store, event.id));
  unpublishEvent(store, event.id);
  publishEvent(store, event.id);
  assert.equal(listEventSummaries(store).length, 1);
});

test('S04 (extra): a draft event cannot be booked (INVALID_STATE)', () => {
  const { store, event, tier } = setup();
  assert.equal(code(() => bookTickets(store, { eventId: event.id, tierId: tier.id, quantity: 1, customer: 'Ada' })), 'INVALID_STATE');
});

test('S04 (extra): listEventSummaries({ publishedOnly: false }) also shows drafts; a non-boolean option is refused', () => {
  const { store } = setup();
  assert.equal(listEventSummaries(store, { publishedOnly: false }).length, 1);
  assert.equal(code(() => listEventSummaries(store, { publishedOnly: 'no' })), 'VALIDATION');
});

test('S04 (extra): a summary reports the cheapest price and the seats left across all tiers', () => {
  const { store, event } = setup();
  addTier(store, event.id, { name: 'VIP', priceCents: 2_000_000, capacity: 5 });
  addTier(store, event.id, { name: 'Early bird', priceCents: 300_000, capacity: 2 });
  publishEvent(store, event.id);
  const [s] = listEventSummaries(store);
  assert.equal(s.minPriceCents, 300_000);
  assert.equal(s.seatsLeft, 10 + 5 + 2);
  assert.equal(s.tierCount, 3);
});
