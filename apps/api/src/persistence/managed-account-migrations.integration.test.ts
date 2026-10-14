import { fileURLToPath } from 'node:url';

import { readMigrationFiles } from 'drizzle-orm/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../database/migrate.js';
import {
  createTestDatabase,
  validateTestDatabaseUrl,
  type TestDatabase,
} from '../database/test-database.js';

const folder = fileURLToPath(new URL('../../drizzle', import.meta.url));
const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
let database: TestDatabase;

beforeEach(async () => {
  database = await createTestDatabase();
});
afterEach(async () => {
  await database?.close();
});

async function migrateAgain() {
  await migrateDatabase({
    connectionString: validateTestDatabaseUrl(process.env['TEST_DATABASE_URL']),
    schema: database.schema,
  });
}

async function seedLegacyData() {
  await database.client.query(
    `INSERT INTO users (id, google_sub, verified_google_email, created_at, updated_at)
     VALUES ($1, 'legacy-preserved-subject', 'legacy@example.test', '2026-09-12', '2026-09-12')`,
    [userId],
  );
  await database.client.query(
    `INSERT INTO application_sessions
     (id, user_id, session_token_hash, csrf_token_hash, created_at, last_activity_at, idle_expires_at, absolute_expires_at)
     VALUES ($1, $2, $3, $4, '2026-09-12', '2026-09-12', '2026-09-19', '2026-10-12')`,
    [sessionId, userId, 'a'.repeat(64), 'b'.repeat(64)],
  );
  await database.client.query(
    `INSERT INTO login_transactions
     (state_hash, browser_binding_hash, nonce_hash, pkce_code_verifier, return_path, created_at, expires_at)
     VALUES ($1, $2, $3, $4, '/', '2026-09-12 00:00:00Z', '2026-09-12 00:10:00Z')`,
    ['c'.repeat(64), 'd'.repeat(64), 'e'.repeat(64), 'v'.repeat(43)],
  );
  await database.client.query(
    `INSERT INTO cloud_dashboards
     (user_id, revision, transport_version, catalogue_digest, dashboard_json, created_at, updated_at)
     VALUES ($1, 7, 1, $2, $3, '2026-09-12', '2026-09-13')`,
    [userId, 'f'.repeat(64), '{"version":10,"state":{"legacy":"preserve exact bytes é"}}'],
  );
  await database.client.query(
    `INSERT INTO dashboard_write_receipts
     (user_id, request_id, request_digest, acknowledged_revision, acknowledged_at, created_at)
     VALUES ($1, $2, $3, 7, '2026-09-13', '2026-09-13')`,
    [userId, requestId, 'a'.repeat(64)],
  );
  await database.client.query(
    `INSERT INTO account_adoptions
     (user_id, state, creating_session_id, created_at, updated_at)
     VALUES ($1, 'pending', $2, '2026-09-12', '2026-09-12')`,
    [userId, sessionId],
  );
}

async function legacyRows() {
  const result: unknown[] = [];
  result.push(
    (
      await database.client.query(
        'SELECT id, google_sub, verified_google_email, created_at, updated_at FROM users ORDER BY id',
      )
    ).rows,
  );
  for (const table of [
    'application_sessions',
    'login_transactions',
    'cloud_dashboards',
    'dashboard_write_receipts',
    'account_adoptions',
  ]) {
    result.push(
      (
        await database.client.query<{ data: string }>(
          `SELECT row_to_json(t)::text AS data FROM ${table} t ORDER BY row_to_json(t)::text`,
        )
      ).rows,
    );
  }
  return result;
}

async function restorePredecessor() {
  await seedLegacyData();
  await database.client.query('DROP TABLE account_copy_opportunities');
  await database.client.query('DROP TRIGGER IF EXISTS users_managed_identity_immutable ON users');
  await database.client.query('DROP FUNCTION IF EXISTS reject_managed_identity_change()');
  await database.client.query(
    'ALTER TABLE users DROP COLUMN managed_provider, DROP COLUMN managed_issuer, DROP COLUMN managed_subject',
  );
  await database.client.query('ALTER TABLE users ALTER COLUMN google_sub SET NOT NULL');
  const migration = readMigrationFiles({ migrationsFolder: folder })[3];
  if (migration === undefined) throw new Error('TEST_MANAGED_MIGRATION_MISSING');
  await database.client.query('DELETE FROM "__drizzle_migrations" WHERE created_at >= $1', [
    migration.folderMillis,
  ]);
}

