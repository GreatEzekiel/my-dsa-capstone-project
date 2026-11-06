// config.js
// ALL settings that come from the outside (environment variables) are read here, once, checked, and turned into
// one frozen object. The rest of the program never reads process.env itself.
//
//   PORT   the port to listen on. Default 3000. 0 means "pick any free port".
//   HOST   the address to listen on. Default 127.0.0.1 (this computer only). Use 0.0.0.0 inside a container.

import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 3000;
export const DEFAULT_HOST = '127.0.0.1';

// A configuration mistake is a different kind of error from a bad request: it stops the server from starting.
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

// PORT must be digits only. (parseInt("3000abc") gives 3000: it silently ignores the junk, so we don't use it.)
function readPort(value) {
  if (value === undefined || value.trim() === '') return DEFAULT_PORT;
  const text = value.trim();
  const port = /^\d{1,5}$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(port) || port > 65535) {
    throw new ConfigError(`PORT must be a whole number from 0 to 65535, but it is ${JSON.stringify(value)}`);
  }
  return port;
}

export function loadConfig(env = process.env, argv = process.argv.slice(2)) {
  return Object.freeze({
    port: readPort(env.PORT),
    host: env.HOST?.trim() || DEFAULT_HOST,
    // The folder next to src/: the project's public/ folder, wherever the project is on disk.
    publicDir: fileURLToPath(new URL('../public', import.meta.url)),
    maxBodyBytes: 1_000_000,
  });
}
