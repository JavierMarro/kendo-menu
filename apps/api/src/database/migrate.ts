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
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
      migrationsSchema: schema,
    });
  } catch {
    failed = true;
  } finally {
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
