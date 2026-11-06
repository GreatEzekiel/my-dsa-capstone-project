// services/index.js
// Builds every service, once, and hands them out as one object. Services never create their own store, clock or
// anything else they depend on: it is passed in here, which is what lets the tests give them a fresh store each time.

import { createStore } from '../domain/inventory.js';
import { createBookingService } from './bookingService.js';
import { createEventService } from './eventService.js';
import { createHealthService } from './healthService.js';

export function createServices({ store = createStore() } = {}) {
  return Object.freeze({
    health: createHealthService(),
    events: createEventService({ store }),
    bookings: createBookingService({ store }),
  });
}
