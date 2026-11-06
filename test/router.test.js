// router.test.js: the tiny router (method + path, with :params).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/http/router.js';
import { HttpError } from '../src/http/errors.js';

const noop = () => {};

test('matches a plain path by method', () => {
  const router = createRouter();
  const handler = () => 'hello';
  router.get('/health', handler);
  const found = router.match('GET', '/health');
  assert.equal(found.handler, handler);
  assert.equal(found.pattern, '/health');
  assert.deepEqual({ ...found.params }, {});
});

test('the method must match: POST /health does not find a GET route', () => {
  const router = createRouter();
  router.get('/health', noop);
  assert.equal(router.match('POST', '/health'), null);
  assert.equal(router.match('GET', '/nope'), null);
});

test('captures :params', () => {
  const router = createRouter();
  router.get('/events/:id', noop);
  router.get('/events/:eventId/tiers/:tierId', noop);
  assert.deepEqual({ ...router.match('GET', '/events/42').params }, { id: '42' });
  assert.deepEqual({ ...router.match('GET', '/events/e1/tiers/t9').params }, { eventId: 'e1', tierId: 't9' });
});

test('a parameter matches exactly ONE segment', () => {
  const router = createRouter();
  router.get('/events/:id', noop);
  assert.equal(router.match('GET', '/events'), null); // too short
  assert.equal(router.match('GET', '/events/1/2'), null); // too long
  assert.equal(router.match('GET', '/events/'), null); // trailing slash leaves the parameter empty... no match
});

test('the root path and trailing slashes', () => {
  const router = createRouter();
  router.get('/', noop);
  router.get('/things', noop);
  assert.ok(router.match('GET', '/'));
  assert.ok(router.match('GET', '/things'));
  assert.ok(router.match('GET', '/things/')); // a trailing slash is ignored
  assert.equal(router.match('GET', '/things//'), null);
  assert.equal(router.match('GET', '//things'), null); // an empty segment is not "things"
});

test('paths are case-sensitive', () => {
  const router = createRouter();
  router.get('/health', noop);
  assert.equal(router.match('GET', '/Health'), null);
});

test('percent-escapes in a parameter are decoded', () => {
  const router = createRouter();
  router.get('/search/:text', noop);
  assert.equal(router.match('GET', '/search/caf%C3%A9%20noir').params.text, 'café noir');
});

test('a broken % escape is a 400 (the client\'s mistake), not a crash', () => {
  const router = createRouter();
  router.get('/search/:text', noop);
  assert.throws(() => router.match('GET', '/search/%E0%A4%A'), (e) => e instanceof HttpError && e.status === 400);
});

test('a parameter value of "__proto__" or "constructor" is just text and pollutes nothing', () => {
  const router = createRouter();
  router.get('/x/:id', noop);
  const { params } = router.match('GET', '/x/__proto__');
  assert.equal(params.id, '__proto__');
  assert.equal(Object.getPrototypeOf(params), null);
  assert.equal({}.polluted, undefined);
  assert.equal(router.match('GET', '/x/constructor').params.id, 'constructor');
});

test('a fixed word beats a parameter: /events/new wins over /events/:id, whatever the order they were added', () => {
  for (const order of [['new', ':id'], [':id', 'new']]) {
    const router = createRouter();
    for (const part of order) router.get(`/events/${part}`, () => part);
    assert.equal(router.match('GET', '/events/new').handler(), 'new');
    assert.equal(router.match('GET', '/events/77').handler(), ':id');
  }
});

test('the same path can have different handlers per method, and allowedMethods lists them', () => {
  const router = createRouter();
  router.get('/things/:id', noop);
  router.delete('/things/:id', noop);
  router.post('/things', noop);
  assert.deepEqual(router.allowedMethods('/things/5'), ['GET', 'HEAD', 'DELETE']); // GET brings HEAD with it
  assert.deepEqual(router.allowedMethods('/things'), ['POST']);
  assert.deepEqual(router.allowedMethods('/nothing'), []);
});

test('all five methods can be registered', () => {
  const router = createRouter();
  router.get('/a', noop); router.post('/a', noop); router.put('/a', noop); router.patch('/a', noop); router.delete('/a', noop);
  assert.deepEqual(router.routes().map((r) => r.method), ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
});

test('registering a route wrongly fails immediately, at start-up', () => {
  const router = createRouter();
  assert.throws(() => router.get('health', noop), /must start with "\/"/);
  assert.throws(() => router.get('/a', 'not a function'), /must be a function/);
  assert.throws(() => router.add('TRACE', '/a', noop), /Unsupported method/);
  assert.throws(() => router.get('/a//b', noop), /Empty segment/);
  assert.throws(() => router.get('/a/:', noop), /Bad parameter name/);
  assert.throws(() => router.get('/a/:1x', noop), /Bad parameter name/);
  assert.throws(() => router.get('/a/:id/:id', noop), /used twice/);
  router.get('/a/:id', noop);
  assert.throws(() => router.get('/a/:other', noop), /Duplicate route/); // same shape, different parameter name
  assert.throws(() => router.get('/a/:id/', noop), /Duplicate route/);
});

test('match gives null for anything that is not a path', () => {
  const router = createRouter();
  router.get('/', noop);
  for (const junk of ['', 'health', undefined, null, 5]) assert.equal(router.match('GET', junk), null);
  assert.equal(router.match('FOO', '/'), null);
});
