// helpers.js: small shared tools for the tests. (Not a test file: the name does not end in .test.js.)

import assert from 'node:assert/strict';
import { DomainError } from '../src/domain/errors.js';
import { createStore, createEvent, addTier, publishEvent } from '../src/domain/inventory.js';

// An ISO date n days from now, so tests never break because the calendar moved on.
export const inDays = (n) => new Date(Date.now() + n * 24 * 3600 * 1000).toISOString();

// Runs fn, insists it throws one of OUR errors, and returns its code. Fails the test if nothing is thrown.
export function code(fn) {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof DomainError, `expected a DomainError, got ${e?.name}: ${e?.message}`);
    return e.code;
  }
  return assert.fail('expected an error, but nothing was thrown');
}

// Freezes an object and everything inside it. A frozen input is a trap for code that mutates:
// in strict mode (all ES modules) any write to it throws a TypeError, so a test with frozen input
// PROVES the function never modified it.
export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

// A hand-made event summary for the pure search functions. Override only what a test cares about.
let counter = 0;
export function summary(overrides = {}) {
  counter += 1;
  return {
    id: `evt-${String(counter).padStart(4, '0')}`,
    title: `Event ${counter}`,
    city: 'Lagos',
    venue: 'Main Hall',
    startsAt: '2026-12-05T18:00:00+01:00',
    status: 'published',
    tierCount: 1,
    minPriceCents: 500_000,
    seatsLeft: 10,
    ...overrides,
  };
}

// A real store with one PUBLISHED event and one tier: the usual starting point for booking tests.
export function publishedEvent({ capacity = 3, priceCents = 500_000 } = {}) {
  const store = createStore();
  const event = createEvent(store, { title: 'Lagos Tech Meetup', city: 'Lagos', venue: 'Landmark', startsAt: inDays(30) });
  const tier = addTier(store, event.id, { name: 'General', priceCents, capacity });
  publishEvent(store, event.id);
  return { store, event, tier };
}
