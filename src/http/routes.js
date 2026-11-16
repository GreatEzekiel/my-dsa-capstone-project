// routes.js
// Every URL the server answers, in one place. A route handler does exactly three things:
//   1. read what it needs from the request (params, query, body)
//   2. call ONE service function
//   3. return { status, body, headers? } (the app turns that into JSON)
// It never decides business rules and never touches the data: that is the services' and the rules' job.
//
// A handler receives one argument: { method, path, params, query, body, headers, requestId }.
// It returns { status, body, headers? }, or throws (the app turns the error into the standard error JSON).
//
//   GET  /health                               is the server alive?
//   POST /api/events                           create an event (a DRAFT)
//   GET  /api/events                           search the PUBLISHED events (?q= &city= &from= &to= &maxPriceCents= &onlyAvailable= &sort=)
//   GET  /api/events/:id                       one event with its tiers
//   POST /api/events/:id/tiers                 add a ticket tier
//   POST /api/events/:id/publish               make it public
//   POST /api/events/:id/unpublish             take it off the public list
//   GET  /api/events/:id/waitlists             read the event's ticket-tier queues
//   POST /api/events/:eventId/tiers/:tierId/waitlist   join a ticket-tier queue
//   DELETE /api/events/:eventId/tiers/:tierId/waitlist/:entryId   leave a queue
//   POST /api/events/:eventId/tiers/:tierId/waitlist/next/book   book the queue head
//   POST /api/bookings                         book tickets
//   GET  /api/bookings/:reference              find a booking by its code
//   POST /api/bookings/:reference/pay          pay through the mock gateway
//   POST /api/bookings/:reference/cancel       cancel an unpaid booking
//   POST /api/dev/bookings/:reference/transition   PRACTICE ONLY, demo mode only: move a booking along its life cycle

import { requireRole, requireUser } from './guards.js';

const ok = (body) => ({ status: 200, body });

// 201 Created, with a Location header: "the new thing lives at this address".
const created = (body, location) => ({ status: 201, body, headers: location ? { Location: location } : undefined });

export function registerRoutes(router, services, { devRoutes = false } = {}) {
  router.get('/health', () => ok(services.health.check()));

  // ----- authentication -----
  router.post('/api/auth/signup', async ({ body }) => created(await services.auth.signup(body), '/api/auth/me'));
  router.post('/api/auth/login', async ({ body }) => ok(await services.auth.login(body)));
  router.get('/api/auth/me', async ({ headers }) =>
    ok({ user: await requireUser(headers, services.auth) }));

  // ----- events -----
  router.post('/api/events', async ({ body, headers }) => {
    const user = requireRole(await requireUser(headers, services.auth), 'organizer');
    const event = await services.events.create(body, user.id);
    return created({ event }, `/api/events/${event.id}`);
  });
  router.get('/api/events', async ({ query }) => ok(await services.events.search(query)));
  router.get('/api/events/:id', async ({ params }) => ok({ event: await services.events.get(params.id) }));
  router.get('/api/organizer/events', async ({ headers }) => {
    const user = requireRole(await requireUser(headers, services.auth), 'organizer');
    return ok({ events: await services.events.listForOrganizer(user.id) });
  });
  router.post('/api/events/:id/tiers', async ({ params, body, headers }) => {
    const user = requireRole(await requireUser(headers, services.auth), 'organizer');
    return created({ tier: await services.events.addTier(params.id, body, user.id) });
  });
  router.post('/api/events/:id/publish', async ({ params, headers }) => {
    const user = requireRole(await requireUser(headers, services.auth), 'organizer');
    return ok({ event: await services.events.publish(params.id, user.id) });
  });
  router.post('/api/events/:id/unpublish', async ({ params, headers }) => {
    const user = requireRole(await requireUser(headers, services.auth), 'organizer');
    return ok({ event: await services.events.unpublish(params.id, user.id) });
  });
  router.get('/api/events/:id/waitlists', async ({ params, headers }) => {
    const user = await requireUser(headers, services.auth);
    return ok(await services.waitlists.listForEvent(params.id, user.id, user.role));
  });
  router.post('/api/events/:eventId/tiers/:tierId/waitlist', async ({ params, body, headers }) => {
    const user = requireRole(await requireUser(headers, services.auth), 'attendee');
    const result = await services.waitlists.join(params.eventId, params.tierId, body, user.id);
    return created(result, `/api/events/${params.eventId}/tiers/${params.tierId}/waitlist/${result.entry.id}`);
  });
  router.delete('/api/events/:eventId/tiers/:tierId/waitlist/:entryId', async ({ params, headers }) => {
    const user = requireRole(await requireUser(headers, services.auth), 'attendee');
    return ok(await services.waitlists.leave(params.eventId, params.tierId, params.entryId, user.id));
  });
  router.post('/api/events/:eventId/tiers/:tierId/waitlist/next/book', async ({ params, headers }) => {
    const user = requireRole(await requireUser(headers, services.auth), 'attendee');
    return ok({ booking: await services.waitlists.bookNext(params.eventId, params.tierId, user.id) });
  });

  // ----- bookings -----
  router.post('/api/bookings', async ({ body, headers }) => {
    const user = requireRole(await requireUser(headers, services.auth), 'attendee');
    const booking = await services.bookings.book(body, user.id);
    return created({ booking }, `/api/bookings/${booking.reference}`);
  });
  router.get('/api/bookings', async ({ headers }) => {
    const user = requireRole(await requireUser(headers, services.auth), 'attendee');
    return ok({ bookings: await services.bookings.listForUser(user.id) });
  });
  router.get('/api/bookings/:reference', async ({ params, headers }) => {
    const user = requireRole(await requireUser(headers, services.auth), 'attendee');
    return ok({ booking: await services.bookings.get(params.reference, user.id) });
  });
  router.post('/api/bookings/:reference/pay', async ({ params, body, headers }) => {
    const user = requireRole(await requireUser(headers, services.auth), 'attendee');
    return ok({ booking: await services.bookings.pay(params.reference, user.id, body) });
  });
  router.post('/api/bookings/:reference/cancel', async ({ params, headers }) => {
    const user = requireRole(await requireUser(headers, services.auth), 'attendee');
    return ok(await services.bookings.cancel(params.reference, user.id));
  });

  // ----- practice only -----
  // Only exists in demo mode (`npm run start:demo`). In a normal start this URL is simply an unknown /api path (404).
  if (devRoutes) {
    router.post('/api/dev/bookings/:reference/transition', async ({ params, body, headers }) => {
      requireRole(await requireUser(headers, services.auth), 'staff');
      return ok({ booking: await services.bookings.transition(params.reference, body?.to) });
    });
  }
}
