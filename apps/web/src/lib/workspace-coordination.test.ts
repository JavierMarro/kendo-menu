import { serializePersistedTrainingStateV10 } from '@kendo-menu/store';
import { describe, expect, it } from 'vitest';

import {
  createWorkspaceCoordinator,
  GUEST_WORKSPACE_LOCK_NAME,
  type WorkspaceLockProvider,
  type WorkspaceStorageEvent,
  type WorkspaceStorageEventSource,
} from './workspace-coordination';

const EMPTY_CACHE = serializePersistedTrainingStateV10({ dashboardEntries: [] });

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

class FakeEvents implements WorkspaceStorageEventSource {
  listener: ((event: WorkspaceStorageEvent) => void) | undefined;
  removed = 0;

  addEventListener(_type: 'storage', listener: (event: WorkspaceStorageEvent) => void): void {
    this.listener = listener;
  }

  removeEventListener(_type: 'storage', listener: (event: WorkspaceStorageEvent) => void): void {
    if (this.listener === listener) this.listener = undefined;
    this.removed += 1;
  }

  emit(event: WorkspaceStorageEvent): void {
    this.listener?.(event);
  }
}

describe('guest workspace coordination', () => {
  it('serializes operations under the fixed guest lock', async () => {
    const locks = new FakeLocks();
    const coordinator = createWorkspaceCoordinator({ locks, events: null });
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
    const unavailable = createWorkspaceCoordinator({ locks: null, events: null });
    expect(unavailable.isAvailable).toBe(false);
    await expect(unavailable.withLock(() => undefined)).rejects.toMatchObject({
      code: 'unavailable',
    });

    const rejected: WorkspaceLockProvider = {
      request: () => Promise.reject(new Error('lock failed')),
    };
    const failed = createWorkspaceCoordinator({ locks: rejected, events: null });
    await expect(failed.withLock(() => undefined)).rejects.toMatchObject({ code: 'unavailable' });
    expect(failed.availability).toBe('unavailable');

    const nullGrant: WorkspaceLockProvider = {
      request: (_name, callback) => Promise.resolve(callback(null)),
    };
    await expect(
      createWorkspaceCoordinator({ locks: nullGrant, events: null }).withLock(() => undefined),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('notifies only subscribers to valid same-origin guest storage changes', () => {
    const events = new FakeEvents();
    const coordinator = createWorkspaceCoordinator({
      locks: null,
      events,
      storageArea: 'local',
      origin: 'https://menu.test',
    });
    const values: Array<string | null> = [];
    const unsubscribe = coordinator.subscribe((change) => values.push(change.newValue));
    const valid = {
      key: 'kendo-menu',
      newValue: EMPTY_CACHE,
      storageArea: 'local',
      url: 'https://menu.test/app',
    };
    events.emit(valid);
    events.emit({ ...valid, key: 'other-key' });
    events.emit({ ...valid, newValue: '{broken' });
    events.emit({ ...valid, storageArea: 'session' });
    events.emit({ ...valid, url: 'https://other.test/app' });
    events.emit({
      key: 'kendo-menu',
      newValue: null,
      storageArea: 'local',
      url: 'https://menu.test/app',
    });
    expect(values).toEqual([EMPTY_CACHE, null]);
    unsubscribe();
    events.emit(valid);
    expect(values).toHaveLength(2);
    coordinator.dispose();
    expect(events.removed).toBe(1);
  });

  it('preserves operation errors and keeps coordination usable after acquiring the lock', async () => {
    const coordinator = createWorkspaceCoordinator({ locks: new FakeLocks(), events: null });
    const storageError = new Error('Storage write failed');
    await expect(
      coordinator.withLock(() => {
        throw storageError;
      }),
    ).rejects.toBe(storageError);
    expect(coordinator.availability).toBe('available');
    await expect(coordinator.withLock(() => 'recovered')).resolves.toBe('recovered');
  });
});
