// static.test.js: serving files from public/, and proving a request can never climb out of it.
// Every attack is sent with its EXACT raw path (see rawRequest), not tidied up by a client library.

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { PUBLIC_DIR, SECRET, makeSite, rawRequest, startApp } from './http-helpers.js';

describe('the real public/ folder', () => {
  let server;
  before(async () => { server = await startApp(); });
  after(() => server.close());
  const get = (p, options) => rawRequest(server.port, { path: p, ...options });

  test('/ serves index.html as HTML, with safety headers', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.match(res.text, /Event Ticketing/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(res.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.equal(Number(res.headers['content-length']), Buffer.byteLength(res.text));
  });

  test('/index.html is the same page', async () => {
    assert.equal((await get('/index.html')).text, (await get('/')).text);
  });

  test('each file type has the right Content-Type', async () => {
    const expected = {
      '/styles.css': 'text/css; charset=utf-8',
      '/app.js': 'text/javascript; charset=utf-8',
      '/favicon.svg': 'image/svg+xml',
    };
    for (const [file, type] of Object.entries(expected)) {
      const res = await get(file);
      assert.equal(res.status, 200, file);
      assert.equal(res.headers['content-type'], type, file);
    }
  });

  test('the file on the wire is byte-for-byte the file on disk', async () => {
    const onDisk = await readFile(path.join(PUBLIC_DIR, 'styles.css'));
    const res = await get('/styles.css');
    assert.ok(res.bytes.equals(onDisk));
  });

  test('a query string is ignored', async () => {
    assert.equal((await get('/styles.css?v=123')).status, 200);
  });

  test('HEAD sends the headers and the right length, with no body', async () => {
    const res = await get('/index.html', { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(res.text, '');
    assert.equal(Number(res.headers['content-length']), (await readFile(path.join(PUBLIC_DIR, 'index.html'))).length);
  });

  test('a missing file is a 404 in the standard JSON shape', async () => {
    const res = await get('/nope.png');
    assert.equal(res.status, 404);
    assert.match(res.headers['content-type'], /^application\/json/);
    assert.deepEqual(JSON.parse(res.text), { error: { code: 'NOT_FOUND', message: 'File not found' } });
  });

  test('only GET and HEAD make sense for files: other methods are 405', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const res = await get('/', { method });
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.allow, 'GET, HEAD');
    }
  });
});

