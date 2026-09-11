/**
 * Destructive-test containment for real PostgreSQL integration checks.
 *
 * Only the designated local `kendomenu_test` database is accepted. Each run
 * owns a random schema, applies the production migrations there, and removes
 * only that schema during teardown—never the shared public schema or database.
 */
import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import {
  createPostgresPersistence,
  type PostgresPersistence,
} from '../persistence/postgres/adapter.js';
import { migrateDatabase } from './migrate.js';

const TEST_DATABASE_NAME = 'kendomenu_test';
const TEST_DATABASE_CONFIGURATION_INVALID = 'TEST_DATABASE_CONFIGURATION_INVALID';
const TEST_DATABASE_CONNECTION_FAILED = 'TEST_DATABASE_CONNECTION_FAILED';
const TEST_DATABASE_CLEANUP_FAILED = 'TEST_DATABASE_CLEANUP_FAILED';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export type TestDatabaseUrlErrorCode =
  | typeof TEST_DATABASE_CONFIGURATION_INVALID
  | typeof TEST_DATABASE_CONNECTION_FAILED
  | typeof TEST_DATABASE_CLEANUP_FAILED;

export interface TestDatabaseOptions {
  readonly clock?: () => Date;
}

export interface TestDatabase {
  persistence: PostgresPersistence;
  client: Client;
  schema: string;
  close: () => Promise<void>;
}

/**
 * Validate a test connection before any socket is opened.
 *
 * The test harness intentionally accepts only the designated local test database.
 * Query parameters are rejected because libpq/pg options can otherwise redirect the
 * connection or change TLS/search-path behavior without being visible in the harness.
 */
export function validateTestDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error(TEST_DATABASE_CONFIGURATION_INVALID);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(TEST_DATABASE_CONFIGURATION_INVALID);
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error(TEST_DATABASE_CONFIGURATION_INVALID);
  }

  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    !LOCAL_HOSTS.has(host) ||
    databaseName !== TEST_DATABASE_NAME ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    url.pathname !== `/${TEST_DATABASE_NAME}`
  ) {
    throw new Error(TEST_DATABASE_CONFIGURATION_INVALID);
  }

  return value;
}

function quoteIdentifier(identifier: string): string {
  // Schema identifiers cannot use query parameters, so validate the complete
  // generated shape before quoting it. Only harness-created names reach SQL.
  if (!/^km_test_[a-f0-9]{32}$/.test(identifier)) {
    throw new Error(TEST_DATABASE_CONFIGURATION_INVALID);
  }
  return `"${identifier}"`;
}

function makeSchemaName(): string {
  return `km_test_${randomUUID().replaceAll('-', '')}`;
}

function createClient(connectionString: string, schema?: string): Client {
  const options = schema
    ? `-c search_path=${quoteIdentifier(schema).slice(1, -1)} -c statement_timeout=15000`
    : '-c statement_timeout=15000';
  try {
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 5_000,
      options,
    });
    client.on('error', () => undefined);
    return client;
  } catch {
    throw new Error(TEST_DATABASE_CONFIGURATION_INVALID);
  }
}

async function verifyTestDatabase(client: Client): Promise<void> {
  // URL inspection alone is not enough: the server confirms the database that
  // accepted the connection before any CREATE or DROP statement is issued.
  const result = await client.query<{ database_name: string }>(
    'SELECT current_database() AS database_name',
  );
  if (result.rows[0]?.database_name !== TEST_DATABASE_NAME) {
    throw new Error(TEST_DATABASE_CONFIGURATION_INVALID);
  }
}

/**
 * Create a uniquely named schema, apply the real Drizzle migrations to it, and
 * return a client whose search path points only at that schema.
 *
 * The adapter is created only after the schema has been migrated. Tests can pass
 * a deterministic clock through the harness options without changing production
 * connection behavior.
 */
export async function createTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const connectionString = validateTestDatabaseUrl(process.env['TEST_DATABASE_URL']);
  const schema = makeSchemaName();
  const admin = createClient(connectionString);
  let schemaCreated = false;
  let setupFailed = false;
  let cleanupFailed = false;

  try {
    await admin.connect();
    await verifyTestDatabase(admin);
    await admin.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    schemaCreated = true;
    await migrateDatabase({ connectionString, schema });
  } catch {
    setupFailed = true;
  } finally {
    try {
      await admin.end();
    } catch {
      cleanupFailed = true;
    }
  }
  if (setupFailed || cleanupFailed) {
    if (schemaCreated) {
      try {
        await dropSchema(connectionString, schema);
      } catch {
        cleanupFailed = true;
      }
    }
    throw new Error(cleanupFailed ? TEST_DATABASE_CLEANUP_FAILED : TEST_DATABASE_CONNECTION_FAILED);
  }

  const client = createClient(connectionString, schema);
  try {
    await client.connect();
    await verifyTestDatabase(client);
    await client.query(`SET search_path TO ${quoteIdentifier(schema)}`);
    const persistence = createPostgresPersistence(
      options.clock === undefined
        ? { connectionString, schema }
        : { connectionString, schema, clock: options.clock },
    );
    let closed = false;
    return {
      persistence,
      client,
      schema,
      close: async () => {
        if (closed) {
          return;
        }
        closed = true;
        // Attempt every teardown step even if an earlier one fails. The fixed
        // final error reports that manual inspection may be needed without
        // exposing connection or driver details.
        let teardownFailed = false;
        try {
          await persistence.close();
        } catch {
          teardownFailed = true;
        }
        try {
          await client.end();
        } catch {
          teardownFailed = true;
        }
        try {
          await dropSchema(connectionString, schema);
        } catch {
          teardownFailed = true;
        }
        if (teardownFailed) {
          throw new Error(TEST_DATABASE_CLEANUP_FAILED);
        }
      },
    };
  } catch {
    try {
      await client.end();
    } catch {
      cleanupFailed = true;
    }
    try {
      await dropSchema(connectionString, schema);
    } catch {
      cleanupFailed = true;
    }
    throw new Error(cleanupFailed ? TEST_DATABASE_CLEANUP_FAILED : TEST_DATABASE_CONNECTION_FAILED);
  }
}

async function dropSchema(connectionString: string, schema: string): Promise<void> {
  // CASCADE is intentionally limited to the validated random schema owned by
  // this test run. The database itself and its shared `public` schema are never
  // deletion targets for this harness.
  const client = createClient(connectionString);
  let failed = false;
  try {
    await client.connect();
    await verifyTestDatabase(client);
    await client.query(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`);
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
    throw new Error(TEST_DATABASE_CLEANUP_FAILED);
  }
}
