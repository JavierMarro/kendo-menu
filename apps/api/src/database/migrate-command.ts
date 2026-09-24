/**
 * Explicit migration command. Runtime requests never import this entry point or
 * apply schema changes automatically; an operator must supply the dedicated
 * migration connection deliberately.
 */
import { migrateDatabase } from './migrate.js';

const connectionString = process.env['MIGRATION_DATABASE_URL'];
if (!connectionString) {
  // Emit only a stable operator-facing code. Printing the missing value or a
  // driver exception here could expose credentials in local or CI logs.
  process.stderr.write('MIGRATION_DATABASE_URL_REQUIRED\n');
  process.exitCode = 1;
} else {
  try {
    await migrateDatabase({ connectionString });
    // This acknowledgement is reached only after migration and client shutdown
    // both complete. It is therefore safe for automation to treat as success.
    process.stdout.write('MIGRATIONS_APPLIED\n');
  } catch {
    process.stderr.write('MIGRATION_FAILED\n');
    process.exitCode = 1;
  }
}