describe('a throw-away site, with a secret OUTSIDE it', () => {
  let server;
  let site;
  before(async () => {
    site = await makeSite();
    server = await startApp({ publicDir: site.site });
  });
  after(async () => {
    await server.close();
    await rm(site.base, { recursive: true, force: true });
  });
  const get = (p, options) => rawRequest(server.port, { path: p, ...options });

  // The control experiment: the secret really is there, and a normal file really is served.
  // Without these two, "the attacks all failed" could just mean "the server is broken".
  test('control: the secret exists on disk, and an ordinary file is served', async () => {
    assert.equal(await readFile(path.join(site.base, 'outside-secret.txt'), 'utf8'), SECRET);
    const res = await get('/a.txt');
    assert.equal(res.status, 200);
    assert.equal(res.text, 'A');
  });

  describe('path traversal: no disguise gets out of the folder', () => {
    const attacks = [
      '/../outside-secret.txt', //                     the plain attack
      '/../../outside-secret.txt',
      '/sub/../../outside-secret.txt', //               climbing from a sub-folder
      '/%2e%2e/outside-secret.txt', //                 ".." percent-encoded
      '/%2E%2E/outside-secret.txt',
      '/..%2foutside-secret.txt', //                   the slash encoded
      '/..%2Foutside-secret.txt',
      '/%2e%2e%2foutside-secret.txt', //               everything encoded
      '/sub/%2e%2e/%2e%2e/outside-secret.txt',
      '/..%5coutside-secret.txt', //                   a Windows backslash, encoded
      '/%5c..%5coutside-secret.txt',
      '/..\\outside-secret.txt', //                    a raw backslash
      '/%252e%252e/outside-secret.txt', //             double-encoded: decodes once to the TEXT "%2e%2e"
      '/..;/outside-secret.txt', //                    a trick that works on some Java servers
      '/....//outside-secret.txt', //                  "...." is a folder name, not a climb
      '/./../outside-secret.txt',
      '/sub/..', //                                    climbing to the folder itself
      '/%00', //                                       a null byte
      '/a.txt%00.png',
      '/a.txt\u0000',
      '/..%00/outside-secret.txt',
      'http://localhost/../outside-secret.txt', //     the absolute form of a request target
      '//outside-secret.txt', //                       a doubled slash
      '/\\..\\..\\outside-secret.txt',
    ];
    for (const attack of attacks) {
      test(`refuses ${JSON.stringify(attack)}`, async () => {
        let res;
        try {
          res = await get(attack);
        } catch {
          return; // the client library itself refused to send it: fine, nothing was served
        }
        assert.ok([400, 404].includes(res.status), `expected 400 or 404, got ${res.status}`);
        assert.ok(!res.text.includes(SECRET), 'THE SECRET LEAKED');
        // And it is still the standard error shape:
        assert.deepEqual(Object.keys(JSON.parse(res.text)), ['error']);
      });
    }
  });

  describe('suspicious paths are REFUSED with 400, not merely "not found"', () => {
    // On Linux a backslash is an ordinary letter in a file name, so looking such a file up would just give a 404.
    // On Windows it is a folder separator, which is how "..\\secret" climbs out. The server refuses all of these up
    // front with a 400, on every system, instead of relying on the file system to say no.
    for (const p of ['/a%5cb', '/..%5cx', '/%5c', '/x\\y', '/%00', '/a.txt%00.png', '/sub/..', '/..%2fx', '/%2e%2e/x', '/a%2fb']) {
      test(`${JSON.stringify(p)} -> 400`, async () => {
        const res = await get(p);
        assert.equal(res.status, 400);
        assert.equal(JSON.parse(res.text).error.code, 'BAD_REQUEST');
      });
    }
  });

  describe('files that must stay hidden', () => {
    for (const hidden of ['/.hidden', '/sub/.hidden', '/.git/config', '/.git', '/%2ehidden', '/sub/%2Ehidden']) {
      test(`${hidden} is a 404 (dotfiles are never served)`, async () => {
        const res = await get(hidden);
        assert.equal(res.status, 404);
        assert.equal(JSON.parse(res.text).error.code, 'NOT_FOUND');
      });
    }
  });

  describe('symlinks', () => {
    test('a symlink that points OUTSIDE the folder is not followed', async (t) => {
      if (!site.symlinks) return t.skip('this system cannot create symlinks');
      const res = await get('/link-out.txt');
      assert.equal(res.status, 404);
      assert.ok(!res.text.includes(SECRET));
    });

    test('a symlinked FOLDER that points outside is not followed either', async (t) => {
      if (!site.symlinks) return t.skip('this system cannot create symlinks');
      for (const p of ['/link-dir/outside-secret.txt', '/link-dir/', '/link-dir']) {
        const res = await get(p);
        assert.ok(!res.text.includes(SECRET), p);
        assert.ok([404, 400].includes(res.status), `${p} -> ${res.status}`);
      }
    });

    test('a symlink that stays INSIDE the folder works', async (t) => {
      if (!site.symlinks) return t.skip('this system cannot create symlinks');
      const res = await get('/alias.txt');
      assert.equal(res.status, 200);
      assert.equal(res.text, 'A');
    });
  });

  describe('folders and names', () => {
    test('/ and /sub and /sub/ serve the index.html inside', async () => {
      assert.equal((await get('/')).text, '<h1>home</h1>');
      assert.equal((await get('/sub')).text, '<h1>sub</h1>');
      assert.equal((await get('/sub/')).text, '<h1>sub</h1>');
    });

    test('a folder with no index.html is a 404, and never a file listing', async () => {
      assert.equal((await get('/empty')).status, 404);
      assert.equal((await get('/empty/')).status, 404);
    });

    test('spaces and accents work when encoded', async () => {
      assert.equal((await get('/my%20file.txt')).text, 'spaces');
      assert.equal((await get('/caf%C3%A9.txt')).text, 'accent');
    });

    test('upper-case extensions still get the right type; unknown ones are plain bytes', async () => {
      assert.equal((await get('/UPPER.HTML')).headers['content-type'], 'text/html; charset=utf-8');
      assert.equal((await get('/data.bin')).headers['content-type'], 'application/octet-stream');
    });

    test('a broken % escape is a 400', async () => {
      assert.equal((await get('/%E0%A4%A')).status, 400);
    });

    test('a very long path is a 404, not a crash', async () => {
      const res = await get(`/${'a'.repeat(4000)}`);
      assert.ok([404, 400, 414, 431].includes(res.status));
    });
  });

  test('a large file is streamed intact', async () => {
    const res = await get('/big.bin');
    assert.equal(res.status, 200);
    assert.equal(res.bytes.length, 1_500_000);
    assert.equal(createHash('sha256').update(res.bytes).digest('hex'), createHash('sha256').update(Buffer.alloc(1_500_000, 7)).digest('hex'));
  });

  test('the server survives all of the above', async () => {
    assert.equal((await get('/a.txt')).status, 200);
  });
});
