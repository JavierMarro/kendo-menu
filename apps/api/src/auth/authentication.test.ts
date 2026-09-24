/**
 * Application-level authentication tests using deterministic Google and
 * persistence adapters. These exercise public responses, cookie policy, replay,
 * fixation, account switching, expiry, and CSRF without network or PostgreSQL.
 *
 * The fakes expose stored hashes and operation order so the tests can assert
 * security effects, not just HTTP status codes. Real PostgreSQL locking and
 * constraints are covered separately by the persistence integration suite.
 */
import { describe, expect, it } from 'vitest';

import { PersistenceError } from '../persistence/contracts.js';
import type {
  AdoptionDecisionInput,
  AdoptionDecisionOutcome,
  AdoptionStatus,
  AdoptionStatusInput,
  CompleteGoogleLoginInput,
  CompleteGoogleLoginResult,
  ConsumeLoginTransactionInput,
  ConsumeLoginTransactionResult,
  KendoPersistence,
  LoginTransactionCreationInput,
  LoginTransactionReceipt,
  PublicUserRecord,
  ResolveGoogleUserInput,
  SessionCreationInput,
  SessionLookupInput,
  SessionRecord,
  SessionReplacementInput,
  SessionRevocationInput,
  UserRecord,
} from '../persistence/contracts.js';
import { createAuthentication } from './authentication.js';
import {
  CSRF_COOKIE_NAME,
  LOGIN_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  type AuthenticationLogEntry,
  type GoogleAuthenticationAdapter,
  type GoogleAuthorizationInput,
  type GoogleExchangeInput,
  type GoogleIdentity,
  type GoogleOperationConfiguration,
} from './contracts.js';
import { isNonZeroRevision } from '../dashboard/validation.js';
import { sha256 } from './security.js';

const APP_ORIGIN = 'https://app.example.test';
const CONFIG: GoogleOperationConfiguration = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: `${APP_ORIGIN}/api/auth/google/callback`,
  appOrigin: APP_ORIGIN,
};
const NOW = new Date('2026-09-11T10:00:00.000Z');
const USER_ID = '00000000-0000-4000-8000-000000000001';

interface LoginState {
  readonly input: LoginTransactionCreationInput;
  readonly receipt: LoginTransactionReceipt;
  consumed: boolean;
}

interface FakeAdoptionState {
  readonly creatingSessionId: string;
}

class FakePersistence implements KendoPersistence {
  readonly usersBySubject = new Map<string, UserRecord>();
  readonly usersById = new Map<string, UserRecord>();
  readonly loginStates = new Map<string, LoginState>();
  readonly sessionsById = new Map<string, SessionRecord>();
  readonly sessionHashes = new Map<
    string,
    { readonly sessionTokenHash: string; readonly csrfTokenHash: string }
  >();
  sessionCounter = 0;
  touchCalls = 0;
  cleanupCalls = 0;
  unavailable = false;
  readonly adoptionByUser = new Map<string, FakeAdoptionState>();
  adoptionStatusOverride: AdoptionStatus | undefined;
  malformedAdoptionStatus = false;

  readonly users = {
    findPublicById: async (userId: string): Promise<PublicUserRecord | null> => {
      await Promise.resolve();
      this.assertAvailable();
      const user = this.usersById.get(userId);
      return user === undefined
        ? null
        : { id: user.id, verifiedGoogleEmail: user.verifiedGoogleEmail };
    },
    resolveByGoogleSubject: async (input: ResolveGoogleUserInput): Promise<UserRecord> => {
      await Promise.resolve();
      this.assertAvailable();
      const existing = this.usersBySubject.get(input.googleSub);
      const now = new Date(NOW.getTime());
      const user: UserRecord =
        existing === undefined
          ? {
              id:
                this.usersById.size === 0
                  ? USER_ID
                  : `00000000-0000-4000-8000-${String(this.usersById.size + 1).padStart(12, '0')}`,
              googleSub: input.googleSub,
              verifiedGoogleEmail: input.verifiedGoogleEmail ?? null,
              createdAt: now,
              updatedAt: now,
            }
          : {
              ...existing,
              verifiedGoogleEmail:
                input.verifiedGoogleEmail === undefined
                  ? existing.verifiedGoogleEmail
                  : input.verifiedGoogleEmail,
              updatedAt: now,
            };
      this.usersBySubject.set(input.googleSub, user);
      this.usersById.set(user.id, user);
      return user;
    },
  };

