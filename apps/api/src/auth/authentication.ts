/**
 * Orchestrates KendoMenu's Google-only sign-in and opaque application sessions.
 *
 * Provider tokens stay inside the Google adapter. This module receives only
 * a validated Google subject and optional verified-email metadata, then stores
 * hashes of browser credentials through the persistence interface. Keeping the
 * four HTTP flows here makes their cookie and public-error behavior consistent.
 */
import { PersistenceError, type KendoPersistence } from '../persistence/contracts.js';
import {
  validateAdoptionStatus,
  type AdoptionStatus as PublicAdoptionStatus,
} from '../adoption/contracts.js';
import {
  GOOGLE_SUB_MAX_LENGTH,
  VERIFIED_EMAIL_MAX_LENGTH,
  validateGoogleSub,
  validateVerifiedGoogleEmail,
} from '../persistence/validation.js';
import {
  AccountSwitchRequiresLogout,
  AuthenticationCancelled,
  AuthenticationFailed,
  AuthenticationUnavailable,
  InvalidAuthenticationInput,
  clearLoginCookie,
  clearSessionCookies,
  defaultClock,
  defaultSecureRandomBytes,
  generateOpaqueValue,
  hasControlCharacters,
  logSafe,
  makeCallbackHeaders,
  makeEmptyResponse,
  makeJsonResponse,
  makeResponseHeaders,
  parseCookies,
  parseRequestUrl,
  pkceChallenge,
  readClock,
  setLoginCookie,
  setSessionCookies,
  sha256,
  uniqueQueryParameter,
  validateBase64UrlToken,
  validateCallbackCode,
  validateGoogleConfiguration,
  validateProviderError,
  validateRequestMethod,
  validateReturnPathParameter,
  validateStoredReturnPath,
} from './security.js';
import {
  AUTHENTICATION_ERROR_CODES,
  AUTHENTICATION_CALLBACK_ERROR_CODES,
  LOGIN_TRANSACTION_LIFETIME_MS,
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_IDLE_LIFETIME_MS,
  type Authentication,
  type AuthenticationDependencies,
  type AuthenticationInternalCode,
  type GoogleOperationConfiguration,
} from './contracts.js';
import {
  createSessionAuthorization,
  sessionAuthorizationFailureResponse,
} from './session-authorization.js';

const JSON_STATUS_UNAVAILABLE = 503;
const JSON_STATUS_INVALID_REQUEST = 400;
const GOOGLE_CANCELLATION_ERROR = 'access_denied';
const GOOGLE_TEMPORARY_ERROR = 'temporarily_unavailable';

async function resolvePersistence(
  provider: AuthenticationDependencies['persistence'],
): Promise<KendoPersistence> {
  try {
    const persistence = typeof provider === 'function' ? await provider() : provider;
    if (typeof persistence !== 'object' || persistence === null) {
      throw new AuthenticationUnavailable();
    }
    return persistence;
  } catch (error) {
    if (error instanceof AuthenticationUnavailable) {
      throw error;
    }
    throw new AuthenticationUnavailable();
  }
}

async function resolveGoogleConfiguration(
  getter: AuthenticationDependencies['getGoogleConfiguration'],
): Promise<GoogleOperationConfiguration> {
  try {
    return validateGoogleConfiguration(await getter());
  } catch {
    throw new AuthenticationUnavailable();
  }
}

function publicErrorResponse(
  status: number,
  code: (typeof AUTHENTICATION_ERROR_CODES)[keyof typeof AUTHENTICATION_ERROR_CODES],
): Response {
  return makeJsonResponse(status, code);
}

function callbackRedirectResponse(
  code: (typeof AUTHENTICATION_CALLBACK_ERROR_CODES)[keyof typeof AUTHENTICATION_CALLBACK_ERROR_CODES],
): Response {
  const headers = makeCallbackHeaders();
  headers.set('location', `/app?authError=${encodeURIComponent(code)}`);
  clearLoginCookie(headers);
  return makeEmptyResponse(303, headers);
}

