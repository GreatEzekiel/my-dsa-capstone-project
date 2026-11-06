// services.test.js: the service layer (no HTTP anywhere in these tests).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServices } from '../src/services/index.js';

test('health.check() answers { status: "ok" }', () => {
  assert.deepEqual(createServices().health.check(), { status: 'ok' });
});

test('every call gets its own object, so editing one answer cannot change the next', () => {
  const { health } = createServices();
  const first = health.check();
  first.status = 'hacked';
  assert.deepEqual(health.check(), { status: 'ok' });
});

test('the services object and each service are frozen', () => {
  const services = createServices();
  assert.throws(() => { services.health = null; }, TypeError);
  assert.throws(() => { services.health.check = () => 'hacked'; }, TypeError);
});
