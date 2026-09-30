import { randomInt, randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from '../auth/contracts.js';
import {
  createSessionAuthorization,
  type SessionAuthorizationProof,
} from '../auth/session-authorization.js';
import { sha256 } from '../auth/security.js';
import {
  createDashboardCatalogue,
  isAccountWorkspaceId,
  validateDashboardWrite,
} from '../dashboard/validation.js';
import { createTestDatabase, type TestDatabase } from '../database/test-database.js';

const BASE = Date.parse('2026-09-12T00:00:00.000Z');
const DAY = 86_400_000;
const ORIGIN = 'https://app.example.test';
const catalogue = createDashboardCatalogue();
let database: TestDatabase;
let now = BASE;
let deviceCounter = 0;

beforeEach(async () => {
  now = BASE;
  deviceCounter = 0;
  database = await createTestDatabase({ clock: () => new Date(now) });
});
afterEach(async () => {
  await database?.close();
});

async function device(userId?: string, idleMs = 20 * DAY) {
  deviceCounter += 1;
  const user =
    userId ??
    (
      await database.persistence.users.resolveByGoogleSubject({
        googleSub: `concurrency-${deviceCounter}`,
      })
    ).id;
  const token = Buffer.alloc(32, deviceCounter).toString('base64url');
  const csrf = Buffer.alloc(32, deviceCounter + 64).toString('base64url');
  const session = await database.persistence.sessions.create({
    userId: user,
    sessionTokenHash: sha256(token),
    csrfTokenHash: sha256(csrf),
    createdAt: new Date(BASE),
    lastActivityAt: new Date(BASE),
    idleExpiresAt: new Date(BASE + idleMs),
    absoluteExpiresAt: new Date(BASE + 30 * DAY),
  });
  const authorization = createSessionAuthorization({
    persistence: database.persistence,
    getAppOrigin: () => ORIGIN,
    clock: () => new Date(now),
  });
  const request = new Request(`${ORIGIN}/api/dashboard`, {
    method: 'PUT',
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${token}; ${CSRF_COOKIE_NAME}=${csrf}`,
      origin: ORIGIN,
      'x-csrf-token': csrf,
    },
  });
  const result = await authorization.authorizeWrite(request);
  if (result.status !== 'authorized') throw new Error('TEST_AUTHORIZATION_FAILED');
  return { proof: result.proof, session, authorization, request };
}

function intent(
  proof: SessionAuthorizationProof,
  revision: string,
  requestId: string = randomUUID(),
) {
  if (!isAccountWorkspaceId(proof.userId)) throw new Error('TEST_ACCOUNT_INVALID');
  const result = validateDashboardWrite(
    {
      transportVersion: 1,
      expectedAccountWorkspaceId: proof.userId,
      expectedRevision: revision,
      requestId,
      catalogueVersion: catalogue.version,
      dashboard: { version: 10, state: { dashboardEntries: [] } },
    },
    proof.userId,
  );
  if (result.status !== 'valid') throw new Error('TEST_INTENT_INVALID');
  return result.intent;
}

const write = (proof: SessionAuthorizationProof, value: ReturnType<typeof intent>) =>
  database.persistence.dashboards.compareAndWrite(proof, value, (candidate) =>
    catalogue.isCompatible(candidate),
  );

async function receipts(userId: string) {
  return (
    await database.client.query<{ request_id: string; revision: string }>(
      'SELECT request_id, acknowledged_revision::text AS revision FROM dashboard_write_receipts WHERE user_id = $1 ORDER BY acknowledged_revision',
      [userId],
    )
  ).rows;
}

async function activity(sessionId: string) {
  return (
    await database.client.query<{ last_activity_at: Date; idle_expires_at: Date }>(
      'SELECT last_activity_at, idle_expires_at FROM application_sessions WHERE id = $1',
      [sessionId],
    )
  ).rows;
}

/** Observe a real lock wait rather than assuming a request has reached its lock. */
async function waitForBlockedBy(pid: number): Promise<number> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const blocked = await database.persistence.pool.query<{ pid: number }>(
      'SELECT pid FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))',
      [pid],
    );
    if (blocked.rows[0]) return blocked.rows[0].pid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('TEST_LOCK_WAIT_NOT_OBSERVED');
}

async function clientPid(): Promise<number> {
  const result = await database.client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
  const pid = result.rows[0]?.pid;
  if (pid === undefined) throw new Error('TEST_PID_MISSING');
  return pid;
}

describe('dashboard account serialization', () => {
  it('increments revisions beyond Number precision and fails atomically at bigint exhaustion', async () => {
    const current = await device();
    expect((await write(current.proof, intent(current.proof, '0'))).status).toBe('written');
    await database.client.query('UPDATE cloud_dashboards SET revision = $1 WHERE user_id = $2', [
      '9007199254740992',
      current.proof.userId,
    ]);
    const incremented = await write(current.proof, intent(current.proof, '9007199254740992'));
    if (!('acknowledgement' in incremented)) throw new Error('TEST_ACK_MISSING');
    expect(incremented.acknowledgement.revision).toBe('9007199254740993');
    await database.client.query('UPDATE cloud_dashboards SET revision = $1 WHERE user_id = $2', [
      '9223372036854775807',
      current.proof.userId,
    ]);
    const beforeReceipts = await receipts(current.proof.userId);
    const beforeActivity = await activity(current.session.id);
    expect(await write(current.proof, intent(current.proof, '9223372036854775807'))).toEqual({
      status: 'unavailable',
    });
    expect(await receipts(current.proof.userId)).toEqual(beforeReceipts);
    expect(await activity(current.session.id)).toEqual(beforeActivity);
    const stored = await database.client.query<{ revision: string }>(
      'SELECT revision::text AS revision FROM cloud_dashboards WHERE user_id = $1',
      [current.proof.userId],
    );
    expect(stored.rows[0]?.revision).toBe('9223372036854775807');
  });

  it('rejects malformed and mismatched proof credentials before retained replay or cleanup', async () => {
    const current = await device();
    const second = await device(current.proof.userId);
    const original = intent(current.proof, '0');
    expect((await write(current.proof, original)).status).toBe('written');
    now += 8 * DAY;
    const beforeReceipts = await receipts(current.proof.userId);
    const beforeActivity = await activity(current.session.id);
    const beforeDashboard = (await database.client.query('SELECT * FROM cloud_dashboards')).rows;
    const mutations = [
      { userId: 'invalid' },
      { userId: randomUUID() },
      { sessionId: 'invalid' },
      { sessionId: second.session.id },
      { sessionTokenHash: 'invalid' },
      { sessionTokenHash: '0'.repeat(64) },
      { csrfTokenHash: 'invalid' },
      { csrfTokenHash: '0'.repeat(64) },
    ];
    for (const mutation of mutations) {
      const proof = { ...current.proof, ...mutation };
      expect(await write(proof, original)).toEqual({ status: 'unauthenticated' });
    }
    expect(await receipts(current.proof.userId)).toEqual(beforeReceipts);
    expect(await activity(current.session.id)).toEqual(beforeActivity);
    expect((await database.client.query('SELECT * FROM cloud_dashboards')).rows).toEqual(
      beforeDashboard,
    );
  });

  it('serializes first writes and two devices competing for an existing revision', async () => {
    const first = await device();
    const second = await device(first.proof.userId);
    for (const revision of ['0', '1']) {
      const outcomes = await Promise.all([
        write(first.proof, intent(first.proof, revision)),
        write(second.proof, intent(second.proof, revision)),
      ]);
      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
        'revision-conflict',
        'written',
      ]);
    }
    expect((await receipts(first.proof.userId)).map((row) => row.revision)).toEqual(['1', '2']);
  });

  it('serializes identical retries and recovers a lost response after intervening writes', async () => {
    const first = await device();
    const second = await device(first.proof.userId);
    const original = intent(first.proof, '0');
    const outcomes = await Promise.all([
      write(first.proof, original),
      write(second.proof, original),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['replayed', 'written']);
    if (!('acknowledgement' in outcomes[0]) || !('acknowledgement' in outcomes[1]))
      throw new Error('TEST_ACK_MISSING');
    expect(outcomes[0].acknowledgement).toEqual(outcomes[1].acknowledgement);
    now += 1_000;
    expect((await write(second.proof, intent(second.proof, '1'))).status).toBe('written');
    const before = await activity(first.session.id);
    expect(await write(first.proof, original)).toEqual({
      status: 'replayed',
      acknowledgement: outcomes[0].acknowledgement,
    });
    expect(await activity(first.session.id)).toEqual(before);
    expect(await write(first.proof, intent(first.proof, '2', original.request.requestId))).toEqual({
      status: 'request-id-reused',
    });
  });

  it('keeps identical request identifiers independent between accounts', async () => {
    const first = await device();
    const second = await device();
    const id = randomUUID();
    const results = await Promise.all([
      write(first.proof, intent(first.proof, '0', id)),
      write(second.proof, intent(second.proof, '0', id)),
    ]);
    expect(results.map((result) => result.status)).toEqual(['written', 'written']);
    expect(await receipts(first.proof.userId)).toEqual([{ request_id: id, revision: '1' }]);
    expect(await receipts(second.proof.userId)).toEqual([{ request_id: id, revision: '1' }]);
  });
});

describe('dashboard revocation and expiry locks', () => {
  it('revalidates expiry after waiting for a retained receipt without touching activity', async () => {
    const current = await device();
    const original = intent(current.proof, '0');
    expect((await write(current.proof, original)).status).toBe('written');
    await database.client.query(
      'UPDATE application_sessions SET idle_expires_at = $1 WHERE id = $2',
      [new Date(BASE + 1_000), current.session.id],
    );
    const beforeActivity = await activity(current.session.id);
    const beforeReceipts = await receipts(current.proof.userId);
    const pid = await clientPid();
    await database.client.query('BEGIN');
    await database.client.query(
      'SELECT request_id FROM dashboard_write_receipts WHERE user_id = $1 FOR UPDATE',
      [current.proof.userId],
    );
    const pending = write(current.proof, original);
    try {
      await waitForBlockedBy(pid);
      now = BASE + 1_000;
    } finally {
      await database.client.query('COMMIT');
    }
    expect(await pending).toEqual({ status: 'unauthenticated' });
    expect(await activity(current.session.id)).toEqual(beforeActivity);
    expect(await receipts(current.proof.userId)).toEqual(beforeReceipts);
  });

  it('bounds account lock waits with a fixed unavailable result and no mutations', async () => {
    const current = await device();
    const before = await activity(current.session.id);
    await database.client.query('BEGIN');
    await database.client.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [
      current.proof.userId,
    ]);
    try {
      expect(await write(current.proof, intent(current.proof, '0'))).toEqual({
        status: 'unavailable',
      });
    } finally {
      await database.client.query('ROLLBACK');
    }
    expect(await receipts(current.proof.userId)).toEqual([]);
    expect(await activity(current.session.id)).toEqual(before);
  });

  it('sets transaction-local statement limits and rolls back a timed-out dashboard statement', async () => {
    const current = await device();
    const before = await activity(current.session.id);
    await database.client
      .query(`CREATE FUNCTION timeout_dashboard_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('lock_timeout') <> '5s' OR current_setting('statement_timeout') <> '15s'
          OR current_setting('transaction_isolation') <> 'read committed' THEN
          RAISE EXCEPTION 'TEST_TRANSACTION_CONFIGURATION_INVALID';
        END IF;
        PERFORM pg_sleep(16);
        RETURN NEW;
      END $$`);
    await database.client.query(
      'CREATE TRIGGER timeout_dashboard_write BEFORE INSERT ON cloud_dashboards FOR EACH ROW EXECUTE FUNCTION timeout_dashboard_write()',
    );
    const started = performance.now();
    expect(await write(current.proof, intent(current.proof, '0'))).toEqual({
      status: 'unavailable',
    });
    // Reject an immediate configuration/SQL failure masquerading as timeout evidence.
    expect(performance.now() - started).toBeGreaterThan(14_000);
    expect((await database.client.query('SELECT * FROM cloud_dashboards')).rows).toEqual([]);
    expect(await receipts(current.proof.userId)).toEqual([]);
    expect(await activity(current.session.id)).toEqual(before);
  }, 25_000);

  it('rejects a proof from a session replaced after application authorization', async () => {
    const current = await device();
    now += 500;
    await database.persistence.sessions.replace({
      predecessorSessionId: current.session.id,
      userId: current.proof.userId,
      at: new Date(now),
      replacement: {
        userId: current.proof.userId,
        sessionTokenHash: sha256('replacement-session'),
        csrfTokenHash: sha256('replacement-csrf'),
        createdAt: new Date(now),
        lastActivityAt: new Date(now),
        idleExpiresAt: new Date(now + DAY),
        absoluteExpiresAt: new Date(now + 30 * DAY),
      },
    });
    expect(await write(current.proof, intent(current.proof, '0'))).toEqual({
      status: 'unauthenticated',
    });
    expect(await receipts(current.proof.userId)).toEqual([]);
  });

  it('keeps activity and dashboard timestamps monotonic and caps idle expiry at absolute expiry', async () => {
    const current = await device(undefined, 1_000);
    await database.client.query(
      'UPDATE application_sessions SET absolute_expires_at = $1 WHERE id = $2',
      [new Date(BASE + 2_000), current.session.id],
    );
    now = BASE + 500;
    const first = await write(current.proof, intent(current.proof, '0'));
    expect(first.status).toBe('written');
    const before = await activity(current.session.id);
    expect(before).toEqual([
      { last_activity_at: new Date(now), idle_expires_at: new Date(BASE + 2_000) },
    ]);
    now = BASE + 250;
    const second = await write(current.proof, intent(current.proof, '1'));
    if (!('acknowledgement' in first) || !('acknowledgement' in second))
      throw new Error('TEST_ACK_MISSING');
    expect(second.acknowledgement.updatedAt).toBe(first.acknowledgement.updatedAt);
    expect(await activity(current.session.id)).toEqual(before);
  });

  it('observes revocation that commits before its session lock is granted', async () => {
    const current = await device();
    const pid = await clientPid();
    await database.client.query('BEGIN');
    await database.client.query('UPDATE application_sessions SET revoked_at = $1 WHERE id = $2', [
      new Date(now),
      current.session.id,
    ]);
    const pending = write(current.proof, intent(current.proof, '0'));
    try {
      await waitForBlockedBy(pid);
    } finally {
      await database.client.query('COMMIT');
    }
    expect(await pending).toEqual({ status: 'unauthenticated' });
    expect(await receipts(current.proof.userId)).toEqual([]);
    expect((await database.client.query('SELECT * FROM cloud_dashboards')).rows).toEqual([]);
  });

  it('holds the session lock until the write commits before completed revocation', async () => {
    const current = await device();
    const key = randomInt(1, 2_000_000_000);
    const pid = await clientPid();
    // A real SQL trigger pauses the write after it owns the session/account locks.
    await database.client.query(
      `CREATE FUNCTION pause_dashboard_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${key}); RETURN NEW; END $$`,
    );
    await database.client.query(
      'CREATE TRIGGER pause_dashboard_write BEFORE INSERT ON cloud_dashboards FOR EACH ROW EXECUTE FUNCTION pause_dashboard_write()',
    );
    await database.client.query('SELECT pg_advisory_lock($1)', [key]);
    const pending = write(current.proof, intent(current.proof, '0'));
    let revocation: Promise<unknown> | undefined;
    try {
      const writerPid = await waitForBlockedBy(pid);
      revocation = database.persistence.sessions.revoke({
        userId: current.proof.userId,
        sessionId: current.session.id,
        at: new Date(now),
      });
      await waitForBlockedBy(writerPid);
    } finally {
      await database.client.query('SELECT pg_advisory_unlock($1)', [key]);
    }
    expect((await pending).status).toBe('written');
    await revocation;
    expect(await write(current.proof, intent(current.proof, '1'))).toEqual({
      status: 'unauthenticated',
    });
    expect((await receipts(current.proof.userId)).map((row) => row.revision)).toEqual(['1']);
  });

  it('rechecks expiry after an account lock wait without mutating dashboard or activity', async () => {
    const current = await device(undefined, 1_000);
    const before = await activity(current.session.id);
    const pid = await clientPid();
    await database.client.query('BEGIN');
    await database.client.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [
      current.proof.userId,
    ]);
    const pending = write(current.proof, intent(current.proof, '0'));
    try {
      await waitForBlockedBy(pid);
      now += 1_000;
    } finally {
      await database.client.query('COMMIT');
    }
    expect(await pending).toEqual({ status: 'unauthenticated' });
    expect(await receipts(current.proof.userId)).toEqual([]);
    expect(await activity(current.session.id)).toEqual(before);
  });
});

describe('bounded dashboard receipts', () => {
  it.each([-1, 0, 1])(
    'cleans seven-day-old receipts at boundary offset %i ms only on a new success',
    async (offset) => {
      const current = await device();
      const original = intent(current.proof, '0');
      expect((await write(current.proof, original)).status).toBe('written');
      now = BASE + 7 * DAY + offset;
      const before = await activity(current.session.id);
      expect((await write(current.proof, original)).status).toBe('replayed');
      expect(await activity(current.session.id)).toEqual(before);
      expect(await receipts(current.proof.userId)).toHaveLength(1);
      expect((await write(current.proof, intent(current.proof, '1'))).status).toBe('written');
      expect(await receipts(current.proof.userId)).toHaveLength(offset < 0 ? 2 : 1);
      expect((await write(current.proof, original)).status).toBe(
        offset < 0 ? 'replayed' : 'revision-conflict',
      );
    },
  );

  async function fillTo(current: Awaited<ReturnType<typeof device>>, count: number) {
    const original = intent(current.proof, '0');
    expect((await write(current.proof, original)).status).toBe('written');
    await database.client.query(
      `INSERT INTO dashboard_write_receipts (user_id, request_id, request_digest, acknowledged_revision, acknowledged_at, created_at)
       SELECT $1, ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, repeat('a', 64), g, $2, $2
       FROM generate_series(2, $3::integer) g`,
      [current.proof.userId, new Date(BASE), count],
    );
    await database.client.query('UPDATE cloud_dashboards SET revision = $1 WHERE user_id = $2', [
      count,
      current.proof.userId,
    ]);
    return original;
  }

  it('retains the 1024th receipt, evicts the oldest at 1025, and treats a forgotten ID with current revision as new', async () => {
    const current = await device();
    const other = await device();
    const otherIntent = intent(other.proof, '0');
    await write(other.proof, otherIntent);
    const original = await fillTo(current, 1023);
    expect((await write(current.proof, intent(current.proof, '1023'))).status).toBe('written');
    expect(await receipts(current.proof.userId)).toHaveLength(1024);
    expect((await write(current.proof, original)).status).toBe('replayed');
    expect((await write(current.proof, intent(current.proof, '1024'))).status).toBe('written');
    const retained = await receipts(current.proof.userId);
    expect(retained).toHaveLength(1024);
    expect(retained[0]?.revision).toBe('2');
    expect(retained.at(-1)?.revision).toBe('1025');
    expect(await write(current.proof, original)).toEqual({
      status: 'revision-conflict',
      currentRevision: '1025',
    });
    expect(
      (await write(current.proof, intent(current.proof, '1025', original.request.requestId)))
        .status,
    ).toBe('written');
    expect((await write(other.proof, otherIntent)).status).toBe('replayed');
    expect(await receipts(other.proof.userId)).toHaveLength(1);
  });

  it('keeps exactly the newest 1024 revisions during competing writes at capacity', async () => {
    const first = await device();
    const second = await device(first.proof.userId);
    await fillTo(first, 1024);
    const outcomes = await Promise.all([
      write(first.proof, intent(first.proof, '1024')),
      write(second.proof, intent(second.proof, '1024')),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
      'revision-conflict',
      'written',
    ]);
    const retained = await receipts(first.proof.userId);
    expect(retained).toHaveLength(1024);
    expect(retained[0]?.revision).toBe('2');
    expect(retained.at(-1)?.revision).toBe('1025');
  });
});
