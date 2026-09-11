import { createHash } from 'node:crypto';
import { createServer } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { createNodeApp } from './node-app.js';
import { createAuthentication } from './auth/authentication.js';
import {
  type Authentication,
  type GoogleAuthorizationInput,
  type GoogleAuthenticationAdapter,
  type GoogleOperationConfiguration,
  type GoogleExchangeInput,
  type GoogleIdentity,
  type AuthenticationLogEntry,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  LOGIN_COOKIE_NAME,
} from './auth/contracts.js';
import { sha256 } from './auth/security.js';
import { createTestDatabase, type TestDatabase } from './database/test-database.js';

const APP_ORIGIN = 'https://app.example.test';
const GOOGLE_CONFIGURATION: GoogleOperationConfiguration = {
  clientId: 'integration-client-id',
  clientSecret: 'integration-client-secret',
  redirectUri: `${APP_ORIGIN}/api/auth/google/callback`,
  appOrigin: APP_ORIGIN,
};
const INITIAL_TIME = new Date('2026-09-10T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1_000;

interface MutableClock {
  now: Date;
  read(): Date;
}

interface CapturedLog {
  readonly requestId: string;
  readonly code: string;
}

class DeterministicGoogle implements GoogleAuthenticationAdapter {
  readonly authorizationCalls: GoogleAuthorizationInput[] = [];
  readonly exchangeCalls: GoogleExchangeInput[] = [];
  identity: GoogleIdentity = {
    googleSub: 'integration-google-subject',
    verifiedGoogleEmail: 'integration@example.test',
  };

  createAuthorizationUrl(input: GoogleAuthorizationInput): string {
    this.authorizationCalls.push(input);
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

  exchangeCode(input: GoogleExchangeInput): Promise<GoogleIdentity> {
    this.exchangeCalls.push(input);
    return Promise.resolve(this.identity);
  }
}

interface Harness {
  readonly database: TestDatabase;
  readonly clock: MutableClock;
  readonly google: DeterministicGoogle;
  readonly logs: CapturedLog[];
  readonly authentication: Authentication;
  readonly app: RequestApp;
  readonly nodeApp: RequestApp;
}

interface RequestApp {
  handle(request: Request): Promise<Response>;
}

let harness: Harness | undefined;

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
  const header = setCookieHeader(response, name);
  const valueStart = name.length + 1;
  const valueEnd = header.indexOf(';', valueStart);
  if (valueEnd < 0) {
    throw new Error(`malformed cookie ${name}`);
  }
  return header.slice(valueStart, valueEnd);
}

function setCookieHeader(response: Response, name: string): string {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  if (header === undefined) {
    throw new Error(`missing cookie ${name}`);
  }
  return header;
}

function cookieHeader(...cookies: Array<[string, string]>): string {
  return cookies.map(([name, value]) => `${name}=${value}`).join('; ');
}

function hasSetCookie(response: Response, name: string): boolean {
  return response.headers.getSetCookie().some((value) => value.startsWith(`${name}=`));
}

function sessionCookies(response: Response): { readonly session: string; readonly csrf: string } {
  return {
    session: cookieValue(response, SESSION_COOKIE_NAME),
    csrf: cookieValue(response, CSRF_COOKIE_NAME),
  };
}

async function startLogin(app: RequestApp): Promise<{
  readonly state: string;
  readonly login: string;
}> {
  const response = await app.handle(
    new Request(`${APP_ORIGIN}/api/auth/google/start`, { redirect: 'manual' }),
  );
  expect(response.status).toBe(302);
  const location = response.headers.get('location');
  expect(location).not.toBeNull();
  if (location === null) {
    throw new Error('missing authorization location');
  }
  const authorizationUrl = new URL(location);
  const state = authorizationUrl.searchParams.get('state');
  expect(state).not.toBeNull();
  if (state === null) {
    throw new Error('missing authorization state');
  }
  return { state, login: cookieValue(response, LOGIN_COOKIE_NAME) };
}

async function finishLogin(
  app: RequestApp,
  login: { readonly state: string; readonly login: string },
  predecessor?: { readonly session: string; readonly csrf: string },
): Promise<Response> {
  const callback = new URL(`${APP_ORIGIN}/api/auth/google/callback`);
  callback.searchParams.set('state', login.state);
  callback.searchParams.set('code', 'integration-authorization-code');
  const cookies: Array<[string, string]> = [[LOGIN_COOKIE_NAME, login.login]];
  if (predecessor !== undefined) {
    cookies.push([SESSION_COOKIE_NAME, predecessor.session], [CSRF_COOKIE_NAME, predecessor.csrf]);
  }
  return app.handle(
    new Request(callback, {
      redirect: 'manual',
      headers: { cookie: cookieHeader(...cookies) },
    }),
  );
}

async function createHarness(): Promise<Harness> {
  const clock = makeClock();
  const database = await createTestDatabase({ clock: () => clock.read() });
  const google = new DeterministicGoogle();
  const logs: CapturedLog[] = [];
  const authentication = createAuthentication({
    persistence: database.persistence,
    getGoogleConfiguration: () => GOOGLE_CONFIGURATION,
    getAppOrigin: () => APP_ORIGIN,
    google,
    clock: () => clock.read(),
    randomBytes: makeRandomBytes(),
    logger: { log: (entry: AuthenticationLogEntry) => logs.push(entry) },
  });
  return {
    database,
    clock,
    google,
    logs,
    authentication,
    app: createApp({ authentication }),
    nodeApp: createNodeApp({ authentication }),
  };
}

async function storedSessionRows(): Promise<
  Array<{
    readonly id: string;
    readonly user_id: string;
    readonly session_token_hash: string;
    readonly csrf_token_hash: string;
    readonly last_activity_at: Date;
    readonly idle_expires_at: Date;
    readonly absolute_expires_at: Date;
    readonly revoked_at: Date | null;
  }>
> {
  if (harness === undefined) {
    throw new Error('HARNESS_NOT_INITIALIZED');
  }
  const result = await harness.database.client.query<{
    id: string;
    user_id: string;
    session_token_hash: string;
    csrf_token_hash: string;
    last_activity_at: Date;
    idle_expires_at: Date;
    absolute_expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT id, user_id, session_token_hash, csrf_token_hash, last_activity_at,
      idle_expires_at, absolute_expires_at, revoked_at
     FROM application_sessions
     ORDER BY created_at, id`,
  );
  return result.rows;
}

async function createUserByLogin(identity: GoogleIdentity): Promise<{
  readonly response: Response;
  readonly cookies: { readonly session: string; readonly csrf: string };
}> {
  if (harness === undefined) {
    throw new Error('HARNESS_NOT_INITIALIZED');
  }
  harness.google.identity = identity;
  const login = await startLogin(harness.app);
  const response = await finishLogin(harness.app, login);
  expect(response.status).toBe(303);
  return { response, cookies: sessionCookies(response) };
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
  if (typeof server !== 'object' || server === null) {
    throw new Error('NODE_LISTENER_NOT_AVAILABLE');
  }
  const stop: unknown = Reflect.get(server, 'stop');
  if (typeof stop !== 'function') {
    throw new Error('NODE_LISTENER_STOP_NOT_AVAILABLE');
  }
  Reflect.apply(stop, server, [true]);
}

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  const current = harness;
  harness = undefined;
  if (current !== undefined) {
    await current.database.close();
  }
});

describe('real PostgreSQL HTTP authentication integration', () => {
  it('completes a fresh login, stores only token hashes, and exposes public session metadata', async () => {
    if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
    const current = harness;
    const identity: GoogleIdentity = {
      googleSub: 'fresh-login-subject',
      verifiedGoogleEmail: 'fresh@example.test',
    };
    current.google.identity = identity;
    const login = await startLogin(current.nodeApp);
    expect(current.google.authorizationCalls).toHaveLength(1);
    expect(current.google.authorizationCalls[0]?.config.redirectUri).toBe(
      GOOGLE_CONFIGURATION.redirectUri,
    );
    expect(current.google.authorizationCalls[0]?.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const response = await finishLogin(current.nodeApp, login);
    expect(response.status).toBe(303);
    const result = { response, cookies: sessionCookies(response) };
    expect(result.response.status).toBe(303);
    expect(result.response.headers.get('location')).toBe('/');
    expect(result.response.headers.get('cache-control')).toBe('private, no-store');
    expect(result.response.headers.get('referrer-policy')).toBe('no-referrer');
    const callbackCookies = result.response.headers.getSetCookie();
    expect(callbackCookies).toHaveLength(3);
    const sessionSetCookie = callbackCookies.find((value) =>
      value.startsWith(`${SESSION_COOKIE_NAME}=`),
    );
    const csrfSetCookie = callbackCookies.find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
    expect(sessionSetCookie).toMatch(
      new RegExp(`^${SESSION_COOKIE_NAME}=.+; Path=/; Expires=.+; SameSite=Lax; Secure; HttpOnly$`),
    );
    expect(csrfSetCookie).toMatch(
      new RegExp(`^${CSRF_COOKIE_NAME}=.+; Path=/; Expires=.+; SameSite=Lax; Secure$`),
    );
    expect(setCookieHeader(result.response, LOGIN_COOKIE_NAME)).toMatch(
      new RegExp(
        `^${LOGIN_COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure; HttpOnly$`,
      ),
    );
    expect(current.google.exchangeCalls[0]?.code).toBe('integration-authorization-code');
    expect(current.google.exchangeCalls[0]?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/u);
    const exchange = current.google.exchangeCalls[0];
    const authorization = current.google.authorizationCalls[0];
    if (exchange === undefined || authorization === undefined) {
      throw new Error('MISSING_GOOGLE_EXCHANGE');
    }
    expect(createHash('sha256').update(exchange.codeVerifier, 'utf8').digest('base64url')).toBe(
      authorization.codeChallenge,
    );
    expect(current.logs.every((entry) => /^[A-Z_]+$/u.test(entry.code))).toBe(true);
    expect(current.logs.every((entry) => entry.requestId.length > 0)).toBe(true);
    expect(hasSetCookie(result.response, LOGIN_COOKIE_NAME)).toBe(true);

    const sessionResponse = await current.nodeApp.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, result.cookies.session]) },
      }),
    );
    expect(sessionResponse.status).toBe(200);
    const sessionBody = await sessionResponse.text();
    expect(sessionBody).toMatch(
      /^\{"userId":"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}","verifiedGoogleEmail":"fresh@example\.test"\}$/u,
    );

    const rows = await storedSessionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.session_token_hash).toBe(
      createHash('sha256').update(result.cookies.session, 'utf8').digest('hex'),
    );
    expect(rows[0]?.csrf_token_hash).toBe(
      createHash('sha256').update(result.cookies.csrf, 'utf8').digest('hex'),
    );
    expect(rows[0]?.session_token_hash).not.toBe(result.cookies.session);
    expect(rows[0]?.csrf_token_hash).not.toBe(result.cookies.csrf);
    expect(rows[0]?.session_token_hash).toHaveLength(64);

    // The login transaction was consumed and no callback verifier remains.
    const transactions = await current.database.client.query<{
      readonly state_hash: string;
      readonly browser_binding_hash: string | null;
      readonly nonce_hash: string | null;
      readonly pkce_code_verifier: string | null;
      readonly return_path: string | null;
    }>(
      `SELECT state_hash, browser_binding_hash, nonce_hash, pkce_code_verifier, return_path
       FROM login_transactions`,
    );
    expect(transactions.rows).toHaveLength(1);
    expect(transactions.rows[0]?.browser_binding_hash).toBeNull();
    expect(transactions.rows[0]?.nonce_hash).toBeNull();
    expect(transactions.rows[0]?.pkce_code_verifier).toBeNull();
    expect(transactions.rows[0]?.return_path).toBeNull();
    expect(transactions.rows[0]?.state_hash).not.toContain(login.state);
  });

  it('resolves concurrent first logins to one internal user and rejects replay', async () => {
    if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
    const current = harness;
    current.google.identity = {
      googleSub: 'concurrent-first-login-subject',
      verifiedGoogleEmail: 'concurrent@example.test',
    };
    const starts = await Promise.all([startLogin(current.app), startLogin(current.app)]);
    const responses = await Promise.all(starts.map((login) => finishLogin(current.app, login)));
    expect(responses.every((response) => response.status === 303)).toBe(true);
    const users = await current.database.client.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count FROM users WHERE google_sub = $1`,
      ['concurrent-first-login-subject'],
    );
    expect(users.rows[0]?.count).toBe('1');

    const first = starts[0];
    if (first === undefined) throw new Error('MISSING_FIRST_LOGIN');
    const replay = await finishLogin(current.app, first);
    expect(replay.status).toBe(401);
    expect(hasSetCookie(replay, LOGIN_COOKIE_NAME)).toBe(true);
  });

  it('runs bounded expired-login cleanup through the public start route', async () => {
    if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
    const current = harness;
    const oldStateHash = sha256('old-http-cleanup-state');
    await current.database.persistence.loginTransactions.create({
      stateHash: oldStateHash,
      browserBindingHash: sha256('old-http-cleanup-binding'),
      nonceHash: sha256('old-http-cleanup-nonce'),
      pkceCodeVerifier: Buffer.alloc(32, 19).toString('base64url'),
      returnPath: '/',
      createdAt: new Date(INITIAL_TIME.getTime() - 40 * 60 * 1_000),
      expiresAt: new Date(INITIAL_TIME.getTime() - 30 * 60 * 1_000),
    });

    await startLogin(current.app);

    const oldRows = await current.database.client.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count FROM login_transactions WHERE state_hash = $1`,
      [oldStateHash],
    );
    expect(oldRows.rows[0]?.count).toBe('0');
    const currentRows = await current.database.client.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count FROM login_transactions`,
    );
    expect(currentRows.rows[0]?.count).toBe('1');
  });

  it('replaces the same-user predecessor and rejects an account switch while preserving it', async () => {
    if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
    const current = harness;
    const first = await createUserByLogin({
      googleSub: 'replacement-subject',
      verifiedGoogleEmail: 'replacement@example.test',
    });
    const predecessorRows = await storedSessionRows();
    const predecessorId = predecessorRows[0]?.id;

    const sameUserLogin = await startLogin(current.app);
    const sameUserCallback = await finishLogin(current.app, sameUserLogin, first.cookies);
    expect(sameUserCallback.status).toBe(303);
    const replacement = sessionCookies(sameUserCallback);
    expect(replacement.session).not.toBe(first.cookies.session);

    const oldSession = await current.app.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, first.cookies.session]) },
      }),
    );
    expect(oldSession.status).toBe(401);

    const switchLogin = await startLogin(current.app);
    current.google.identity = {
      googleSub: 'different-account-subject',
      verifiedGoogleEmail: 'different@example.test',
    };
    const switchCallback = await finishLogin(current.app, switchLogin, replacement);
    expect(switchCallback.status).toBe(409);
    await expect(switchCallback.json()).resolves.toEqual({
      error: 'ACCOUNT_SWITCH_REQUIRES_LOGOUT',
    });
    expect(hasSetCookie(switchCallback, SESSION_COOKIE_NAME)).toBe(false);
    expect(hasSetCookie(switchCallback, CSRF_COOKIE_NAME)).toBe(false);

    const preserved = await current.app.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, replacement.session]) },
      }),
    );
    expect(preserved.status).toBe(200);
    expect(predecessorId).toBeDefined();
  });

  it('rejects cross-account CSRF and revokes on successful logout', async () => {
    if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
    const current = harness;
    const first = await createUserByLogin({
      googleSub: 'csrf-account-a',
      verifiedGoogleEmail: 'a@example.test',
    });
    const second = await createUserByLogin({
      googleSub: 'csrf-account-b',
      verifiedGoogleEmail: 'b@example.test',
    });
    const crossAccount = await current.nodeApp.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        method: 'DELETE',
        headers: {
          origin: APP_ORIGIN,
          cookie: cookieHeader([SESSION_COOKIE_NAME, first.cookies.session]),
          'x-csrf-token': second.cookies.csrf,
        },
      }),
    );
    expect(crossAccount.status).toBe(403);
    expect(hasSetCookie(crossAccount, SESSION_COOKIE_NAME)).toBe(false);
    expect(hasSetCookie(crossAccount, CSRF_COOKIE_NAME)).toBe(false);

    const nodeLogout = await current.nodeApp.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        method: 'DELETE',
        headers: {
          origin: APP_ORIGIN,
          cookie: cookieHeader([SESSION_COOKIE_NAME, second.cookies.session]),
          'x-csrf-token': second.cookies.csrf,
        },
      }),
    );
    expect(nodeLogout.status).toBe(204);
    expect(setCookieHeader(nodeLogout, SESSION_COOKIE_NAME)).toMatch(
      new RegExp(
        `^${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure; HttpOnly$`,
      ),
    );
    expect(setCookieHeader(nodeLogout, CSRF_COOKIE_NAME)).toMatch(
      new RegExp(
        `^${CSRF_COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure$`,
      ),
    );

    const secondAfterNodeLogout = await current.app.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, second.cookies.session]) },
      }),
    );
    expect(secondAfterNodeLogout.status).toBe(401);

    const logout = await current.app.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        method: 'DELETE',
        headers: {
          origin: APP_ORIGIN,
          cookie: cookieHeader([SESSION_COOKIE_NAME, first.cookies.session]),
          'x-csrf-token': first.cookies.csrf,
        },
      }),
    );
    expect(logout.status).toBe(204);
    expect(hasSetCookie(logout, SESSION_COOKIE_NAME)).toBe(true);
    expect(hasSetCookie(logout, CSRF_COOKIE_NAME)).toBe(true);
    const afterLogout = await current.nodeApp.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, first.cookies.session]) },
      }),
    );
    expect(afterLogout.status).toBe(401);
  });

  it('does not touch GET activity and enforces the exact idle expiry boundary', async () => {
    if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
    const current = harness;
    const signedIn = await createUserByLogin({
      googleSub: 'expiry-subject',
      verifiedGoogleEmail: 'expiry@example.test',
    });
    const before = await storedSessionRows();
    const beforeActivity = before[0]?.last_activity_at.getTime();
    expect(before[0]?.idle_expires_at.getTime()).toBe(INITIAL_TIME.getTime() + 7 * DAY_MS);
    expect(before[0]?.absolute_expires_at.getTime()).toBe(INITIAL_TIME.getTime() + 30 * DAY_MS);

    current.clock.now = new Date(INITIAL_TIME.getTime() + 7 * DAY_MS - 1);
    const justBefore = await current.app.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, signedIn.cookies.session]) },
      }),
    );
    expect(justBefore.status).toBe(200);
    const after = await storedSessionRows();
    expect(after[0]?.last_activity_at.getTime()).toBe(beforeActivity);

    current.clock.now = new Date(INITIAL_TIME.getTime() + 7 * DAY_MS);
    const atBoundary = await current.app.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, signedIn.cookies.session]) },
      }),
    );
    expect(atBoundary.status).toBe(401);
    expect(hasSetCookie(atBoundary, SESSION_COOKIE_NAME)).toBe(true);
    expect(hasSetCookie(atBoundary, CSRF_COOKIE_NAME)).toBe(true);

    current.clock.now = new Date(INITIAL_TIME.getTime() + 7 * DAY_MS + 1);
    const justAfter = await current.app.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, signedIn.cookies.session]) },
      }),
    );
    expect(justAfter.status).toBe(401);
  });

  it('enforces the absolute expiry boundary independently of idle expiry', async () => {
    if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
    const current = harness;
    const signedIn = await createUserByLogin({
      googleSub: 'absolute-expiry-subject',
      verifiedGoogleEmail: 'absolute-expiry@example.test',
    });
    await current.database.client.query(
      `UPDATE application_sessions SET idle_expires_at = absolute_expires_at
       WHERE session_token_hash = $1`,
      [sha256(signedIn.cookies.session)],
    );

    current.clock.now = new Date(INITIAL_TIME.getTime() + 30 * DAY_MS - 1);
    const justBefore = await current.app.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, signedIn.cookies.session]) },
      }),
    );
    expect(justBefore.status).toBe(200);

    current.clock.now = new Date(INITIAL_TIME.getTime() + 30 * DAY_MS);
    const atBoundary = await current.app.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, signedIn.cookies.session]) },
      }),
    );
    expect(atBoundary.status).toBe(401);

    current.clock.now = new Date(INITIAL_TIME.getTime() + 30 * DAY_MS + 1);
    const justAfter = await current.app.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, signedIn.cookies.session]) },
      }),
    );
    expect(justAfter.status).toBe(401);
  });

  it('keeps application cookies when the database becomes unavailable', async () => {
    if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
    const current = harness;
    const signedIn = await createUserByLogin({
      googleSub: 'database-outage-subject',
      verifiedGoogleEmail: 'outage@example.test',
    });
    await current.database.persistence.close();
    const unavailable = await current.app.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, signedIn.cookies.session]) },
      }),
    );
    expect(unavailable.status).toBe(503);
    expect(hasSetCookie(unavailable, SESSION_COOKIE_NAME)).toBe(false);
    expect(hasSetCookie(unavailable, CSRF_COOKIE_NAME)).toBe(false);
  });

  it('preserves the session when PostgreSQL revocation fails during logout', async () => {
    if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
    const current = harness;
    const signedIn = await createUserByLogin({
      googleSub: 'logout-rollback-subject',
      verifiedGoogleEmail: 'logout-rollback@example.test',
    });
    await current.database.client.query(`
      CREATE FUNCTION fail_logout_for_test() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
          RAISE EXCEPTION 'intentional logout failure with private detail';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_logout_for_test_trigger
      BEFORE UPDATE ON application_sessions
      FOR EACH ROW EXECUTE FUNCTION fail_logout_for_test();
    `);
    const response = await current.app.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        method: 'DELETE',
        headers: {
          origin: APP_ORIGIN,
          cookie: cookieHeader([SESSION_COOKIE_NAME, signedIn.cookies.session]),
          'x-csrf-token': signedIn.cookies.csrf,
        },
      }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'AUTH_UNAVAILABLE' });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(current.logs.at(-1)?.code).toBe('AUTH_PERSISTENCE_FAILED');
    expect(JSON.stringify(current.logs)).not.toContain('private detail');

    await current.database.client.query(`
      DROP TRIGGER fail_logout_for_test_trigger ON application_sessions;
      DROP FUNCTION fail_logout_for_test();
    `);
    const preserved = await current.app.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, signedIn.cookies.session]) },
      }),
    );
    expect(preserved.status).toBe(200);
  });

  it('rolls back same-user replacement when an own-schema trigger fails', async () => {
    if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
    const current = harness;
    const signedIn = await createUserByLogin({
      googleSub: 'rollback-subject',
      verifiedGoogleEmail: 'rollback@example.test',
    });
    await current.database.client.query(`
      CREATE FUNCTION fail_replacement_for_test() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
          RAISE EXCEPTION 'intentional replacement failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_replacement_for_test_trigger
      BEFORE UPDATE ON application_sessions
      FOR EACH ROW EXECUTE FUNCTION fail_replacement_for_test();
    `);
    const before = await storedSessionRows();
    current.google.identity = {
      googleSub: 'rollback-subject',
      verifiedGoogleEmail: 'rollback@example.test',
    };
    const login = await startLogin(current.app);
    const failed = await finishLogin(current.app, login, signedIn.cookies);
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toEqual({ error: 'AUTH_UNAVAILABLE' });
    expect(hasSetCookie(failed, LOGIN_COOKIE_NAME)).toBe(true);
    expect(hasSetCookie(failed, SESSION_COOKIE_NAME)).toBe(false);
    expect(hasSetCookie(failed, CSRF_COOKIE_NAME)).toBe(false);
    expect(current.logs.at(-1)?.code).toBe('AUTH_PERSISTENCE_FAILED');
    expect(JSON.stringify(current.logs)).not.toContain('intentional replacement failure');
    const after = await storedSessionRows();
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.revoked_at).toBeNull();
    const stillAuthenticated = await current.app.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, signedIn.cookies.session]) },
      }),
    );
    expect(stillAuthenticated.status).toBe(200);
  });

  it('returns a sanitized failure without credentials when session creation rolls back', async () => {
    if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
    const current = harness;
    await current.database.client.query(`
      CREATE FUNCTION fail_session_creation_for_test() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'intentional session creation failure with private detail';
      END;
      $$;
      CREATE TRIGGER fail_session_creation_for_test_trigger
      BEFORE INSERT ON application_sessions
      FOR EACH ROW EXECUTE FUNCTION fail_session_creation_for_test();
    `);
    current.google.identity = {
      googleSub: 'creation-rollback-subject',
      verifiedGoogleEmail: 'creation-rollback@example.test',
    };
    const login = await startLogin(current.app);
    const response = await finishLogin(current.app, login);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'AUTH_UNAVAILABLE' });
    expect(hasSetCookie(response, LOGIN_COOKIE_NAME)).toBe(true);
    expect(hasSetCookie(response, SESSION_COOKIE_NAME)).toBe(false);
    expect(hasSetCookie(response, CSRF_COOKIE_NAME)).toBe(false);
    expect(current.logs.at(-1)?.code).toBe('AUTH_PERSISTENCE_FAILED');
    expect(JSON.stringify(current.logs)).not.toContain('private detail');
    expect(await storedSessionRows()).toEqual([]);
  });

  it('allows only one concurrent replacement of a predecessor session', async () => {
    if (harness === undefined) throw new Error('HARNESS_NOT_INITIALIZED');
    const current = harness;
    const signedIn = await createUserByLogin({
      googleSub: 'concurrent-replacement-subject',
      verifiedGoogleEmail: 'concurrent-replacement@example.test',
    });
    const starts = await Promise.all([startLogin(current.app), startLogin(current.app)]);
    const responses = await Promise.all(
      starts.map((login) => finishLogin(current.app, login, signedIn.cookies)),
    );
    expect(responses.filter((response) => response.status === 303)).toHaveLength(1);
    const winner = responses.find((response) => response.status === 303);
    const loser = responses.find((response) => response.status !== 303);
    if (winner === undefined || loser === undefined) throw new Error('MISSING_REPLACEMENT_RESULT');
    expect(loser.status).toBe(503);
    await expect(loser.json()).resolves.toEqual({ error: 'AUTH_UNAVAILABLE' });
    expect(hasSetCookie(loser, LOGIN_COOKIE_NAME)).toBe(true);
    expect(hasSetCookie(loser, SESSION_COOKIE_NAME)).toBe(false);
    expect(hasSetCookie(loser, CSRF_COOKIE_NAME)).toBe(false);
    const winnerCookies = sessionCookies(winner);
    const rows = await storedSessionRows();
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.revoked_at === null)).toHaveLength(1);
    expect(rows.find((row) => row.revoked_at === null)?.session_token_hash).toBe(
      sha256(winnerCookies.session),
    );

    const winnerSession = await current.app.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, winnerCookies.session]) },
      }),
    );
    expect(winnerSession.status).toBe(200);
    const predecessor = await current.app.handle(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, signedIn.cookies.session]) },
      }),
    );
    expect(predecessor.status).toBe(401);
  });

  it('preserves repeated Set-Cookie headers through an actual Node listener', async () => {
    const headers = new Headers({ 'cache-control': 'private, no-store' });
    headers.append('set-cookie', '__Host-kendomenu-session=; Path=/; Max-Age=0; Secure; HttpOnly');
    headers.append('set-cookie', '__Host-kendomenu-csrf=; Path=/; Max-Age=0; Secure');
    const response = (): Promise<Response> =>
      Promise.resolve(new Response(null, { status: 401, headers }));
    const authentication: Authentication = {
      start: response,
      callback: response,
      getSession: response,
      logout: response,
    };
    const port = await reserveLoopbackPort();
    const nodeApp = createNodeApp({ authentication });
    let listener: unknown;
    await new Promise<void>((resolve) => {
      nodeApp.listen({ hostname: '127.0.0.1', port }, (server) => {
        listener = server;
        resolve();
      });
    });
    try {
      const result = await fetch(`http://127.0.0.1:${port}/api/session`);
      expect(result.status).toBe(401);
      expect(result.headers.getSetCookie()).toEqual([
        '__Host-kendomenu-session=; Path=/; Max-Age=0; Secure; HttpOnly',
        '__Host-kendomenu-csrf=; Path=/; Max-Age=0; Secure',
      ]);
    } finally {
      stopNodeListener(listener);
    }
  });
});
