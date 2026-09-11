import { describe, expect, it, vi } from 'vitest';

import { createAuthentication } from './auth/authentication.js';
import type { AuthenticationLogEntry } from './auth/contracts.js';
import { sha256 } from './auth/security.js';
import {
  PersistenceError,
  type ConsumeLoginTransactionInput,
  type ConsumeLoginTransactionResult,
  type KendoPersistence,
  type SessionLookupInput,
} from './persistence/contracts.js';

const ORIGIN = 'https://app.example.test';
const NOW = new Date('2026-09-11T00:00:00Z');
const TOKEN = Buffer.alloc(32, 1).toString('base64url');
const CSRF = Buffer.alloc(32, 2).toString('base64url');
const OTHER = Buffer.alloc(32, 3).toString('base64url');
const SESSION_COOKIE = `__Host-kendomenu-session=${TOKEN}`;
const LOGIN_COOKIE = `__Host-kendomenu-login=${TOKEN}`;
const CALLBACK = `${ORIGIN}/api/auth/google/callback`;
const userId = '00000000-0000-4000-8000-000000000001';
const session = {
  id: '00000000-0000-4000-8000-000000000002',
  userId,
  createdAt: NOW,
  lastActivityAt: NOW,
  idleExpiresAt: new Date(NOW.getTime() + 7 * 86_400_000),
  absoluteExpiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
  revokedAt: null,
};

function harness() {
  const logs: AuthenticationLogEntry[] = [];
  const consume = vi
    .fn<(input: ConsumeLoginTransactionInput) => Promise<ConsumeLoginTransactionResult>>()
    .mockResolvedValue({
      outcome: 'success',
      transaction: {
        pkceCodeVerifier: TOKEN,
        nonceHash: sha256(TOKEN),
        returnPath: '/',
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + 600_000),
      },
    });
  const lookup = vi.fn((input: SessionLookupInput) =>
    Promise.resolve(
      input.sessionTokenHash === sha256(TOKEN) &&
        (input.csrfTokenHash === undefined || input.csrfTokenHash === sha256(CSRF))
        ? session
        : null,
    ),
  );
  const revoke = vi.fn(() => Promise.resolve(true));
  const forbiddenOperation = () => Promise.reject(new Error('UNEXPECTED_PERSISTENCE_OPERATION'));
  const persistence: KendoPersistence = {
    users: {
      resolveByGoogleSubject: forbiddenOperation,
      findPublicById: () => Promise.resolve({ id: userId, verifiedGoogleEmail: null }),
    },
    loginTransactions: { create: forbiddenOperation, consume, cleanupExpired: forbiddenOperation },
    sessions: {
      create: forbiddenOperation,
      replace: forbiddenOperation,
      findActiveByTokenHash: lookup,
      revoke,
      touch: forbiddenOperation,
    },
  };
  const provider = vi.fn(() => persistence);
  const googleConfiguration = vi.fn(() => ({
    clientId: 'fixture-client',
    clientSecret: 'fixture-secret',
    redirectUri: CALLBACK,
    appOrigin: ORIGIN,
  }));
  const exchange = vi.fn(() => Promise.reject(new Error('PRIVATE_PROVIDER_PAYLOAD')));
  const authentication = createAuthentication({
    persistence: provider,
    getGoogleConfiguration: googleConfiguration,
    getAppOrigin: () => ORIGIN,
    google: {
      createAuthorizationUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth',
      exchangeCode: exchange,
    },
    clock: () => NOW,
    randomBytes: (size) => new Uint8Array(size).fill(9),
    logger: {
      log: (entry) => {
        logs.push(entry);
      },
    },
  });
  return { authentication, consume, lookup, revoke, provider, googleConfiguration, exchange, logs };
}

