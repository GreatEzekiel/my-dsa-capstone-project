// http-helpers.js: tools for the tests that talk to a REAL server over a REAL network connection.
// (Not a test file: the name does not end in .test.js.)

import http from 'node:http';
import net from 'node:net';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/http/app.js';
import { registerRoutes } from '../src/http/routes.js';
import { createServices } from '../src/services/index.js';

// The project's real public/ folder.
export const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

/**
 * Starts the app on any free port. Returns { app, port, url, logs, close }.
 * `logs` collects what the app wrote to its logger, so a test can check that a bug's stack trace went THERE
 * and not to the client. `extraRoutes(router)` adds routes that exist only for this test.
 */
export async function startApp({ extraRoutes, publicDir = PUBLIC_DIR, maxBodyBytes, onlyExtra = false } = {}) {
  const logs = { info: [], error: [] };
  const app = createApp({
    services: createServices(),
    publicDir,
    maxBodyBytes,
    logger: { info: (text) => logs.info.push(text), error: (text) => logs.error.push(text) },
    routes: (router, services) => {
      if (!onlyExtra) registerRoutes(router, services); // the real routes...
      extraRoutes?.(router, services); // ...plus this test's own
    },
  });
  const { port, url } = await app.listen(0);
  return { app, port, url, logs, close: () => app.close({ forceAfterMs: 0 }) };
}

/**
 * Sends a request with EXACTLY the path you give. fetch() and new URL() "tidy" a path first (they remove "/../"),
 * which would hide the very attacks we want to try. This sends the raw text.
 * Resolves with { status, headers, text }.
 */
export function rawRequest(port, { method = 'GET', path: target = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8'), bytes: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Sends raw bytes over a plain TCP socket (for requests that are not even valid HTTP). Resolves with what came back. */
export function rawSocket(port, text) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(text));
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
    socket.setTimeout(3000, () => socket.destroy());
  });
}

// The words that appear in a stack trace. None of them may ever reach a client.
export const STACK_HINTS = [/\n\s+at /, /node:internal/, /\.js:\d+/, /file:\/\//, /\/home\//, /node_modules/];

export const SECRET = 'TOP-SECRET-DO-NOT-SERVE';

/**
 * Makes a throw-away web site folder inside a temp folder, with a secret file OUTSIDE it:
 *
 *   <tmp>/outside-secret.txt        <- must never be served
 *   <tmp>/site/                     <- the "public" folder
 *       index.html  a.txt  my file.txt  café.txt  data.bin  big.bin  UPPER.HTML
 *       .hidden  .git/config
 *       sub/index.html  sub/.hidden  empty/ (a folder with no index.html)
 *       alias.txt        -> a.txt           (a symlink that stays inside)
 *       link-out.txt     -> ../outside-secret.txt   (a symlink that ESCAPES)
 *       link-dir         -> ..              (a folder symlink that ESCAPES)
 */
export async function makeSite() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'ticketing-site-'));
  const site = path.join(base, 'site');
  await mkdir(path.join(site, 'sub'), { recursive: true });
  await mkdir(path.join(site, 'empty'));
  await mkdir(path.join(site, '.git'));
  await writeFile(path.join(base, 'outside-secret.txt'), SECRET);
  await writeFile(path.join(site, 'index.html'), '<h1>home</h1>');
  await writeFile(path.join(site, 'a.txt'), 'A');
  await writeFile(path.join(site, 'my file.txt'), 'spaces');
  await writeFile(path.join(site, 'café.txt'), 'accent');
  await writeFile(path.join(site, 'data.bin'), Buffer.from([1, 2, 3]));
  await writeFile(path.join(site, 'UPPER.HTML'), '<p>upper</p>');
  await writeFile(path.join(site, 'big.bin'), Buffer.alloc(1_500_000, 7)); // bigger than one chunk: proves streaming works
  await writeFile(path.join(site, '.hidden'), 'hidden');
  await writeFile(path.join(site, '.git', 'config'), 'git');
  await writeFile(path.join(site, 'sub', 'index.html'), '<h1>sub</h1>');
  await writeFile(path.join(site, 'sub', '.hidden'), 'hidden');

  let symlinks = true;
  try {
    await symlink(path.join(site, 'a.txt'), path.join(site, 'alias.txt'));
    await symlink(path.join('..', 'outside-secret.txt'), path.join(site, 'link-out.txt'));
    await symlink('..', path.join(site, 'link-dir'));
  } catch {
    symlinks = false; // some systems (Windows without rights) can't make symlinks: those tests skip themselves
  }
  return { base, site, symlinks };
}
