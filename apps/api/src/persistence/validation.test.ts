import { describe, expect, it } from 'vitest';

import { PersistenceError } from './contracts.js';
import {
  LOGIN_TRANSACTION_MAX_LIFETIME_MS,
  validateCleanupLimit,
  validateDate,
  validateGoogleSub,
  validateLoginTransactionTimes,
  validatePkceCodeVerifier,
  validateReturnPath,
  validateSchemaIdentifier,
  validateSessionTimes,
  validateSha256Hash,
  validateUuid,
  validateVerifiedGoogleEmail,
  validateClock,
} from './validation.js';

const HASH = 'a'.repeat(64);
const UUID = '00000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-09-10T10:00:00.000Z');

function expectInvalid(action: () => unknown): void {
  expect(action).toThrowError(PersistenceError);
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(PersistenceError);
    if (error instanceof PersistenceError) {
      expect(error.code).toBe('INVALID_INPUT');
      expect(error.message).toBe('Persistence input is invalid');
    }
  }
}

describe('persistence input validation', () => {
  it('accepts lowercase SHA-256 hashes and canonical UUIDs only', () => {
    expect(validateSha256Hash(HASH)).toBe(HASH);
    expect(validateUuid(UUID)).toBe(UUID);
    expectInvalid(() => validateSha256Hash(HASH.toUpperCase()));
    expectInvalid(() => validateSha256Hash('a'.repeat(63)));
    expectInvalid(() => validateUuid('not-a-uuid'));
  });

  it('bounds identity metadata without treating email as identity', () => {
    expect(validateGoogleSub('google-subject')).toBe('google-subject');
    expect(validateVerifiedGoogleEmail('practitioner@example.com')).toBe(
      'practitioner@example.com',
    );
    expectInvalid(() => validateGoogleSub(' google-subject'));
    expectInvalid(() => validateGoogleSub('google\nsubject'));
    expectInvalid(() => validateVerifiedGoogleEmail(''));
    expectInvalid(() => validateVerifiedGoogleEmail(`a${'x'.repeat(320)}@example.com`));
  });

  it('accepts RFC 7636 verifier bounds and rejects malformed verifiers', () => {
    expect(validatePkceCodeVerifier('a'.repeat(43))).toBe('a'.repeat(43));
    expect(validatePkceCodeVerifier('a'.repeat(128))).toBe('a'.repeat(128));
    expectInvalid(() => validatePkceCodeVerifier('a'.repeat(42)));
    expectInvalid(() => validatePkceCodeVerifier(`${'a'.repeat(42)}!`));
  });

  it('defaults return paths to root and rejects external or unsafe paths', () => {
    expect(validateReturnPath(undefined)).toBe('/');
    expect(validateReturnPath('/app/dashboard?tab=library')).toBe('/app/dashboard?tab=library');
    expect(validateReturnPath(`/${'a'.repeat(2047)}`)).toHaveLength(2048);
    expectInvalid(() => validateReturnPath('//example.com'));
    expectInvalid(() => validateReturnPath('/app\\redirect'));
    expectInvalid(() => validateReturnPath(`/${'a'.repeat(2048)}`));
    expectInvalid(() => validateReturnPath('/app\u0000path'));
  });

  it('accepts bounded schema identifiers and rejects injection-shaped names', () => {
    expect(validateSchemaIdentifier('test_schema_1')).toBe('test_schema_1');
    expectInvalid(() => validateSchemaIdentifier('TestSchema'));
    expectInvalid(() => validateSchemaIdentifier('schema;drop table users'));
    expectInvalid(() => validateSchemaIdentifier(''));
  });

  it('clones valid dates and rejects invalid dates', () => {
    const validated = validateDate(NOW);
    expect(validated).toEqual(NOW);
    expect(validated).not.toBe(NOW);
    expectInvalid(() => validateDate(new Date(Number.NaN)));
    expectInvalid(() => validateDate('2026-09-10T10:00:00.000Z'));
  });

  it('keeps login transaction lifetime within ten minutes', () => {
    const expiresAt = new Date(NOW.getTime() + LOGIN_TRANSACTION_MAX_LIFETIME_MS);
    expect(() => validateLoginTransactionTimes(NOW, expiresAt)).not.toThrow();
    expectInvalid(() =>
      validateLoginTransactionTimes(
        NOW,
        new Date(NOW.getTime() + LOGIN_TRANSACTION_MAX_LIFETIME_MS + 1),
      ),
    );
    expectInvalid(() => validateLoginTransactionTimes(NOW, NOW));
  });

  it('enforces session timestamp ordering without a fixed duration policy', () => {
    const lastActivityAt = new Date(NOW.getTime() + 1_000);
    const idleExpiresAt = new Date(NOW.getTime() + 60 * 24 * 60 * 60 * 1_000);
    const absoluteExpiresAt = new Date(NOW.getTime() + 365 * 24 * 60 * 60 * 1_000);
    expect(() =>
      validateSessionTimes(NOW, lastActivityAt, idleExpiresAt, absoluteExpiresAt),
    ).not.toThrow();
    expectInvalid(() =>
      validateSessionTimes(NOW, idleExpiresAt, lastActivityAt, absoluteExpiresAt),
    );
    expectInvalid(() => validateSessionTimes(NOW, lastActivityAt, idleExpiresAt, NOW));
  });

  it('bounds cleanup batches and validates the injected clock', () => {
    expect(validateCleanupLimit(1)).toBe(1);
    expect(validateCleanupLimit(100)).toBe(100);
    expectInvalid(() => validateCleanupLimit(0));
    expectInvalid(() => validateCleanupLimit(101));
    expectInvalid(() => validateCleanupLimit(1.5));
    expect(validateClock(() => NOW)).toEqual(NOW);
    expectInvalid(() => validateClock(() => new Date(Number.NaN)));
  });
});