function callbackProviderError(
  error: string,
): AuthenticationCancelled | AuthenticationFailed | AuthenticationUnavailable {
  if (error === GOOGLE_CANCELLATION_ERROR) {
    return new AuthenticationCancelled();
  }
  if (error === GOOGLE_TEMPORARY_ERROR) {
    return new AuthenticationUnavailable();
  }
  return new AuthenticationFailed();
}

function callbackSuccessResponse(
  returnPath: string,
  sessionToken: string,
  csrfToken: string,
  now: Date,
  absoluteExpiresAt: Date,
): Response {
  const headers = makeCallbackHeaders();
  headers.set('location', returnPath);
  setSessionCookies(headers, sessionToken, csrfToken, now, absoluteExpiresAt);
  clearLoginCookie(headers);
  return makeEmptyResponse(303, headers);
}

// Internal exceptions are reduced to a small allow-list before logging. Raw
// provider responses, database errors, cookies, identity claims, and stack traces
// never become log fields or public error bodies through this path.
function errorCodeForLog(error: unknown): AuthenticationInternalCode {
  if (error instanceof InvalidAuthenticationInput) {
    return 'AUTH_INPUT_REJECTED';
  }
  if (error instanceof AuthenticationCancelled) {
    return 'AUTH_PROVIDER_REJECTED';
  }
  if (error instanceof AccountSwitchRequiresLogout) {
    return 'AUTH_ACCOUNT_SWITCH_REJECTED';
  }
  if (error instanceof AuthenticationFailed) {
    return 'AUTH_PROVIDER_REJECTED';
  }
  if (error instanceof PersistenceError) {
    return error.code === 'UNAVAILABLE'
      ? 'AUTH_PERSISTENCE_UNAVAILABLE'
      : 'AUTH_PERSISTENCE_FAILED';
  }
  if (error instanceof AuthenticationUnavailable) {
    return 'AUTH_CONFIG_INVALID';
  }
  return 'AUTH_PERSISTENCE_FAILED';
}

function logFailure(
  dependencies: AuthenticationDependencies,
  random: AuthenticationDependencies['randomBytes'],
  error: unknown,
): void {
  logSafe(dependencies.logger, random ?? defaultSecureRandomBytes, errorCodeForLog(error));
}

function handleStartError(
  dependencies: AuthenticationDependencies,
  random: AuthenticationDependencies['randomBytes'],
  error: unknown,
): Response {
  logFailure(dependencies, random, error);
  if (error instanceof InvalidAuthenticationInput) {
    return publicErrorResponse(
      JSON_STATUS_INVALID_REQUEST,
      AUTHENTICATION_ERROR_CODES.invalidRequest,
    );
  }
  return publicErrorResponse(JSON_STATUS_UNAVAILABLE, AUTHENTICATION_ERROR_CODES.unavailable);
}

function handleCallbackError(
  dependencies: AuthenticationDependencies,
  random: AuthenticationDependencies['randomBytes'],
  error: unknown,
): Response {
  logFailure(dependencies, random, error);
  if (error instanceof AuthenticationCancelled) {
    return callbackRedirectResponse(AUTHENTICATION_CALLBACK_ERROR_CODES.cancellation);
  }
  if (error instanceof AuthenticationUnavailable || error instanceof PersistenceError) {
    return callbackRedirectResponse(AUTHENTICATION_CALLBACK_ERROR_CODES.unavailable);
  }
  // Invalid callback input, provider exchange failures, account-switch
  // protection, and unknown internal failures all use the same safe application
  // failure code. No provider or persistence detail reaches the redirect.
  return callbackRedirectResponse(AUTHENTICATION_CALLBACK_ERROR_CODES.failure);
}

