/**
 * Coordinates same-origin guest and account cache operations across browser tabs.
 * Web Locks serialize writes when available; storage events only tell an already selected
 * workspace that its cache changed. Neither mechanism authenticates a user or chooses which
 * account may be opened.
 */
import { classifyTrainingStorageValue } from '@kendo-menu/store';

import {
  deriveAccountStorageKey,
  deriveAccountSyncStorageKey,
  isCanonicalInternalUserId,
  parseAccountSyncMetadata,
} from './account-storage';

export const GUEST_WORKSPACE_SCOPE = 'guest' as const;
export const GUEST_WORKSPACE_LOCK_NAME = 'kendo-menu:guest';
export const ACCOUNT_WORKSPACE_LOCK_PREFIX = 'kendo-menu:account:';

export type WorkspaceScope =
  { readonly kind: 'guest' } | { readonly kind: 'account'; readonly accountId: string };

export type WorkspaceChangeKind = 'cache' | 'sync-metadata';

export interface WorkspaceStorageChange {
  readonly scope: WorkspaceScope;
  readonly key: string;
  readonly kind: WorkspaceChangeKind;
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

export type WorkspaceCoordinationErrorCode = 'invalid-scope' | 'unavailable';

export class WorkspaceCoordinationError extends Error {
  readonly code: WorkspaceCoordinationErrorCode;

