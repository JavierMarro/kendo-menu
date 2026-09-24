import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../database/test-database.js';
import { createSessionAuthorization } from '../auth/session-authorization.js';
import { sha256 } from '../auth/security.js';
import { validateAdoptionRequest } from '../adoption/contracts.js';
import {
  createDashboardCatalogue,
  isAccountWorkspaceId,
  validateDashboardWrite,
} from '../dashboard/validation.js';

const ORIGIN = 'https://app.example.test';
const START = Date.parse('2026-09-19T10:00:00Z');
const DEADLINE = START + 1_000;
const TOKEN = Buffer.alloc(32, 1).toString('base64url');
const CSRF = Buffer.alloc(32, 2).toString('base64url');
const catalogue = createDashboardCatalogue();
let currentTime = START;
let database: TestDatabase;

beforeEach(async () => {
  currentTime = START;
  database = await createTestDatabase({ clock: () => new Date(currentTime) });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await database?.close();
});

async function fixture() {
  const result = await database.persistence.accounts.completeGoogleLogin({
    googleSub: 'expiry-adoption-fixture',
    sessionTokenHash: sha256(TOKEN),
    csrfTokenHash: sha256(CSRF),
    createdAt: new Date(START),
    lastActivityAt: new Date(START),
    idleExpiresAt: new Date(DEADLINE),
    absoluteExpiresAt: new Date(DEADLINE),
    at: new Date(START),
  });
  if (result.status !== 'completed' || !isAccountWorkspaceId(result.user.id))
    throw new Error('TEST_ACCOUNT_FAILED');
  const authorization = createSessionAuthorization({
    persistence: database.persistence,
    getAppOrigin: () => ORIGIN,
    clock: () => new Date(currentTime),
  });
  const auth = await authorization.authorizeWrite(
    new Request(`${ORIGIN}/api/dashboard/adoption`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        cookie: `__Host-kendomenu-session=${TOKEN}; __Host-kendomenu-csrf=${CSRF}`,
        'x-csrf-token': CSRF,
      },
    }),
  );
  if (auth.status !== 'authorized') throw new Error('TEST_AUTHORIZATION_FAILED');
  const yes = validateAdoptionRequest(
    {
      decision: 'yes',
      transportVersion: 1,
      expectedAccountWorkspaceId: result.user.id,
      expectedRevision: '0',
      requestId: randomUUID(),
      catalogueVersion: catalogue.version,
      dashboard: { version: 10, state: { dashboardEntries: [] } },
    },
    result.user.id,
  );
  const no = validateAdoptionRequest(
    {
      decision: 'no',
      transportVersion: 1,
      expectedAccountWorkspaceId: result.user.id,
      requestId: randomUUID(),
    },
    result.user.id,
  );
  if (yes.status !== 'valid' || yes.intent.dashboardIntent === undefined || no.status !== 'valid')
    throw new Error('TEST_INTENT_FAILED');
  const yesInput = {
    ...auth.proof,
    csrfTokenHash: sha256(CSRF),
    decision: 'yes' as const,
    expectedAccountWorkspaceId: result.user.id,
    intent: yes.intent.dashboardIntent,
  };
  const noInput = {
    ...auth.proof,
    csrfTokenHash: sha256(CSRF),
    decision: 'no' as const,
    expectedAccountWorkspaceId: result.user.id,
    requestId: no.intent.request.requestId,
    requestDigest: no.intent.requestDigest,
  };
  return { proof: auth.proof, userId: result.user.id, yesInput, noInput };
}

