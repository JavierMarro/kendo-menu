/**
 * Provides the guest workspace's browser-storage and recovery boundary.
 * Zustand updates memory immediately, but explicit flush and readback checks decide whether
 * those edits were confirmed on this device. Recovery can swap the backing adapter without
 * changing the store reference used by the UI.
 */
import {
  classifyTrainingStorageValue,
  serializePersistedTrainingStateV10,
  type StateStorage,
  type TrainingStorageInspection,
} from '@kendo-menu/store';

import { guestWorkspaceScope, type WorkspaceCoordinator } from './workspace-coordination';

export const TRAINING_STORAGE_KEY = 'kendo-menu';

export type PersistenceInspection =
  | { readonly status: 'empty' }
  | { readonly status: 'ready'; readonly raw: string }
  | { readonly status: 'corrupt'; readonly raw: string; readonly reason: string }
  | { readonly status: 'future-version'; readonly raw: string; readonly version: number }
  | { readonly status: 'unavailable'; readonly reason: string };

export interface BrowserStorageOptions {
  readonly onReadError?: () => void;
  readonly onWriteError?: () => void;
  readonly onWriteFailure?: (error: BrowserStorageError) => void;
  readonly onPendingChange?: (pending: boolean) => void;
  readonly initialValues?: Readonly<Record<string, string | null>>;
  readonly storage?: StateStorage;
  readonly coordination?: WorkspaceCoordinator;
}

export type BrowserStorageFailureCode =
  'quota' | 'unavailable' | 'malformed-readback' | 'invalid-persisted-value' | 'interrupted';

export class BrowserStorageError extends Error {
  readonly code: BrowserStorageFailureCode;
  readonly operation: 'read' | 'write' | 'remove';
  readonly causeValue: unknown;

  constructor(
    code: BrowserStorageFailureCode,
    operation: 'read' | 'write' | 'remove',
    message: string,
    causeValue: unknown = undefined,
  ) {
    super(message);
    this.name = 'BrowserStorageError';
    this.code = code;
    this.operation = operation;
    this.causeValue = causeValue;
  }
}

export interface BrowserTrainingStorage extends StateStorage {
  readonly disable: () => void;
  readonly isEnabled: () => boolean;
  readonly isPending: () => boolean;
  readonly lastFailure: BrowserStorageError | null;
  readonly flush: () => Promise<void>;
}

export interface TrainingStorageController extends BrowserTrainingStorage {
  readonly replace: (storage: StateStorage) => void;
}

type MaybePromise<T> = T | Promise<T>;

interface LifecycleStorage extends StateStorage {
  readonly disable?: () => void;
  readonly isEnabled?: () => boolean;
  readonly isPending?: () => boolean;
  readonly lastFailure?: BrowserStorageError | null;
  readonly flush?: () => Promise<void>;
}

function asLifecycleStorage(storage: StateStorage): LifecycleStorage {
  return storage;
}

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return typeof value === 'object' && value !== null && 'then' in value;
}

function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { readonly name?: unknown }).name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

function isInterruptionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { readonly name?: unknown }).name;
  return name === 'AbortError' || name === 'InterruptedError';
}

function mapBrowserStorageError(
  error: unknown,
  operation: 'read' | 'write' | 'remove',
): BrowserStorageError {
  if (error instanceof BrowserStorageError) return error;
  if (isQuotaError(error)) {
    return new BrowserStorageError(
      'quota',
      operation,
      'The browser storage quota was exceeded.',
      error,
    );
  }
  if (isInterruptionError(error)) {
    return new BrowserStorageError(
      'interrupted',
      operation,
      'The browser storage operation was interrupted.',
      error,
    );
  }
  return new BrowserStorageError(
    'unavailable',
    operation,
    'The browser did not allow local data access.',
    error,
  );
}

function resolveBrowserStorage(storage: StateStorage | undefined): StateStorage {
  if (storage !== undefined) return storage;
  if (typeof window === 'undefined') {
    throw new BrowserStorageError(
      'unavailable',
      'read',
      'Browser storage is unavailable during server rendering.',
    );
  }
  return window.localStorage;
}

function mapMaybe<T, U>(
  value: MaybePromise<T>,
  callback: (resolved: T) => MaybePromise<U>,
): MaybePromise<U> {
  return isPromiseLike(value) ? Promise.resolve(value).then(callback) : callback(value);
}

