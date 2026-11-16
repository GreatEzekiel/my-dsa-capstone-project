import { holdsSeats } from '../domain/bookingStateMachine.js';
import { referenceKey } from '../domain/ids.js';

const copy = (value) => (value === null || value === undefined ? value : structuredClone(value));

export function createMemoryRepository() {
  const events = new Map();
  const tiers = new Map();
  const bookings = new Map();

  return Object.freeze({
    async createEvent(event) {
      if (events.has(event.id)) throw new Error(`Duplicate event id: ${event.id}`);
      events.set(event.id, copy(event));
      return copy(event);
    },

    async getEvent(id) {
      return copy(events.get(id) ?? null);
    },

    async listEvents() {
      return [...events.values()].map(copy);
    },

    async saveEvent(event) {
      if (!events.has(event.id)) return null;
      events.set(event.id, copy(event));
      return copy(event);
    },

    async createTier(tier) {
      if (tiers.has(tier.id)) throw new Error(`Duplicate ticket tier id: ${tier.id}`);
      tiers.set(tier.id, copy(tier));
      return copy(tier);
    },

    async getTier(id) {
      return copy(tiers.get(id) ?? null);
    },

    async listTiersForEvent(eventId) {
      return [...tiers.values()].filter((tier) => tier.eventId === eventId).map(copy);
    },

    async saveTier(tier) {
      if (!tiers.has(tier.id)) return null;
      tiers.set(tier.id, copy(tier));
      return copy(tier);
    },

    async createBooking(booking) {
      const key = referenceKey(booking.reference);
      if (bookings.has(key)) throw new Error(`Duplicate booking reference: ${booking.reference}`);
      const tier = tiers.get(booking.tierId);
      if (!tier || booking.quantity > tier.capacity - tier.sold) return null;

      tier.sold += booking.quantity;
      bookings.set(key, copy(booking));
      return copy(booking);
    },

    async getBookingByReference(reference) {
      return copy(bookings.get(referenceKey(reference)) ?? null);
    },

    async listBookings({ eventId } = {}) {
      const all = [...bookings.values()];
      return all.filter((booking) => eventId === undefined || booking.eventId === eventId).map(copy);
    },

    async transitionBooking(reference, expectedStatus, booking) {
      const key = referenceKey(reference);
      const current = bookings.get(key);
      if (!current || current.status !== expectedStatus) return null;

      const tier = tiers.get(current.tierId);
      if (!tier) throw new Error(`Booking ${current.reference} has no ticket tier`);

      const hadSeats = holdsSeats(current.status);
      const willHoldSeats = holdsSeats(booking.status);
      if (!hadSeats && willHoldSeats) {
        if (booking.quantity > tier.capacity - tier.sold) return null;
        tier.sold += booking.quantity;
      } else if (hadSeats && !willHoldSeats) {
        if (tier.sold < current.quantity) throw new Error(`Ticket tier ${tier.id} has an invalid sold count`);
        tier.sold -= current.quantity;
      }

      bookings.set(key, copy(booking));
      return copy(booking);
    },
  });
}
