import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createAccountAuthorization,
  type AccountAuthorizationProof,
} from '../auth/account-authorization.js';
import type { ManagedIdentity } from '../auth/managed-identity.js';
import { createTestDatabase, type TestDatabase } from '../database/test-database.js';
import {
  createDashboardCatalogue,
  isAccountWorkspaceId,
  validateDashboardWrite,
} from '../dashboard/validation.js';
import type { AccountWorkspaceId } from '../dashboard/contracts.js';
import { validateAdoptionRequest } from '../adoption/contracts.js';

const APP_ORIGIN = 'https://app.example.test';
const catalogue = createDashboardCatalogue();
const TEST_TIME = new Date('2026-10-05T12:00:00.000Z');
let database: TestDatabase | undefined;
let now: Date;

interface Fixture {
  readonly accountId: AccountWorkspaceId;
  readonly identity: ManagedIdentity;
  readonly proof: AccountAuthorizationProof;
  readonly opportunityId: string;
}

function getDatabase(): TestDatabase {
  if (database === undefined) throw new Error('TEST_DATABASE_NOT_INITIALIZED');
  return database;
}

function accountId(value: string): AccountWorkspaceId {
  if (!isAccountWorkspaceId(value)) throw new Error('TEST_ACCOUNT_ID_INVALID');
  return value;
}

async function fixture(subject = `copy-${randomUUID()}`): Promise<Fixture> {
  const db = getDatabase();
  const identity: ManagedIdentity = {
    provider: 'neon',
    issuer: 'https://auth.example.test',
    subject,
    verifiedEmail: null,
    expiresAt: Math.floor(now.getTime() / 1000) + 30 * 60,
  };
  const initialized = await db.persistence.managedAccounts.initializeManagedAccount(identity);
  if (initialized.status !== 'initialized' || initialized.account.copyOpportunityId === undefined)
    throw new Error('TEST_ACCOUNT_INITIALIZATION_FAILED');
  const authorization = createAccountAuthorization({
    verify: () => Promise.resolve({ status: 'verified', identity }),
    lookup: db.persistence.managedAccounts,
    getAppOrigin: () => APP_ORIGIN,
    now: () => Math.floor(now.getTime() / 1000),
  });
  return {
    accountId: accountId(initialized.account.accountId),
    identity,
    proof: authorization.createProof(identity, initialized.account.accountId),
    opportunityId: initialized.account.copyOpportunityId,
  };
}

function copyRequest(
  fixture: Fixture,
  decision: 'yes' | 'no',
  opportunityId = fixture.opportunityId,
) {
  const requestId = randomUUID();
  if (decision === 'no') {
    return {
      decision,
      transportVersion: 1,
      expectedAccountWorkspaceId: fixture.accountId,
      copyOpportunityId: opportunityId,
      requestId,
    };
  }
  return {
    decision,
    transportVersion: 1,
    expectedAccountWorkspaceId: fixture.accountId,
    copyOpportunityId: opportunityId,
    expectedRevision: '0',
    requestId,
    catalogueVersion: catalogue.version,
    dashboard: {
      version: 10,
      state: {
        dashboardEntries: [
          {
            id: `entry-${requestId}`,
            trainingSetId: 'international-dojo-2-hour-session',
            quantityOverrides: {},
            activityNotes: {},
            notes: '',
            createdAt: now.toISOString(),
          },
        ],
      },
    },
  };
}

function validatedCopy(fixture: Fixture, request: unknown) {
  const result = validateAdoptionRequest(request, fixture.accountId);
  if (result.status !== 'valid') throw new Error(`TEST_COPY_INVALID_${result.error}`);
  return result.intent;
}

function dashboardIntent(fixture: Fixture, expectedRevision: string, requestId = randomUUID()) {
  const result = validateDashboardWrite(
    {
      transportVersion: 1,
      expectedAccountWorkspaceId: fixture.accountId,
      expectedRevision,
      requestId,
      catalogueVersion: catalogue.version,
      dashboard: { version: 10, state: { dashboardEntries: [] } },
    },
    fixture.accountId,
  );
  if (result.status !== 'valid') throw new Error(`TEST_SAVE_INVALID_${result.error}`);
  return result.intent;
}

async function readOpportunity(id: string) {
  return getDatabase().client.query<{
    opportunity_id: string;
    consumed_at: Date | null;
    outcome: string | null;
  }>(
    'SELECT opportunity_id, consumed_at, outcome FROM account_copy_opportunities WHERE user_id = $1',
    [id],
  );
}

