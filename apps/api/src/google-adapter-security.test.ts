import { LoginTicket, OAuth2Client, type TokenPayload } from 'google-auth-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGoogleAuthenticationAdapter, type GoogleOAuthClient } from './auth/google.js';
import { GOOGLE_CLOCK_SKEW_SECONDS, type GoogleConfiguration } from './auth/contracts.js';
import { pkceChallenge, sha256 } from './auth/security.js';

const CONFIG: GoogleConfiguration = {
  clientId: 'security-test-client-id',
  clientSecret: 'security-test-client-secret',
  redirectUri: 'https://app.example.test/api/auth/google/callback',
};
const NOW = new Date('2026-09-11T12:00:00.000Z');
const NOW_SECONDS = NOW.getTime() / 1_000;
const NONCE = 'security-test-nonce';
const NONCE_HASH = sha256(NONCE);
const CODE = 'security-test-authorization-code';
const VERIFIER = 'v'.repeat(43);

afterEach(() => vi.restoreAllMocks());

function makePayload(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return {
    iss: 'https://accounts.google.com',
    aud: CONFIG.clientId,
    sub: 'GoogleSubjectCaseSensitive',
    iat: NOW_SECONDS - 10,
    exp: NOW_SECONDS + 3_600,
    nonce: NONCE,
    ...overrides,
  };
}

function makeClient(payload: TokenPayload): GoogleOAuthClient {
  return {
    generateAuthUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth',
    getToken: () => Promise.resolve({ tokens: { id_token: 'controlled-id-token' } }),
    verifyIdToken: () => Promise.resolve(new LoginTicket(undefined, payload)),
  };
}

async function exchangePayload(
  payload: TokenPayload,
  now: Date = NOW,
): Promise<{ readonly googleSub: string; readonly verifiedGoogleEmail: string | null }> {
  const client = makeClient(payload);
  const adapter = createGoogleAuthenticationAdapter({
    clientFactory: () => client,
    clock: () => now,
  });
  return adapter.exchangeCode({
    config: CONFIG,
    code: CODE,
    codeVerifier: VERIFIER,
    nonceHash: NONCE_HASH,
    now,
  });
}

