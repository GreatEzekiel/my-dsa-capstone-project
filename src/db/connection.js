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
  const columns = (table) => new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  const userColumns = columns('users');
  if (!userColumns.has('email')) database.exec('ALTER TABLE users ADD COLUMN email TEXT');
  if (!userColumns.has('password_hash')) database.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  if (!userColumns.has('role')) database.exec('ALTER TABLE users ADD COLUMN role TEXT');
  const eventColumns = columns('events');
  if (!eventColumns.has('organizer_id')) database.exec('ALTER TABLE events ADD COLUMN organizer_id TEXT REFERENCES users(id) ON DELETE SET NULL');
  const bookingColumns = columns('bookings');
  if (!bookingColumns.has('expires_at')) database.exec('ALTER TABLE bookings ADD COLUMN expires_at TEXT');
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users(email)');
  database.exec('CREATE INDEX IF NOT EXISTS events_organizer_id_idx ON events(organizer_id)');
  return database;
}

export const DEFAULT_DATABASE_PATH = fileURLToPath(new URL('../../data/event-ticketing.sqlite', import.meta.url));
