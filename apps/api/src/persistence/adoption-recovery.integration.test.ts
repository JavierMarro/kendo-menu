/**
 * Recovery evidence for adoption's account-level terminal receipt.
 *
 * These cases use the guarded local PostgreSQL harness only. A COMMIT response
 * is deliberately lost after PostgreSQL has committed so the adapter must
 * return a fixed unavailable outcome while a later login can recover the
 * durable adoption state through the real authentication session projection.
 */
import { createHash } from 'node:crypto';

import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuthentication } from '../auth/authentication.js';
import { SESSION_ABSOLUTE_LIFETIME_MS, SESSION_IDLE_LIFETIME_MS } from '../auth/contracts.js';
import { createSessionAuthorization } from '../auth/session-authorization.js';
import type { SessionAuthorizationProof } from '../auth/session-authorization.js';
import {
  createDashboardCatalogue,
  isAccountWorkspaceId,
  isCatalogueVersion,
  validateDashboardWrite,
} from '../dashboard/validation.js';
import type { ValidatedDashboardWrite } from '../dashboard/validation.js';
import { createTestDatabase, type TestDatabase } from '../database/test-database.js';
import { validateAdoptionRequest } from '../adoption/contracts.js';

const APP_ORIGIN = 'https://app.example.test';
const GOOGLE_CONFIGURATION = {
  clientId: 'recovery-test-client',
  clientSecret: 'recovery-test-secret',
  redirectUri: `${APP_ORIGIN}/api/auth/google/callback`,
  appOrigin: APP_ORIGIN,
} as const;
const BASE_TIME = Date.parse('2026-09-19T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1_000;
const CATALOGUE = createDashboardCatalogue();

const TERMINAL_CASES = [
  {
    label: 'accepted Yes',
    decision: 'yes',
    requestId: '11111111-1111-4111-8111-111111111111',
    oppositeRequestId: '22222222-2222-4222-8222-222222222222',
  },
  {
    label: 'declined No',
    decision: 'no',
    requestId: '33333333-3333-4333-8333-333333333333',
    oppositeRequestId: '44444444-4444-4444-8444-444444444444',
  },
] as const;

let database: TestDatabase | undefined;
let currentTime = BASE_TIME;
let sequence = 0;

function now(): Date {
  return new Date(currentTime);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function nextSubject(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function db(): TestDatabase {
  if (database === undefined) throw new Error('TEST_DATABASE_NOT_INITIALIZED');
  return database;
}

function workspaceId(value: string) {
  if (!isAccountWorkspaceId(value)) throw new Error('TEST_WORKSPACE_ID_INVALID');
  return value;
}

function catalogueVersion(value: string) {
  if (!isCatalogueVersion(value)) throw new Error('TEST_CATALOGUE_VERSION_INVALID');
  return value;
}

interface AccountFixture {
  readonly googleSub: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly token: string;
  readonly csrf: string;
  readonly sessionTokenHash: string;
  readonly csrfTokenHash: string;
}

async function completeLogin(googleSub: string): Promise<AccountFixture> {
  sequence += 1;
  const token = Buffer.alloc(32, sequence + 1).toString('base64url');
  const csrf = Buffer.alloc(32, sequence + 101).toString('base64url');
  const result = await db().persistence.accounts.completeGoogleLogin({
    googleSub,
    verifiedGoogleEmail: `${googleSub}@example.test`,
    sessionTokenHash: sha256(token),
    csrfTokenHash: sha256(csrf),
    createdAt: now(),
    lastActivityAt: now(),
    idleExpiresAt: new Date(currentTime + SESSION_IDLE_LIFETIME_MS),
    absoluteExpiresAt: new Date(currentTime + SESSION_ABSOLUTE_LIFETIME_MS),
    at: now(),
  });
  if (result.status !== 'completed') throw new Error('TEST_ACCOUNT_LOGIN_FAILED');
  return {
    googleSub,
    userId: result.user.id,
    sessionId: result.session.id,
    token,
    csrf,
    sessionTokenHash: sha256(token),
    csrfTokenHash: sha256(csrf),
  };
}

async function createAccount(prefix: string): Promise<AccountFixture> {
  return completeLogin(nextSubject(prefix));
}

async function proofFor(account: AccountFixture): Promise<SessionAuthorizationProof> {
  const authorization = createSessionAuthorization({
    persistence: db().persistence,
    getAppOrigin: () => APP_ORIGIN,
    clock: now,
  });
  const result = await authorization.authorizeWrite(
    new Request(`${APP_ORIGIN}/api/dashboard/adoption`, {
      method: 'POST',
      headers: {
        origin: APP_ORIGIN,
        cookie: `__Host-kendomenu-session=${account.token}; __Host-kendomenu-csrf=${account.csrf}`,
        'x-csrf-token': account.csrf,
      },
    }),
  );
  if (result.status !== 'authorized') throw new Error('TEST_AUTHORIZATION_FAILED');
  return result.proof;
}

function dashboardEnvelope(
  accountId: string,
  requestId: string,
  expectedRevision: string,
  catalogueVersion = CATALOGUE.version,
): Record<string, unknown> {
  return {
    transportVersion: 1,
    expectedAccountWorkspaceId: accountId,
    expectedRevision,
    requestId,
    catalogueVersion,
    dashboard: { version: 10, state: { dashboardEntries: [] } },
  };
}

function yesEnvelope(
  accountId: string,
  requestId: string,
  catalogueVersion = CATALOGUE.version,
): Record<string, unknown> {
  return {
    decision: 'yes',
    ...dashboardEnvelope(accountId, requestId, '0', catalogueVersion),
  };
}

function noEnvelope(accountId: string, requestId: string): Record<string, unknown> {
  return {
    decision: 'no',
    transportVersion: 1,
    expectedAccountWorkspaceId: accountId,
    requestId,
  };
}

function yesIntent(
  accountId: string,
  requestId: string,
  version = CATALOGUE.version,
): ValidatedDashboardWrite {
  const validation = validateAdoptionRequest(
    yesEnvelope(accountId, requestId, version),
    workspaceId(accountId),
  );
  if (validation.status !== 'valid' || validation.intent.dashboardIntent === undefined) {
    throw new Error('TEST_YES_INTENT_INVALID');
  }
  return validation.intent.dashboardIntent;
}

function noIntent(accountId: string, requestId: string) {
  const validation = validateAdoptionRequest(
    noEnvelope(accountId, requestId),
    workspaceId(accountId),
  );
  if (validation.status !== 'valid') throw new Error('TEST_NO_INTENT_INVALID');
  return validation.intent;
}

function ordinaryIntent(
  accountId: string,
  requestId: string,
  expectedRevision: string,
): ValidatedDashboardWrite {
  const validation = validateDashboardWrite(
    dashboardEnvelope(accountId, requestId, expectedRevision),
    workspaceId(accountId),
  );
  if (validation.status !== 'valid') throw new Error('TEST_DASHBOARD_INTENT_INVALID');
  return validation.intent;
}

function sessionAuthentication() {
  return createAuthentication({
    persistence: db().persistence,
    getGoogleConfiguration: () => GOOGLE_CONFIGURATION,
    getAppOrigin: () => APP_ORIGIN,
    google: {
      createAuthorizationUrl: () => 'https://accounts.google.test/authorize',
      exchangeCode: () =>
        Promise.resolve({
          googleSub: 'unused-google-subject',
          verifiedGoogleEmail: null,
        }),
    },
    clock: now,
  });
}

async function getSessionStatus(account: AccountFixture): Promise<unknown> {
  const response = await sessionAuthentication().getSession(
    new Request(`${APP_ORIGIN}/api/session`, {
      headers: { cookie: `__Host-kendomenu-session=${account.token}` },
    }),
  );
  expect(response.status).toBe(200);
  return response.json();
}

async function withAmbiguousCommit<T>(operation: () => Promise<T>): Promise<{
  readonly result: T;
  readonly commitCalls: number;
  readonly rollbackAfterCommit: boolean;
}> {
  const originalQuery: unknown = Object.getOwnPropertyDescriptor(Client.prototype, 'query')?.value;
  if (typeof originalQuery !== 'function') throw new Error('TEST_QUERY_METHOD_MISSING');
  let commitCalls = 0;
  let committed = false;
  let rollbackAfterCommit = false;
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
          throw new Error('ADOPTION_AMBIGUOUS_COMMIT');
        });
      }
      throw new Error('ADOPTION_AMBIGUOUS_COMMIT');
    }
    if (statement === 'ROLLBACK' && committed) rollbackAfterCommit = true;
    const result: unknown = Reflect.apply(originalQuery, this, args);
    return result;
  });
  try {
    const result = await operation();
    return { result, commitCalls, rollbackAfterCommit };
  } finally {
    query.mockRestore();
  }
}