describe('production Google adapter security boundaries', () => {
  it('constructs the real OAuth2Client without auth request interceptors or logging', () => {
    let interceptorCounts: { readonly request: number; readonly response: number } | undefined;
    const generateAuthUrl = vi
      .spyOn(OAuth2Client.prototype, 'generateAuthUrl')
      .mockImplementation(function (this: OAuth2Client, options) {
        interceptorCounts = {
          request: this.transporter.interceptors.request.size,
          response: this.transporter.interceptors.response.size,
        };
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        for (const [name, value] of Object.entries(options ?? {})) {
          if (Array.isArray(value)) {
            url.searchParams.set(name, value.join(' '));
          } else if (typeof value === 'string') {
            url.searchParams.set(name, value);
          }
        }
        return url.toString();
      });
    const logs = [
      vi.spyOn(console, 'debug').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
    ];

    const location = createGoogleAuthenticationAdapter().createAuthorizationUrl({
      config: CONFIG,
      state: 's'.repeat(43),
      nonce: 'n'.repeat(43),
      codeChallenge: pkceChallenge(VERIFIER),
    });

    expect(generateAuthUrl).toHaveBeenCalledTimes(1);
    expect(interceptorCounts).toEqual({ request: 0, response: 0 });
    expect(new URL(location).origin).toBe('https://accounts.google.com');
    expect(logs.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it('uses the real OAuth2Client verification method with the configured audience without network access', async () => {
    const getTokenDescriptor = Object.getOwnPropertyDescriptor(OAuth2Client.prototype, 'getToken');
    const verifyIdTokenDescriptor = Object.getOwnPropertyDescriptor(
      OAuth2Client.prototype,
      'verifyIdToken',
    );
    if (getTokenDescriptor === undefined || verifyIdTokenDescriptor === undefined) {
      throw new Error('GOOGLE_OAUTH_METHOD_MISSING');
    }

    const getTokenCalls: unknown[] = [];
    const verifyIdTokenCalls: unknown[] = [];
    Object.defineProperty(OAuth2Client.prototype, 'getToken', {
      configurable: true,
      writable: true,
      value: (options: unknown) => {
        getTokenCalls.push(options);
        return Promise.resolve({ tokens: { id_token: 'real-factory-id-token' } });
      },
    });
    Object.defineProperty(OAuth2Client.prototype, 'verifyIdToken', {
      configurable: true,
      writable: true,
      value: (options: unknown) => {
        verifyIdTokenCalls.push(options);
        return Promise.resolve(
          new LoginTicket(
            undefined,
            makePayload({ email_verified: true, email: 'verified@example.test' }),
          ),
        );
      },
    });

    try {
      const identity = await createGoogleAuthenticationAdapter({ clock: () => NOW }).exchangeCode({
        config: CONFIG,
        code: CODE,
        codeVerifier: VERIFIER,
        nonceHash: NONCE_HASH,
        now: NOW,
      });

      expect(getTokenCalls).toEqual([
        {
          client_id: CONFIG.clientId,
          code: CODE,
          codeVerifier: VERIFIER,
          redirect_uri: CONFIG.redirectUri,
        },
      ]);
      expect(verifyIdTokenCalls).toEqual([
        {
          idToken: 'real-factory-id-token',
          audience: CONFIG.clientId,
        },
      ]);
      expect(identity).toEqual({
        googleSub: 'GoogleSubjectCaseSensitive',
        verifiedGoogleEmail: 'verified@example.test',
      });
    } finally {
      Object.defineProperty(OAuth2Client.prototype, 'getToken', getTokenDescriptor);
      Object.defineProperty(OAuth2Client.prototype, 'verifyIdToken', verifyIdTokenDescriptor);
    }
  });

  it('accepts exactly 299 and 300 seconds of future iat skew, and rejects 301 seconds', async () => {
    const futureExp = NOW_SECONDS + 3_600;
    await expect(
      exchangePayload(
        makePayload({ iat: NOW_SECONDS + GOOGLE_CLOCK_SKEW_SECONDS - 1, exp: futureExp }),
      ),
    ).resolves.toBeDefined();
    await expect(
      exchangePayload(
        makePayload({ iat: NOW_SECONDS + GOOGLE_CLOCK_SKEW_SECONDS, exp: futureExp }),
      ),
    ).resolves.toBeDefined();
    await expect(
      exchangePayload(
        makePayload({ iat: NOW_SECONDS + GOOGLE_CLOCK_SKEW_SECONDS + 1, exp: futureExp }),
      ),
    ).rejects.toThrow('Authentication failed');
  });

  it('accepts just-before expiry and rejects at and after expiry', async () => {
    const expirationSeconds = NOW_SECONDS + 10;
    const payload = makePayload({ iat: NOW_SECONDS, exp: expirationSeconds });
    await expect(
      exchangePayload(payload, new Date(expirationSeconds * 1_000 - 1)),
    ).resolves.toBeDefined();
    await expect(exchangePayload(payload, new Date(expirationSeconds * 1_000))).rejects.toThrow(
      'Authentication failed',
    );
    await expect(exchangePayload(payload, new Date(expirationSeconds * 1_000 + 1))).rejects.toThrow(
      'Authentication failed',
    );
  });

  it('requires finite integer iat and exp with strict iat < exp ordering', async () => {
    const missingIat = makePayload();
    Object.defineProperty(missingIat, 'iat', { value: undefined });
    const missingExp = makePayload();
    Object.defineProperty(missingExp, 'exp', { value: undefined });
    const malformedClaims: TokenPayload[] = [
      missingIat,
      missingExp,
      makePayload({ iat: Number.NaN }),
      makePayload({ exp: Number.NaN }),
      makePayload({ iat: Number.POSITIVE_INFINITY }),
      makePayload({ exp: Number.POSITIVE_INFINITY }),
      makePayload({ iat: NOW_SECONDS + 0.5 }),
      makePayload({ exp: NOW_SECONDS + 3_600.5 }),
      makePayload({ iat: NOW_SECONDS + 100, exp: NOW_SECONDS + 100 }),
      makePayload({ iat: NOW_SECONDS + 101, exp: NOW_SECONDS + 100 }),
    ];

    for (const claims of malformedClaims) {
      await expect(exchangePayload(makePayload(claims))).rejects.toThrow('Authentication failed');
    }
  });

  it('accepts case-sensitive ASCII subjects up to 255 characters and rejects 256', async () => {
    await expect(exchangePayload(makePayload({ sub: 'A'.repeat(255) }))).resolves.toEqual({
      googleSub: 'A'.repeat(255),
      verifiedGoogleEmail: null,
    });
    await expect(exchangePayload(makePayload({ sub: 'a'.repeat(255) }))).resolves.toEqual({
      googleSub: 'a'.repeat(255),
      verifiedGoogleEmail: null,
    });
    await expect(exchangePayload(makePayload({ sub: 'A'.repeat(256) }))).rejects.toThrow(
      'Authentication failed',
    );
    const missingSubject = makePayload();
    Object.defineProperty(missingSubject, 'sub', { value: undefined });
    await expect(exchangePayload(missingSubject)).rejects.toThrow('Authentication failed');
  });

  it('requires a non-empty nonce claim matching the persisted nonce hash', async () => {
    const missingNonce = makePayload();
    Object.defineProperty(missingNonce, 'nonce', { value: undefined });
    await expect(exchangePayload(missingNonce)).rejects.toThrow('Authentication failed');
    await expect(exchangePayload(makePayload({ nonce: '' }))).rejects.toThrow(
      'Authentication failed',
    );
    await expect(exchangePayload(makePayload({ nonce: 'wrong-nonce' }))).rejects.toThrow(
      'Authentication failed',
    );
  });
});
