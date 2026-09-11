import { LoginTicket, type TokenPayload } from 'google-auth-library';
import { describe, expect, it } from 'vitest';

import { createGoogleAuthenticationAdapter, type GoogleOAuthClient } from './google.js';
import type { GenerateAuthUrlOpts, GetTokenOptions } from 'google-auth-library';
import { GOOGLE_CLOCK_SKEW_SECONDS } from './contracts.js';
import { pkceChallenge, sha256 } from './security.js';

const CONFIG = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'https://app.example.test/api/auth/google/callback',
} as const;
const NOW = new Date('2026-09-10T12:00:00.000Z');
const NOW_SECONDS = NOW.getTime() / 1_000;

function makePayload(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return {
    iss: 'https://accounts.google.com',
    aud: CONFIG.clientId,
    sub: 'google-subject',
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 3_600,
    nonce: 'nonce-value',
    ...overrides,
  };
}

function authorizationUrl(options: GenerateAuthUrlOpts): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for (const [name, value] of Object.entries(options)) {
    if (Array.isArray(value)) {
      url.searchParams.set(name, value.join(' '));
    } else if (typeof value === 'string') {
      url.searchParams.set(name, value);
    }
  }
  return url.toString();
}

function makeClient(payload: TokenPayload): {
  readonly client: GoogleOAuthClient;
  readonly authorizationOptions: GenerateAuthUrlOpts[];
  readonly tokenOptions: GetTokenOptions[];
  readonly verificationOptions: Array<{ readonly idToken: string; readonly audience: string }>;
} {
  const authorizationOptions: GenerateAuthUrlOpts[] = [];
  const tokenOptions: GetTokenOptions[] = [];
  const verificationOptions: Array<{ readonly idToken: string; readonly audience: string }> = [];
  const client: GoogleOAuthClient = {
    generateAuthUrl: (options) => {
      authorizationOptions.push(options);
      return authorizationUrl(options);
    },
    getToken: async (options) => {
      await Promise.resolve();
      tokenOptions.push(options);
      return { tokens: { id_token: 'opaque-provider-id-token' } };
    },
    verifyIdToken: async (options) => {
      await Promise.resolve();
      verificationOptions.push(options);
      return new LoginTicket(undefined, payload);
    },
  };
  return { client, authorizationOptions, tokenOptions, verificationOptions };
}

