// server.js: the program you start with `npm start`.
// It is the COMPOSITION ROOT: the one place that creates things and plugs them together
// (config -> services -> app). Everything else receives what it needs; nothing else creates the world.

import { ConfigError, loadConfig } from './config.js';
import { createStore } from './domain/inventory.js';
import { createApp } from './http/app.js';
import { seedDemoData } from './services/demoData.js';
import { createServices } from './services/index.js';

// The real logger: lines on the terminal. Errors go to stderr.
const logger = {
  info: (text) => console.log(`${new Date().toISOString()} ${text}`),
  error: (text) => console.error(`${new Date().toISOString()} ERROR ${text}`),
};

let config;
try {
  config = loadConfig();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(`Cannot start: ${error.message}`); // a clear one-line message, no stack trace
  process.exit(1);
}

// The data lives in memory: it starts empty and is lost when the server stops (a database comes in a later build).
const store = createStore();
if (config.demo) seedDemoData(store); // sample events, so GET /api/events has something to show

const app = createApp({
  services: createServices({ store }),
  devRoutes: config.demo, // the practice-only route exists only in demo mode
  publicDir: config.publicDir,
  maxBodyBytes: config.maxBodyBytes,
  logger,
});

try {
  const { url } = await app.listen(config.port, config.host);
  console.log(`Event Ticketing is running at ${url}`);
  console.log(`  health check:  ${url}/health`);
  if (config.demo) console.log('  DEMO MODE: sample events loaded, and POST /api/dev/bookings/:reference/transition is available');
  console.log('  stop with Ctrl+C');
} catch (error) {
  // The usual cause: another program already uses this port.
  console.error(`Cannot start: ${error.code === 'EADDRINUSE' ? `port ${config.port} is already in use (try PORT=3001 npm start)` : error.message}`);
  process.exit(1);
}

// Ctrl+C (SIGINT) or a stop request from the system (SIGTERM): finish the requests in progress, then exit.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    console.log(`\n${signal} received: shutting down`);
    await app.close();
    process.exit(0);
  });
}
