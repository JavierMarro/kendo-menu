import { readFile } from 'node:fs/promises';
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

async function seedPreviousData() {
  await database.client.query(
    `INSERT INTO users (id, google_sub, verified_google_email, created_at, updated_at)
     VALUES ($1, 'preserved-adoption-upgrade', 'migration@example.test', '2026-09-12', '2026-09-12')`,
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
    ['e'.repeat(64), 'f'.repeat(64), '1'.repeat(64), 'v'.repeat(43)],
  );
  await database.client.query(
    `INSERT INTO cloud_dashboards
     (user_id, revision, transport_version, catalogue_digest, dashboard_json, created_at, updated_at)
     VALUES ($1, 7, 1, $2, $3, '2026-09-12', '2026-09-13')`,
    [userId, 'c'.repeat(64), '{"version":10,"state":{"marker":"preserve exact text é"}}'],
  );
  await database.client.query(
    `INSERT INTO dashboard_write_receipts
     (user_id, request_id, request_digest, acknowledged_revision, acknowledged_at, created_at)
     VALUES ($1, $2, $3, 7, '2026-09-13', '2026-09-13')`,
    [userId, '33333333-3333-4333-8333-333333333333', 'd'.repeat(64)],
  );
}

async function oldRows() {
  const rows: { data: string }[][] = [];
  for (const table of [
    'users',
    'application_sessions',
    'login_transactions',
    'cloud_dashboards',
    'dashboard_write_receipts',
  ]) {
    rows.push(
      (
        await database.client.query<{ data: string }>(
          `SELECT row_to_json(t)::text AS data FROM ${table} t ORDER BY row_to_json(t)::text`,
        )
      ).rows,
    );
  }
  return rows;
}

async function restoreJob5B() {
  await seedPreviousData();
  await database.client.query('DROP TABLE account_adoptions');
  const migration = readMigrationFiles({ migrationsFolder: folder })[2];
  if (migration === undefined) throw new Error('TEST_ADOPTION_MIGRATION_MISSING');
  await database.client.query('DELETE FROM "__drizzle_migrations" WHERE created_at >= $1', [
    migration.folderMillis,
  ]);
}

describe('adoption migration chain', () => {
  it('upgrades committed Job 5B without altering any existing rows or issuing capabilities', async () => {
    await restoreJob5B();
    const before = await oldRows();
    await migrateAgain();
    expect(await oldRows()).toEqual(before);
    expect((await database.client.query('SELECT * FROM account_adoptions')).rows).toEqual([]);
    await migrateAgain();
    expect(await oldRows()).toEqual(before);
    const migrations = readMigrationFiles({ migrationsFolder: folder });
    expect(
      (
        await database.client.query(
          'SELECT hash, created_at FROM "__drizzle_migrations" ORDER BY created_at',
        )
      ).rows,
    ).toEqual(
      migrations.map((migration) => ({
        hash: migration.hash,
        created_at: String(migration.folderMillis),
      })),
    );
    const previous: unknown = JSON.parse(
      await readFile(`${folder}/meta/0001_snapshot.json`, 'utf8'),
    );
    const current: unknown = JSON.parse(
      await readFile(`${folder}/meta/0002_snapshot.json`, 'utf8'),
    );
    if (typeof previous !== 'object' || previous === null || !('id' in previous))
      throw new Error('TEST_SNAPSHOT_INVALID');
    expect(current).toMatchObject({ prevId: previous.id, version: '7', dialect: 'postgresql' });
    if (typeof current !== 'object' || current === null || !('tables' in current))
      throw new Error('TEST_SNAPSHOT_INVALID');
    expect(current.tables).toHaveProperty(['public.account_adoptions']);
  });

  it('rolls back partial adoption DDL and journal on a late foreign-key failure', async () => {
    await restoreJob5B();
    // This schema belongs exclusively to this test. Renaming the referenced
    // column makes the later FK statement fail after CREATE TABLE succeeds.
    await database.client.query('ALTER TABLE users RENAME COLUMN id TO previous_id');
    const before = await oldRows();
    await expect(migrateAgain()).rejects.toThrow('MIGRATION_FAILED');
    expect(await oldRows()).toEqual(before);
    expect(
      (await database.client.query("SELECT to_regclass('account_adoptions')::text AS name")).rows,
    ).toEqual([{ name: null }]);
    expect((await database.client.query('SELECT * FROM "__drizzle_migrations"')).rows).toHaveLength(
      2,
    );
    await database.client.query('ALTER TABLE users RENAME COLUMN previous_id TO id');
    const restored = await oldRows();
    await migrateAgain();
    expect(await oldRows()).toEqual(restored);
  });
});

