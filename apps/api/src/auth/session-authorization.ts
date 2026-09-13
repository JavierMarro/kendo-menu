/**
 * Shared cookie-session authorization for protected application operations.
 *
 * This module is deliberately narrower than the Google sign-in orchestrator: it
 * parses the two browser credentials, validates the configured Origin and
 * session-bound CSRF proof for writes, and performs a read-only active-session
 * lookup. It never touches activity or renews cookies. Successful authorization
 * returns an internally branded proof so later persistence can revalidate the
 * same session and account without trusting a client-supplied identity.
 */
import {
  PersistenceError,
  type KendoPersistence,
  type Sha256Hash,
  type SessionRecord,
  type SessionId,
  type UserId,
} from '../persistence/contracts.js';
import {
  AUTHENTICATION_ERROR_CODES,
  type AuthenticationInternalCode,
  type AuthenticationLogger,
  type AuthenticationPersistenceProvider,
  type Clock,
  type SecureRandomBytes,
} from './contracts.js';
import {
  AuthenticationUnavailable,
  InvalidAuthenticationInput,
  clearSessionCookies,
  defaultClock,
  defaultSecureRandomBytes,
  hasControlCharacters,
  logSafe,
  makeJsonResponse,
  makeResponseHeaders,
  parseSessionAuthorizationCookies,
  readClock,
  sha256,
  type SessionAuthorizationCookies,
  validateAppOrigin,
  validateBase64UrlToken,
} from './security.js';

const JSON_STATUS_UNAUTHENTICATED = 401;
const JSON_STATUS_FORBIDDEN = 403;
const JSON_STATUS_UNAVAILABLE = 503;

const sessionAuthorizationProofBrand: unique symbol = Symbol('SessionAuthorizationProof');

/**
 * The proof carried from cookie authentication into a protected application
 * operation. The private brand keeps callers from manufacturing an apparently
 * authenticated identity from client payload fields.
 */
export interface SessionAuthorizationProof {
  readonly userId: UserId;
  readonly sessionId: SessionId;
  readonly sessionTokenHash: Sha256Hash;
  readonly csrfTokenHash?: Sha256Hash;
  readonly [sessionAuthorizationProofBrand]: true;
}

export type SessionAuthorizationResult =
  | { readonly status: 'authorized'; readonly proof: SessionAuthorizationProof }
  | { readonly status: 'rejected'; readonly response: Response };

export interface SessionAuthorizationDependencies {
  readonly persistence: AuthenticationPersistenceProvider;
  readonly getAppOrigin: () => string | Promise<string>;
  readonly clock?: Clock;
  readonly randomBytes?: SecureRandomBytes;
  readonly logger?: AuthenticationLogger;
}

export type SessionAuthorizationFailureCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'AUTH_UNAVAILABLE';

export interface SessionAuthorization {
  authorizeRead(request: Request): Promise<SessionAuthorizationResult>;
  authorizeWrite(request: Request): Promise<SessionAuthorizationResult>;
}

async function resolvePersistence(
  provider: AuthenticationPersistenceProvider,
): Promise<KendoPersistence> {
  try {
    const persistence = typeof provider === 'function' ? await provider() : provider;
    if (typeof persistence !== 'object' || persistence === null) {
      throw new AuthenticationUnavailable();
    }
    return persistence;
  } catch (error) {
    if (error instanceof PersistenceError) {
      throw error;
    }
    throw new AuthenticationUnavailable();
  }
}

async function resolveAppOrigin(
  getter: SessionAuthorizationDependencies['getAppOrigin'],
): Promise<string> {
  try {
    return validateAppOrigin({ appOrigin: await getter() });
  } catch {
    throw new AuthenticationUnavailable();
  }
}

function exactOrigin(request: Request, appOrigin: string): boolean {
  const origin = request.headers.get('origin');
  return (
    origin !== null &&
    origin.length > 0 &&
    origin.length <= 2_048 &&
    !hasControlCharacters(origin) &&
    origin === appOrigin
  );
}

function readSessionToken(cookies: SessionAuthorizationCookies): string | undefined {
  if (cookies.session === undefined) {
    return undefined;
  }
  return validateBase64UrlToken(cookies.session);
}

function readCsrfToken(request: Request, cookies: SessionAuthorizationCookies): string {
  if (cookies.csrfAmbiguous) {
    throw new InvalidAuthenticationInput();
  }

  const cookie = cookies.csrf;
  const header = request.headers.get('x-csrf-token');
  if (cookie === undefined || header === null || header.length > 512) {
    throw new InvalidAuthenticationInput();
  }

  let csrfCookie: string;
  let csrfHeader: string;
  try {
    csrfCookie = validateBase64UrlToken(cookie);
    csrfHeader = validateBase64UrlToken(header);
  } catch {
    throw new InvalidAuthenticationInput();
  }

  if (csrfCookie !== csrfHeader) {
    throw new InvalidAuthenticationInput();
  }

  return csrfHeader;
}

function isCanonicalUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)
  );
}

function readFiniteDateMilliseconds(value: unknown): number | undefined {
  if (!(value instanceof Date)) return undefined;

  try {
    const milliseconds = Date.prototype.getTime.call(value);
    return Number.isFinite(milliseconds) ? milliseconds : undefined;
  } catch {
    return undefined;
  }
}

function readOwnProperty(value: object, property: string): unknown {
  try {
    return Object.getOwnPropertyDescriptor(value, property)?.value;
  } catch {
    return undefined;
  }
}

function isActiveSession(value: unknown, at: Date): value is SessionRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const id = readOwnProperty(value, 'id');
  const userId = readOwnProperty(value, 'userId');
  const createdAt = readOwnProperty(value, 'createdAt');
  const lastActivityAt = readOwnProperty(value, 'lastActivityAt');
  const idleExpiresAt = readOwnProperty(value, 'idleExpiresAt');
  const absoluteExpiresAt = readOwnProperty(value, 'absoluteExpiresAt');
  const revokedAt = readOwnProperty(value, 'revokedAt');
  const createdAtMilliseconds = readFiniteDateMilliseconds(createdAt);
  const lastActivityAtMilliseconds = readFiniteDateMilliseconds(lastActivityAt);
  const idleExpiresAtMilliseconds = readFiniteDateMilliseconds(idleExpiresAt);
  const absoluteExpiresAtMilliseconds = readFiniteDateMilliseconds(absoluteExpiresAt);
  if (
    !isCanonicalUuid(id) ||
    !isCanonicalUuid(userId) ||
    createdAtMilliseconds === undefined ||
    lastActivityAtMilliseconds === undefined ||
    idleExpiresAtMilliseconds === undefined ||
    absoluteExpiresAtMilliseconds === undefined ||
    revokedAt !== null
  ) {
    return false;
  }

  return (
    createdAtMilliseconds <= lastActivityAtMilliseconds &&
    lastActivityAtMilliseconds <= idleExpiresAtMilliseconds &&
    idleExpiresAtMilliseconds <= absoluteExpiresAtMilliseconds &&
    lastActivityAtMilliseconds <= at.getTime() &&
    createdAtMilliseconds <= at.getTime() &&
    idleExpiresAtMilliseconds > at.getTime() &&
    absoluteExpiresAtMilliseconds > at.getTime()
  );
}

function logFailure(
  dependencies: SessionAuthorizationDependencies,
  random: SecureRandomBytes,
  code: AuthenticationInternalCode,
): void {
  logSafe(dependencies.logger, random, code);
}

function persistenceFailureCode(error: unknown): AuthenticationInternalCode {
  if (error instanceof PersistenceError && error.code === 'UNAVAILABLE') {
    return 'AUTH_PERSISTENCE_UNAVAILABLE';
  }
  if (error instanceof AuthenticationUnavailable) {
    return 'AUTH_CONFIG_INVALID';
  }
  return 'AUTH_PERSISTENCE_FAILED';
}

function authorizedProof(
  session: SessionRecord,
  sessionTokenHash: string,
  csrfTokenHash: string | undefined,
): SessionAuthorizationProof {
  const proof: SessionAuthorizationProof = {
    userId: session.userId,
    sessionId: session.id,
    sessionTokenHash,
    ...(csrfTokenHash === undefined ? {} : { csrfTokenHash }),
    // The symbol is not exported; only this module can construct the proof.
    // The object is frozen before it crosses the authorization boundary.
    [sessionAuthorizationProofBrand]: true,
  };
  return Object.freeze(proof);
}

function reject(
  dependencies: SessionAuthorizationDependencies,
  random: SecureRandomBytes,
  code: SessionAuthorizationFailureCode,
  logCode?: AuthenticationInternalCode,
): SessionAuthorizationResult {
  if (logCode !== undefined) {
    logFailure(dependencies, random, logCode);
  }
  return { status: 'rejected', response: sessionAuthorizationFailureResponse(code) };
}

/** Build the fixed response used by authorization and transactional revalidation. */
export function sessionAuthorizationFailureResponse(
  code: SessionAuthorizationFailureCode,
): Response {
  if (code === 'UNAUTHENTICATED') {
    const headers = makeResponseHeaders();
    clearSessionCookies(headers);
    return makeJsonResponse(
      JSON_STATUS_UNAUTHENTICATED,
      AUTHENTICATION_ERROR_CODES.unauthenticated,
      headers,
    );
  }
  if (code === 'FORBIDDEN') {
    return makeJsonResponse(JSON_STATUS_FORBIDDEN, AUTHENTICATION_ERROR_CODES.forbidden);
  }
  return makeJsonResponse(JSON_STATUS_UNAVAILABLE, AUTHENTICATION_ERROR_CODES.unavailable);
}