function logoutRequest(origin: string | null, csrf: string | null): Request {
  const headers = new Headers({ cookie: SESSION_COOKIE });
  if (origin !== null) headers.set('origin', origin);
  if (csrf !== null) headers.set('X-CSRF-Token', csrf);
  return new Request(`${ORIGIN}/api/session`, { method: 'DELETE', headers });
}

async function assertFixed(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ error: code });
}

describe('Request authentication rejection matrix', () => {
  it.each([
    `?state=${TOKEN}`,
    `?code=private-code`,
    `?state=${TOKEN}&code=`,
    `?state=${TOKEN}&code=private-code&code=other-code`,
    `?state=${TOKEN}&error=access_denied&error=other_error`,
    `?state=${TOKEN}&code=private-code&error=access_denied`,
    `?state=${TOKEN}&%73tate=${TOKEN}&code=private-code`,
    `?state=${TOKEN}&code=%GG`,
    `?state=${TOKEN}&code=%FF`,
  ])('rejects missing, duplicate, or malformed callback parameters: %s', async (query) => {
    const h = harness();
    const response = await h.authentication.callback(
      new Request(`${CALLBACK}${query}`, { headers: { cookie: LOGIN_COOKIE } }),
    );
    await assertFixed(response, 400, 'INVALID_AUTH_REQUEST');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.getSetCookie()[0]).toContain('__Host-kendomenu-login=;');
    expect(h.consume).not.toHaveBeenCalled();
    expect(h.exchange).not.toHaveBeenCalled();
  });

  it.each(['missing', 'expired', 'consumed', 'binding-mismatch'] as const)(
    'rejects %s login transactions before exchange',
    async (outcome) => {
      const h = harness();
      h.consume.mockResolvedValueOnce({ outcome });
      const response = await h.authentication.callback(
        new Request(`${CALLBACK}?state=${TOKEN}&code=private-code`, {
          headers: { cookie: LOGIN_COOKIE },
        }),
      );
      await assertFixed(response, 401, 'AUTHENTICATION_FAILED');
      expect(h.exchange).not.toHaveBeenCalled();
      expect(response.headers.getSetCookie()).toHaveLength(1);
    },
  );

  it('rejects a missing browser binding before transaction consumption', async () => {
    const h = harness();
    const response = await h.authentication.callback(
      new Request(`${CALLBACK}?state=${TOKEN}&code=private-code`),
    );
    expect(response.status).toBe(401);
    expect(h.consume).not.toHaveBeenCalled();
    expect(h.exchange).not.toHaveBeenCalled();
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('rejects malformed browser binding before resolving persistence', async () => {
    const h = harness();
    const response = await h.authentication.callback(
      new Request(`${CALLBACK}?state=${TOKEN}&code=private-code`, {
        headers: { cookie: '__Host-kendomenu-login=malformed' },
      }),
    );
    expect(response.status).toBe(400);
    expect(h.provider).not.toHaveBeenCalled();
    expect(h.consume).not.toHaveBeenCalled();
    expect(h.exchange).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toHaveLength(1);
  });

  it('sanitizes provider failures and logs only generated request IDs and fixed codes', async () => {
    const h = harness();
    const response = await h.authentication.callback(
      new Request(`${CALLBACK}?state=${TOKEN}&code=private-code`, {
        headers: { cookie: LOGIN_COOKIE },
      }),
    );
    await assertFixed(response, 401, 'AUTHENTICATION_FAILED');
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toEqual({
      requestId: Buffer.alloc(32, 9).toString('base64url'),
      code: 'AUTH_PROVIDER_REJECTED',
    });
    expect(h.consume).toHaveBeenCalledExactlyOnceWith({
      stateHash: sha256(TOKEN),
      browserBindingHash: sha256(TOKEN),
      at: NOW,
    });
  });

  it.each([
    null,
    '',
    'null',
    'http://app.example.test',
    `${ORIGIN}/`,
    `${ORIGIN}.evil.test`,
    `${ORIGIN}, https://evil.test`,
    'https://user@app.example.test',
    'x'.repeat(2_049),
  ])('rejects missing or deceptive Origin before persistence', async (origin) => {
    const h = harness();
    const response = await h.authentication.logout(logoutRequest(origin, CSRF));
    await assertFixed(response, 403, 'FORBIDDEN');
    expect(h.provider).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it.each([null, '', 'malformed', `${CSRF}=`, `${CSRF},${CSRF}`, 'x'.repeat(513)])(
    'rejects missing or malformed CSRF before persistence',
    async (csrf) => {
      const h = harness();
      const response = await h.authentication.logout(logoutRequest(ORIGIN, csrf));
      await assertFixed(response, 403, 'FORBIDDEN');
      expect(h.provider).not.toHaveBeenCalled();
      expect(response.headers.getSetCookie()).toEqual([]);
    },
  );

  it('requires matching session/CSRF hashes and preserves credentials on failed revocation', async () => {
    const h = harness();
    const wrongCsrf = await h.authentication.logout(logoutRequest(ORIGIN, OTHER));
    await assertFixed(wrongCsrf, 403, 'FORBIDDEN');
    expect(h.revoke).not.toHaveBeenCalled();
    h.revoke.mockRejectedValueOnce(new PersistenceError('FAILED'));
    const failure = await h.authentication.logout(logoutRequest(ORIGIN, CSRF));
    await assertFixed(failure, 503, 'AUTH_UNAVAILABLE');
    expect(failure.headers.getSetCookie()).toEqual([]);
    expect(h.lookup).toHaveBeenCalledWith({
      sessionTokenHash: sha256(TOKEN),
      csrfTokenHash: sha256(CSRF),
      at: NOW,
    });
  });

  it('keeps GET and logout independent of unavailable Google configuration', async () => {
    const h = harness();
    h.googleConfiguration.mockImplementation(() => {
      throw new Error('GOOGLE_UNAVAILABLE');
    });
    const response = await h.authentication.getSession(
      new Request(`${ORIGIN}/api/session`, { headers: { cookie: SESSION_COOKIE } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId, verifiedGoogleEmail: null });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect((await h.authentication.logout(logoutRequest(ORIGIN, CSRF))).status).toBe(204);
    expect(h.googleConfiguration).not.toHaveBeenCalled();
  });

  it('rejects a malformed supplied session before resolving persistence', async () => {
    const h = harness();
    const response = await h.authentication.getSession(
      new Request(`${ORIGIN}/api/session`, {
        headers: { cookie: '__Host-kendomenu-session=malformed' },
      }),
    );
    await assertFixed(response, 401, 'UNAUTHENTICATED');
    expect(h.provider).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });

  it('rejects seeded malformed session tokens before persistence', async () => {
    const seed = 0x4b454e44;
    let state = seed;
    const next = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-.+=';
    const h = harness();
    for (let iteration = 0; iteration < 256; iteration += 1) {
      const canonical = Buffer.alloc(32, next() % 256).toString('base64url');
      let value: string;
      if (iteration % 4 === 0) {
        value = `!${canonical.slice(1)}`;
      } else if (iteration % 4 === 1) {
        let length = (next() % 80) + 1;
        if (length === 43) length = 42;
        value = '';
        for (let index = 0; index < length; index += 1) {
          value += alphabet[next() % 64];
        }
      } else if (iteration % 4 === 2) {
        value = `${canonical}=`;
      } else {
        value = `${canonical.slice(0, -1)}B`;
      }
      const response = await h.authentication.getSession(
        new Request(`${ORIGIN}/api/session`, {
          headers: { cookie: `__Host-kendomenu-session=${value}` },
        }),
      );
      expect(response.status, `seed=${seed} iteration=${iteration}`).toBe(401);
      expect(response.headers.getSetCookie()).toHaveLength(2);
    }
    expect(h.provider).not.toHaveBeenCalled();
  });
});
