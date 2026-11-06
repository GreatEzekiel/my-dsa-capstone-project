// eventService.js
// The "events" use cases: create an event, add tiers, publish it, look it up, search for it.
//
// A service sits BETWEEN the web routes and the domain. It knows nothing about HTTP (no request, no response,
// no status codes). It receives plain values, calls the rules and the data, and returns plain values.
// The routes decide how to say it in HTTP; the domain decides what is allowed.

import { DomainError, ErrorCode } from '../domain/errors.js';
import { searchEvents } from '../domain/eventSearch.js';
import {
  addTier, createEvent, getEventDetails, listEventSummaries, publishEvent, unpublishEvent,
} from '../domain/inventory.js';

// The search options a client may send. Anything else is a mistake (probably a typo) and is refused,
// instead of being silently ignored: "?citty=Lagos" returning every event would be a nasty surprise.
const FILTERS = ['q', 'city', 'from', 'to', 'maxPriceCents', 'onlyAvailable'];
const SEARCH_KEYS = new Set([...FILTERS, 'sort']);

// Values arrive from a URL, so they are ALL text ("?maxPriceCents=500000" is the text "500000").
// An empty value ("?city=") means "not given", like an empty box in a form.
const given = (value) => (value === undefined || value === '' ? undefined : value);

// Digits only -> a number. Anything else is left as the text it was, and the rules refuse it with VALIDATION
// ("9.99", "-5", "abc", "1e3" are not whole numbers of cents).
const toWhole = (value) => (value !== undefined && /^\d+$/.test(value) ? Number(value) : value);

// "true" / "false" -> a boolean. Anything else is left as text, and the rules refuse it.
const toBoolean = (value) => (value === 'true' ? true : value === 'false' ? false : value);

/**
 * Turns the text values of a query string into the criteria the search rules understand.
 * It only converts types. Whether a value is VALID (a real date, a whole price) is the rules' decision.
 */
export function queryToCriteria(params = {}) {
  for (const key of Object.keys(params)) {
    if (!SEARCH_KEYS.has(key)) {
      throw new DomainError(ErrorCode.VALIDATION, `${key}: is not a search option. Use: ${[...SEARCH_KEYS].join(', ')}`, { field: key });
    }
  }
  return {
    criteria: {
      q: given(params.q),
      city: given(params.city),
      from: given(params.from),
      to: given(params.to),
      maxPriceCents: toWhole(given(params.maxPriceCents)),
      onlyAvailable: toBoolean(given(params.onlyAvailable)),
    },
    sort: given(params.sort) ?? 'date',
  };
}

export function createEventService({ store }) {
  return Object.freeze({
    /** Creates a DRAFT event. Returns it with its (empty) list of tiers. */
    create(input) {
      const event = createEvent(store, input);
      return getEventDetails(store, event.id);
    },

    /** One event with its tiers. Drafts can be read by id too: they are hidden from the LIST, not secret. */
    get(eventId) {
      return getEventDetails(store, eventId);
    },

    /** Adds a ticket tier. Returns the tier (0 sold, all seats left). */
    addTier(eventId, input) {
      return addTier(store, eventId, input);
    },

    /** Makes the event public. It needs at least one tier. */
    publish(eventId) {
      publishEvent(store, eventId);
      return getEventDetails(store, eventId);
    },

    /** Takes the event off the public list (existing bookings are kept). */
    unpublish(eventId) {
      unpublishEvent(store, eventId);
      return getEventDetails(store, eventId);
    },

    /** Searches the PUBLISHED events. `params` are the raw text values of a query string. */
    search(params) {
      const { criteria, sort } = queryToCriteria(params);
      const events = searchEvents(listEventSummaries(store), criteria, sort);
      return { count: events.length, events };
    },
  });
}
