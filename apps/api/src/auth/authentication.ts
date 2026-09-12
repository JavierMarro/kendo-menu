/**
 * Orchestrates KendoMenu's Google-only sign-in and opaque application sessions.
 *
 * Provider tokens stay inside the Google adapter. This module receives only
 * a validated Google subject and optional verified-email metadata, then stores
 * hashes of browser credentials through the persistence interface. Keeping the
 * four HTTP flows here makes their cookie and public-error behavior consistent.
 */
import {
  PersistenceError,
  type KendoPersistence,
  type UserRecord,
} from '../persistence/contracts.js';
import {
  GOOGLE_SUB_MAX_LENGTH,
  VERIFIED_EMAIL_MAX_LENGTH,
  validateGoogleSub,
  validateVerifiedGoogleEmail,
} from '../persistence/validation.js';
import {
  AccountSwitchRequiresLogout,
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
const JSON_STATUS_ACCOUNT_SWITCH = 409;
const JSON_STATUS_AUTHENTICATION_FAILED = 401;

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

function callbackErrorResponse(
  status: number,
  code: (typeof AUTHENTICATION_ERROR_CODES)[keyof typeof AUTHENTICATION_ERROR_CODES],
): Response {
  const headers = makeCallbackHeaders();
  clearLoginCookie(headers);
  return makeJsonResponse(status, code, headers);
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
  if (error instanceof InvalidAuthenticationInput) {
    return callbackErrorResponse(
      JSON_STATUS_INVALID_REQUEST,
      AUTHENTICATION_ERROR_CODES.invalidRequest,
    );
  }
  if (error instanceof AccountSwitchRequiresLogout) {
    return callbackErrorResponse(
      JSON_STATUS_ACCOUNT_SWITCH,
      AUTHENTICATION_ERROR_CODES.accountSwitchRequiresLogout,
    );
  }
  if (error instanceof AuthenticationFailed) {
    return callbackErrorResponse(
      JSON_STATUS_AUTHENTICATION_FAILED,
      AUTHENTICATION_ERROR_CODES.authenticationFailed,
    );
  }
  return callbackErrorResponse(JSON_STATUS_UNAVAILABLE, AUTHENTICATION_ERROR_CODES.unavailable);
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
          throw new AuthenticationFailed();
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
        let user: UserRecord;
        if (identity.verifiedGoogleEmail === null) {
          user = await persistence.users.resolveByGoogleSubject({
            googleSub: identity.googleSub,
          });
        } else {
          user = await persistence.users.resolveByGoogleSubject({
            googleSub: identity.googleSub,
            verifiedGoogleEmail: identity.verifiedGoogleEmail,
          });
        }

        const sessionToken = generateOpaqueValue(random);
        const csrfToken = generateOpaqueValue(random);
        const { idleExpiresAt, absoluteExpiresAt } = sessionDeadlines(sessionNow);
        // Fresh credentials prevent fixation. An active same-account session is
        // replaced atomically; an active different-account credential in this
        // browser requires an explicit logout before switching accounts.
        if (predecessorToken === undefined) {
          await persistence.sessions.create({
            userId: user.id,
            sessionTokenHash: sha256(sessionToken),
            csrfTokenHash: sha256(csrfToken),
            createdAt: sessionNow,
            lastActivityAt: sessionNow,
            idleExpiresAt,
            absoluteExpiresAt,
          });
        } else {
          const predecessor = await persistence.sessions.findActiveByTokenHash({
            sessionTokenHash: sha256(predecessorToken),
            at: sessionNow,
          });
          if (predecessor === null) {
            await persistence.sessions.create({
              userId: user.id,
              sessionTokenHash: sha256(sessionToken),
              csrfTokenHash: sha256(csrfToken),
              createdAt: sessionNow,
              lastActivityAt: sessionNow,
              idleExpiresAt,
              absoluteExpiresAt,
            });
          } else if (predecessor.userId !== user.id) {
            throw new AccountSwitchRequiresLogout();
          } else {
            await persistence.sessions.replace({
              predecessorSessionId: predecessor.id,
              userId: user.id,
              replacement: {
                userId: user.id,
                sessionTokenHash: sha256(sessionToken),
                csrfTokenHash: sha256(csrfToken),
                createdAt: sessionNow,
                lastActivityAt: sessionNow,
                idleExpiresAt,
                absoluteExpiresAt,
              },
              at: sessionNow,
            });
          }
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
        const headers = makeResponseHeaders();
        headers.set('content-type', 'application/json');
        return new Response(
          JSON.stringify({
            userId: user.id,
            verifiedGoogleEmail: user.verifiedGoogleEmail,
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
