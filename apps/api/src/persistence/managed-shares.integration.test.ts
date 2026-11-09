import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TRAINING_SETS, type DashboardQuantityOverrides } from '@kendo-menu/domain';

import {
  createAccountAuthorization,
  type AccountAuthorizationProof,
} from '../auth/account-authorization.js';
import type { ManagedIdentity } from '../auth/managed-identity.js';
import { createTestDatabase, type TestDatabase } from '../database/test-database.js';
import {
  createDashboardCatalogue,
  isAccountWorkspaceId,
  isRevision,
  validateDashboardWrite,
} from '../dashboard/validation.js';
import type { AccountWorkspaceId, Revision } from '../dashboard/contracts.js';

const ORIGIN = 'https://app.example.test';
const TIME = new Date('2026-11-09T10:00:00.000Z');
const catalogue = createDashboardCatalogue();
let database: TestDatabase | undefined;
let now = new Date(TIME);
let shareWriteHook: (() => Promise<void>) | undefined;
let shareCommitResponseLostHook: (() => Promise<void>) | undefined;

interface User {
  readonly accountId: AccountWorkspaceId;
  readonly identity: ManagedIdentity;
  readonly proof: AccountAuthorizationProof;
}

function getDatabase(): TestDatabase {
  if (database === undefined) throw new Error('TEST_DATABASE_NOT_INITIALIZED');
  return database;
}

async function user(subject = randomUUID()): Promise<User> {
  const db = getDatabase();
  const identity: ManagedIdentity = {
    provider: 'neon',
    issuer: 'https://auth.example.test',
    subject,
    verifiedEmail: null,
    expiresAt: Math.floor(now.getTime() / 1_000) + 3_600,
  };
  const initialized = await db.persistence.managedAccounts.initializeManagedAccount(identity);
  if (initialized.status !== 'initialized' || !isAccountWorkspaceId(initialized.account.accountId))
    throw new Error('TEST_ACCOUNT_INITIALIZATION_FAILED');
  const authorization = createAccountAuthorization({
    verify: () => Promise.resolve({ status: 'verified', identity }),
    lookup: db.persistence.managedAccounts,
    getAppOrigin: () => ORIGIN,
    now: () => Math.floor(now.getTime() / 1_000),
  });
  return {
    accountId: initialized.account.accountId,
    identity,
    proof: authorization.createProof(identity, initialized.account.accountId),
  };
}

function customMenu(
  overrides: DashboardQuantityOverrides = {},
  noteVersion = 0,
  entryId = 'source-entry-id',
  idPrefix = '',
) {
  const trainingSetId = `${idPrefix}custom-menu-id`;
  const sectionId = `${idPrefix}section-id`;
  const exerciseId = `${idPrefix}exercise-id`;
  return {
    id: trainingSetId,
    name: 'Suburi practice',
    description: `Private description ${noteVersion}`,
    category: 'custom',
    customIntensity: 'high-intensity-drill',
    sections: [
      {
        id: sectionId,
        name: 'Warm up',
        notes: `private section note ${noteVersion}`,
        exercises: [
          {
            id: exerciseId,
            name: 'Suburi',
            quantities: { repetitions: 10, duration: { unit: 'minutes', value: 3 } },
            notes: `private exercise note ${noteVersion}`,
          },
        ],
      },
    ],
    isBuiltIn: false,
    entry: {
      id: entryId,
      trainingSetId,
      quantityOverrides: overrides,
      activityNotes: {},
      notes: `private practice note ${noteVersion}`,
      createdAt: TIME.toISOString(),
    },
  };
}

function writeRequest(user: User, expectedRevision: string, dashboardEntries: readonly unknown[]) {
  const requestId = randomUUID();
  const validated = validateDashboardWrite(
    {
      transportVersion: 1,
      expectedAccountWorkspaceId: user.accountId,
      expectedRevision,
      requestId,
      catalogueVersion: catalogue.version,
      dashboard: { version: 10, state: { dashboardEntries } },
    },
    user.accountId,
  );
  if (validated.status !== 'valid') throw new Error(`TEST_SAVE_INVALID_${validated.error}`);
  return validated.intent;
}

