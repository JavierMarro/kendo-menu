/**
 * Small interfaces for the authentication module and its injected adapters.
 *
 * The Google adapter reduces provider output to immutable `sub` identity plus
 * optional verified-email metadata. Clock, randomness, persistence, and runtime
 * configuration are injected so tests cross the same interface as production
 * without real credentials, network access, or a live database.
 */
import type { KendoPersistence } from '../persistence/contracts.js';

export const LOGIN_TRANSACTION_LIFETIME_MS = 10 * 60 * 1_000;
export const SESSION_IDLE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
export const SESSION_ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
export const GOOGLE_CLOCK_SKEW_SECONDS = 300;

// `__Host-` tells supporting browsers to accept these cookies only when they are
// Secure, host-only, and scoped to `/`. That prevents a sibling subdomain from
// planting a cookie with the same authentication name.
export const LOGIN_COOKIE_NAME = '__Host-kendomenu-login';
export const SESSION_COOKIE_NAME = '__Host-kendomenu-session';
export const CSRF_COOKIE_NAME = '__Host-kendomenu-csrf';

export const AUTHENTICATION_ERROR_CODES = {
  invalidRequest: 'INVALID_AUTH_REQUEST',
  authenticationFailed: 'AUTHENTICATION_FAILED',
  unauthenticated: 'UNAUTHENTICATED',
  forbidden: 'FORBIDDEN',
  accountSwitchRequiresLogout: 'ACCOUNT_SWITCH_REQUIRES_LOGOUT',
  unavailable: 'AUTH_UNAVAILABLE',
} as const;

export type AuthenticationErrorCode =
  (typeof AUTHENTICATION_ERROR_CODES)[keyof typeof AUTHENTICATION_ERROR_CODES];

export type AuthenticationInternalCode =
  | 'AUTH_CONFIG_INVALID'
  | 'AUTH_PERSISTENCE_UNAVAILABLE'
  | 'AUTH_PERSISTENCE_FAILED'
  | 'AUTH_INPUT_REJECTED'
  | 'AUTH_PROVIDER_REJECTED'
  | 'AUTH_SESSION_REJECTED'
  | 'AUTH_ACCOUNT_SWITCH_REJECTED';

export interface GoogleConfiguration {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface GoogleOperationConfiguration extends GoogleConfiguration {
  readonly appOrigin: string;
}

export interface GoogleAuthorizationInput {
  readonly config: GoogleConfiguration;
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
}

export interface GoogleExchangeInput {
  readonly config: GoogleConfiguration;
  readonly code: string;
  readonly codeVerifier: string;
  readonly nonceHash: string;
  readonly now: Date;
}

export interface GoogleIdentity {
  readonly googleSub: string;
  readonly verifiedGoogleEmail: string | null;
}

export interface GoogleAuthenticationAdapter {
  createAuthorizationUrl(input: GoogleAuthorizationInput): string;
  exchangeCode(input: GoogleExchangeInput): Promise<GoogleIdentity>;
}

export type Clock = () => Date;
export type SecureRandomBytes = (size: number) => Uint8Array;

export interface AuthenticationLogEntry {
  readonly requestId: string;
  readonly code: AuthenticationInternalCode;
}

export interface AuthenticationLogger {
  log(entry: AuthenticationLogEntry): void;
}

export type AuthenticationPersistenceProvider =
  KendoPersistence | (() => KendoPersistence | Promise<KendoPersistence>);

export interface AuthenticationDependencies {
  // Infrastructure is supplied at composition time rather than imported here.
  // This keeps the authentication policy testable and prevents handlers from
  // silently reaching a second database, clock, or source of randomness.
  readonly persistence: AuthenticationPersistenceProvider;
  readonly getGoogleConfiguration: () =>
    GoogleOperationConfiguration | Promise<GoogleOperationConfiguration>;
  readonly getAppOrigin: () => string | Promise<string>;
  readonly google: GoogleAuthenticationAdapter;
  readonly clock?: Clock;
  readonly randomBytes?: SecureRandomBytes;
  readonly logger?: AuthenticationLogger;
}

export interface Authentication {
  start(request: Request): Promise<Response>;
  callback(request: Request): Promise<Response>;
  getSession(request: Request): Promise<Response>;
  logout(request: Request): Promise<Response>;
}
