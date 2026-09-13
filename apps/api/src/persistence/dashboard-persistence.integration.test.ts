/**
 * Real PostgreSQL coverage for the Job 5B dashboard adapter. These cases use
 * the same session proof and strict intent codec as the HTTP application; no
 * fake persistence implementation can prove the row locks or atomic cleanup.
 */
import { createHash, randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
import { drizzle } from 'drizzle-orm/node-postgres';
import { persistenceSchema } from './schema.js';
import { touchSessionInDatabase } from './postgres/session-sql.js';
import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';

const BASE_TIME = new Date('2026-01-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1_000;
const APP_ORIGIN = 'https://app.example.test';
const catalogue = createDashboardCatalogue();
const defaultTrainingSet = DEFAULT_TRAINING_SETS[0];
const defaultActivity = defaultTrainingSet?.activities[0];
if (defaultTrainingSet === undefined || defaultActivity === undefined) {
  throw new Error('TEST_CATALOGUE_EMPTY');
}
const compatibleTrainingSetId = defaultTrainingSet.id;
const compatibleActivityId = defaultActivity.id;
const TOKEN = Buffer.alloc(32, 1).toString('base64url');
const CSRF = Buffer.alloc(32, 2).toString('base64url');

let database: TestDatabase | undefined;
let currentTime = new Date(BASE_TIME.getTime());

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
  requestId = randomUUID(),
  dashboard: unknown = {
    version: 10,
    state: { dashboardEntries: [] },
  },
): unknown {
  return {
    transportVersion: 1 as const,
    expectedAccountWorkspaceId: userId,
    expectedRevision,
    requestId,
    catalogueVersion: catalogue.version,
    dashboard,
  };
}

function dashboardWithEntry(
  note: string,
  trainingSetId: string = compatibleTrainingSetId,
): unknown {
  return {
    version: 10,
    state: {
      dashboardEntries: [
        {
          id: 'entry',
          trainingSetId,
          quantityOverrides: { [compatibleActivityId]: { repetitions: 1 } },
          activityNotes: {},
          notes: note,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
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

async function createUserAndProof(): Promise<{
  readonly user: UserRecord;
  readonly userId: AccountWorkspaceId;
  readonly proof: SessionAuthorizationProof;
  readonly readProof: SessionAuthorizationProof;
}> {
  if (database === undefined) throw new Error('TEST_DATABASE_NOT_INITIALIZED');
  const user = await database.persistence.users.resolveByGoogleSubject({
    googleSub: `dashboard-${randomUUID()}`,
  });
  await database.persistence.sessions.create({
    userId: user.id,
    sessionTokenHash: sha256(TOKEN),
    csrfTokenHash: sha256(CSRF),
    createdAt: new Date(BASE_TIME.getTime()),
    lastActivityAt: new Date(BASE_TIME.getTime()),
    idleExpiresAt: new Date(BASE_TIME.getTime() + 7 * DAY),
    absoluteExpiresAt: new Date(BASE_TIME.getTime() + 30 * DAY),
  });
  const authorization = createSessionAuthorization({
    persistence: database.persistence,
    getAppOrigin: () => APP_ORIGIN,
    clock: () => new Date(currentTime.getTime()),
  });
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${TOKEN}; ${CSRF_COOKIE_NAME}=${CSRF}` };
  const readResult = await authorization.authorizeRead(
    new Request(`${APP_ORIGIN}/api/dashboard`, { headers }),
  );
  if (readResult.status !== 'authorized') throw new Error('TEST_READ_AUTHORIZATION_FAILED');
  const writeResult = await authorization.authorizeWrite(
    new Request(`${APP_ORIGIN}/api/dashboard`, {
      method: 'PUT',
      headers: { ...headers, origin: APP_ORIGIN, 'x-csrf-token': CSRF },
    }),
  );
  if (writeResult.status !== 'authorized') throw new Error('TEST_WRITE_AUTHORIZATION_FAILED');
  return {
    user,
    userId: workspace(user),
    proof: writeResult.proof,
    readProof: readResult.proof,
  };
}

function requireDatabase(): TestDatabase {
  if (database === undefined) throw new Error('TEST_DATABASE_NOT_INITIALIZED');
  return database;
}

beforeEach(async () => {
  currentTime = new Date(BASE_TIME.getTime());
  database = await createTestDatabase({ clock: () => new Date(currentTime.getTime()) });
});

afterEach(async () => {
  const currentDatabase = database;
  database = undefined;
  await currentDatabase?.close();
});

describe('PostgreSQL dashboard persistence', () => {
  it('uses the shared session touch helper monotonically and caps its idle deadline', async () => {
    const harness = await createUserAndProof();
    const db = requireDatabase();
    const databaseForTouch = drizzle({ client: db.client, schema: persistenceSchema });
    const advancedAt = new Date(BASE_TIME.getTime() + DAY);
    const advanced = await touchSessionInDatabase(databaseForTouch, {
      sessionId: harness.proof.sessionId,
      userId: harness.userId,
      at: advancedAt,
      idleExpiresAt: new Date(BASE_TIME.getTime() + 40 * DAY),
    });
    expect(advanced).not.toBeNull();
    expect(advanced?.lastActivityAt).toEqual(advancedAt);
    expect(advanced?.idleExpiresAt).toEqual(new Date(BASE_TIME.getTime() + 30 * DAY));

    const lateResult = await touchSessionInDatabase(databaseForTouch, {
      sessionId: harness.proof.sessionId,
      userId: harness.userId,
      at: new Date(BASE_TIME.getTime() + 12 * 60 * 60 * 1_000),
      idleExpiresAt: new Date(BASE_TIME.getTime() + 8 * DAY),
    });
    expect(lateResult).not.toBeNull();
    expect(lateResult?.lastActivityAt).toEqual(advancedAt);
    expect(lateResult?.idleExpiresAt).toEqual(new Date(BASE_TIME.getTime() + 30 * DAY));

    const expired = await touchSessionInDatabase(databaseForTouch, {
      sessionId: harness.proof.sessionId,
      userId: harness.userId,
      at: new Date(BASE_TIME.getTime() + 30 * DAY),
      idleExpiresAt: new Date(BASE_TIME.getTime() + 30 * DAY),
    });
    expect(expired).toBeNull();
  });

  it('returns an empty dashboard without touching session activity', async () => {
    const harness = await createUserAndProof();
    const db = requireDatabase();
    const before = await db.client.query(
      'SELECT last_activity_at, idle_expires_at FROM application_sessions WHERE id = $1',
      [harness.proof.sessionId],
    );
    const outcome = await db.persistence.dashboards.read(harness.readProof);
    expect(outcome).toEqual({
      status: 'read',
      response: {
        transportVersion: 1,
        accountWorkspaceId: harness.userId,
        catalogueVersion: catalogue.version,
        revision: '0',
        dashboard: null,
        updatedAt: null,
      },
    });
    const after = await db.client.query(
      'SELECT last_activity_at, idle_expires_at FROM application_sessions WHERE id = $1',
      [harness.proof.sessionId],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('writes saved-empty revision one, reads it, and replays the original acknowledgement', async () => {
    const harness = await createUserAndProof();
    const db = requireDatabase();
    const request = dashboardRequest(harness.userId, '0', '00000000-0000-4000-8000-000000000001');
    const intent = intentFor(request, harness.userId);
    const first = await db.persistence.dashboards.compareAndWrite(
      harness.proof,
      intent,
      () => true,
    );
    expect(first.status).toBe('written');
    if (first.status !== 'written') throw new Error('TEST_WRITE_FAILED');
    expect(first.acknowledgement.revision).toBe('1');
    expect(first.acknowledgement.updatedAt).toBe(BASE_TIME.toISOString());

    const read = await db.persistence.dashboards.read(harness.readProof);
    expect(read.status).toBe('read');
    if (read.status !== 'read') throw new Error('TEST_READ_FAILED');
    expect(read.response.revision).toBe('1');
    expect(read.response.dashboard?.state.dashboardEntries).toEqual([]);

    currentTime = new Date(BASE_TIME.getTime() + DAY);
    const replay = await db.persistence.dashboards.compareAndWrite(harness.proof, intent, () => {
      throw new Error('CATALOGUE_MUST_NOT_RUN_FOR_REPLAY');
    });
    expect(replay).toEqual({ status: 'replayed', acknowledgement: first.acknowledgement });
    const rows = await db.client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM dashboard_write_receipts',
    );
    expect(rows.rows[0]?.count).toBe('1');
  });

  it('isolates accounts and rejects client workspace substitution before mutation', async () => {
    const first = await createUserAndProof();
    const db = requireDatabase();
    const secondUser = await db.persistence.users.resolveByGoogleSubject({
      googleSub: `dashboard-second-${randomUUID()}`,
    });
    const secondId = workspace(secondUser);
    const secondSession = await db.persistence.sessions.create({
      userId: secondUser.id,
      sessionTokenHash: sha256('second-token'),
      csrfTokenHash: sha256('second-csrf'),
      createdAt: new Date(BASE_TIME.getTime()),
      lastActivityAt: new Date(BASE_TIME.getTime()),
      idleExpiresAt: new Date(BASE_TIME.getTime() + 7 * DAY),
      absoluteExpiresAt: new Date(BASE_TIME.getTime() + 30 * DAY),
    });
    const wrongRequest = dashboardRequest(secondId, '0');
    const wrongIntent = intentFor(wrongRequest, secondId);
    const substitution = await db.persistence.dashboards.compareAndWrite(
      first.proof,
      wrongIntent,
      () => true,
    );
    expect(substitution).toEqual({ status: 'workspace-mismatch' });
    const counts = await db.client.query<{ dashboards: string; receipts: string }>(
      `SELECT
         (SELECT count(*)::text FROM cloud_dashboards) AS dashboards,
         (SELECT count(*)::text FROM dashboard_write_receipts) AS receipts`,
    );
    expect(counts.rows[0]).toEqual({ dashboards: '0', receipts: '0' });
    expect(secondSession.userId).toBe(secondUser.id);
  });

  it('rejects different-content request reuse and missing CSRF proof without mutation', async () => {
    const harness = await createUserAndProof();
    const db = requireDatabase();
    const requestId = '00000000-0000-4000-8000-000000000003';
    const first = intentFor(dashboardRequest(harness.userId, '0', requestId), harness.userId);
    const firstOutcome = await db.persistence.dashboards.compareAndWrite(
      harness.proof,
      first,
      () => true,
    );
    expect(firstOutcome.status).toBe('written');
    const changed = intentFor(
      dashboardRequest(harness.userId, '1', requestId, {
        version: 10,
        state: { dashboardEntries: [] },
      }),
      harness.userId,
    );
    const reused = await db.persistence.dashboards.compareAndWrite(
      harness.proof,
      changed,
      () => true,
    );
    expect(reused.status).toBe('request-id-reused');
    const noCsrf = await db.persistence.dashboards.compareAndWrite(
      harness.readProof,
      first,
      () => true,
    );
    expect(noCsrf).toEqual({ status: 'unauthenticated' });
  });

  it('rolls back dashboard, receipt, and activity when final touch fails', async () => {
    const harness = await createUserAndProof();
    const db = requireDatabase();
    const before = await db.client.query(
      `SELECT
         (SELECT count(*) FROM cloud_dashboards) AS dashboards,
         (SELECT count(*) FROM dashboard_write_receipts) AS receipts,
         (SELECT last_activity_at FROM application_sessions WHERE id = $1) AS activity`,
      [harness.proof.sessionId],
    );
    // A trigger is harness-local and removed with its schema. It makes the
    // shared touch SQL fail only after the dashboard and receipt mutations.
    await db.client.query(`
      CREATE FUNCTION fail_dashboard_touch() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_TABLE_NAME = 'application_sessions' AND NEW.last_activity_at > OLD.last_activity_at THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TOUCH_FAILURE';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_dashboard_touch_trigger
      BEFORE UPDATE OF last_activity_at ON application_sessions
      FOR EACH ROW EXECUTE FUNCTION fail_dashboard_touch();
    `);
    currentTime = new Date(BASE_TIME.getTime() + 60 * 60 * 1_000);
    const outcome = await db.persistence.dashboards.compareAndWrite(
      harness.proof,
      intentFor(dashboardRequest(harness.userId, '0'), harness.userId),
      () => true,
    );
    expect(outcome).toEqual({ status: 'unavailable' });
    const after = await db.client.query(
      `SELECT
         (SELECT count(*) FROM cloud_dashboards) AS dashboards,
         (SELECT count(*) FROM dashboard_write_receipts) AS receipts,
         (SELECT last_activity_at FROM application_sessions WHERE id = $1) AS activity`,
      [harness.proof.sessionId],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('returns a fixed failure for corrupt stored text without rewriting it', async () => {
    const harness = await createUserAndProof();
    const db = requireDatabase();
    const request = intentFor(dashboardRequest(harness.userId, '0'), harness.userId);
    const written = await db.persistence.dashboards.compareAndWrite(
      harness.proof,
      request,
      () => true,
    );
    expect(written.status).toBe('written');
    await db.client.query(
      'UPDATE cloud_dashboards SET dashboard_json = \'{"version":10,"state":{}}\' WHERE user_id = $1',
      [harness.user.id],
    );
    const before = await db.client.query<{ dashboard_json: string }>(
      'SELECT dashboard_json FROM cloud_dashboards WHERE user_id = $1',
      [harness.user.id],
    );
    const outcome = await db.persistence.dashboards.read(harness.readProof);
    expect(outcome).toEqual({ status: 'unavailable' });
    const after = await db.client.query<{ dashboard_json: string }>(
      'SELECT dashboard_json FROM cloud_dashboards WHERE user_id = $1',
      [harness.user.id],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('preserves escaped NUL and unpaired surrogate text distinctly from replacement text', async () => {
    const harness = await createUserAndProof();
    const db = requireDatabase();
    const first = intentFor(dashboardRequest(harness.userId, '0'), harness.userId);
    const written = await db.persistence.dashboards.compareAndWrite(
      harness.proof,
      first,
      () => true,
    );
    expect(written.status).toBe('written');
    const stored = await db.client.query<{ dashboard_json: string; bytes: number }>(
      'SELECT dashboard_json, octet_length(dashboard_json) AS bytes FROM cloud_dashboards WHERE user_id = $1',
      [harness.user.id],
    );
    expect(stored.rows[0]?.dashboard_json).toContain('dashboardEntries');
    expect(stored.rows[0]?.dashboard_json).not.toContain('\u0000');
    expect(stored.rows[0]?.bytes).toBeGreaterThan(0);

    const surrogateValue = '\ud800';
    const replacementValue = '�';
    const surrogateIntent = intentFor(
      dashboardRequest(harness.userId, '1', randomUUID(), dashboardWithEntry('\u0000\ud800')),
      harness.userId,
    );
    const surrogateWritten = await db.persistence.dashboards.compareAndWrite(
      harness.proof,
      surrogateIntent,
      () => true,
    );
    expect(surrogateWritten.status).toBe('written');
    const surrogateStored = await db.client.query<{ dashboard_json: string }>(
      'SELECT dashboard_json FROM cloud_dashboards WHERE user_id = $1',
      [harness.user.id],
    );
    expect(surrogateStored.rows[0]?.dashboard_json).toContain('\\u0000');
    expect(surrogateStored.rows[0]?.dashboard_json).toContain('\\ud800');
    const surrogateRead = await db.persistence.dashboards.read(harness.readProof);
    expect(surrogateRead.status).toBe('read');
    if (surrogateRead.status !== 'read' || surrogateRead.response.dashboard === null) {
      throw new Error('TEST_SURROGATE_READ_FAILED');
    }
    const notes = surrogateRead.response.dashboard.state.dashboardEntries[0]?.notes;
    expect(notes?.charCodeAt(0)).toBe(0);
    expect(notes?.charCodeAt(1)).toBe(0xd800);

    const replacementIntent = intentFor(
      dashboardRequest(harness.userId, '2', randomUUID(), dashboardWithEntry(replacementValue)),
      harness.userId,
    );
    const replacementWritten = await db.persistence.dashboards.compareAndWrite(
      harness.proof,
      replacementIntent,
      () => true,
    );
    expect(replacementWritten.status).toBe('written');
    const replacementStored = await db.client.query<{ dashboard_json: string }>(
      'SELECT dashboard_json FROM cloud_dashboards WHERE user_id = $1',
      [harness.user.id],
    );
    expect(replacementStored.rows[0]?.dashboard_json).not.toBe(
      surrogateStored.rows[0]?.dashboard_json,
    );
    expect(replacementStored.rows[0]?.dashboard_json).toContain(replacementValue);
    expect(surrogateValue).not.toBe(replacementValue);
  });

  it('fails closed for an incompatible stored catalogue without rewriting it', async () => {
    const harness = await createUserAndProof();
    const db = requireDatabase();
    const first = intentFor(dashboardRequest(harness.userId, '0'), harness.userId);
    const written = await db.persistence.dashboards.compareAndWrite(
      harness.proof,
      first,
      () => true,
    );
    expect(written.status).toBe('written');
    await db.client.query(
      "UPDATE cloud_dashboards SET catalogue_digest = repeat('0', 64) WHERE user_id = $1",
      [harness.user.id],
    );
    const before = await db.client.query(
      'SELECT catalogue_digest, dashboard_json, revision FROM cloud_dashboards WHERE user_id = $1',
      [harness.user.id],
    );
    expect(await db.persistence.dashboards.read(harness.readProof)).toEqual({
      status: 'unavailable',
    });
    const after = await db.client.query(
      'SELECT catalogue_digest, dashboard_json, revision FROM cloud_dashboards WHERE user_id = $1',
      [harness.user.id],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('fails closed for an unknown built-in reference without rewriting it', async () => {
    const harness = await createUserAndProof();
    const db = requireDatabase();
    const intent = intentFor(
      dashboardRequest(harness.userId, '0', randomUUID(), dashboardWithEntry('note', 'unknown')),
      harness.userId,
    );
    const written = await db.persistence.dashboards.compareAndWrite(
      harness.proof,
      intent,
      () => true,
    );
    expect(written.status).toBe('written');
    const before = await db.client.query(
      'SELECT catalogue_digest, dashboard_json, revision FROM cloud_dashboards WHERE user_id = $1',
      [harness.user.id],
    );
    expect(await db.persistence.dashboards.read(harness.readProof)).toEqual({
      status: 'unavailable',
    });
    const after = await db.client.query(
      'SELECT catalogue_digest, dashboard_json, revision FROM cloud_dashboards WHERE user_id = $1',
      [harness.user.id],
    );
    expect(after.rows).toEqual(before.rows);
  });
});
