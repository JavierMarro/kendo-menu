/**
 * Fail-closed primitives shared by every authentication flow.
 *
 * This module bounds and parses untrusted URL/cookie input, creates and hashes
 * opaque values, serializes the fixed cookie policy, builds non-cacheable
 * responses, and restricts logs to generated request IDs plus fixed codes.
 */
import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';

import {
  CSRF_COOKIE_NAME,
  LOGIN_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  type AuthenticationErrorCode,
  type AuthenticationInternalCode,
  type Clock,
  type SecureRandomBytes,
} from './contracts.js';

export const MAX_REQUEST_URL_LENGTH = 8_192;
export const MAX_QUERY_VALUE_LENGTH = 4_096;
export const MAX_COOKIE_HEADER_LENGTH = 8_192;
export const MAX_COOKIE_VALUE_LENGTH = 512;
export const MAX_CALLBACK_CODE_LENGTH = 2_048;
export const MAX_PROVIDER_ERROR_LENGTH = 128;
export const TOKEN_ENTROPY_BYTES = 32;

export const defaultClock: Clock = () => new Date();
export const defaultSecureRandomBytes: SecureRandomBytes = (size) =>
  new Uint8Array(nodeRandomBytes(size));

export class InvalidAuthenticationInput extends Error {
  constructor() {
    super('Invalid authentication input');
    this.name = 'InvalidAuthenticationInput';
  }
}

export class AuthenticationUnavailable extends Error {
  constructor() {
    super('Authentication is unavailable');
    this.name = 'AuthenticationUnavailable';
  }
}

export class AuthenticationFailed extends Error {
  constructor() {
    super('Authentication failed');
    this.name = 'AuthenticationFailed';
  }
}

export class AccountSwitchRequiresLogout extends Error {
  constructor() {
    super('Account switch requires logout');
    this.name = 'AccountSwitchRequiresLogout';
  }
}

export function isFiniteDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function readClock(clock: Clock): Date {
  let value: Date;
  try {
    value = clock();
  } catch {
    throw new AuthenticationUnavailable();
  }

  if (!isFiniteDate(value)) {
    throw new AuthenticationUnavailable();
  }

  return new Date(value.getTime());
}

export function generateOpaqueValue(random: SecureRandomBytes): string {
  // Every browser credential starts with 256 bits from the injected secure
  // random source. Exact byte-length validation prevents a faulty test or runtime
  // adapter from silently issuing shorter, guessable values.
  let bytes: Uint8Array;
  try {
    bytes = random(TOKEN_ENTROPY_BYTES);
  } catch {
    throw new AuthenticationUnavailable();
  }

  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== TOKEN_ENTROPY_BYTES) {
    throw new AuthenticationUnavailable();
  }

  return Buffer.from(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

export function hashesEqual(left: string, right: string): boolean {
  // Equal-length checking is required before Node's constant-time primitive.
  // Callers compare hashes rather than raw browser credentials.
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function isHexDigit(value: string | undefined): boolean {
  return value !== undefined && /^[0-9A-Fa-f]$/u.test(value);
}

/**
 * URLSearchParams performs one application/x-www-form-urlencoded decode. This
 * scanner only validates the raw percent syntax, and deliberately never
 * decodes it itself.
 */
export function assertWellFormedPercentEncoding(search: string): void {
  for (let index = 0; index < search.length; index += 1) {
    if (search[index] !== '%') {
      continue;
    }

    if (!isHexDigit(search[index + 1]) || !isHexDigit(search[index + 2])) {
      throw new InvalidAuthenticationInput();
    }
    index += 2;
  }
}

export function parseRequestUrl(request: Request): URL {
  let requestUrl: string;
  try {
    requestUrl = request.url;
  } catch {
    throw new InvalidAuthenticationInput();
  }

  if (requestUrl.length === 0 || requestUrl.length > MAX_REQUEST_URL_LENGTH) {
    throw new InvalidAuthenticationInput();
  }

  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    throw new InvalidAuthenticationInput();
  }

  if (url.search.length > MAX_REQUEST_URL_LENGTH) {
    throw new InvalidAuthenticationInput();
  }

  assertWellFormedPercentEncoding(url.search);

  for (const [key, value] of url.searchParams) {
    if (
      key.length > MAX_QUERY_VALUE_LENGTH ||
      value.length > MAX_QUERY_VALUE_LENGTH ||
      hasControlCharacters(key) ||
      hasControlCharacters(value) ||
      key.includes('\ufffd') ||
      value.includes('\ufffd')
    ) {
      throw new InvalidAuthenticationInput();
    }
  }

  return url;
}

export function uniqueQueryParameter(
  parameters: URLSearchParams,
  name: string,
): string | undefined {
  const values = parameters.getAll(name);
  if (values.length > 1) {
    throw new InvalidAuthenticationInput();
  }

  return values[0];
}

export function validateReturnPathParameter(parameters: URLSearchParams): string {
  const value = uniqueQueryParameter(parameters, 'returnPath');
  if (value === undefined) {
    return '/';
  }

  if (value !== '/') {
    throw new InvalidAuthenticationInput();
  }

  return value;
}

export function validateStoredReturnPath(value: unknown): string {
  if (value !== '/') {
    throw new AuthenticationFailed();
  }

  return value;
}

export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }

  return false;
}

