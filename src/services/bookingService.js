// bookingService.js
// The "bookings" use cases: book tickets, look a booking up, cancel it.
// Like every service it knows nothing about HTTP; it only calls the rules and the data.

import { DomainError, ErrorCode } from '../domain/errors.js';
import { bookTickets, cancelBooking, findBookingByReference, transitionBooking } from '../domain/inventory.js';

export function createBookingService({ store }) {
  return Object.freeze({
    /** Books tickets: { eventId, tierId, quantity, customer }. The new booking starts as `pending`. */
    book(input) {
      return bookTickets(store, input);
    },

    /** Finds a booking by its reference code (any capitals, with or without the hyphen). */
    get(reference) {
      return findBookingByReference(store, reference);
    },

    /**
     * Cancels a booking and gives its seats back.
     * It answers with the booking and how many seats are now free. It does NOT say who is next on the waitlist:
     * that is another customer's name, and the person holding a booking reference has no right to it.
     */
    cancel(reference) {
      const { booking, seatsLeft } = cancelBooking(store, reference);
      return { booking, seatsLeft };
    },

    /**
     * PRACTICE ONLY (the routes expose this only in demo mode). Moves a booking to any state the life cycle allows.
     * Real payment, refund and check-in stories will replace it with proper use cases that check who is asking and
     * whether money really moved. Left open to the public, anyone could mark a booking as paid for free.
     */
    transition(reference, to) {
      if (typeof to !== 'string' || to === '') {
        throw new DomainError(ErrorCode.VALIDATION, 'to: is required (one of pending, paid, cancelled, refunded, checked_in)', { field: 'to' });
      }
      return transitionBooking(store, reference, to);
    },
  });
}
