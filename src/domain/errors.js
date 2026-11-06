// errors.js
// One error type for every rule the app enforces, so callers can tell
// "the user did something wrong" apart from "the code has a bug".

// A fixed list of error codes. Object.freeze stops anyone adding or changing
// codes by accident, so a typo like ErrorCode.SOLDOUT is `undefined`, not a new code.
export const ErrorCode = Object.freeze({
  VALIDATION: 'VALIDATION', // bad input: missing name, quantity 0, price 9.99...
  NOT_FOUND: 'NOT_FOUND', // unknown event, tier or booking reference
  SOLD_OUT: 'SOLD_OUT', // not enough seats left for this request
  ALREADY_CANCELLED: 'ALREADY_CANCELLED', // cancelling the same booking twice
  SEATS_AVAILABLE: 'SEATS_AVAILABLE', // tried to join the waitlist when seats exist (and nobody is waiting)
  WAITLIST_FIRST: 'WAITLIST_FIRST', // people are already waiting: join the line, don't jump it
  ALREADY_WAITING: 'ALREADY_WAITING', // the same person is already in this tier's line
  EVENT_STARTED: 'EVENT_STARTED', // the event has begun: no new bookings or waitlist joins
});

// `extends Error` keeps everything a normal error has: message, stack trace,
// and `instanceof Error` checks.
export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message); // sets the human-readable message
    this.name = 'DomainError'; // shows up in stack traces and logs
    this.code = code; // machine-readable: code and the UI branch on this, never on the message text
    this.details = details; // extra facts, e.g. { requested: 3, available: 1 }
  }
}
