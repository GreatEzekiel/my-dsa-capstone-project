// booking-lifecycle.test.js: the state machine applied to REAL bookings in a store.
// The table is tested on its own in booking-state-machine.test.js. Here we check that the store obeys it:
// illegal moves are refused AND leave everything (status, seats, history) exactly as it was.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bookTickets, cancelBooking, findBookingByReference, listBookings, listEvents, transitionBooking,
} from '../src/domain/inventory.js';
import { BOOKING_STATES, BookingState, canTransition, holdsSeats } from '../src/domain/bookingStateMachine.js';
import { code, publishedEvent } from './helpers.js';

const { PENDING, PAID, CANCELLED, REFUNDED, CHECKED_IN } = BookingState;

// A booking of `quantity` seats, plus handy readers.
function setup({ capacity = 10, quantity = 2 } = {}) {
  const ctx = publishedEvent({ capacity });
  const book = (q = quantity, customer = 'Ada') =>
    bookTickets(ctx.store, { eventId: ctx.event.id, tierId: ctx.tier.id, quantity: q, customer });
  const sold = () => listEvents(ctx.store)[0].tiers[0].sold;
  const status = (b) => findBookingByReference(ctx.store, b.reference).status;
  const move = (b, to) => transitionBooking(ctx.store, b.reference, to);
  return { ...ctx, book, sold, status, move };
}

// Walks a booking to a given state by the legal route, so each test can start from any state.
const ROUTE = {
  [PENDING]: [],
  [PAID]: [PAID],
  [CANCELLED]: [CANCELLED],
  [REFUNDED]: [PAID, REFUNDED],
  [CHECKED_IN]: [PAID, CHECKED_IN],
};
function bookingIn(ctx, state) {
  const b = ctx.book();
  for (const step of ROUTE[state]) ctx.move(b, step);
  assert.equal(ctx.status(b), state);
  return b;
}

test('a new booking starts as pending, with a history of one entry', () => {
  const ctx = setup();
  const b = ctx.book();
  assert.equal(b.status, PENDING);
  assert.deepEqual(b.history.map((h) => h.status), [PENDING]);
});

test('the happy path: pending -> paid -> checked_in, and the history records every step', () => {
  const ctx = setup();
  const b = ctx.book();
  ctx.move(b, PAID);
  ctx.move(b, CHECKED_IN);
  const final = findBookingByReference(ctx.store, b.reference);
  assert.equal(final.status, CHECKED_IN);
  assert.deepEqual(final.history.map((h) => h.status), [PENDING, PAID, CHECKED_IN]);
  assert.equal(ctx.sold(), 2); // a checked-in booking still occupies its seats
});

test('paying a CANCELLED booking is refused, and nothing changes', () => {
  const ctx = setup();
  const b = ctx.book();
  cancelBooking(ctx.store, b.reference);
  const before = { booking: findBookingByReference(ctx.store, b.reference), sold: ctx.sold() };

  assert.equal(code(() => ctx.move(b, PAID)), 'INVALID_TRANSITION');

  assert.equal(findBookingByReference(ctx.store, b.reference), before.booking); // the very same record
  assert.equal(ctx.sold(), before.sold);
  assert.equal(ctx.status(b), CANCELLED);
});

// Every illegal (from, to) pair, on a real booking: 20 refusals. Each must leave the booking untouched.
for (const from of BOOKING_STATES) {
  for (const to of BOOKING_STATES) {
    if (canTransition(from, to)) continue;
    test(`real booking: ${from} -> ${to} is refused and changes nothing`, () => {
      const ctx = setup();
      const b = bookingIn(ctx, from);
      const before = findBookingByReference(ctx.store, b.reference);
      const soldBefore = ctx.sold();

      assert.equal(code(() => ctx.move(b, to)), 'INVALID_TRANSITION');

      assert.equal(findBookingByReference(ctx.store, b.reference), before); // same record, same history
      assert.equal(ctx.sold(), soldBefore); // seat count unchanged
    });
  }
}

// Every allowed move, on a real booking: 5 successes, with the seat effect checked.
for (const from of BOOKING_STATES) {
  for (const to of BOOKING_STATES) {
    if (!canTransition(from, to)) continue;
    test(`real booking: ${from} -> ${to} is allowed${holdsSeats(from) && !holdsSeats(to) ? ' and releases the seats' : ''}`, () => {
      const ctx = setup({ quantity: 3 });
      const b = bookingIn(ctx, from);
      const soldBefore = ctx.sold();
      assert.equal(soldBefore, 3);

      const updated = ctx.move(b, to);

      assert.equal(updated.status, to);
      assert.equal(ctx.status(b), to);
      assert.equal(ctx.sold(), holdsSeats(to) ? 3 : 0);
      assert.equal(updated.history.at(-1).status, to);
    });
  }
}

