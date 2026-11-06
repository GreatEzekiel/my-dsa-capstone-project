// router.js
// A tiny router: it answers ONE question, "which handler goes with this method and this path?"
//
//   const router = createRouter();
//   router.get('/events/:id', handler);           // :id is a PARAMETER: it matches any one path segment
//   router.match('GET', '/events/42');            // -> { handler, params: { id: '42' }, pattern: '/events/:id' }
//
// It knows nothing about HTTP requests, responses or files. It only compares text, so it is easy to test.

import { HttpError } from './errors.js';

// HEAD is not here on purpose: app.js treats a HEAD request as a GET whose body is thrown away.
const METHODS = Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

// A parameter name looks like a variable name: letters, digits and underscores, not starting with a digit.
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// "/events/:id/" -> ['events', ':id']. A trailing slash is ignored, and "/" is the empty list.
function splitPath(path) {
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return trimmed === '/' ? [] : trimmed.slice(1).split('/');
}

// Percent-decoding can fail on broken input like "%E0%A4%A": that is the CLIENT's mistake, so it is a 400, not a crash.
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'The URL contains a broken % escape');
  }
}

export function createRouter() {
  const routes = []; // every registered route, in the order they were added
  const signatures = new Set(); // "GET /events/:" strings, to catch duplicates

  // Registers a route. Mistakes here are PROGRAMMER mistakes, so they throw a plain Error at start-up,
  // long before any client can hit them.
  function add(method, path, handler) {
    const upper = String(method).toUpperCase();
    if (!METHODS.includes(upper)) throw new Error(`Unsupported method "${method}". Use one of: ${METHODS.join(', ')}`);
    if (typeof path !== 'string' || !path.startsWith('/')) throw new Error(`A route path must start with "/", got ${JSON.stringify(path)}`);
    if (typeof handler !== 'function') throw new Error(`The handler for ${upper} ${path} must be a function`);

    const names = new Set();
    const segments = splitPath(path).map((part) => {
      if (part === '') throw new Error(`Empty segment in route path "${path}"`);
      if (!part.startsWith(':')) return { literal: part };
      const name = part.slice(1);
      if (!PARAM_NAME.test(name)) throw new Error(`Bad parameter name "${part}" in "${path}"`);
      if (names.has(name)) throw new Error(`Parameter "${part}" is used twice in "${path}"`);
      names.add(name);
      return { param: name };
    });

    // "/events/:id" and "/events/:eventId" are the SAME route: same shape, only the name differs.
    const signature = `${upper} /${segments.map((s) => (s.param ? ':' : s.literal)).join('/')}`;
    if (signatures.has(signature)) throw new Error(`Duplicate route ${upper} ${path}`);
    signatures.add(signature);

    routes.push({
      method: upper,
      pattern: path,
      segments,
      handler,
      literalCount: segments.filter((s) => s.literal !== undefined).length,
    });
  }

  // Does this route's path shape fit the request path? Returns the captured params, or null.
  function fit(route, parts) {
    if (route.segments.length !== parts.length) return null;
    const params = Object.create(null); // no prototype: a parameter called "__proto__" can't pollute anything
    for (let i = 0; i < parts.length; i++) {
      const segment = route.segments[i];
      if (segment.param) params[segment.param] = parts[i];
      else if (segment.literal !== parts[i]) return null;
    }
    return params;
  }

  // The request path as decoded segments. Rejects paths that don't start with "/".
  function partsOf(rawPath) {
    if (typeof rawPath !== 'string' || !rawPath.startsWith('/')) return null;
    return splitPath(rawPath).map(decodeSegment);
  }

  /** match(method, path) -> { handler, params, pattern } or null */
  function match(method, rawPath) {
    const parts = partsOf(rawPath);
    if (!parts) return null;

    let best = null;
    for (const route of routes) {
      if (route.method !== method) continue;
      const params = fit(route, parts);
      if (!params) continue;
      // More fixed words = more specific: "/events/new" beats "/events/:id". On a tie the first one added wins.
      if (!best || route.literalCount > best.route.literalCount) best = { route, params };
    }
    return best ? { handler: best.route.handler, params: best.params, pattern: best.route.pattern } : null;
  }

  /** allowedMethods(path) -> the methods that DO have a route for this path (used for "405 Method Not Allowed"). */
  function allowedMethods(rawPath) {
    const parts = partsOf(rawPath);
    if (!parts) return [];
    const found = new Set();
    for (const route of routes) if (fit(route, parts)) found.add(route.method);
    if (found.has('GET')) found.add('HEAD'); // a GET route also answers HEAD
    return ['GET', 'HEAD', ...METHODS.filter((m) => m !== 'GET')].filter((m) => found.has(m));
  }

  return {
    add,
    get: (path, handler) => add('GET', path, handler),
    post: (path, handler) => add('POST', path, handler),
    put: (path, handler) => add('PUT', path, handler),
    patch: (path, handler) => add('PATCH', path, handler),
    delete: (path, handler) => add('DELETE', path, handler),
    match,
    allowedMethods,
    // A read-only list, handy for tests and for printing what the server can do.
    routes: () => routes.map(({ method, pattern }) => ({ method, pattern })),
  };
}