function confirmReadback(
  storage: StateStorage,
  key: string,
  expected: string | null,
  operation: 'write' | 'remove',
): MaybePromise<void> {
  return mapMaybe(storage.getItem(key), (actual) => {
    if (actual !== expected) {
      throw new BrowserStorageError(
        'malformed-readback',
        operation,
        'The browser changed or could not confirm the guest workspace write.',
      );
    }
  });
}

function assertGuestBaseline(name: string, value: string | null): void {
  // The initial value was inspected before store creation. Revalidate it here so a recovery
  // writer never treats arbitrary or future-version bytes as its known baseline.
  if (value === null) {
    return;
  }
  const inspection = classifyTrainingStorageValue(value);
  if (
    inspection.status !== 'ready' &&
    inspection.status !== 'migrated' &&
    inspection.status !== 'empty'
  ) {
    throw new BrowserStorageError(
      'invalid-persisted-value',
      'read',
      `The inspected guest workspace value for ${name} is not a validated training envelope.`,
    );
  }
}

function runGuestMutation<T>(
  coordination: WorkspaceCoordinator | undefined,
  operation: () => MaybePromise<T>,
): MaybePromise<T> {
  if (coordination === undefined || !coordination.isAvailable) return operation();
  let entered = false;
  return coordination
    .withLock(guestWorkspaceScope, () => {
      entered = true;
      return operation();
    })
    .catch((error: unknown) => {
      // A failed lock request did not attempt a commit. Keep local guest persistence available
      // while the coordinator reports that cross-tab serialization is unavailable. Never retry
      // after the callback entered because the operation may already have changed storage.
      if (!entered && !coordination.isAvailable) {
        return operation();
      }
      throw error;
    });
}

function mapStorageInspection(
  inspection: TrainingStorageInspection,
  raw: string | null,
): PersistenceInspection {
  switch (inspection.status) {
    case 'empty':
      return { status: 'empty' };
    case 'ready':
    case 'migrated':
      return raw === null ? { status: 'empty' } : { status: 'ready', raw };
    case 'corrupt':
      return {
        status: 'corrupt',
        raw: raw ?? '',
        reason:
          inspection.reason === 'override-migration-conflict'
            ? inspection.detail
            : inspection.reason,
      };
    case 'unsupported-future':
      return { status: 'future-version', raw: raw ?? '', version: inspection.version };
    case 'unavailable':
      return { status: 'unavailable', reason: 'The browser did not allow local data access.' };
  }
}

export function inspectBrowserTrainingStorage(
  storageKey: string = TRAINING_STORAGE_KEY,
): PersistenceInspection {
  if (typeof window === 'undefined') {
    return {
      status: 'unavailable',
      reason: 'Browser storage is unavailable during server rendering.',
    };
  }

  let raw: string | null;

  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    return {
      status: 'unavailable',
      reason: 'The browser did not allow KendoMenu to read local data.',
    };
  }

  if (raw === null) {
    return { status: 'empty' };
  }

  return mapStorageInspection(classifyTrainingStorageValue(raw), raw);
}