describe('Google authentication adapter', () => {
  it('requests the exact online OIDC scopes and forwards the configured callback', () => {
    const fake = makeClient(makePayload());
    const adapter = createGoogleAuthenticationAdapter({
      clientFactory: () => fake.client,
    });
    const state = 'a'.repeat(43);
    const nonce = 'b'.repeat(43);
    const challenge = pkceChallenge('c'.repeat(43));
    const location = adapter.createAuthorizationUrl({
      config: CONFIG,
      state,
      nonce,
      codeChallenge: challenge,
    });

    expect(new URL(location).origin).toBe('https://accounts.google.com');
    expect(fake.authorizationOptions[0]).toMatchObject({
      access_type: 'online',
      client_id: CONFIG.clientId,
      redirect_uri: CONFIG.redirectUri,
      response_type: 'code',
      scope: ['openid', 'email'],
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    expect(new URL(location).searchParams.get('access_type')).toBe('online');
    expect(new URL(location).searchParams.get('scope')).toBe('openid email');
  });

  it.each([
    ['missing state', (url: URL): void => url.searchParams.delete('state')],
    ['changed state', (url: URL): void => url.searchParams.set('state', 'attacker-state')],
    ['missing nonce', (url: URL): void => url.searchParams.delete('nonce')],
    ['changed challenge', (url: URL): void => url.searchParams.set('code_challenge', 'changed')],
    ['changed client', (url: URL): void => url.searchParams.set('client_id', 'other-client')],
    [
      'changed redirect',
      (url: URL): void =>
        url.searchParams.set('redirect_uri', 'https://evil.example.test/callback'),
    ],
    ['offline access', (url: URL): void => url.searchParams.set('access_type', 'offline')],
    ['extra scope', (url: URL): void => url.searchParams.set('scope', 'openid email profile')],
    ['duplicate state', (url: URL): void => url.searchParams.append('state', 'duplicate')],
    [
      'wrong path',
      (url: URL): void => {
        url.pathname = '/o/oauth2/auth';
      },
    ],
  ] as const)(
    'rejects a provider client that returns an authorization URL with %s',
    (_description, mutate) => {
      const fake = makeClient(makePayload());
      fake.client.generateAuthUrl = (options) => {
        const url = new URL(authorizationUrl(options));
        mutate(url);
        return url.toString();
      };
      const adapter = createGoogleAuthenticationAdapter({ clientFactory: () => fake.client });
      expect(() =>
        adapter.createAuthorizationUrl({
          config: CONFIG,
          state: 'a'.repeat(43),
          nonce: 'b'.repeat(43),
          codeChallenge: pkceChallenge('c'.repeat(43)),
        }),
      ).toThrow('Authentication failed');
    },
  );

  it('uses the established library verification boundary and reduces to subject/email', async () => {
    const fake = makeClient({
      ...makePayload(),
      email: 'verified@example.test',
      email_verified: true,
    });
    const adapter = createGoogleAuthenticationAdapter({
      clientFactory: () => fake.client,
      clock: () => NOW,
    });
    const identity = await adapter.exchangeCode({
      config: CONFIG,
      code: 'authorization-code',
      codeVerifier: 'd'.repeat(43),
      nonceHash: sha256('nonce-value'),
      now: NOW,
    });

    expect(identity).toEqual({
      googleSub: 'google-subject',
      verifiedGoogleEmail: 'verified@example.test',
    });
    expect(fake.tokenOptions[0]).toEqual({
      client_id: CONFIG.clientId,
      code: 'authorization-code',
      codeVerifier: 'd'.repeat(43),
      redirect_uri: CONFIG.redirectUri,
    });
    expect(fake.verificationOptions[0]).toEqual({
      idToken: 'opaque-provider-id-token',
      audience: CONFIG.clientId,
    });
  });

  it('ignores an unverified email and enforces issuer, audience, nonce, and subject', async () => {
    const invalidPayloads: TokenPayload[] = [
      makePayload({ iss: 'https://evil.example.test' }),
      makePayload({ aud: 'another-client' }),
      makePayload({ nonce: 'other-nonce' }),
      makePayload({ sub: '' }),
      makePayload({ sub: 'sub\u0000ject' }),
      makePayload({ sub: 'é-subject' }),
      makePayload({ email_verified: true, email: `${'x'.repeat(321)}@example.test` }),
    ];

    for (const payload of invalidPayloads) {
      const fake = makeClient(payload);
      const adapter = createGoogleAuthenticationAdapter({
        clientFactory: () => fake.client,
        clock: () => NOW,
      });
      await expect(
        adapter.exchangeCode({
          config: CONFIG,
          code: 'authorization-code',
          codeVerifier: 'd'.repeat(43),
          nonceHash: sha256('nonce-value'),
          now: NOW,
        }),
      ).rejects.toThrow('Authentication failed');
    }

    const unverifiedFake = makeClient(makePayload({ email: 'unverified@example.test' }));
    const unverifiedAdapter = createGoogleAuthenticationAdapter({
      clientFactory: () => unverifiedFake.client,
      clock: () => NOW,
    });
    await expect(
      unverifiedAdapter.exchangeCode({
        config: CONFIG,
        code: 'authorization-code',
        codeVerifier: 'd'.repeat(43),
        nonceHash: sha256('nonce-value'),
        now: NOW,
      }),
    ).resolves.toEqual({ googleSub: 'google-subject', verifiedGoogleEmail: null });
  });

  it('enforces integer expiry and the exact five-minute future-iat boundary', async () => {
    const makeResult = async (iat: number, exp: number) => {
      const fake = makeClient(makePayload({ iat, exp }));
      const adapter = createGoogleAuthenticationAdapter({
        clientFactory: () => fake.client,
        clock: () => NOW,
      });
      return adapter.exchangeCode({
        config: CONFIG,
        code: 'authorization-code',
        codeVerifier: 'd'.repeat(43),
        nonceHash: sha256('nonce-value'),
        now: NOW,
      });
    };

    await expect(makeResult(NOW_SECONDS, NOW_SECONDS + 1)).resolves.toBeDefined();
    await expect(
      makeResult(NOW_SECONDS + GOOGLE_CLOCK_SKEW_SECONDS, NOW_SECONDS + 3_601),
    ).resolves.toBeDefined();
    await expect(
      makeResult(NOW_SECONDS + GOOGLE_CLOCK_SKEW_SECONDS + 1, NOW_SECONDS + 3_601),
    ).rejects.toThrow();
    await expect(makeResult(NOW_SECONDS, NOW_SECONDS)).rejects.toThrow();
    await expect(makeResult(NOW_SECONDS, NOW_SECONDS - 1)).rejects.toThrow();
    await expect(makeResult(NOW_SECONDS, NOW_SECONDS + 0.5)).rejects.toThrow();
    await expect(makeResult(NOW_SECONDS, NOW_SECONDS + 1)).resolves.toBeDefined();
  });

  it('sanitizes provider exchange and signature failures', async () => {
    const rejectingClient: GoogleOAuthClient = {
      generateAuthUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth',
      getToken: async () => {
        await Promise.resolve();
        throw new Error('provider-secret');
      },
      verifyIdToken: async () => {
        await Promise.resolve();
        throw new Error('signature-secret');
      },
    };
    const exchangeAdapter = createGoogleAuthenticationAdapter({
      clientFactory: () => rejectingClient,
      clock: () => NOW,
    });
    await expect(
      exchangeAdapter.exchangeCode({
        config: CONFIG,
        code: 'authorization-code',
        codeVerifier: 'd'.repeat(43),
        nonceHash: sha256('nonce-value'),
        now: NOW,
      }),
    ).rejects.toThrow('Authentication failed');

    const verificationFake = makeClient(makePayload());
    verificationFake.client.getToken = async () => {
      await Promise.resolve();
      return { tokens: { id_token: 'id-token' } };
    };
    verificationFake.client.verifyIdToken = async () => {
      await Promise.resolve();
      throw new Error('signature-secret');
    };
    const verificationAdapter = createGoogleAuthenticationAdapter({
      clientFactory: () => verificationFake.client,
      clock: () => NOW,
    });
    await expect(
      verificationAdapter.exchangeCode({
        config: CONFIG,
        code: 'authorization-code',
        codeVerifier: 'd'.repeat(43),
        nonceHash: sha256('nonce-value'),
        now: NOW,
      }),
    ).rejects.toThrow('Authentication failed');
  });

  it('requires a literal verified-email boolean and rejects missing or non-finite claims', async () => {
    const literalFalse = makePayload({ email: 'ignored@example.test' });
    Object.defineProperty(literalFalse, 'email_verified', { value: 'true' });
    const falseFake = makeClient(literalFalse);
    const falseAdapter = createGoogleAuthenticationAdapter({
      clientFactory: () => falseFake.client,
      clock: () => NOW,
    });
    await expect(
      falseAdapter.exchangeCode({
        config: CONFIG,
        code: 'authorization-code',
        codeVerifier: 'd'.repeat(43),
        nonceHash: sha256('nonce-value'),
        now: NOW,
      }),
    ).resolves.toEqual({ googleSub: 'google-subject', verifiedGoogleEmail: null });

    for (const claim of ['iat', 'exp', 'sub'] as const) {
      const malformed = makePayload();
      Object.defineProperty(malformed, claim, {
        value: claim === 'sub' ? undefined : Number.NaN,
      });
      const fake = makeClient(malformed);
      const adapter = createGoogleAuthenticationAdapter({
        clientFactory: () => fake.client,
        clock: () => NOW,
      });
      await expect(
        adapter.exchangeCode({
          config: CONFIG,
          code: 'authorization-code',
          codeVerifier: 'd'.repeat(43),
          nonceHash: sha256('nonce-value'),
          now: NOW,
        }),
      ).rejects.toThrow('Authentication failed');
    }
  });

  it('checks expiry against the clock after the provider exchange completes', async () => {
    let clockNow = NOW;
    const fake = makeClient(makePayload({ exp: NOW_SECONDS + 1 }));
    fake.client.getToken = async () => {
      await Promise.resolve();
      clockNow = new Date((NOW_SECONDS + 1) * 1_000);
      return { tokens: { id_token: 'id-token' } };
    };
    const adapter = createGoogleAuthenticationAdapter({
      clientFactory: () => fake.client,
      clock: () => clockNow,
    });
    await expect(
      adapter.exchangeCode({
        config: CONFIG,
        code: 'authorization-code',
        codeVerifier: 'd'.repeat(43),
        nonceHash: sha256('nonce-value'),
        now: NOW,
      }),
    ).rejects.toThrow('Authentication failed');
  });
});
