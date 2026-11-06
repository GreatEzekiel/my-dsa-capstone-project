// bookingStateMachine.js
// The life of a booking, written as DATA: a list of states and a list of allowed moves.
//
//                  payment received            ticket scanned
//     [start] --> pending ------------> paid ------------------> checked_in --> [end]
//                    |                   |   \
//                    | cancelled         |    \ money returned
//                    v                   |     v
//                cancelled <-------------+   refunded --> [end]
//                (cancelled after paying)
//
// Why a state machine? Without one, "can this booking be paid?" is answered by a pile of `if`s scattered
// across the code, and sooner or later one is forgotten (a cancelled booking gets paid). With one, there is
// a single table, and a single question to ask it: "is this move allowed?" Everything else (payment, refunds,
// check-in, in later builds) must ask the table first.
//
// This file has NO knowledge of seats, stores, HTTP or time: it is pure rules.

import { DomainError, ErrorCode } from './errors.js';

// ---------- the states ----------

// Object.freeze: nobody can add, change or remove a state at run time.
// The values are lower-case words, and they are what is stored in `booking.status`.
export const BookingState = Object.freeze({
  PENDING: 'pending', //       the seats are held, waiting for payment
  PAID: 'paid', //             payment received
  CANCELLED: 'cancelled', //   cancelled; the seats are released
  REFUNDED: 'refunded', //     paid, then the money was returned; the seats are released
  CHECKED_IN: 'checked_in', // the attendee arrived and the ticket was scanned
});

export const BOOKING_STATES = Object.freeze(Object.values(BookingState));

// What each state means, and whether a booking in that state still occupies seats.
// pending, paid and checked_in occupy seats. cancelled and refunded give them back.
export const STATE_INFO = Object.freeze({
  [BookingState.PENDING]: Object.freeze({ holdsSeats: true, description: 'Seats are held, waiting for payment' }),
  [BookingState.PAID]: Object.freeze({ holdsSeats: true, description: 'Payment received' }),
  [BookingState.CANCELLED]: Object.freeze({ holdsSeats: false, description: 'Cancelled, seats released' }),
  [BookingState.REFUNDED]: Object.freeze({ holdsSeats: false, description: 'Paid, then refunded, seats released' }),
  [BookingState.CHECKED_IN]: Object.freeze({ holdsSeats: true, description: 'Attended: the ticket was scanned' }),
});

// ---------- the moves ----------

// EVERY allowed move, one line each. This list is the single source of truth:
// the lookup table below, the diagram in docs/architecture.md and the tests are all checked against it.
// A move that is not on this list is illegal. There are no moves out of cancelled, refunded or checked_in.
export const MOVES = Object.freeze([
  Object.freeze({ from: BookingState.PENDING, to: BookingState.PAID, label: 'payment received' }),
  Object.freeze({ from: BookingState.PENDING, to: BookingState.CANCELLED, label: 'cancelled before paying' }),
  Object.freeze({ from: BookingState.PAID, to: BookingState.CHECKED_IN, label: 'ticket scanned' }),
  Object.freeze({ from: BookingState.PAID, to: BookingState.REFUNDED, label: 'money returned' }),
  Object.freeze({ from: BookingState.PAID, to: BookingState.CANCELLED, label: 'cancelled after paying' }),
]);

// The same moves as a lookup: state -> list of states it may move to.
// Built from MOVES (not typed twice), so the two can never disagree.
export const TRANSITIONS = Object.freeze(
  Object.fromEntries(
    BOOKING_STATES.map((state) => [
      state,
      Object.freeze(MOVES.filter((m) => m.from === state).map((m) => m.to)),
    ]),
  ),
);

// ---------- asking the table ----------

// Is `value` one of the five states? (Object.hasOwn avoids false answers like 'toString'.)
export const isBookingState = (value) => typeof value === 'string' && Object.hasOwn(TRANSITIONS, value);

// A copy of the states you may move to from `state` (empty for a final state or an unknown one).
export const allowedFrom = (state) => (isBookingState(state) ? [...TRANSITIONS[state]] : []);

// A final state has no moves out: once there, the booking is finished for good.
export const isFinal = (state) => isBookingState(state) && TRANSITIONS[state].length === 0;

// Does a booking in this state occupy seats?
export const holdsSeats = (state) => isBookingState(state) && STATE_INFO[state].holdsSeats;

/**
 * canTransition(from, to) -> true or false. A QUESTION: it never throws, whatever you pass in.
 * Moving to the state you are already in is not a move, so it is false too.
 */
export function canTransition(from, to) {
  return isBookingState(from) && isBookingState(to) && TRANSITIONS[from].includes(to);
}

/**
 * assertTransition(from, to): does nothing if the move is allowed; otherwise throws INVALID_TRANSITION.
 * An ORDER: use it right before changing a booking, so an illegal move can never happen.
 * It throws exactly when canTransition is false.
 */
export function assertTransition(from, to) {
  if (canTransition(from, to)) return;

  let message;
  if (!isBookingState(from)) message = `Unknown booking state "${String(from)}"`;
  else if (!isBookingState(to)) message = `Unknown booking state "${String(to)}"`;
  else if (isFinal(from)) message = `A ${from} booking cannot become ${to}: ${from} is final, nothing can leave it`;
  else if (from === to) message = `A booking that is already ${from} cannot become ${to} again`;
  else message = `A ${from} booking cannot become ${to}`;

  throw new DomainError(ErrorCode.INVALID_TRANSITION, message, { from, to, allowed: allowedFrom(from) });
}

// ---------- the diagram ----------

/**
 * Draws the state machine as Mermaid text, straight from the data. The same text lives in docs/architecture.md,
 * and a test fails if the two ever differ, so the picture can't drift away from the code.
 */
export function bookingStatesToMermaid() {
  const lines = ['stateDiagram-v2', `    [*] --> ${BookingState.PENDING}`];
  for (const { from, to, label } of MOVES) lines.push(`    ${from} --> ${to} : ${label}`);
  for (const state of BOOKING_STATES) if (isFinal(state)) lines.push(`    ${state} --> [*]`);
  return lines.join('\n');
}
