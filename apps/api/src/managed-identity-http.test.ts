import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import vercelHandler from '../../../api/[...path].js';
import { createNodeApp } from './node-app.js';
import { createManagedIdentityVerifier } from './auth/managed-identity.js';

const TEST_ISSUER = 'http://127.0.0.1:44001';
const TEST_BASE_URL = `${TEST_ISSUER}/branch/auth`;
const TEST_KID = 'managed-proof-key';

interface TokenOptions {
  readonly audience?: string;
  readonly expiresAt?: number;
  readonly role?: string;
  readonly emailVerified?: boolean;
  readonly isAnonymous?: boolean;
  readonly omitSubject?: boolean;
  readonly omitExpiry?: boolean;
}

interface CredentialScenario {
  readonly name: string;
  readonly options: TokenOptions;
  readonly issuer?: string;
  readonly expected: 'invalid' | 'unverified-email';
}

const CREDENTIAL_SCENARIOS: readonly CredentialScenario[] = [
  {
    name: 'wrong issuer',
    issuer: 'https://wrong-branch.example.test',
    options: {},
    expected: 'invalid',
  },
  {
    name: 'wrong audience',
    options: { audience: 'https://wrong-branch.example.test' },
    expected: 'invalid',
  },
  {
    name: 'expired token',
    options: { expiresAt: Math.floor(Date.now() / 1_000) - 10 },
    expected: 'invalid',
  },
  { name: 'missing subject claim', options: { omitSubject: true }, expected: 'invalid' },
  { name: 'missing expiry claim', options: { omitExpiry: true }, expected: 'invalid' },
  {
    name: 'unsafe expiry claim',
    options: { expiresAt: Number.MAX_SAFE_INTEGER + 1 },
    expected: 'invalid',
  },
  { name: 'anonymous role', options: { role: 'anonymous' }, expected: 'invalid' },
  { name: 'anonymous account flag', options: { isAnonymous: true }, expected: 'invalid' },
  {
    name: 'unverified email',
    options: { emailVerified: false },
    expected: 'unverified-email',
  },
];

function stopNodeListener(server: unknown): void {
  if (typeof server !== 'object' || server === null) throw new Error('NODE_LISTENER_UNAVAILABLE');
  const stop: unknown = Reflect.get(server, 'stop');
  if (typeof stop !== 'function') throw new Error('NODE_LISTENER_STOP_UNAVAILABLE');
  Reflect.apply(stop, server, [true]);
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createNetServer();
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('LOOPBACK_PORT_UNAVAILABLE'));
        return;
      }
      server.close((error) => {
        if (error === undefined) resolve(address.port);
        else reject(error);
      });
    });
  });
}

async function withNodeListener<T>(
  app: ReturnType<typeof createNodeApp>,
  operation: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const port = await reserveLoopbackPort();
  let listener: unknown;
  await new Promise<void>((resolve) => {
    app.listen({ hostname: '127.0.0.1', port }, (server) => {
      listener = server;
      resolve();
    });
  });
  try {
    return await operation(`http://127.0.0.1:${port}`);
  } finally {
    stopNodeListener(listener);
  }
}

