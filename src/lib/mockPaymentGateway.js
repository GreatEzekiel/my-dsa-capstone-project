import { randomUUID } from 'node:crypto';

export function createMockPaymentGateway() {
  const successfulCharges = new Map();

  return Object.freeze({
    async charge({ bookingId, decline = false } = {}) {
      if (typeof bookingId !== 'string' || bookingId.trim() === '') {
        throw new TypeError('charge requires a bookingId');
      }
      if (typeof decline !== 'boolean') throw new TypeError('decline must be a boolean');

      const previous = successfulCharges.get(bookingId);
      if (previous) return { ...previous };
      if (decline) return { status: 'declined' };

      const result = { status: 'succeeded', transactionId: randomUUID() };
      successfulCharges.set(bookingId, result);
      return { ...result };
    },
  });
}
