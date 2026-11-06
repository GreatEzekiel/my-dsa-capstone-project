// services/index.js
// Builds every service, once, and hands them out as one object. This is where later builds will pass in the
// things services need (the data store, the clock, a payment gateway): the services never create those themselves.

import { createHealthService } from './healthService.js';

export function createServices() {
  return Object.freeze({
    health: createHealthService(),
    // booking, event and payment services arrive with the stories that need them (S07, S09, S10...)
  });
}
