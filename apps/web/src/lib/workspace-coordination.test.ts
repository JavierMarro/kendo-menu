import { serializePersistedTrainingStateV10 } from '@kendo-menu/store';
import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_STORAGE_KEY_PREFIX,
  ACCOUNT_SYNC_STORAGE_SUFFIX,
  createAccountSyncMetadata,
} from './account-storage';
import {
  accountWorkspaceScope,
  createWorkspaceCoordinator,
  guestWorkspaceScope,
  WorkspaceCoordinationError,
  workspaceLockName,
  type WorkspaceLockProvider,
  type WorkspaceStorageEvent,
  type WorkspaceStorageEventSource,
} from './workspace-coordination';

const ACCOUNT_A = '00000000-0000-4000-8000-000000000001';
const ACCOUNT_B = '00000000-0000-4000-8000-000000000002';
const ACCOUNT_A_KEY = `${ACCOUNT_STORAGE_KEY_PREFIX}${ACCOUNT_A}`;
const ACCOUNT_A_METADATA_KEY = `${ACCOUNT_A_KEY}${ACCOUNT_SYNC_STORAGE_SUFFIX}`;
const EMPTY_CACHE = serializePersistedTrainingStateV10({ dashboardEntries: [] });

class FakeLocks implements WorkspaceLockProvider {
  readonly names: string[] = [];
  readonly tails = new Map<string, Promise<void>>();

  request<T>(name: string, callback: (lock: Lock | null) => T | PromiseLike<T>): Promise<T> {
    this.names.push(name);
    const previous = this.tails.get(name) ?? Promise.resolve();
    let resolveTail: (() => void) | undefined;
    const tail = new Promise<void>((resolve) => {
      resolveTail = resolve;
    });
    this.tails.set(name, tail);
    return previous.then(async () => {
      try {
        return await callback({} as Lock);
      } finally {
        resolveTail?.();
      }
    });
  }
}

class FakeEvents implements WorkspaceStorageEventSource {
  listener: ((event: WorkspaceStorageEvent) => void) | undefined;
  added = 0;
  removed = 0;

  addEventListener(_type: 'storage', listener: (event: WorkspaceStorageEvent) => void): void {
    this.listener = listener;
    this.added += 1;
  }

  removeEventListener(_type: 'storage', listener: (event: WorkspaceStorageEvent) => void): void {
    if (this.listener === listener) {
      this.listener = undefined;
    }
    this.removed += 1;
  }

  emit(event: WorkspaceStorageEvent): void {
    this.listener?.(event);
  }
}

