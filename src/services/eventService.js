import { DomainError, ErrorCode } from '../domain/errors.js';
import { parseWhen } from '../domain/dates.js';
import { searchEvents } from '../domain/eventSearch.js';
import { EventStatus } from '../domain/eventStatus.js';
import { newId } from '../domain/ids.js';
import { isMoney } from '../domain/money.js';
import { MAX_PRICE_CENTS } from '../domain/ticketLimits.js';

const FILTERS = ['q', 'city', 'from', 'to', 'maxPriceCents', 'onlyAvailable'];
const SEARCH_KEYS = new Set([...FILTERS, 'sort']);
const bad = (field, message) => new DomainError(ErrorCode.VALIDATION, `${field}: ${message}`, { field });
const asObject = (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {});

function text(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw bad(field, 'is required');
  return value.trim();
}

function id(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw bad(field, 'is required');
  return value;
}

function requireEvent(event) {
  if (!event) throw new DomainError(ErrorCode.NOT_FOUND, 'Event not found');
  return event;
}

function toWhole(value) {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : value;
}

const given = (value) => (value === undefined || value === '' ? undefined : value);
const toBoolean = (value) => (value === 'true' ? true : value === 'false' ? false : value);

export function queryToCriteria(params = {}) {
  for (const key of Object.keys(params)) {
    if (!SEARCH_KEYS.has(key)) {
      throw bad(key, `is not a search option. Use: ${[...SEARCH_KEYS].join(', ')}`);
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

export function createEventService({ repository, now = () => Date.now() }) {
  if (!repository) throw new TypeError('createEventService needs a repository');

  async function details(event) {
    const tiers = await Promise.all((await repository.listTiersForEvent(event.id)).map(async (tier) => ({
      ...tier,
      seatsLeft: tier.capacity - tier.sold,
      waitlistSize: (await repository.listWaitlistForTier(tier.id)).length,
    })));
    return {
      ...event,
      started: parseWhen(event.startsAt, 'startsAt') <= now(),
      tiers,
    };
  }

  return Object.freeze({
    async create(input) {
      const data = asObject(input);
      const event = {
        id: newId(),
        title: text(data.title ?? data.name, 'title'),
        city: text(data.city, 'city'),
        venue: text(data.venue, 'venue'),
        startsAt: text(data.startsAt ?? data.date, 'startsAt'),
        status: EventStatus.DRAFT,
      };
      parseWhen(event.startsAt, 'startsAt');
      return details(await repository.createEvent(event));
    },

    async get(eventId) {
      return details(requireEvent(await repository.getEvent(id(eventId, 'eventId'))));
    },

    async addTier(eventId, input) {
      const event = requireEvent(await repository.getEvent(id(eventId, 'eventId')));
      const data = asObject(input);
      const name = text(data.name, 'name');
      if (!isMoney(data.priceCents) || data.priceCents > MAX_PRICE_CENTS) {
        throw bad('priceCents', `must be a whole number of cents from 0 to ${MAX_PRICE_CENTS}`);
      }
      if (!Number.isSafeInteger(data.capacity) || data.capacity < 1) {
        throw bad('capacity', 'must be a whole number of 1 or more');
      }
      const tier = await repository.createTier({
        id: newId(),
        eventId: event.id,
        name,
        priceCents: data.priceCents,
        capacity: data.capacity,
        sold: 0,
      });
      return { ...tier, seatsLeft: tier.capacity, waitlistSize: 0 };
    },

    async publish(eventId) {
      const event = requireEvent(await repository.getEvent(id(eventId, 'eventId')));
      if ((await repository.listTiersForEvent(event.id)).length === 0) {
        throw new DomainError(ErrorCode.INVALID_STATE, `Add at least one ticket tier to ${event.title} before publishing`, { eventId });
      }
      return details(await repository.saveEvent({ ...event, status: EventStatus.PUBLISHED }));
    },

    async unpublish(eventId) {
      const event = requireEvent(await repository.getEvent(id(eventId, 'eventId')));
      return details(await repository.saveEvent({ ...event, status: EventStatus.DRAFT }));
    },

    async search(params) {
      const { criteria, sort } = queryToCriteria(params);
      const published = (await repository.listEvents()).filter((event) => event.status === EventStatus.PUBLISHED);
      const summaries = await Promise.all(published.map(async (event) => {
        const tiers = await repository.listTiersForEvent(event.id);
        return {
          id: event.id,
          title: event.title,
          city: event.city,
          venue: event.venue,
          startsAt: event.startsAt,
          status: event.status,
          tierCount: tiers.length,
          minPriceCents: tiers.length ? Math.min(...tiers.map((tier) => tier.priceCents)) : null,
          seatsLeft: tiers.reduce((sum, tier) => sum + tier.capacity - tier.sold, 0),
        };
      }));
      const events = searchEvents(summaries, criteria, sort);
      return { count: events.length, events };
    },
  });
}
