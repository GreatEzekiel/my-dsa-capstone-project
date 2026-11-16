import { BookingState } from '../domain/bookingStateMachine.js';
import { parseWhen } from '../domain/dates.js';
import { DomainError, ErrorCode } from '../domain/errors.js';
import { newId, newReference } from '../domain/ids.js';
import { normalizeWaitlistName } from '../domain/waitlistRules.js';
import { MAX_TICKETS_PER_BOOKING } from '../domain/ticketLimits.js';

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

function publicEntry(entry) {
  const { userId, ...visible } = entry;
  return visible;
}

export function createWaitlistService({ repository, now = () => Date.now() }) {
  if (!repository) throw new TypeError('createWaitlistService needs a repository');

  async function getTier(eventId, tierId) {
    const event = await repository.getEvent(eventId);
    if (!event) throw new DomainError(ErrorCode.NOT_FOUND, 'Event not found', { eventId });
    const tier = await repository.getTier(tierId);
    if (!tier || tier.eventId !== eventId) {
      throw new DomainError(ErrorCode.NOT_FOUND, 'Ticket tier not found', { eventId, tierId });
    }
    return { event, tier };
  }

  function assertBookable(event) {
    if (event.status !== 'published') {
      throw new DomainError(ErrorCode.INVALID_STATE, `${event.title} is not published`, { eventId: event.id, status: event.status });
    }
    if (parseWhen(event.startsAt, 'startsAt') <= now()) {
      throw new DomainError(ErrorCode.EVENT_STARTED, `${event.title} has already started`, { eventId: event.id });
    }
  }

  return Object.freeze({
    async listForEvent(rawEventId, rawUserId) {
      const eventId = id(rawEventId, 'eventId');
      if (!await repository.getEvent(eventId)) {
        throw new DomainError(ErrorCode.NOT_FOUND, 'Event not found', { eventId });
      }
      const userId = typeof rawUserId === 'string' ? rawUserId : '';
      const tiers = await repository.listTiersForEvent(eventId);
      const waitlists = await Promise.all(tiers.map(async (tier) => ({
        tierId: tier.id,
        entries: (await repository.listWaitlistForTier(tier.id)).map((entry, index) => ({
          ...publicEntry(entry),
          position: index + 1,
          isMine: entry.userId === userId,
        })),
      })));
      return { waitlists };
    },

    async join(rawEventId, rawTierId, input, rawUserId) {
      const eventId = id(rawEventId, 'eventId');
      const tierId = id(rawTierId, 'tierId');
      const userId = text(rawUserId, 'x-user-id');
      const data = asObject(input);
      const customer = text(data.customer, 'customer');
      const quantity = data.quantity;
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_TICKETS_PER_BOOKING) {
        throw bad('quantity', `must be a whole number from 1 to ${MAX_TICKETS_PER_BOOKING}`);
      }

      const { event, tier } = await getTier(eventId, tierId);
      assertBookable(event);
      const current = await repository.listWaitlistForTier(tierId);
      if (quantity <= tier.capacity - tier.sold && current.length === 0) {
        throw new DomainError(ErrorCode.SEATS_AVAILABLE, `${tier.name} has seats, book directly`, { tierId });
      }

      const customerKey = normalizeWaitlistName(customer);
      if (current.some((entry) => normalizeWaitlistName(entry.customer) === customerKey)) {
        throw new DomainError(ErrorCode.ALREADY_WAITING, `${customer} is already on the ${tier.name} waitlist`, { tierId });
      }

      const entry = {
        id: newId(),
        eventId,
        tierId,
        userId,
        quantity,
        customer,
        joinedAt: new Date(now()).toISOString(),
      };
      const created = await repository.createWaitlistEntry(entry, customerKey);
      if (!created) {
        throw new DomainError(ErrorCode.ALREADY_WAITING, `${customer} is already on the ${tier.name} waitlist`, { tierId });
      }
      const queue = await repository.listWaitlistForTier(tierId);
      return {
        entry: publicEntry(created),
        position: queue.findIndex((waiting) => waiting.id === created.id) + 1,
      };
    },

    async leave(rawEventId, rawTierId, rawEntryId, rawUserId) {
      const eventId = id(rawEventId, 'eventId');
      const tierId = id(rawTierId, 'tierId');
      const entryId = id(rawEntryId, 'entryId');
      const userId = text(rawUserId, 'x-user-id');
      await getTier(eventId, tierId);

      const result = await repository.removeWaitlistEntry(tierId, entryId, userId);
      if (!result) throw new DomainError(ErrorCode.NOT_FOUND, 'Waitlist entry not found');
      return {
        removed: publicEntry(result.removed),
        nextInLine: result.nextInLine ? publicEntry(result.nextInLine) : null,
      };
    },

    async bookNext(rawEventId, rawTierId, rawUserId) {
      const eventId = id(rawEventId, 'eventId');
      const tierId = id(rawTierId, 'tierId');
      const userId = text(rawUserId, 'x-user-id');
      const { event, tier } = await getTier(eventId, tierId);
      assertBookable(event);
      const queue = await repository.listWaitlistForTier(tierId);
      const head = queue[0];
      if (!head) throw new DomainError(ErrorCode.NOT_FOUND, 'Nobody is on the waitlist', { tierId });
      if (head.userId !== userId) {
        throw new DomainError(ErrorCode.NOT_FOUND, 'Waitlist entry not found', { tierId });
      }

      const available = tier.capacity - tier.sold;
      if (head.quantity > available) {
        throw new DomainError(ErrorCode.SOLD_OUT, `${head.customer} needs ${head.quantity}, only ${available} left`, {
          tierId,
          requested: head.quantity,
          available,
        });
      }

      const createdAt = new Date(now()).toISOString();
      const booking = {
        id: newId(),
        reference: newReference(),
        eventId,
        tierId,
        quantity: head.quantity,
        customer: head.customer,
        userId: head.userId,
        totalCents: tier.priceCents * head.quantity,
        status: BookingState.PENDING,
        createdAt,
        history: [{ status: BookingState.PENDING, at: createdAt }],
      };
      const result = await repository.promoteWaitlistEntry(tierId, head.id, booking);
      if (result.status === 'sold_out') {
        throw new DomainError(ErrorCode.SOLD_OUT, `${head.customer} needs ${head.quantity}, only 0 left`, {
          tierId,
          requested: head.quantity,
          available: 0,
        });
      }
      if (result.status !== 'created') {
        throw new DomainError(ErrorCode.INVALID_STATE, 'The waitlist changed before the next booking was created');
      }
      return publicEntry(result.booking);
    },
  });
}
