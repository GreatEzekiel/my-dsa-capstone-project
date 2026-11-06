// booking-state-machine.test.js: the booking life cycle as a table of allowed moves.
// The table is tiny (5 states), so we test ALL 25 possible moves, one by one: nothing is left to chance.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BookingState, BOOKING_STATES, MOVES, TRANSITIONS, STATE_INFO, canTransition, assertTransition, allowedFrom,
  isFinal, isBookingState, holdsSeats, bookingStatesToMermaid,
} from '../src/domain/bookingStateMachine.js';
import { DomainError, ErrorCode } from '../src/domain/errors.js';
import { code } from './helpers.js';

const { PENDING, PAID, CANCELLED, REFUNDED, CHECKED_IN } = BookingState;

// The rules from the brief, written out a second time, in a different shape, on purpose:
// if the code and this list ever disagree, a test fails and a human has to decide which is right.
const ALLOWED = new Set([
  `${PENDING}>${PAID}`, `${PENDING}>${CANCELLED}`,
  `${PAID}>${CHECKED_IN}`, `${PAID}>${REFUNDED}`, `${PAID}>${CANCELLED}`,
]);

test('there are exactly five states, named as the brief says', () => {
  assert.deepEqual([...BOOKING_STATES], ['pending', 'paid', 'cancelled', 'refunded', 'checked_in']);
});

// One test per (from, to) pair: 25 tests, each named, so a failure says exactly which move is wrong.
for (const from of BOOKING_STATES) {
  for (const to of BOOKING_STATES) {
    const allowed = ALLOWED.has(`${from}>${to}`);
    test(`${allowed ? 'ALLOWED' : 'REFUSED'}: ${from} -> ${to}`, () => {
      assert.equal(canTransition(from, to), allowed);
      if (allowed) {
        assert.doesNotThrow(() => assertTransition(from, to));
      } else {
        assert.equal(code(() => assertTransition(from, to)), ErrorCode.INVALID_TRANSITION);
      }
    });
  }
}

test('exactly 5 of the 25 moves are allowed', () => {
  const count = BOOKING_STATES.flatMap((f) => BOOKING_STATES.map((t) => canTransition(f, t))).filter(Boolean).length;
  assert.equal(count, 5);
});

test('cancelled, refunded and checked_in are final: nothing leaves them', () => {
  for (const state of [CANCELLED, REFUNDED, CHECKED_IN]) {
    assert.equal(isFinal(state), true, state);
    assert.deepEqual(allowedFrom(state), [], state);
    for (const to of BOOKING_STATES) assert.equal(canTransition(state, to), false, `${state} -> ${to}`);
  }
  assert.equal(isFinal(PENDING), false);
  assert.equal(isFinal(PAID), false);
});

test('the famous one: paying a cancelled booking is refused', () => {
  assert.equal(canTransition(CANCELLED, PAID), false);
  assert.equal(code(() => assertTransition(CANCELLED, PAID)), 'INVALID_TRANSITION');
});

test('what each live state may do next', () => {
  assert.deepEqual(allowedFrom(PENDING), [PAID, CANCELLED]);
  assert.deepEqual(allowedFrom(PAID), [CHECKED_IN, REFUNDED, CANCELLED]);
});

test('the error is a proper DomainError that explains itself', () => {
  let error;
  try { assertTransition(CANCELLED, PAID); } catch (e) { error = e; }
  assert.ok(error instanceof DomainError);
  assert.equal(error.code, 'INVALID_TRANSITION');
  assert.match(error.message, /cancelled booking cannot become paid/);
  assert.match(error.message, /final/); // it says WHY: nothing can leave a final state
  assert.deepEqual(error.details, { from: 'cancelled', to: 'paid', allowed: [] });

  try { assertTransition(PENDING, CHECKED_IN); } catch (e) { error = e; }
  assert.deepEqual(error.details.allowed, [PAID, CANCELLED]); // the error lists the moves that WOULD work
});

test('staying in the same state is not a move', () => {
  for (const state of BOOKING_STATES) {
    assert.equal(canTransition(state, state), false, state);
    assert.equal(code(() => assertTransition(state, state)), 'INVALID_TRANSITION', state);
  }
});

