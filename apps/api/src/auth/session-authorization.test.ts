import { describe, expect, it, vi } from 'vitest';

import type {
  KendoPersistence,
  SessionLookupInput,
  SessionRecord,
} from '../persistence/contracts.js';
import {
  CSRF_COOKIE_NAME,
  LOGIN_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  type AuthenticationLogEntry,
} from './contracts.js';
import {
  createSessionAuthorization,
  sessionAuthorizationFailureResponse,
} from './session-authorization.js';
import { MAX_COOKIE_HEADER_LENGTH, sha256 } from './security.js';

const ORIGIN = 'https://app.example.test';
const NOW = new Date('2026-09-12T10:00:00.000Z');
const USER_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-000000000002';
const TOKEN = Buffer.alloc(32, 1).toString('base64url');
const CSRF = Buffer.alloc(32, 2).toString('base64url');
const OTHER = Buffer.alloc(32, 3).toString('base64url');

const activeSession: SessionRecord = {
  id: SESSION_ID,
  userId: USER_ID,
  createdAt: NOW,
  lastActivityAt: NOW,
  idleExpiresAt: new Date(NOW.getTime() + 7 * 86_400_000),
  absoluteExpiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
  revokedAt: null,
};

function sessionCookie(token = TOKEN): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function writeRequest(
  origin = ORIGIN,
  session = TOKEN,
  csrfCookie: string | null | undefined = CSRF,
  csrfHeader: string | null | undefined = CSRF,
): Request {
  const cookies = [sessionCookie(session)];
  if (csrfCookie !== undefined && csrfCookie !== null) {
    cookies.push(`${CSRF_COOKIE_NAME}=${csrfCookie}`);
  }
  const headers = new Headers({ cookie: cookies.join('; ') });
  if (origin !== null) headers.set('origin', origin);
  if (csrfHeader !== undefined && csrfHeader !== null) {
    headers.set('x-csrf-token', csrfHeader);
  }
  return new Request(`${ORIGIN}/api/dashboard`, { method: 'PUT', headers });
}

function writeRequestWithCookieHeader(
  cookie: string,
  origin: string | null = ORIGIN,
  csrfHeader: string | null = CSRF,
): Request {
  const headers = new Headers({ cookie });
  if (origin !== null) headers.set('origin', origin);
  if (csrfHeader !== null) headers.set('x-csrf-token', csrfHeader);
  return new Request(`${ORIGIN}/api/dashboard`, { method: 'PUT', headers });
}

function readRequest(token = TOKEN): Request {
  return new Request(`${ORIGIN}/api/dashboard`, {
    headers: { cookie: sessionCookie(token) },
  });
}

function makeAuthorization(
  options: {
    readonly session?: SessionRecord | null;
    readonly matchedSession?: SessionRecord | null;
    readonly csrfHashMatches?: boolean;
    readonly origin?: string | Promise<string>;
    readonly persistence?: KendoPersistence;
  } = {},
) {
  const lookup = vi.fn((input: SessionLookupInput): Promise<SessionRecord | null> => {
    if (input.sessionTokenHash !== sha256(TOKEN)) return Promise.resolve(null);
    if (input.csrfTokenHash !== undefined && !options.csrfHashMatches) {
      return Promise.resolve(null);
    }
    if (input.csrfTokenHash !== undefined && options.matchedSession !== undefined) {
      return Promise.resolve(options.matchedSession);
    }
    return Promise.resolve(options.session === undefined ? activeSession : options.session);
  });
  const forbidden = (): Promise<never> =>
    Promise.reject(new Error('UNEXPECTED_PERSISTENCE_OPERATION'));
  const persistence: KendoPersistence = options.persistence ?? {
    users: {
      findPublicById: () => Promise.resolve(null),
      resolveByGoogleSubject: forbidden,
    },
    loginTransactions: {
      create: forbidden,
      consume: forbidden,
      cleanupExpired: forbidden,
    },
    sessions: {
      create: forbidden,
      replace: forbidden,
      findActiveByTokenHash: lookup,
      touch: forbidden,
      revoke: forbidden,
    },
  };
  const provider = vi.fn(() => persistence);
  const logs: AuthenticationLogEntry[] = [];
  const authorization = createSessionAuthorization({
    persistence: provider,
    getAppOrigin: () => options.origin ?? ORIGIN,
    clock: () => NOW,
    randomBytes: (size) => new Uint8Array(size).fill(9),
    logger: { log: (entry) => logs.push(entry) },
  });
  return { authorization, lookup, provider, logs };
}

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  await expect(response.json()).resolves.toEqual({ error: code });
}

