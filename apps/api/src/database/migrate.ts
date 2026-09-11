/**
 * Applies reviewed Drizzle migrations through one short-lived PostgreSQL client.
 * Connection and driver details are collapsed into fixed failures so command
 * output cannot leak credentials or database diagnostics.
 */
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

export interface MigrationOptions {
  connectionString: string;
  schema?: string;
}

/** Explicit command/test boundary; never imported by the HTTP application. */
export async function migrateDatabase({ connectionString, schema = 'public' }: MigrationOptions) {
  if (!connectionString || !/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error('MIGRATION_CONFIGURATION_INVALID');
  }
  let client: Client;
  try {
    // The schema name is validated before being placed in PostgreSQL options.
    // A statement timeout also bounds a stuck migration instead of holding the
    // dedicated connection indefinitely.
    client = new Client({
      connectionString,
      connectionTimeoutMillis: 5_000,
      options: `-c search_path=${schema} -c statement_timeout=15000`,
    });
  } catch {
    throw new Error('MIGRATION_CONFIGURATION_INVALID');
  }
  // Idle client errors must not expose driver diagnostics or become uncaught events.
  client.on('error', () => undefined);
  let failed = false;
  try {
    await client.connect();
    // Drizzle records applied files in the selected schema. Tests can therefore
    // exercise the production migration chain in isolation without modifying
    // `public` or maintaining a second test-only schema definition.
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
      migrationsSchema: schema,
    });
  } catch {
    failed = true;
  } finally {
    // Closing is part of command correctness: a migration is not reported as
    // successful when its dedicated client cannot be shut down cleanly.
    try {
      await client.end();
    } catch {
      failed = true;
    }
  }
  if (failed) {
    throw new Error('MIGRATION_FAILED');
  }
}
