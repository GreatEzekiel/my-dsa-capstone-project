// http.test.js: the real server, on a real port, called with real HTTP requests.

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DomainError, ErrorCode } from '../src/domain/errors.js';
import { HTTP_STATUS_BY_DOMAIN_CODE, HttpError, describeError } from '../src/http/errors.js';
import { rawRequest, rawSocket, startApp, STACK_HINTS } from './http-helpers.js';

// ----- THE required test: one real HTTP request to /health -----

test('GET /health over a real connection answers 200 {"status":"ok"}', async () => {
  const server = await startApp(); // the real routes, the real public/ folder, a free port
  try {
    const response = await fetch(`${server.url}/health`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json/);
    assert.equal(await response.text(), '{"status":"ok"}'); // exactly this text, nothing more
  } finally {
    await server.close();
  }
});

// ----- everything else shares one server with a few test-only routes -----

describe('the server', () => {
  let server;

  before(async () => {
    server = await startApp({
      maxBodyBytes: 100, // small on purpose, to test the size limit
      extraRoutes: (router) => {
        router.get('/api/boom', () => { throw new Error('database password is hunter2'); });
        router.get('/api/boom-async', async () => { throw new TypeError('secret async failure'); });
        router.get('/api/boom-string', () => { throw 'a thrown string'; }); // eslint-disable-line no-throw-literal
        router.get('/api/domain/:code', ({ params }) => { throw new DomainError(params.code, `a ${params.code} problem`); });
        router.get('/api/echo/:id', ({ params, query }) => ({ status: 200, body: { id: params.id, q: { ...query } } }));
        router.post('/api/echo', ({ body }) => ({ status: 201, body: { received: body ?? null } }));
        router.get('/api/headers', () => ({ status: 200, body: {}, headers: { 'X-Custom': 'yes' } }));
      },
    });
  });
  after(() => server.close());

  const get = (path, options) => fetch(`${server.url}${path}`, options);
  const post = (path, body, headers = { 'Content-Type': 'application/json' }) => fetch(`${server.url}${path}`, { method: 'POST', headers, body });

  // Checks that an error response has EXACTLY the shape { error: { code, message } } and no stack trace.
  function assertErrorShape(text, expectedCode) {
    const body = JSON.parse(text);
    assert.deepEqual(Object.keys(body), ['error']);
    assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
    assert.equal(typeof body.error.code, 'string');
    assert.equal(typeof body.error.message, 'string');
    if (expectedCode) assert.equal(body.error.code, expectedCode);
    for (const hint of STACK_HINTS) assert.doesNotMatch(text, hint, 'a stack trace reached the client');
  }

  describe('/health', () => {
    test('headers: JSON, not cached, not sniffed, with a request id', async () => {
      const response = await get('/health');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
      assert.equal(response.headers.get('content-length'), '15');
    });

    test('every request gets its own request id', async () => {
      const ids = new Set();
      for (let i = 0; i < 5; i++) ids.add((await get('/health')).headers.get('x-request-id'));
      assert.equal(ids.size, 5);
    });

    test('a query string and a trailing slash change nothing', async () => {
      for (const path of ['/health?x=1&y=2', '/health/', '/health/?a=b']) {
        const response = await get(path);
        assert.equal(response.status, 200, path);
        assert.deepEqual(await response.json(), { status: 'ok' });
      }
    });

    test('HEAD answers with the headers (and the right length) but no body', async () => {
      const response = await get('/health', { method: 'HEAD' });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-length'), '15');
      assert.equal(await response.text(), '');
    });

    test('POST, PUT, PATCH and DELETE are 405 with an Allow header', async () => {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const response = await get('/health', { method });
        assert.equal(response.status, 405, method);
        assert.equal(response.headers.get('allow'), 'GET, HEAD');
        assertErrorShape(await response.text(), 'METHOD_NOT_ALLOWED');
      }
    });

    test('the paths are case-sensitive: /Health is not /health', async () => {
      const response = await get('/Health');
      assert.equal(response.status, 404);
    });
  });

  describe('unknown /api paths: a JSON 404', () => {
    for (const path of ['/api', '/api/', '/api/nothing', '/api/events/123', '/api/a/b/c/d', '/api/%E4%BD%A0%E5%A5%BD']) {
      test(`GET ${path}`, async () => {
        const response = await get(path);
        assert.equal(response.status, 404);
        assert.match(response.headers.get('content-type'), /^application\/json/);
        assertErrorShape(await response.text(), 'NOT_FOUND');
      });
    }

    test('every method gets the JSON 404, and valid JSON bodies are fine', async () => {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const response = await fetch(`${server.url}/api/nothing`, { method, headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
        assert.equal(response.status, 404, method);
        assertErrorShape(await response.text(), 'NOT_FOUND');
      }
    });

    test('the message names the route but a huge path is cut short', async () => {
      const response = await get(`/api/${'x'.repeat(5000)}`);
      assert.equal(response.status, 404);
      const text = await response.text();
      assert.ok(text.length < 600);
      assertErrorShape(text, 'NOT_FOUND');
    });

    test('"/apixyz" is not an API path: it is a missing file, still in the same JSON shape', async () => {
      const response = await get('/apixyz');
      assert.equal(response.status, 404);
      assertErrorShape(await response.text(), 'NOT_FOUND');
    });
  });

  describe('request bodies: bad JSON is a JSON 400', () => {
    test('malformed JSON -> 400 BAD_JSON, and the message does not repeat the body', async () => {
      for (const bad of ['{"title": ', '{bad json}', '{"a":1,}', 'not json at all', "{'single': 'quotes'}", '{"a":1}{"b":2}', '\u0000']) {
        const response = await post('/api/events', bad);
        assert.equal(response.status, 400, JSON.stringify(bad));
        const text = await response.text();
        assertErrorShape(text, 'BAD_JSON');
        if (bad.length > 6) assert.ok(!text.includes(bad.trim()), 'the error must not echo the body');
      }
    });

    test('bad JSON on a route that exists is also a 400 (the body is read before the route runs)', async () => {
      const response = await post('/api/echo', '{oops');
      assert.equal(response.status, 400);
      assertErrorShape(await response.text(), 'BAD_JSON');
    });

    test('a body that is not sent as JSON -> 415', async () => {
      for (const type of [{ 'Content-Type': 'text/plain' }, { 'Content-Type': 'application/x-www-form-urlencoded' }, {}]) {
        const response = await fetch(`${server.url}/api/echo`, { method: 'POST', headers: type, body: '{"a":1}' });
        assert.equal(response.status, 415, JSON.stringify(type));
        assertErrorShape(await response.text(), 'UNSUPPORTED_MEDIA_TYPE');
      }
    });

    test('good JSON reaches the handler, with a charset in the content type too', async () => {
      const response = await post('/api/echo', '{"title":"Jazz","n":[1,2]}', { 'Content-Type': 'application/json; charset=utf-8' });
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { received: { title: 'Jazz', n: [1, 2] } });
    });

    test('"+json" types are accepted too', async () => {
      const response = await post('/api/echo', '{"a":1}', { 'Content-Type': 'application/vnd.api+json' });
      assert.equal(response.status, 201);
    });

    test('an empty body is fine: the handler sees no body', async () => {
      const response = await fetch(`${server.url}/api/echo`, { method: 'POST' });
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { received: null });
    });

    test('JSON that is just a number, a string or null is valid JSON', async () => {
      for (const [text, expected] of [['42', 42], ['"hi"', 'hi'], ['null', null], ['[1,2]', [1, 2]]]) {
        const response = await post('/api/echo', text);
        assert.deepEqual((await response.json()).received, expected);
      }
    });

    test('"__proto__" in a body is just a key: it does not change anything', async () => {
      const response = await post('/api/echo', '{"__proto__":{"polluted":true}}');
      assert.equal(response.status, 201);
      assert.equal({}.polluted, undefined);
    });

    test('a body that is too big -> 413 (announced length)', async () => {
      const response = await post('/api/echo', JSON.stringify({ text: 'x'.repeat(500) }));
      assert.equal(response.status, 413);
      assertErrorShape(await response.text(), 'PAYLOAD_TOO_LARGE');
    });

    test('a body that is too big -> 413 (streamed, no announced length)', async () => {
      const response = await fetch(`${server.url}/api/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        duplex: 'half',
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`{"text":"${'x'.repeat(300)}`));
            controller.enqueue(new TextEncoder().encode('"}'));
            controller.close();
          },
        }),
      });
      assert.equal(response.status, 413);
      assertErrorShape(await response.text(), 'PAYLOAD_TOO_LARGE');
    });

    test('a body exactly at the limit is accepted', async () => {
      const filler = 100 - '{"t":""}'.length;
      const body = `{"t":"${'x'.repeat(filler)}"}`;
      assert.equal(body.length, 100);
      assert.equal((await post('/api/echo', body)).status, 201);
    });

    test('a body on a GET is ignored, not parsed', async () => {
      const response = await get('/health', { method: 'GET' });
      assert.equal(response.status, 200);
      const raw = await rawRequest(server.port, { method: 'GET', path: '/health', headers: { 'Content-Type': 'application/json', 'Content-Length': '5' }, body: '{bad}' });
      assert.equal(raw.status, 200);
    });
  });

  describe('every error has the same shape, and no stack trace ever reaches the client', () => {
    test('a bug in a handler -> 500 INTERNAL with a generic message; the details go to the log', async () => {
      server.logs.error.length = 0;
      const response = await get('/api/boom');
      assert.equal(response.status, 500);
      const text = await response.text();
      assertErrorShape(text, 'INTERNAL');
      assert.equal(JSON.parse(text).error.message, 'Something went wrong');
      assert.ok(!text.includes('hunter2'), 'the secret in the error message leaked');

      // ...and the SERVER log has the whole story, with the request id to find it.
      assert.equal(server.logs.error.length, 1);
      assert.match(server.logs.error[0], /hunter2/);
      assert.match(server.logs.error[0], /\n\s+at /); // the stack trace
      assert.ok(server.logs.error[0].includes(response.headers.get('x-request-id')));
    });

    test('async failures and thrown non-errors are handled the same way', async () => {
      for (const path of ['/api/boom-async', '/api/boom-string']) {
        const response = await get(path);
        assert.equal(response.status, 500, path);
        const text = await response.text();
        assertErrorShape(text, 'INTERNAL');
        assert.ok(!text.includes('secret'), path);
      }
    });

    test('the server keeps working after a bug', async () => {
      await get('/api/boom');
      assert.equal((await get('/health')).status, 200);
    });

    test('a business-rule error becomes its mapped status, with its own code and message', async () => {
      const cases = { SOLD_OUT: 409, VALIDATION: 400, NOT_FOUND: 404, INVALID_TRANSITION: 409, INVALID_STATE: 409 };
      for (const [code, status] of Object.entries(cases)) {
        const response = await get(`/api/domain/${code}`);
        assert.equal(response.status, status, code);
        const text = await response.text();
        assertErrorShape(text, code);
        assert.equal(JSON.parse(text).error.message, `a ${code} problem`);
      }
    });

    test('a domain code nobody mapped is treated as a bug: 500 and logged', async () => {
      server.logs.error.length = 0;
      const response = await get('/api/domain/SOMETHING_NEW');
      assert.equal(response.status, 500);
      assertErrorShape(await response.text(), 'INTERNAL');
      assert.equal(server.logs.error.length, 1);
    });

    test('a broken % escape in a URL is a 400 in the same shape', async () => {
      const response = await rawRequest(server.port, { path: '/api/echo/%E0%A4%A' });
      assert.equal(response.status, 400);
      assertErrorShape(response.text, 'BAD_REQUEST');
    });

    test('a request that is not even HTTP gets a 400 in the same shape', async () => {
      const reply = await rawSocket(server.port, 'THIS IS NOT HTTP\r\n\r\n');
      assert.match(reply, /^HTTP\/1\.1 400 Bad Request/);
      const body = reply.slice(reply.indexOf('\r\n\r\n') + 4);
      assertErrorShape(body, 'BAD_REQUEST');
    });

    test('all the different errors, checked together', async () => {
      const responses = [
        await get('/api/nope'), await get('/health', { method: 'POST' }), await post('/api/x', '{'),
        await fetch(`${server.url}/api/x`, { method: 'POST', body: 'x' }), await get('/missing.png'),
        await get('/api/boom'), await post('/api/echo', 'x'.repeat(400)),
      ];
      assert.deepEqual(responses.map((r) => r.status), [404, 405, 400, 415, 404, 500, 413]);
      for (const response of responses) {
        assert.match(response.headers.get('content-type'), /^application\/json/);
        assertErrorShape(await response.text());
      }
    });
  });

  describe('routes and parameters through the real server', () => {
    test(':params and ?query reach the handler', async () => {
      const response = await get('/api/echo/abc123?color=red&size=L');
      assert.deepEqual(await response.json(), { id: 'abc123', q: { color: 'red', size: 'L' } });
    });

    test('an encoded parameter is decoded', async () => {
      const response = await get('/api/echo/caf%C3%A9%20noir');
      assert.equal((await response.json()).id, 'café noir');
    });

    test('a query key called __proto__ is just a key', async () => {
      const response = await get('/api/echo/1?__proto__=x');
      assert.equal(response.status, 200);
      assert.equal({}.x, undefined);
    });

    test('a handler may set extra headers', async () => {
      assert.equal((await get('/api/headers')).headers.get('x-custom'), 'yes');
    });

    test('a route that exists under another method is 405, not 404', async () => {
      const response = await get('/api/echo', { method: 'GET' });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('allow'), 'POST');
    });
  });

  describe('logging', () => {
    test('one line per request: method, path, status, time, request id; the query string is left out', async () => {
      server.logs.info.length = 0;
      const response = await get('/health?token=secret123');
      await response.text();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const line = server.logs.info.find((l) => l.includes('/health'));
      assert.ok(line, 'no access log line');
      assert.match(line, /^GET "\/health" 200 [\d.]+ms [0-9a-f-]{36}$/);
      assert.ok(!line.includes('secret123'));
    });
  });
});