  readonly accounts = {
    completeGoogleLogin: async (
      input: CompleteGoogleLoginInput,
    ): Promise<CompleteGoogleLoginResult> => {
      await Promise.resolve();
      this.assertAvailable();
      const user = await this.users.resolveByGoogleSubject({
        googleSub: input.googleSub,
        ...(input.verifiedGoogleEmail === undefined
          ? {}
          : { verifiedGoogleEmail: input.verifiedGoogleEmail }),
      });
      const sessionInput: SessionCreationInput = {
        userId: user.id,
        sessionTokenHash: input.sessionTokenHash,
        csrfTokenHash: input.csrfTokenHash,
        idleExpiresAt: input.idleExpiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
        ...(input.lastActivityAt === undefined ? {} : { lastActivityAt: input.lastActivityAt }),
      };
      let session: SessionRecord;
      if (input.predecessorSessionTokenHash === undefined) {
        session = await this.sessions.create(sessionInput);
      } else {
        const predecessor = await this.sessions.findActiveByTokenHash({
          sessionTokenHash: input.predecessorSessionTokenHash,
          ...(input.at === undefined ? {} : { at: input.at }),
        });
        if (predecessor !== null && predecessor.userId !== user.id) {
          return { status: 'account-switch' };
        }
        session =
          predecessor === null
            ? await this.sessions.create(sessionInput)
            : await this.sessions.replace({
                predecessorSessionId: predecessor.id,
                userId: user.id,
                replacement: sessionInput,
                ...(input.at === undefined ? {} : { at: input.at }),
              });
      }
      if (!this.adoptionByUser.has(user.id)) {
        this.adoptionByUser.set(user.id, { creatingSessionId: session.id });
      }
      return { status: 'completed', user, session };
    },
  };

  readonly adoptions = {
    getStatus: async (input: AdoptionStatusInput): Promise<AdoptionStatus> => {
      await Promise.resolve();
      this.assertAvailable();
      if (this.adoptionStatusOverride !== undefined) {
        return this.adoptionStatusOverride;
      }
      const state = this.adoptionByUser.get(input.userId);
      if (state === undefined) {
        return { status: 'unavailable', capability: false };
      }
      const session = this.sessionsById.get(input.sessionId);
      const hashes = this.sessionHashes.get(input.sessionId);
      const capability =
        session !== undefined &&
        hashes !== undefined &&
        session.userId === input.userId &&
        session.id === state.creatingSessionId &&
        session.revokedAt === null &&
        session.idleExpiresAt.getTime() > NOW.getTime() &&
        session.absoluteExpiresAt.getTime() > NOW.getTime() &&
        hashes.sessionTokenHash === input.sessionTokenHash;
      const status: { status: 'pending'; capability: boolean } = {
        status: 'pending',
        capability,
      };
      if (this.malformedAdoptionStatus) {
        Object.defineProperty(status, 'capability', { value: 'malformed' });
      }
      return status;
    },
    decide: async (
      _input: AdoptionDecisionInput & AdoptionStatusInput,
    ): Promise<AdoptionDecisionOutcome> => {
      await Promise.resolve();
      this.assertAvailable();
      return { status: 'unavailable' };
    },
  };

  readonly loginTransactions = {
    create: async (input: LoginTransactionCreationInput): Promise<LoginTransactionReceipt> => {
      await Promise.resolve();
      this.assertAvailable();
      const receipt: LoginTransactionReceipt = {
        id: `transaction-${this.loginStates.size + 1}`,
        returnPath: input.returnPath ?? '/',
        createdAt: input.createdAt ?? NOW,
        expiresAt: input.expiresAt,
      };
      this.loginStates.set(input.stateHash, { input, receipt, consumed: false });
      return receipt;
    },
    consume: async (
      input: ConsumeLoginTransactionInput,
    ): Promise<ConsumeLoginTransactionResult> => {
      await Promise.resolve();
      this.assertAvailable();
      const state = this.loginStates.get(input.stateHash);
      if (state === undefined) return { outcome: 'missing' };
      if (state.consumed) return { outcome: 'consumed' };
      if (state.input.browserBindingHash !== input.browserBindingHash) {
        return { outcome: 'binding-mismatch' };
      }
      state.consumed = true;
      return {
        outcome: 'success',
        transaction: {
          pkceCodeVerifier: state.input.pkceCodeVerifier,
          nonceHash: state.input.nonceHash,
          returnPath: state.receipt.returnPath,
          createdAt: state.receipt.createdAt,
          expiresAt: state.receipt.expiresAt,
        },
      };
    },
    cleanupExpired: async () => {
      await Promise.resolve();
      this.assertAvailable();
      this.cleanupCalls += 1;
      return { deleted: 0 };
    },
  };

