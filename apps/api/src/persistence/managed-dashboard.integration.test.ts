import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAccountAuthorization } from '../auth/account-authorization.js';
import type { AccountAuthorizationProof } from '../auth/account-authorization.js';
import type { ManagedIdentity } from '../auth/managed-identity.js';
import { createTestDatabase } from '../database/test-database.js';
import type { TestDatabase } from '../database/test-database.js';
import { MAX_REVISION } from '../dashboard/contracts.js';
import type { AccountWorkspaceId } from '../dashboard/contracts.js';
import {
  createDashboardCatalogue,
  isAccountWorkspaceId,
  validateDashboardWrite,
} from '../dashboard/validation.js';

const origin = 'https://app.example.test';
const catalogue = createDashboardCatalogue();
const initialTime = new Date('2026-10-05T12:00:00.000Z');
const day = 86_400_000;
let db: TestDatabase;
let now: Date;

interface Fixture {
  readonly accountId: AccountWorkspaceId;
  readonly identity: ManagedIdentity;
  readonly proof: AccountAuthorizationProof;
}

beforeEach(async () => {
  now = new Date(initialTime);
  db = await createTestDatabase({ clock: () => new Date(now) });
});
afterEach(async () => {
  await db?.close();
});

async function fixture(subject: string = randomUUID()): Promise<Fixture> {
  const identity: ManagedIdentity = {
    provider: 'neon',
    issuer: 'https://auth.example.test',
    subject,
    verifiedEmail: 'same-email@example.test',
    expiresAt: Math.floor(now.getTime() / 1_000) + (30 * day) / 1_000,
  };
  const initialized = await db.persistence.managedAccounts.initializeManagedAccount(identity);
  if (
    initialized.status !== 'initialized' ||
    !isAccountWorkspaceId(initialized.account.accountId)
  ) {
    throw new Error('TEST_ACCOUNT_INITIALIZATION_FAILED');
  }
  const authorization = createAccountAuthorization({
    verify: () => Promise.resolve({ status: 'verified', identity }),
    lookup: db.persistence.managedAccounts,
    getAppOrigin: () => origin,
    now: () => Math.floor(now.getTime() / 1_000),
  });
  return {
    accountId: initialized.account.accountId,
    identity,
    proof: authorization.createProof(identity, initialized.account.accountId),
  };
}

function intent(
  user: Fixture,
  expectedRevision = '0',
  requestId: string = randomUUID(),
  note?: string,
) {
  const result = validateDashboardWrite(
    {
      transportVersion: 1,
      expectedAccountWorkspaceId: user.accountId,
      expectedRevision,
      requestId,
      catalogueVersion: catalogue.version,
      dashboard: {
        version: 10,
        state: {
          dashboardEntries:
            note === undefined
              ? []
              : [
                  {
                    id: 'complete-entry',
                    trainingSetId: 'international-dojo-2-hour-session',
                    quantityOverrides: {},
                    activityNotes: {},
                    notes: note,
                    createdAt: initialTime.toISOString(),
                  },
                ],
        },
      },
    },
    user.accountId,
  );
  if (result.status !== 'valid') throw new Error(`TEST_SAVE_INVALID_${result.error}`);
  return result.intent;
}

async function snapshot(user: Fixture) {
  const dashboards = await db.client.query('SELECT * FROM cloud_dashboards WHERE user_id = $1', [
    user.accountId,
  ]);
  const receipts = await db.client.query(
    'SELECT * FROM dashboard_write_receipts WHERE user_id = $1 ORDER BY acknowledged_revision',
    [user.accountId],
  );
  const opportunities = await db.client.query(
    'SELECT * FROM account_copy_opportunities WHERE user_id = $1',
    [user.accountId],
  );
  return {
    dashboards: dashboards.rows,
    receipts: receipts.rows,
    opportunities: opportunities.rows,
  };
}

async function awaitBlockedBy(pid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await db.persistence.pool.query<{ blocked: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked',
      [pid],
    );
    if (result.rows[0]?.blocked === true) return;
  }
  throw new Error('TEST_ACCOUNT_LOCK_WAIT_NOT_OBSERVED');
}

