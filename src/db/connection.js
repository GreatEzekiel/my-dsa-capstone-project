import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export function createDatabase(databasePath = ':memory:') {
  if (typeof databasePath !== 'string' || databasePath.trim() === '') {
    throw new TypeError('createDatabase needs a database path');
  }
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  database.exec(SCHEMA);
  return database;
}

export const DEFAULT_DATABASE_PATH = fileURLToPath(new URL('../../data/event-ticketing.sqlite', import.meta.url));