describe('isolated managed identity proof route', () => {
  afterEach(async () => {
    await Promise.all(
      jwksServers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error === undefined ? resolve() : reject(error)));
            server.closeAllConnections();
          }),
      ),
    );
    jwksServers.splice(0);
  });

  const jwksServers: ReturnType<typeof createHttpServer>[] = [];

  async function createJwksServer(
    publicKey: Readonly<Record<string, unknown>>,
    options: { readonly statusCode?: number; readonly body?: string } = {},
  ): Promise<string> {
    const statusCode = options.statusCode ?? 200;
    const server = createHttpServer((request, response) => {
      if (request.url !== '/branch/auth/.well-known/jwks.json') {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(statusCode, { 'content-type': 'application/json' });
      response.end(options.body ?? JSON.stringify({ keys: [publicKey] }));
    });
    jwksServers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('JWKS_LISTENER_UNAVAILABLE');
    return `http://127.0.0.1:${address.port}/branch/auth`;
  }

  async function createToken(
    privateKey: CryptoKey,
    issuer: string,
    options: TokenOptions = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1_000);
    const jwt = new SignJWT({
      role: options.role ?? 'authenticated',
      isAnonymous: options.isAnonymous ?? false,
      email: 'proof@example.test',
      emailVerified: options.emailVerified ?? true,
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: TEST_KID })
      .setIssuer(issuer)
      .setAudience(options.audience ?? issuer)
      .setIssuedAt(now);
    if (options.omitSubject !== true) jwt.setSubject('managed-user-subject');
    if (options.omitExpiry !== true) jwt.setExpirationTime(options.expiresAt ?? now + 60);
    return jwt.sign(privateKey);
  }

  async function generatePair() {
    const pair = await generateKeyPair('EdDSA');
    const exported = await exportJWK(pair.publicKey);
    const publicKey: Readonly<Record<string, unknown>> = {
      ...exported,
      alg: 'EdDSA',
      kid: TEST_KID,
      use: 'sig',
    };
    return { ...pair, publicKey };
  }

  async function requestIdentity(baseUrl: string, token: string): Promise<Response> {
    const verifier = createManagedIdentityVerifier(baseUrl);
    return withNodeListener(createNodeApp({ managedIdentity: verifier }), (apiUrl) =>
      fetch(`${apiUrl}/api/dev/managed-identity`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  }

  it('verifies the actual Node transport and returns only safe verified identity fields', async () => {
    const pair = await generatePair();
    const baseUrl = await createJwksServer(pair.publicKey);
    const token = await createToken(pair.privateKey, new URL(baseUrl).origin);
    const response = await requestIdentity(baseUrl, token);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const responseBody = await response.text();
    expect(responseBody).toContain(`"issuer":"${new URL(baseUrl).origin}"`);
    expect(responseBody).toContain('"provider":"neon"');
    expect(responseBody).toContain('"subject":"managed-user-subject"');
    expect(responseBody).toContain('"verifiedEmail":"proof@example.test"');
    expect(responseBody).toMatch(/"expiresAt":\d+/u);
    expect(responseBody).not.toContain('emailVerified');
  });

  it.each(CREDENTIAL_SCENARIOS)(
    '$name credentials are rejected or unverified email is withheld',
    async ({ issuer, options, expected }) => {
      const pair = await generatePair();
      const baseUrl = await createJwksServer(pair.publicKey);
      const token = await createToken(pair.privateKey, issuer ?? new URL(baseUrl).origin, options);
      const response = await requestIdentity(baseUrl, token);

      if (expected === 'unverified-email') {
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
          identity: { verifiedEmail: null },
        });
      } else {
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ error: 'UNAUTHENTICATED' });
      }
    },
  );

  it('rejects a valid token signed by a different branch key', async () => {
    const expectedPair = await generatePair();
    const otherBranchPair = await generatePair();
    const baseUrl = await createJwksServer(expectedPair.publicKey);
    const token = await createToken(otherBranchPair.privateKey, new URL(baseUrl).origin);
    const response = await requestIdentity(baseUrl, token);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'UNAUTHENTICATED' });
  });

  it('returns sanitized 503 when the branch JWKS endpoint is unavailable', async () => {
    const pair = await generatePair();
    const baseUrl = await createJwksServer(pair.publicKey, { statusCode: 503 });
    const token = await createToken(pair.privateKey, new URL(baseUrl).origin);
    const response = await requestIdentity(baseUrl, token);

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.text();
    expect(body).toBe('{"error":"MANAGED_AUTH_UNAVAILABLE"}');
    expect(body).not.toContain(token);
  });

  it('returns sanitized 503 when branch JWKS configuration is malformed', async () => {
    const pair = await generatePair();
    const baseUrl = await createJwksServer(pair.publicKey, { body: '{"unexpected":true}' });
    const token = await createToken(pair.privateKey, new URL(baseUrl).origin);
    const response = await requestIdentity(baseUrl, token);

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ error: 'MANAGED_AUTH_UNAVAILABLE' });
  });

  it('returns sanitized 503 when a matching branch signing key is malformed', async () => {
    const pair = await generatePair();
    const baseUrl = await createJwksServer(pair.publicKey, {
      body: JSON.stringify({
        keys: [{ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', kid: TEST_KID, use: 'sig' }],
      }),
    });
    const token = await createToken(pair.privateKey, new URL(baseUrl).origin);
    const response = await requestIdentity(baseUrl, token);

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ error: 'MANAGED_AUTH_UNAVAILABLE' });
  });

  it('does not register the proof route in ordinary Node or Vercel composition', async () => {
    const ordinary = createNodeApp();
    await withNodeListener(ordinary, async (apiUrl) => {
      const response = await fetch(`${apiUrl}/api/dev/managed-identity`);
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    });
    const vercelResponse = await vercelHandler.fetch(
      new Request('https://app.example.test/api/dev/managed-identity'),
    );
    expect(vercelResponse.status).toBe(404);
  });

  it('returns a private 503 when enabled without branch configuration', async () => {
    const response = await requestIdentity('', 'synthetic-token');
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ error: 'MANAGED_AUTH_UNAVAILABLE' });
  });

  it('returns sanitized 401 for missing and malformed bearer credentials', async () => {
    const app = createNodeApp({ managedIdentity: createManagedIdentityVerifier(TEST_BASE_URL) });
    await withNodeListener(app, async (apiUrl) => {
      for (const authorization of [
        undefined,
        'Basic opaque',
        'Bearer',
        'Bearer two tokens',
        'Bearer not.a.jwt',
      ]) {
        const response = await fetch(`${apiUrl}/api/dev/managed-identity`, {
          headers: authorization === undefined ? {} : { authorization },
        });
        expect(response.status).toBe(401);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        await expect(response.json()).resolves.toEqual({ error: 'UNAUTHENTICATED' });
      }
    });
  });
});