describe('managed PostgreSQL dashboard ownership and Save receipts', () => {
  it('isolates managed mappings with equal email and preserves an unrelated legacy account', async () => {
    await db.client.query(
      "INSERT INTO users (google_sub, verified_google_email) VALUES ('legacy-google', 'same-email@example.test')",
    );
    const first = await fixture('first-subject');
    const second = await fixture('second-subject');
    expect(first.accountId).not.toBe(second.accountId);
    const userCount = await db.client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM users',
    );
    expect(userCount.rows[0]?.count).toBe(3);
    const saved = await db.persistence.dashboards.compareAndWrite(
      first.proof,
      intent(first, '0', randomUUID(), 'private first account'),
      () => true,
    );
    expect(saved.status).toBe('written');
    const emptySecond = await db.persistence.dashboards.read(second.proof);
    expect(emptySecond).toMatchObject({
      status: 'read',
      response: { revision: '0', dashboard: null },
    });
    const wrongIdentity = Object.freeze({ ...first.proof, subject: second.identity.subject });
    expect(await db.persistence.dashboards.read(wrongIdentity)).toEqual({
      status: 'unauthenticated',
    });
    const before = await snapshot(first);
    expect(
      await db.persistence.dashboards.compareAndWrite(second.proof, intent(first), () => true),
    ).toEqual({ status: 'workspace-mismatch' });
    expect(await snapshot(first)).toEqual(before);
    const firstAgain = await db.persistence.dashboards.read(first.proof);
    expect(firstAgain).toMatchObject({ status: 'read', response: { revision: '1' } });
  });

  it('serializes concurrent writes at revision zero with one winner', async () => {
    const user = await fixture();
    const results = await Promise.all([
      db.persistence.dashboards.compareAndWrite(user.proof, intent(user), () => true),
      db.persistence.dashboards.compareAndWrite(user.proof, intent(user), () => true),
    ]);
    expect(results.filter((result) => result.status === 'written')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'revision-conflict')).toEqual([
      { status: 'revision-conflict', currentRevision: '1' },
    ]);
    expect((await snapshot(user)).receipts).toHaveLength(1);
  });

  it('serializes identical concurrent request IDs into a write and retained replay', async () => {
    const user = await fixture();
    const request = intent(user);
    const results = await Promise.all([
      db.persistence.dashboards.compareAndWrite(user.proof, request, () => true),
      db.persistence.dashboards.compareAndWrite(user.proof, request, () => true),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['replayed', 'written']);
    expect((await snapshot(user)).receipts).toHaveLength(1);
  });

  it('returns original acknowledgements before current catalogue/revision checks and rejects changed reuse', async () => {
    const user = await fixture();
    const request = intent(user);
    const first = await db.persistence.dashboards.compareAndWrite(user.proof, request, () => true);
    expect(first.status).toBe('written');
    expect(
      (await db.persistence.dashboards.compareAndWrite(user.proof, intent(user, '1'), () => true))
        .status,
    ).toBe('written');
    const before = await snapshot(user);
    const replay = await db.persistence.dashboards.compareAndWrite(
      user.proof,
      request,
      () => false,
    );
    expect(replay.status).toBe('replayed');
    if (first.status !== 'written' || replay.status !== 'replayed')
      throw new Error('TEST_ACKNOWLEDGEMENT_MISSING');
    expect(replay.acknowledgement).toEqual(first.acknowledgement);
    expect(
      await db.persistence.dashboards.compareAndWrite(
        user.proof,
        intent(user, '1', request.request.requestId),
        () => true,
      ),
    ).toEqual({ status: 'request-id-reused' });
    expect(await snapshot(user)).toEqual(before);
  });

  it('does not consume opportunity or mutate storage on catalogue rejection and stale revisions', async () => {
    const user = await fixture();
    const before = await snapshot(user);
    expect(
      await db.persistence.dashboards.compareAndWrite(user.proof, intent(user), () => false),
    ).toEqual({ status: 'catalogue-incompatible' });
    expect(
      await db.persistence.dashboards.compareAndWrite(user.proof, intent(user, '1'), () => true),
    ).toEqual({ status: 'revision-conflict', currentRevision: '0' });
    expect(await snapshot(user)).toEqual(before);
  });

  it('cleans receipts after seven days only on a new successful Save, preserving retained replay', async () => {
    const user = await fixture();
    const first = intent(user);
    expect(
      (await db.persistence.dashboards.compareAndWrite(user.proof, first, () => true)).status,
    ).toBe('written');
    now = new Date(initialTime.getTime() + 8 * day);
    const before = await snapshot(user);
    expect(
      (await db.persistence.dashboards.compareAndWrite(user.proof, first, () => true)).status,
    ).toBe('replayed');
    expect(await snapshot(user)).toEqual(before);
    expect(
      (await db.persistence.dashboards.compareAndWrite(user.proof, intent(user, '1'), () => true))
        .status,
    ).toBe('written');
    expect((await snapshot(user)).receipts).toHaveLength(1);
  });

  it('fails atomically at PostgreSQL bigint revision exhaustion', async () => {
    const user = await fixture();
    await db.persistence.dashboards.compareAndWrite(user.proof, intent(user), () => true);
    await db.client.query('UPDATE cloud_dashboards SET revision = $2 WHERE user_id = $1', [
      user.accountId,
      MAX_REVISION,
    ]);
    const before = await snapshot(user);
    expect(
      await db.persistence.dashboards.compareAndWrite(
        user.proof,
        intent(user, MAX_REVISION),
        () => true,
      ),
    ).toEqual({ status: 'unavailable' });
    expect(await snapshot(user)).toEqual(before);
  });

  it.each([false, true])(
    'rejects JWT expiry after an observed account-lock wait (retained replay=%s)',
    async (replay) => {
      const user = await fixture();
      const request = intent(user);
      if (replay) await db.persistence.dashboards.compareAndWrite(user.proof, request, () => true);
      const before = await snapshot(user);
      await db.client.query('BEGIN');
      await db.client.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [
        user.accountId,
      ]);
      const backend = await db.client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const pid = backend.rows[0]?.pid;
      if (pid === undefined) throw new Error('TEST_BLOCKING_PID_MISSING');
      const pending = db.persistence.dashboards.compareAndWrite(user.proof, request, () => true);
      try {
        await awaitBlockedBy(pid);
        now = new Date(user.identity.expiresAt * 1_000);
      } finally {
        await db.client.query('COMMIT');
      }
      expect(await pending).toEqual({ status: 'unauthenticated' });
      expect(await snapshot(user)).toEqual(before);
    },
  );
});