test('cancelling a PAID booking releases its seats; refunding it does too', () => {
  const a = setup({ capacity: 5, quantity: 2 });
  const b = a.book();
  a.move(b, PAID);
  cancelBooking(a.store, b.reference);
  assert.equal(a.sold(), 0);

  const r = setup({ capacity: 5, quantity: 2 });
  const c = r.book();
  r.move(c, PAID);
  r.move(c, REFUNDED);
  assert.equal(r.sold(), 0);
});

test('cancelBooking: twice is still ALREADY_CANCELLED (the friendly error), other illegal cancels are INVALID_TRANSITION', () => {
  const ctx = setup();
  const cancelled = bookingIn(ctx, CANCELLED);
  const refunded = bookingIn(ctx, REFUNDED);
  const checkedIn = bookingIn(ctx, CHECKED_IN);

  assert.equal(code(() => cancelBooking(ctx.store, cancelled.reference)), 'ALREADY_CANCELLED');
  assert.equal(code(() => cancelBooking(ctx.store, refunded.reference)), 'INVALID_TRANSITION');
  assert.equal(code(() => cancelBooking(ctx.store, checkedIn.reference)), 'INVALID_TRANSITION');
  assert.equal(ctx.status(refunded), REFUNDED);
  assert.equal(ctx.status(checkedIn), CHECKED_IN);
});

test('an unknown reference is NOT_FOUND, and an unknown target state is INVALID_TRANSITION', () => {
  const ctx = setup();
  const b = ctx.book();
  assert.equal(code(() => transitionBooking(ctx.store, 'ZZZZ-ZZZZ', PAID)), 'NOT_FOUND');
  assert.equal(code(() => ctx.move(b, 'teleported')), 'INVALID_TRANSITION');
  assert.equal(code(() => ctx.move(b, undefined)), 'INVALID_TRANSITION');
  assert.equal(ctx.status(b), PENDING);
});

test('records are frozen: a booking cannot be moved by editing it, only through transitionBooking', () => {
  const ctx = setup();
  const b = ctx.book();
  assert.throws(() => { b.status = PAID; }, TypeError);
  assert.throws(() => { b.history.push({ status: PAID }); }, TypeError);
  assert.throws(() => { b.history[0].status = PAID; }, TypeError);
  assert.equal(ctx.status(b), PENDING);
});

test('a booking changed by a move is a NEW record: the old one a caller holds stays as it was', () => {
  const ctx = setup();
  const before = ctx.book();
  const after = ctx.move(before, PAID);
  assert.equal(before.status, PENDING);
  assert.equal(before.history.length, 1);
  assert.equal(after.status, PAID);
  assert.equal(after.history.length, 2);
});

test('seats freed by a refund can be booked by someone else', () => {
  const ctx = setup({ capacity: 2, quantity: 2 });
  const first = ctx.book();
  ctx.move(first, PAID);
  assert.equal(code(() => ctx.book(1, 'Bola')), 'SOLD_OUT'); // full
  ctx.move(first, REFUNDED);
  assert.doesNotThrow(() => ctx.book(2, 'Bola')); // the refunded seats are free again
});

// A random walk: thousands of random move attempts. Whatever happens, the rules of the life cycle must hold.
test('random moves never break the life cycle: finals stay final, history is always a legal path, seats add up', () => {
  let seed = 4242;
  const rand = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n; };

  const ctx = setup({ capacity: 40, quantity: 1 });
  const bookings = [];
  for (let i = 0; i < 4000; i++) {
    try {
      if (bookings.length < 40 && rand(4) === 0) bookings.push(ctx.book(1 + rand(2), `P${i}`));
      else if (bookings.length) {
        const target = bookings[rand(bookings.length)];
        const wanted = [...BOOKING_STATES, 'junk'][rand(BOOKING_STATES.length + 1)];
        const before = findBookingByReference(ctx.store, target.reference);
        try {
          ctx.move(target, wanted);
          assert.ok(canTransition(before.status, wanted), `an illegal move succeeded: ${before.status} -> ${wanted}`);
        } catch (e) {
          if (e.code !== 'INVALID_TRANSITION') throw e;
          assert.ok(!canTransition(before.status, wanted)); // refused only when it really was illegal
          assert.equal(findBookingByReference(ctx.store, target.reference), before); // and nothing changed
        }
      }
    } catch (e) {
      if (e.code !== 'SOLD_OUT') throw e; // a full tier refusing a booking is fine
    }

    // Invariants, after EVERY step:
    const all = listBookings(ctx.store);
    const sold = listEvents(ctx.store)[0].tiers[0].sold;
    assert.equal(sold, all.filter((b) => holdsSeats(b.status)).reduce((sum, b) => sum + b.quantity, 0), 'seats must match the bookings');
    for (const b of all) {
      assert.equal(b.history.at(-1).status, b.status); // history ends where the booking is
      assert.equal(b.history[0].status, PENDING); // and begins at pending
      for (let k = 1; k < b.history.length; k++) {
        assert.ok(canTransition(b.history[k - 1].status, b.history[k].status), 'history contains an illegal step');
      }
    }
  }
});