export function validateBase64UrlToken(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length !== 43 ||
    value.length > MAX_COOKIE_VALUE_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(value) ||
    Buffer.from(value, 'base64url').byteLength !== TOKEN_ENTROPY_BYTES ||
    Buffer.from(value, 'base64url').toString('base64url') !== value
  ) {
    throw new InvalidAuthenticationInput();
  }

  return value;
}

export function validateCallbackCode(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_CALLBACK_CODE_LENGTH ||
    !isPrintableAscii(value)
  ) {
    throw new InvalidAuthenticationInput();
  }

  return value;
}

export function validateProviderError(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_PROVIDER_ERROR_LENGTH ||
    !isPrintableAscii(value)
  ) {
    throw new InvalidAuthenticationInput();
  }

  return value;
}

export function validateCsrfHeader(value: unknown): string {
  return validateBase64UrlToken(value);
}

export function isPrintableAscii(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 0x21 || codePoint > 0x7e) {
      return false;
    }
  }

  return true;
}

export function validateGoogleConfiguration(value: unknown): {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly appOrigin: string;
} {
  if (typeof value !== 'object' || value === null) {
    throw new AuthenticationUnavailable();
  }

  const clientId = readStringProperty(value, 'clientId', 1, 512);
  const clientSecret = readStringProperty(value, 'clientSecret', 1, 2_048);
  const redirectUri = readStringProperty(value, 'redirectUri', 1, 2_048);
  const appOrigin = readStringProperty(value, 'appOrigin', 1, 2_048);

  if (!isPrintableAscii(clientId) || !isPrintableAscii(clientSecret)) {
    throw new AuthenticationUnavailable();
  }

  validateAbsoluteHttpsUrl(redirectUri, false);
  validateAbsoluteHttpsUrl(appOrigin, true);
  const redirectUrl = new URL(redirectUri);
  if (redirectUrl.pathname !== '/api/auth/google/callback' || redirectUrl.origin !== appOrigin) {
    throw new AuthenticationUnavailable();
  }
  return { clientId, clientSecret, redirectUri, appOrigin };
}

export function validateAppOrigin(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    throw new AuthenticationUnavailable();
  }
  const appOrigin = readStringProperty(value, 'appOrigin', 1, 2_048);
  validateAbsoluteHttpsUrl(appOrigin, true);
  return appOrigin;
}

function readStringProperty(
  value: object,
  key: string,
  minimumLength: number,
  maximumLength: number,
): string {
  if (!hasOwnProperty(value, key)) {
    throw new AuthenticationUnavailable();
  }
  const property = value[key];
  if (
    typeof property !== 'string' ||
    property.length < minimumLength ||
    property.length > maximumLength ||
    hasControlCharacters(property)
  ) {
    throw new AuthenticationUnavailable();
  }

  return property;
}

function hasOwnProperty(value: object, key: string): value is Record<string, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function validateAbsoluteHttpsUrl(value: unknown, originOnly: boolean): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) {
    throw new AuthenticationUnavailable();
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AuthenticationUnavailable();
  }

  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new AuthenticationUnavailable();
  }
  if (originOnly) {
    if (url.pathname !== '/' || url.search !== '' || url.origin !== value) {
      throw new AuthenticationUnavailable();
    }
  } else if (url.search !== '' || url.href !== value) {
    throw new AuthenticationUnavailable();
  }

  return value;
}

export function validateRequestMethod(request: Request, expectedMethod: string): void {
  if (request.method !== expectedMethod) {
    throw new InvalidAuthenticationInput();
  }
}

export interface ParsedCookies {
  readonly login: string | undefined;
  readonly session: string | undefined;
  readonly csrf: string | undefined;
}

export function parseCookies(request: Request): ParsedCookies {
  const raw = request.headers.get('cookie');
  if (raw === null) {
    return { login: undefined, session: undefined, csrf: undefined };
  }

  if (raw.length > MAX_COOKIE_HEADER_LENGTH || hasControlCharacters(raw)) {
    throw new InvalidAuthenticationInput();
  }

  let login: string | undefined;
  let session: string | undefined;
  let csrf: string | undefined;
  const pairs = raw.split(';');
  for (const pair of pairs) {
    const separator = pair.indexOf('=');
    if (separator <= 0) {
      throw new InvalidAuthenticationInput();
    }

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name.length === 0 || value.length > MAX_COOKIE_VALUE_LENGTH) {
      throw new InvalidAuthenticationInput();
    }

    // Duplicate security-cookie names are ambiguous across parsers/proxies;
    // each branch rejects them instead of selecting one occurrence.
    if (name === LOGIN_COOKIE_NAME) {
      if (login !== undefined) {
        throw new InvalidAuthenticationInput();
      }
      login = value;
    } else if (name === SESSION_COOKIE_NAME) {
      if (session !== undefined) {
        throw new InvalidAuthenticationInput();
      }
      session = value;
    } else if (name === CSRF_COOKIE_NAME) {
      if (csrf !== undefined) {
        throw new InvalidAuthenticationInput();
      }
      csrf = value;
    }
  }

  return { login, session, csrf };
}

