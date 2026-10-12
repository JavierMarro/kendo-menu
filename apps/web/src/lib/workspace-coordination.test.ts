import { describe, expect, it } from 'vitest';

import {
  createWorkspaceCoordinator,
  GUEST_WORKSPACE_LOCK_NAME,
  type WorkspaceLockProvider,
} from './workspace-coordination';

class FakeLocks implements WorkspaceLockProvider {
  readonly names: string[] = [];
  tail: Promise<void> = Promise.resolve();

  request<T>(name: string, callback: (lock: Lock | null) => T | PromiseLike<T>): Promise<T> {
    this.names.push(name);
    const current = this.tail;
    let release: (() => void) | undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return current.then(async () => {
      try {
        return await callback({ name, mode: 'exclusive' });
      } finally {
        release?.();
      }
    });
  }
}

describe('guest workspace coordination', () => {
  it('serializes operations under the fixed guest lock', async () => {
    const locks = new FakeLocks();
    const coordinator = createWorkspaceCoordinator({ locks });
    const order: string[] = [];
    const first = coordinator.withLock(async () => {
      order.push('first-start');
      await Promise.resolve();
      order.push('first-end');
    });
    const second = coordinator.withLock(() => {
      order.push('second');
    });
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
    expect(locks.names).toEqual([GUEST_WORKSPACE_LOCK_NAME, GUEST_WORKSPACE_LOCK_NAME]);
  });

  it('reports unavailable coordination and rejects failed or null locks', async () => {
    const unavailable = createWorkspaceCoordinator({ locks: null });
    expect(unavailable.isAvailable).toBe(false);
    await expect(unavailable.withLock(() => undefined)).rejects.toMatchObject({
      code: 'unavailable',
    });

    const rejected: WorkspaceLockProvider = {
      request: () => Promise.reject(new Error('lock failed')),
    };
    const failed = createWorkspaceCoordinator({ locks: rejected });
    await expect(failed.withLock(() => undefined)).rejects.toMatchObject({ code: 'unavailable' });
    expect(failed.isAvailable).toBe(false);

    const nullGrant: WorkspaceLockProvider = {
      request: (_name, callback) => Promise.resolve(callback(null)),
    };
    await expect(
      createWorkspaceCoordinator({ locks: nullGrant }).withLock(() => undefined),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('rejects a queued lock callback after disposal', async () => {
    let grantLock: (() => void) | undefined;
    let entered = false;
    const locks: WorkspaceLockProvider = {
      request: (_name, callback) =>
        new Promise((resolve, reject) => {
          grantLock = () => {
            void Promise.resolve()
              .then(() => callback({ name: GUEST_WORKSPACE_LOCK_NAME, mode: 'exclusive' }))
              .then(resolve, reject);
          };
        }),
    };
    const coordinator = createWorkspaceCoordinator({ locks });
    const pending = coordinator.withLock(() => {
      entered = true;
    });
    coordinator.dispose();
    grantLock?.();
    await expect(pending).rejects.toMatchObject({ code: 'unavailable' });
    expect(entered).toBe(false);
    expect(coordinator.isAvailable).toBe(false);
  });

  it('preserves operation errors and keeps coordination usable after acquiring the lock', async () => {
    const coordinator = createWorkspaceCoordinator({ locks: new FakeLocks() });
    const storageError = new Error('Storage write failed');
    await expect(
      coordinator.withLock(() => {
        throw storageError;
      }),
    ).rejects.toBe(storageError);
    expect(coordinator.isAvailable).toBe(true);
    await expect(coordinator.withLock(() => 'recovered')).resolves.toBe('recovered');
  });
});