  readonly sessions = {
    create: async (input: SessionCreationInput): Promise<SessionRecord> => {
      await Promise.resolve();
      this.assertAvailable();
      const id = `00000000-0000-4000-8000-${String(this.sessionCounter + 1).padStart(12, '0')}`;
      this.sessionCounter += 1;
      const session: SessionRecord = {
        id,
        userId: input.userId,
        createdAt: input.createdAt ?? NOW,
        lastActivityAt: input.lastActivityAt ?? input.createdAt ?? NOW,
        idleExpiresAt: input.idleExpiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        revokedAt: null,
      };
      this.sessionsById.set(id, session);
      this.sessionHashes.set(id, {
        sessionTokenHash: input.sessionTokenHash,
        csrfTokenHash: input.csrfTokenHash,
      });
      return session;
    },
    replace: async (input: SessionReplacementInput): Promise<SessionRecord> => {
      this.assertAvailable();
      const predecessor = this.sessionsById.get(input.predecessorSessionId);
      if (predecessor === undefined || predecessor.revokedAt !== null) {
        throw new Error('CONFLICT');
      }
      this.sessionsById.set(predecessor.id, { ...predecessor, revokedAt: input.at ?? NOW });
      return this.sessions.create(input.replacement);
    },
    findActiveByTokenHash: async (input: SessionLookupInput): Promise<SessionRecord | null> => {
      await Promise.resolve();
      this.assertAvailable();
      const at = input.at ?? NOW;
      for (const session of this.sessionsById.values()) {
        const hashes = this.sessionHashes.get(session.id);
        if (hashes === undefined) continue;
        if (
          hashes.sessionTokenHash === input.sessionTokenHash &&
          session.revokedAt === null &&
          session.idleExpiresAt.getTime() > at.getTime() &&
          session.absoluteExpiresAt.getTime() > at.getTime() &&
          (input.csrfTokenHash === undefined || hashes.csrfTokenHash === input.csrfTokenHash)
        ) {
          return session;
        }
      }
      return null;
    },
    touch: async () => {
      await Promise.resolve();
      this.touchCalls += 1;
      return null;
    },
    revoke: async (input: SessionRevocationInput): Promise<boolean> => {
      await Promise.resolve();
      this.assertAvailable();
      const session = this.sessionsById.get(input.sessionId);
      if (session === undefined || session.userId !== input.userId || session.revokedAt !== null) {
        return false;
      }
      this.sessionsById.set(session.id, { ...session, revokedAt: input.at ?? NOW });
      return true;
    },
  };

  private assertAvailable(): void {
    if (this.unavailable) throw new PersistenceError('UNAVAILABLE');
  }
}

class FakeGoogle implements GoogleAuthenticationAdapter {
  identity: GoogleIdentity = {
    googleSub: 'google-subject',
    verifiedGoogleEmail: 'person@example.test',
  };
  authorizationInputs: GoogleAuthorizationInput[] = [];
  exchangeInputs: GoogleExchangeInput[] = [];
  failAuthorization = false;
  failExchange = false;

  createAuthorizationUrl(input: GoogleAuthorizationInput): string {
    this.authorizationInputs.push(input);
    if (this.failAuthorization) {
      throw new Error('PRIVATE_AUTHORIZATION_ADAPTER_FAILURE');
    }
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('state', input.state);
    url.searchParams.set('nonce', input.nonce);
    url.searchParams.set('redirect_uri', input.config.redirectUri);
    url.searchParams.set('code_challenge', input.codeChallenge);
    return url.toString();
  }

  async exchangeCode(input: GoogleExchangeInput): Promise<GoogleIdentity> {
    await Promise.resolve();
    this.exchangeInputs.push(input);
    if (this.failExchange) {
      throw new Error('PRIVATE_EXCHANGE_FAILURE');
    }
    return this.identity;
  }
}

function deterministicRandomBytes() {
  let counter = 0;
  return (size: number): Uint8Array => {
    counter += 1;
    return Uint8Array.from({ length: size }, (_, index) => (counter + index) % 256);
  };
}

