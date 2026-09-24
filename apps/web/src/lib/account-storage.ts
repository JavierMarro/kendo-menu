/**
 * Account-scoped IndexedDB adapter for the Zustand workspace cache.
 * A server-issued internal user ID selects the cache only after session verification; the old
 * LocalStorage value is a migration source, never proof of authentication or cloud acknowledgement.
 * Ordered writes and readback distinguish a durable device save from an in-memory store update.
 */
import {
  classifyTrainingStorageValue,
  type StateStorage,
  type TrainingStorageInspection,
} from '@kendo-menu/store';

import {
  type WorkspaceCoordinationAvailability,
  type WorkspaceCoordinator,
} from './workspace-coordination';
import {
  type AccountCacheVersion,
  type AccountDatabase,
  createIndexedDbAccountDatabase,
} from './account-database';

export type {
  AccountCacheRecord,
  AccountCacheVersion,
  AccountCompareAndSwapResult,
  AccountDatabase,
  AccountMetadataKind,
  AccountPayloadKind,
  AccountPayloadRecord,
  AccountRecoveryRecord,
} from './account-database';

export const TRAINING_STORAGE_KEY = 'kendo-menu';
export const ACCOUNT_STORAGE_KEY_PREFIX = 'kendo-menu:account:';
export const ACCOUNT_SYNC_STORAGE_SUFFIX = ':sync';
export const ACCOUNT_SYNC_METADATA_VERSION = 1 as const;
export const ACCOUNT_SYNC_METADATA_MAX_CHARACTERS = 512;

