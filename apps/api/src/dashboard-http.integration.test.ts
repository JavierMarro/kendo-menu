import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import {
  type Authentication,
  type AuthenticationLogEntry,
  type GoogleAuthorizationInput,
  type GoogleAuthenticationAdapter,
  type GoogleExchangeInput,
  type GoogleIdentity,
  type GoogleOperationConfiguration,
  CSRF_COOKIE_NAME,
  LOGIN_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from './auth/contracts.js';
import { createAuthentication } from './auth/authentication.js';
import { createSessionAuthorization } from './auth/session-authorization.js';
import { sha256 } from './auth/security.js';
import { createDashboard } from './dashboard/dashboard.js';
import { MAX_DASHBOARD_REQUEST_BYTES } from './dashboard/contracts.js';
import { createDashboardCatalogue } from './dashboard/validation.js';
import { createNodeApp } from './node-app.js';
import type { DashboardPersistence } from './persistence/dashboard-contracts.js';
import { createTestDatabase, type TestDatabase } from './database/test-database.js';

const APP_ORIGIN = 'https://app.example.test';
const GOOGLE_CONFIGURATION: GoogleOperationConfiguration = {
  clientId: 'integration-client-id',
  clientSecret: 'integration-client-secret',
  redirectUri: `${APP_ORIGIN}/api/auth/google/callback`,
  appOrigin: APP_ORIGIN,
};
const INITIAL_TIME = new Date('2026-09-12T08:00:00.000Z');
const CATALOGUE = createDashboardCatalogue();

interface MutableClock {
  now: Date;
  read(): Date;
}

interface RequestApp {
  handle(request: Request): Promise<Response>;
}

type NodeRequestApp = ReturnType<typeof createNodeApp>;

interface Harness {
  readonly database: TestDatabase;
  readonly clock: MutableClock;
  readonly google: DeterministicGoogle;
  readonly authentication: Authentication;
  readonly app: RequestApp;
  readonly nodeApp: NodeRequestApp;
}

interface Cookies {
  readonly session: string;
  readonly csrf: string;
}

class DeterministicGoogle implements GoogleAuthenticationAdapter {
  identity: GoogleIdentity = {
    googleSub: 'dashboard-http-subject',
    verifiedGoogleEmail: 'dashboard-http@example.test',
  };

  createAuthorizationUrl(input: GoogleAuthorizationInput): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', input.config.clientId);
    url.searchParams.set('redirect_uri', input.config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email');
    url.searchParams.set('state', input.state);
    url.searchParams.set('nonce', input.nonce);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  exchangeCode(_input: GoogleExchangeInput): Promise<GoogleIdentity> {
    return Promise.resolve(this.identity);
  }
}

function makeClock(): MutableClock {
  let now = new Date(INITIAL_TIME.getTime());
  return {
    get now() {
      return new Date(now.getTime());
    },
    set now(value: Date) {
      now = new Date(value.getTime());
    },
    read: () => new Date(now.getTime()),
  };
}

function makeRandomBytes() {
  let counter = 0;
  return (size: number): Uint8Array => {
    counter += 1;
    return Uint8Array.from({ length: size }, (_, index) => (counter + index) % 256);
  };
}

function cookieValue(response: Response, name: string): string {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  if (header === undefined) throw new Error(`MISSING_COOKIE_${name}`);
  const valueEnd = header.indexOf(';', name.length + 1);
  if (valueEnd < 0) throw new Error(`MALFORMED_COOKIE_${name}`);
  return header.slice(name.length + 1, valueEnd);
}

function sessionCookies(response: Response): Cookies {
  return {
    session: cookieValue(response, SESSION_COOKIE_NAME),
    csrf: cookieValue(response, CSRF_COOKIE_NAME),
  };
}

function cookieHeader(cookies: Cookies, includeCsrf = true): string {
  return includeCsrf
    ? `${SESSION_COOKIE_NAME}=${cookies.session}; ${CSRF_COOKIE_NAME}=${cookies.csrf}`
    : `${SESSION_COOKIE_NAME}=${cookies.session}`;
}

async function startLogin(
  app: RequestApp,
): Promise<{ readonly state: string; readonly login: string }> {
  const response = await app.handle(
    new Request(`${APP_ORIGIN}/api/auth/google/start`, { redirect: 'manual' }),
  );
  expect(response.status).toBe(302);
  const location = response.headers.get('location');
  if (location === null) throw new Error('MISSING_AUTHORIZATION_LOCATION');
  const state = new URL(location).searchParams.get('state');
  if (state === null) throw new Error('MISSING_AUTHORIZATION_STATE');
  return { state, login: cookieValue(response, LOGIN_COOKIE_NAME) };
}

async function finishLogin(
  app: RequestApp,
  login: { readonly state: string; readonly login: string },
): Promise<Response> {
  const callback = new URL(`${APP_ORIGIN}/api/auth/google/callback`);
  callback.searchParams.set('state', login.state);
  callback.searchParams.set('code', 'dashboard-http-authorization-code');
  return app.handle(
    new Request(callback, {
      redirect: 'manual',
      headers: {
        cookie: `${LOGIN_COOKIE_NAME}=${login.login}`,
      },
    }),
  );
}

function isDashboardPersistence(value: unknown): value is DashboardPersistence {
  if (typeof value !== 'object' || value === null) return false;
  try {
    return (
      typeof Reflect.get(value, 'read') === 'function' &&
      typeof Reflect.get(value, 'compareAndWrite') === 'function'
    );
  } catch {
    return false;
  }
}

function dashboardPersistence(database: TestDatabase): DashboardPersistence {
  const candidate: unknown = Reflect.get(database.persistence, 'dashboards');
  if (!isDashboardPersistence(candidate)) throw new Error('DASHBOARD_PERSISTENCE_NOT_COMPOSED');
  return candidate;
}

async function createHarness(): Promise<Harness> {
  const clock = makeClock();
  const database = await createTestDatabase({ clock: () => clock.read() });
  const google = new DeterministicGoogle();
  const logs: AuthenticationLogEntry[] = [];
  const authentication = createAuthentication({
    persistence: database.persistence,
    getGoogleConfiguration: () => GOOGLE_CONFIGURATION,
    getAppOrigin: () => APP_ORIGIN,
    google,
    clock: () => clock.read(),
    randomBytes: makeRandomBytes(),
    logger: { log: (entry) => logs.push(entry) },
  });
  const dashboard = createDashboard({
    authorization: createSessionAuthorization({
      persistence: database.persistence,
      getAppOrigin: () => APP_ORIGIN,
      clock: () => clock.read(),
    }),
    persistence: dashboardPersistence(database),
    catalogue: CATALOGUE,
  });
  return {
    database,
    clock,
    google,
    authentication,
    app: createApp({ authentication, dashboard }),
    nodeApp: createNodeApp({ authentication, dashboard }),
  };
}

let harness: Harness | undefined;

async function createUser(identity: GoogleIdentity): Promise<Cookies> {
  if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
  harness.google.identity = identity;
  const login = await startLogin(harness.app);
  const response = await finishLogin(harness.app, login);
  expect(response.status).toBe(303);
  return sessionCookies(response);
}

function payload(
  userId: string,
  requestId: string,
  expectedRevision: string,
  state: Record<string, unknown> = { dashboardEntries: [] },
): Record<string, unknown> {
  return {
    transportVersion: 1,
    expectedAccountWorkspaceId: userId,
    expectedRevision,
    requestId,
    catalogueVersion: CATALOGUE.version,
    dashboard: { version: 10, state },
  };
}

function dashboardHeaders(cookies: Cookies, patch: Record<string, string> = {}) {
  return {
    cookie: cookieHeader(cookies),
    origin: APP_ORIGIN,
    'x-csrf-token': cookies.csrf,
    'content-type': 'application/json',
    ...patch,
  };
}

async function userIdFor(cookies: Cookies): Promise<string> {
  if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
  const result = await harness.database.client.query<{ readonly user_id: string }>(
    'SELECT user_id FROM application_sessions WHERE session_token_hash = $1',
    [sha256(cookies.session)],
  );
  const userId = result.rows[0]?.user_id;
  if (userId === undefined) throw new Error('USER_ID_NOT_FOUND');
  return userId;
}

async function sessionActivityFor(cookies: Cookies): Promise<{
  readonly lastActivityAt: number;
  readonly idleExpiresAt: number;
}> {
  if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
  const result = await harness.database.client.query<{
    readonly last_activity_at: Date;
    readonly idle_expires_at: Date;
  }>(
    `SELECT last_activity_at, idle_expires_at
     FROM application_sessions
     WHERE session_token_hash = $1`,
    [sha256(cookies.session)],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('SESSION_ACTIVITY_NOT_FOUND');
  return {
    lastActivityAt: row.last_activity_at.getTime(),
    idleExpiresAt: row.idle_expires_at.getTime(),
  };
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
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

function stopNodeListener(server: unknown): void {
  if (typeof server !== 'object' || server === null) throw new Error('NODE_LISTENER_UNAVAILABLE');
  const stop: unknown = Reflect.get(server, 'stop');
  if (typeof stop !== 'function') throw new Error('NODE_LISTENER_STOP_UNAVAILABLE');
  Reflect.apply(stop, server, [true]);
}

async function withNodeListener<T>(
  nodeApp: NodeRequestApp,
  operation: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const port = await reserveLoopbackPort();
  let listener: unknown;
  await new Promise<void>((resolve) => {
    nodeApp.listen({ hostname: '127.0.0.1', port }, (server) => {
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

function chunkedBody(body: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(body);
  const multibyteStart = bytes.indexOf(0xc3);
  const split = multibyteStart < 0 ? Math.floor(bytes.byteLength / 2) : multibyteStart + 1;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, split));
      controller.enqueue(bytes.slice(split));
      controller.close();
    },
  });
}

async function requestWithoutBody(port: number): Promise<{
  readonly status: number;
  readonly setCookies: readonly string[];
  readonly body: string;
}> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/dashboard',
      method: 'PUT',
      headers: {
        origin: APP_ORIGIN,
        'content-type': 'application/json',
      },
    });
    request.once('error', reject);
    request.once('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          setCookies: response.headers['set-cookie'] ?? [],
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    // Send only headers and an empty request terminator. A rejected request
    // must complete before any dashboard body bytes are sent or read.
    request.end();
  });
}