describe('managed account forward migration', () => {
  it('preserves every legacy record without granting a managed mapping or opportunity and is repeatable', async () => {
    await restorePredecessor();
    const before = await legacyRows();
    await migrateAgain();
    expect(await legacyRows()).toEqual(before);
    expect((await database.client.query('SELECT * FROM account_copy_opportunities')).rows).toEqual(
      [],
    );
    expect(
      (
        await database.client.query(
          'SELECT managed_provider, managed_issuer, managed_subject FROM users',
        )
      ).rows,
    ).toEqual([{ managed_provider: null, managed_issuer: null, managed_subject: null }]);
    await migrateAgain();
    expect(await legacyRows()).toEqual(before);
    expect((await database.client.query('SELECT * FROM "__drizzle_migrations"')).rows).toHaveLength(
      readMigrationFiles({ migrationsFolder: folder }).length,
    );
  });

  it('rolls back new tables, identity columns and journal on a late migration failure', async () => {
    await restorePredecessor();
    const before = await legacyRows();
    // A conflicting index belongs only to this randomly owned harness schema.
    // B reaches its CREATE INDEX after table creation and ALTER TABLE statements.
    await database.client.query('CREATE INDEX users_managed_identity_key ON users (id)');
    await expect(migrateAgain()).rejects.toThrow('MIGRATION_FAILED');
    expect(await legacyRows()).toEqual(before);
    expect(
      (
        await database.client.query(
          "SELECT to_regclass('account_copy_opportunities')::text AS name",
        )
      ).rows,
    ).toEqual([{ name: null }]);
    expect(
      (
        await database.client.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = 'users' AND column_name LIKE 'managed_%'`,
          [database.schema],
        )
      ).rows,
    ).toEqual([]);
    expect((await database.client.query('SELECT * FROM "__drizzle_migrations"')).rows).toHaveLength(
      3,
    );
    await database.client.query('DROP INDEX users_managed_identity_key');
    await migrateAgain();
    expect(await legacyRows()).toEqual(before);
  });

  it('binds the new opportunity FK to the owned schema, never public.users', async () => {
    const rows = await database.client.query<{ referenced_schema: string }>(
      `SELECT n.nspname AS referenced_schema FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.confrelid JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE c.conrelid = 'account_copy_opportunities'::regclass AND c.contype = 'f'`,
    );
    expect(rows.rows).toEqual([{ referenced_schema: database.schema }]);
  });
});

describe('managed identity database invariants', () => {
  it.each([
    [null, 'https://issuer.example.test', 'subject'],
    ['neon', null, 'subject'],
    ['neon', 'https://issuer.example.test', null],
    ['other', 'https://issuer.example.test', 'subject'],
  ])(
    'rejects incomplete or wrong-provider mappings (%s, %s, %s)',
    async (provider, issuer, subject) => {
      await expect(
        database.client.query(
          'INSERT INTO users (managed_provider, managed_issuer, managed_subject) VALUES ($1, $2, $3)',
          [provider, issuer, subject],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    },
  );

  async function managedUser() {
    await database.client.query(
      `INSERT INTO users (id, managed_provider, managed_issuer, managed_subject)
       VALUES ($1, 'neon', 'https://issuer.example.test', 'subject-not-a-google-sub')`,
      [userId],
    );
  }

  it('allows null legacy Google subjects while enforcing unique managed mappings', async () => {
    await managedUser();
    await database.client.query(
      `INSERT INTO users (managed_provider, managed_issuer, managed_subject)
       VALUES ('neon', 'https://issuer.example.test', 'different-subject')`,
    );
    await expect(
      database.client.query(
        `INSERT INTO users (managed_provider, managed_issuer, managed_subject)
         VALUES ('neon', 'https://issuer.example.test', 'subject-not-a-google-sub')`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it.each([
    "managed_subject = 'replacement'",
    "managed_issuer = 'https://other.example.test'",
    'managed_provider = NULL, managed_issuer = NULL, managed_subject = NULL',
  ])('forbids managed identity reassignment: %s', async (assignment) => {
    await managedUser();
    await expect(
      database.client.query(`UPDATE users SET ${assignment} WHERE id = $1`, [userId]),
    ).rejects.toThrow();
    expect(
      (await database.client.query('SELECT managed_subject FROM users WHERE id = $1', [userId]))
        .rows,
    ).toEqual([{ managed_subject: 'subject-not-a-google-sub' }]);
  });

  it('does not silently attach a preserved legacy identity', async () => {
    await seedLegacyData();
    await expect(
      database.client.query(
        `UPDATE users SET managed_provider = 'neon', managed_issuer = 'https://issuer.example.test',
         managed_subject = 'new-managed-subject' WHERE id = $1`,
        [userId],
      ),
    ).rejects.toThrow();
  });
});
