// routes.js
// Every URL the server answers, in one place. A route handler does exactly three things:
//   1. read what it needs from the request (params, query, body)
//   2. call ONE service function
//   3. return { status, body, headers? } (the app turns that into JSON)
// It never decides business rules and never touches the data: that is the services' and the rules' job.
//
// A handler receives one argument: { method, path, params, query, body, headers, requestId }.
// It returns { status, body, headers? }, or throws (the app turns the error into the standard error JSON).

export function registerRoutes(router, services) {
  // GET /health -> 200 {"status":"ok"}
  router.get('/health', () => ({ status: 200, body: services.health.check() }));
}
