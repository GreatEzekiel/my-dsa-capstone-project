// app.js
// The web server, built on node:http only. It does the plumbing for EVERY request, in this order:
//
//   1. read the URL
//   2. read the body (JSON only) and refuse bad, oversized or non-JSON bodies
//   3. look for a route  -> run its handler -> send the JSON it returned
//   4. no route: unknown /api path -> JSON 404;  anything else -> a file from public/
//   5. anything that throws, at any step -> ONE error shape, and the stack trace stays in the server log
//
// Business rules do not live here. This file moves bytes; the services and rules make decisions.

import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { HttpError, describeError } from './errors.js';
import { registerRoutes } from './routes.js';
import { createRouter } from './router.js';
import { createStaticFiles } from './staticFiles.js';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']); // only these may carry a JSON body

// Headers on EVERY response. nosniff: "trust my Content-Type". no-store (API only): never keep a copy of the answer.
const BASE_HEADERS = Object.freeze({ 'X-Content-Type-Options': 'nosniff' });

const silentLogger = Object.freeze({ info() {}, error() {} });

const isApiPath = (pathname) => pathname === '/api' || pathname.startsWith('/api/');

// Is this content type JSON? ("application/json; charset=utf-8" and "application/vnd.api+json" both are.)
function isJsonType(header = '') {
  const type = header.split(';')[0].trim().toLowerCase();
  return type === 'application/json' || type.endsWith('+json');
}

// Splits "/health?x=1" into the path and the query. Also copes with the rare absolute form "GET http://host/health".
function parseTarget(rawUrl = '/') {
  let target = rawUrl;
  if (!target.startsWith('/')) {
    try {
      const absolute = new URL(target);
      target = absolute.pathname + absolute.search;
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'The request URL is not valid');
    }
  }
  const mark = target.indexOf('?');
  const pathname = mark === -1 ? target : target.slice(0, mark);
  const search = mark === -1 ? '' : target.slice(mark + 1);
  // A query object with no prototype: a key like "__proto__" is just a key.
  const query = Object.assign(Object.create(null), Object.fromEntries(new URLSearchParams(search)));
  return { pathname: pathname || '/', query };
}

// Reads the JSON body of a POST, PUT or PATCH. Returns undefined when there is no body.
async function readJsonBody(req, method, limit) {
  if (!BODY_METHODS.has(method)) {
    req.resume(); // a body on a GET is not wanted: throw the bytes away so the connection can be reused
    return undefined;
  }
  const tooLarge = () =>
    new HttpError(413, 'PAYLOAD_TOO_LARGE', `The request body is larger than ${limit} bytes`, { Connection: 'close' });

  // If the client announced a size, refuse early without reading anything.
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw tooLarge();

  // Otherwise count as the bytes arrive: a client can lie about (or leave out) the length.
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw tooLarge();
    chunks.push(chunk);
  }
  if (size === 0) return undefined; // an empty body is fine: "no body"

  if (!isJsonType(req.headers['content-type'])) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the body as JSON with the header Content-Type: application/json');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    // Not the parser's own message: it can quote pieces of the body. A fixed sentence is enough.
    throw new HttpError(400, 'BAD_JSON', 'The request body is not valid JSON');
  }
}

// Writes a JSON response. `head` = a HEAD request: send the headers (with the right length) but no body.
function sendJson(res, status, body, { headers = {}, head = false, cache = true } = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...BASE_HEADERS,
    ...(cache ? { 'Cache-Control': 'no-store' } : {}),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...headers,
  });
  res.end(head ? undefined : text);
}

/**
 * createApp({ services, publicDir, ... }) -> { server, listen, close }
 *
 *   services      what the routes may call (built by createServices)
 *   publicDir     the folder static files are served from
 *   routes        a function (router, services) that registers the routes. Default: the real ones.
 *                 Tests pass their own to add a route that fails on purpose.
 *   maxBodyBytes  the biggest JSON body accepted (default 1 MB)
 *   logger        { info(text), error(text) }. Default: silent.
 */
