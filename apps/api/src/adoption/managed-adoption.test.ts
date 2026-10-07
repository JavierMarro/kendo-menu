import { describe, expect, it, vi } from 'vitest';

import { createAccountAuthorization } from '../auth/account-authorization.js';
import type { ManagedIdentity, ManagedIdentityResult } from '../auth/managed-identity.js';
import { MAX_DASHBOARD_REQUEST_BYTES } from '../dashboard/contracts.js';
import { createDashboardCatalogue } from '../dashboard/validation.js';
import type { ManagedCopyPersistence } from '../persistence/managed-copy-contracts.js';
import { createAdoption } from './adoption.js';

const origin = 'https://app.example.test';
const accountId = '11111111-1111-4111-8111-111111111111';
const opportunityId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const identity: ManagedIdentity = {
  provider: 'neon',
  issuer: 'https://auth.example.test',
  subject: 'managed-subject',
  verifiedEmail: null,
  expiresAt: 1_000,
};
const catalogue = createDashboardCatalogue();

function noEnvelope() {
  return {
    decision: 'no',
    transportVersion: 1,
    expectedAccountWorkspaceId: accountId,
    copyOpportunityId: opportunityId,
    requestId,
  };
}

function yesEnvelope() {
  return {
    ...noEnvelope(),
    decision: 'yes',
    expectedRevision: '0',
    catalogueVersion: catalogue.version,
    dashboard: { version: 10, state: { dashboardEntries: [] } },
  };
}

function harness(result: ManagedIdentityResult = { status: 'verified', identity }) {
  const verify = vi.fn(() => Promise.resolve(result));
  const authorization = createAccountAuthorization({
    verify,
    lookup: { findManagedAccount: () => Promise.resolve({ accountId }) },
    getAppOrigin: () => origin,
    now: () => 100,
  });
  const consumeOpportunity = vi.fn<ManagedCopyPersistence['consumeOpportunity']>(() =>
    Promise.resolve({ status: 'declined' }),
  );
  const persistence = vi.fn(() => ({ consumeOpportunity }));
  return {
    adoption: createAdoption({ authorization, persistence }),
    consumeOpportunity,
    persistence,
    verify,
  };
}

function request(body: unknown = noEnvelope(), headers: Readonly<Record<string, string>> = {}) {
  return new Request(`${origin}/api/dashboard/adoption`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer signed.jwt.token',
      origin,
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('managed guest-copy HTTP boundary', () => {
  it.each(['invalid', 'unavailable'] as const)(
    'does not acquire a body or persistence for %s identity',
    async (status) => {
      const h = harness({ status });
      const req = request();
      const bodyGetter = vi.fn(() => {
        throw new Error('UNAUTHORIZED_BODY_ACQUIRED');
      });
      Object.defineProperty(req, 'body', { get: bodyGetter });
      const response = await h.adoption.handle(req);
      expect(response.status).toBe(status === 'invalid' ? 401 : 503);
      expect(bodyGetter).not.toHaveBeenCalled();
      expect(h.persistence).not.toHaveBeenCalled();
    },
  );

  it('requires exact Origin without acquiring the body or consuming an opportunity', async () => {
    const h = harness();
    const req = request(noEnvelope(), { origin: 'https://attacker.example.test' });
    const bodyGetter = vi.fn(() => {
      throw new Error('FORBIDDEN_BODY_ACQUIRED');
    });
    Object.defineProperty(req, 'body', { get: bodyGetter });
    expect((await h.adoption.handle(req)).status).toBe(403);
    expect(bodyGetter).not.toHaveBeenCalled();
    expect(h.consumeOpportunity).not.toHaveBeenCalled();
  });

  it.each([
    [null, 400],
    [{ ...noEnvelope(), copyOpportunityId: 'invalid' }, 400],
    [{ ...noEnvelope(), copyOpportunityId: undefined }, 400],
    [{ ...noEnvelope(), extra: true }, 400],
    [{ ...noEnvelope(), decision: 'maybe' }, 400],
    [{ ...noEnvelope(), transportVersion: 2 }, 422],
    [{ ...noEnvelope(), expectedAccountWorkspaceId: opportunityId }, 403],
    [yesEnvelope(), 422],
    [{ ...yesEnvelope(), expectedRevision: '1' }, 422],
    [
      {
        ...yesEnvelope(),
        dashboard: { version: 10, state: { dashboardEntries: [{ invalid: true }] } },
      },
      422,
    ],
    [{ ...yesEnvelope(), dashboard: { version: 9, state: { dashboardEntries: [] } } }, 422],
  ])(
    'rejects invalid envelopes without reaching opportunity consumption: %j',
    async (body, status) => {
      const h = harness();
      expect((await h.adoption.handle(request(body))).status).toBe(status);
      expect(h.consumeOpportunity).not.toHaveBeenCalled();
    },
  );

  it('bounds actual complete-envelope bytes despite a smaller Content-Length', async () => {
    const h = harness();
    const req = new Request(`${origin}/api/dashboard/adoption`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer signed.jwt.token',
        origin,
        'content-type': 'application/json',
        'content-length': '1',
      },
      body: JSON.stringify(noEnvelope()) + ' '.repeat(MAX_DASHBOARD_REQUEST_BYTES),
    });
    expect((await h.adoption.handle(req)).status).toBe(413);
    expect(h.consumeOpportunity).not.toHaveBeenCalled();
  });

  it('rejects lexical duplicate properties without consuming', async () => {
    const h = harness();
    const req = new Request(`${origin}/api/dashboard/adoption`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer signed.jwt.token',
        origin,
        'content-type': 'application/json',
      },
      body: JSON.stringify(noEnvelope()).replace(
        '"decision":"no"',
        '"decision":"no","decision":"yes"',
      ),
    });
    expect((await h.adoption.handle(req)).status).toBe(400);
    expect(h.consumeOpportunity).not.toHaveBeenCalled();
  });

  it('passes a validated No and the server-derived account to persistence without cookies', async () => {
    const h = harness();
    const response = await h.adoption.handle(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(h.consumeOpportunity).toHaveBeenCalledOnce();
    const [proof, intent] = h.consumeOpportunity.mock.calls[0] ?? [];
    expect(proof).toMatchObject({ accountId, subject: identity.subject });
    expect(intent?.request).toEqual(noEnvelope());
    expect(await response.json()).toMatchObject({ status: 'declined' });
  });

  it('returns no copy success acknowledgement for consumed or failed outcomes', async () => {
    const h = harness();
    h.consumeOpportunity.mockResolvedValueOnce({ status: 'capability-unavailable' });
    expect((await h.adoption.handle(request())).status).toBe(409);
    h.consumeOpportunity.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_DIAGNOSTIC'));
    const unavailable = await h.adoption.handle(request());
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain('PRIVATE_DATABASE_DIAGNOSTIC');
  });

  it('rejects unsupported methods and query parameters before authorization', async () => {
    const h = harness();
    const unsupported = await h.adoption.handle(
      new Request(`${origin}/api/dashboard/adoption`, { method: 'HEAD' }),
    );
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get('allow')).toBe('POST');
    expect(await unsupported.text()).toBe('');
    expect(
      (
        await h.adoption.handle(
          new Request(`${origin}/api/dashboard/adoption?unexpected=1`, { method: 'POST' }),
        )
      ).status,
    ).toBe(400);
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.consumeOpportunity).not.toHaveBeenCalled();
  });
});
