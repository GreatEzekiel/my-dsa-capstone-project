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
//   POST /api/bookings                         book tickets
//   GET  /api/bookings/:reference              find a booking by its code
//   POST /api/bookings/:reference/cancel       cancel it, give the seats back
//   POST /api/dev/bookings/:reference/transition   PRACTICE ONLY, demo mode only: move a booking along its life cycle

const ok = (body) => ({ status: 200, body });

// 201 Created, with a Location header: "the new thing lives at this address".
const created = (body, location) => ({ status: 201, body, headers: location ? { Location: location } : undefined });

export function registerRoutes(router, services, { devRoutes = false } = {}) {
  router.get('/health', () => ok(services.health.check()));

  // ----- events -----
  router.post('/api/events', ({ body }) => {
    const event = services.events.create(body);
    return created({ event }, `/api/events/${event.id}`);
  });
  router.get('/api/events', ({ query }) => ok(services.events.search(query)));
  router.get('/api/events/:id', ({ params }) => ok({ event: services.events.get(params.id) }));
  router.post('/api/events/:id/tiers', ({ params, body }) => created({ tier: services.events.addTier(params.id, body) }));
  router.post('/api/events/:id/publish', ({ params }) => ok({ event: services.events.publish(params.id) }));
  router.post('/api/events/:id/unpublish', ({ params }) => ok({ event: services.events.unpublish(params.id) }));

  // ----- bookings -----
  router.post('/api/bookings', ({ body }) => {
    const booking = services.bookings.book(body);
    return created({ booking }, `/api/bookings/${booking.reference}`);
  });
  router.get('/api/bookings/:reference', ({ params }) => ok({ booking: services.bookings.get(params.reference) }));
  router.post('/api/bookings/:reference/cancel', ({ params }) => ok(services.bookings.cancel(params.reference)));

  // ----- practice only -----
  // Only exists in demo mode (`npm run start:demo`). In a normal start this URL is simply an unknown /api path (404).
  if (devRoutes) {
    router.post('/api/dev/bookings/:reference/transition', ({ params, body }) =>
      ok({ booking: services.bookings.transition(params.reference, body?.to) }));
  }
}
