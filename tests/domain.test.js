// domain.test.js: Build 1 rules (booking, cancelling, waitlist, time, invariants). Run with `npm test`.
// Uses Node's built-in test runner (node:test), so no test library is needed.
// Each test() is one rule, written as a small experiment that must pass.
// Tests only use the PUBLIC functions: the store is sealed, so they can't peek inside.

import test from 'node:test';
import assert from 'node:assert/strict'; // strict: compares values without sloppy type coercion
import { Queue } from '../src/domain/waitlistQueue.js';
import { DomainError } from '../src/domain/errors.js';
import { referenceKey } from '../src/domain/ids.js';
import {
  createStore, createEvent, addTier, bookTickets, cancelBooking, findBookingByReference,
  joinWaitlist, leaveWaitlist, takeNextFromWaitlist, listEvents, listWaitlist, listBookings,
} from '../src/domain/inventory.js';

// An event date 30 days from now, so tests never break just because the calendar moved on.
const inThirtyDays = () => new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

// Builds a fresh store with one event and one tier for every test, so tests never share state.
// Returns shortcuts to keep each test short: book(), join(), and sold() to read the seats sold.
function setup(capacity = 3) {
  const store = createStore();
  const event = createEvent(store, { name: 'E', venue: 'V', startsAt: inThirtyDays() });
  const tier = addTier(store, event.id, { name: 'GA', priceCents: 1000, capacity });
  const book = (quantity, customer = 'A') => bookTickets(store, { eventId: event.id, tierId: tier.id, quantity, customer });
  const join = (quantity, customer) => joinWaitlist(store, { eventId: event.id, tierId: tier.id, quantity, customer });
  const sold = () => listEvents(store)[0].tiers[0].sold;
  return { store, event, tier, book, join, sold };
}

// Runs fn, insists it throws a DomainError, and returns its code. Fails the test if nothing is thrown.
const code = (fn) => {
  try { fn(); } catch (e) { assert.ok(e instanceof DomainError); return e.code; }
  assert.fail('did not throw');
};

// ---------- the queue ----------

test('queue is first-in-first-out', () => {
  const q = new Queue();
  [1, 2, 3].forEach((n) => q.enqueue(n));
  assert.equal(q.peek(), 1); // front is the first one added, not the last
  // Items leave in the order they arrived; the 4th dequeue on an empty queue gives undefined.
  assert.deepEqual([q.dequeue(), q.dequeue(), q.dequeue(), q.dequeue()], [1, 2, 3, undefined]);
  assert.equal(q.size, 0);
  q.enqueue(9); // edge case: the queue must still work after being emptied (tail was reset)
  assert.equal(q.dequeue(), 9);
});

test('queue.remove works for the middle, the front and the back', () => {
  const q = new Queue();
  [1, 2, 3, 4].forEach((n) => q.enqueue(n));
  assert.equal(q.remove((n) => n === 3), 3); // middle
  assert.equal(q.remove((n) => n === 1), 1); // front
  assert.equal(q.remove((n) => n === 4), 4); // back: the tail must move back to 2
  assert.equal(q.remove((n) => n === 99), undefined); // not there
  assert.deepEqual([...q], [2]);
  q.enqueue(5); // enqueue must attach after the NEW tail
  assert.deepEqual([...q], [2, 5]);
  assert.equal(q.size, 2);
});

// ---------- booking ----------

test('booking computes total in whole cents and takes seats', () => {
  const { book, sold } = setup();
  const b = book(2);
  assert.equal(b.totalCents, 2000); // 2 x 1000, an integer
  assert.equal(sold(), 2); // the seats were taken
});

test('sold out throws and changes nothing', () => {
  const { store, book, sold } = setup(3);
  book(2); // 1 seat left
  const before = [sold(), listBookings(store).length];
  assert.equal(code(() => book(2)), 'SOLD_OUT'); // asking for 2 when 1 is left
  assert.deepEqual([sold(), listBookings(store).length], before); // identical afterwards
});