export function createSessionAuthorization(
  dependencies: SessionAuthorizationDependencies,
): SessionAuthorization {
  const clock = dependencies.clock ?? defaultClock;
  const random = dependencies.randomBytes ?? defaultSecureRandomBytes;

  async function authorize(request: Request, write: boolean): Promise<SessionAuthorizationResult> {
    let cookies: SessionAuthorizationCookies;
    try {
      cookies = parseSessionAuthorizationCookies(request);
    } catch {
      return reject(dependencies, random, 'UNAUTHENTICATED', 'AUTH_INPUT_REJECTED');
    }

    let sessionToken: string | undefined;
    try {
      sessionToken = readSessionToken(cookies);
    } catch {
      return reject(dependencies, random, 'UNAUTHENTICATED', 'AUTH_INPUT_REJECTED');
    }

    if (sessionToken === undefined) {
      return reject(dependencies, random, 'UNAUTHENTICATED', 'AUTH_SESSION_REJECTED');
    }

    let persistence: KendoPersistence;
    try {
      persistence = await resolvePersistence(dependencies.persistence);
    } catch (error) {
      logFailure(dependencies, random, persistenceFailureCode(error));
      return reject(dependencies, random, 'AUTH_UNAVAILABLE');
    }

    let now: Date;
    try {
      now = readClock(clock);
    } catch (error) {
      logFailure(dependencies, random, persistenceFailureCode(error));
      return reject(dependencies, random, 'AUTH_UNAVAILABLE');
    }

    const sessionTokenHash = sha256(sessionToken);
    let session: SessionRecord | null;
    try {
      // The first lookup distinguishes an invalid application session from a
      // valid session carrying a wrong CSRF proof. A write performs a second
      // lookup below to bind that proof to this exact session and account.
      session = await persistence.sessions.findActiveByTokenHash({
        sessionTokenHash,
        at: now,
      });
    } catch (error) {
      logFailure(dependencies, random, persistenceFailureCode(error));
      return reject(dependencies, random, 'AUTH_UNAVAILABLE');
    }
    if (session === null) {
      return reject(dependencies, random, 'UNAUTHENTICATED', 'AUTH_SESSION_REJECTED');
    }
    if (!isActiveSession(session, now)) {
      logFailure(dependencies, random, 'AUTH_PERSISTENCE_FAILED');
      return reject(dependencies, random, 'AUTH_UNAVAILABLE');
    }

    let csrfToken: string | undefined;
    if (write) {
      let appOrigin: string;
      try {
        appOrigin = await resolveAppOrigin(dependencies.getAppOrigin);
      } catch (error) {
        logFailure(dependencies, random, persistenceFailureCode(error));
        return reject(dependencies, random, 'AUTH_UNAVAILABLE');
      }
      if (!exactOrigin(request, appOrigin)) {
        return reject(dependencies, random, 'FORBIDDEN');
      }

      try {
        csrfToken = readCsrfToken(request, cookies);
      } catch {
        return reject(dependencies, random, 'FORBIDDEN');
      }
    }

    if (!write) {
      return { status: 'authorized', proof: authorizedProof(session, sessionTokenHash, undefined) };
    }

    if (csrfToken === undefined) return reject(dependencies, random, 'FORBIDDEN');
    const csrfTokenHash = sha256(csrfToken);
    let matchedSession: SessionRecord | null;
    try {
      matchedSession = await persistence.sessions.findActiveByTokenHash({
        sessionTokenHash,
        csrfTokenHash,
        at: now,
      });
    } catch (error) {
      logFailure(dependencies, random, persistenceFailureCode(error));
      return reject(dependencies, random, 'AUTH_UNAVAILABLE');
    }
    if (matchedSession === null) {
      return reject(dependencies, random, 'FORBIDDEN');
    }
    if (
      !isActiveSession(matchedSession, now) ||
      matchedSession.id !== session.id ||
      matchedSession.userId !== session.userId
    ) {
      logFailure(dependencies, random, 'AUTH_PERSISTENCE_FAILED');
      return reject(dependencies, random, 'AUTH_UNAVAILABLE');
    }

    return {
      status: 'authorized',
      proof: authorizedProof(session, sessionTokenHash, csrfTokenHash),
    };
  }

  return {
    authorizeRead: (request) => authorize(request, false),
    authorizeWrite: (request) => authorize(request, true),
  };
}
