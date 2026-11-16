import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../src/db/connection.js';
import { createSqliteRepository } from '../src/repositories/sqlite.js';

const SEED_SCRIPT = fileURLToPath(new URL('../scripts/seed.js', import.meta.url));

test('SQLite schema enforces foreign keys, unique references and ticket capacity checks', async () => {
  const database = createDatabase(':memory:');
  try {
    const repository = createSqliteRepository(database);
    const tables = database.prepare(`
      SELECT name FROM sqlite_master WHERE type = ? ORDER BY name
    `).all('table').map((row) => row.name);
    assert.deepEqual(tables, ['bookings', 'events', 'ticket_tiers', 'users', 'waitlist_entries']);

    await assert.rejects(repository.createTier({
      id: 'orphan-tier',
      eventId: 'missing-event',
      name: 'GA',
      priceCents: 500,
      capacity: 1,
      sold: 0,
    }), /FOREIGN KEY constraint failed/);

    const event = {
      id: 'event-1',
      title: 'SQLite test',
      city: 'Lagos',
      venue: 'Hall',
      startsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      status: 'published',
    };
    await repository.createEvent(event);
    await assert.rejects(repository.createEvent(event), /UNIQUE constraint failed/);
    assert.throws(() => database.prepare(`
      INSERT INTO ticket_tiers (id, event_id, name, price_cents, capacity, sold)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('over-capacity-tier', event.id, 'Broken', 500, 1, 2), /CHECK constraint failed/);

    const tier = await repository.createTier({
      id: 'tier-1',
      eventId: event.id,
      name: 'GA',
      priceCents: 500,
      capacity: 3,
      sold: 0,
    });
    const firstBooking = {
      id: 'booking-1',
      reference: 'ABCD-EFGH',
      eventId: event.id,
      tierId: tier.id,
      userId: 'attendee-1',
      quantity: 1,
      customer: 'Ada',
      totalCents: 500,
      status: 'pending',
      createdAt: new Date().toISOString(),
      history: [{ status: 'pending', at: new Date().toISOString() }],
    };
    await repository.createBooking(firstBooking);
    await assert.rejects(repository.createBooking({
      ...firstBooking,
      id: 'booking-2',
      userId: 'attendee-2',
    }), /UNIQUE constraint failed/);
    assert.equal((await repository.getTier(tier.id)).sold, 1);
    assert.equal((await repository.getBookingByReference('abcd efgh')).reference, 'ABCD-EFGH');
  } finally {
    database.close();
  }
});

test('the seed script fills an empty database once and leaves existing data unchanged', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ticketing-seed-'));
  const databasePath = path.join(directory, 'seed.sqlite');
  try {
    const runSeed = () => spawnSync(process.execPath, [SEED_SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_PATH: databasePath },
    });
    const first = runSeed();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Seeded 5 events/);
    const second = runSeed();
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /already contains 5 event/);

    const database = createDatabase(databasePath);
    try {
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM events').get().count, 5);
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