test('validation: quantity 1..10, whole numbers, names', () => {
  const { book } = setup(50);
  // Zero, too many, decimal, a string, NaN and negative are all rejected.
  for (const q of [0, 11, 1.5, '2', NaN, -1]) assert.equal(code(() => book(q)), 'VALIDATION');
  assert.equal(code(() => book(1, '  ')), 'VALIDATION'); // blank name
  assert.doesNotThrow(() => book(10)); // 10 is the allowed maximum
});

test('rejects decimal prices', () => {
  const { store, event } = setup();
  assert.equal(code(() => addTier(store, event.id, { name: 'x', priceCents: 9.99, capacity: 1 })), 'VALIDATION');
});

test('returned bookings cannot be tampered with', () => {
  const { store, book } = setup();
  const b = book(1);
  assert.throws(() => { b.status = 'HACKED'; }, TypeError); // frozen: writing throws
  assert.equal(findBookingByReference(store, b.reference).status, 'CONFIRMED');
  // cancelling swaps in a new cancelled record
  const res = cancelBooking(store, b.reference);
  assert.equal(res.booking.status, 'CANCELLED');
  assert.equal(findBookingByReference(store, b.reference).status, 'CANCELLED');
});

test('the store is sealed: no data to reach into, and fake stores are refused', () => {
  const { store, event } = setup();
  assert.deepEqual(Object.keys(store), []); // an opaque token, nothing to edit
  assert.throws(() => { store.events = 'oops'; }, TypeError); // frozen
  const fake = { events: new Map() };
  assert.equal(code(() => createEvent(fake, { name: 'x', venue: 'y', startsAt: inThirtyDays() })), 'VALIDATION');
  assert.ok(event.id);
});

// ---------- finding bookings ----------

test('lookup by reference ignores case and hyphen; unknown is NOT_FOUND', () => {
  const { store, book } = setup();
  const b = book(1);
  // "7k2m 9q4x"-style input (lowercase, space instead of hyphen) still finds the same booking.
  assert.equal(findBookingByReference(store, b.reference.toLowerCase().replace('-', ' ')), b);
  assert.equal(code(() => findBookingByReference(store, 'ZZZZ-ZZZZ')), 'NOT_FOUND');
});

test('lookup forgives O, I and L typed for 0 and 1', () => {
  // The key function on its own: look-alike letters map to the digits.
  assert.equal(referenceKey('aob1-cod1'), referenceKey('A0B1-C0D1')); // O read as 0
  assert.equal(referenceKey('A0BI-C0DL'), referenceKey('A0B1-C0D1')); // I and L read as 1

  // And end to end: make bookings until one has a 0 or 1 in its code, then find it with look-alikes.
  const { store, book } = setup(500);
  let b;
  do { b = book(1); } while (!/[01]/.test(referenceKey(b.reference)));
  const misread = b.reference.replace(/0/g, 'O').replace(/1/g, 'I');
  assert.equal(findBookingByReference(store, misread).reference, b.reference);
});

// ---------- cancelling ----------

test('cancel releases seats, twice is an error, names next in line', () => {
  const { store, book, join, sold } = setup(2);
  const b = book(2); // sells out
  join(1, 'Chidi');
  join(1, 'Dayo');
  const res = cancelBooking(store, b.reference);
  assert.equal(res.seatsLeft, 2); // both seats are back
  assert.equal(res.nextInLine.customer, 'Chidi'); // first to join, first to be named
  assert.equal(code(() => cancelBooking(store, b.reference)), 'ALREADY_CANCELLED');
  assert.equal(sold(), 0); // the second cancel did not release seats again
});

// ---------- the waitlist ----------

