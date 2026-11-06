// inventory.js
// The business rules: events, ticket tiers, bookings, cancellations, waitlist.
// No React, no DOM, no printing. The terminal scripts, tests and the UI all
// call these same functions, so the rules live in exactly one place.
//
// Golden rule used everywhere below: VALIDATE FIRST, CHANGE STATE LAST.
// If anything is wrong we throw before touching the store, so a failed
// action leaves everything exactly as it was.

import { DomainError, ErrorCode } from './errors.js';
import { newId, newReference, referenceKey } from './ids.js';
import { isMoney } from './money.js';
import { Queue } from './waitlistQueue.js';

export const MIN_TICKETS = 1;
export const MAX_TICKETS_PER_BOOKING = 10; // business rule: 1 to 10 per booking

// ---------- validation helpers ----------

// Builds a VALIDATION error that names the field, e.g. "quantity: must be...".
const bad = (field, message) =>
  new DomainError(ErrorCode.VALIDATION, `${field}: ${message}`, { field });

// Input that is not an object (null, a number, text...) counts as "no fields", so the answer is a clean
// VALIDATION error. A default of `= {}` is NOT enough: it only covers `undefined`, and `null` is valid JSON,
// so a request body of `null` used to crash with a TypeError (which the web server would turn into a 500).
const asObject = (input) => (input !== null && typeof input === 'object' ? input : {});

// Must be a non-empty string. Returns the trimmed text so " Ada " is stored as "Ada".
function text(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw bad(field, 'is required');
  return value.trim();
}

// An id must be present and be text, not blank. (A MISSING id is the caller's mistake: VALIDATION.
// An id that is present but unknown is NOT_FOUND, decided later by the lookup.) Ids are not trimmed.
function id(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw bad(field, 'is required'); // blank counts as missing
  return value;
}

// Must be a whole number inside [min, max]. Number.isSafeInteger rejects 1.5, NaN,
// Infinity and "2" (a string), so bad input can't sneak in as a number-like value.
function whole(value, field, min, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw bad(field, `must be a whole number from ${min} to ${max}`);
  }
  return value;
}

// The 1 to 10 rule, shared by booking and waitlist.
const quantityOf = (q) => whole(q, 'quantity', MIN_TICKETS, MAX_TICKETS_PER_BOOKING);

// "Ada  Obi" and "ada obi" are the same person for the "already waiting" rule.
// (Build 1 has no accounts, so a name is the only identity we have.)
const nameKey = (name) => name.toLowerCase().replace(/\s+/g, ' ');

// ---------- the store ----------

// The real data lives in this WeakMap, hidden INSIDE this module.
// The "store" that callers hold is just an empty, frozen token that points to it.
// So nobody (not the UI, not the tests) can reach in and edit the data: they must use the
// functions below, which enforce the rules. A WeakMap also lets the data be garbage-collected
// when the token is no longer used.
const STATE = new WeakMap();

// `now` is the clock. It defaults to the real time, but tests can pass a fake one
// to travel past an event's start time without waiting.
export function createStore(options) {
  const { now = () => Date.now() } = asObject(options);
  if (typeof now !== 'function') throw bad('now', 'must be a function that returns milliseconds');
  const store = Object.freeze({}); // an opaque token: it has no properties to poke at
  STATE.set(store, {
    now,
    events: new Map(), // eventId -> event
    tiers: new Map(), // tierId -> tier (seats live here: capacity and sold)
    bookings: new Map(), // referenceKey -> booking: THIS is the O(1) lookup by code
    waitlists: new Map(), // tierId -> Queue of waiting people (one line per tier)
  });
  return store;
}

// Turns the token back into the hidden data, or throws if someone passes something else.
function stateOf(store) {
  const state = STATE.get(store);
  if (!state) throw bad('store', 'is not a store made by createStore()');
  return state;
}

// Seats still free in a tier.
const seatsLeft = (tier) => tier.capacity - tier.sold;

