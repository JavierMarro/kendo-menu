/**
 * PostgreSQL adoption lifecycle checks. These tests exercise the same checked
 * out-client transactions used by the HTTP handlers and deliberately keep all
 * data in a harness-owned schema inside the local kendomenu_test database.
 */
import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSessionAuthorization } from '../auth/session-authorization.js';
import { SESSION_ABSOLUTE_LIFETIME_MS, SESSION_IDLE_LIFETIME_MS } from '../auth/contracts.js';
import type { SessionAuthorizationProof } from '../auth/session-authorization.js';
import {
  createDashboardCatalogue,
  isAccountWorkspaceId,
  validateDashboardWrite,
} from '../dashboard/validation.js';
import type { ValidatedDashboardWrite } from '../dashboard/validation.js';
import { createTestDatabase, type TestDatabase } from '../database/test-database.js';
import { validateAdoptionRequest } from '../adoption/contracts.js';

const ORIGIN = 'https://app.example.test';
const BASE_TIME = Date.parse('2026-09-19T12:00:00.000Z');
const CATALOGUE = createDashboardCatalogue();
const isCatalogueCompatible = (intent: ValidatedDashboardWrite): boolean =>
  CATALOGUE.isCompatible(intent);

let database: TestDatabase | undefined;
let currentTime = BASE_TIME;
let sequence = 0;

