import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { createAccountAuthorization } from '../auth/account-authorization.js';
import type { ManagedIdentityResult } from '../auth/managed-identity.js';
import type { DashboardPersistence } from '../persistence/dashboard-contracts.js';
import { MAX_DASHBOARD_REQUEST_BYTES } from './contracts.js';
import { createDashboard } from './dashboard.js';
import { createDashboardCatalogue, validateDashboardAcknowledgement } from './validation.js';

const origin = 'https://app.example.test';
const accountId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const catalogue = createDashboardCatalogue();
const identity = {
  provider: 'neon' as const,
  issuer: 'https://auth.example.test',
  subject: 'managed-subject',
  verifiedEmail: null,
  expiresAt: 1_000,
};

function envelope() {
  return {
    transportVersion: 1,
    expectedAccountWorkspaceId: accountId,
    expectedRevision: '0',
    requestId,
    catalogueVersion: catalogue.version,
    dashboard: { version: 10, state: { dashboardEntries: [] } },
  };
}

function fixture(
  result: ManagedIdentityResult = { status: 'verified', identity },
  initialized = true,
) {
  const authorization = createAccountAuthorization({
    verify: () => Promise.resolve(result),
    lookup: { findManagedAccount: () => Promise.resolve(initialized ? { accountId } : null) },
    getAppOrigin: () => origin,
    now: () => 100,
  });
  const read = vi.fn<DashboardPersistence['read']>(() =>
    Promise.resolve({ status: 'unavailable' }),
  );
  const compareAndWrite = vi.fn<DashboardPersistence['compareAndWrite']>(() =>
    Promise.resolve({ status: 'unavailable' }),
  );
  const persistence = vi.fn(() => ({ read, compareAndWrite }));
  return {
    dashboard: createDashboard({ authorization, persistence, catalogue }),
    read,
    compareAndWrite,
    persistence,
  };
}

function request(
  body: string = JSON.stringify(envelope()),
  headers: Readonly<Record<string, string>> = {},
) {
  return new Request(`${origin}/api/dashboard`, {
    method: 'PUT',
    headers: {
      authorization: 'Bearer signed.jwt.token',
      origin,
      'content-type': 'application/json',
      ...headers,
    },
    body,
  });
}

describe('managed dashboard HTTP boundary', () => {
  it.each(['invalid', 'unavailable'] as const)(
    'rejects %s identity before body acquisition',
    async (status) => {
      const h = fixture({ status });
      const req = request();
      const getter = vi.fn(() => {
        throw new Error('BODY_ACQUIRED_BEFORE_AUTHORIZATION');
      });
      Object.defineProperty(req, 'body', { get: getter });
      expect((await h.dashboard.handle(req)).status).toBe(status === 'invalid' ? 401 : 503);
      expect(getter).not.toHaveBeenCalled();
      expect(h.persistence).not.toHaveBeenCalled();
    },
  );

  it('requires initialization before reading a body or persistence and rejects legacy cookies', async () => {
    const h = fixture({ status: 'verified', identity }, false);
    const req = request();
    const getter = vi.fn(() => {
      throw new Error('BODY_ACQUIRED_BEFORE_INITIALIZATION');
    });
    Object.defineProperty(req, 'body', { get: getter });
    const uninitialized = await h.dashboard.handle(req);
    expect(uninitialized.status).toBe(409);
    expect(await uninitialized.json()).toEqual({ error: 'ACCOUNT_NOT_INITIALIZED' });
    expect(getter).not.toHaveBeenCalled();
    const legacy = await h.dashboard.handle(
      new Request(`${origin}/api/dashboard`, {
        headers: { cookie: '__Host-kendomenu-session=legacy; kendomenu-csrf=legacy' },
      }),
    );
    expect(legacy.status).toBe(401);
    expect(h.persistence).not.toHaveBeenCalled();
  });

  it('enforces Origin before acquiring a mutation body', async () => {
    const h = fixture();
    const req = request(undefined, { origin: 'https://attacker.example.test' });
    const getter = vi.fn(() => {
      throw new Error('FORBIDDEN_BODY_ACQUIRED');
    });
    Object.defineProperty(req, 'body', { get: getter });
    expect((await h.dashboard.handle(req)).status).toBe(403);
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    ['{"transportVersion":1,"transportVersion":2}', 400],
    [JSON.stringify({ ...envelope(), expectedAccountWorkspaceId: requestId }), 403],
    [
      JSON.stringify({
        ...envelope(),
        dashboard: { version: 10, state: { dashboardEntries: [{ invalid: true }] } },
      }),
      422,
    ],
    [JSON.stringify(envelope()) + ' '.repeat(MAX_DASHBOARD_REQUEST_BYTES), 413],
  ])('rejects untrusted bodies before writing: case %#', async (body, status) => {
    const h = fixture();
    expect((await h.dashboard.handle(request(body))).status).toBe(status);
    expect(h.compareAndWrite).not.toHaveBeenCalled();
  });

  it('validates a committed acknowledgement and exposes no application cookies', async () => {
    const h = fixture();
    h.compareAndWrite.mockImplementation((_proof, intent) => {
      const acknowledgement = validateDashboardAcknowledgement(
        {
          transportVersion: 1,
          accountWorkspaceId: accountId,
          requestId,
          revision: '1',
          updatedAt: '2026-10-05T12:00:00.000Z',
        },
        intent,
      );
      if (acknowledgement === null) throw new Error('TEST_ACKNOWLEDGEMENT_INVALID');
      return Promise.resolve({ status: 'written', acknowledgement });
    });
    const response = await h.dashboard.handle(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(await response.json()).toMatchObject({
      accountWorkspaceId: accountId,
      revision: '1',
      requestId,
    });
  });

  it('registered Elysia route preserves authorization before parsing malformed JSON', async () => {
    const h = fixture({ status: 'invalid' });
    const unused = {
      handle: () => Promise.reject(new Error('UNRELATED_ROUTE_USED')),
    };
    const app = createApp({ dashboard: h.dashboard, account: unused, adoption: unused });
    const unauthorized = await app.handle(request('{malformed'));
    expect(unauthorized.status).toBe(401);
    expect(h.compareAndWrite).not.toHaveBeenCalled();
    for (const path of ['/api/auth/google/start', '/api/auth/google/callback', '/api/session']) {
      expect((await app.handle(new Request(`${origin}${path}`))).status).toBe(404);
    }
  });
});
