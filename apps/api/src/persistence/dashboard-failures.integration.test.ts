/**
 * Failure-injection evidence for dashboard write atomicity.
 *
 * Every failure is introduced in the harness-owned PostgreSQL schema. The
 * adapter still runs its real checked-out-client transaction, row locks,
 * cleanup, and session touch; these tests only make one real SQL stage fail so
 * the complete pre-write state can be compared afterward.
 */
import { createHash, randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionAuthorization } from '../auth/session-authorization.js';
import type { SessionAuthorizationProof } from '../auth/session-authorization.js';
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from '../auth/contracts.js';
import { createTestDatabase, type TestDatabase } from '../database/test-database.js';
import {
  createDashboardCatalogue,
  isAccountWorkspaceId,
  validateDashboardWrite,
} from '../dashboard/validation.js';
import type { AccountWorkspaceId } from '../dashboard/contracts.js';
import type { UserRecord } from './contracts.js';

const BASE_TIME = new Date('2026-01-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1_000;
const APP_ORIGIN = 'https://app.example.test';
const catalogue = createDashboardCatalogue();
const TOKEN = Buffer.alloc(32, 1).toString('base64url');
const CSRF = Buffer.alloc(32, 2).toString('base64url');

let database: TestDatabase | undefined;
let currentTime = new Date(BASE_TIME.getTime());

interface DashboardSnapshotRow {
  readonly user_id: string;
  readonly revision: string;
  readonly transport_version: number;
  readonly catalogue_digest: string;
  readonly dashboard_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ReceiptSnapshotRow {
  readonly user_id: string;
  readonly request_id: string;
  readonly request_digest: string;
  readonly acknowledged_revision: string;
  readonly acknowledged_at: string;
  readonly created_at: string;
}

interface ActivitySnapshotRow {
  readonly id: string;
  readonly user_id: string;
  readonly session_token_hash: string;
  readonly csrf_token_hash: string;
  readonly created_at: string;
  readonly last_activity_at: string;
  readonly idle_expires_at: string;
  readonly absolute_expires_at: string;
  readonly revoked_at: string | null;
}

interface DatabaseSnapshot {
  readonly dashboards: readonly DashboardSnapshotRow[];
  readonly receipts: readonly ReceiptSnapshotRow[];
  readonly activity: readonly ActivitySnapshotRow[];
}

interface DashboardFixture {
  readonly user: UserRecord;
  readonly userId: AccountWorkspaceId;
  readonly proof: SessionAuthorizationProof;
  readonly readProof: SessionAuthorizationProof;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function workspace(user: UserRecord): AccountWorkspaceId {
  if (!isAccountWorkspaceId(user.id)) {
    throw new Error('TEST_WORKSPACE_INVALID');
  }
  return user.id;
}

function dashboardRequest(
  userId: AccountWorkspaceId,
  expectedRevision: string,
  requestId: string = randomUUID(),
): unknown {
  return {
    transportVersion: 1 as const,
    expectedAccountWorkspaceId: userId,
    expectedRevision,
    requestId,
    catalogueVersion: catalogue.version,
    dashboard: {
      version: 10,
      state: { dashboardEntries: [] },
    },
  };
}

function intentFor(request: unknown, userId: AccountWorkspaceId) {
  const result = validateDashboardWrite(request, userId);
  if (result.status !== 'valid') {
    throw new Error(`TEST_INTENT_INVALID_${result.error}`);
  }
  return result.intent;
}

function requireDatabase(): TestDatabase {
  if (database === undefined) throw new Error('TEST_DATABASE_NOT_INITIALIZED');
  return database;
}

async function createFixture(): Promise<DashboardFixture> {
  const db = requireDatabase();
  const user = await db.persistence.users.resolveByGoogleSubject({
    googleSub: `dashboard-failure-${randomUUID()}`,
  });
  await db.persistence.sessions.create({
    userId: user.id,
    sessionTokenHash: sha256(TOKEN),
    csrfTokenHash: sha256(CSRF),
    createdAt: new Date(BASE_TIME.getTime()),
    lastActivityAt: new Date(BASE_TIME.getTime()),
    idleExpiresAt: new Date(BASE_TIME.getTime() + 7 * DAY),
    absoluteExpiresAt: new Date(BASE_TIME.getTime() + 30 * DAY),
  });
  const authorization = createSessionAuthorization({
    persistence: db.persistence,
    getAppOrigin: () => APP_ORIGIN,
    clock: () => new Date(currentTime.getTime()),
  });
  const cookies = `${SESSION_COOKIE_NAME}=${TOKEN}; ${CSRF_COOKIE_NAME}=${CSRF}`;
  const read = await authorization.authorizeRead(
    new Request(`${APP_ORIGIN}/api/dashboard`, { headers: { cookie: cookies } }),
  );
  if (read.status !== 'authorized') throw new Error('TEST_READ_AUTHORIZATION_FAILED');
  const write = await authorization.authorizeWrite(
    new Request(`${APP_ORIGIN}/api/dashboard`, {
      method: 'PUT',
      headers: { cookie: cookies, origin: APP_ORIGIN, 'x-csrf-token': CSRF },
    }),
  );
  if (write.status !== 'authorized') throw new Error('TEST_WRITE_AUTHORIZATION_FAILED');
  return {
    user,
    userId: workspace(user),
    proof: write.proof,
    readProof: read.proof,
  };
}

async function write(fixture: DashboardFixture, expectedRevision: string, requestId?: string) {
  const request = dashboardRequest(fixture.userId, expectedRevision, requestId);
  return requireDatabase().persistence.dashboards.compareAndWrite(
    fixture.proof,
    intentFor(request, fixture.userId),
    () => true,
  );
}

async function seedExpiryReceipt(fixture: DashboardFixture): Promise<string> {
  const db = requireDatabase();
  const requestId = randomUUID();
  const at = new Date(BASE_TIME.getTime() - 7 * DAY);
  await db.client.query(
    `INSERT INTO dashboard_write_receipts
       (user_id, request_id, request_digest, acknowledged_revision, acknowledged_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [fixture.user.id, requestId, sha256(requestId), 99n, at],
  );
  return requestId;
}

async function seedCapacityReceipts(fixture: DashboardFixture): Promise<void> {
  const db = requireDatabase();
  await db.client.query(
    `INSERT INTO dashboard_write_receipts
       (user_id, request_id, request_digest, acknowledged_revision, acknowledged_at, created_at)
     SELECT $1,
            ('00000000-0000-4000-8000-' || lpad(to_hex(revision), 12, '0'))::uuid,
            repeat('a', 64),
            revision,
            $2,
            $2
       FROM generate_series(2, 1024) AS revisions(revision)`,
    [fixture.user.id, BASE_TIME],
  );
  await db.client.query('UPDATE cloud_dashboards SET revision = $2 WHERE user_id = $1', [
    fixture.user.id,
    1024n,
  ]);
}

async function snapshot(fixture: DashboardFixture): Promise<DatabaseSnapshot> {
  const db = requireDatabase();
  const dashboards = await db.client.query<DashboardSnapshotRow>(
    `SELECT user_id::text AS user_id,
            revision::text AS revision,
            transport_version,
            catalogue_digest,
            dashboard_json,
            created_at::text AS created_at,
            updated_at::text AS updated_at
       FROM cloud_dashboards
      WHERE user_id = $1`,
    [fixture.user.id],
  );
  const receipts = await db.client.query<ReceiptSnapshotRow>(
    `SELECT user_id::text AS user_id,
            request_id::text AS request_id,
            request_digest,
            acknowledged_revision::text AS acknowledged_revision,
            acknowledged_at::text AS acknowledged_at,
            created_at::text AS created_at
       FROM dashboard_write_receipts
      WHERE user_id = $1
      ORDER BY acknowledged_revision, request_id`,
    [fixture.user.id],
  );
  const activity = await db.client.query<ActivitySnapshotRow>(
    `SELECT id::text AS id,
            user_id::text AS user_id,
            session_token_hash,
            csrf_token_hash,
            created_at::text AS created_at,
            last_activity_at::text AS last_activity_at,
            idle_expires_at::text AS idle_expires_at,
            absolute_expires_at::text AS absolute_expires_at,
            revoked_at::text AS revoked_at
       FROM application_sessions
      WHERE id = $1`,
    [fixture.proof.sessionId],
  );
  return {
    dashboards: dashboards.rows,
    receipts: receipts.rows,
    activity: activity.rows,
  };
}

async function installFailureTrigger(
  table: 'cloud_dashboards' | 'dashboard_write_receipts' | 'application_sessions',
  timing: 'AFTER' | 'BEFORE',
  events: string,
  functionName: string,
  triggerName: string,
): Promise<void> {
  const db = requireDatabase();
  await db.client.query(`
    CREATE FUNCTION ${functionName}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DASHBOARD_FAILURE_INJECTION';
    END;
    $$;
    CREATE TRIGGER ${triggerName}
    ${timing} ${events} ON ${table}
    FOR EACH ROW EXECUTE FUNCTION ${functionName}();
  `);
}

beforeEach(async () => {
  currentTime = new Date(BASE_TIME.getTime());
  database = await createTestDatabase({ clock: () => new Date(currentTime.getTime()) });
});

afterEach(async () => {
  const currentDatabase = database;
  database = undefined;
  vi.restoreAllMocks();
  await currentDatabase?.close();
});

describe('PostgreSQL dashboard write failure atomicity', () => {
  it('rolls back a failure after dashboard mutation', async () => {
    const fixture = await createFixture();
    await write(fixture, '0');
    await seedExpiryReceipt(fixture);
    const before = await snapshot(fixture);
    await installFailureTrigger(
      'cloud_dashboards',
      'AFTER',
      'INSERT OR UPDATE',
      'fail_dashboard_mutation_for_test',
      'fail_dashboard_mutation_trigger',
    );

    expect(await write(fixture, '1')).toEqual({ status: 'unavailable' });
    await expect(snapshot(fixture)).resolves.toEqual(before);
  });

  it('rolls back a failure after receipt insertion', async () => {
    const fixture = await createFixture();
    await write(fixture, '0');
    await seedExpiryReceipt(fixture);
    const before = await snapshot(fixture);
    await installFailureTrigger(
      'dashboard_write_receipts',
      'AFTER',
      'INSERT',
      'fail_dashboard_receipt_insert_for_test',
      'fail_dashboard_receipt_insert_trigger',
    );

    expect(await write(fixture, '1')).toEqual({ status: 'unavailable' });
    await expect(snapshot(fixture)).resolves.toEqual(before);
  });

  it('rolls back a failure during seven-day receipt cleanup', async () => {
    const fixture = await createFixture();
    await write(fixture, '0');
    await seedExpiryReceipt(fixture);
    const before = await snapshot(fixture);
    await installFailureTrigger(
      'dashboard_write_receipts',
      'AFTER',
      'DELETE',
      'fail_dashboard_expiry_delete_for_test',
      'fail_dashboard_expiry_delete_trigger',
    );

    expect(await write(fixture, '1')).toEqual({ status: 'unavailable' });
    await expect(snapshot(fixture)).resolves.toEqual(before);
  });

  it('rolls back a failure during 1,024-receipt capacity eviction', async () => {
    const fixture = await createFixture();
    await write(fixture, '0');
    await seedCapacityReceipts(fixture);
    const before = await snapshot(fixture);
    await installFailureTrigger(
      'dashboard_write_receipts',
      'AFTER',
      'DELETE',
      'fail_dashboard_capacity_delete_for_test',
      'fail_dashboard_capacity_delete_trigger',
    );

    expect(await write(fixture, '1024')).toEqual({ status: 'unavailable' });
    await expect(snapshot(fixture)).resolves.toEqual(before);
  });

  it('rolls back a failure during final session activity touch', async () => {
    const fixture = await createFixture();
    await write(fixture, '0');
    await seedExpiryReceipt(fixture);
    const before = await snapshot(fixture);
    await installFailureTrigger(
      'application_sessions',
      'AFTER',
      'UPDATE OF last_activity_at',
      'fail_dashboard_touch_for_test',
      'fail_dashboard_touch_trigger',
    );

    expect(await write(fixture, '1')).toEqual({ status: 'unavailable' });
    await expect(snapshot(fixture)).resolves.toEqual(before);
  });

  it('rolls back a failure before COMMIT', async () => {
    const fixture = await createFixture();
    await write(fixture, '0');
    await seedExpiryReceipt(fixture);
    const before = await snapshot(fixture);
    const originalQuery: unknown = Object.getOwnPropertyDescriptor(
      Client.prototype,
      'query',
    )?.value;
    if (typeof originalQuery !== 'function') throw new Error('TEST_QUERY_METHOD_MISSING');
    let commitCalls = 0;
    let rollbackCalls = 0;
    let injected = false;
    const query = vi.spyOn(Client.prototype, 'query');
    query.mockImplementation(function (this: Client, ...args: unknown[]) {
      const first: unknown = args[0];
      const statement = typeof first === 'string' ? first.trim().toUpperCase() : '';
      if (statement === 'COMMIT' && !injected) {
        injected = true;
        commitCalls += 1;
        throw new Error('DASHBOARD_PRE_COMMIT_FAILURE');
      }
      if (statement === 'ROLLBACK') rollbackCalls += 1;
      // pg exposes several overloaded query signatures; Reflect.apply keeps
      // every driver call intact while the test observes only the SQL verb.
      const result: unknown = Reflect.apply(originalQuery, this, args);
      return result;
    });

    expect(await write(fixture, '1')).toEqual({ status: 'unavailable' });
    expect(commitCalls).toBe(1);
    expect(rollbackCalls).toBe(0);
    await expect(snapshot(fixture)).resolves.toEqual(before);
  });

  it('fails closed after a committed COMMIT and recovers its retained acknowledgement', async () => {
    const fixture = await createFixture();
    await write(fixture, '0');
    const requestId = randomUUID();
    const before = await snapshot(fixture);
    currentTime = new Date(BASE_TIME.getTime() + 1_000);
    const originalQuery: unknown = Object.getOwnPropertyDescriptor(
      Client.prototype,
      'query',
    )?.value;
    if (typeof originalQuery !== 'function') throw new Error('TEST_QUERY_METHOD_MISSING');
    let commitCalls = 0;
    let rollbackAfterCommit = false;
    let committed = false;
    const query = vi.spyOn(Client.prototype, 'query');
    query.mockImplementation(function (this: Client, ...args: unknown[]) {
      const first: unknown = args[0];
      const statement = typeof first === 'string' ? first.trim().toUpperCase() : '';
      if (statement === 'COMMIT' && !committed) {
        commitCalls += 1;
        const result: unknown = Reflect.apply(originalQuery, this, args);
        committed = true;
        if (result instanceof Promise) {
          return result.then(() => {
            throw new Error('DASHBOARD_AMBIGUOUS_COMMIT');
          });
        }
        throw new Error('DASHBOARD_AMBIGUOUS_COMMIT');
      }
      if (statement === 'ROLLBACK' && committed) rollbackAfterCommit = true;
      const result: unknown = Reflect.apply(originalQuery, this, args);
      return result;
    });

    const outcome = await write(fixture, '1', requestId);
    expect(outcome).toEqual({ status: 'unavailable' });
    expect(commitCalls).toBe(1);
    expect(rollbackAfterCommit).toBe(false);
    const afterCommit = await snapshot(fixture);
    expect(afterCommit.dashboards).not.toEqual(before.dashboards);
    expect(afterCommit.receipts).not.toEqual(before.receipts);
    expect(afterCommit.activity).not.toEqual(before.activity);

    query.mockRestore();
    const replay = await write(fixture, '1', requestId);
    expect(replay.status).toBe('replayed');
    if (replay.status !== 'replayed') throw new Error('TEST_REPLAY_MISSING');
    expect(replay.acknowledgement.revision).toBe('2');
    expect(await snapshot(fixture)).toEqual(afterCommit);
  });
});