describe('session authorization', () => {
  describe.each(['read', 'write'] as const)('protected %s cookie isolation', (mode) => {
    function authorize(cookie: string) {
      const h = makeAuthorization({ csrfHashMatches: true });
      const request =
        mode === 'read'
          ? new Request(`${ORIGIN}/api/dashboard`, { headers: { cookie } })
          : writeRequestWithCookieHeader(cookie);
      return {
        h,
        result:
          mode === 'read'
            ? h.authorization.authorizeRead(request)
            : h.authorization.authorizeWrite(request),
      };
    }

    it.each([
      { label: 'unrelated 513-character value', fragment: `analytics=${'x'.repeat(513)}` },
      {
        label: 'duplicate login cookies',
        fragment: `${LOGIN_COOKIE_NAME}=first; ${LOGIN_COOKIE_NAME}=second`,
      },
      { label: 'overlong login cookie', fragment: `${LOGIN_COOKIE_NAME}=${'x'.repeat(513)}` },
      { label: 'malformed login fragment', fragment: LOGIN_COOKIE_NAME },
      { label: 'malformed login name', fragment: `${LOGIN_COOKIE_NAME} junk=value` },
      { label: 'empty login cookie', fragment: `${LOGIN_COOKIE_NAME}=` },
      {
        label: 'malformed unrelated fragments',
        fragment: 'unrelated-fragment; =orphan; ; broken name=value',
      },
      {
        label: 'different names with credential prefixes',
        fragment: `${SESSION_COOKIE_NAME}-other=bad; ${CSRF_COOKIE_NAME}-other=bad`,
      },
    ])('ignores $label', async ({ fragment }) => {
      const { h, result } = authorize(
        `${fragment}; ${sessionCookie()}; ${CSRF_COOKIE_NAME}=${CSRF}; ${fragment}`,
      );
      const authorization = await result;
      expect(authorization.status).toBe('authorized');
      if (authorization.status !== 'authorized') throw new Error('EXPECTED_AUTHORIZED');
      expect(authorization.proof).toMatchObject({
        userId: USER_ID,
        sessionId: SESSION_ID,
        sessionTokenHash: sha256(TOKEN),
      });
      expect(authorization.proof.csrfTokenHash).toBe(mode === 'write' ? sha256(CSRF) : undefined);
      expect(h.lookup).toHaveBeenCalledTimes(mode === 'write' ? 2 : 1);
      expect(h.lookup).toHaveBeenNthCalledWith(1, { sessionTokenHash: sha256(TOKEN), at: NOW });
      if (mode === 'write')
        expect(h.lookup).toHaveBeenNthCalledWith(2, {
          sessionTokenHash: sha256(TOKEN),
          csrfTokenHash: sha256(CSRF),
          at: NOW,
        });
      expect(h.logs).toEqual([]);
    });

    it.each([
      { label: 'duplicate session', fragment: `${sessionCookie()}; ${sessionCookie()}` },
      { label: 'overlong session', fragment: `${SESSION_COOKIE_NAME}=${'x'.repeat(513)}` },
      { label: 'session missing equals', fragment: `${SESSION_COOKIE_NAME}; ${sessionCookie()}` },
      {
        label: 'malformed session name',
        fragment: `${SESSION_COOKIE_NAME} junk=value; ${sessionCookie()}`,
      },
      { label: 'empty session', fragment: `${SESSION_COOKIE_NAME}=` },
      { label: 'malformed session value', fragment: `${SESSION_COOKIE_NAME}=not-a-token` },
    ])('rejects $label before persistence', async ({ fragment }) => {
      const { h, result } = authorize(`${fragment}; ${CSRF_COOKIE_NAME}=${CSRF}`);
      const authorization = await result;
      expect(authorization.status).toBe('rejected');
      if (authorization.status !== 'rejected') throw new Error('EXPECTED_REJECTION');
      await expectError(authorization.response, 401, 'UNAUTHENTICATED');
      expect(authorization.response.headers.getSetCookie()).toEqual([
        expect.stringContaining(`${SESSION_COOKIE_NAME}=;`),
        expect.stringContaining(`${CSRF_COOKIE_NAME}=;`),
      ]);
      expect(h.provider).not.toHaveBeenCalled();
      expect(h.lookup).not.toHaveBeenCalled();
    });

    it.each([
      {
        label: 'duplicate CSRF',
        fragment: `${CSRF_COOKIE_NAME}=${CSRF}; ${CSRF_COOKIE_NAME}=${OTHER}`,
      },
      { label: 'overlong CSRF', fragment: `${CSRF_COOKIE_NAME}=${'x'.repeat(513)}` },
      {
        label: 'CSRF missing equals',
        fragment: `${CSRF_COOKIE_NAME}; ${CSRF_COOKIE_NAME}=${CSRF}`,
      },
      {
        label: 'malformed CSRF name',
        fragment: `${CSRF_COOKIE_NAME} junk=value; ${CSRF_COOKIE_NAME}=${CSRF}`,
      },
      { label: 'empty CSRF', fragment: `${CSRF_COOKIE_NAME}=` },
      { label: 'malformed CSRF value', fragment: `${CSRF_COOKIE_NAME}=not-a-token` },
    ])('retains session authentication with $label but forbids writes', async ({ fragment }) => {
      const { h, result } = authorize(`${sessionCookie()}; ${fragment}`);
      const authorization = await result;
      if (mode === 'read') {
        expect(authorization.status).toBe('authorized');
      } else {
        expect(authorization.status).toBe('rejected');
        if (authorization.status !== 'rejected') throw new Error('EXPECTED_REJECTION');
        await expectError(authorization.response, 403, 'FORBIDDEN');
        expect(authorization.response.headers.getSetCookie()).toEqual([]);
      }
      expect(h.lookup).toHaveBeenCalledExactlyOnceWith({
        sessionTokenHash: sha256(TOKEN),
        at: NOW,
      });
    });

    it.each(['oversized header', 'control character'])(
      'still rejects %s before persistence',
      async (label) => {
        const base = `${sessionCookie()}; ${CSRF_COOKIE_NAME}=${CSRF}; unrelated=`;
        const cookie =
          label === 'oversized header'
            ? base + 'x'.repeat(MAX_COOKIE_HEADER_LENGTH + 1 - base.length)
            : base + '\u007f';
        const { h, result } = authorize(cookie);
        const authorization = await result;
        expect(authorization.status).toBe('rejected');
        if (authorization.status !== 'rejected') throw new Error('EXPECTED_REJECTION');
        await expectError(authorization.response, 401, 'UNAUTHENTICATED');
        expect(authorization.response.headers.getSetCookie()).toHaveLength(2);
        expect(h.lookup).not.toHaveBeenCalled();
      },
    );
  });

  it('returns a frozen read proof without touching activity or resolving app origin', async () => {
    const h = makeAuthorization();
    const result = await h.authorization.authorizeRead(readRequest());

    expect(result.status).toBe('authorized');
    if (result.status !== 'authorized') throw new Error('EXPECTED_AUTHORIZED');
    expect(result.proof.userId).toBe(USER_ID);
    expect(result.proof.sessionId).toBe(SESSION_ID);
    expect(result.proof.sessionTokenHash).toBe(sha256(TOKEN));
    expect(result.proof.csrfTokenHash).toBeUndefined();
    expect(Object.isFrozen(result.proof)).toBe(true);
    expect(h.provider).toHaveBeenCalledOnce();
    expect(h.lookup).toHaveBeenCalledExactlyOnceWith({
      sessionTokenHash: sha256(TOKEN),
      at: NOW,
    });
  });

  it('rejects malformed credentials before persistence and clears both cookies', async () => {
    const h = makeAuthorization();
    const result = await h.authorization.authorizeRead(readRequest('malformed'));

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('EXPECTED_REJECTION');
    await expectError(result.response, 401, 'UNAUTHENTICATED');
    expect(result.response.headers.getSetCookie()).toEqual([
      expect.stringContaining(`${SESSION_COOKIE_NAME}=;`),
      expect.stringContaining(`${CSRF_COOKIE_NAME}=;`),
    ]);
    expect(h.provider).not.toHaveBeenCalled();
    expect(h.logs[0]?.code).toBe('AUTH_INPUT_REJECTED');
  });

  it('rejects a missing session before persistence or Origin configuration lookup', async () => {
    const h = makeAuthorization({ origin: 'not-an-origin' });
    const result = await h.authorization.authorizeWrite(
      new Request(`${ORIGIN}/api/dashboard`, { method: 'PUT' }),
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('EXPECTED_REJECTION');
    await expectError(result.response, 401, 'UNAUTHENTICATED');
    expect(h.provider).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'missing', session: null },
    { label: 'expired or revoked', session: null },
  ])('maps an absent active %s session to 401 and clears cookies', async ({ session }) => {
    const h = makeAuthorization({ session });
    const result = await h.authorization.authorizeRead(readRequest());

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('EXPECTED_REJECTION');
    await expectError(result.response, 401, 'UNAUTHENTICATED');
    expect(h.logs[0]?.code).toBe('AUTH_SESSION_REJECTED');
  });

  it('fails closed when an adapter returns an invalid active-session record', async () => {
    const h = makeAuthorization({ session: { ...activeSession, revokedAt: NOW } });
    const result = await h.authorization.authorizeRead(readRequest());

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('EXPECTED_REJECTION');
    await expectError(result.response, 503, 'AUTH_UNAVAILABLE');
    expect(result.response.headers.getSetCookie()).toEqual([]);
  });

  it('maps hostile session dates to a fixed unavailable response', async () => {
    const hostileDate = new Proxy(new Date(NOW), {});
    const h = makeAuthorization({ session: { ...activeSession, idleExpiresAt: hostileDate } });
    const result = await h.authorization.authorizeRead(readRequest());

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('EXPECTED_REJECTION');
    await expectError(result.response, 503, 'AUTH_UNAVAILABLE');
    expect(result.response.headers.getSetCookie()).toEqual([]);
  });

  it('maps storage failure to 503 and preserves potentially valid cookies', async () => {
    const forbidden = (): Promise<never> =>
      Promise.reject(new Error('UNEXPECTED_PERSISTENCE_OPERATION'));
    const failingPersistence: KendoPersistence = {
      users: { findPublicById: forbidden, resolveByGoogleSubject: forbidden },
      loginTransactions: {
        create: forbidden,
        consume: forbidden,
        cleanupExpired: forbidden,
      },
      sessions: {
        create: forbidden,
        replace: forbidden,
        findActiveByTokenHash: (_input: SessionLookupInput): Promise<SessionRecord | null> =>
          Promise.reject(new Error('PRIVATE_DATABASE_FAILURE')),
        touch: forbidden,
        revoke: forbidden,
      },
    };
    const h = makeAuthorization({ persistence: failingPersistence });
    const result = await h.authorization.authorizeRead(readRequest());

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('EXPECTED_REJECTION');
    await expectError(result.response, 503, 'AUTH_UNAVAILABLE');
    expect(result.response.headers.getSetCookie()).toEqual([]);
    expect(JSON.stringify(h.logs)).not.toContain('PRIVATE_DATABASE_FAILURE');
  });

  it.each([
    { label: 'wrong Origin', request: writeRequest('https://evil.example.test') },
    { label: 'missing CSRF cookie', request: writeRequest(ORIGIN, TOKEN, null, CSRF) },
    { label: 'missing CSRF header', request: writeRequest(ORIGIN, TOKEN, CSRF, null) },
    { label: 'mismatched CSRF values', request: writeRequest(ORIGIN, TOKEN, CSRF, OTHER) },
  ])(
    'rejects %s after read-only session authentication and preserves cookies',
    async ({ request }) => {
      const h = makeAuthorization();
      const result = await h.authorization.authorizeWrite(request);

      expect(result.status).toBe('rejected');
      if (result.status !== 'rejected') throw new Error('EXPECTED_REJECTION');
      await expectError(result.response, 403, 'FORBIDDEN');
      expect(result.response.headers.getSetCookie()).toEqual([]);
      expect(h.provider).toHaveBeenCalledOnce();
      expect(h.lookup).toHaveBeenCalledOnce();
    },
  );

  it.each([CSRF, OTHER])(
    'rejects duplicate CSRF cookies as forbidden while preserving the session',
    async (secondCsrf) => {
      const h = makeAuthorization({ csrfHashMatches: true });
      const request = writeRequestWithCookieHeader(
        `${sessionCookie()}; ${CSRF_COOKIE_NAME}=${CSRF}; ${CSRF_COOKIE_NAME}=${secondCsrf}`,
      );
      const result = await h.authorization.authorizeWrite(request);

      expect(result.status).toBe('rejected');
      if (result.status !== 'rejected') throw new Error('EXPECTED_REJECTION');
      await expectError(result.response, 403, 'FORBIDDEN');
      expect(result.response.headers.getSetCookie()).toEqual([]);
      expect(h.provider).toHaveBeenCalledOnce();
      expect(h.lookup).toHaveBeenCalledOnce();
    },
  );

  it('ignores duplicate CSRF cookies for a read after authenticating the session', async () => {
    const h = makeAuthorization();
    const result = await h.authorization.authorizeRead(
      new Request(`${ORIGIN}/api/dashboard`, {
        headers: {
          cookie: `${sessionCookie()}; ${CSRF_COOKIE_NAME}=${CSRF}; ${CSRF_COOKIE_NAME}=${OTHER}`,
        },
      }),
    );

    expect(result.status).toBe('authorized');
    expect(h.provider).toHaveBeenCalledOnce();
    expect(h.lookup).toHaveBeenCalledOnce();
  });

  it('keeps duplicate session cookies on the invalid-session 401 path', async () => {
    const h = makeAuthorization();
    const result = await h.authorization.authorizeRead(
      new Request(`${ORIGIN}/api/dashboard`, {
        headers: {
          cookie: `${sessionCookie()}; ${sessionCookie()}; ${CSRF_COOKIE_NAME}=${CSRF}`,
        },
      }),
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('EXPECTED_REJECTION');
    await expectError(result.response, 401, 'UNAUTHENTICATED');
    expect(result.response.headers.getSetCookie()).toHaveLength(2);
    expect(h.provider).not.toHaveBeenCalled();
  });

  it.each([undefined, 'malformed'])(
    'gives invalid session priority over CSRF ambiguity: %s',
    async (session) => {
      const sessionPart = session === undefined ? '' : `${SESSION_COOKIE_NAME}=${session}; `;
      const h = makeAuthorization();
      const result = await h.authorization.authorizeWrite(
        writeRequestWithCookieHeader(
          `${sessionPart}${CSRF_COOKIE_NAME}=${CSRF}; ${CSRF_COOKIE_NAME}=${OTHER}`,
        ),
      );

      expect(result.status).toBe('rejected');
      if (result.status !== 'rejected') throw new Error('EXPECTED_REJECTION');
      await expectError(result.response, 401, 'UNAUTHENTICATED');
      expect(result.response.headers.getSetCookie()).toHaveLength(2);
      expect(h.provider).not.toHaveBeenCalled();
    },
  );

  it('binds the write proof to the active session CSRF hash', async () => {
    const h = makeAuthorization({ csrfHashMatches: true });
    const result = await h.authorization.authorizeWrite(writeRequest());

    expect(result.status).toBe('authorized');
    if (result.status !== 'authorized') throw new Error('EXPECTED_AUTHORIZED');
    expect(result.proof.userId).toBe(USER_ID);
    expect(result.proof.sessionId).toBe(SESSION_ID);
    expect(result.proof.csrfTokenHash).toBe(sha256(CSRF));
    expect(h.lookup).toHaveBeenNthCalledWith(1, {
      sessionTokenHash: sha256(TOKEN),
      at: NOW,
    });
    expect(h.lookup).toHaveBeenNthCalledWith(2, {
      sessionTokenHash: sha256(TOKEN),
      csrfTokenHash: sha256(CSRF),
      at: NOW,
    });
  });

  it('rejects a valid session with a CSRF hash that belongs to another credential', async () => {
    const h = makeAuthorization({ csrfHashMatches: false });
    const result = await h.authorization.authorizeWrite(writeRequest());

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('EXPECTED_REJECTION');
    await expectError(result.response, 403, 'FORBIDDEN');
    expect(result.response.headers.getSetCookie()).toEqual([]);
  });

  it('fails closed when the CSRF-bound lookup changes the authenticated account', async () => {
    const h = makeAuthorization({
      csrfHashMatches: true,
      matchedSession: {
        ...activeSession,
        userId: '00000000-0000-4000-8000-000000000003',
      },
    });
    const result = await h.authorization.authorizeWrite(writeRequest());

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('EXPECTED_REJECTION');
    await expectError(result.response, 503, 'AUTH_UNAVAILABLE');
    expect(result.response.headers.getSetCookie()).toEqual([]);
    expect(h.lookup).toHaveBeenCalledTimes(2);
    expect(h.logs[0]?.code).toBe('AUTH_PERSISTENCE_FAILED');
  });

  it('maps invalid app-origin configuration to 503 after session authentication', async () => {
    const h = makeAuthorization({ origin: 'not-an-origin' });
    const result = await h.authorization.authorizeWrite(writeRequest());

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('EXPECTED_REJECTION');
    await expectError(result.response, 503, 'AUTH_UNAVAILABLE');
    expect(result.response.headers.getSetCookie()).toEqual([]);
    expect(h.provider).toHaveBeenCalledOnce();
    expect(h.lookup).toHaveBeenCalledOnce();
  });

  it('builds fixed failures with the required cookie policy', () => {
    const unauthenticated = sessionAuthorizationFailureResponse('UNAUTHENTICATED');
    const forbidden = sessionAuthorizationFailureResponse('FORBIDDEN');
    const unavailable = sessionAuthorizationFailureResponse('AUTH_UNAVAILABLE');

    expect(unauthenticated.headers.getSetCookie()).toHaveLength(2);
    expect(forbidden.headers.getSetCookie()).toEqual([]);
    expect(unavailable.headers.getSetCookie()).toEqual([]);
  });
});
