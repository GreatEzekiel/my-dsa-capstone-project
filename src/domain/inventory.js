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
import { parseWhen } from './dates.js';
import { BookingState, assertTransition, holdsSeats } from './bookingStateMachine.js';
import { EventStatus } from './eventStatus.js';
import { isMoney } from './money.js';
import { Queue } from './waitlistQueue.js';

export const MIN_TICKETS = 1;
export const MAX_TICKETS_PER_BOOKING = 10; // business rule: 1 to 10 per booking
// The biggest price we accept. A booking total is price x quantity, and JavaScript numbers are only
// exact up to Number.MAX_SAFE_INTEGER, so the price must be small enough that price x 10 stays exact.
export const MAX_PRICE_CENTS = Math.floor(Number.MAX_SAFE_INTEGER / MAX_TICKETS_PER_BOOKING);

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

// Has the event already begun? parseWhen turns the ISO text into milliseconds, the same unit as the clock.
const hasStarted = (state, event) => parseWhen(event.startsAt, 'startsAt') <= state.now();

// A copy of an event that is safe to hand out (the caller can't reach the stored tierIds list).
const view = (event) => ({ ...event, tierIds: [...event.tierIds] });

// "Can people still book this event?" Two rules, both about the event's state:
//   1. it must be PUBLISHED (a draft is not public, so nobody can book it), and
//   2. it must not have started yet.
// Cancelling a booking is deliberately NOT checked here: it stays allowed.
function assertBookable(state, event) {
  if (event.status !== EventStatus.PUBLISHED) {
    throw new DomainError(ErrorCode.INVALID_STATE, `${event.title} is not published`, { eventId: event.id, status: event.status });
  }
  if (hasStarted(state, event)) {
    throw new DomainError(ErrorCode.EVENT_STARTED, `${event.title} has already started`, { eventId: event.id });
  }
}

// ---------- events and tiers ----------

export function createEvent(store, input) {
  const state = stateOf(store);
  // `input` may be missing or not an object (createEvent(store), createEvent(store, null)).
  // Treat that as "no fields", so the answer is a VALIDATION error instead of a crash.
  const data = input !== null && typeof input === 'object' ? input : {};

  // Every field is checked BEFORE anything is saved: a rejected request saves nothing.
  // The older names still work: `name` for title, `date` for startsAt (`??` = "if missing, use this").
  const event = {
    id: newId(),
    title: text(data.title ?? data.name, 'title'),
    city: text(data.city, 'city'),
    venue: text(data.venue, 'venue'),
    startsAt: text(data.startsAt ?? data.date, 'startsAt'),
    status: EventStatus.DRAFT, // new events are private until the organizer publishes them
    tierIds: [], // filled by addTier, keeps tiers in the order they were added
  };
  // Is it a REAL ISO date? (Date.parse alone would accept 30 February.) Throws VALIDATION if not.
  parseWhen(event.startsAt, 'startsAt');

  state.events.set(event.id, event);
  // Return a COPY: the caller can't reach into the store and change the original.
  return view(event);
}

export function addTier(store, eventId, input) {
  const state = stateOf(store);
  getEvent(state, eventId); // the event must exist
  const { name, priceCents, capacity } = asObject(input);
  const clean = { name: text(name, 'name'), capacity: whole(capacity, 'capacity', 1) };
  if (!isMoney(priceCents) || priceCents > MAX_PRICE_CENTS) {
    throw bad('priceCents', `must be a whole number of cents from 0 to ${MAX_PRICE_CENTS}`);
  }

  const tier = { id: newId(), eventId, ...clean, priceCents, sold: 0 };
  state.tiers.set(tier.id, tier);
  state.waitlists.set(tier.id, new Queue()); // every tier starts with an empty waiting line
  state.events.get(eventId).tierIds.push(tier.id);
  return { ...tier, seatsLeft: seatsLeft(tier) }; // a copy, for the same reason as createEvent
}

// ---------- publishing ----------

// Makes an event public. An event with no ticket tiers has nothing to sell, so it can't be published.
// Publishing an already published event is harmless: it just stays published.
export function publishEvent(store, eventId) {
  const state = stateOf(store);
  const event = getEvent(state, eventId);
  if (event.tierIds.length === 0) {
    throw new DomainError(ErrorCode.INVALID_STATE, `Add at least one ticket tier to ${event.title} before publishing`, { eventId });
  }
  event.status = EventStatus.PUBLISHED;
  return view(event);
}

