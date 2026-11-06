// config.test.js: reading PORT and HOST from the environment.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { ConfigError, DEFAULT_HOST, DEFAULT_PORT, loadConfig } from '../src/config.js';

test('with nothing set: port 3000, this computer only', () => {
  const config = loadConfig({});
  assert.equal(config.port, 3000);
  assert.equal(DEFAULT_PORT, 3000);
  assert.equal(config.host, DEFAULT_HOST);
  assert.equal(config.host, '127.0.0.1');
});

test('PORT comes from the environment', () => {
  assert.equal(loadConfig({ PORT: '8080' }).port, 8080);
  assert.equal(loadConfig({ PORT: '0' }).port, 0); // 0 = any free port
  assert.equal(loadConfig({ PORT: '65535' }).port, 65535);
  assert.equal(loadConfig({ PORT: ' 4000 ' }).port, 4000); // spaces are ignored
});

test('an empty PORT means "not set"', () => {
  assert.equal(loadConfig({ PORT: '' }).port, 3000);
  assert.equal(loadConfig({ PORT: '   ' }).port, 3000);
});

test('a PORT that is not a whole number from 0 to 65535 stops start-up with a ConfigError', () => {
  for (const bad of ['abc', '3000abc', 'abc3000', '-1', '65536', '99999', '123456', '1e3', '3.5', '0x50', '80 80', 'NaN']) {
    assert.throws(() => loadConfig({ PORT: bad }), (e) => e instanceof ConfigError && /PORT must be/.test(e.message), bad);
  }
});

test('HOST can be set, and blank means the default', () => {
  assert.equal(loadConfig({ HOST: '0.0.0.0' }).host, '0.0.0.0');
  assert.equal(loadConfig({ HOST: '  ' }).host, '127.0.0.1');
});

test('the settings are frozen, and publicDir is the real public/ folder', () => {
  const config = loadConfig({});
  assert.throws(() => { config.port = 1; }, TypeError);
  assert.ok(config.publicDir.endsWith('public'));
  assert.ok(existsSync(config.publicDir));
});

test('it reads process.env when no environment is given', () => {
  const old = process.env.PORT;
  process.env.PORT = '4321';
  try { assert.equal(loadConfig().port, 4321); } finally { if (old === undefined) delete process.env.PORT; else process.env.PORT = old; }
});