export function createBrowserTrainingStorage(
  options: BrowserStorageOptions = {},
): BrowserTrainingStorage {
  let writeFailed = false;
  let enabled = true;
  let lastFailure: BrowserStorageError | null = null;
  const expectedValues = new Map<string, string | null>();
  const pendingWrites = new Set<Promise<void>>();

  if (options.initialValues !== undefined) {
    for (const [name, value] of Object.entries(options.initialValues)) {
      assertGuestBaseline(name, value);
      expectedValues.set(name, value);
    }
  }

  const notifyPendingChange = (pending: boolean): void => {
    try {
      options.onPendingChange?.(pending);
    } catch {
      // A status observer cannot replace the durable-write result.
    }
  };

  const markWriteFailed = (error: unknown, operation: 'write' | 'remove'): void => {
    const mapped = mapBrowserStorageError(error, operation);
    if (!enabled && mapped.code === 'interrupted') {
      return;
    }
    if (writeFailed) {
      return;
    }
    writeFailed = true;
    lastFailure = mapped;
    try {
      options.onWriteError?.();
      options.onWriteFailure?.(mapped);
    } catch {
      // Recovery diagnostics cannot replace the typed storage failure.
    }
  };

  const trackWrite = (result: Promise<void>): Promise<void> => {
    const wasIdle = pendingWrites.size === 0;
    pendingWrites.add(result);
    if (wasIdle) {
      notifyPendingChange(true);
    }
    const removePending = (): void => {
      pendingWrites.delete(result);
      if (pendingWrites.size === 0) {
        notifyPendingChange(false);
      }
    };
    void result.then(removePending, removePending);
    // Zustand does not await StateStorage writes. Keep the rejection observed while exposing
    // the typed failure through flush() and lastFailure for lifecycle callers.
    void result.catch(() => undefined);
    return result;
  };

  const runWrite = (
    name: string,
    value: string,
    operation: 'write' | 'remove',
  ): MaybePromise<void> => {
    if (!enabled || writeFailed) {
      return;
    }
    // Compare the current value with the last value this writer observed. Even with a lock,
    // another tab may have committed since hydration; silently overwriting it would lose data.
    const storage = resolveBrowserStorage(options.storage);
    const expectedValue = expectedValues.get(name);
    const hasExpectedValue = expectedValues.has(name);
    const current = storage.getItem(name);
    const commit = mapMaybe(current, (actual) => {
      if (!enabled) {
        throw new BrowserStorageError(
          'interrupted',
          operation,
          'The guest persistence writer has been disabled.',
        );
      }
      if (writeFailed) {
        return;
      }
      if (hasExpectedValue && actual !== expectedValue) {
        throw new BrowserStorageError(
          'interrupted',
          operation,
          'The guest workspace changed before this write could be committed.',
        );
      }

      const expectedAfterWrite = operation === 'write' ? value : null;
      const write = operation === 'write' ? storage.setItem(name, value) : storage.removeItem(name);
      return mapMaybe(write, () => {
        if (!enabled) {
          throw new BrowserStorageError(
            'interrupted',
            operation,
            'The guest persistence writer has been disabled.',
          );
        }
        if (writeFailed) {
          return;
        }
        return mapMaybe(confirmReadback(storage, name, expectedAfterWrite, operation), () => {
          expectedValues.set(name, expectedAfterWrite);
        });
      });
    });

    if (!isPromiseLike(commit)) {
      return commit;
    }
    return Promise.resolve(commit).catch((error: unknown) => {
      markWriteFailed(error, operation);
      throw error;
    });
  };

  const observeWrite = (result: MaybePromise<void>, operation: 'write' | 'remove'): void => {
    if (!isPromiseLike(result)) return;
    const observed = Promise.resolve(result).catch((error: unknown) => {
      // A stale queued write can be interrupted after recovery switches the backing storage. It
      // must not resurrect guest bytes or replace the recovery UI's current storage failure.
      markWriteFailed(error, operation);
    });
    void trackWrite(observed);
  };

  const browserStorage: BrowserTrainingStorage = {
    getItem: (name) => {
      try {
        if (!enabled) {
          throw new BrowserStorageError(
            'interrupted',
            'read',
            'The guest persistence writer has been disabled.',
          );
        }
        const result = resolveBrowserStorage(options.storage).getItem(name);
        if (isPromiseLike(result)) {
          return Promise.resolve(result).then(
            (value) => {
              const expectedValue = expectedValues.get(name);
              if (expectedValues.has(name) && value !== expectedValue) {
                throw new BrowserStorageError(
                  'interrupted',
                  'read',
                  'The guest workspace changed during hydration.',
                );
              }
              expectedValues.set(name, value);
              return value;
            },
            (error: unknown) => {
              options.onReadError?.();
              throw mapBrowserStorageError(error, 'read');
            },
          );
        }
        const expectedValue = expectedValues.get(name);
        if (expectedValues.has(name) && result !== expectedValue) {
          throw new BrowserStorageError(
            'interrupted',
            'read',
            'The guest workspace changed during hydration.',
          );
        }
        expectedValues.set(name, result);
        return result;
      } catch (error) {
        options.onReadError?.();
        throw error;
      }
    },
    setItem: (name, value) => {
      if (!enabled || writeFailed) {
        return;
      }

      try {
        const result = runGuestMutation(options.coordination, () => runWrite(name, value, 'write'));
        observeWrite(result, 'write');
      } catch (error) {
        markWriteFailed(error, 'write');
      }
    },
    removeItem: (name) => {
      if (!enabled || writeFailed) {
        return;
      }

      try {
        const result = runGuestMutation(options.coordination, () => runWrite(name, '', 'remove'));
        observeWrite(result, 'remove');
      } catch (error) {
        markWriteFailed(error, 'remove');
      }
    },
    disable: () => {
      enabled = false;
      notifyPendingChange(false);
    },
    isEnabled: () => enabled,
    isPending: () => pendingWrites.size > 0,
    get lastFailure() {
      return lastFailure;
    },
    flush: async () => {
      while (pendingWrites.size > 0) {
        await Promise.all([...pendingWrites]);
      }
      if (lastFailure !== null) {
        throw lastFailure;
      }
    },
  };

  return browserStorage;
}