async function save(user: User, expectedRevision: string, menu?: ReturnType<typeof customMenu>) {
  const dashboardEntries =
    menu === undefined
      ? []
      : [
          {
            ...menu.entry,
            trainingSet: {
              id: menu.id,
              name: menu.name,
              description: menu.description,
              category: menu.category,
              customIntensity: menu.customIntensity,
              sections: menu.sections,
              isBuiltIn: false,
            },
          },
        ];
  return saveEntries(user, expectedRevision, dashboardEntries);
}

async function saveEntries(
  user: User,
  expectedRevision: string,
  dashboardEntries: readonly unknown[],
) {
  return getDatabase().persistence.dashboards.compareAndWrite(
    user.proof,
    writeRequest(user, expectedRevision, dashboardEntries),
    () => true,
  );
}

function revision(value: string): Revision {
  if (!isRevision(value)) throw new Error('TEST_REVISION_INVALID');
  return value;
}

beforeEach(async () => {
  now = new Date(TIME);
  shareWriteHook = undefined;
  shareCommitResponseLostHook = undefined;
  database = await createTestDatabase({
    clock: () => new Date(now),
    afterShareWriteBeforeCommit: async () => {
      await shareWriteHook?.();
    },
    afterShareCommitResponseLost: async () => {
      await shareCommitResponseLostHook?.();
    },
  });
});

afterEach(async () => {
  shareWriteHook = undefined;
  shareCommitResponseLostHook = undefined;
  await database?.close();
  database = undefined;
});