beforeEach(async () => {
  currentTime = BASE_TIME;
  sequence = 0;
  database = await createTestDatabase({ clock: now });
});

afterEach(async () => {
  const current = database;
  database = undefined;
  if (current !== undefined) await current.close();
});

describe('PostgreSQL adoption terminal recovery', () => {
  it.each(TERMINAL_CASES)(
    'recovers a lost $label commit through a later authenticated session',
    async ({ decision, requestId, oppositeRequestId }) => {
      const account = await createAccount(`recovery-${decision}`);
      const proof = await proofFor(account);
      if (decision === 'yes') {
        const originalIntent = yesIntent(account.userId, requestId);
        const ambiguous = await withAmbiguousCommit(() =>
          db().persistence.adoptions.decide(
            {
              ...proof,
              decision: 'yes',
              expectedAccountWorkspaceId: account.userId,
              csrfTokenHash: account.csrfTokenHash,
              intent: originalIntent,
            },
            (value) => CATALOGUE.isCompatible(value),
          ),
        );
        expect(ambiguous.result).toEqual({ status: 'unavailable' });
        expect(ambiguous.commitCalls).toBe(1);
        expect(ambiguous.rollbackAfterCommit).toBe(false);

        const laterLogin = await completeLogin(account.googleSub);
        expect(await getSessionStatus(laterLogin)).toEqual({
          userId: account.userId,
          verifiedGoogleEmail: `${account.googleSub}@example.test`,
          adoption: {
            status: 'accepted',
            capability: false,
            completion: {
              decision: 'yes',
              requestId,
              acknowledgedRevision: '1',
              timestamp: now().toISOString(),
            },
          },
        });
        const replay = await db().persistence.adoptions.decide(
          {
            ...proof,
            decision: 'yes',
            expectedAccountWorkspaceId: account.userId,
            csrfTokenHash: account.csrfTokenHash,
            intent: originalIntent,
          },
          (value) => CATALOGUE.isCompatible(value),
        );
        expect(replay.status).toBe('replayed');

        const altered = await db().persistence.adoptions.decide(
          {
            ...proof,
            decision: 'yes',
            expectedAccountWorkspaceId: account.userId,
            csrfTokenHash: account.csrfTokenHash,
            intent: yesIntent(account.userId, requestId, catalogueVersion('f'.repeat(64))),
          },
          (value) => CATALOGUE.isCompatible(value),
        );
        expect(altered).toEqual({ status: 'request-id-reused' });

        const opposite = noIntent(account.userId, oppositeRequestId);
        await expect(
          db().persistence.adoptions.decide({
            ...proof,
            decision: 'no',
            expectedAccountWorkspaceId: account.userId,
            csrfTokenHash: account.csrfTokenHash,
            requestId: oppositeRequestId,
            requestDigest: opposite.requestDigest,
          }),
        ).resolves.toEqual({ status: 'decision-conflict' });
        return;
      }

      const originalNo = noIntent(account.userId, requestId);
      const ambiguous = await withAmbiguousCommit(() =>
        db().persistence.adoptions.decide({
          ...proof,
          decision: 'no',
          expectedAccountWorkspaceId: account.userId,
          csrfTokenHash: account.csrfTokenHash,
          requestId,
          requestDigest: originalNo.requestDigest,
        }),
      );
      expect(ambiguous.result).toEqual({ status: 'unavailable' });
      expect(ambiguous.commitCalls).toBe(1);
      expect(ambiguous.rollbackAfterCommit).toBe(false);

      const laterLogin = await completeLogin(account.googleSub);
      expect(await getSessionStatus(laterLogin)).toEqual({
        userId: account.userId,
        verifiedGoogleEmail: `${account.googleSub}@example.test`,
        adoption: {
          status: 'declined',
          capability: false,
          completion: { decision: 'no', requestId },
        },
      });
      const replay = await db().persistence.adoptions.decide({
        ...proof,
        decision: 'no',
        expectedAccountWorkspaceId: account.userId,
        csrfTokenHash: account.csrfTokenHash,
        requestId,
        requestDigest: originalNo.requestDigest,
      });
      expect(replay).toEqual({
        status: 'replayed-declined',
        completion: { decision: 'no', requestId },
      });

      const altered = await db().persistence.adoptions.decide({
        ...proof,
        decision: 'no',
        expectedAccountWorkspaceId: account.userId,
        csrfTokenHash: account.csrfTokenHash,
        requestId,
        requestDigest: 'f'.repeat(64),
      });
      expect(altered).toEqual({ status: 'request-id-reused' });

      const opposite = yesIntent(account.userId, oppositeRequestId);
      await expect(
        db().persistence.adoptions.decide(
          {
            ...proof,
            decision: 'yes',
            expectedAccountWorkspaceId: account.userId,
            csrfTokenHash: account.csrfTokenHash,
            intent: opposite,
          },
          (value) => CATALOGUE.isCompatible(value),
        ),
      ).resolves.toEqual({ status: 'decision-conflict' });
    },
  );

  it('keeps accepted adoption completion when ordinary receipt cleanup ages out its dashboard receipt', async () => {
    const account = await createAccount('receipt-cleanup');
    const proof = await proofFor(account);
    const requestId = '55555555-5555-4555-8555-555555555555';
    const intent = yesIntent(account.userId, requestId);
    await expect(
      db().persistence.adoptions.decide(
        {
          ...proof,
          decision: 'yes',
          expectedAccountWorkspaceId: account.userId,
          csrfTokenHash: account.csrfTokenHash,
          intent,
        },
        (value) => CATALOGUE.isCompatible(value),
      ),
    ).resolves.toMatchObject({ status: 'accepted' });
    await expect(
      db().client.query('SELECT request_id FROM dashboard_write_receipts WHERE user_id = $1', [
        account.userId,
      ]),
    ).resolves.toMatchObject({ rows: [{ request_id: requestId }] });

    currentTime = BASE_TIME + 8 * DAY_MS;
    const laterLogin = await completeLogin(account.googleSub);
    const laterProof = await proofFor(laterLogin);
    const ordinaryRequestId = '66666666-6666-4666-8666-666666666666';
    await expect(
      db().persistence.dashboards.compareAndWrite(
        laterProof,
        ordinaryIntent(account.userId, ordinaryRequestId, '1'),
        (value) => CATALOGUE.isCompatible(value),
      ),
    ).resolves.toMatchObject({ status: 'written' });

    await expect(
      db().client.query(
        'SELECT request_id FROM dashboard_write_receipts WHERE user_id = $1 ORDER BY request_id',
        [account.userId],
      ),
    ).resolves.toMatchObject({ rows: [{ request_id: ordinaryRequestId }] });
    await expect(
      db().client.query(
        'SELECT state, request_id, acknowledged_revision FROM account_adoptions WHERE user_id = $1',
        [account.userId],
      ),
    ).resolves.toMatchObject({
      rows: [{ state: 'accepted', request_id: requestId, acknowledged_revision: '1' }],
    });
    expect(await getSessionStatus(laterLogin)).toMatchObject({
      userId: account.userId,
      adoption: {
        status: 'accepted',
        capability: false,
        completion: {
          decision: 'yes',
          requestId,
          acknowledgedRevision: '1',
        },
      },
    });
  });
});
