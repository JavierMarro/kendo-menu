/**
 * Provides same-origin Web Locks coordination for guest LocalStorage operations.
 * It only serializes operations; callers receive unavailable coordination to apply their guest
 * fallback policy.
 */
export const GUEST_WORKSPACE_LOCK_NAME = 'kendo-menu:guest';

export interface WorkspaceLockProvider {
  readonly request: <T>(
    name: string,
    callback: (lock: Lock | null) => T | PromiseLike<T>,
  ) => Promise<T>;
}

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
  readonly isAvailable: boolean;
  readonly withLock: <T>(operation: () => T | PromiseLike<T>) => Promise<T>;
  readonly dispose: () => void;
}

function defaultLockProvider(): WorkspaceLockProvider | undefined {
  try {
    return typeof navigator === 'undefined' ? undefined : navigator.locks;
  } catch {
    return undefined;
  }
}

export interface WorkspaceCoordinatorOptions {
  readonly locks?: WorkspaceLockProvider | null;
}

export function createWorkspaceCoordinator(
  options: WorkspaceCoordinatorOptions = {},
): WorkspaceCoordinator {
  const locks = options.locks === undefined ? defaultLockProvider() : options.locks;
  let disposed = false;
  let usable = locks !== undefined && locks !== null;

  return {
    get isAvailable() {
      return usable;
    },
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
        // Preserve failures after entry; only a failed acquisition marks coordination unavailable.
        if (entered) throw error;
        usable = false;
        throw new WorkspaceCoordinationError('Guest LocalStorage coordination is unavailable.');
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
    },
  };
}
