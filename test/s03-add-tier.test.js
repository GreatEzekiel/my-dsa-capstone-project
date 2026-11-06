// S03: As an organizer, I want to add ticket tiers with a price and capacity, so that I can sell different kinds of ticket.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStore, createEvent, addTier, publishEvent, listEvents, MAX_PRICE_CENTS,
} from '../src/domain/inventory.js';
import { code, inDays } from './helpers.js';

function draft() {
  const store = createStore();
  const event = createEvent(store, { title: 'Draft', city: 'Lagos', venue: 'V', startsAt: inDays(10) });
  return { store, event };
}
const tiersOf = (store) => listEvents(store)[0].tiers;

test('S03: adding "General" at 500000 kobo with capacity 100 saves it with 0 sold and 100 seats left', () => {
  const { store, event } = draft();
  const tier = addTier(store, event.id, { name: 'General', priceCents: 500_000, capacity: 100 });

  assert.equal(tier.name, 'General');
  assert.equal(tier.priceCents, 500_000);
  assert.equal(tier.capacity, 100);
  assert.equal(tier.sold, 0);
  assert.equal(tier.seatsLeft, 100);
  assert.equal(typeof tier.id, 'string');

  const saved = tiersOf(store);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].sold, 0);
  assert.equal(saved[0].seatsLeft, 100);
});

test('S03: a price that is not a whole number is rejected with VALIDATION, and nothing is saved', () => {
  const { store, event } = draft();
  for (const priceCents of [9.99, 0.5, '500000', -1, NaN, Infinity, undefined, null, MAX_PRICE_CENTS + 1, Number.MAX_SAFE_INTEGER]) {
    assert.equal(code(() => addTier(store, event.id, { name: 'X', priceCents, capacity: 5 })), 'VALIDATION', `price=${String(priceCents)}`);
  }
  assert.equal(tiersOf(store).length, 0);
});

test('S03: a capacity below 1 (or not a whole number) is rejected with VALIDATION', () => {
  const { store, event } = draft();
  for (const capacity of [0, -5, 1.5, '10', NaN, undefined]) {
    assert.equal(code(() => addTier(store, event.id, { name: 'X', priceCents: 1000, capacity })), 'VALIDATION', `capacity=${String(capacity)}`);
  }
  assert.equal(tiersOf(store).length, 0);
});

test('S03: a tier needs a name', () => {
  const { store, event } = draft();
  assert.equal(code(() => addTier(store, event.id, { name: '  ', priceCents: 1000, capacity: 5 })), 'VALIDATION');
  assert.equal(code(() => addTier(store, event.id)), 'VALIDATION'); // no details at all
});

test('S03: an event id that does not exist is rejected with NOT_FOUND', () => {
  const { store } = draft();
  assert.equal(code(() => addTier(store, 'no-such-event', { name: 'General', priceCents: 500_000, capacity: 100 })), 'NOT_FOUND');
  assert.equal(tiersOf(store).length, 0);
});

test('S03: a free tier (price 0) is allowed, and a tier can be added to an already published event', () => {
  const { store, event } = draft();
  assert.equal(addTier(store, event.id, { name: 'Free', priceCents: 0, capacity: 5 }).priceCents, 0);
  publishEvent(store, event.id);
  assert.doesNotThrow(() => addTier(store, event.id, { name: 'Late release', priceCents: 1000, capacity: 5 }));
  assert.equal(tiersOf(store).length, 2);
});

test('S03: tiers keep the order they were added in', () => {
  const { store, event } = draft();
  addTier(store, event.id, { name: 'General', priceCents: 500_000, capacity: 100 });
  addTier(store, event.id, { name: 'VIP', priceCents: 2_000_000, capacity: 10 });
  assert.deepEqual(tiersOf(store).map((t) => t.name), ['General', 'VIP']);
});