function now(): Date {
  return new Date(currentTime);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function nextName(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function workspaceId(value: string) {
  if (!isAccountWorkspaceId(value)) throw new Error('INVALID_WORKSPACE_ID');
  return value;
}

function db(): TestDatabase {
  if (database === undefined) throw new Error('TEST_DATABASE_NOT_INITIALIZED');
  return database;
}

interface AccountFixture {
  readonly userId: string;
  readonly sessionId: string;
  readonly token: string;
  readonly csrf: string;
  readonly sessionTokenHash: string;
  readonly csrfTokenHash: string;
}

async function createAccount(googleSub = nextName('adoption-subject')): Promise<AccountFixture> {
  const token = Buffer.alloc(32, sequence + 1).toString('base64url');
  const csrf = Buffer.alloc(32, sequence + 2).toString('base64url');
  const session = await db().persistence.accounts.completeGoogleLogin({
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
  if (session.status !== 'completed') throw new Error('ACCOUNT_CREATION_FAILED');
  return {
    userId: session.user.id,
    sessionId: session.session.id,
    token,
    csrf,
    sessionTokenHash: sha256(token),
    csrfTokenHash: sha256(csrf),
  };
}

async function proofFor(account: AccountFixture): Promise<SessionAuthorizationProof> {
  const authorization = createSessionAuthorization({
    persistence: db().persistence,
    getAppOrigin: () => ORIGIN,
    clock: now,
  });
  const result = await authorization.authorizeWrite(
    new Request(`${ORIGIN}/api/dashboard/adoption`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        cookie: `__Host-kendomenu-session=${account.token}; __Host-kendomenu-csrf=${account.csrf}`,
        'x-csrf-token': account.csrf,
      },
    }),
  );
  if (result.status !== 'authorized') throw new Error('AUTHORIZATION_FAILED');
  return result.proof;
}

function yesEnvelope(accountId: string, requestId: string): Record<string, unknown> {
  return {
    decision: 'yes',
    transportVersion: 1,
    expectedAccountWorkspaceId: accountId,
    expectedRevision: '0',
    requestId,
    catalogueVersion: CATALOGUE.version,
    dashboard: { version: 10, state: { dashboardEntries: [] } },
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

function validatedYes(accountId: string, requestId: string) {
  const validation = validateAdoptionRequest(
    yesEnvelope(accountId, requestId),
    workspaceId(accountId),
  );
  if (validation.status !== 'valid' || validation.intent.dashboardIntent === undefined) {
    throw new Error('YES_VALIDATION_FAILED');
  }
  return {
    requestId: validation.intent.request.requestId,
    dashboardIntent: validation.intent.dashboardIntent,
  } satisfies {
    readonly requestId: string;
    readonly dashboardIntent: ValidatedDashboardWrite;
  };
}

function validatedNo(accountId: string, requestId: string) {
  const validation = validateAdoptionRequest(
    noEnvelope(accountId, requestId),
    workspaceId(accountId),
  );
  if (validation.status !== 'valid') throw new Error('NO_VALIDATION_FAILED');
  return validation.intent;
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

describe('PostgreSQL adoption lifecycle', () => {
  it('issues one pending capability only for the first account login', async () => {
    const first = await createAccount('single-account-subject');
    const firstStatus = await db().persistence.adoptions.getStatus({
      userId: first.userId,
      sessionId: first.sessionId,
      sessionTokenHash: first.sessionTokenHash,
    });
    expect(firstStatus).toEqual({ status: 'pending', capability: true });

    const second = await db().persistence.accounts.completeGoogleLogin({
      googleSub: 'single-account-subject',
      sessionTokenHash: sha256('second-token'),
      csrfTokenHash: sha256('second-csrf'),
      createdAt: now(),
      lastActivityAt: now(),
      idleExpiresAt: new Date(currentTime + SESSION_IDLE_LIFETIME_MS),
      absoluteExpiresAt: new Date(currentTime + SESSION_ABSOLUTE_LIFETIME_MS),
      at: now(),
    });
    expect(second.status).toBe('completed');
    if (second.status !== 'completed') return;
    const returningStatus = await db().persistence.adoptions.getStatus({
      userId: first.userId,
      sessionId: second.session.id,
      sessionTokenHash: sha256('second-token'),
    });
    expect(returningStatus).toEqual({ status: 'pending', capability: false });
    const count = await db().client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM account_adoptions WHERE user_id = $1',
      [first.userId],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('serializes simultaneous first account logins into one account and one capability', async () => {
    const firstToken = 'concurrent-first-token';
    const firstCsrf = 'concurrent-first-csrf';
    const secondToken = 'concurrent-second-token';
    const secondCsrf = 'concurrent-second-csrf';
    const input = (token: string, csrf: string) => ({
      googleSub: 'concurrent-first-login-subject',
      verifiedGoogleEmail: 'concurrent@example.test',
      sessionTokenHash: sha256(token),
      csrfTokenHash: sha256(csrf),
      createdAt: now(),
      lastActivityAt: now(),
      idleExpiresAt: new Date(currentTime + SESSION_IDLE_LIFETIME_MS),
      absoluteExpiresAt: new Date(currentTime + SESSION_ABSOLUTE_LIFETIME_MS),
      at: now(),
    });
    const [first, second] = await Promise.all([
      db().persistence.accounts.completeGoogleLogin(input(firstToken, firstCsrf)),
      db().persistence.accounts.completeGoogleLogin(input(secondToken, secondCsrf)),
    ]);
    expect(first.status).toBe('completed');
    expect(second.status).toBe('completed');
    if (first.status !== 'completed' || second.status !== 'completed') return;
    expect(first.user.id).toBe(second.user.id);

    const users = await db().client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM users WHERE google_sub = $1',
      ['concurrent-first-login-subject'],
    );
    const sessions = await db().client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM application_sessions WHERE user_id = $1',
      [first.user.id],
    );
    const adoptions = await db().client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM account_adoptions WHERE user_id = $1',
      [first.user.id],
    );
    expect(users.rows[0]?.count).toBe('1');
    expect(sessions.rows[0]?.count).toBe('2');
    expect(adoptions.rows[0]?.count).toBe('1');

    const firstStatus = await db().persistence.adoptions.getStatus({
      userId: first.user.id,
      sessionId: first.session.id,
      sessionTokenHash: sha256(firstToken),
    });
    const secondStatus = await db().persistence.adoptions.getStatus({
      userId: second.user.id,
      sessionId: second.session.id,
      sessionTokenHash: sha256(secondToken),
    });
    expect([firstStatus.capability, secondStatus.capability].sort()).toEqual([false, true]);
  });

  it('accepts, replays, and recovers a terminal Yes receipt', async () => {
    const account = await createAccount();
    const proof = await proofFor(account);
    const intent = validatedYes(account.userId, '11111111-1111-4111-8111-111111111111');
    const accepted = await db().persistence.adoptions.decide(
      {
        ...proof,
        decision: 'yes',
        expectedAccountWorkspaceId: account.userId,
        csrfTokenHash: account.csrfTokenHash,
        intent: intent.dashboardIntent,
      },
      isCatalogueCompatible,
    );
    expect(accepted.status).toBe('accepted');
    if (accepted.status !== 'accepted') return;
    expect(accepted.acknowledgement.revision).toBe('1');
    const replay = await db().persistence.adoptions.decide(
      {
        ...proof,
        decision: 'yes',
        expectedAccountWorkspaceId: account.userId,
        csrfTokenHash: account.csrfTokenHash,
        intent: intent.dashboardIntent,
      },
      isCatalogueCompatible,
    );
    expect(replay.status).toBe('replayed');
    const status = await db().persistence.adoptions.getStatus({
      userId: account.userId,
      sessionId: account.sessionId,
      sessionTokenHash: account.sessionTokenHash,
    });
    expect(status).toMatchObject({ status: 'accepted', capability: false });
    expect(await db().client.query('SELECT revision FROM cloud_dashboards')).toMatchObject({
      rows: [{ revision: '1' }],
    });
  });

  it('declines once and recovers the declined terminal receipt', async () => {
    const account = await createAccount();
    const proof = await proofFor(account);
    const intent = validatedNo(account.userId, '22222222-2222-4222-8222-222222222222');
    const declined = await db().persistence.adoptions.decide({
      ...proof,
      decision: 'no',
      expectedAccountWorkspaceId: account.userId,
      csrfTokenHash: account.csrfTokenHash,
      requestId: intent.request.requestId,
      requestDigest: intent.requestDigest,
    });
    expect(declined).toEqual({
      status: 'declined',
      completion: { decision: 'no', requestId: intent.request.requestId },
    });
    const replay = await db().persistence.adoptions.decide({
      ...proof,
      decision: 'no',
      expectedAccountWorkspaceId: account.userId,
      csrfTokenHash: account.csrfTokenHash,
      requestId: intent.request.requestId,
      requestDigest: intent.requestDigest,
    });
    expect(replay).toEqual({
      status: 'replayed-declined',
      completion: { decision: 'no', requestId: intent.request.requestId },
    });
    expect(
      await db().client.query('SELECT count(*)::text AS count FROM cloud_dashboards'),
    ).toMatchObject({ rows: [{ count: '0' }] });
  });

  it('serializes a concurrent Yes and No decision into one terminal outcome', async () => {
    const account = await createAccount();
    const proof = await proofFor(account);
    const yes = validatedYes(account.userId, '77777777-7777-4777-8777-777777777777');
    const no = validatedNo(account.userId, '88888888-8888-4888-8888-888888888888');
    const [yesOutcome, noOutcome] = await Promise.all([
      db().persistence.adoptions.decide(
        {
          ...proof,
          decision: 'yes',
          expectedAccountWorkspaceId: account.userId,
          csrfTokenHash: account.csrfTokenHash,
          intent: yes.dashboardIntent,
        },
        isCatalogueCompatible,
      ),
      db().persistence.adoptions.decide({
        ...proof,
        decision: 'no',
        expectedAccountWorkspaceId: account.userId,
        csrfTokenHash: account.csrfTokenHash,
        requestId: no.request.requestId,
        requestDigest: no.requestDigest,
      }),
    ]);
    const outcomes = [yesOutcome, noOutcome];
    expect(outcomes.filter((outcome) => outcome.status === 'decision-conflict')).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === 'accepted' || outcome.status === 'declined'),
    ).toHaveLength(1);
    const dashboardCount = await db().client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM cloud_dashboards WHERE user_id = $1',
      [account.userId],
    );
    expect(dashboardCount.rows[0]?.count).toBe(yesOutcome.status === 'accepted' ? '1' : '0');
  });

  it('normalizes pending capability on revoke and replacement', async () => {
    const revoked = await createAccount();
    await expect(
      db().persistence.sessions.revoke({
        sessionId: revoked.sessionId,
        userId: revoked.userId,
        at: now(),
      }),
    ).resolves.toBe(true);
    await expect(
      db().client.query('SELECT state, creating_session_id FROM account_adoptions'),
    ).resolves.toMatchObject({ rows: [{ state: 'unavailable', creating_session_id: null }] });

    const replaced = await createAccount();
    const replacement = await db().persistence.sessions.replace({
      predecessorSessionId: replaced.sessionId,
      userId: replaced.userId,
      replacement: {
        userId: replaced.userId,
        sessionTokenHash: sha256('replacement-token'),
        csrfTokenHash: sha256('replacement-csrf'),
        createdAt: now(),
        lastActivityAt: now(),
        idleExpiresAt: new Date(currentTime + SESSION_IDLE_LIFETIME_MS),
        absoluteExpiresAt: new Date(currentTime + SESSION_ABSOLUTE_LIFETIME_MS),
      },
      at: now(),
    });
    expect(replacement.userId).toBe(replaced.userId);
    const state = await db().client.query<{ state: string; creating_session_id: string | null }>(
      'SELECT state, creating_session_id FROM account_adoptions WHERE user_id = $1',
      [replaced.userId],
    );
    expect(state.rows[0]).toEqual({ state: 'unavailable', creating_session_id: null });
  });

  it('normalizes pending capability when a callback replaces its predecessor session', async () => {
    const account = await createAccount('callback-replacement-subject');
    const replacementToken = 'callback-replacement-token';
    const replacementCsrf = 'callback-replacement-csrf';
    const replacement = await db().persistence.accounts.completeGoogleLogin({
      googleSub: 'callback-replacement-subject',
      verifiedGoogleEmail: 'callback-replacement-subject@example.test',
      sessionTokenHash: sha256(replacementToken),
      csrfTokenHash: sha256(replacementCsrf),
      createdAt: now(),
      lastActivityAt: now(),
      idleExpiresAt: new Date(currentTime + SESSION_IDLE_LIFETIME_MS),
      absoluteExpiresAt: new Date(currentTime + SESSION_ABSOLUTE_LIFETIME_MS),
      at: now(),
      predecessorSessionTokenHash: account.sessionTokenHash,
    });
    expect(replacement.status).toBe('completed');
    if (replacement.status !== 'completed') return;
    expect(replacement.user.id).toBe(account.userId);
    const state = await db().client.query<{ state: string; creating_session_id: string | null }>(
      'SELECT state, creating_session_id FROM account_adoptions WHERE user_id = $1',
      [account.userId],
    );
    expect(state.rows[0]).toEqual({ state: 'unavailable', creating_session_id: null });
    await expect(
      db().persistence.adoptions.getStatus({
        userId: account.userId,
        sessionId: replacement.session.id,
        sessionTokenHash: sha256(replacementToken),
      }),
    ).resolves.toEqual({ status: 'unavailable', capability: false });
  });

  it('normalizes pending capability on the first ordinary dashboard write', async () => {
    const account = await createAccount();
    const proof = await proofFor(account);
    const dashboardValidation = validateDashboardWrite(
      {
        transportVersion: 1,
        expectedAccountWorkspaceId: account.userId,
        expectedRevision: '0',
        requestId: '33333333-3333-4333-8333-333333333333',
        catalogueVersion: CATALOGUE.version,
        dashboard: { version: 10, state: { dashboardEntries: [] } },
      },
      workspaceId(account.userId),
    );
    if (dashboardValidation.status !== 'valid') throw new Error('DASHBOARD_VALIDATION_FAILED');
    const outcome = await db().persistence.dashboards.compareAndWrite(
      proof,
      dashboardValidation.intent,
      isCatalogueCompatible,
    );
    expect(outcome.status).toBe('written');
    await expect(
      db().client.query('SELECT state FROM account_adoptions WHERE user_id = $1', [account.userId]),
    ).resolves.toMatchObject({ rows: [{ state: 'unavailable' }] });
  });

  it('serializes an ordinary dashboard write against a concurrent Yes decision', async () => {
    const account = await createAccount();
    const proof = await proofFor(account);
    const adoption = validatedYes(account.userId, '99999999-9999-4999-8999-999999999999');
    const ordinaryValidation = validateDashboardWrite(
      {
        transportVersion: 1,
        expectedAccountWorkspaceId: account.userId,
        expectedRevision: '0',
        requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        catalogueVersion: CATALOGUE.version,
        dashboard: { version: 10, state: { dashboardEntries: [] } },
      },
      workspaceId(account.userId),
    );
    if (ordinaryValidation.status !== 'valid') throw new Error('DASHBOARD_VALIDATION_FAILED');

    const [adoptionOutcome, dashboardOutcome] = await Promise.all([
      db().persistence.adoptions.decide(
        {
          ...proof,
          decision: 'yes',
          expectedAccountWorkspaceId: account.userId,
          csrfTokenHash: account.csrfTokenHash,
          intent: adoption.dashboardIntent,
        },
        isCatalogueCompatible,
      ),
      db().persistence.dashboards.compareAndWrite(
        proof,
        ordinaryValidation.intent,
        isCatalogueCompatible,
      ),
    ]);

    const adoptionWon =
      adoptionOutcome.status === 'accepted' && dashboardOutcome.status === 'revision-conflict';
    const dashboardWon =
      adoptionOutcome.status === 'ineligible' && dashboardOutcome.status === 'written';
    expect(adoptionWon || dashboardWon).toBe(true);
    const dashboardCount = await db().client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM cloud_dashboards WHERE user_id = $1',
      [account.userId],
    );
    expect(dashboardCount.rows[0]?.count).toBe('1');
  });

  it('serializes simultaneous Yes decisions to one dashboard and one receipt', async () => {
    const account = await createAccount();
    const proof = await proofFor(account);
    const first = validatedYes(account.userId, '44444444-4444-4444-8444-444444444444');
    const second = validatedYes(account.userId, '55555555-5555-4555-8555-555555555555');
    const results = await Promise.all([
      db().persistence.adoptions.decide(
        {
          ...proof,
          decision: 'yes',
          expectedAccountWorkspaceId: account.userId,
          csrfTokenHash: account.csrfTokenHash,
          intent: first.dashboardIntent,
        },
        isCatalogueCompatible,
      ),
      db().persistence.adoptions.decide(
        {
          ...proof,
          decision: 'yes',
          expectedAccountWorkspaceId: account.userId,
          csrfTokenHash: account.csrfTokenHash,
          intent: second.dashboardIntent,
        },
        isCatalogueCompatible,
      ),
    ]);
    expect(results.filter((result) => result.status === 'accepted')).toHaveLength(1);
    expect(results.some((result) => result.status === 'decision-conflict')).toBe(true);
    expect(
      await db().client.query('SELECT count(*)::text AS count FROM cloud_dashboards'),
    ).toMatchObject({ rows: [{ count: '1' }] });
    expect(
      await db().client.query('SELECT count(*)::text AS count FROM dashboard_write_receipts'),
    ).toMatchObject({ rows: [{ count: '1' }] });
  });

  it('serializes adoption against concurrent revocation and session replacement', async () => {
    const revoked = await createAccount('adoption-revoke-race');
    const revokeProof = await proofFor(revoked);
    const revokeIntent = validatedYes(revoked.userId, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const [revokeResult, revokeDecision] = await Promise.all([
      db().persistence.sessions.revoke({
        sessionId: revoked.sessionId,
        userId: revoked.userId,
        at: now(),
      }),
      db().persistence.adoptions.decide(
        {
          ...revokeProof,
          decision: 'yes',
          expectedAccountWorkspaceId: revoked.userId,
          csrfTokenHash: revoked.csrfTokenHash,
          intent: revokeIntent.dashboardIntent,
        },
        isCatalogueCompatible,
      ),
    ]);
    expect(revokeResult).toBe(true);
    expect(['accepted', 'unauthenticated']).toContain(revokeDecision.status);
    const revokedState = await db().client.query<{ state: string }>(
      'SELECT state FROM account_adoptions WHERE user_id = $1',
      [revoked.userId],
    );
    expect(revokedState.rows[0]?.state).toBe(
      revokeDecision.status === 'accepted' ? 'accepted' : 'unavailable',
    );

    const replaced = await createAccount();
    const replaceProof = await proofFor(replaced);
    const replaceIntent = validatedYes(replaced.userId, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    const [replacementResult, replacementDecision] = await Promise.all([
      db().persistence.sessions.replace({
        predecessorSessionId: replaced.sessionId,
        userId: replaced.userId,
        replacement: {
          userId: replaced.userId,
          sessionTokenHash: sha256('adoption-replace-race-token'),
          csrfTokenHash: sha256('adoption-replace-race-csrf'),
          createdAt: now(),
          lastActivityAt: now(),
          idleExpiresAt: new Date(currentTime + SESSION_IDLE_LIFETIME_MS),
          absoluteExpiresAt: new Date(currentTime + SESSION_ABSOLUTE_LIFETIME_MS),
        },
        at: now(),
      }),
      db().persistence.adoptions.decide(
        {
          ...replaceProof,
          decision: 'yes',
          expectedAccountWorkspaceId: replaced.userId,
          csrfTokenHash: replaced.csrfTokenHash,
          intent: replaceIntent.dashboardIntent,
        },
        isCatalogueCompatible,
      ),
    ]);
    expect(replacementResult.userId).toBe(replaced.userId);
    expect(['accepted', 'unauthenticated']).toContain(replacementDecision.status);
    const replacedState = await db().client.query<{ state: string }>(
      'SELECT state FROM account_adoptions WHERE user_id = $1',
      [replaced.userId],
    );
    expect(replacedState.rows[0]?.state).toBe(
      replacementDecision.status === 'accepted' ? 'accepted' : 'unavailable',
    );
  });

  it('rolls back dashboard and adoption state when a terminal update fails', async () => {
    const account = await createAccount();
    const proof = await proofFor(account);
    await db().client.query(`
      CREATE FUNCTION fail_adoption_terminal_update() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.state = 'accepted' THEN RAISE EXCEPTION 'adoption rollback'; END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_adoption_terminal_update_trigger
      BEFORE UPDATE ON account_adoptions
      FOR EACH ROW EXECUTE FUNCTION fail_adoption_terminal_update();
    `);
    const intent = validatedYes(account.userId, '66666666-6666-4666-8666-666666666666');
    const outcome = await db().persistence.adoptions.decide(
      {
        ...proof,
        decision: 'yes',
        expectedAccountWorkspaceId: account.userId,
        csrfTokenHash: account.csrfTokenHash,
        intent: intent.dashboardIntent,
      },
      isCatalogueCompatible,
    );
    expect(outcome).toEqual({ status: 'unavailable' });
    expect(
      await db().client.query('SELECT count(*)::text AS count FROM cloud_dashboards'),
    ).toMatchObject({ rows: [{ count: '0' }] });
    expect(
      await db().client.query('SELECT state FROM account_adoptions WHERE user_id = $1', [
        account.userId,
      ]),
    ).toMatchObject({ rows: [{ state: 'pending' }] });
  });
});