// Takes an event off the public list. Existing bookings are kept; only NEW bookings and waitlist joins stop.
export function unpublishEvent(store, eventId) {
  const state = stateOf(store);
  const event = getEvent(state, eventId);
  event.status = EventStatus.DRAFT;
  return view(event);
}

// The small, flat objects the search functions work on: one per event, newest data every time.
// By default only PUBLISHED events are listed (drafts are private).
export function listEventSummaries(store, options) {
  const state = stateOf(store);
  const { publishedOnly = true } = asObject(options);
  if (typeof publishedOnly !== 'boolean') throw bad('publishedOnly', 'must be true or false');

  const summaries = [];
  for (const event of state.events.values()) {
    if (publishedOnly && event.status !== EventStatus.PUBLISHED) continue;
    const tiers = event.tierIds.map((id) => state.tiers.get(id));
    summaries.push({
      id: event.id,
      title: event.title,
      city: event.city,
      venue: event.venue,
      startsAt: event.startsAt,
      status: event.status,
      tierCount: tiers.length,
      // The cheapest tier's price, or null when there are no tiers (so "no price" is never mistaken for free).
      minPriceCents: tiers.length ? Math.min(...tiers.map((t) => t.priceCents)) : null,
      // Seats left across ALL tiers.
      seatsLeft: tiers.reduce((sum, t) => sum + seatsLeft(t), 0),
    });
  }
  return summaries;
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
    // pending: the seats are held, but the booking is not final yet (payment comes later).
    // From here on, every change of status goes through transitionBooking and the state machine.
    status: BookingState.PENDING,
    createdAt: new Date(state.now()).toISOString(),
    // A record of every status the booking has had, oldest first (an audit trail). Frozen, like everything else.
    history: Object.freeze([Object.freeze({ status: BookingState.PENDING, at: new Date(state.now()).toISOString() })]),
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
  assertBookable(state, state.events.get(tier.eventId));

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

/**
 * The ONE door through which a booking changes status (paid, cancelled, refunded, checked in...).
 * 1. Ask the state machine: is this move allowed? If not, throw INVALID_TRANSITION. Nothing has changed yet.
 * 2. Only then change the booking and, if the move gives seats back, release them.
 * Later builds (payment, refunds, check-in) call this; they never set `status` themselves.
 */
export function transitionBooking(store, reference, to) {
  const state = stateOf(store);
  const booking = findBookingByReference(store, reference); // NOT_FOUND if unknown
  assertTransition(booking.status, to); // INVALID_TRANSITION if the life cycle forbids it

  const tier = state.tiers.get(booking.tierId);
  const had = holdsSeats(booking.status);
  const will = holdsSeats(to);
  // Seats follow the status: leaving a seat-holding state for a non-holding one (cancelled, refunded) gives them back.
  if (had && !will) tier.sold -= booking.quantity;
  // The opposite move (taking seats back) would need a capacity check. No move in the table does that, so
  // this can't happen today. If someone adds such a move later, fail loudly instead of corrupting the seat count.
  if (!had && will) throw new Error('This move would need seats taken back: not implemented');

  const at = new Date(state.now()).toISOString();
  const updated = Object.freeze({
    ...booking, // a COPY of the old booking (the old one is frozen and stays as it was)
    status: to,
    ...(to === BookingState.CANCELLED ? { cancelledAt: at } : {}),
    history: Object.freeze([...booking.history, Object.freeze({ status: to, at })]),
  });
  state.bookings.set(referenceKey(booking.reference), updated);
  return updated;
}

export function cancelBooking(store, reference) {
  const state = stateOf(store);
  const booking = findBookingByReference(store, reference); // throws NOT_FOUND if unknown
  if (booking.status === BookingState.CANCELLED) {
    // Cancelling twice has its own friendly error (from Build 1). Every OTHER illegal cancel (a refunded
    // or checked-in booking) is refused by the state machine with INVALID_TRANSITION.
    throw new DomainError(ErrorCode.ALREADY_CANCELLED, `Booking ${booking.reference} is already cancelled`, {
      reference: booking.reference,
    });
  }
  const cancelled = transitionBooking(store, reference, BookingState.CANCELLED); // releases the seats

  const tier = state.tiers.get(cancelled.tierId);
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
  assertBookable(state, state.events.get(tier.eventId));

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
  assertBookable(state, state.events.get(tier.eventId));
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