export interface CookieAttributes {
  readonly httpOnly: boolean;
  readonly maxAgeSeconds?: number;
  readonly expires: Date;
}

export function serializeCookie(name: string, value: string, attributes: CookieAttributes): string {
  // All authentication cookies share the same host-only, whole-application
  // policy: Secure, SameSite=Lax, Path=/, and no Domain attribute. HttpOnly is
  // enabled for credentials and deliberately omitted only for the CSRF echo.
  if (attributes.maxAgeSeconds !== undefined) {
    if (!Number.isSafeInteger(attributes.maxAgeSeconds) || attributes.maxAgeSeconds < 0) {
      throw new AuthenticationUnavailable();
    }
  }
  if (!isFiniteDate(attributes.expires)) {
    throw new AuthenticationUnavailable();
  }

  const parts = [
    `${name}=${value}`,
    'Path=/',
    `Expires=${attributes.expires.toUTCString()}`,
    'SameSite=Lax',
    'Secure',
  ];
  if (attributes.maxAgeSeconds !== undefined) {
    parts.splice(2, 0, 'Max-Age=' + String(attributes.maxAgeSeconds));
  }
  if (attributes.httpOnly) {
    parts.push('HttpOnly');
  }
  return parts.join('; ');
}

export function appendSetCookie(headers: Headers, value: string): void {
  headers.append('set-cookie', value);
}

const EXPIRED_COOKIE_DATE = new Date(0);

export function clearLoginCookie(headers: Headers): void {
  appendSetCookie(
    headers,
    serializeCookie(LOGIN_COOKIE_NAME, '', {
      httpOnly: true,
      maxAgeSeconds: 0,
      expires: EXPIRED_COOKIE_DATE,
    }),
  );
}

export function clearSessionCookies(headers: Headers): void {
  appendSetCookie(
    headers,
    serializeCookie(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      maxAgeSeconds: 0,
      expires: EXPIRED_COOKIE_DATE,
    }),
  );
  appendSetCookie(
    headers,
    serializeCookie(CSRF_COOKIE_NAME, '', {
      httpOnly: false,
      maxAgeSeconds: 0,
      expires: EXPIRED_COOKIE_DATE,
    }),
  );
}

export function setSessionCookies(
  headers: Headers,
  sessionToken: string,
  csrfToken: string,
  now: Date,
  absoluteExpiresAt: Date,
): void {
  if (!isFiniteDate(now)) {
    throw new AuthenticationUnavailable();
  }
  appendSetCookie(
    headers,
    serializeCookie(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      expires: absoluteExpiresAt,
    }),
  );
  // JavaScript must read the CSRF value to echo it in a custom header. The
  // authentication credential remains separate and HttpOnly.
  appendSetCookie(
    headers,
    serializeCookie(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false,
      expires: absoluteExpiresAt,
    }),
  );
}

export function setLoginCookie(
  headers: Headers,
  binding: string,
  now: Date,
  expiresAt: Date,
): void {
  if (!isFiniteDate(now)) {
    throw new AuthenticationUnavailable();
  }
  appendSetCookie(
    headers,
    serializeCookie(LOGIN_COOKIE_NAME, binding, {
      httpOnly: true,
      expires: expiresAt,
    }),
  );
}

export function makeResponseHeaders(): Headers {
  const headers = new Headers();
  headers.set('cache-control', 'private, no-store');
  return headers;
}

export function makeCallbackHeaders(): Headers {
  const headers = makeResponseHeaders();
  headers.set('referrer-policy', 'no-referrer');
  return headers;
}

export function makeJsonResponse(
  status: number,
  code: AuthenticationErrorCode,
  headers = makeResponseHeaders(),
): Response {
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify({ error: code }), { status, headers });
}

export function makeEmptyResponse(status: number, headers = makeResponseHeaders()): Response {
  return new Response(null, { status, headers });
}

export function logSafe(
  logger:
    | {
        log(entry: { readonly requestId: string; readonly code: AuthenticationInternalCode }): void;
      }
    | undefined,
  random: SecureRandomBytes,
  code: AuthenticationInternalCode,
): void {
  // Authentication logging is intentionally lossy. A random correlation ID and
  // fixed code are enough to count failures without retaining tokens, claims,
  // provider payloads, database messages, or user-controlled text.
  if (logger === undefined) {
    return;
  }

  let requestId: string;
  try {
    requestId = generateOpaqueValue(random);
  } catch {
    return;
  }

  try {
    logger.log({ requestId, code });
  } catch {
    // Logging must never change the public authentication outcome.
  }
}
