import { describe, expect, it, vi } from 'vitest';

import { createAccountAuthorization } from '../auth/account-authorization.js';
import type { ManagedIdentity, ManagedIdentityVerifier } from '../auth/managed-identity.js';
import type {
  AccountInitializationOutcome,
  ManagedAccountInitialization,
  ManagedAccountPersistence,
  ManagedAccountRecord,
} from '../persistence/managed-account-contracts.js';
import { createAccount } from './account.js';

const ORIGIN = 'https://app.example.test';
const TOKEN = 'header.payload.signature';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000002';
const IDENTITY: ManagedIdentity = {
  provider: 'neon',
  issuer: 'https://auth.example.test',
  subject: 'managed-subject-1',
  verifiedEmail: 'kendoka@example.test',
  expiresAt: 2_000_000_000,
};
const NOW = 1_900_000_000;
const ACCOUNT: ManagedAccountRecord = { accountId: ACCOUNT_ID, email: IDENTITY.verifiedEmail };

function makeRequest(
  method = 'GET',
  path = '/api/account',
  options: { readonly body?: string; readonly origin?: string } = {},
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    },
    ...(options.body === undefined ? {} : { body: options.body }),
  });
}

function harness(initialization: AccountInitializationOutcome) {
  const verify = vi.fn<ManagedIdentityVerifier>(() =>
    Promise.resolve({ status: 'verified', identity: IDENTITY }),
  );
  const lookup = {
    findManagedAccount: vi.fn((_identity: ManagedIdentity) =>
      Promise.resolve({ accountId: ACCOUNT_ID }),
    ),
  };
  const authorization = createAccountAuthorization({
    verify,
    lookup,
    getAppOrigin: () => ORIGIN,
    now: () => NOW,
  });
  const initializeManagedAccount = vi.fn<ManagedAccountPersistence['initializeManagedAccount']>(
    (_identity) => Promise.resolve(initialization),
  );
  const readAccount = vi.fn<ManagedAccountPersistence['readAccount']>(() =>
    Promise.resolve(ACCOUNT),
  );
  const persistence: ManagedAccountPersistence = {
    findManagedAccount: lookup.findManagedAccount,
    initializeManagedAccount,
    readAccount,
  };
  return {
    account: createAccount({ authorization, persistence }),
    initializeManagedAccount,
    lookup,
    readAccount,
    verify,
  };
}

function initialized(account: ManagedAccountInitialization): AccountInitializationOutcome {
  return { status: 'initialized', account };
}

describe('managed account endpoint', () => {
  it('returns the one-time copy opportunity only in the newly created account response', async () => {
    const h = harness(
      initialized({
        ...ACCOUNT,
        created: true,
        copyOpportunityId: OPPORTUNITY_ID,
      }),
    );
    const response = await h.account.handle(
      makeRequest('POST', '/api/account', { origin: ORIGIN }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      accountId: ACCOUNT_ID,
      email: IDENTITY.verifiedEmail,
      created: true,
      copyOpportunityId: OPPORTUNITY_ID,
    });
    expect(h.verify).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(h.initializeManagedAccount).toHaveBeenCalledExactlyOnceWith(IDENTITY);
    expect(h.lookup.findManagedAccount).not.toHaveBeenCalled();
  });

  it('omits the copy opportunity when initialization finds an existing account', async () => {
    const h = harness(initialized({ ...ACCOUNT, created: false }));
    const response = await h.account.handle(
      makeRequest('POST', '/api/account', { origin: ORIGIN }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accountId: ACCOUNT_ID,
      email: IDENTITY.verifiedEmail,
      created: false,
    });
  });

  it('inspects the existing account without returning a copy opportunity', async () => {
    const h = harness(initialized({ ...ACCOUNT, created: false }));
    const response = await h.account.handle(makeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(ACCOUNT);
    expect(h.lookup.findManagedAccount).toHaveBeenCalledExactlyOnceWith(IDENTITY);
    expect(h.readAccount).toHaveBeenCalledTimes(1);
    expect(h.initializeManagedAccount).not.toHaveBeenCalled();
  });

  it('rejects a POST body before authorization or persistence', async () => {
    const h = harness(
      initialized({ ...ACCOUNT, created: true, copyOpportunityId: OPPORTUNITY_ID }),
    );
    const request = makeRequest('POST', '/api/account', { body: '{}', origin: ORIGIN });
    const response = await h.account.handle(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_ACCOUNT_REQUEST' });
    expect(request.bodyUsed).toBe(false);
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.initializeManagedAccount).not.toHaveBeenCalled();
  });

  it.each(['PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    'rejects unsupported method %s before authorization',
    async (method) => {
      const h = harness(
        initialized({ ...ACCOUNT, created: true, copyOpportunityId: OPPORTUNITY_ID }),
      );
      const request = makeRequest(method, '/api/account', { body: '{}' });
      const response = await h.account.handle(request);

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET, POST');
      expect(request.bodyUsed).toBe(false);
      expect(h.verify).not.toHaveBeenCalled();
      expect(h.lookup.findManagedAccount).not.toHaveBeenCalled();
    },
  );

  it.each(['GET', 'POST'])('rejects query selectors before authorization on %s', async (method) => {
    const h = harness(
      initialized({ ...ACCOUNT, created: true, copyOpportunityId: OPPORTUNITY_ID }),
    );
    const request = makeRequest(method, '/api/account?account=other', {
      ...(method === 'POST' ? { origin: ORIGIN } : {}),
    });
    const response = await h.account.handle(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_ACCOUNT_REQUEST' });
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.lookup.findManagedAccount).not.toHaveBeenCalled();
    expect(h.initializeManagedAccount).not.toHaveBeenCalled();
    expect(h.readAccount).not.toHaveBeenCalled();
  });
});