function customState(): Record<string, unknown> {
  return {
    dashboardEntries: [
      {
        id: 'entry-custom',
        trainingSetId: 'custom-set',
        trainingSet: {
          id: 'custom-set',
          name: 'Custom é set',
          category: 'custom',
          sections: [{ id: 'custom-section', name: 'Section', exercises: [] }],
          isBuiltIn: false,
        },
        quantityOverrides: {},
        activityNotes: {},
        notes: '',
        createdAt: INITIAL_TIME.toISOString(),
      },
    ],
  };
}

async function expectJsonError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  await expect(response.json()).resolves.toEqual({ error: code });
}

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  const current = harness;
  harness = undefined;
  if (current !== undefined) await current.database.close();
});

describe('registered dashboard routes through a real Node listener', () => {
  it('serves empty, successful, conflicting, replayed, isolated, HEAD, and method-safe requests', async () => {
    if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
    const accountA = await createUser({
      googleSub: 'dashboard-http-account-a',
      verifiedGoogleEmail: 'dashboard-http-a@example.test',
    });
    const accountB = await createUser({
      googleSub: 'dashboard-http-account-b',
      verifiedGoogleEmail: 'dashboard-http-b@example.test',
    });
    const accountAId = await userIdFor(accountA);
    const accountBId = await userIdFor(accountB);

    await withNodeListener(harness.nodeApp, async (baseUrl) => {
      const beforeRead = await sessionActivityFor(accountA);
      const empty = await fetch(`${baseUrl}/api/dashboard`, {
        headers: { cookie: cookieHeader(accountA, false) },
      });
      expect(empty.status).toBe(200);
      expect(empty.headers.get('cache-control')).toBe('private, no-store');
      expect(empty.headers.getSetCookie()).toEqual([]);
      await expect(empty.json()).resolves.toEqual({
        transportVersion: 1,
        accountWorkspaceId: accountAId,
        catalogueVersion: CATALOGUE.version,
        revision: '0',
        dashboard: null,
        updatedAt: null,
      });
      await expect(sessionActivityFor(accountA)).resolves.toEqual(beforeRead);

      const firstRequest = payload(accountAId, '00000000-0000-4000-8000-000000000101', '0');
      const first = await fetch(`${baseUrl}/api/dashboard`, {
        method: 'PUT',
        headers: dashboardHeaders(accountA),
        body: JSON.stringify(firstRequest),
      });
      expect(first.status).toBe(200);
      expect(first.headers.getSetCookie()).toEqual([]);
      const firstAcknowledgement: unknown = await first.json();
      expect(firstAcknowledgement).toMatchObject({
        accountWorkspaceId: accountAId,
        requestId: '00000000-0000-4000-8000-000000000101',
        revision: '1',
      });

      const saved = await fetch(`${baseUrl}/api/dashboard`, {
        headers: { cookie: cookieHeader(accountA, false) },
      });
      expect(saved.status).toBe(200);
      await expect(saved.json()).resolves.toMatchObject({
        accountWorkspaceId: accountAId,
        revision: '1',
        dashboard: { version: 10, state: { dashboardEntries: [] } },
      });

      const secondRequest = payload(accountAId, '00000000-0000-4000-8000-000000000102', '1');
      const conflict = await fetch(`${baseUrl}/api/dashboard`, {
        method: 'PUT',
        headers: dashboardHeaders(accountA),
        body: JSON.stringify({ ...secondRequest, expectedRevision: '0' }),
      });
      expect(conflict.status).toBe(409);
      expect(conflict.headers.get('cache-control')).toBe('private, no-store');
      await expect(conflict.json()).resolves.toEqual({
        error: 'REVISION_CONFLICT',
        currentRevision: '1',
      });

      const second = await fetch(`${baseUrl}/api/dashboard`, {
        method: 'PUT',
        headers: dashboardHeaders(accountA),
        body: JSON.stringify(secondRequest),
      });
      expect(second.status).toBe(200);
      await expect(second.json()).resolves.toMatchObject({ revision: '2' });

      const beforeReplay = await sessionActivityFor(accountA);
      const replay = await fetch(`${baseUrl}/api/dashboard`, {
        method: 'PUT',
        headers: dashboardHeaders(accountA),
        body: JSON.stringify(firstRequest),
      });
      expect(replay.status).toBe(200);
      await expect(replay.json()).resolves.toEqual(firstAcknowledgement);
      await expect(sessionActivityFor(accountA)).resolves.toEqual(beforeReplay);
      const beforeHead = await sessionActivityFor(accountA);

      const accountBEmpty = await fetch(`${baseUrl}/api/dashboard`, {
        headers: { cookie: cookieHeader(accountB, false) },
      });
      expect(accountBEmpty.status).toBe(200);
      await expect(accountBEmpty.json()).resolves.toMatchObject({
        accountWorkspaceId: accountBId,
        revision: '0',
        dashboard: null,
      });

      const substitution = await fetch(`${baseUrl}/api/dashboard`, {
        method: 'PUT',
        headers: dashboardHeaders(accountB),
        body: JSON.stringify(payload(accountAId, '00000000-0000-4000-8000-000000000103', '0')),
      });
      await expectJsonError(substitution, 403, 'ACCOUNT_WORKSPACE_MISMATCH');

      const head = await fetch(`${baseUrl}/api/dashboard`, {
        method: 'HEAD',
        headers: { cookie: cookieHeader(accountA, false) },
      });
      expect(head.status).toBe(405);
      expect(head.headers.get('allow')).toBe('GET, PUT');
      expect(head.headers.getSetCookie()).toEqual([]);
      await expect(head.text()).resolves.toBe('');
      await expect(sessionActivityFor(accountA)).resolves.toEqual(beforeHead);

      const method = await fetch(`${baseUrl}/api/dashboard`, {
        method: 'PATCH',
        headers: { cookie: cookieHeader(accountA, false) },
        body: 'not json',
      });
      await expectJsonError(method, 405, 'METHOD_NOT_ALLOWED');
      expect(method.headers.get('allow')).toBe('GET, PUT');
    });
  });

  it('rejects authentication, Origin, CSRF, media, and encoding failures before dashboard mutation', async () => {
    if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
    const account = await createUser({
      googleSub: 'dashboard-http-rejections',
      verifiedGoogleEmail: 'dashboard-http-rejections@example.test',
    });
    const userId = await userIdFor(account);

    await withNodeListener(harness.nodeApp, async (baseUrl) => {
      const unauthenticated = await requestWithoutBody(Number(new URL(baseUrl).port));
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.body).toBe('{"error":"UNAUTHENTICATED"}');
      expect(unauthenticated.setCookies).toHaveLength(2);

      const wrongOrigin = await fetch(`${baseUrl}/api/dashboard`, {
        method: 'PUT',
        headers: dashboardHeaders(account, { origin: 'https://other.example.test' }),
        body: JSON.stringify(payload(userId, '00000000-0000-4000-8000-000000000202', '0')),
      });
      await expectJsonError(wrongOrigin, 403, 'FORBIDDEN');

      const wrongCsrf = await fetch(`${baseUrl}/api/dashboard`, {
        method: 'PUT',
        headers: dashboardHeaders(account, { 'x-csrf-token': 'invalid' }),
        body: JSON.stringify(payload(userId, '00000000-0000-4000-8000-000000000203', '0')),
      });
      await expectJsonError(wrongCsrf, 403, 'FORBIDDEN');

      const unsupportedMedia = await fetch(`${baseUrl}/api/dashboard`, {
        method: 'PUT',
        headers: dashboardHeaders(account, { 'content-type': 'text/plain' }),
        body: 'not json',
      });
      await expectJsonError(unsupportedMedia, 415, 'UNSUPPORTED_MEDIA_TYPE');

      const unsupportedEncoding = await fetch(`${baseUrl}/api/dashboard`, {
        method: 'PUT',
        headers: dashboardHeaders(account, { 'content-encoding': 'gzip' }),
        body: JSON.stringify(payload(userId, '00000000-0000-4000-8000-000000000204', '0')),
      });
      await expectJsonError(unsupportedEncoding, 415, 'UNSUPPORTED_CONTENT_ENCODING');

      const stillEmpty = await fetch(`${baseUrl}/api/dashboard`, {
        headers: { cookie: cookieHeader(account, false) },
      });
      expect(stillEmpty.status).toBe(200);
      await expect(stillEmpty.json()).resolves.toMatchObject({ revision: '0', dashboard: null });
    });
  });

  it('accepts a missing Content-Length at the real byte boundary across a split UTF-8 character and rejects the next byte', async () => {
    if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
    const account = await createUser({
      googleSub: 'dashboard-http-byte-boundary',
      verifiedGoogleEmail: 'dashboard-http-byte-boundary@example.test',
    });
    const userId = await userIdFor(account);
    const requestId = '00000000-0000-4000-8000-000000000301';
    const serialized = JSON.stringify(payload(userId, requestId, '0', customState()));
    const serializedBytes = new TextEncoder().encode(serialized).byteLength;
    const atLimit = `${serialized}${' '.repeat(MAX_DASHBOARD_REQUEST_BYTES - serializedBytes)}`;

    await withNodeListener(harness.nodeApp, async (baseUrl) => {
      const validInit: RequestInit & { duplex: 'half' } = {
        method: 'PUT',
        headers: dashboardHeaders(account),
        body: chunkedBody(atLimit),
        duplex: 'half',
      };
      const valid = await fetch(`${baseUrl}/api/dashboard`, validInit);
      expect(valid.status).toBe(200);
      await expect(valid.json()).resolves.toMatchObject({ revision: '1', requestId });

      const overInit: RequestInit & { duplex: 'half' } = {
        method: 'PUT',
        headers: dashboardHeaders(account),
        body: chunkedBody(`${atLimit} `),
        duplex: 'half',
      };
      const over = await fetch(`${baseUrl}/api/dashboard`, overInit);
      await expectJsonError(over, 413, 'REQUEST_TOO_LARGE');

      const saved = await fetch(`${baseUrl}/api/dashboard`, {
        headers: { cookie: cookieHeader(account, false) },
      });
      expect(saved.status).toBe(200);
      await expect(saved.json()).resolves.toMatchObject({
        revision: '1',
        dashboard: { state: customState() },
      });
    });
  });
});
