import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { readMigrationFiles } from 'drizzle-orm/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../database/migrate.js';
import { createTestDatabase, type TestDatabase } from '../database/test-database.js';

const migrationFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
let database: TestDatabase;

beforeEach(async () => {
  database = await createTestDatabase();
});
afterEach(async () => {
  await database?.close();
});

async function migrateAgain() {
  const connectionString = process.env['TEST_DATABASE_URL'];
  if (!connectionString) throw new Error('TEST_DATABASE_URL_REQUIRED');
  await migrateDatabase({ connectionString, schema: database.schema });
}

async function authRows() {
  const tables: { data: string }[][] = [];
  for (const table of ['users', 'application_sessions', 'login_transactions']) {
    const result = await database.client.query<{ data: string }>(
      `SELECT row_to_json(t)::text AS data FROM ${table} t ORDER BY id`,
    );
    tables.push(result.rows);
  }
  return tables;
}

/** Reconstruct the preceding schema only inside this harness-owned empty fixture. */
async function previousSchemaWithAuthentication() {
  await database.client.query(
    'DROP TABLE account_adoptions, dashboard_write_receipts, cloud_dashboards',
  );
  await database.client.query('DELETE FROM "__drizzle_migrations" WHERE created_at >= $1', [
    readMigrationFiles({ migrationsFolder: migrationFolder })[1]?.folderMillis,
  ]);
  const user = await database.persistence.users.resolveByGoogleSubject({
    googleSub: 'migration-preserved-user',
    verifiedGoogleEmail: 'migration@example.test',
  });
  const now = new Date();
  await database.persistence.sessions.create({
    userId: user.id,
    sessionTokenHash: 'a'.repeat(64),
    csrfTokenHash: 'b'.repeat(64),
    createdAt: now,
    lastActivityAt: now,
    idleExpiresAt: new Date(now.getTime() + 60_000),
    absoluteExpiresAt: new Date(now.getTime() + 120_000),
  });
  await database.persistence.loginTransactions.create({
    stateHash: 'c'.repeat(64),
    browserBindingHash: 'd'.repeat(64),
    nonceHash: 'e'.repeat(64),
    pkceCodeVerifier: 'v'.repeat(43),
    returnPath: '/',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  return authRows();
}

describe('dashboard migration chain', () => {
  it('applies the migration chain from empty, repeats without changes, and matches SQL hashes', async () => {
    const migrations = readMigrationFiles({ migrationsFolder: migrationFolder });
    expect(migrations).toHaveLength(3);
    const readJournal = async () =>
      (
        await database.client.query<{ hash: string; created_at: string }>(
          'SELECT hash, created_at FROM "__drizzle_migrations" ORDER BY created_at',
        )
      ).rows;
    const before = await readJournal();
    expect(before).toEqual(
      migrations.map((migration) => ({
        hash: migration.hash,
        created_at: String(migration.folderMillis),
      })),
    );
    await migrateAgain();
    expect(await readJournal()).toEqual(before);
    const snapshot0: unknown = JSON.parse(
      await readFile(`${migrationFolder}/meta/0000_snapshot.json`, 'utf8'),
    );
    const snapshot1: unknown = JSON.parse(
      await readFile(`${migrationFolder}/meta/0001_snapshot.json`, 'utf8'),
    );
    if (typeof snapshot0 !== 'object' || snapshot0 === null || !('id' in snapshot0)) {
      throw new Error('TEST_SNAPSHOT_INVALID');
    }
    expect(snapshot1).toMatchObject({
      prevId: snapshot0.id,
      version: '7',
      dialect: 'postgresql',
    });
    if (typeof snapshot1 !== 'object' || snapshot1 === null || !('tables' in snapshot1)) {
      throw new Error('TEST_SNAPSHOT_INVALID');
    }
    expect(snapshot1.tables).toHaveProperty(['public.cloud_dashboards']);
    expect(snapshot1.tables).toHaveProperty(['public.dashboard_write_receipts']);
  });

  it('upgrades the Job 4B schema while preserving every authentication row', async () => {
    const before = await previousSchemaWithAuthentication();
    await migrateAgain();
    expect(await authRows()).toEqual(before);
    expect((await database.client.query('SELECT * FROM cloud_dashboards')).rows).toEqual([]);
    expect((await database.client.query('SELECT * FROM dashboard_write_receipts')).rows).toEqual(
      [],
    );
    await migrateAgain();
    expect(await authRows()).toEqual(before);
  });

  it('rolls back partial migration DDL and journal writes on a conflicting table', async () => {
    const before = await previousSchemaWithAuthentication();
    // 0001 creates cloud_dashboards first. This owned collision fails its later DDL.
    await database.client.query('CREATE TABLE dashboard_write_receipts (marker integer)');
    await expect(migrateAgain()).rejects.toThrow('MIGRATION_FAILED');
    expect(await authRows()).toEqual(before);
    const result = await database.client.query<{ name: string | null }>(
      "SELECT to_regclass('cloud_dashboards')::text AS name",
    );
    expect(result.rows[0]?.name).toBeNull();
    expect((await database.client.query('SELECT * FROM "__drizzle_migrations"')).rows).toHaveLength(
      1,
    );
    await database.client.query('DROP TABLE dashboard_write_receipts');
    await migrateAgain();
    expect(await authRows()).toEqual(before);
  });
});

describe('dashboard SQL constraints', () => {
  async function seed() {
    const user = await database.persistence.users.resolveByGoogleSubject({
      googleSub: 'constraints',
    });
    await database.client.query(
      `INSERT INTO cloud_dashboards
       (user_id, revision, transport_version, catalogue_digest, dashboard_json, created_at, updated_at)
       VALUES ($1, 1, 1, $2, '{}', '2026-09-12', '2026-09-12')`,
      [user.id, 'a'.repeat(64)],
    );
    await database.client.query(
      `INSERT INTO dashboard_write_receipts
       (user_id, request_id, request_digest, acknowledged_revision, acknowledged_at, created_at)
       VALUES ($1, '11111111-1111-4111-8111-111111111111', $2, 1, '2026-09-12', '2026-09-12')`,
      [user.id, 'b'.repeat(64)],
    );
    return user;
  }

  it.each([
    ['cloud_dashboards', 'revision = 0'],
    ['cloud_dashboards', 'revision = -1'],
    ['cloud_dashboards', 'transport_version = 2'],
    ['cloud_dashboards', "catalogue_digest = repeat('A', 64)"],
    ['cloud_dashboards', "catalogue_digest = 'short'"],
    ['cloud_dashboards', "dashboard_json = repeat('é', 1048577)"],
    ['cloud_dashboards', "created_at = '-infinity'"],
    ['cloud_dashboards', "updated_at = 'infinity'"],
    ['cloud_dashboards', "updated_at = '2026-09-11'"],
    ['dashboard_write_receipts', 'acknowledged_revision = 0'],
    ['dashboard_write_receipts', "request_digest = repeat('A', 64)"],
    ['dashboard_write_receipts', "request_id = '11111111-1111-1111-8111-111111111111'"],
    ['dashboard_write_receipts', "acknowledged_at = 'infinity'"],
    ['dashboard_write_receipts', "created_at = '-infinity'"],
    ['dashboard_write_receipts', "acknowledged_at = '2026-09-11'"],
  ])('rejects %s %s', async (table, mutation) => {
    await seed();
    await expect(database.client.query(`UPDATE ${table} SET ${mutation}`)).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('enforces account foreign keys, request/revision uniqueness and RESTRICT deletion', async () => {
    const user = await seed();
    await expect(
      database.client.query('DELETE FROM users WHERE id = $1', [user.id]),
    ).rejects.toMatchObject({ code: '23503' });
    for (const table of ['cloud_dashboards', 'dashboard_write_receipts']) {
      await expect(
        database.client.query(
          `UPDATE ${table} SET user_id = '00000000-0000-0000-0000-000000000000'`,
        ),
      ).rejects.toMatchObject({ code: '23503' });
    }
    await expect(
      database.client.query(
        'INSERT INTO dashboard_write_receipts SELECT * FROM dashboard_write_receipts',
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      database.client.query(
        `INSERT INTO dashboard_write_receipts
       SELECT user_id, '22222222-2222-4222-8222-222222222222', request_digest, acknowledged_revision, acknowledged_at, created_at
       FROM dashboard_write_receipts`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
    const foreignKeys = await database.client.query<{ confdeltype: string }>(
      `SELECT confdeltype FROM pg_constraint
       WHERE conrelid IN ('cloud_dashboards'::regclass, 'dashboard_write_receipts'::regclass)
       AND contype = 'f' ORDER BY conname`,
    );
    expect(foreignKeys.rows).toEqual([{ confdeltype: 'r' }, { confdeltype: 'r' }]);
  });

  it('stores the exact byte boundary as text and indexes account revision ordering', async () => {
    await seed();
    await database.client.query(
      "UPDATE cloud_dashboards SET dashboard_json = repeat('é', 1048576)",
    );
    const size = await database.client.query<{ bytes: number; kind: string }>(
      'SELECT octet_length(dashboard_json) AS bytes, pg_typeof(dashboard_json)::text AS kind FROM cloud_dashboards',
    );
    expect(size.rows).toEqual([{ bytes: 2_097_152, kind: 'text' }]);
    const indexes = await database.client.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'dashboard_write_receipts'",
      [database.schema],
    );
    expect(
      indexes.rows.some((row) => row.indexdef.includes('(user_id, acknowledged_revision)')),
    ).toBe(true);
  });
});
