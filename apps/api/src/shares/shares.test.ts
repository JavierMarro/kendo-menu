import { describe, expect, it, vi } from 'vitest';

import { createAccountAuthorization } from '../auth/account-authorization.js';
import type { ManagedIdentityResult } from '../auth/managed-identity.js';
import { isRevision } from '../dashboard/validation.js';
import type { Revision } from '../dashboard/contracts.js';
import type { ManagedSharesPersistence } from '../persistence/shares-contracts.js';
import { createShares } from './shares.js';

const origin = 'https://app.example.test';
const accountId = '11111111-1111-4111-8111-111111111111';
const otherAccountId = '22222222-2222-4222-8222-222222222222';
const token = 'A'.repeat(43);
const sourceRevision = '7';
if (!isRevision(sourceRevision)) throw new Error('BAD_FIXTURE');
const typedSourceRevision: Revision = sourceRevision;
const identity = {
  provider: 'neon' as const,
  issuer: 'https://auth.example.test',
  subject: 'managed-subject',
  verifiedEmail: null,
  expiresAt: Math.floor(Date.now() / 1_000) + 60,
};
const snapshot = {
  version: 1 as const,
  name: 'Shared practice',
  sections: [{ name: 'Warm up', exercises: [{ name: 'Suburi', quantities: { repetitions: 20 } }] }],
};

function fixture(
  result: ManagedIdentityResult = { status: 'verified', identity },
  initialized = true,
) {
  const authorization = createAccountAuthorization({
    verify: () => Promise.resolve(result),
    lookup: { findManagedAccount: () => Promise.resolve(initialized ? { accountId } : null) },
    getAppOrigin: () => origin,
  });
  const persistence = {
    create: vi.fn<ManagedSharesPersistence['create']>(() =>
      Promise.resolve({ status: 'created', token, sourceRevision: typedSourceRevision }),
    ),
    read: vi.fn<ManagedSharesPersistence['read']>(() =>
      Promise.resolve({ status: 'found', snapshot }),
    ),
    readForRecipient: vi.fn<ManagedSharesPersistence['readForRecipient']>(() =>
      Promise.resolve({ status: 'found', snapshot, isSender: false }),
    ),
  };
  return { shares: createShares({ authorization, persistence }), persistence };
}

function post(body: string, headers: Readonly<Record<string, string>> = {}) {
  return new Request(`${origin}/api/shares`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer signed.jwt.token',
      origin,
      'content-type': 'application/json',
      ...headers,
    },
    body,
  });
}

describe('custom-menu share HTTP boundary', () => {
  it('serves public snapshots without requiring or disclosing account identity', async () => {
    const { shares, persistence } = fixture({ status: 'invalid' });
    const response = await shares.handle(new Request(`${origin}/api/shares/${token}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ snapshot });
    expect(persistence.read).toHaveBeenCalledWith(token);
    expect(persistence.readForRecipient).not.toHaveBeenCalled();
  });

  it('requires verified account access for recipient imports', async () => {
    const { shares, persistence } = fixture({ status: 'invalid' });
    const response = await shares.handle(new Request(`${origin}/api/shares/${token}/recipient`));
    expect(response.status).toBe(401);
    expect(persistence.readForRecipient).not.toHaveBeenCalled();
  });

  it('authorizes before acquiring a share-create body', async () => {
    const { shares, persistence } = fixture({ status: 'invalid' });
    const request = post('{}');
    const body = vi.fn(() => {
      throw new Error('BODY_ACQUIRED_BEFORE_AUTHORIZATION');
    });
    Object.defineProperty(request, 'body', { get: body });
    expect((await shares.handle(request)).status).toBe(401);
    expect(body).not.toHaveBeenCalled();
    expect(persistence.create).not.toHaveBeenCalled();
  });

  it('binds create requests to the verified account and saved revision', async () => {
    const { shares, persistence } = fixture();
    const request = post(
      JSON.stringify({
        expectedAccountWorkspaceId: accountId,
        expectedRevision: '7',
        entryId: 'custom-entry',
      }),
    );
    const response = await shares.handle(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      token,
      sourceRevision: '7',
      accountWorkspaceId: accountId,
    });
    expect(persistence.create).toHaveBeenCalledWith(expect.anything(), '7', 'custom-entry');
  });

  it('rejects a body naming a different account before persistence', async () => {
    const { shares, persistence } = fixture();
    const response = await shares.handle(
      post(
        JSON.stringify({
          expectedAccountWorkspaceId: otherAccountId,
          expectedRevision: '7',
          entryId: 'custom-entry',
        }),
      ),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'ACCOUNT_WORKSPACE_MISMATCH' });
    expect(persistence.create).not.toHaveBeenCalled();
  });

  it('uses method names in Allow and keeps HEAD responses bodyless', async () => {
    const { shares } = fixture();
    const publicPath = await shares.handle(
      new Request(`${origin}/api/shares/${token}`, { method: 'POST' }),
    );
    expect(publicPath.status).toBe(405);
    expect(publicPath.headers.get('allow')).toBe('GET');

    const collectionPath = await shares.handle(
      new Request(`${origin}/api/shares`, { method: 'GET' }),
    );
    expect(collectionPath.status).toBe(405);
    expect(collectionPath.headers.get('allow')).toBe('POST');

    const head = await shares.handle(new Request(`${origin}/api/shares`, { method: 'HEAD' }));
    expect(head.status).toBe(405);
    expect(head.headers.get('allow')).toBe('POST');
    expect(await head.text()).toBe('');
  });
});
