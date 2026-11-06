// healthService.js
// The "is the program alive?" use case. Deliberately tiny: it exists so that even /health follows the same path
// as every later feature (route -> service), and so the layer has something real to test.
//
// It is a LIVENESS check: "the process is up and can answer". A READINESS check ("and the database works too")
// will be added when a database exists.

export function createHealthService() {
  return Object.freeze({
    // Returns a NEW object each time, so a caller who edits the answer can't change what the next caller gets.
    check: () => ({ status: 'ok' }),
  });
}
