// services/index.js
// Builds every service, once, and hands them out as one object. Services never create their own store, clock or
// anything else they depend on: it is passed in here, which is what lets the tests give them a fresh store each time.

import { createBookingService } from './bookingService.js';
import { createAuthService } from './authService.js';
import { createEventService } from './eventService.js';
import { createHealthService } from './healthService.js';
import { createWaitlistService } from './waitlistService.js';

export function createServices({ repository, paymentGateway, now, authNow = Date.now, tokenSecret, bookingHoldMs } = {}) {
  if (!repository) throw new TypeError('createServices needs a repository');
  if (!paymentGateway) throw new TypeError('createServices needs a payment gateway');
  const services = {
    health: createHealthService(),
    events: createEventService({ repository, now }),
    bookings: createBookingService({ repository, paymentGateway, now, bookingHoldMs }),
    waitlists: createWaitlistService({ repository, now, bookingHoldMs }),
  };
  if (tokenSecret !== undefined) services.auth = createAuthService({ repository, tokenSecret, now: authNow });
  return Object.freeze(services);
}