function handleSessionError(
  dependencies: AuthenticationDependencies,
  random: AuthenticationDependencies['randomBytes'],
  error: unknown,
): Response {
  logFailure(dependencies, random, error);
  if (error instanceof InvalidAuthenticationInput) {
    return sessionAuthorizationFailureResponse('UNAUTHENTICATED');
  }
  return publicErrorResponse(JSON_STATUS_UNAVAILABLE, AUTHENTICATION_ERROR_CODES.unavailable);
}

function handleLogoutError(
  dependencies: AuthenticationDependencies,
  random: AuthenticationDependencies['randomBytes'],
  error: unknown,
): Response {
  logFailure(dependencies, random, error);
  if (error instanceof InvalidAuthenticationInput) {
    return sessionAuthorizationFailureResponse('UNAUTHENTICATED');
  }
  return publicErrorResponse(JSON_STATUS_UNAVAILABLE, AUTHENTICATION_ERROR_CODES.unavailable);
}

interface IdentityRecord {
  readonly googleSub: unknown;
  readonly verifiedGoogleEmail: unknown;
}

function isIdentityRecord(value: object): value is IdentityRecord {
  return (
    Object.prototype.hasOwnProperty.call(value, 'googleSub') &&
    Object.prototype.hasOwnProperty.call(value, 'verifiedGoogleEmail')
  );
}

// Treat the adapter result as untrusted despite its TypeScript return type.
// Types disappear at runtime, and an injected or future adapter could otherwise
// pass malformed identity data into the account lookup.
function validateIdentity(identity: unknown): {
  readonly googleSub: string;
  readonly verifiedGoogleEmail: string | null;
} {
  if (typeof identity !== 'object' || identity === null || !isIdentityRecord(identity)) {
    throw new AuthenticationFailed();
  }

  const googleSub = identity.googleSub;
  const email = identity.verifiedGoogleEmail;
  if (
    typeof googleSub !== 'string' ||
    googleSub.length === 0 ||
    googleSub.length > GOOGLE_SUB_MAX_LENGTH ||
    !/^[\x20-\x7e]+$/u.test(googleSub) ||
    hasControlCharacters(googleSub)
  ) {
    throw new AuthenticationFailed();
  }
  try {
    validateGoogleSub(googleSub);
  } catch {
    throw new AuthenticationFailed();
  }

  if (email === null) {
    return { googleSub, verifiedGoogleEmail: null };
  }
  if (
    typeof email !== 'string' ||
    email.length === 0 ||
    email.length > VERIFIED_EMAIL_MAX_LENGTH ||
    hasControlCharacters(email) ||
    email.trim() !== email
  ) {
    throw new AuthenticationFailed();
  }
  try {
    return { googleSub, verifiedGoogleEmail: validateVerifiedGoogleEmail(email) };
  } catch {
    throw new AuthenticationFailed();
  }
}

function readOwnValue(value: object, property: string): unknown {
  try {
    return Object.getOwnPropertyDescriptor(value, property)?.value;
  } catch {
    return undefined;
  }
}

/**
 * Persistence returns Date values while the HTTP contract uses canonical UTC
 * strings. Copy only the allow-listed completion fields before the strict
 * public validator sees them; a malformed adapter result becomes a fixed 503.
 */
function publicAdoptionStatus(value: unknown): PublicAdoptionStatus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuthenticationUnavailable();
  }

  const status = readOwnValue(value, 'status');
  const capability = readOwnValue(value, 'capability');
  if (status === 'pending' || status === 'unavailable') {
    const validated = validateAdoptionStatus({ status, capability });
    if (validated === null) throw new AuthenticationUnavailable();
    return validated;
  }

  if (status !== 'accepted' && status !== 'declined') {
    throw new AuthenticationUnavailable();
  }
  const completionValue = readOwnValue(value, 'completion');
  if (
    typeof completionValue !== 'object' ||
    completionValue === null ||
    Array.isArray(completionValue)
  ) {
    throw new AuthenticationUnavailable();
  }

  const requestId = readOwnValue(completionValue, 'requestId');
  const decision = readOwnValue(completionValue, 'decision');
  if (status === 'declined') {
    const validated = validateAdoptionStatus({
      status,
      capability,
      completion: { decision, requestId },
    });
    if (validated === null) throw new AuthenticationUnavailable();
    return validated;
  }

  const acknowledgedRevision = readOwnValue(completionValue, 'acknowledgedRevision');
  const timestampValue = readOwnValue(completionValue, 'timestamp');
  if (!(timestampValue instanceof Date)) throw new AuthenticationUnavailable();
  let timestamp: string;
  try {
    timestamp = Date.prototype.toISOString.call(timestampValue);
  } catch {
    throw new AuthenticationUnavailable();
  }
  const validated = validateAdoptionStatus({
    status,
    capability,
    completion: { decision, requestId, acknowledgedRevision, timestamp },
  });
  if (validated === null) throw new AuthenticationUnavailable();
  return validated;
}