describe('managed custom-menu shares', () => {
  it('creates an opaque immutable snapshot, excludes notes, and reuses identical content', async () => {
    const owner = await user();
    const menu = customMenu({ 'exercise-id': { repetitions: 20, seconds: 15 } });
    expect((await save(owner, '0', menu)).status).toBe('written');
    const shares = getDatabase().persistence.shares;
    const first = await shares.create(owner.proof, revision('1'), 'source-entry-id');
    expect(first.status).toBe('created');
    if (first.status !== 'created') throw new Error('TEST_SHARE_CREATE_FAILED');
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const publicShare = await shares.read(first.token);
    expect(publicShare).toMatchObject({
      status: 'found',
      snapshot: {
        version: 1,
        name: 'Suburi practice',
        customIntensity: 'high-intensity-drill',
        sections: [
          {
            name: 'Warm up',
            exercises: [
              {
                name: 'Suburi',
                quantities: {
                  repetitions: 20,
                  duration: { unit: 'seconds', value: 15 },
                },
                additionalDuration: { unit: 'minutes', value: 3 },
              },
            ],
          },
        ],
      },
    });
    if (publicShare.status !== 'found') throw new Error('TEST_SHARE_READ_FAILED');
    expect(JSON.stringify(publicShare.snapshot)).not.toMatch(
      /private|description|exercise-id|section-id/u,
    );

    const repeated = await shares.create(owner.proof, revision('1'), 'source-entry-id');
    expect(repeated).toEqual(first);
  });

  it('deduplicates concurrent creates for the same saved snapshot', async () => {
    const owner = await user();
    expect((await save(owner, '0', customMenu())).status).toBe('written');
    const shares = getDatabase().persistence.shares;
    const [first, second] = await Promise.all([
      shares.create(owner.proof, revision('1'), 'source-entry-id'),
      shares.create(owner.proof, revision('1'), 'source-entry-id'),
    ]);
    if (first.status !== 'created' || second.status !== 'created')
      throw new Error('TEST_CONCURRENT_SHARE_CREATE_FAILED');
    expect(second.token).toBe(first.token);
    const rows = await getDatabase().client.query(
      'SELECT token FROM menu_shares WHERE owner_id = $1 AND source_entry_id = $2',
      [owner.accountId, 'source-entry-id'],
    );
    expect(rows.rows).toHaveLength(1);
  });

  it('reuses a link when only private notes change', async () => {
    const owner = await user();
    expect((await save(owner, '0', customMenu())).status).toBe('written');
    const shares = getDatabase().persistence.shares;
    const first = await shares.create(owner.proof, revision('1'), 'source-entry-id');
    if (first.status !== 'created') throw new Error('TEST_SHARE_CREATE_FAILED');

    expect((await save(owner, '1', customMenu({}, 1))).status).toBe('written');
    const repeated = await shares.create(owner.proof, revision('2'), 'source-entry-id');
    if (repeated.status !== 'created') throw new Error('TEST_SHARE_NOTE_ONLY_REUSE_FAILED');
    expect(repeated.token).toBe(first.token);
    expect(repeated.sourceRevision).toBe('2');
  });

  it('uses the current saved quantities for new links and leaves old links frozen', async () => {
    const owner = await user();
    expect((await save(owner, '0', customMenu())).status).toBe('written');
    const shares = getDatabase().persistence.shares;
    const first = await shares.create(owner.proof, revision('1'), 'source-entry-id');
    if (first.status !== 'created') throw new Error('TEST_SHARE_CREATE_FAILED');

    expect(
      (await save(owner, '1', customMenu({ 'exercise-id': { repetitions: 25 } }))).status,
    ).toBe('written');
    const second = await shares.create(owner.proof, revision('2'), 'source-entry-id');
    if (second.status !== 'created') throw new Error('TEST_SHARE_UPDATE_FAILED');
    expect(second.token).not.toBe(first.token);

    const oldSnapshot = await shares.read(first.token);
    const newSnapshot = await shares.read(second.token);
    expect(oldSnapshot).toMatchObject({
      status: 'found',
      snapshot: {
        sections: [
          {
            exercises: [
              {
                quantities: { repetitions: 10 },
              },
            ],
          },
        ],
      },
    });
    expect(newSnapshot).toMatchObject({
      status: 'found',
      snapshot: {
        sections: [
          {
            exercises: [
              {
                quantities: { repetitions: 25 },
              },
            ],
          },
        ],
      },
    });
  });

  it('returns revision conflicts and rejects unsaved, built-in, and foreign entries', async () => {
    const owner = await user();
    const shares = getDatabase().persistence.shares;
    expect(await shares.create(owner.proof, revision('1'), 'source-entry-id')).toEqual({
      status: 'revision-conflict',
      currentRevision: '0',
    });
    expect(await shares.create(owner.proof, revision('0'), 'source-entry-id')).toEqual({
      status: 'not-shareable',
    });
    expect((await save(owner, '0', customMenu())).status).toBe('written');
    expect(await shares.create(owner.proof, revision('0'), 'source-entry-id')).toEqual({
      status: 'revision-conflict',
      currentRevision: '1',
    });
    expect(await shares.create(owner.proof, revision('1'), 'missing-entry')).toEqual({
      status: 'not-shareable',
    });
    const other = await user();
    expect((await save(other, '0', customMenu({}, 0, 'other-entry-id'))).status).toBe('written');
    expect(await shares.create(owner.proof, revision('1'), 'other-entry-id')).toEqual({
      status: 'not-shareable',
    });
    expect(await shares.readForRecipient(other.proof, 'invalid-token')).toEqual({
      status: 'not-found',
    });
    const share = await shares.create(owner.proof, revision('1'), 'source-entry-id');
    if (share.status !== 'created') throw new Error('TEST_SHARE_CREATE_FAILED');
    expect(await shares.readForRecipient(owner.proof, share.token)).toMatchObject({
      status: 'found',
      isSender: true,
    });
    expect(await shares.readForRecipient(other.proof, share.token)).toMatchObject({
      status: 'found',
      isSender: false,
    });

    const builtInOwner = await user();
    const builtInSet = DEFAULT_TRAINING_SETS[0];
    if (builtInSet === undefined) throw new Error('TEST_BUILT_IN_FIXTURE_MISSING');
    const builtInEntry = {
      id: 'built-in-entry-id',
      trainingSetId: builtInSet.id,
      quantityOverrides: {},
      activityNotes: {},
      notes: '',
      createdAt: TIME.toISOString(),
    };
    expect((await saveEntries(builtInOwner, '0', [builtInEntry])).status).toBe('written');
    expect(await shares.create(builtInOwner.proof, revision('1'), 'built-in-entry-id')).toEqual({
      status: 'not-shareable',
    });
  });

  it('rolls back failed creates and reports an uncertain committed create as unavailable', async () => {
    const owner = await user();
    expect((await save(owner, '0', customMenu())).status).toBe('written');
    const shares = getDatabase().persistence.shares;
    shareWriteHook = () => Promise.reject(new Error('TEST_SHARE_WRITE_ABORTED'));
    expect(await shares.create(owner.proof, revision('1'), 'source-entry-id')).toEqual({
      status: 'unavailable',
    });
    const rolledBack = await getDatabase().client.query(
      'SELECT token FROM menu_shares WHERE owner_id = $1',
      [owner.accountId],
    );
    expect(rolledBack.rows).toHaveLength(0);

    shareWriteHook = undefined;
    shareCommitResponseLostHook = () =>
      Promise.reject(new Error('TEST_SHARE_COMMIT_RESPONSE_LOST'));
    expect(await shares.create(owner.proof, revision('1'), 'source-entry-id')).toEqual({
      status: 'unavailable',
    });
    const committedBeforeRetry = await getDatabase().client.query<{ token: string }>(
      'SELECT token FROM menu_shares WHERE owner_id = $1',
      [owner.accountId],
    );
    expect(committedBeforeRetry.rows).toHaveLength(1);
    shareCommitResponseLostHook = undefined;
    const retried = await shares.create(owner.proof, revision('1'), 'source-entry-id');
    expect(retried).toMatchObject({
      status: 'created',
      token: committedBeforeRetry.rows[0]?.token,
    });
    const committed = await getDatabase().client.query(
      'SELECT token FROM menu_shares WHERE owner_id = $1',
      [owner.accountId],
    );
    expect(committed.rows).toHaveLength(1);
  });

  it('keeps links alive after the source dashboard entry is removed', async () => {
    const owner = await user();
    expect((await save(owner, '0', customMenu())).status).toBe('written');
    const shares = getDatabase().persistence.shares;
    const share = await shares.create(owner.proof, revision('1'), 'source-entry-id');
    if (share.status !== 'created') throw new Error('TEST_SHARE_CREATE_FAILED');
    expect((await save(owner, '1')).status).toBe('written');
    expect(await shares.read(share.token)).toMatchObject({ status: 'found' });
  });

  it('deletes an owner share while preserving a recipient’s saved independent copy', async () => {
    const owner = await user();
    expect((await save(owner, '0', customMenu())).status).toBe('written');
    const shares = getDatabase().persistence.shares;
    const share = await shares.create(owner.proof, revision('1'), 'source-entry-id');
    if (share.status !== 'created') throw new Error('TEST_SHARE_CREATE_FAILED');

    const recipient = await user();
    expect((await save(recipient, '0', customMenu({}, 0, 'recipient-copy-entry'))).status).toBe(
      'written',
    );
    await getDatabase().client.query('DELETE FROM dashboard_write_receipts WHERE user_id = $1', [
      owner.accountId,
    ]);
    await getDatabase().client.query('DELETE FROM cloud_dashboards WHERE user_id = $1', [
      owner.accountId,
    ]);
    await getDatabase().client.query('DELETE FROM account_copy_opportunities WHERE user_id = $1', [
      owner.accountId,
    ]);
    await getDatabase().client.query('DELETE FROM users WHERE id = $1', [owner.accountId]);

    expect(await shares.read(share.token)).toEqual({ status: 'not-found' });
    expect(await getDatabase().persistence.dashboards.read(recipient.proof)).toMatchObject({
      status: 'read',
      response: {
        dashboard: {
          state: {
            dashboardEntries: [
              {
                id: 'recipient-copy-entry',
                trainingSet: { name: 'Suburi practice' },
              },
            ],
          },
        },
      },
    });
  });
});
