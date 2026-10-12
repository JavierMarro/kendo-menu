/**
 * Runtime validation performed before values reach SQL.
 *
 * These checks produce the persistence module's fixed typed errors. Matching
 * database constraints remain deliberate defense in depth for direct SQL,
 * concurrency, or future callers that do not pass through this implementation.
 */
import { PersistenceError } from './contracts.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const invalidInput = (): PersistenceError => new PersistenceError('INVALID_INPUT');

export function validateUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
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

export function validateClock(clock: () => Date): Date {
  return validateDate(clock());
}