const INTERNAL_USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ACCOUNT_STORAGE_KEY_PATTERN = new RegExp(
  `^${ACCOUNT_STORAGE_KEY_PREFIX}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
  'u',
);

export type AccountStorageFailureCode =
  | 'invalid-account-id'
  | 'invalid-storage-key'
  | 'invalid-persisted-value'
  | 'malformed-metadata'
  | 'unsupported-metadata-version'
  | 'quota'
  | 'unavailable'
  | 'malformed-readback'
  | 'interrupted';

export type AccountStorageOperation = 'read' | 'write' | 'remove' | 'metadata';

export class AccountStorageError extends Error {
  readonly code: AccountStorageFailureCode;
  readonly operation: AccountStorageOperation;
  readonly causeValue: unknown;

  constructor(
    code: AccountStorageFailureCode,
    operation: AccountStorageOperation,
    message: string,
    causeValue: unknown = undefined,
  ) {
    super(message);
    this.name = 'AccountStorageError';
    this.code = code;
    this.operation = operation;
    this.causeValue = causeValue;
  }
}

export interface AccountSyncMetadataV1 {
  readonly version: typeof ACCOUNT_SYNC_METADATA_VERSION;
  readonly accountId: string;
}

export type AccountSyncMetadata = AccountSyncMetadataV1;

export interface AccountStorageOptions {
  readonly accountId: unknown;
  readonly storage: StateStorage;
  readonly database?: AccountDatabase;
  readonly coordination?: WorkspaceCoordinator;
  readonly onWriteFailure?: (error: AccountStorageError) => void;
}

export interface AccountStorageController extends StateStorage {
  readonly accountId: string;
  readonly cacheKey: string;
  readonly metadataKey: string;
  readonly confirmedCacheValue: string | null | undefined;
  readonly coordinationAvailability: WorkspaceCoordinationAvailability;
  readonly coordinationAvailable: boolean;
  readonly disable: () => void;
  readonly isEnabled: () => boolean;
  readonly lastFailure: AccountStorageError | null;
  readonly lastRecoveryFailure: AccountStorageError | null;
  readonly flush: () => Promise<void>;
  readonly readSyncMetadata: () => AccountSyncMetadata | null | Promise<AccountSyncMetadata | null>;
  readonly initializeSyncMetadata: () => AccountSyncMetadata | Promise<AccountSyncMetadata>;
  readonly confirmCurrentValue: (rawValue: string) => void | Promise<void>;
  readonly migrateLegacy: () => Promise<void>;
  readonly preserveLegacyDivergence: (observedValue?: string | null) => Promise<void>;
}

type MaybePromise<T> = T | Promise<T>;

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return typeof (value as { readonly then?: unknown }).then === 'function';
}

function mapAsync<T, U>(
  value: MaybePromise<T>,
  callback: (resolved: T) => MaybePromise<U>,
): MaybePromise<U> {
  if (isPromiseLike(value)) {
    return Promise.resolve(value).then(callback);
  }
  return callback(value);
}

function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = (error as { readonly name?: unknown }).name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

function isInterruptionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = (error as { readonly name?: unknown }).name;
  return name === 'AbortError' || name === 'InterruptedError';
}

function mapStorageError(error: unknown, operation: AccountStorageOperation): AccountStorageError {
  if (error instanceof AccountStorageError) {
    return error;
  }
  if (isQuotaError(error)) {
    return new AccountStorageError(
      'quota',
      operation,
      'The account workspace exceeded the browser storage quota.',
      error,
    );
  }
  if (isInterruptionError(error)) {
    return new AccountStorageError(
      'interrupted',
      operation,
      'The account workspace operation was interrupted.',
      error,
    );
  }
  return new AccountStorageError(
    'unavailable',
    operation,
    'The browser did not allow account workspace storage access.',
    error,
  );
}

function runStorageOperation<T>(
  operation: AccountStorageOperation,
  action: () => MaybePromise<T>,
): MaybePromise<T> {
  try {
    const result = action();
    return isPromiseLike(result)
      ? Promise.resolve(result).catch((error: unknown) => {
          throw mapStorageError(error, operation);
        })
      : result;
  } catch (error) {
    throw mapStorageError(error, operation);
  }
}

function assertCanonicalAccountId(value: unknown): string {
  if (!isCanonicalInternalUserId(value)) {
    throw new AccountStorageError(
      'invalid-account-id',
      'read',
      'Account storage requires the canonical internal user UUID.',
    );
  }
  return value;
}

function assertAccountCacheKey(name: string, expected: string): void {
  if (name !== expected || !ACCOUNT_STORAGE_KEY_PATTERN.test(name)) {
    throw new AccountStorageError(
      'invalid-storage-key',
      'read',
      'Account persistence can access only its exact account cache key.',
    );
  }
}

function classifyAccountCacheValue(raw: string | null): TrainingStorageInspection {
  if (raw === undefined) {
    throw new AccountStorageError(
      'unavailable',
      'read',
      'The browser did not return an account cache value.',
    );
  }
  const inspection = classifyTrainingStorageValue(raw);
  if (inspection.status !== 'empty' && inspection.status !== 'ready') {
    throw new AccountStorageError(
      'invalid-persisted-value',
      'read',
      'The account cache is malformed, oversized, or uses an unsupported persistence version.',
    );
  }
  return inspection;
}

function assertSyncMetadataShape(value: unknown): asserts value is AccountSyncMetadataV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AccountStorageError(
      'malformed-metadata',
      'metadata',
      'Account synchronization metadata must be an object.',
    );
  }
  const record = value as Record<string, unknown>;
  try {
    if (
      Object.keys(record).length !== 2 ||
      !Object.hasOwn(record, 'version') ||
      !Object.hasOwn(record, 'accountId')
    ) {
      throw new AccountStorageError(
        'malformed-metadata',
        'metadata',
        'Account synchronization metadata contains unsupported fields.',
      );
    }
    if (record['version'] !== ACCOUNT_SYNC_METADATA_VERSION) {
      throw new AccountStorageError(
        'unsupported-metadata-version',
        'metadata',
        'Account synchronization metadata uses an unsupported version.',
      );
    }
    if (!isCanonicalInternalUserId(record['accountId'])) {
      throw new AccountStorageError(
        'malformed-metadata',
        'metadata',
        'Account synchronization metadata does not contain a canonical account ID.',
      );
    }
  } catch (error) {
    if (error instanceof AccountStorageError) {
      throw error;
    }
    throw new AccountStorageError(
      'malformed-metadata',
      'metadata',
      'Account synchronization metadata could not be inspected safely.',
      error,
    );
  }
}

export function isCanonicalInternalUserId(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && INTERNAL_USER_ID_PATTERN.test(value);
}

export function deriveAccountStorageKey(accountId: unknown): string {
  return `${ACCOUNT_STORAGE_KEY_PREFIX}${assertCanonicalAccountId(accountId)}`;
}

export function deriveAccountSyncStorageKey(accountId: unknown): string {
  return `${deriveAccountStorageKey(accountId)}${ACCOUNT_SYNC_STORAGE_SUFFIX}`;
}

export function parseAccountSyncMetadata(raw: unknown): AccountSyncMetadataV1 | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== 'string' || raw.length > ACCOUNT_SYNC_METADATA_MAX_CHARACTERS) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  try {
    assertSyncMetadataShape(parsed);
  } catch {
    return null;
  }
  return parsed;
}

function parseStoredMetadata(raw: string | null, accountId: string): AccountSyncMetadataV1 | null {
  if (raw === null) {
    return null;
  }
  if (raw.length > ACCOUNT_SYNC_METADATA_MAX_CHARACTERS) {
    throw new AccountStorageError(
      'malformed-metadata',
      'metadata',
      'Account synchronization metadata exceeds its bounded size.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new AccountStorageError(
      'malformed-metadata',
      'metadata',
      'Account synchronization metadata is not valid JSON.',
      error,
    );
  }
  assertSyncMetadataShape(parsed);
  if (parsed.accountId !== accountId) {
    throw new AccountStorageError(
      'malformed-metadata',
      'metadata',
      'Account synchronization metadata belongs to a different account.',
    );
  }
  return parsed;
}

function exactReadback(
  storage: StateStorage,
  key: string,
  expected: string | null,
): MaybePromise<void> {
  const read = storage.getItem(key);
  return mapAsync(read, (actual) => {
    if (actual !== expected) {
      throw new AccountStorageError(
        'malformed-readback',
        expected === null ? 'remove' : 'write',
        'The browser changed or could not confirm the account workspace write.',
      );
    }
  });
}

function removeAndConfirm(storage: StateStorage, key: string): MaybePromise<void> {
  const remove = storage.removeItem(key);
  return mapAsync(remove, () => exactReadback(storage, key, null));
}

function runWithCoordination<T>(
  coordination: WorkspaceCoordinator | undefined,
  accountId: string,
  action: () => MaybePromise<T>,
): MaybePromise<T> {
  if (coordination === undefined || !coordination.isAvailable) {
    return action();
  }
  let entered = false;
  return coordination
    .withLock({ kind: 'account', accountId }, () => {
      entered = true;
      return action();
    })
    .catch((error: unknown) => {
      // A failed lock acquisition did not attempt a commit. Keep local persistence
      // available, while the coordinator explicitly reports synchronization unavailable.
      // Never retry an operation that might already have changed storage.
      if (!entered && !coordination.isAvailable) return action();
      throw error;
    });
}

export function readAccountSyncMetadata(
  storage: StateStorage,
  accountId: unknown,
): AccountSyncMetadataV1 | null | Promise<AccountSyncMetadataV1 | null> {
  const checkedAccountId = assertCanonicalAccountId(accountId);
  const key = deriveAccountSyncStorageKey(checkedAccountId);
  return runStorageOperation('metadata', () => {
    const raw = storage.getItem(key);
    return mapAsync(raw, (value) => parseStoredMetadata(value, checkedAccountId));
  });
}

export function createAccountSyncMetadata(accountId: unknown): AccountSyncMetadataV1 {
  const checkedAccountId = assertCanonicalAccountId(accountId);
  return { version: ACCOUNT_SYNC_METADATA_VERSION, accountId: checkedAccountId };
}

export function createAccountStorage(options: AccountStorageOptions): AccountStorageController {
  const accountId = assertCanonicalAccountId(options.accountId);
  const cacheKey = deriveAccountStorageKey(accountId);
  const metadataKey = deriveAccountSyncStorageKey(accountId);
  const coordination = options.coordination;
  const database = options.database ?? createIndexedDbAccountDatabase();
  let enabled = true;
  let lastFailure: AccountStorageError | null = null;
  let lastRecoveryFailure: AccountStorageError | null = null;
  let writerFailed = false;
  let expectedCache: string | null | undefined;
  let expectedVersion: AccountCacheVersion | null | undefined;
  let writeTail: Promise<void> | undefined;
  const pendingWrites = new Set<Promise<void>>();
  let writeFailureReported = false;

  const assertEnabled = (operation: AccountStorageOperation): void => {
    if (!enabled) {
      throw new AccountStorageError(
        'interrupted',
        operation,
        'The account workspace persistence writer has been disabled.',
      );
    }
    if (operation !== 'read' && lastFailure !== null) throw lastFailure;
  };

  const reportWriteFailure = (error: unknown): never => {
    const mapped = mapStorageError(error, 'write');
    lastFailure = mapped;
    writerFailed = true;
    if (!writeFailureReported) {
      writeFailureReported = true;
      try {
        options.onWriteFailure?.(mapped);
      } catch {
        // A diagnostic callback cannot replace the typed persistence failure.
      }
    }
    throw mapped;
  };

  const trackWrite = (result: Promise<void>): Promise<void> => {
    pendingWrites.add(result);
    void result.then(
      () => {
        pendingWrites.delete(result);
      },
      () => {
        pendingWrites.delete(result);
      },
    );
    // The storage API remains rejectable for callers that await it, while this attached handler
    // prevents a fire-and-forget Zustand persistence write from becoming an unhandled rejection.
    void result.catch(() => undefined);
    return result;
  };

  const sequenceWrite = (action: () => MaybePromise<void>): MaybePromise<void> => {
    // Zustand may issue writes without awaiting earlier ones. Preserve their order so an older
    // async completion cannot become the final cache value after a newer edit.
    const result = writeTail === undefined ? action() : writeTail.then(action);
    if (!isPromiseLike(result)) return result;
    const pending = Promise.resolve(result);
    writeTail = pending;
    void pending.then(
      () => {
        if (writeTail === pending) writeTail = undefined;
      },
      () => {
        if (writeTail === pending) writeTail = undefined;
      },
    );
    return pending;
  };

  const scopedRead = (): MaybePromise<string | null> => {
    assertEnabled('read');
    return runStorageOperation('read', () =>
      database.readCache(accountId).then((record) => {
        assertEnabled('read');
        const value = record?.cacheValue ?? null;
        classifyAccountCacheValue(value);
        if (
          expectedVersion !== undefined &&
          ((record === null && expectedVersion !== null) ||
            (record !== null &&
              (expectedVersion === null ||
                record.identity !== expectedVersion.identity ||
                record.generation !== expectedVersion.generation)))
        ) {
          throw new AccountStorageError(
            'interrupted',
            'read',
            'The account cache changed during hydration.',
          );
        }
        expectedCache = value;
        expectedVersion =
          record === null ? null : { identity: record.identity, generation: record.generation };
        return value;
      }),
    );
  };

  // Keep Zustand's immediate update while refusing to overwrite a cache changed by another tab.
  // The database checks the expected identity/generation in the transaction, not in this caller.
  const scopedWrite = (value: string): MaybePromise<void> => {
    assertEnabled('write');
    const inspection = classifyAccountCacheValue(value);
    if (inspection.status !== 'ready') {
      throw new AccountStorageError(
        'invalid-persisted-value',
        'write',
        'An account cache write must contain a validated v10 dashboard envelope.',
      );
    }
    return runStorageOperation('write', () =>
      runWithCoordination(coordination, accountId, () => {
        assertEnabled('write');
        return database
          .compareAndSwapCache(accountId, expectedVersion ?? null, value)
          .then((result) => {
            assertEnabled('write');
            if (result.status !== 'committed' || result.record === null) {
              throw new AccountStorageError(
                'interrupted',
                'write',
                'Another workspace changed the account cache.',
              );
            }
            if (result.record.cacheValue !== value) {
              throw new AccountStorageError(
                'malformed-readback',
                'write',
                'The IndexedDB cache readback did not match the requested value.',
              );
            }
            expectedCache = result.record.cacheValue;
            expectedVersion = {
              identity: result.record.identity,
              generation: result.record.generation,
            };
          });
      }),
    );
  };

  const scopedRemove = (): MaybePromise<void> => {
    assertEnabled('remove');
    return runStorageOperation('remove', () =>
      runWithCoordination(coordination, accountId, () => {
        assertEnabled('remove');
        return database
          .compareAndSwapCache(accountId, expectedVersion ?? null, null)
          .then((result) => {
            assertEnabled('remove');
            if (result.status !== 'committed') {
              throw new AccountStorageError(
                'interrupted',
                'remove',
                'Another workspace changed the account cache.',
              );
            }
            expectedCache = null;
            expectedVersion = null;
          });
      }),
    );
  };

  const ensureUnknownAcknowledgement = async (): Promise<void> => {
    const existing = await database.readMetadata(accountId, 'ack');
    if (existing === null)
      await database.writeMetadata(accountId, 'ack', { version: 1, status: 'unknown' });
  };

  const retainLegacyIfDivergent = async (legacy: string | null): Promise<void> => {
    if (legacy === null) {
      lastRecoveryFailure = null;
      return;
    }
    if (classifyTrainingStorageValue(legacy).status !== 'ready') {
      lastRecoveryFailure = new AccountStorageError(
        'invalid-persisted-value',
        'write',
        'The legacy account value could not be validated for recovery.',
      );
      return;
    }
    const current = await database.readCache(accountId);
    if (current !== null && current.cacheValue !== legacy) {
      try {
        await database.writeRecovery(accountId, legacy);
        lastRecoveryFailure = null;
      } catch (error) {
        lastRecoveryFailure = mapStorageError(error, 'write');
        throw lastRecoveryFailure;
      }
    } else lastRecoveryFailure = null;
  };

  // Cut over only after the account is verified. Retain the legacy source whenever coordination,
  // validation, or IndexedDB readback cannot establish that its content is safely preserved.
  const migrateLegacy = async (): Promise<void> => {
    assertEnabled('read');
    await runStorageOperation('read', async () =>
      runWithCoordination(coordination, accountId, async () => {
        assertEnabled('read');
        const current = await database.readCache(accountId);
        const legacy = await options.storage.getItem(cacheKey);
        // LocalStorage has no atomic compare/remove. Keep the legacy source when
        // coordination fell back without the shared 6B account Web Lock.
        const canCleanLegacy = coordination?.isAvailable === true;
        if (legacy !== null) {
          const inspection = classifyTrainingStorageValue(legacy);
          if (inspection.status !== 'ready') {
            await retainLegacyIfDivergent(legacy);
            if (current === null) classifyAccountCacheValue(legacy);
          } else if (current === null) {
            const migrated = await database.migrateCacheIfAbsent(accountId, legacy);
            if (migrated.cacheValue === legacy) {
              const confirmed = await database.readCache(accountId);
              if (
                confirmed === null ||
                confirmed.cacheValue !== legacy ||
                confirmed.identity !== migrated.identity ||
                confirmed.generation !== migrated.generation
              ) {
                throw new AccountStorageError(
                  'malformed-readback',
                  'write',
                  'The migrated account cache did not read back exactly.',
                );
              }
              const latestLegacy = await options.storage.getItem(cacheKey);
              if (latestLegacy === legacy && canCleanLegacy)
                await removeAndConfirm(options.storage, cacheKey);
              else await retainLegacyIfDivergent(latestLegacy);
            } else {
              await retainLegacyIfDivergent(legacy);
            }
          } else if (current.cacheValue !== legacy) {
            await retainLegacyIfDivergent(legacy);
            const latestLegacy = await options.storage.getItem(cacheKey);
            if (latestLegacy !== legacy) await retainLegacyIfDivergent(latestLegacy);
          } else {
            const latestLegacy = await options.storage.getItem(cacheKey);
            if (latestLegacy === legacy && canCleanLegacy)
              await removeAndConfirm(options.storage, cacheKey);
            else await retainLegacyIfDivergent(latestLegacy);
          }
        }
        await ensureUnknownAcknowledgement();
        const record = await database.readCache(accountId);
        expectedCache = record?.cacheValue ?? null;
        expectedVersion =
          record === null ? null : { identity: record.identity, generation: record.generation };
      }),
    );
  };

  const preserveLegacyDivergence = async (observedValue?: string | null): Promise<void> => {
    assertEnabled('read');
    await runStorageOperation('read', async () =>
      runWithCoordination(coordination, accountId, async () => {
        // The event's value can have been removed by migration before this callback runs.
        // Preserve that validated observation even when the key is now absent.
        const legacy =
          observedValue === undefined ? await options.storage.getItem(cacheKey) : observedValue;
        await retainLegacyIfDivergent(legacy);
      }),
    );
  };

  const controller: AccountStorageController = {
    accountId,
    cacheKey,
    metadataKey,
    get confirmedCacheValue() {
      return expectedCache;
    },
    get coordinationAvailability() {
      return coordination?.availability ?? 'unavailable';
    },
    get coordinationAvailable() {
      return coordination?.isAvailable ?? false;
    },
    getItem: (name) => {
      try {
        assertAccountCacheKey(name, cacheKey);
        return scopedRead();
      } catch (error) {
        throw mapStorageError(error, 'read');
      }
    },
    setItem: (name, value) => {
      if (!enabled || writerFailed) {
        return;
      }
      try {
        assertAccountCacheKey(name, cacheKey);
        const result = sequenceWrite(() => scopedWrite(value));
        if (isPromiseLike(result)) {
          const tracked = Promise.resolve(result).catch((error: unknown) =>
            reportWriteFailure(error),
          );
          return trackWrite(tracked);
        }
        return result;
      } catch (error) {
        return reportWriteFailure(error);
      }
    },
    removeItem: (name) => {
      if (!enabled || writerFailed) {
        return;
      }
      try {
        assertAccountCacheKey(name, cacheKey);
        const result = sequenceWrite(scopedRemove);
        if (isPromiseLike(result)) {
          const tracked = Promise.resolve(result).catch((error: unknown) =>
            reportWriteFailure(error),
          );
          return trackWrite(tracked);
        }
        return result;
      } catch (error) {
        return reportWriteFailure(error);
      }
    },
    disable: () => {
      enabled = false;
    },
    isEnabled: () => enabled,
    get lastFailure() {
      return lastFailure;
    },
    get lastRecoveryFailure() {
      return lastRecoveryFailure;
    },
    flush: async () => {
      while (pendingWrites.size > 0) {
        await Promise.all([...pendingWrites]);
      }
      if (lastFailure !== null) {
        throw lastFailure;
      }
    },
    readSyncMetadata: () => {
      assertEnabled('metadata');
      return readAccountSyncMetadata(options.storage, accountId);
    },
    initializeSyncMetadata: () => {
      assertEnabled('metadata');
      const metadata = createAccountSyncMetadata(accountId);
      // Never replace existing metadata for a different account or future version. A fresh
      // workspace receives its marker only after the stored value has been inspected.
      return runStorageOperation('metadata', () => {
        const existing = options.storage.getItem(metadataKey);
        return mapAsync(existing, (raw) => {
          assertEnabled('metadata');
          return parseStoredMetadata(raw, accountId) ?? metadata;
        });
      });
    },
    confirmCurrentValue: (rawValue) => {
      assertEnabled('write');
      if (lastFailure !== null) {
        throw lastFailure;
      }
      classifyAccountCacheValue(rawValue);
      const result = database
        .readCache(accountId)
        .then((record) => {
          if (record?.cacheValue !== rawValue)
            throw new AccountStorageError(
              'malformed-readback',
              'write',
              'The account cache did not match the confirmed value.',
            );
          expectedCache = rawValue;
          expectedVersion = { identity: record.identity, generation: record.generation };
        })
        .catch((error: unknown) => reportWriteFailure(error));
      return trackWrite(result);
    },
    migrateLegacy,
    preserveLegacyDivergence,
  };

  return controller;
}