test('unknown states, wrong types and tricky names are refused, and canTransition never throws', () => {
  for (const junk of ['PAID', 'Paid', ' paid', 'teleported', '', 'toString', '__proto__', 'constructor', undefined, null, 7, {}, [], ['paid']]) {
    assert.equal(canTransition(junk, PAID), false, `from ${String(junk)}`);
    assert.equal(canTransition(PENDING, junk), false, `to ${String(junk)}`);
    assert.equal(isBookingState(junk), false, String(junk));
    assert.equal(code(() => assertTransition(junk, PAID)), 'INVALID_TRANSITION');
    assert.equal(code(() => assertTransition(PENDING, junk)), 'INVALID_TRANSITION');
  }
  assert.deepEqual(allowedFrom('nope'), []);
  assert.equal(holdsSeats('nope'), false);
});

test('canTransition and assertTransition always agree', () => {
  for (const from of [...BOOKING_STATES, 'x', undefined]) {
    for (const to of [...BOOKING_STATES, 'x', undefined]) {
      let threw = false;
      try { assertTransition(from, to); } catch { threw = true; }
      assert.equal(threw, !canTransition(from, to), `${String(from)} -> ${String(to)}`);
    }
  }
});

test('the rules are frozen data: nobody can change them while the program runs', () => {
  assert.throws(() => { BookingState.PAID = 'x'; }, TypeError);
  assert.throws(() => { MOVES.push({ from: CANCELLED, to: PAID, label: 'oops' }); }, TypeError);
  assert.throws(() => { MOVES[0].to = CANCELLED; }, TypeError);
  assert.throws(() => { TRANSITIONS[CANCELLED].push(PAID); }, TypeError);
  assert.throws(() => { TRANSITIONS.refunded = [PAID]; }, TypeError);
  assert.throws(() => { STATE_INFO[CANCELLED].holdsSeats = true; }, TypeError);
  // allowedFrom hands out a COPY, so even a caller who edits it can't change the rules.
  allowedFrom(PENDING).push(CHECKED_IN);
  assert.equal(canTransition(PENDING, CHECKED_IN), false);
});

test('the lookup table is built from the list of moves (they cannot disagree)', () => {
  const fromList = new Set(MOVES.map((m) => `${m.from}>${m.to}`));
  const fromTable = new Set(Object.entries(TRANSITIONS).flatMap(([f, tos]) => tos.map((t) => `${f}>${t}`)));
  assert.deepEqual([...fromList].sort(), [...ALLOWED].sort());
  assert.deepEqual([...fromTable].sort(), [...ALLOWED].sort());
  assert.equal(new Set(MOVES.map((m) => `${m.from}>${m.to}`)).size, MOVES.length); // no duplicate moves
  for (const m of MOVES) assert.ok(m.label && typeof m.label === 'string');
});

test('which states keep seats: pending, paid and checked_in do; cancelled and refunded give them back', () => {
  assert.deepEqual(BOOKING_STATES.filter(holdsSeats), [PENDING, PAID, CHECKED_IN]);
  for (const state of BOOKING_STATES) assert.ok(STATE_INFO[state].description.length > 0);
});

// ---------- the diagram in docs/architecture.md must match the code ----------

const docs = readFileSync(new URL('../docs/architecture.md', import.meta.url), 'utf8');
const stateBlock = (docs.match(/```mermaid\s+(stateDiagram-v2[\s\S]*?)```/) ?? [])[1];

test('docs/architecture.md contains the booking state diagram', () => {
  assert.ok(stateBlock, 'no stateDiagram-v2 block found in docs/architecture.md');
});

test('the diagram in the docs shows exactly the moves in the code', () => {
  // Read every "a --> b" arrow in the docs, except the start and end markers.
  const arrows = [...stateBlock.matchAll(/^\s*(\w+)\s*-->\s*(\w+)/gm)].map((m) => `${m[1]}>${m[2]}`);
  assert.deepEqual([...new Set(arrows)].sort(), [...ALLOWED].sort());
  // And the start / end markers: a booking starts as pending; the three final states end the life cycle.
  assert.match(stateBlock, /\[\*\]\s*-->\s*pending/);
  for (const state of [CANCELLED, REFUNDED, CHECKED_IN]) assert.match(stateBlock, new RegExp(`${state}\\s*-->\\s*\\[\\*\\]`));
});

test('the diagram is exactly what the code generates (so the docs can be refreshed by copy and paste)', () => {
  assert.equal(stateBlock.trim(), bookingStatesToMermaid().trim());
});

test('the state table in the docs lists every state', () => {
  for (const state of BOOKING_STATES) assert.ok(docs.includes(`\`${state}\``), `${state} missing from the state table`);
});
