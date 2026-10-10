/** Serializes and validates the guest LocalStorage boundary across same-origin tabs. */
import { classifyTrainingStorageValue } from '@kendo-menu/store';

export const GUEST_WORKSPACE_LOCK_NAME = 'kendo-menu:guest';
export const guestWorkspaceScope = { kind: 'guest' } as const;
export type WorkspaceScope = typeof guestWorkspaceScope;

export interface WorkspaceStorageChange {
  readonly scope: WorkspaceScope;
  readonly key: 'kendo-menu';
  readonly newValue: string | null;
}

export interface WorkspaceStorageEvent {
  readonly key: string | null;
  readonly newValue: string | null;
  readonly storageArea?: unknown;
  readonly url?: string;
}

export interface WorkspaceStorageEventSource {
  readonly addEventListener: (
    type: 'storage',
    listener: (event: WorkspaceStorageEvent) => void,
  ) => void;
  readonly removeEventListener: (
    type: 'storage',
    listener: (event: WorkspaceStorageEvent) => void,
  ) => void;
}

export interface WorkspaceLockProvider {
  readonly request: <T>(
    name: string,
    callback: (lock: Lock | null) => T | PromiseLike<T>,
  ) => Promise<T>;
}

export type WorkspaceCoordinationAvailability = 'available' | 'unavailable';
export type WorkspaceCoordinationErrorCode = 'unavailable';

export class WorkspaceCoordinationError extends Error {
  readonly code: WorkspaceCoordinationErrorCode;
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceCoordinationError';
    this.code = 'unavailable';
  }
}

export interface WorkspaceCoordinator {
  readonly availability: WorkspaceCoordinationAvailability;
  readonly isAvailable: boolean;
  readonly lockName: () => typeof GUEST_WORKSPACE_LOCK_NAME;
  readonly withLock: <T>(operation: () => T | PromiseLike<T>) => Promise<T>;
  readonly subscribe: (listener: (change: WorkspaceStorageChange) => void) => () => void;
  readonly dispose: () => void;
}

interface Subscription {
  readonly listener: (change: WorkspaceStorageChange) => void;
}

function defaultLockProvider(): WorkspaceLockProvider | undefined {
  try {
    return typeof navigator === 'undefined' ? undefined : navigator.locks;
  } catch {
    return undefined;
  }
}

function defaultEventSource(): WorkspaceStorageEventSource | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

function defaultStorageArea(): unknown {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function workspaceLockName(): typeof GUEST_WORKSPACE_LOCK_NAME {
  return GUEST_WORKSPACE_LOCK_NAME;
}

export interface WorkspaceCoordinatorOptions {
  readonly locks?: WorkspaceLockProvider | null;
  readonly events?: WorkspaceStorageEventSource | null;
  readonly storageArea?: unknown;
  readonly origin?: string;
}

export function createWorkspaceCoordinator(
  options: WorkspaceCoordinatorOptions = {},
): WorkspaceCoordinator {
  const locks = options.locks === undefined ? defaultLockProvider() : options.locks;
  const events = options.events === undefined ? defaultEventSource() : options.events;
  const storageArea =
    options.storageArea === undefined ? defaultStorageArea() : options.storageArea;
  const subscriptions = new Set<Subscription>();
  let disposed = false;
  let usable = locks !== undefined && locks !== null;

  const onStorage = (event: WorkspaceStorageEvent) => {
    if (disposed || event.key !== 'kendo-menu') return;
    if (
      storageArea !== undefined &&
      event.storageArea !== undefined &&
      event.storageArea !== storageArea
    )
      return;
    if (options.origin !== undefined && event.url !== undefined) {
      try {
        if (new URL(event.url, options.origin).origin !== options.origin) return;
      } catch {
        return;
      }
    }
    if (event.newValue !== null) {
      const inspection = classifyTrainingStorageValue(event.newValue);
      if (!['ready', 'migrated', 'empty'].includes(inspection.status)) return;
    }
    for (const subscription of subscriptions) {
      subscription.listener({
        scope: guestWorkspaceScope,
        key: 'kendo-menu',
        newValue: event.newValue,
      });
    }
  };
  if (events !== undefined && events !== null) events.addEventListener('storage', onStorage);

  return {
    get availability() {
      return usable ? 'available' : 'unavailable';
    },
    get isAvailable() {
      return usable;
    },
    lockName: workspaceLockName,
    async withLock<T>(operation: () => T | PromiseLike<T>) {
      if (disposed || !usable || locks === undefined || locks === null) {
        throw new WorkspaceCoordinationError('Guest LocalStorage coordination is unavailable.');
      }
      let entered = false;
      try {
        const result = await locks.request(GUEST_WORKSPACE_LOCK_NAME, (lock) => {
          if (disposed || lock === null)
            throw new WorkspaceCoordinationError('Guest workspace lock was unavailable.');
          entered = true;
          return operation();
        });
        if (!entered)
          throw new WorkspaceCoordinationError('Guest workspace lock was not acquired.');
        return result;
      } catch (error) {
        if (entered) throw error;
        usable = false;
        throw new WorkspaceCoordinationError('Guest LocalStorage coordination is unavailable.');
      }
    },
    subscribe(listener) {
      if (disposed) return () => undefined;
      const subscription = { listener };
      subscriptions.add(subscription);
      return () => subscriptions.delete(subscription);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      subscriptions.clear();
      if (events !== undefined && events !== null) events.removeEventListener('storage', onStorage);
    },
  };
}