test('waitlist refuses people when seats exist and nobody is waiting; promotion is strictly FIFO', () => {
  const { store, tier, book, join } = setup(2);
  assert.equal(code(() => join(1, 'X')), 'SEATS_AVAILABLE'); // seats free and no line: just book
  const b = book(2); // sell out
  join(2, 'Big party'); // first in line
  join(1, 'Solo'); // second in line
  cancelBooking(store, b.reference); // 2 seats free
  assert.equal(takeNextFromWaitlist(store, tier.id).customer, 'Big party'); // front of the line is served first
  assert.equal(listWaitlist(store, tier.id)[0].customer, 'Solo'); // and the next person is now at the front
});

test('FIFO is strict: the front of the line blocks, nobody behind skips ahead', () => {
  const { store, tier, book, join } = setup(3);
  const first = book(3); // sells out
  join(2, 'Big party'); // front of the line, needs 2
  join(1, 'Solo'); // behind, needs 1
  cancelBooking(store, first.reference); // 3 free
  takeNextFromWaitlist(store, tier.id); // Big party takes 2, leaving 1 free
  // Solo (needs 1) is now at the front and 1 seat is free, so Solo is served: order was respected.
  assert.equal(takeNextFromWaitlist(store, tier.id).customer, 'Solo');
  assert.equal(listWaitlist(store, tier.id).length, 0);
});

test('FIFO is strict: if the front party does not fit, nobody behind is served', () => {
  const { store, tier, book, join } = setup(4);
  const a = book(2);
  const c = book(2); // sold out
  join(3, 'Big party'); // front, needs 3
  join(1, 'Solo'); // behind, needs 1
  cancelBooking(store, a.reference); // only 2 free: Big party can't fit, but Solo (1) would
  assert.equal(code(() => takeNextFromWaitlist(store, tier.id)), 'SOLD_OUT'); // blocked, Solo does NOT skip ahead
  assert.deepEqual(listWaitlist(store, tier.id).map((e) => e.customer), ['Big party', 'Solo']);
  cancelBooking(store, c.reference); // now 4 free: Big party fits
  assert.equal(takeNextFromWaitlist(store, tier.id).customer, 'Big party');
});

test('no queue jumping: while people wait, strangers cannot book freed seats', () => {
  const { store, tier, book, join } = setup(2);
  const b = book(2);
  join(1, 'Waiting Wale');
  cancelBooking(store, b.reference); // 2 seats are free again
  assert.equal(code(() => book(1, 'Stranger')), 'WAITLIST_FIRST'); // blocked: someone is ahead
  assert.equal(takeNextFromWaitlist(store, tier.id).customer, 'Waiting Wale'); // the waiting person gets them
  assert.doesNotThrow(() => book(1, 'Stranger')); // the line is empty now, so booking works again
});

test('people can join the line even when seats exist, if others are already ahead', () => {
  const { store, book, join } = setup(2);
  const b = book(2);
  join(1, 'First');
  cancelBooking(store, b.reference); // seats free, but First is ahead
  assert.equal(join(1, 'Second').position, 2); // allowed, and placed behind First
});

test('the same person cannot join twice, but can rejoin after leaving', () => {
  const { store, tier, event, book, join } = setup(1);
  book(1);
  const { entry } = join(1, 'Ada Obi');
  assert.equal(code(() => join(1, '  ada   OBI ')), 'ALREADY_WAITING'); // same name, different spacing and case
  leaveWaitlist(store, { tierId: tier.id, entryId: entry.id });
  assert.doesNotThrow(() => join(1, 'Ada Obi'));
  assert.ok(event.id);
});

test('leaving the waitlist: everyone behind moves up; unknown entry is NOT_FOUND', () => {
  const { store, tier, book, join } = setup(1);
  book(1);
  join(1, 'One');
  const two = join(1, 'Two').entry;
  join(1, 'Three');
  const res = leaveWaitlist(store, { tierId: tier.id, entryId: two.id }); // someone from the middle
  assert.equal(res.removed.customer, 'Two');
  assert.deepEqual(listWaitlist(store, tier.id).map((e) => e.customer), ['One', 'Three']);
  assert.equal(code(() => leaveWaitlist(store, { tierId: tier.id, entryId: two.id })), 'NOT_FOUND'); // already gone
  assert.equal(code(() => leaveWaitlist(store, { tierId: 'nope', entryId: 'x' })), 'NOT_FOUND');
});

