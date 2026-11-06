// staticFiles.js
// Serves files from ONE folder (public/) and makes sure a request can never reach anything outside it.
//
// The danger is called PATH TRAVERSAL: a request like  GET /../../package.json  (or its disguises:
// /%2e%2e/, /..%2f, backslashes, a symlink inside the folder pointing out of it) tries to climb out of
// public/ and read private files such as .env. Defence here is layered, so one mistake is not enough to get through:
//   1. decode the path, and refuse "..", backslashes and null bytes outright
//   2. refuse dotfiles (.env, .git...)
//   3. join the path onto the folder and check the result is STILL inside it
//   4. ask the file system for the REAL path (following symlinks) and check THAT is still inside

import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { HttpError } from './errors.js';

// What kind of file is it? The browser relies on this to know what to do with the bytes.
const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
});

// Is `child` the same as `parent`, or somewhere inside it? (relative() starting with ".." means "outside".)
function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

const notFound = () => new HttpError(404, 'NOT_FOUND', 'File not found');
const badPath = () => new HttpError(400, 'BAD_REQUEST', 'Invalid path');

export function createStaticFiles(publicDir) {
  const root = path.resolve(publicDir);
  let realRootPromise; // the folder's real path, looked up once (symlinks resolved)

  /** Works out which file a request path means, or throws 400 / 404. Does NOT read the file. */
  async function locate(rawPathname) {
    // 1. Split into segments and decode each ("%2e%2e" becomes ".."). Decoding BEFORE checking is the whole point:
    //    checking the raw text would miss every disguised "..".
    const segments = [];
    for (const raw of rawPathname.split('/')) {
      let part;
      try {
        part = decodeURIComponent(raw);
      } catch {
        throw badPath();
      }
      if (part.includes('\0') || part.includes('\\') || part.includes('/')) throw badPath(); // null byte, Windows separator, encoded slash
      if (part === '..') throw badPath(); // climbing: never allowed, however it was written
      if (part === '' || part === '.') continue; // "//" and "/./" mean nothing
      if (part.startsWith('.')) throw notFound(); // dotfiles (.env, .git): not served, and we don't say whether they exist
      segments.push(part);
    }

    // 2. Join onto the folder and check we are still inside (belt and braces: step 1 should make this impossible).
    let candidate = path.join(root, ...segments);
    if (!isInside(root, candidate)) throw badPath();

    // 3. Ask the file system what is there. A folder means "its index.html".
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) candidate = path.join(candidate, 'index.html');
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'ENAMETOOLONG', 'ELOOP'].includes(error.code)) throw notFound();
      throw error; // anything else (permissions...) is a real problem: let it become a 500
    }

    // 4. The REAL path, with every symlink followed. A link inside public/ that points outside ends here.
    let real;
    try {
      real = await realpath(candidate);
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'ENAMETOOLONG', 'ELOOP'].includes(error.code)) throw notFound();
      throw error;
    }
    realRootPromise ??= realpath(root);
    if (!isInside(await realRootPromise, real)) throw notFound();

    const info = await stat(real);
    if (!info.isFile()) throw notFound();
    return { file: real, size: info.size };
  }

  /** Sends the file for this request path. `head` means: headers only, no body. */
  async function serve(rawPathname, res, { head = false } = {}) {
    const { file, size } = await locate(rawPathname);
    const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

    const headers = {
      'Content-Type': type,
      'Content-Length': size,
      'Cache-Control': 'no-cache', // the browser may keep a copy but must check it is still fresh
      'X-Content-Type-Options': 'nosniff', // "believe my Content-Type, don't guess": stops a text file being run as a script
    };
    // Web pages may only load things from this same server. (When a built React app is served from here later,
    // this line is the first place to look if the browser blocks a font or a script.)
    if (type.startsWith('text/html')) headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:";

    if (head) {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    // Open the file BEFORE sending any headers: if opening fails we can still answer with a proper error.
    const stream = createReadStream(file);
    await new Promise((resolve, reject) => {
      stream.once('open', resolve);
      stream.once('error', reject);
    });
    res.writeHead(200, headers);
    try {
      await pipeline(stream, res); // copies the file to the client, and cleans up if either side gives up
    } catch (error) {
      // The client closed the connection half way: nothing to report. Any other read error is a real problem.
      if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw error;
    }
  }

  return { serve, locate };
}