// Look things up or throw NOT_FOUND, so every function below can assume they exist.
function getEvent(state, eventId) {
  const event = state.events.get(eventId);
  if (!event) throw new DomainError(ErrorCode.NOT_FOUND, `Event not found`, { eventId });
  return event;
}

// Also checks the tier belongs to the event, so you can't book a tier of event A under event B.
function getTier(state, eventId, tierId) {
  const tier = state.tiers.get(tierId);
  if (!tier || tier.eventId !== eventId) {
    throw new DomainError(ErrorCode.NOT_FOUND, `Ticket tier not found`, { eventId, tierId });
  }
  return tier;
}

// Has the event already begun? Date.parse turns the ISO text into milliseconds, the same unit as the clock.
const hasStarted = (state, event) => Date.parse(event.startsAt) <= state.now();

// A copy of an event that is safe to hand out (the caller can't reach the stored tierIds list).
const view = (event) => ({ ...event, tierIds: [...event.tierIds] });

// The "no new bookings once the event has begun" rule. Cancelling a booking stays allowed.
function assertNotStarted(state, event) {
  if (hasStarted(state, event)) {
    throw new DomainError(ErrorCode.EVENT_STARTED, `${event.name} has already started`, { eventId: event.id });
  }
}

// ---------- events and tiers ----------

export function createEvent(store, input) {
  const state = stateOf(store);
  // `input` may be missing or not an object (createEvent(store), createEvent(store, null)).
  // Treat that as "no fields", so the answer is a VALIDATION error instead of a crash.
  const data = input !== null && typeof input === 'object' ? input : {};

  // Every field is checked BEFORE anything is saved: a rejected request saves nothing.
  const event = {
    id: newId(),
    name: text(data.name, 'name'),
    venue: text(data.venue, 'venue'),
    startsAt: text(data.startsAt, 'startsAt'),
    tierIds: [], // filled by addTier, keeps tiers in the order they were added
  };
  if (Number.isNaN(Date.parse(event.startsAt))) throw bad('startsAt', 'must be a valid date');

  state.events.set(event.id, event);
  // Return a COPY: the caller can't reach into the store and change the original.
  return view(event);
}

export function addTier(store, eventId, input) {
  const state = stateOf(store);
  getEvent(state, eventId); // the event must exist
  const { name, priceCents, capacity } = asObject(input);
  const clean = { name: text(name, 'name'), capacity: whole(capacity, 'capacity', 1) };
  if (!isMoney(priceCents)) throw bad('priceCents', 'must be a whole number of cents, 0 or more');

  const tier = { id: newId(), eventId, ...clean, priceCents, sold: 0 };
  state.tiers.set(tier.id, tier);
  state.waitlists.set(tier.id, new Queue()); // every tier starts with an empty waiting line
  state.events.get(eventId).tierIds.push(tier.id);
  return { ...tier }; // a copy, for the same reason as createEvent
}

// ---------- bookings ----------

// INTERNAL: the one place a booking is actually created. It assumes every rule was already checked
// by the caller (bookTickets or takeNextFromWaitlist), so it just changes state.
function createBooking(state, tier, qty, name) {
  // Codes are random, so a clash is very unlikely, but the loop makes it impossible.
  let reference = newReference();
  while (state.bookings.has(referenceKey(reference))) reference = newReference();

  // Object.freeze: nobody holding this booking can edit it (a write throws in strict mode).
  // The only way a booking changes is cancelBooking, which stores a NEW frozen object.
  const booking = Object.freeze({
    id: newId(),
    reference,
    eventId: tier.eventId,
    tierId: tier.id,
    quantity: qty,
    customer: name,
    totalCents: tier.priceCents * qty, // integer x integer = integer, no rounding
    status: 'CONFIRMED',
    createdAt: new Date(state.now()).toISOString(),
  });
  tier.sold += qty; // take the seats
  state.bookings.set(referenceKey(reference), booking); // index it for O(1) lookup
  return booking;
}