describe('adoption SQL invariants', () => {
  async function pending() {
    await seedPreviousData();
    await database.client.query(
      `INSERT INTO account_adoptions (user_id, state, creating_session_id, created_at, updated_at)
       VALUES ($1, 'pending', $2, '2026-09-12', '2026-09-12')`,
      [userId, sessionId],
    );
  }

  it.each([
    "state = 'other'",
    'creating_session_id = NULL',
    "decision = 'yes'",
    "request_id = '33333333-3333-4333-8333-333333333333'",
    "state = 'unavailable'",
    "created_at = '-infinity'",
    "updated_at = 'infinity'",
    "updated_at = '2026-09-11'",
  ])('rejects malformed pending rows: %s', async (mutation) => {
    await pending();
    await expect(
      database.client.query(`UPDATE account_adoptions SET ${mutation}`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it.each([
    'decision = NULL',
    "decision = 'no'",
    'request_id = NULL',
    "request_id = '33333333-3333-1333-8333-333333333333'",
    'request_digest = NULL',
    "request_digest = repeat('A', 64)",
    'acknowledged_revision = NULL',
    'acknowledged_revision = 0',
    'acknowledged_at = NULL',
    "acknowledged_at = '-infinity'",
    "acknowledged_at = '2026-09-11'",
  ])('rejects malformed accepted receipts: %s', async (mutation) => {
    await pending();
    await database.client.query(
      `UPDATE account_adoptions SET state = 'accepted', creating_session_id = NULL, decision = 'yes',
       request_id = $1, request_digest = $2, acknowledged_revision = 1, acknowledged_at = '2026-09-13', updated_at = '2026-09-13'`,
      ['44444444-4444-4444-8444-444444444444', 'e'.repeat(64)],
    );
    await expect(
      database.client.query(`UPDATE account_adoptions SET ${mutation}`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it.each([
    'decision = NULL',
    "decision = 'yes'",
    'request_id = NULL',
    'request_digest = NULL',
    'acknowledged_revision = 1',
    "acknowledged_at = '2026-09-13'",
  ])('rejects malformed declined receipts: %s', async (mutation) => {
    await pending();
    await database.client.query(
      `UPDATE account_adoptions SET state = 'declined', creating_session_id = NULL, decision = 'no',
       request_id = $1, request_digest = $2, updated_at = '2026-09-13'`,
      ['44444444-4444-4444-8444-444444444444', 'e'.repeat(64)],
    );
    await expect(
      database.client.query(`UPDATE account_adoptions SET ${mutation}`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps foreign keys directed from adoption and prevents duplicate account rows', async () => {
    await pending();
    await expect(
      database.client.query('INSERT INTO account_adoptions SELECT * FROM account_adoptions'),
    ).rejects.toMatchObject({ code: '23505' });
    const keys = await database.client.query<{ source: string; target: string }>(
      `SELECT conrelid::regclass::text AS source, confrelid::regclass::text AS target
       FROM pg_constraint WHERE contype = 'f' AND
       (conrelid = 'account_adoptions'::regclass OR confrelid = 'account_adoptions'::regclass)
       ORDER BY target`,
    );
    expect(keys.rows).toEqual([
      { source: 'account_adoptions', target: 'application_sessions' },
      { source: 'account_adoptions', target: 'users' },
    ]);
    await expect(
      database.client.query('DELETE FROM application_sessions WHERE id = $1', [sessionId]),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
