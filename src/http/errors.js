// errors.js (HTTP layer)
// Turns ANY error into the one response shape every client sees:
//
//     { "error": { "code": "SOLD_OUT", "message": "Only 0 left in Regular, you asked for 1" } }
//
// Three kinds of error arrive here:
//   1. HttpError   the HTTP layer's own (bad JSON, unknown path, wrong method...): it knows its status.
//   2. DomainError a business rule said no (sold out, illegal move...): we look its status up in a table.
//   3. anything else: a BUG. The client gets a generic 500. The details go to the server log, never to the client.

import { DomainError } from '../domain/errors.js';

export class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status; // the HTTP status number: 400, 404, 405...
    this.code = code; //     a machine-readable word, like the domain codes: BAD_JSON, NOT_FOUND...
    this.headers = headers; // extra response headers (405 needs `Allow`)
  }
}

// Which HTTP status each business-rule code becomes. ONE table, so the mapping can't be forgotten in a route.
//   400  the request itself is wrong (fix it and send again)
//   404  the thing asked for does not exist
//   409  the request is fine, but it clashes with the CURRENT STATE of things (sold out, illegal move...)
// A test fails if a new domain error code is added without a line here.
export const HTTP_STATUS_BY_DOMAIN_CODE = Object.freeze({
  VALIDATION: 400,
  NOT_FOUND: 404,
  SOLD_OUT: 409,
  ALREADY_CANCELLED: 409,
  SEATS_AVAILABLE: 409,
  WAITLIST_FIRST: 409,
  ALREADY_WAITING: 409,
  EVENT_STARTED: 409,
  INVALID_TRANSITION: 409,
  INVALID_STATE: 409,
});

// The only thing a client ever learns about a bug.
const INTERNAL = Object.freeze({ code: 'INTERNAL', message: 'Something went wrong' });

/**
 * Any error -> { status, body, headers, isBug }.
 * `isBug` tells the caller to write the full error (with its stack) to the SERVER log.
 */
export function describeError(error) {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } }, headers: error.headers, isBug: false };
  }
  if (error instanceof DomainError && Object.hasOwn(HTTP_STATUS_BY_DOMAIN_CODE, error.code)) {
    return {
      status: HTTP_STATUS_BY_DOMAIN_CODE[error.code],
      body: { error: { code: error.code, message: error.message } },
      headers: {},
      isBug: false,
    };
  }
  // A real bug, OR a domain code nobody mapped to a status. Either way: generic message, details in the log.
  return { status: 500, body: { error: { ...INTERNAL } }, headers: {}, isBug: true };
}