  constructor(code: WorkspaceCoordinationErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceCoordinationError';
    this.code = code;
  }
}

export interface WorkspaceCoordinator {
  readonly availability: WorkspaceCoordinationAvailability;
  readonly isAvailable: boolean;
  readonly lockName: (scope: WorkspaceScope) => string;
  readonly withLock: <T>(scope: WorkspaceScope, operation: () => T | PromiseLike<T>) => Promise<T>;
  readonly subscribe: (
    scope: WorkspaceScope,
    listener: (change: WorkspaceStorageChange) => void,
  ) => () => void;
  readonly dispose: () => void;
}

interface Subscription {
  readonly scope: WorkspaceScope;
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
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window;
}

function defaultStorageArea(): unknown {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function cloneScope(scope: WorkspaceScope): WorkspaceScope {
  if (scope.kind === 'guest') {
    return { kind: 'guest' };
  }
  if (!isCanonicalInternalUserId(scope.accountId)) {
    throw new WorkspaceCoordinationError(
      'invalid-scope',
      'Account coordination requires a canonical internal user UUID.',
    );
  }
  return { kind: 'account', accountId: scope.accountId };
}

export function workspaceLockName(scope: WorkspaceScope): string {
  const checkedScope = cloneScope(scope);
  return checkedScope.kind === 'guest'
    ? GUEST_WORKSPACE_LOCK_NAME
    : `${ACCOUNT_WORKSPACE_LOCK_PREFIX}${checkedScope.accountId}`;
}

function workspaceStorageKey(scope: WorkspaceScope): {
  readonly key: string;
  readonly kind: WorkspaceChangeKind;
}[] {
  const checkedScope = cloneScope(scope);
  if (checkedScope.kind === 'guest') {
    return [{ key: 'kendo-menu', kind: 'cache' }];
  }

  return [
    { key: deriveAccountStorageKey(checkedScope.accountId), kind: 'cache' },
    { key: deriveAccountSyncStorageKey(checkedScope.accountId), kind: 'sync-metadata' },
  ];
}

function isValidChange(
  scope: WorkspaceScope,
  key: string,
  newValue: string | null,
): WorkspaceChangeKind | null {
  const match = workspaceStorageKey(scope).find((candidate) => candidate.key === key);
  if (match === undefined) {
    return null;
  }
  if (newValue === null) {
    return match.kind;
  }

  if (match.kind === 'cache') {
    const inspection = classifyTrainingStorageValue(newValue);
    return inspection.status === 'ready' ||
      inspection.status === 'migrated' ||
      inspection.status === 'empty'
      ? match.kind
      : null;
  }

  const metadata = parseAccountSyncMetadata(newValue);
  return metadata === null || scope.kind !== 'account' || metadata.accountId !== scope.accountId
    ? null
    : match.kind;
}

export interface WorkspaceCoordinatorOptions {
  /** `null` explicitly disables Web Locks, including when the browser has them. */
  readonly locks?: WorkspaceLockProvider | null;
  /** `null` explicitly disables storage-event observation. */
  readonly events?: WorkspaceStorageEventSource | null;
  /** When supplied, events from any other Storage object are ignored. */
  readonly storageArea?: unknown;
  /** When supplied, events whose URL is another origin are ignored. */
  readonly origin?: string;
}

/**
 * Creates the browser coordination boundary. Locks serialize same-origin work; storage events
 * are checked against the explicitly subscribed scope and are emitted only as invalidation
 * notifications. They never select an account or establish authentication.
 */
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

  const onStorage = (event: WorkspaceStorageEvent): void => {
    if (disposed || event.key === null) {
      return;
    }
    if (
      storageArea !== undefined &&
      event.storageArea !== undefined &&
      event.storageArea !== storageArea
    ) {
      return;
    }
    if (options.origin !== undefined && event.url !== undefined) {
      try {
        if (new URL(event.url, options.origin).origin !== options.origin) {
          return;
        }
      } catch {
        return;
      }
    }
    for (const subscription of subscriptions) {
      const kind = isValidChange(subscription.scope, event.key, event.newValue);
      if (kind === null) {
        continue;
      }
      subscription.listener({
        scope: cloneScope(subscription.scope),
        key: event.key,
        kind,
        newValue: event.newValue,
      });
    }
  };

  if (events !== undefined && events !== null) {
    events.addEventListener('storage', onStorage);
  }

  const coordinator: WorkspaceCoordinator = {
    get availability() {
      return usable ? 'available' : 'unavailable';
    },
    get isAvailable() {
      return usable;
    },
    lockName: workspaceLockName,
    withLock: async <T>(scope: WorkspaceScope, operation: () => T | PromiseLike<T>) => {
      if (disposed) {
        throw new WorkspaceCoordinationError(
          'unavailable',
          'Workspace coordination was disposed before the operation started.',
        );
      }
      const name = workspaceLockName(scope);
      if (!usable || locks === undefined || locks === null) {
        throw new WorkspaceCoordinationError(
          'unavailable',
          'This browser does not provide usable same-origin Web Locks.',
        );
      }
      let callbackEntered = false;
      try {
        const result = await locks.request(name, (lock) => {
          callbackEntered = true;
          if (disposed || lock === null) {
            throw new WorkspaceCoordinationError(
              'unavailable',
              'The workspace lock was no longer usable before the operation ran.',
            );
          }
          return operation();
        });
        if (!callbackEntered) {
          throw new WorkspaceCoordinationError(
            'unavailable',
            'The workspace lock was not acquired.',
          );
        }
        return result;
      } catch (error) {
        if (callbackEntered && !(error instanceof WorkspaceCoordinationError)) {
          throw error;
        }
        usable = false;
        if (error instanceof WorkspaceCoordinationError) {
          throw error;
        }
        throw new WorkspaceCoordinationError(
          'unavailable',
          'The workspace lock request failed before the operation completed.',
        );
      }
    },
    subscribe: (scope, listener) => {
      if (disposed) {
        return () => undefined;
      }
      const checkedScope = cloneScope(scope);
      const subscription: Subscription = { scope: checkedScope, listener };
      subscriptions.add(subscription);
      return () => {
        subscriptions.delete(subscription);
      };
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      subscriptions.clear();
      if (events !== undefined && events !== null) {
        events.removeEventListener('storage', onStorage);
      }
    },
  };

  return coordinator;
}

export function accountWorkspaceScope(accountId: unknown): WorkspaceScope {
  if (!isCanonicalInternalUserId(accountId)) {
    throw new WorkspaceCoordinationError(
      'invalid-scope',
      'Account coordination requires a canonical internal user UUID.',
    );
  }
  return { kind: 'account', accountId };
}

export const guestWorkspaceScope: WorkspaceScope = { kind: GUEST_WORKSPACE_SCOPE };

export function withGuestWorkspaceLock<T>(
  coordinator: WorkspaceCoordinator,
  operation: () => T | PromiseLike<T>,
): Promise<T> {
  return coordinator.withLock(guestWorkspaceScope, operation);
}
