import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/connection.js';
import { createMockPaymentGateway } from '../src/lib/mockPaymentGateway.js';
import { createSqliteRepository } from '../src/repositories/sqlite.js';
import { seedDemoData } from '../src/services/demoData.js';
import { createServices } from '../src/services/index.js';

const config = loadConfig();
const database = createDatabase(config.databasePath);

try {
  const repository = createSqliteRepository(database);
  const existing = await repository.listEvents();
  if (existing.length > 0) {
    console.log(`Database already contains ${existing.length} event(s); leaving it unchanged.`);
  } else {
    const services = createServices({
      repository,
      paymentGateway: createMockPaymentGateway(),
    });
    const events = await seedDemoData(services.events);
    console.log(`Seeded ${events.length} events into ${config.databasePath}.`);
  }
} finally {
  database.close();
}