// ---------- time ----------

test('no bookings or waitlist joins once the event has started; cancelling still works', () => {
  // A fake clock we control. The event starts on Jan 2.
  let t = Date.parse('2026-01-01T00:00:00Z');
  const store = createStore({ now: () => t });
  const event = createEvent(store, { name: 'E', venue: 'V', startsAt: '2026-01-02T00:00:00Z' });
  const tier = addTier(store, event.id, { name: 'GA', priceCents: 1000, capacity: 1 });
  const args = { eventId: event.id, tierId: tier.id, quantity: 1, customer: 'A' };

  const b = bookTickets(store, args); // before the start: fine
  joinWaitlist(store, { ...args, customer: 'Waiter' });
  assert.equal(listEvents(store)[0].started, false);

  t = Date.parse('2026-01-03T00:00:00Z'); // travel past the start
  assert.equal(listEvents(store)[0].started, true);
  assert.equal(code(() => bookTickets(store, args)), 'EVENT_STARTED');
  assert.equal(code(() => joinWaitlist(store, { ...args, customer: 'Late' })), 'EVENT_STARTED');
  assert.equal(code(() => takeNextFromWaitlist(store, tier.id)), 'EVENT_STARTED');
  assert.doesNotThrow(() => cancelBooking(store, b.reference)); // cancelling is still allowed
});

// ---------- invariants ----------

// Do thousands of random actions, and after EACH one check that the books balance and the rules held.
// This finds bugs that hand-written examples miss, because it tries combinations nobody thought of.
test('invariants hold after random sequences of actions', () => {
  // Tiny seeded random generator: the "random" run is the same every time, so a failure is repeatable.
  let seed = 12345;
  const rand = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n; };

  const { store, event, tier, book, join } = setup(15);
  const refs = [];
  for (let i = 0; i < 4000; i++) {
    const lineBefore = listWaitlist(store, tier.id).length; // how many were waiting BEFORE this action
    let directBookingSucceeded = false;
    try {
      const action = rand(5);
      const qty = 1 + rand(10);
      if (action === 0) { refs.push(book(qty).reference); directBookingSucceeded = true; }
      else if (action === 1 && refs.length) cancelBooking(store, refs[rand(refs.length)]);
      else if (action === 2) join(qty, `Person ${rand(8)}`); // few names, so duplicates are attempted often
      else if (action === 3) takeNextFromWaitlist(store, tier.id);
      else if (action === 4) {
        const line = listWaitlist(store, tier.id);
        if (line.length) leaveWaitlist(store, { tierId: tier.id, entryId: line[rand(line.length)].id });
      }
    } catch (e) {
      if (!(e instanceof DomainError)) throw e; // rules refusing an action is fine; real bugs are not
    }

    // Fairness: a direct booking must never succeed while someone was waiting.
    if (directBookingSucceeded) assert.equal(lineBefore, 0, 'a stranger jumped the queue');

    // The books must balance: seats sold === seats in bookings that are not cancelled, and never above capacity.
    const confirmed = listBookings(store, { eventId: event.id }).filter((b) => b.status !== 'CANCELLED'); // CONFIRMED bookings hold seats
    const sold = listEvents(store)[0].tiers[0].sold;
    assert.equal(sold, confirmed.reduce((sum, b) => sum + b.quantity, 0));
    assert.ok(sold >= 0 && sold <= 15);

    // Nobody appears twice in the line.
    const names = listWaitlist(store, tier.id).map((e) => e.customer.toLowerCase());
    assert.equal(new Set(names).size, names.length);
  }
});