export function bookTickets(store, input) {
  const state = stateOf(store);
  const { eventId, tierId, quantity, customer } = asObject(input);
  // 1. Validate everything first. Any throw here leaves the store untouched.
  const tier = getTier(state, id(eventId, 'eventId'), id(tierId, 'tierId'));
  const qty = quantityOf(quantity);
  const name = text(customer, 'customer');
  assertNotStarted(state, state.events.get(tier.eventId));

  // 2. The capacity rule: never sell more seats than exist.
  const available = seatsLeft(tier);
  if (qty > available) {
    throw new DomainError(
      ErrorCode.SOLD_OUT,
      `Only ${available} left in ${tier.name}, you asked for ${qty}`,
      { tierId, requested: qty, available },
    );
  }

  // 3. The fairness rule: if people are already waiting, seats belong to them first.
  // Without this, a stranger could grab freed seats before the person who waited longest.
  // (takeNextFromWaitlist is the only way past this check, and it serves the front of the line.)
  const waiting = state.waitlists.get(tier.id).size;
  if (waiting > 0) {
    throw new DomainError(
      ErrorCode.WAITLIST_FIRST,
      `${waiting} ${waiting === 1 ? 'person is' : 'people are'} already waiting for ${tier.name}. Join the waitlist`,
      { tierId, waiting },
    );
  }

  return createBooking(state, tier, qty, name);
}

// Find a booking from the code on a customer's ticket. O(1): one Map.get, no scanning.
export function findBookingByReference(store, reference) {
  const state = stateOf(store);
  if (typeof reference !== 'string' || reference.trim() === '') {
    throw bad('reference', 'is required');
  }
  const booking = state.bookings.get(referenceKey(reference));
  if (!booking) throw new DomainError(ErrorCode.NOT_FOUND, `No booking with that reference`, { reference });
  return booking;
}

export function cancelBooking(store, reference) {
  const state = stateOf(store);
  const booking = findBookingByReference(store, reference); // throws NOT_FOUND if unknown
  if (booking.status === 'CANCELLED') {
    // Refusing a second cancel matters: otherwise seats would be released twice
    // and the tier would appear to have more seats than it really has.
    throw new DomainError(ErrorCode.ALREADY_CANCELLED, `Booking ${booking.reference} is already cancelled`, {
      reference: booking.reference,
    });
  }
  const tier = state.tiers.get(booking.tierId);
  tier.sold -= booking.quantity; // release the seats
  // Keep the record (for support and history) but replace it with a cancelled, frozen copy.
  const cancelled = Object.freeze({ ...booking, status: 'CANCELLED', cancelledAt: new Date(state.now()).toISOString() });
  state.bookings.set(referenceKey(booking.reference), cancelled);

  // Name the next person waiting. peek() does not remove them from the line.
  const nextInLine = state.waitlists.get(tier.id).peek() ?? null;
  return {
    booking: cancelled,
    seatsLeft: seatsLeft(tier),
    nextInLine,
    // Can the freed seats cover the first person's whole party? (UI uses this to enable "Book them".)
    nextCanBeServed: nextInLine ? nextInLine.quantity <= seatsLeft(tier) : false,
  };
}

// ---------- waitlist ----------

export function joinWaitlist(store, input) {
  const state = stateOf(store);
  const { eventId, tierId, quantity, customer } = asObject(input);
  const tier = getTier(state, id(eventId, 'eventId'), id(tierId, 'tierId'));
  const qty = quantityOf(quantity);
  const name = text(customer, 'customer');
  assertNotStarted(state, state.events.get(tier.eventId));

  const queue = state.waitlists.get(tier.id);
  // Joining makes sense when you cannot be booked right now: either not enough seats,
  // or other people are already ahead of you (even if seats exist, they get them first).
  if (qty <= seatsLeft(tier) && queue.size === 0) {
    throw new DomainError(ErrorCode.SEATS_AVAILABLE, `${tier.name} has seats, book directly`, { tierId });
  }
  // One place in line per person. Queue is O(n) to scan; waitlists are short, so this is fine.
  if ([...queue].some((e) => nameKey(e.customer) === nameKey(name))) {
    throw new DomainError(ErrorCode.ALREADY_WAITING, `${name} is already on the ${tier.name} waitlist`, { tierId });
  }
  const entry = Object.freeze({ id: newId(), eventId: tier.eventId, tierId: tier.id, quantity: qty, customer: name, joinedAt: new Date(state.now()).toISOString() });
  const position = queue.enqueue(entry); // O(1); returns the place in line
  return { entry, position };
}

