/**
 * Shared error and clock primitives for managed persistence adapters.
 * PersistenceError uses fixed non-sensitive messages so database details stay behind the adapter.
 */

export type PersistenceErrorCode = 'INVALID_INPUT' | 'CONFLICT' | 'UNAVAILABLE' | 'FAILED';

const PERSISTENCE_ERROR_MESSAGES: Record<PersistenceErrorCode, string> = {
  INVALID_INPUT: 'Persistence input is invalid',
  CONFLICT: 'Persistence conflict',
  UNAVAILABLE: 'Persistence storage is unavailable',
  FAILED: 'Persistence operation failed',
};

/** A stable, non-sensitive error surface for persistence failures. */
export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode) {
    super(PERSISTENCE_ERROR_MESSAGES[code]);
    this.name = 'PersistenceError';
    this.code = code;
  }
}

export type PersistenceClock = () => Date;
