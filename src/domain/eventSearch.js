// eventSearch.js
// Searching, filtering and sorting a list of event SUMMARIES.
//
// These are PURE functions: events in, a NEW list out. They never change the list you give them,
// never read a store, and never print. That makes them easy to test and safe to call on every keystroke.
//
// A summary is the small object listEventSummaries() returns for each event:
//   { id, title, city, venue, startsAt, status, tierCount, minPriceCents, seatsLeft }
//   minPriceCents is the cheapest tier's price in whole cents, or null when the event has no tiers.

import { DomainError, ErrorCode } from './errors.js';
import { isDateOnly, parseWhen } from './dates.js';
import { compareIds, compareNumbers, compareText, mergeSort } from './sorting.js';

export const SORT_OPTIONS = Object.freeze(['date', 'price', 'availability']);

const bad = (field, message) => new DomainError(ErrorCode.VALIDATION, `${field}: ${message}`, { field });

// null and undefined both mean "the caller did not set this".
const isUnset = (v) => v === undefined || v === null;

// ---------- validating the criteria (BEFORE touching the list) ----------
// Bad input must fail even when the list is empty, so we check first and filter second.

function readCriteria(criteria) {
  const c = isUnset(criteria) ? {} : criteria;
  if (typeof c !== 'object' || Array.isArray(c)) throw bad('criteria', 'must be an object');
  const { q, city, from, to, maxPriceCents, onlyAvailable } = c;

  if (!isUnset(q) && typeof q !== 'string') throw bad('q', 'must be text');
  if (!isUnset(city) && typeof city !== 'string') throw bad('city', 'must be text');
  if (!isUnset(maxPriceCents) && !(Number.isSafeInteger(maxPriceCents) && maxPriceCents >= 0)) {
    throw bad('maxPriceCents', 'must be a whole number of cents, 0 or more');
  }
  if (!isUnset(onlyAvailable) && typeof onlyAvailable !== 'boolean') throw bad('onlyAvailable', 'must be true or false');

  return {
    // Trim and lower-case once here, instead of once per event inside the loop.
    q: isUnset(q) ? '' : q.trim().toLowerCase(),
    city: isUnset(city) ? '' : city.trim().toLowerCase(),
    // from: a date-only value means the START of that day.
    fromMs: isUnset(from) ? null : parseWhen(from, 'from'),
    // to: a date-only value means the END of that day, so an event at 5 PM that day is included.
    toMs: isUnset(to) ? null : parseWhen(to, 'to', { endOfDay: isDateOnly(to) }),
    maxPriceCents: isUnset(maxPriceCents) ? null : maxPriceCents,
    onlyAvailable: onlyAvailable === true,
  };
}

// An event whose date can't be read can't match a date filter (and sorts last by date).
function startMs(summary) {
  try {
    return parseWhen(summary.startsAt, 'startsAt');
  } catch {
    return NaN;
  }
}

// The cheapest price, or null when the event has no tiers (or a hand-made summary has no price).
const priceOf = (summary) => (Number.isFinite(summary.minPriceCents) ? summary.minPriceCents : null);

// ---------- filter ----------

/**
 * filterEvents(summaries, { q, city, from, to, maxPriceCents, onlyAvailable }) -> a NEW array.
 * Every criterion is optional. An event must pass ALL the criteria that were given.
 * The order of the events is kept, and the original list is not changed.
 */
export function filterEvents(summaries, criteria) {
  if (!Array.isArray(summaries)) throw bad('summaries', 'must be an array');
  const c = readCriteria(criteria);

  return summaries.filter((e) => {
    // q: a piece of the title OR the venue, ignoring case.
    if (c.q && !`${e.title ?? ''}`.toLowerCase().includes(c.q) && !`${e.venue ?? ''}`.toLowerCase().includes(c.q)) return false;

    // city: the WHOLE city name must match, ignoring case ("lagos" matches "Lagos", not "Lagos Island").
    if (c.city && `${e.city ?? ''}`.trim().toLowerCase() !== c.city) return false;

    // from / to: inclusive on both ends.
    if (c.fromMs !== null || c.toMs !== null) {
      const when = startMs(e);
      if (Number.isNaN(when)) return false;
      if (c.fromMs !== null && when < c.fromMs) return false;
      if (c.toMs !== null && when > c.toMs) return false;
    }

    // maxPriceCents: compares with the CHEAPEST tier. No tiers means no price, so the event is left out.
    if (c.maxPriceCents !== null) {
      const price = priceOf(e);
      if (price === null || price > c.maxPriceCents) return false;
    }

    // onlyAvailable: at least one seat left somewhere.
    if (c.onlyAvailable && !(e.seatsLeft > 0)) return false;

    return true;
  });
}

// ---------- sort ----------

// Every comparator ends with the same tie-breakers, so the final order is always fully decided:
// equal on the main key -> title (A to Z, ignoring case) -> id.
const byTitleThenId = (a, b) => compareText(a.title, b.title) || compareIds(a.id, b.id);

const COMPARATORS = {
  // Earliest first. Events with an unreadable date go last.
  date: (a, b) => {
    const x = startMs(a);
    const y = startMs(b);
    const xNaN = Number.isNaN(x);
    const yNaN = Number.isNaN(y);
    if (xNaN !== yNaN) return xNaN ? 1 : -1;
    return (xNaN ? 0 : compareNumbers(x, y)) || byTitleThenId(a, b);
  },

  // Cheapest first. Events with no price go LAST (they are not removed: only the price FILTER removes them).
  price: (a, b) => {
    const x = priceOf(a);
    const y = priceOf(b);
    if ((x === null) !== (y === null)) return x === null ? 1 : -1;
    return (x === null ? 0 : compareNumbers(x, y)) || byTitleThenId(a, b);
  },

  // Most seats left first: note the swapped arguments (b, a) to reverse the direction.
  availability: (a, b) => compareNumbers(b.seatsLeft ?? 0, a.seatsLeft ?? 0) || byTitleThenId(a, b),
};

/**
 * sortEvents(summaries, sortBy) -> a NEW array. sortBy is 'date', 'price' or 'availability'.
 * Uses our own mergeSort. The original list is not changed.
 */
export function sortEvents(summaries, sortBy) {
  if (!Array.isArray(summaries)) throw bad('summaries', 'must be an array');
  // Object.hasOwn avoids surprises like sortBy = 'toString', which exists on every object.
  if (typeof sortBy !== 'string' || !Object.hasOwn(COMPARATORS, sortBy)) {
    throw bad('sortBy', `must be one of: ${SORT_OPTIONS.join(', ')}`);
  }
  return mergeSort(summaries, COMPARATORS[sortBy]);
}

// ---------- both together ----------

/** searchEvents(summaries, criteria, sortBy = 'date') = filter first (fewer items to sort), then sort. */
export function searchEvents(summaries, criteria, sortBy = 'date') {
  return sortEvents(filterEvents(summaries, criteria), sortBy);
}