function makeAuthentication(
  persistence: FakePersistence,
  google = new FakeGoogle(),
  config: () => GoogleOperationConfiguration | Promise<GoogleOperationConfiguration> = () => CONFIG,
) {
  const logs: AuthenticationLogEntry[] = [];
  const authentication = createAuthentication({
    persistence,
    getGoogleConfiguration: config,
    getAppOrigin: () => APP_ORIGIN,
    google,
    clock: () => NOW,
    randomBytes: deterministicRandomBytes(),
    logger: { log: (entry) => logs.push(entry) },
  });
  return { authentication, google, logs };
}

function readCookie(response: Response, name: string): string {
  const value = response.headers.get('set-cookie');
  if (value === null) throw new Error('MISSING_SET_COOKIE');
  const start = value.indexOf(`${name}=`);
  if (start < 0) throw new Error('MISSING_COOKIE');
  const valueStart = start + name.length + 1;
  const valueEnd = value.indexOf(';', valueStart);
  if (valueEnd < 0) throw new Error('MALFORMED_COOKIE');
  return value.slice(valueStart, valueEnd);
}

function cookieHeader(...values: Array<readonly [string, string]>): string {
  return values.map(([name, value]) => `${name}=${value}`).join('; ');
}

async function expectCallbackFailure(response: Response, code: string): Promise<void> {
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe(`/app?authError=${code}`);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  await expect(response.text()).resolves.toBe('');
  const cookies = response.headers.getSetCookie();
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).toContain(`${LOGIN_COOKIE_NAME}=;`);
  expect(cookies.some((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`))).toBe(false);
  expect(cookies.some((cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`))).toBe(false);
}

async function startLogin(authentication: ReturnType<typeof createAuthentication>): Promise<{
  readonly state: string;
  readonly login: string;
}> {
  const response = await authentication.start(new Request(`${APP_ORIGIN}/api/auth/google/start`));
  expect(response.status).toBe(302);
  const location = response.headers.get('location');
  if (location === null) throw new Error('MISSING_LOCATION');
  const state = new URL(location).searchParams.get('state');
  if (state === null) throw new Error('MISSING_STATE');
  return { state, login: readCookie(response, LOGIN_COOKIE_NAME) };
}

function makeAcceptedAdoptionStatus(): Extract<AdoptionStatus, { status: 'accepted' }> {
  const acknowledgedRevision = '1';
  if (!isNonZeroRevision(acknowledgedRevision)) {
    throw new Error('INVALID_TEST_REVISION');
  }
  return {
    status: 'accepted',
    capability: false,
    completion: {
      decision: 'yes',
      requestId: '00000000-0000-4000-8000-000000000099',
      acknowledgedRevision,
      timestamp: NOW,
    },
  };
}