function readOptionalPredecessorToken(
  cookies: ReturnType<typeof parseCookies>,
): string | undefined {
  try {
    if (cookies.session === undefined) {
      return undefined;
    }
    return validateBase64UrlToken(cookies.session);
  } catch (error) {
    if (error instanceof InvalidAuthenticationInput) {
      // A stale or malformed predecessor must not prevent a fresh, otherwise
      // valid login from overwriting unusable application credentials.
      return undefined;
    }
    throw error;
  }
}

function validateAuthenticationRequestOrigin(url: URL, appOrigin: string): void {
  if (url.origin !== appOrigin) {
    throw new AuthenticationUnavailable();
  }
}

function sessionDeadlines(now: Date): {
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
} {
  const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_LIFETIME_MS);
  const idleExpiresAt = new Date(
    Math.min(now.getTime() + SESSION_IDLE_LIFETIME_MS, absoluteExpiresAt.getTime()),
  );
  return { idleExpiresAt, absoluteExpiresAt };
}

export function createAuthentication(dependencies: AuthenticationDependencies): Authentication {
  const clock = dependencies.clock ?? defaultClock;
  const random = dependencies.randomBytes ?? defaultSecureRandomBytes;
  // Session inspection and logout deliberately reuse the same authorization
  // service as other protected routes. This keeps cookie parsing, CSRF checks,
  // and active-session semantics from drifting between account endpoints.
  const getPersistence = (): Promise<KendoPersistence> =>
    resolvePersistence(dependencies.persistence);
  const sessionAuthorization = createSessionAuthorization({
    persistence: getPersistence,
    getAppOrigin: dependencies.getAppOrigin,
    clock,
    randomBytes: random,
    ...(dependencies.logger === undefined ? {} : { logger: dependencies.logger }),
  });

  return {
    // Begin a browser-bound, single-use login transaction. State and nonce bind
    // the callback to this attempt; PKCE binds the later code exchange.
    start: async (request: Request): Promise<Response> => {
      try {
        validateRequestMethod(request, 'GET');
        const url = parseRequestUrl(request);
        parseCookies(request);
        const returnPath = validateReturnPathParameter(url.searchParams);
        const config = await resolveGoogleConfiguration(dependencies.getGoogleConfiguration);
        validateAuthenticationRequestOrigin(url, config.appOrigin);
        const persistence = await getPersistence();
        const now = readClock(clock);
        await persistence.loginTransactions.cleanupExpired({ at: now });
        const state = generateOpaqueValue(random);
        const nonce = generateOpaqueValue(random);
        const browserBinding = generateOpaqueValue(random);
        const codeVerifier = generateOpaqueValue(random);
        const expiresAt = new Date(now.getTime() + LOGIN_TRANSACTION_LIFETIME_MS);
        const authorizationUrl = dependencies.google.createAuthorizationUrl({
          config,
          state,
          nonce,
          codeChallenge: pkceChallenge(codeVerifier),
        });
        await persistence.loginTransactions.create({
          stateHash: sha256(state),
          browserBindingHash: sha256(browserBinding),
          nonceHash: sha256(nonce),
          pkceCodeVerifier: codeVerifier,
          returnPath,
          createdAt: now,
          expiresAt,
        });
        const headers = makeResponseHeaders();
        headers.set('location', authorizationUrl);
        setLoginCookie(headers, browserBinding, now, expiresAt);
        return makeEmptyResponse(302, headers);
      } catch (error) {
        return handleStartError(dependencies, random, error);
      }
    },

    // Finish the one-time browser transaction and exchange Google's code on the
    // server. Successful verification creates fresh KendoMenu credentials; no
    // Google access token, refresh token, or ID token is returned to the browser.
    callback: async (request: Request): Promise<Response> => {
      try {
        validateRequestMethod(request, 'GET');
        const url = parseRequestUrl(request);
        const stateParameter = uniqueQueryParameter(url.searchParams, 'state');
        const codeParameter = uniqueQueryParameter(url.searchParams, 'code');
        const providerErrorParameter = uniqueQueryParameter(url.searchParams, 'error');
        const cookies = parseCookies(request);
        // Read and bound callback values before any persistence access. The
        // required-parameter check happens after lazy configuration so a
        // missing runtime configuration remains a safe 503.
        if (stateParameter !== undefined) {
          validateBase64UrlToken(stateParameter);
        }
        if (codeParameter !== undefined) {
          validateCallbackCode(codeParameter);
        }
        if (providerErrorParameter !== undefined) {
          validateProviderError(providerErrorParameter);
        }
        const predecessorToken = readOptionalPredecessorToken(cookies);
        const binding =
          cookies.login === undefined ? undefined : validateBase64UrlToken(cookies.login);

        const config = await resolveGoogleConfiguration(dependencies.getGoogleConfiguration);
        validateAuthenticationRequestOrigin(url, config.appOrigin);
        const persistence = await getPersistence();
        const state = stateParameter;
        if (state === undefined) {
          throw new InvalidAuthenticationInput();
        }
        const code = codeParameter;
        const providerError = providerErrorParameter;
        if (code === undefined && providerError === undefined) {
          throw new InvalidAuthenticationInput();
        }
        if (code !== undefined && providerError !== undefined) {
          throw new InvalidAuthenticationInput();
        }
        if (binding === undefined) {
          throw new AuthenticationFailed();
        }
        const now = readClock(clock);
        const consumed = await persistence.loginTransactions.consume({
          stateHash: sha256(state),
          browserBindingHash: sha256(binding),
          at: now,
        });
        if (consumed.outcome !== 'success') {
          throw new AuthenticationFailed();
        }
        // Consumption happens before the provider exchange. A callback can
        // therefore never be replayed, even when exchange or verification fails;
        // the user starts a new attempt instead.
        const returnPath = validateStoredReturnPath(consumed.transaction.returnPath);
        if (providerError !== undefined) {
          throw callbackProviderError(providerError);
        }
        if (code === undefined) {
          throw new AuthenticationFailed();
        }

        let identity: ReturnType<typeof validateIdentity>;
        try {
          identity = validateIdentity(
            await dependencies.google.exchangeCode({
              config,
              code,
              codeVerifier: consumed.transaction.pkceCodeVerifier,
              nonceHash: consumed.transaction.nonceHash,
              now,
            }),
          );
        } catch (error) {
          if (error instanceof AuthenticationFailed) {
            throw error;
          }
          throw new AuthenticationFailed();
        }

        const sessionNow = readClock(clock);
        const sessionToken = generateOpaqueValue(random);
        const csrfToken = generateOpaqueValue(random);
        const { idleExpiresAt, absoluteExpiresAt } = sessionDeadlines(sessionNow);
        // Fresh credentials prevent fixation. Account creation, adoption
        // capability issuance, and predecessor rotation all happen inside the
        // persistence transaction so two callbacks cannot grant capability or
        // revoke the same predecessor independently.
        const completed = await persistence.accounts.completeGoogleLogin({
          googleSub: identity.googleSub,
          ...(identity.verifiedGoogleEmail === null
            ? {}
            : { verifiedGoogleEmail: identity.verifiedGoogleEmail }),
          sessionTokenHash: sha256(sessionToken),
          csrfTokenHash: sha256(csrfToken),
          createdAt: sessionNow,
          lastActivityAt: sessionNow,
          idleExpiresAt,
          absoluteExpiresAt,
          at: sessionNow,
          ...(predecessorToken === undefined
            ? {}
            : { predecessorSessionTokenHash: sha256(predecessorToken) }),
        });
        if (completed.status === 'account-switch') {
          throw new AccountSwitchRequiresLogout();
        }

        return callbackSuccessResponse(
          returnPath,
          sessionToken,
          csrfToken,
          sessionNow,
          absoluteExpiresAt,
        );
      } catch (error) {
        return handleCallbackError(dependencies, random, error);
      }
    },

    // This read proves the current server-side session and returns minimal public
    // metadata. It deliberately does not extend the idle deadline; later
    // authenticated writes are the only operations reserved to record activity.
    getSession: async (request: Request): Promise<Response> => {
      try {
        validateRequestMethod(request, 'GET');
        try {
          parseRequestUrl(request);
        } catch (error) {
          if (error instanceof InvalidAuthenticationInput) {
            logFailure(dependencies, random, error);
            return publicErrorResponse(
              JSON_STATUS_INVALID_REQUEST,
              AUTHENTICATION_ERROR_CODES.invalidRequest,
            );
          }
          throw error;
        }
        const authorization = await sessionAuthorization.authorizeRead(request);
        if (authorization.status === 'rejected') {
          return authorization.response;
        }
        const persistence = await getPersistence();
        const user = await persistence.users.findPublicById(authorization.proof.userId);
        if (user === null || user.id !== authorization.proof.userId) {
          throw new InvalidAuthenticationInput();
        }
        const adoption = publicAdoptionStatus(
          await persistence.adoptions.getStatus({
            userId: authorization.proof.userId,
            sessionId: authorization.proof.sessionId,
            sessionTokenHash: authorization.proof.sessionTokenHash,
          }),
        );
        const headers = makeResponseHeaders();
        headers.set('content-type', 'application/json');
        return new Response(
          JSON.stringify({
            userId: user.id,
            verifiedGoogleEmail: user.verifiedGoogleEmail,
            adoption,
          }),
          { status: 200, headers },
        );
      } catch (error) {
        if (error instanceof InvalidAuthenticationInput) {
          logFailure(dependencies, random, error);
          return sessionAuthorizationFailureResponse('UNAUTHENTICATED');
        }
        return handleSessionError(dependencies, random, error);
      }
    },

    // Logout is a cookie-authenticated mutation: exact Origin is checked before
    // the session-bound CSRF proof. Valid credentials are cleared only after
    // revocation succeeds; indeterminate storage failures preserve them so the
    // client is not told a session ended when the server cannot prove it did.
    logout: async (request: Request): Promise<Response> => {
      try {
        validateRequestMethod(request, 'DELETE');
        parseRequestUrl(request);
        const authorization = await sessionAuthorization.authorizeWrite(request);
        if (authorization.status === 'rejected') {
          return authorization.response;
        }

        const persistence = await getPersistence();
        const now = readClock(clock);
        const revoked = await persistence.sessions.revoke({
          sessionId: authorization.proof.sessionId,
          userId: authorization.proof.userId,
          at: now,
        });
        if (!revoked) {
          throw new InvalidAuthenticationInput();
        }
        const headers = makeResponseHeaders();
        clearSessionCookies(headers);
        return makeEmptyResponse(204, headers);
      } catch (error) {
        if (error instanceof InvalidAuthenticationInput) {
          logFailure(dependencies, random, error);
          return sessionAuthorizationFailureResponse('UNAUTHENTICATED');
        }
        return handleLogoutError(dependencies, random, error);
      }
    },
  };
}