export function createApp({ services, publicDir, routes = registerRoutes, maxBodyBytes = 1_000_000, logger = silentLogger } = {}) {
  if (!services || typeof services !== 'object') throw new Error('createApp needs a services object');
  if (typeof publicDir !== 'string' || publicDir === '') throw new Error('createApp needs a publicDir');

  const router = createRouter();
  routes(router, services);
  const files = createStaticFiles(publicDir);

  async function handle(req, res) {
    const requestId = randomUUID();
    const started = performance.now();
    res.setHeader('X-Request-Id', requestId); // quote this to find the request in the server log

    // One line in the log per finished request: method, path (no query: it may hold secrets), status, time, id.
    res.on('finish', () => {
      const ms = (performance.now() - started).toFixed(1);
      logger.info(`${req.method} ${JSON.stringify((req.url ?? '').split('?')[0])} ${res.statusCode} ${ms}ms ${requestId}`);
    });

    // HEAD means "like GET, but headers only". We run the GET logic and drop the body at the end.
    const head = req.method === 'HEAD';
    const method = head ? 'GET' : req.method;

    try {
      const { pathname, query } = parseTarget(req.url);
      const body = await readJsonBody(req, method, maxBodyBytes);

      const found = router.match(method, pathname);
      if (found) {
        const result = await found.handler({ method, path: pathname, params: found.params, query, body, headers: req.headers, requestId });
        sendJson(res, result.status ?? 200, result.body, { headers: result.headers, head });
        return;
      }

      // No route. Is the PATH known under a different method? Then it is 405, not 404.
      const allowed = router.allowedMethods(pathname);
      if (allowed.length > 0) {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${req.method} is not allowed here. Use: ${allowed.join(', ')}`, { Allow: allowed.join(', ') });
      }

      // Unknown API path: a JSON 404. (The path is cut at 200 characters and JSON-escaped: it is the CLIENT's text.)
      if (isApiPath(pathname)) {
        throw new HttpError(404, 'NOT_FOUND', `No route for ${req.method} ${pathname.slice(0, 200)}`);
      }

      // Everything else is a file from public/. Only GET and HEAD make sense for files.
      if (method !== 'GET') {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${req.method} is not allowed here. Use: GET, HEAD`, { Allow: 'GET, HEAD' });
      }
      await files.serve(pathname, res, { head });
    } catch (error) {
      const { status, body, headers, isBug } = describeError(error);
      // A bug's full story (message + stack) goes to the SERVER log, with the request id to find it. Never to the client.
      if (isBug) logger.error(`${requestId} ${req.method} ${JSON.stringify((req.url ?? '').split('?')[0])}\n${error?.stack ?? error}`);

      if (res.headersSent) {
        res.destroy(); // too late to change the status: the only honest thing left is to cut the connection
        return;
      }
      sendJson(res, status, body, { headers, head });
    }
  }

  const server = http.createServer((req, res) => {
    // handle() catches its own errors, but a failure inside the catch block must still never crash the process.
    handle(req, res).catch((error) => {
      logger.error(`unhandled: ${error?.stack ?? error}`);
      if (!res.headersSent) sendJson(res, 500, { error: { code: 'INTERNAL', message: 'Something went wrong' } });
      else res.destroy();
    });
  });

  // Protect against slow or stuck clients holding connections open forever.
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;

  // A request so broken that Node can't even parse it as HTTP (garbage bytes). Answer in the SAME error shape.
  server.on('clientError', (error, socket) => {
    if (!socket.writable || error.code === 'ECONNRESET') {
      socket.destroy();
      return;
    }
    const text = JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'The request is not valid HTTP' } });
    socket.end(
      `HTTP/1.1 400 Bad Request\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(text)}\r\nConnection: close\r\n\r\n${text}`,
    );
  });

  return {
    server,
    router,

    /** Starts listening. Port 0 means "any free port". Resolves with the address actually used. */
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        server.once('error', reject); // for example EADDRINUSE: the port is taken
        server.listen(port, host, () => {
          server.off('error', reject);
          const address = server.address();
          resolve({ port: address.port, host: address.address, url: `http://${host}:${address.port}` });
        });
      });
    },

    /** Stops accepting requests, lets running ones finish, and force-closes what is left after `forceAfterMs`. */
    close({ forceAfterMs = 5000 } = {}) {
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
        if (forceAfterMs === 0) server.closeAllConnections();
        else setTimeout(() => server.closeAllConnections(), forceAfterMs).unref(); // unref: this timer alone won't keep the program alive
      });
    },
  };
}