// ----- the error table -----

describe('HTTP statuses for business-rule errors', () => {
  test('EVERY domain error code has an HTTP status (add a line to HTTP_STATUS_BY_DOMAIN_CODE when you add a code)', () => {
    assert.deepEqual(Object.keys(HTTP_STATUS_BY_DOMAIN_CODE).sort(), Object.keys(ErrorCode).sort());
    for (const status of Object.values(HTTP_STATUS_BY_DOMAIN_CODE)) assert.ok([400, 404, 409].includes(status));
  });

  test('describeError: HttpError, DomainError and bugs', () => {
    assert.deepEqual(describeError(new HttpError(418, 'TEAPOT', 'I am a teapot')).body, { error: { code: 'TEAPOT', message: 'I am a teapot' } });
    assert.equal(describeError(new DomainError('SOLD_OUT', 'x')).status, 409);
    const bug = describeError(new Error('boom'));
    assert.equal(bug.status, 500);
    assert.equal(bug.isBug, true);
    assert.deepEqual(bug.body, { error: { code: 'INTERNAL', message: 'Something went wrong' } });
    assert.equal(describeError(undefined).status, 500);
    assert.equal(describeError({ code: 'SOLD_OUT' }).status, 500); // looks like a domain error but is not one
  });
});

// ----- starting and stopping -----

describe('starting and stopping', () => {
  test('listening on a port that is taken fails with EADDRINUSE', async () => {
    const first = await startApp();
    try {
      const { createApp } = await import('../src/http/app.js');
      const { createServices } = await import('../src/services/index.js');
      const clash = createApp({ services: createServices(), publicDir: '.' });
      await assert.rejects(clash.listen(first.port), (e) => e.code === 'EADDRINUSE');
    } finally {
      await first.close();
    }
  });

  test('close() frees the port', async () => {
    const server = await startApp();
    const { port } = server;
    await server.close();
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
  });

  test('createApp refuses to start without its parts', async () => {
    const { createApp } = await import('../src/http/app.js');
    assert.throws(() => createApp({}), /services/);
    assert.throws(() => createApp({ services: {} }), /publicDir/);
  });
});