export function createMemoryTrainingStorage(): StateStorage {
  const values = new Map<string, string>();

  return {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      values.set(name, value);
    },
    removeItem: (name) => {
      values.delete(name);
    },
  } satisfies StateStorage;
}

/**
 * Keep the store's injected storage identity stable while explicitly replacing its backing
 * adapter after a user chooses recovery or session-only mode.
 */
export function createTrainingStorageController(storage: StateStorage): TrainingStorageController {
  let activeStorage = storage;

  return {
    getItem: (name) => activeStorage.getItem(name),
    setItem: (name, value) => activeStorage.setItem(name, value),
    removeItem: (name) => activeStorage.removeItem(name),
    replace: (nextStorage) => {
      asLifecycleStorage(activeStorage).disable?.();
      activeStorage = nextStorage;
    },
    disable: () => asLifecycleStorage(activeStorage).disable?.(),
    isEnabled: () => asLifecycleStorage(activeStorage).isEnabled?.() ?? true,
    isPending: () => asLifecycleStorage(activeStorage).isPending?.() ?? false,
    get lastFailure() {
      const failure = asLifecycleStorage(activeStorage).lastFailure;
      if (failure instanceof BrowserStorageError) {
        return failure;
      }
      return null;
    },
    flush: async () => {
      await asLifecycleStorage(activeStorage).flush?.();
    },
  } satisfies TrainingStorageController;
}

export function downloadRawTrainingBackup(raw: string): void {
  downloadTrainingBackupPayload(
    raw,
    `kendomenu-local-backup-${new Date().toISOString().slice(0, 10)}.json`,
  );
}

/**
 * Download the current validated v10 state held by the store.
 *
 * The state is encoded through the same serializer used by browser persistence so this backup
 * always carries the current persistence version and never reads stale or failed storage bytes.
 */
export function downloadCurrentTrainingBackup(dashboardEntries: unknown): void {
  const raw = serializePersistedTrainingStateV10({ dashboardEntries });
  downloadTrainingBackupPayload(
    raw,
    `kendomenu-current-backup-${new Date().toISOString().slice(0, 10)}.json`,
  );
}

function downloadTrainingBackupPayload(raw: string, filename: string): void {
  let url: string | null = null;

  try {
    const blob = new Blob([raw], { type: 'application/json' });
    url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    if (url !== null) {
      URL.revokeObjectURL(url);
    }
  }
}

export function resetBrowserTrainingStorage(storageKey: string = TRAINING_STORAGE_KEY): void {
  // LocalStorage removal is atomic. A later read failure must not turn a completed reset into
  // a reported failure; the gate independently inspects whether storage is available afterward.
  window.localStorage.removeItem(storageKey);
}

export interface GuestResetOptions {
  readonly storage?: StateStorage;
  readonly coordination?: WorkspaceCoordinator;
}

/**
 * Reset guest data through the same canonical guest lock used by current-app persistence writes.
 * The legacy synchronous reset above remains available for the existing recovery boundary. Local
 * storage deletion is atomic; a later inspection determines whether the browser remains usable.
 */
export function resetBrowserTrainingStorageCoordinated(
  storageKey: string = TRAINING_STORAGE_KEY,
  options: GuestResetOptions = {},
): void | Promise<void> {
  const remove = (): void | Promise<void> => {
    const storage = resolveBrowserStorage(options.storage);
    const result = storage.removeItem(storageKey);
    return mapMaybe(result, () => confirmReadback(storage, storageKey, null, 'remove'));
  };

  try {
    const result = runGuestMutation(options.coordination, remove);
    if (isPromiseLike(result)) {
      return Promise.resolve(result).catch((error: unknown) => {
        throw mapBrowserStorageError(error, 'remove');
      });
    }
    return result;
  } catch (error) {
    throw mapBrowserStorageError(error, 'remove');
  }
}

export async function resetBrowserTrainingStorageAsync(
  storageKey: string = TRAINING_STORAGE_KEY,
  options: GuestResetOptions = {},
): Promise<void> {
  await resetBrowserTrainingStorageCoordinated(storageKey, options);
}