beforeEach(async () => {
  now = new Date(TEST_TIME.getTime());
  database = await createTestDatabase({ clock: () => new Date(now.getTime()) });
});

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe('managed one-time guest copy persistence', () => {
  it('creates one account and delivers the opportunity only to the concurrent winner', async () => {
    const db = getDatabase();
    const identity: ManagedIdentity = {
      provider: 'neon',
      issuer: 'https://auth.example.test',
      subject: `concurrent-${randomUUID()}`,
      verifiedEmail: 'verified@example.test',
      expiresAt: Math.floor(now.getTime() / 1000) + 30 * 60,
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        db.persistence.managedAccounts.initializeManagedAccount(identity),
      ),
    );
    const initialized = results.filter((result) => result.status === 'initialized');
    expect(initialized).toHaveLength(8);
    const creations = initialized.filter((result) => result.account.created);
    expect(creations).toHaveLength(1);
    expect(creations[0]?.account.copyOpportunityId).toEqual(expect.any(String));
    expect(
      initialized
        .filter((result) => !result.account.created)
        .every((result) => result.account.copyOpportunityId === undefined),
    ).toBe(true);
    const uniqueAccounts = new Set(initialized.map((result) => result.account.accountId));
    expect(uniqueAccounts.size).toBe(1);
    const rows = await db.client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM account_copy_opportunities',
    );
    expect(rows.rows[0]?.count).toBe(1);
  });

  it('atomically writes a complete Yes copy and records accepted only after the second transaction', async () => {
    const user = await fixture();
    const intent = validatedCopy(user, copyRequest(user, 'yes'));
    const result = await getDatabase().persistence.managedCopy.consumeOpportunity(
      user.proof,
      intent,
      (write) => catalogue.isCompatible(write),
    );
    expect(result.status).toBe('accepted');
    const dashboard = await getDatabase().persistence.dashboards.read(user.proof);
    expect(dashboard.status).toBe('read');
    if (dashboard.status === 'read') {
      expect(dashboard.response.revision).toBe('1');
      expect(dashboard.response.dashboard?.state.dashboardEntries).toHaveLength(1);
    }
    const opportunity = await readOpportunity(user.accountId);
    expect(opportunity.rows[0]?.outcome).toBe('accepted');
    expect(opportunity.rows[0]?.consumed_at).toEqual(expect.any(Date));
  });

  it('permanently records No without writing a dashboard and rejects a second attempt', async () => {
    const user = await fixture();
    const intent = validatedCopy(user, copyRequest(user, 'no'));
    const result = await getDatabase().persistence.managedCopy.consumeOpportunity(
      user.proof,
      intent,
      () => true,
    );
    expect(result).toEqual({ status: 'declined' });
    expect((await getDatabase().persistence.dashboards.read(user.proof)).status).toBe('read');
    const opportunity = await readOpportunity(user.accountId);
    expect(opportunity.rows[0]?.outcome).toBe('declined');
    const replay = await getDatabase().persistence.managedCopy.consumeOpportunity(
      user.proof,
      intent,
      () => true,
    );
    expect(replay).toEqual({ status: 'capability-unavailable' });
  });

  it('leaves an invalid opportunity ID available for the valid request', async () => {
    const user = await fixture();
    const invalid = validatedCopy(user, copyRequest(user, 'no', randomUUID()));
    expect(
      await getDatabase().persistence.managedCopy.consumeOpportunity(
        user.proof,
        invalid,
        () => true,
      ),
    ).toEqual({ status: 'capability-unavailable' });
    expect((await readOpportunity(user.accountId)).rows[0]?.consumed_at).toBeNull();
    const valid = validatedCopy(user, copyRequest(user, 'no'));
    expect(
      await getDatabase().persistence.managedCopy.consumeOpportunity(user.proof, valid, () => true),
    ).toEqual({ status: 'declined' });
  });

  it('leaves the opportunity available when catalogue compatibility fails before consumption', async () => {
    const user = await fixture();
    const intent = validatedCopy(user, copyRequest(user, 'yes'));
    expect(
      await getDatabase().persistence.managedCopy.consumeOpportunity(
        user.proof,
        intent,
        () => false,
      ),
    ).toEqual({ status: 'catalogue-incompatible' });
    expect((await readOpportunity(user.accountId)).rows[0]?.consumed_at).toBeNull();
    const no = validatedCopy(user, copyRequest(user, 'no'));
    expect(
      await getDatabase().persistence.managedCopy.consumeOpportunity(user.proof, no, () => true),
    ).toEqual({ status: 'declined' });
  });

  it('serializes concurrent decisions so exactly one consumes and copies', async () => {
    const user = await fixture();
    const yes = validatedCopy(user, copyRequest(user, 'yes'));
    const no = validatedCopy(user, copyRequest(user, 'no'));
    const results = await Promise.all([
      getDatabase().persistence.managedCopy.consumeOpportunity(user.proof, yes, (write) =>
        catalogue.isCompatible(write),
      ),
      getDatabase().persistence.managedCopy.consumeOpportunity(user.proof, no, () => true),
    ]);
    expect(
      results.filter((result) => result.status === 'accepted' || result.status === 'declined'),
    ).toHaveLength(1);
    expect(results.filter((result) => result.status === 'capability-unavailable')).toHaveLength(1);
    const outcome = (await readOpportunity(user.accountId)).rows[0]?.outcome;
    expect(['accepted', 'declined']).toContain(outcome);
  });

  it('keeps the opportunity consumed and account usable after failure between consumption and copy', async () => {
    await database?.close();
    database = await createTestDatabase({
      clock: () => new Date(now.getTime()),
      afterCopyOpportunityConsumed: () => Promise.reject(new Error('COPY_INTERRUPTED')),
    });
    const user = await fixture();
    const intent = validatedCopy(user, copyRequest(user, 'yes'));
    expect(
      await getDatabase().persistence.managedCopy.consumeOpportunity(user.proof, intent, (write) =>
        catalogue.isCompatible(write),
      ),
    ).toEqual({ status: 'unavailable' });
    expect((await readOpportunity(user.accountId)).rows[0]?.outcome).toBe('consumed');
    expect((await getDatabase().persistence.dashboards.read(user.proof)).status).toBe('read');
    expect(
      await getDatabase().persistence.dashboards.compareAndWrite(
        user.proof,
        dashboardIntent(user, '0'),
        () => true,
      ),
    ).toMatchObject({ status: 'written' });
  });

  it('rolls back dashboard and accepted outcome when the second Yes transaction fails', async () => {
    await database?.close();
    database = await createTestDatabase({
      clock: () => new Date(now.getTime()),
      afterCopyWriteBeforeCommit: () => Promise.reject(new Error('COPY_COMMIT_ABORTED')),
    });
    const user = await fixture();
    const intent = validatedCopy(user, copyRequest(user, 'yes'));
    expect(
      await getDatabase().persistence.managedCopy.consumeOpportunity(user.proof, intent, (write) =>
        catalogue.isCompatible(write),
      ),
    ).toEqual({ status: 'unavailable' });
    expect((await readOpportunity(user.accountId)).rows[0]?.outcome).toBe('consumed');
    const read = await getDatabase().persistence.dashboards.read(user.proof);
    expect(read.status).toBe('read');
    if (read.status === 'read') expect(read.response.dashboard).toBeNull();
    expect(
      await getDatabase().persistence.dashboards.compareAndWrite(
        user.proof,
        dashboardIntent(user, '0'),
        () => true,
      ),
    ).toMatchObject({ status: 'written' });
  });

  it('returns unavailable when the Yes COMMIT succeeds but its response is lost', async () => {
    await database?.close();
    database = await createTestDatabase({
      clock: () => new Date(now.getTime()),
      afterCopyCommitResponseLost: () => Promise.reject(new Error('COMMIT_RESPONSE_LOST')),
    });
    const user = await fixture();
    const intent = validatedCopy(user, copyRequest(user, 'yes'));
    expect(
      await getDatabase().persistence.managedCopy.consumeOpportunity(user.proof, intent, (write) =>
        catalogue.isCompatible(write),
      ),
    ).toEqual({ status: 'unavailable' });
    expect((await readOpportunity(user.accountId)).rows[0]?.outcome).toBe('accepted');
    const read = await getDatabase().persistence.dashboards.read(user.proof);
    expect(read.status).toBe('read');
    if (read.status === 'read') expect(read.response.revision).toBe('1');
    expect(
      await getDatabase().persistence.managedCopy.consumeOpportunity(user.proof, intent, (write) =>
        catalogue.isCompatible(write),
      ),
    ).toEqual({ status: 'capability-unavailable' });
    expect(
      await getDatabase().persistence.dashboards.compareAndWrite(
        user.proof,
        dashboardIntent(user, '1'),
        () => true,
      ),
    ).toMatchObject({ status: 'written' });
  });

  it('aborts Yes after a committed Save between consumption and copy, preserving Save receipt and ordinary access', async () => {
    let signalConsumed: () => void = () => undefined;
    let resumeCopy: () => void = () => undefined;
    const consumedBarrier = new Promise<void>((resolve) => {
      signalConsumed = resolve;
    });
    const resumeBarrier = new Promise<void>((resolve) => {
      resumeCopy = resolve;
    });
    type SaveSnapshot = { readonly dashboard: unknown[]; readonly receipts: unknown[] };
    let captureBeforeResume: (snapshot: SaveSnapshot) => void = () => undefined;
    const beforeResumePromise = new Promise<SaveSnapshot>((resolve) => {
      captureBeforeResume = resolve;
    });
    await database?.close();
    database = undefined;
    database = await createTestDatabase({
      clock: () => new Date(now.getTime()),
      afterCopyOpportunityConsumed: async () => {
        signalConsumed();
        await resumeBarrier;
      },
    });
    const user = await fixture();
    const copyIntent = validatedCopy(user, copyRequest(user, 'yes'));
    const copyPromise = getDatabase().persistence.managedCopy.consumeOpportunity(
      user.proof,
      copyIntent,
      (write) => catalogue.isCompatible(write),
    );
    try {
      await consumedBarrier;
      expect((await readOpportunity(user.accountId)).rows[0]?.outcome).toBe('consumed');
      const saveRequest = dashboardIntent(user, '0');
      const saveOutcome = await getDatabase().persistence.dashboards.compareAndWrite(
        user.proof,
        saveRequest,
        () => true,
      );
      expect(saveOutcome.status).toBe('written');
      const savedDashboard = await getDatabase().client.query(
        'SELECT revision, transport_version, catalogue_digest, dashboard_json, created_at, updated_at FROM cloud_dashboards WHERE user_id = $1',
        [user.accountId],
      );
      const savedReceipt = await getDatabase().client.query<{ request_id: string }>(
        'SELECT request_id, request_digest, acknowledged_revision, acknowledged_at, created_at FROM dashboard_write_receipts WHERE user_id = $1',
        [user.accountId],
      );
      expect(savedDashboard.rows).toHaveLength(1);
      expect(savedReceipt.rows).toHaveLength(1);
      captureBeforeResume({ dashboard: savedDashboard.rows, receipts: savedReceipt.rows });
      if (saveOutcome.status !== 'written') throw new Error('TEST_SAVE_NOT_WRITTEN');
      expect(savedReceipt.rows[0]?.request_id).toBe(saveRequest.request.requestId);
    } finally {
      resumeCopy();
    }
    const beforeResume = await beforeResumePromise;
    expect(await copyPromise).toEqual({ status: 'revision-conflict' });
    const savedDashboardAfterCopy = await getDatabase().client.query(
      'SELECT revision, transport_version, catalogue_digest, dashboard_json, created_at, updated_at FROM cloud_dashboards WHERE user_id = $1',
      [user.accountId],
    );
    const savedReceiptAfterCopy = await getDatabase().client.query<{ request_id: string }>(
      'SELECT request_id, request_digest, acknowledged_revision, acknowledged_at, created_at FROM dashboard_write_receipts WHERE user_id = $1',
      [user.accountId],
    );
    expect({
      dashboard: savedDashboardAfterCopy.rows,
      receipts: savedReceiptAfterCopy.rows,
    }).toEqual(beforeResume);
    const read = await getDatabase().persistence.dashboards.read(user.proof);
    expect(read.status).toBe('read');
    if (read.status === 'read') expect(read.response.revision).toBe('1');
    const opportunity = await readOpportunity(user.accountId);
    expect(opportunity.rows[0]?.outcome).toBe('consumed');
    const receipts = await getDatabase().client.query<{ acknowledged_revision: string }>(
      'SELECT request_id, acknowledged_revision FROM dashboard_write_receipts WHERE user_id = $1',
      [user.accountId],
    );
    expect(receipts.rows).toHaveLength(1);
    expect(receipts.rows[0]?.acknowledged_revision).toBe('1');
    const secondSave = await getDatabase().persistence.dashboards.compareAndWrite(
      user.proof,
      dashboardIntent(user, '1'),
      () => true,
    );
    expect(secondSave.status).toBe('written');
  });

  it('consumes an unused opportunity as saved in the same transaction as the first ordinary Save', async () => {
    const user = await fixture();
    const saved = await getDatabase().persistence.dashboards.compareAndWrite(
      user.proof,
      dashboardIntent(user, '0'),
      () => true,
    );
    expect(saved.status).toBe('written');
    const opportunity = await readOpportunity(user.accountId);
    expect(opportunity.rows[0]?.outcome).toBe('saved');
    expect(opportunity.rows[0]?.consumed_at).toEqual(expect.any(Date));
  });
});