/** Move time across expiry after a real database round trip, without wall-clock sleeps. */
function expireAfterQuery(matches: (sql: string) => boolean) {
  const original: unknown = Object.getOwnPropertyDescriptor(Client.prototype, 'query')?.value;
  if (typeof original !== 'function') throw new Error('TEST_QUERY_MISSING');
  let injected = false;
  const spy = vi.spyOn(Client.prototype, 'query');
  spy.mockImplementation(function (this: Client, ...args: unknown[]) {
    const first = args[0];
    const sql: unknown =
      typeof first === 'string'
        ? first
        : typeof first === 'object' && first !== null
          ? Object.getOwnPropertyDescriptor(first, 'text')?.value
          : undefined;
    if (!injected && typeof sql === 'string' && matches(sql.toLowerCase())) {
      injected = true;
      const callback = args.at(-1);
      if (typeof callback === 'function') {
        const wrapped = (...callbackArgs: unknown[]): unknown => {
          currentTime = DEADLINE;
          return Reflect.apply(callback, undefined, callbackArgs);
        };
        const result: unknown = Reflect.apply(original, this, [...args.slice(0, -1), wrapped]);
        return result;
      }
      const result: unknown = Reflect.apply(original, this, args);
      if (!(result instanceof Promise)) throw new Error('TEST_ASYNC_QUERY_REQUIRED');
      return result.then((value: unknown) => {
        currentTime = DEADLINE;
        return value;
      });
    }
    const result: unknown = Reflect.apply(original, this, args);
    return result;
  });
  return { restore: () => spy.mockRestore(), wasInjected: () => injected };
}

describe('adoption expiry across database work', () => {
  it('computes pending capability with a fresh clock after read round trips and never writes', async () => {
    const account = await fixture();
    const before = (
      await database.client.query('SELECT row_to_json(t) AS data FROM account_adoptions t')
    ).rows;
    const injection = expireAfterQuery(
      (sql) => sql.startsWith('select') && sql.includes('"cloud_dashboards"'),
    );
    const status = await database.persistence.adoptions.getStatus(account.proof);
    injection.restore();
    expect(injection.wasInjected()).toBe(true);
    expect(status).toEqual({ status: 'unavailable', capability: false });
    expect(
      (await database.client.query('SELECT row_to_json(t) AS data FROM account_adoptions t')).rows,
    ).toEqual(before);
  });

  it.each(['yes', 'no'] as const)(
    'revalidates expiry after the terminal receipt lock for %s replay',
    async (decision) => {
      const account = await fixture();
      const input = decision === 'yes' ? account.yesInput : account.noInput;
      const original = await database.persistence.adoptions.decide(input);
      expect(original.status).toBe(decision === 'yes' ? 'accepted' : 'declined');
      const injection = expireAfterQuery(
        (sql) =>
          sql.startsWith('select') &&
          sql.includes('"account_adoptions"') &&
          sql.includes('for update'),
      );
      const replay = await database.persistence.adoptions.decide(input);
      injection.restore();
      expect(injection.wasInjected()).toBe(true);
      expect(replay).toEqual({ status: 'unauthenticated' });
    },
  );

  it.each(['yes', 'no'] as const)(
    'rolls back %s when the session expires during the terminal write',
    async (decision) => {
      const account = await fixture();
      const injection = expireAfterQuery((sql) => sql.startsWith('update "account_adoptions"'));
      const outcome = await database.persistence.adoptions.decide(
        decision === 'yes' ? account.yesInput : account.noInput,
      );
      injection.restore();
      expect(injection.wasInjected()).toBe(true);
      expect(outcome).toEqual({ status: 'unauthenticated' });
      expect((await database.client.query('SELECT state FROM account_adoptions')).rows).toEqual([
        { state: 'pending' },
      ]);
      expect((await database.client.query('SELECT * FROM cloud_dashboards')).rows).toEqual([]);
      expect((await database.client.query('SELECT * FROM dashboard_write_receipts')).rows).toEqual(
        [],
      );
    },
  );

  it.each(['revision', 'catalogue'] as const)(
    'preserves eligible capability after an ordinary %s rejection',
    async (rejection) => {
      const account = await fixture();
      const intent = validateDashboardWrite(
        {
          ...account.yesInput.intent.request,
          expectedRevision: rejection === 'revision' ? '1' : '0',
          requestId: randomUUID(),
        },
        account.userId,
      );
      if (intent.status !== 'valid') throw new Error('TEST_WRITE_INVALID');
      const outcome = await database.persistence.dashboards.compareAndWrite(
        account.proof,
        intent.intent,
        () => rejection !== 'catalogue',
      );
      expect(outcome.status).toBe(
        rejection === 'revision' ? 'revision-conflict' : 'catalogue-incompatible',
      );
      expect(await database.persistence.adoptions.getStatus(account.proof)).toEqual({
        status: 'pending',
        capability: true,
      });
      expect((await database.client.query('SELECT * FROM cloud_dashboards')).rows).toEqual([]);
    },
  );
});