// Someone gives up their place. Everyone behind them moves up one.
export function leaveWaitlist(store, input) {
  const state = stateOf(store);
  const { tierId, entryId } = asObject(input);
  const queue = state.waitlists.get(id(tierId, 'tierId'));
  const wanted = id(entryId, 'entryId'); // checked HERE: inside the callback below it would never run on an empty line
  if (!queue) throw new DomainError(ErrorCode.NOT_FOUND, 'Ticket tier not found', { tierId });
  const removed = queue.remove((e) => e.id === wanted); // O(n): walks the line to find them
  if (!removed) throw new DomainError(ErrorCode.NOT_FOUND, 'That person is not on the waitlist', { tierId, entryId });
  return { removed, nextInLine: queue.peek() ?? null };
}

// Books the person at the FRONT of the line, if their whole party fits.
// Strictly first-in-first-out: if the first person needs 2 seats and only 1 is free,
// we do NOT skip to someone behind them who needs 1. We throw and change nothing.
export function takeNextFromWaitlist(store, tierId) {
  const state = stateOf(store);
  const tier = state.tiers.get(tierId);
  if (!tier) throw new DomainError(ErrorCode.NOT_FOUND, 'Ticket tier not found', { tierId });
  assertNotStarted(state, state.events.get(tier.eventId));
  const queue = state.waitlists.get(tierId);
  const head = queue.peek();
  if (!head) throw new DomainError(ErrorCode.NOT_FOUND, 'Nobody is on the waitlist', { tierId });
  if (head.quantity > seatsLeft(tier)) {
    throw new DomainError(ErrorCode.SOLD_OUT, `${head.customer} needs ${head.quantity}, only ${seatsLeft(tier)} left`, {
      tierId,
      requested: head.quantity,
      available: seatsLeft(tier),
    });
  }
  // Book first, dequeue second: if booking threw, the person would stay in line.
  // createBooking (not bookTickets) because the "waitlist first" check must not block the waitlist itself.
  const booking = createBooking(state, tier, head.quantity, head.customer);
  queue.dequeue();
  return booking;
}

// ---------- read helpers (used by the UI and tests) ----------

// Plain-data snapshot for rendering: each event with its tiers, plus seatsLeft, waitlistSize and `started`.
// It copies with spread ({...}) so callers can't mutate the store through it.
// One event with its tiers filled in, as plain data the caller may keep or change freely (it is all copies).
// `tierIds` (an internal bookkeeping list) is left out: the tiers themselves are what a reader wants.
function detailsOf(state, event) {
  const { tierIds, ...rest } = event;
  return {
    ...rest,
    started: hasStarted(state, event),
    tiers: tierIds.map((id) => {
      const tier = state.tiers.get(id);
      return { ...tier, seatsLeft: seatsLeft(tier), waitlistSize: state.waitlists.get(id).size };
    }),
  };
}

// Every event (drafts included) with its tiers. Used by the React screen.
export function listEvents(store) {
  const state = stateOf(store);
  return [...state.events.values()].map((event) => detailsOf(state, event));
}

// The waiting line as an array, front first. O(n): fine for display.
export const listWaitlist = (store, tierId) => [...(stateOf(store).waitlists.get(tierId) ?? [])];

// Every booking (confirmed and cancelled), optionally for one event. They are frozen, so safe to hand out.
export function listBookings(store, options) {
  const { eventId } = asObject(options);
  const all = [...stateOf(store).bookings.values()];
  return eventId ? all.filter((b) => b.eventId === eventId) : all;
}
