import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/connection.js';
import { createAuthService } from '../src/services/authService.js';
import { createSqliteRepository } from '../src/repositories/sqlite.js';

const config = loadConfig();
const email = process.env.STAFF_EMAIL;
const password = process.env.STAFF_PASSWORD;
if (!email || !password) {
  console.error('Set STAFF_EMAIL and STAFF_PASSWORD to provision a staff account.');
  process.exit(1);
}

const database = createDatabase(config.databasePath);
try {
  const auth = createAuthService({
    repository: createSqliteRepository(database),
    tokenSecret: config.tokenSecret,
  });
  await auth.provisionStaff({ email, password });
  console.log('Staff account provisioned.');
} catch (error) {
  console.error(`Could not provision staff account: ${error.code ?? 'ERROR'} ${error.message}`);
  process.exitCode = 1;
} finally {
  database.close();
}
