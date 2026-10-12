/**
 * Pure validation tests for values accepted by the persistence interface before
 * any PostgreSQL operation is attempted.
 *
 * Boundary values cover the current managed persistence adapter inputs.
 */
import { describe, expect, it } from 'vitest';

import { PersistenceError } from './contracts.js';
import { validateClock, validateDate, validateUuid } from './validation.js';

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
  it('accepts canonical UUIDs only', () => {
    expect(validateUuid(UUID)).toBe(UUID);
    expectInvalid(() => validateUuid('not-a-uuid'));
  });

  it('clones valid dates and validates the injected clock', () => {
    const validated = validateDate(NOW);
    expect(validated).toEqual(NOW);
    expect(validated).not.toBe(NOW);
    expectInvalid(() => validateDate(new Date(Number.NaN)));
    expectInvalid(() => validateDate('2026-09-10T10:00:00.000Z'));
    expect(validateClock(() => NOW)).toEqual(NOW);
    expectInvalid(() => validateClock(() => new Date(Number.NaN)));
  });
});
