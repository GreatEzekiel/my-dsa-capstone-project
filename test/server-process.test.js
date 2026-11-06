// server-process.test.js: starts the REAL program the way a person does (`node src/server.js`, which is what
// `npm start` runs), as a separate process, and talks to it over the network. The other tests build the app inside
// the test; this one proves the actual start-up file works: config, wiring, listening, shutting down.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../src/server.js', import.meta.url));

// Starts the server with the given environment. Resolves when it says it is running, or when it exits.
function start(env) {
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const running = new Promise((resolve) => {
    const timer = setInterval(() => {
      const match = out.match(/running at (http:\/\/\S+)/);
      if (match) { clearInterval(timer); resolve(match[1]); }
    }, 25);
    exited.then(() => { clearInterval(timer); resolve(null); });
  });
  return { child, running, exited, output: () => ({ out, err }) };
}

test('npm start: the server starts on PORT, answers /health and the home page, and stops cleanly on SIGTERM', async () => {
  const server = start({ PORT: '0' }); // 0 = any free port, so this test never clashes with anything
  try {
    const url = await server.running;
    assert.ok(url, `the server did not start. stderr: ${server.output().err}`);

    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const home = await fetch(`${url}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Event Ticketing/);

    assert.equal((await fetch(`${url}/api/unknown`)).status, 404);
  } finally {
    server.child.kill('SIGTERM');
  }
  const { code } = await server.exited;
  assert.equal(code, 0, 'a clean shutdown exits with code 0');
  assert.match(server.output().out, /shutting down/);
  assert.match(server.output().out, /GET "\/health" 200/); // the access log works
});

test('npm start: the PORT variable is honoured', async () => {
  // Find a free port, release it, and ask the server to use it.
  const probe = (await import('node:net')).createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));

  const server = start({ PORT: String(port) });
  try {
    const url = await server.running;
    assert.equal(url, `http://127.0.0.1:${port}`);
    assert.equal((await fetch(`${url}/health`)).status, 200);
  } finally {
    server.child.kill('SIGTERM');
    await server.exited;
  }
});

test('npm start: with no PORT it would use 3000 (checked through the config, so the test cannot clash with a real server)', async () => {
  const { loadConfig } = await import('../src/config.js');
  assert.equal(loadConfig({}).port, 3000);
});

test('a bad PORT stops the program with a clear one-line message and exit code 1, and no stack trace', async () => {
  const server = start({ PORT: 'banana' });
  const { code } = await server.exited;
  assert.equal(code, 1);
  const { out, err } = server.output();
  assert.match(err, /Cannot start: PORT must be a whole number from 0 to 65535/);
  assert.doesNotMatch(err, /\n\s+at /);
  assert.equal(out, '');
});

test('a port that is already taken stops the program with a helpful message and exit code 1', async () => {
  const first = start({ PORT: '0' });
  try {
    const url = await first.running;
    const port = new URL(url).port;
    const second = start({ PORT: port });
    const { code } = await second.exited;
    assert.equal(code, 1);
    assert.match(second.output().err, /port \d+ is already in use/);
    assert.doesNotMatch(second.output().err, /\n\s+at /);
  } finally {
    first.child.kill('SIGTERM');
    await first.exited;
  }
});
