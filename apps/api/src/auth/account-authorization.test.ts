import { describe, expect, it, vi } from 'vitest';

import { createAccountAuthorization } from './account-authorization.js';
import type { ManagedIdentity, ManagedIdentityResult } from './managed-identity.js';

const origin = 'https://app.example.test';
const accountId = '11111111-1111-4111-8111-111111111111';
const identity: ManagedIdentity = {
  provider: 'neon',
  issuer: 'https://auth.example.test',
  subject: 'managed-subject-not-a-uuid',
  verifiedEmail: 'verified@example.test',
  expiresAt: 1_000,
};

function fixture(result: ManagedIdentityResult = { status: 'verified', identity }) {
  const verify = vi.fn(() => Promise.resolve(result));
  const findManagedAccount = vi.fn(() => Promise.resolve({ accountId }));
  const getAppOrigin = vi.fn(() => origin);
  const authorization = createAccountAuthorization({
    verify,
    lookup: { findManagedAccount },
    getAppOrigin,
    now: () => 100,
  });
  return { authorization, verify, findManagedAccount, getAppOrigin };
}

function request(headers: HeadersInit = { authorization: 'Bearer signed.jwt.token' }) {
  return new Request(`${origin}/api/dashboard`, { headers });
}

describe('managed account authorization', () => {
  it.each([
    {},
    { cookie: '__Host-kendomenu-session=legacy; kendomenu-csrf=legacy' },
    { authorization: 'Basic browser-id' },
    { authorization: 'Bearer one two' },
    { authorization: 'Bearer ' },
    { authorization: `Bearer ${'a'.repeat(16_385)}` },
  ])('rejects missing or malformed bearer credentials before lookup: %j', async (headers) => {
    const h = fixture();
    expect(await h.authorization.authorizeRead(request(headers))).toEqual({
      status: 'unauthenticated',
    });
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.findManagedAccount).not.toHaveBeenCalled();
  });

  it.each(['invalid', 'unavailable'] as const)(
    'fails closed for %s verification',
    async (status) => {
      const h = fixture({ status });
      expect(await h.authorization.authorizeRead(request())).toEqual({
        status: status === 'invalid' ? 'unauthenticated' : 'unavailable',
      });
      expect(h.findManagedAccount).not.toHaveBeenCalled();
    },
  );

  it('sanitizes verifier and persistence exceptions', async () => {
    const h = fixture();
    h.verify.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_DIAGNOSTIC'));
    expect(await h.authorization.authorizeRead(request())).toEqual({ status: 'unavailable' });
    h.findManagedAccount.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_DIAGNOSTIC'));
    expect(await h.authorization.authorizeRead(request())).toEqual({ status: 'unavailable' });
  });

  it('does not create a mapping for an initialized-account operation', async () => {
    const authorization = createAccountAuthorization({
      verify: () => Promise.resolve({ status: 'verified', identity }),
      lookup: { findManagedAccount: () => Promise.resolve(null) },
      getAppOrigin: () => origin,
      now: () => 100,
    });
    expect(await authorization.authorizeRead(request())).toEqual({ status: 'not-initialized' });
  });

  it('rechecks expiry after the asynchronous mapping lookup', async () => {
    let now = 100;
    const authorization = createAccountAuthorization({
      verify: () => Promise.resolve({ status: 'verified', identity }),
      lookup: {
        findManagedAccount: () =>
          Promise.resolve().then(() => {
            now = identity.expiresAt;
            return { accountId };
          }),
      },
      getAppOrigin: () => origin,
      now: () => now,
    });
    expect(await authorization.authorizeRead(request())).toEqual({ status: 'unauthenticated' });
  });

  it('rejects already-expired identity before mapping lookup', async () => {
    const h = fixture({ status: 'verified', identity: { ...identity, expiresAt: 100 } });
    expect(await h.authorization.authorizeRead(request())).toEqual({ status: 'unauthenticated' });
    expect(h.findManagedAccount).not.toHaveBeenCalled();
  });

  it('reports expiry as unauthorized when persistence detects it across the lookup wait', async () => {
    let now = 100;
    const authorization = createAccountAuthorization({
      verify: () => Promise.resolve({ status: 'verified', identity }),
      lookup: {
        findManagedAccount: () =>
          Promise.resolve().then(() => {
            now = identity.expiresAt;
            throw new Error('PERSISTENCE_DETECTED_EXPIRY');
          }),
      },
      getAppOrigin: () => origin,
      now: () => now,
    });
    expect(await authorization.authorizeRead(request())).toEqual({ status: 'unauthenticated' });
  });

  it.each([undefined, 'null', 'https://app.example.test.evil.test', 'http://app.example.test'])(
    'requires exact Origin for mutations: %s',
    async (value) => {
      const h = fixture();
      const headers = new Headers({ authorization: 'Bearer signed.jwt.token' });
      if (value !== undefined) headers.set('origin', value);
      expect(await h.authorization.authorizeWrite(request(headers))).toEqual({
        status: 'forbidden',
      });
      expect(h.findManagedAccount).not.toHaveBeenCalled();
    },
  );

  it('accepts bearer plus exact Origin without any application or CSRF cookie', async () => {
    const h = fixture();
    const result = await h.authorization.authorizeWrite(
      request({ authorization: 'Bearer signed.jwt.token', origin }),
    );
    expect(result.status).toBe('authorized');
    if (result.status !== 'authorized') throw new Error('TEST_AUTHORIZATION_FAILED');
    expect(result.proof).toMatchObject({ accountId, ...identity });
    expect(Object.isFrozen(result.proof)).toBe(true);
    expect(h.verify).toHaveBeenCalledWith('signed.jwt.token');
    expect(h.findManagedAccount).toHaveBeenCalledWith(identity);
  });

  it('reads require bearer identity but do not read mutation configuration', async () => {
    const h = fixture();
    expect((await h.authorization.authorizeRead(request())).status).toBe('authorized');
    expect(h.getAppOrigin).not.toHaveBeenCalled();
  });
});
