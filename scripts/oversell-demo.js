import { createDatabase } from '../src/db/connection.js';
import { createMockPaymentGateway } from '../src/lib/mockPaymentGateway.js';
import { createSqliteRepository } from '../src/repositories/sqlite.js';
import { createServices } from '../src/services/index.js';

const ATTEMPTS = 50;

function barrierRepository(repository) {
  let enabled = false;
  let arrivals = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  return Object.freeze({
    ...repository,
    arm() {
      arrivals = 0;
      enabled = true;
    },
    disarm() {
      enabled = false;
    },
    async getTier(id) {
      const tier = await repository.getTier(id);
      if (!enabled) return tier;
      arrivals += 1;
      if (arrivals === ATTEMPTS) release();
      await gate;
      return tier;
    },
  });
}

async function showVulnerableRace(database, tier) {
  database.exec(`
    CREATE TABLE vulnerable_tiers (
      id TEXT PRIMARY KEY,
      capacity INTEGER NOT NULL,
      sold INTEGER NOT NULL CHECK (sold >= 0)
    ) STRICT;
    CREATE TABLE vulnerable_bookings (
      id INTEGER PRIMARY KEY,
      tier_id TEXT NOT NULL
    ) STRICT;
  `);
  const insertTier = database.prepare('INSERT INTO vulnerable_tiers (id, capacity, sold) VALUES (?, ?, ?)');
  const readTier = database.prepare('SELECT capacity, sold FROM vulnerable_tiers WHERE id = ?');
  const insertBooking = database.prepare('INSERT INTO vulnerable_bookings (tier_id) VALUES (?)');
  const updateSold = database.prepare('UPDATE vulnerable_tiers SET sold = sold + ? WHERE id = ?');
  insertTier.run(tier.id, tier.capacity, tier.sold);

  const outcomes = await Promise.all(Array.from({ length: ATTEMPTS }, async () => {
    const snapshot = readTier.get(tier.id);
    if (snapshot.sold + 1 > snapshot.capacity) return false;
    await Promise.resolve();
    insertBooking.run(tier.id);
    updateSold.run(1, tier.id);
    return true;
  }));
  const sold = readTier.get(tier.id).sold;
  return { successes: outcomes.filter(Boolean).length, sold, capacity: tier.capacity };
}

const database = createDatabase(':memory:');
try {
  const baseRepository = createSqliteRepository(database);
  const repository = barrierRepository(baseRepository);
  const services = createServices({
    repository,
    paymentGateway: createMockPaymentGateway(),
  });
  const startsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const event = await services.events.create({
    title: 'Last ticket race',
    city: 'Lagos',
    venue: 'Test Hall',
    startsAt,
  });
  const tier = await services.events.addTier(event.id, {
    name: 'Last seat',
    priceCents: 500,
    capacity: 1,
  });
  await services.events.publish(event.id);

  const before = await showVulnerableRace(database, tier);
  console.log(`Before fix (check then write): ${before.successes} succeeded; sold ${before.sold}/${before.capacity}.`);

  repository.arm();
  const outcomes = await Promise.all(Array.from({ length: ATTEMPTS }, async (_, index) => {
    try {
      await services.bookings.book({
        eventId: event.id,
        tierId: tier.id,
        quantity: 1,
        customer: `Attendee ${index + 1}`,
      }, `attendee-${index + 1}`);
      return 'succeeded';
    } catch (error) {
      if (error.code === 'SOLD_OUT') return 'SOLD_OUT';
      throw error;
    }
  }));
  repository.disarm();

  const afterTier = await baseRepository.getTier(tier.id);
  const succeeded = outcomes.filter((outcome) => outcome === 'succeeded').length;
  const soldOut = outcomes.filter((outcome) => outcome === 'SOLD_OUT').length;
  console.log(`After fix (atomic SQLite reservation): ${succeeded} succeeded, ${soldOut} SOLD_OUT; sold ${afterTier.sold}/${afterTier.capacity}.`);
  if (before.successes <= 1 || succeeded !== 1 || soldOut !== ATTEMPTS - 1 || afterTier.sold > afterTier.capacity) {
    process.exitCode = 1;
  }
} finally {
  database.close();
}
