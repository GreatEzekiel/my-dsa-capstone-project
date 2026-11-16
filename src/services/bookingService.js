import { assertTransition, BookingState } from '../domain/bookingStateMachine.js';
import { parseWhen } from '../domain/dates.js';
import { DomainError, ErrorCode } from '../domain/errors.js';
import { newId, newReference, referenceKey } from '../domain/ids.js';
import { MAX_TICKETS_PER_BOOKING } from '../domain/ticketLimits.js';

const bad = (field, message) => new DomainError(ErrorCode.VALIDATION, `${field}: ${message}`, { field });
const asObject = (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {});

function text(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw bad(field, 'is required');
  return value.trim();
}

function requiredUserId(value) {
  return text(value, 'x-user-id');
}

function requiredId(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw bad(field, 'is required');
  return value;
}

function notFound() {
  return new DomainError(ErrorCode.NOT_FOUND, 'Booking not found');
}

function publicBooking(booking) {
  const { userId, ...visible } = booking;
  return visible;
}

function updatedBooking(booking, status, now) {
  const at = new Date(now()).toISOString();
  return {
    ...booking,
    status,
    ...(status === BookingState.CANCELLED ? { cancelledAt: at } : {}),
    history: [...booking.history, { status, at }],
  };
}

export function createBookingService({ repository, paymentGateway, now = () => Date.now() }) {
  if (!repository) throw new TypeError('createBookingService needs a repository');
  if (!paymentGateway || typeof paymentGateway.charge !== 'function') {
    throw new TypeError('createBookingService needs a payment gateway');
  }

  async function bookingFor(reference) {
    if (typeof reference !== 'string' || reference.trim() === '') throw bad('reference', 'is required');
    const booking = await repository.getBookingByReference(reference);
    if (!booking) throw notFound();
    return booking;
  }

  function assertOwner(booking, userId) {
    if (booking.userId !== userId) throw notFound();
  }

  async function transition(booking, to) {
    assertTransition(booking.status, to);
    const changed = await repository.transitionBooking(
      booking.reference,
      booking.status,
      updatedBooking(booking, to, now),
    );
    if (changed) return changed;

    const current = await bookingFor(booking.reference);
    assertTransition(current.status, to);
    throw new DomainError(ErrorCode.INVALID_STATE, 'The booking changed before this request completed');
  }

  return Object.freeze({
    async book(input, rawUserId) {
      const userId = requiredUserId(rawUserId);
      const data = asObject(input);
      const eventId = requiredId(data.eventId, 'eventId');
      const tierId = requiredId(data.tierId, 'tierId');
      const customer = text(data.customer, 'customer');
      const quantity = data.quantity;
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_TICKETS_PER_BOOKING) {
        throw bad('quantity', `must be a whole number from 1 to ${MAX_TICKETS_PER_BOOKING}`);
      }

      const event = await repository.getEvent(eventId);
      if (!event) throw new DomainError(ErrorCode.NOT_FOUND, 'Event not found', { eventId });
      const tier = await repository.getTier(tierId);
      if (!tier || tier.eventId !== eventId) {
        throw new DomainError(ErrorCode.NOT_FOUND, 'Ticket tier not found', { eventId, tierId });
      }
      if (event.status !== 'published') {
        throw new DomainError(ErrorCode.INVALID_STATE, `${event.title} is not published`, { eventId, status: event.status });
      }
      if (parseWhen(event.startsAt, 'startsAt') <= now()) {
        throw new DomainError(ErrorCode.EVENT_STARTED, `${event.title} has already started`, { eventId });
      }

      const waiting = await repository.listWaitlistForTier(tierId);
      if (waiting.length > 0) {
        throw new DomainError(ErrorCode.WAITLIST_FIRST, `${waiting.length} ${waiting.length === 1 ? 'person is' : 'people are'} already waiting for ${tier.name}. Join the waitlist`, {
          tierId,
          waiting: waiting.length,
        });
      }

      const available = tier.capacity - tier.sold;
      if (quantity > available) {
        throw new DomainError(ErrorCode.SOLD_OUT, `Only ${available} left in ${tier.name}, you asked for ${quantity}`, {
          tierId, requested: quantity, available,
        });
      }

      const at = new Date(now()).toISOString();
      const booking = {
        id: newId(),
        reference: newReference(),
        eventId,
        tierId,
        quantity,
        customer,
        userId,
        totalCents: tier.priceCents * quantity,
        status: BookingState.PENDING,
        createdAt: at,
        history: [{ status: BookingState.PENDING, at }],
      };
      const created = await repository.createBooking(booking);
      if (!created) {
        const latestWaitlist = await repository.listWaitlistForTier(tierId);
        if (latestWaitlist.length > 0) {
          throw new DomainError(ErrorCode.WAITLIST_FIRST, `${latestWaitlist.length} ${latestWaitlist.length === 1 ? 'person is' : 'people are'} already waiting for ${tier.name}. Join the waitlist`, {
            tierId,
            waiting: latestWaitlist.length,
          });
        }
        const latestTier = await repository.getTier(tierId);
        const seatsLeft = latestTier ? latestTier.capacity - latestTier.sold : 0;
        throw new DomainError(ErrorCode.SOLD_OUT, `Only ${seatsLeft} left in ${tier.name}, you asked for ${quantity}`, {
          tierId, requested: quantity, available: seatsLeft,
        });
      }
      return publicBooking(created);
    },

    async get(reference) {
      return publicBooking(await bookingFor(reference));
    },

    async pay(reference, rawUserId, input) {
      const userId = requiredUserId(rawUserId);
      if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) {
        throw bad('body', 'must be an object');
      }
      const data = asObject(input);
      for (const key of Object.keys(data)) {
        if (key !== 'mockResult') throw bad(key, 'is not accepted by the mock payment API');
      }
      const mockResult = Object.hasOwn(data, 'mockResult') ? data.mockResult : 'success';
      if (!['success', 'declined'].includes(mockResult)) {
        throw bad('mockResult', 'must be success or declined');
      }

      const booking = await bookingFor(reference);
      assertOwner(booking, userId);
      assertTransition(booking.status, BookingState.PAID);

      const payment = await paymentGateway.charge({
        bookingId: booking.id,
        decline: mockResult === 'declined',
      });
      if (payment.status === 'declined') {
        throw new DomainError(ErrorCode.PAYMENT_DECLINED, 'The mock payment was declined. The booking is still pending');
      }
      if (payment.status !== 'succeeded') throw new Error('The payment gateway returned an unknown result');

      return publicBooking(await transition(booking, BookingState.PAID));
    },

    async cancel(reference, rawUserId) {
      const userId = requiredUserId(rawUserId);
      const booking = await bookingFor(reference);
      assertOwner(booking, userId);
      if (booking.status === BookingState.CANCELLED) {
        throw new DomainError(ErrorCode.ALREADY_CANCELLED, `Booking ${booking.reference} is already cancelled`, { reference: booking.reference });
      }
      if (booking.status !== BookingState.PENDING) {
        throw new DomainError(ErrorCode.INVALID_TRANSITION, 'Only pending bookings can be cancelled in this build', {
          from: booking.status, to: BookingState.CANCELLED,
        });
      }

      const cancelled = await transition(booking, BookingState.CANCELLED);
      const tier = await repository.getTier(cancelled.tierId);
      if (!tier) throw new Error(`Booking ${cancelled.reference} has no ticket tier`);
      return { booking: publicBooking(cancelled), seatsLeft: tier.capacity - tier.sold };
    },

    async transition(reference, to) {
      if (typeof to !== 'string' || to === '') {
        throw bad('to', 'is required (one of pending, paid, cancelled, refunded, checked_in)');
      }
      return publicBooking(await transition(await bookingFor(reference), to));
    },
  });
}