describe('workspace coordination', () => {
  it('uses only canonical guest and internal-account lock names', () => {
    expect(workspaceLockName(guestWorkspaceScope)).toBe('kendo-menu:guest');
    expect(workspaceLockName(accountWorkspaceScope(ACCOUNT_A))).toBe(
      `kendo-menu:account:${ACCOUNT_A}`,
    );
    expect(() => accountWorkspaceScope('person@example.com')).toThrow(WorkspaceCoordinationError);
  });

  it('serializes same-scope operations and keeps account locks distinct', async () => {
    const locks = new FakeLocks();
    const coordinator = createWorkspaceCoordinator({ locks, events: null });
    const order: string[] = [];
    const first = coordinator.withLock(accountWorkspaceScope(ACCOUNT_A), async () => {
      order.push('a-start');
      await Promise.resolve();
      order.push('a-end');
    });
    const second = coordinator.withLock(accountWorkspaceScope(ACCOUNT_A), () => {
      order.push('a-second');
    });
    const other = coordinator.withLock(accountWorkspaceScope(ACCOUNT_B), () => {
      order.push('b');
    });
    await Promise.all([first, second, other]);

    expect(order.indexOf('a-end')).toBeLessThan(order.indexOf('a-second'));
    expect(locks.names).toEqual([
      `kendo-menu:account:${ACCOUNT_A}`,
      `kendo-menu:account:${ACCOUNT_A}`,
      `kendo-menu:account:${ACCOUNT_B}`,
    ]);
  });

  it('reports unavailable coordination explicitly and never claims safe locks', async () => {
    const coordinator = createWorkspaceCoordinator({ locks: null, events: null });
    expect(coordinator.availability).toBe('unavailable');
    expect(coordinator.isAvailable).toBe(false);
    await expect(coordinator.withLock(guestWorkspaceScope, () => undefined)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('marks a provider unavailable after a rejected lock request', async () => {
    const locks: WorkspaceLockProvider = {
      request: () => Promise.reject(new Error('lock provider failed')),
    };
    const coordinator = createWorkspaceCoordinator({ locks, events: null });

    await expect(coordinator.withLock(guestWorkspaceScope, () => undefined)).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(coordinator.availability).toBe('unavailable');
  });

  it('ignores queued callbacks after disposal and rejects null lock grants', async () => {
    const locks: WorkspaceLockProvider = {
      request: (_name, callback) => Promise.resolve().then(() => callback(null)),
    };
    const coordinator = createWorkspaceCoordinator({ locks, events: null });
    await expect(coordinator.withLock(guestWorkspaceScope, () => undefined)).rejects.toMatchObject({
      code: 'unavailable',
    });

    const usableLocks = new FakeLocks();
    const disposed = createWorkspaceCoordinator({ locks: usableLocks, events: null });
    disposed.dispose();
    await expect(disposed.withLock(guestWorkspaceScope, () => undefined)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('emits only validated same-scope storage changes as notifications', () => {
    const events = new FakeEvents();
    const coordinator = createWorkspaceCoordinator({
      locks: null,
      events,
      storageArea: 'local',
      origin: 'https://kendo-menu.test',
    });
    const changes: string[] = [];
    coordinator.subscribe(accountWorkspaceScope(ACCOUNT_A), (change) => {
      changes.push(`${change.kind}:${change.key}`);
    });

    events.emit({
      key: ACCOUNT_A_KEY,
      newValue: EMPTY_CACHE,
      storageArea: 'local',
      url: 'https://kendo-menu.test/app',
    });
    events.emit({
      key: ACCOUNT_A_METADATA_KEY,
      newValue: JSON.stringify(createAccountSyncMetadata(ACCOUNT_A)),
      storageArea: 'local',
      url: 'https://kendo-menu.test/app',
    });
    events.emit({
      key: ACCOUNT_A_METADATA_KEY,
      newValue: JSON.stringify(createAccountSyncMetadata(ACCOUNT_B)),
      storageArea: 'local',
      url: 'https://kendo-menu.test/app',
    });
    events.emit({
      key: ACCOUNT_A_KEY,
      newValue: '{broken',
      storageArea: 'local',
      url: 'https://kendo-menu.test/app',
    });
    events.emit({
      key: ACCOUNT_A_KEY,
      newValue: EMPTY_CACHE,
      storageArea: 'session',
      url: 'https://kendo-menu.test/app',
    });
    events.emit({
      key: `${ACCOUNT_STORAGE_KEY_PREFIX}${ACCOUNT_B}`,
      newValue: EMPTY_CACHE,
      storageArea: 'local',
      url: 'https://kendo-menu.test/app',
    });
    events.emit({
      key: ACCOUNT_A_KEY,
      newValue: EMPTY_CACHE,
      storageArea: 'local',
      url: 'https://other-origin.test/app',
    });
    events.emit({ key: null, newValue: null, storageArea: 'local' });

    expect(changes).toEqual([`cache:${ACCOUNT_A_KEY}`, `sync-metadata:${ACCOUNT_A_METADATA_KEY}`]);
    coordinator.dispose();
    expect(events.removed).toBe(1);
    events.emit({ key: ACCOUNT_A_KEY, newValue: EMPTY_CACHE, storageArea: 'local' });
    expect(changes).toHaveLength(2);
  });
});
