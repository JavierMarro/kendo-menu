import { migrateDatabase } from './migrate.js';

const connectionString = process.env['MIGRATION_DATABASE_URL'];
if (!connectionString) {
  process.stderr.write('MIGRATION_DATABASE_URL_REQUIRED\n');
  process.exitCode = 1;
} else {
  try {
    await migrateDatabase({ connectionString });
    process.stdout.write('MIGRATIONS_APPLIED\n');
  } catch {
    process.stderr.write('MIGRATION_FAILED\n');
    process.exitCode = 1;
  }
}