describe('authentication application module', () => {
  it('defaults returnPath and accepts one standard URL decoded slash', async () => {
    const persistence = new FakePersistence();
    const { authentication, google } = makeAuthentication(persistence);
    const defaultStart = await authentication.start(
      new Request(`${APP_ORIGIN}/api/auth/google/start`),
    );
    expect(defaultStart.status).toBe(302);
    expect(persistence.cleanupCalls).toBe(1);
    expect(persistence.loginStates.size).toBe(1);
    expect([...persistence.loginStates.values()][0]?.input.returnPath).toBe('/');
    expect(google.authorizationInputs[0]?.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const encoded = await authentication.start(
      new Request(`${APP_ORIGIN}/api/auth/google/start?returnPath=%2F`),
    );
    expect(encoded.status).toBe(302);
    expect([...persistence.loginStates.values()][1]?.input.returnPath).toBe('/');

    for (const query of [
      '?returnPath=',
      '?returnPath=%252F',
      '?returnPath=%ZZ',
      '?returnPath=/%2F',
      '?returnPath=/%2F&returnPath=/',
    ]) {
      const rejected = await authentication.start(
        new Request(`${APP_ORIGIN}/api/auth/google/start${query}`),
      );
      expect(rejected.status).toBe(400);
      await expect(rejected.json()).resolves.toEqual({ error: 'INVALID_AUTH_REQUEST' });
    }
  });

  it('rejects a mismatched request origin before persistence and provider use', async () => {
    const persistence = new FakePersistence();
    const { authentication, google } = makeAuthentication(persistence);
    const response = await authentication.start(
      new Request('https://preview.example.test/api/auth/google/start'),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'AUTH_UNAVAILABLE' });
    expect(persistence.cleanupCalls).toBe(0);
    expect(persistence.loginStates.size).toBe(0);
    expect(google.authorizationInputs).toEqual([]);
  });

  it('rejects a callback delivered on another origin before consuming its transaction', async () => {
    const persistence = new FakePersistence();
    const { authentication, google } = makeAuthentication(persistence);
    const login = await startLogin(authentication);
    const response = await authentication.callback(
      new Request(
        `https://preview.example.test/api/auth/google/callback?state=${login.state}&code=authorization-code`,
        { headers: { cookie: cookieHeader([LOGIN_COOKIE_NAME, login.login]) } },
      ),
    );
    await expectCallbackFailure(response, 'unavailable');
    expect([...persistence.loginStates.values()][0]?.consumed).toBe(false);
    expect(google.exchangeInputs).toEqual([]);
  });

  it('fails closed before creating a transaction when bounded cleanup fails', async () => {
    const persistence = new FakePersistence();
    persistence.unavailable = true;
    const { authentication, google } = makeAuthentication(persistence);
    const response = await authentication.start(new Request(`${APP_ORIGIN}/api/auth/google/start`));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'AUTH_UNAVAILABLE' });
    expect(persistence.loginStates.size).toBe(0);
    expect(google.authorizationInputs).toEqual([]);
  });

  it('does not persist callback secrets when authorization URL creation fails', async () => {
    const persistence = new FakePersistence();
    const google = new FakeGoogle();
    google.failAuthorization = true;
    const { authentication, logs } = makeAuthentication(persistence, google);
    const response = await authentication.start(new Request(`${APP_ORIGIN}/api/auth/google/start`));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'AUTH_UNAVAILABLE' });
    expect(persistence.cleanupCalls).toBe(1);
    expect(persistence.loginStates.size).toBe(0);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(JSON.stringify(logs)).not.toContain('PRIVATE_AUTHORIZATION_ADAPTER_FAILURE');
  });

  it('overwrites a malformed predecessor cookie during a valid fresh login', async () => {
    const persistence = new FakePersistence();
    const { authentication } = makeAuthentication(persistence);
    const login = await startLogin(authentication);
    const callback = new URL(`${APP_ORIGIN}/api/auth/google/callback`);
    callback.searchParams.set('state', login.state);
    callback.searchParams.set('code', 'authorization-code');
    const response = await authentication.callback(
      new Request(callback, {
        headers: {
          cookie: cookieHeader(
            [LOGIN_COOKIE_NAME, login.login],
            [SESSION_COOKIE_NAME, 'malformed'],
            [CSRF_COOKIE_NAME, 'also-malformed'],
          ),
        },
      }),
    );
    expect(response.status).toBe(303);
    expect(readCookie(response, SESSION_COOKIE_NAME)).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(readCookie(response, CSRF_COOKIE_NAME)).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(response.headers.get('set-cookie')).toContain(`${LOGIN_COOKIE_NAME}=;`);
  });

  it('creates an opaque session, does not touch GET activity, and consumes callback once', async () => {
    const persistence = new FakePersistence();
    const { authentication, google } = makeAuthentication(persistence);
    const login = await startLogin(authentication);
    const callback = new URL(`${APP_ORIGIN}/api/auth/google/callback`);
    callback.searchParams.set('state', login.state);
    callback.searchParams.set('code', 'authorization-code');
    const success = await authentication.callback(
      new Request(callback, {
        headers: { cookie: cookieHeader([LOGIN_COOKIE_NAME, login.login]) },
      }),
    );
    expect(success.status).toBe(303);
    expect(success.headers.get('location')).toBe('/');
    expect(success.headers.get('cache-control')).toBe('private, no-store');
    expect(success.headers.get('referrer-policy')).toBe('no-referrer');
    expect(success.headers.get('set-cookie')).toContain(`${LOGIN_COOKIE_NAME}=;`);
    const session = readCookie(success, SESSION_COOKIE_NAME);
    expect(sha256(session)).not.toBe(session);
    expect(google.exchangeInputs[0]?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const before = [...persistence.sessionsById.values()][0]?.lastActivityAt.getTime();
    const current = await authentication.getSession(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, session]) },
      }),
    );
    expect(current.status).toBe(200);
    expect(await current.json()).toEqual({
      userId: USER_ID,
      verifiedGoogleEmail: 'person@example.test',
      adoption: { status: 'pending', capability: true },
    });
    expect([...persistence.sessionsById.values()][0]?.lastActivityAt.getTime()).toBe(before);
    expect(persistence.touchCalls).toBe(0);

    const replay = await authentication.callback(
      new Request(callback, {
        headers: { cookie: cookieHeader([LOGIN_COOKIE_NAME, login.login]) },
      }),
    );
    await expectCallbackFailure(replay, 'failed');
  });

  it('projects accepted and declined adoption status without exposing storage fields', async () => {
    const persistence = new FakePersistence();
    const { authentication } = makeAuthentication(persistence);
    const login = await startLogin(authentication);
    const callback = new URL(`${APP_ORIGIN}/api/auth/google/callback`);
    callback.searchParams.set('state', login.state);
    callback.searchParams.set('code', 'authorization-code');
    const signedIn = await authentication.callback(
      new Request(callback, {
        headers: { cookie: cookieHeader([LOGIN_COOKIE_NAME, login.login]) },
      }),
    );
    const session = readCookie(signedIn, SESSION_COOKIE_NAME);

    const acceptedStatus = makeAcceptedAdoptionStatus();
    Object.defineProperty(acceptedStatus, 'requestDigest', { value: 'SECRET_DIGEST' });
    Object.defineProperty(acceptedStatus.completion, 'requestDigest', {
      value: 'SECRET_COMPLETION_DIGEST',
    });
    Object.defineProperty(acceptedStatus.completion, 'sessionId', { value: 'SECRET_SESSION_ID' });
    persistence.adoptionStatusOverride = acceptedStatus;
    const accepted = await authentication.getSession(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, session]) },
      }),
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({
      userId: USER_ID,
      verifiedGoogleEmail: 'person@example.test',
      adoption: {
        status: 'accepted',
        capability: false,
        completion: {
          decision: 'yes',
          requestId: '00000000-0000-4000-8000-000000000099',
          acknowledgedRevision: '1',
          timestamp: '2026-09-11T10:00:00.000Z',
        },
      },
    });

    persistence.adoptionStatusOverride = {
      status: 'declined',
      capability: false,
      completion: {
        decision: 'no',
        requestId: '00000000-0000-4000-8000-000000000098',
      },
    };
    const declined = await authentication.getSession(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, session]) },
      }),
    );
    expect(declined.status).toBe(200);
    expect(await declined.json()).toEqual({
      userId: USER_ID,
      verifiedGoogleEmail: 'person@example.test',
      adoption: {
        status: 'declined',
        capability: false,
        completion: {
          decision: 'no',
          requestId: '00000000-0000-4000-8000-000000000098',
        },
      },
    });
  });

  it('fails with a fixed 503 when the adoption adapter returns malformed status', async () => {
    const persistence = new FakePersistence();
    const { authentication } = makeAuthentication(persistence);
    const login = await startLogin(authentication);
    const callback = new URL(`${APP_ORIGIN}/api/auth/google/callback`);
    callback.searchParams.set('state', login.state);
    callback.searchParams.set('code', 'authorization-code');
    const signedIn = await authentication.callback(
      new Request(callback, {
        headers: { cookie: cookieHeader([LOGIN_COOKIE_NAME, login.login]) },
      }),
    );
    const session = readCookie(signedIn, SESSION_COOKIE_NAME);
    persistence.malformedAdoptionStatus = true;

    const response = await authentication.getSession(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, session]) },
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ error: 'AUTH_UNAVAILABLE' });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('rejects missing or duplicate callback security parameters and consumes provider denial safely', async () => {
    const persistence = new FakePersistence();
    const { authentication, google } = makeAuthentication(persistence);
    const missing = await startLogin(authentication);
    const missingState = await authentication.callback(
      new Request(`${APP_ORIGIN}/api/auth/google/callback?code=authorization-code`, {
        headers: { cookie: cookieHeader([LOGIN_COOKIE_NAME, missing.login]) },
      }),
    );
    await expectCallbackFailure(missingState, 'failed');

    const duplicate = await startLogin(authentication);
    const duplicateStateUrl = new URL(`${APP_ORIGIN}/api/auth/google/callback`);
    duplicateStateUrl.searchParams.append('state', duplicate.state);
    duplicateStateUrl.searchParams.append('state', duplicate.state);
    duplicateStateUrl.searchParams.set('code', 'authorization-code');
    const duplicateState = await authentication.callback(
      new Request(duplicateStateUrl, {
        headers: { cookie: cookieHeader([LOGIN_COOKIE_NAME, duplicate.login]) },
      }),
    );
    await expectCallbackFailure(duplicateState, 'failed');

    const denied = await startLogin(authentication);
    const deniedUrl = new URL(`${APP_ORIGIN}/api/auth/google/callback`);
    deniedUrl.searchParams.set('state', denied.state);
    deniedUrl.searchParams.set('error', 'access_denied');
    const denialResponse = await authentication.callback(
      new Request(deniedUrl, {
        headers: { cookie: cookieHeader([LOGIN_COOKIE_NAME, denied.login]) },
      }),
    );
    await expectCallbackFailure(denialResponse, 'cancelled');
    expect(google.exchangeInputs).toHaveLength(0);
    const consumedDenial = [...persistence.loginStates.values()].find(
      (state) => state.receipt.id === 'transaction-3',
    );
    expect(consumedDenial?.consumed).toBe(true);
  });

  it('rejects browser binding mismatches and forged or revoked sessions', async () => {
    const persistence = new FakePersistence();
    const { authentication } = makeAuthentication(persistence);
    const login = await startLogin(authentication);
    const callback = new URL(`${APP_ORIGIN}/api/auth/google/callback`);
    callback.searchParams.set('state', login.state);
    callback.searchParams.set('code', 'authorization-code');
    const mismatch = await authentication.callback(
      new Request(callback, {
        headers: {
          cookie: cookieHeader([LOGIN_COOKIE_NAME, Buffer.alloc(32, 8).toString('base64url')]),
        },
      }),
    );
    await expectCallbackFailure(mismatch, 'failed');

    const fresh = await startLogin(authentication);
    const freshCallback = new URL(`${APP_ORIGIN}/api/auth/google/callback`);
    freshCallback.searchParams.set('state', fresh.state);
    freshCallback.searchParams.set('code', 'authorization-code');
    const signedIn = await authentication.callback(
      new Request(freshCallback, {
        headers: { cookie: cookieHeader([LOGIN_COOKIE_NAME, fresh.login]) },
      }),
    );
    const session = readCookie(signedIn, SESSION_COOKIE_NAME);
    const forged = await authentication.getSession(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: {
          cookie: cookieHeader([SESSION_COOKIE_NAME, Buffer.alloc(32, 9).toString('base64url')]),
        },
      }),
    );
    expect(forged.status).toBe(401);
    expect(forged.headers.get('set-cookie')).toContain(`${SESSION_COOKIE_NAME}=;`);

    const csrf = readCookie(signedIn, CSRF_COOKIE_NAME);
    const logout = await authentication.logout(
      new Request(`${APP_ORIGIN}/api/session`, {
        method: 'DELETE',
        headers: {
          origin: APP_ORIGIN,
          cookie: cookieHeader([SESSION_COOKIE_NAME, session], [CSRF_COOKIE_NAME, csrf]),
          'x-csrf-token': csrf,
        },
      }),
    );
    expect(logout.status).toBe(204);
    const revoked = await authentication.getSession(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, session]) },
      }),
    );
    expect(revoked.status).toBe(401);
  });

  it('requires exact Origin and CSRF for logout and preserves cookies on database failure', async () => {
    const persistence = new FakePersistence();
    const { authentication } = makeAuthentication(persistence);
    const login = await startLogin(authentication);
    const callback = new URL(`${APP_ORIGIN}/api/auth/google/callback`);
    callback.searchParams.set('state', login.state);
    callback.searchParams.set('code', 'authorization-code');
    const success = await authentication.callback(
      new Request(callback, {
        headers: { cookie: cookieHeader([LOGIN_COOKIE_NAME, login.login]) },
      }),
    );
    const session = readCookie(success, SESSION_COOKIE_NAME);
    const csrf = readCookie(success, CSRF_COOKIE_NAME);
    const wrongOrigin = await authentication.logout(
      new Request(`${APP_ORIGIN}/api/session`, {
        method: 'DELETE',
        headers: {
          origin: 'https://evil.example.test',
          cookie: cookieHeader([SESSION_COOKIE_NAME, session], [CSRF_COOKIE_NAME, csrf]),
          'x-csrf-token': csrf,
        },
      }),
    );
    expect(wrongOrigin.status).toBe(403);
    const wrongCsrf = await authentication.logout(
      new Request(`${APP_ORIGIN}/api/session`, {
        method: 'DELETE',
        headers: {
          origin: APP_ORIGIN,
          cookie: cookieHeader(
            [SESSION_COOKIE_NAME, session],
            [CSRF_COOKIE_NAME, Buffer.alloc(32, 8).toString('base64url')],
          ),
          'x-csrf-token': Buffer.alloc(32, 8).toString('base64url'),
        },
      }),
    );
    expect(wrongCsrf.status).toBe(403);
    persistence.unavailable = true;
    const unavailable = await authentication.getSession(
      new Request(`${APP_ORIGIN}/api/session`, {
        headers: { cookie: cookieHeader([SESSION_COOKIE_NAME, session]) },
      }),
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get('set-cookie')).toBeNull();
  });

  it('consumes a browser-bound transaction before exchange failure and clears only login state', async () => {
    const persistence = new FakePersistence();
    const google = new FakeGoogle();
    google.failExchange = true;
    const { authentication } = makeAuthentication(persistence, google);
    const login = await startLogin(authentication);
    const callback = new URL(`${APP_ORIGIN}/api/auth/google/callback`);
    callback.searchParams.set('state', login.state);
    callback.searchParams.set('code', 'authorization-code');

    const response = await authentication.callback(
      new Request(callback, {
        headers: { cookie: cookieHeader([LOGIN_COOKIE_NAME, login.login]) },
      }),
    );

    await expectCallbackFailure(response, 'failed');
    expect([...persistence.loginStates.values()][0]?.consumed).toBe(true);
    expect(persistence.sessionsById.size).toBe(0);
  });

  it('maps temporary provider denial to an unavailable redirect after consumption', async () => {
    const persistence = new FakePersistence();
    const { authentication, google } = makeAuthentication(persistence);
    const login = await startLogin(authentication);
    const callback = new URL(`${APP_ORIGIN}/api/auth/google/callback`);
    callback.searchParams.set('state', login.state);
    callback.searchParams.set('error', 'temporarily_unavailable');

    const response = await authentication.callback(
      new Request(callback, {
        headers: { cookie: cookieHeader([LOGIN_COOKIE_NAME, login.login]) },
      }),
    );

    await expectCallbackFailure(response, 'unavailable');
    expect([...persistence.loginStates.values()][0]?.consumed).toBe(true);
    expect(google.exchangeInputs).toHaveLength(0);
  });

  it('never consumes another browser transaction when the binding is missing or mismatched', async () => {
    const persistence = new FakePersistence();
    const { authentication } = makeAuthentication(persistence);
    const first = await startLogin(authentication);
    const second = await startLogin(authentication);
    const callback = new URL(`${APP_ORIGIN}/api/auth/google/callback`);
    callback.searchParams.set('state', second.state);
    callback.searchParams.set('code', 'authorization-code');

    const mismatched = await authentication.callback(
      new Request(callback, {
        headers: { cookie: cookieHeader([LOGIN_COOKIE_NAME, first.login]) },
      }),
    );
    await expectCallbackFailure(mismatched, 'failed');
    expect([...persistence.loginStates.values()].every((state) => !state.consumed)).toBe(true);

    const missingBinding = await authentication.callback(new Request(callback));
    await expectCallbackFailure(missingBinding, 'failed');
    expect([...persistence.loginStates.values()].every((state) => !state.consumed)).toBe(true);
  });

  it('maps unavailable callback persistence to a fixed redirect without claiming consumption', async () => {
    const persistence = new FakePersistence();
    const { authentication } = makeAuthentication(persistence);
    const login = await startLogin(authentication);
    persistence.unavailable = true;
    const callback = new URL(`${APP_ORIGIN}/api/auth/google/callback`);
    callback.searchParams.set('state', login.state);
    callback.searchParams.set('code', 'authorization-code');

    const response = await authentication.callback(
      new Request(callback, {
        headers: { cookie: cookieHeader([LOGIN_COOKIE_NAME, login.login]) },
      }),
    );

    await expectCallbackFailure(response, 'unavailable');
    expect([...persistence.loginStates.values()][0]?.consumed).toBe(false);
  });
});
