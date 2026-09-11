/**
 * Runtime validation performed before values reach SQL.
 *
 * These checks produce the persistence module's fixed typed errors. Matching
 * database constraints remain deliberate defense in depth for direct SQL,
 * concurrency, or future callers that do not pass through this implementation.
 */
import { PersistenceError } from './contracts.js';

export const LOGIN_TRANSACTION_MAX_LIFETIME_MS = 10 * 60 * 1000;
export const LOGIN_TRANSACTION_CLEANUP_GRACE_MS = 10 * 60 * 1000;
export const LOGIN_TRANSACTION_CLEANUP_MAX = 100;
export const RETURN_PATH_MAX_LENGTH = 2048;
export const PKCE_CODE_VERIFIER_MIN_LENGTH = 43;
export const PKCE_CODE_VERIFIER_MAX_LENGTH = 128;
export const GOOGLE_SUB_MAX_LENGTH = 255;
export const VERIFIED_EMAIL_MAX_LENGTH = 320;
export const SHA256_HEX_LENGTH = 64;

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SQL_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const PKCE_CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;

const invalidInput = (): PersistenceError => new PersistenceError('INVALID_INPUT');

function hasControlCharacters(value: string): boolean {
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

export function validateSha256Hash(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_HEX_PATTERN.test(value)) {
    throw invalidInput();
  }

  return value;
}

export function validateUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw invalidInput();
  }

  return value;
}

export function validateGoogleSub(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > GOOGLE_SUB_MAX_LENGTH ||
    hasControlCharacters(value) ||
    value.trim() !== value
  ) {
    throw invalidInput();
  }

  return value;
}

export function validateVerifiedGoogleEmail(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > VERIFIED_EMAIL_MAX_LENGTH ||
    hasControlCharacters(value) ||
    value.trim() !== value
  ) {
    throw invalidInput();
  }

  return value;
}

export function validatePkceCodeVerifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < PKCE_CODE_VERIFIER_MIN_LENGTH ||
    value.length > PKCE_CODE_VERIFIER_MAX_LENGTH ||
    !PKCE_CODE_VERIFIER_PATTERN.test(value)
  ) {
    throw invalidInput();
  }

  return value;
}

export function validateReturnPath(value: unknown): string {
  const returnPath = value === undefined ? '/' : value;

  // Accept an application-relative path only. Scheme-relative URLs, backslashes,
  // and control characters are rejected so stored callback state cannot later
  // become an external redirect target.
  if (
    typeof returnPath !== 'string' ||
    returnPath.length === 0 ||
    returnPath.length > RETURN_PATH_MAX_LENGTH ||
    !returnPath.startsWith('/') ||
    returnPath.startsWith('//') ||
    returnPath.includes('\\') ||
    hasControlCharacters(returnPath)
  ) {
    throw invalidInput();
  }

  return returnPath;
}

export function validateSchemaIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !SQL_IDENTIFIER_PATTERN.test(value)) {
    throw invalidInput();
  }

  return value;
}

export function validateDate(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw invalidInput();
  }

  return new Date(value.getTime());
}

export function validateLoginTransactionTimes(createdAt: Date, expiresAt: Date): void {
  const createdMilliseconds = createdAt.getTime();
  const expiresMilliseconds = expiresAt.getTime();

  if (
    expiresMilliseconds <= createdMilliseconds ||
    expiresMilliseconds - createdMilliseconds > LOGIN_TRANSACTION_MAX_LIFETIME_MS
  ) {
    throw invalidInput();
  }
}

export function validateSessionTimes(
  createdAt: Date,
  lastActivityAt: Date,
  idleExpiresAt: Date,
  absoluteExpiresAt: Date,
): void {
  // These relationships make the absolute deadline a hard ceiling. Neither
  // delayed activity nor a future clock value can construct a session whose
  // idle window outlives its maximum lifetime.
  if (
    createdAt.getTime() > lastActivityAt.getTime() ||
    lastActivityAt.getTime() > idleExpiresAt.getTime() ||
    idleExpiresAt.getTime() > absoluteExpiresAt.getTime() ||
    createdAt.getTime() >= absoluteExpiresAt.getTime()
  ) {
    throw invalidInput();
  }
}

export function validateCleanupLimit(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > LOGIN_TRANSACTION_CLEANUP_MAX
  ) {
    throw invalidInput();
  }

  return value;
}

export function validateClock(clock: () => Date): Date {
  return validateDate(clock());
}
