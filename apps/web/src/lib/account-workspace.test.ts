import { DEFAULT_TRAINING_SETS, getTrainingSetActivities } from '@kendo-menu/domain';
import {
  createTrainingStore,
  serializePersistedTrainingStateV10,
  type StateStorage,
  type TrainingStoreApi,
} from '@kendo-menu/store';
import { describe, expect, it, vi } from 'vitest';

import { createAccountApiClient } from './account-api';
import type { AccountSession, DashboardReadResponse, SessionResult } from './account-api';
import type {
  AccountSyncState,
  AccountSyncMutationResult,
  AccountSynchronizationDatabase,
  AuthoritativeAdoptionCompletion,
  PendingCompletion,
  PendingRequestIntent,
} from './account-database';
import type { AccountSynchronizationLockProvider } from './account-synchronization';
import {
  deriveAccountStorageKey,
  type AccountCacheRecord,
  type AccountCacheVersion,
  type AccountDatabase,
  type AccountMetadataKind,
  type AccountPayloadKind,
  type AccountPayloadRecord,
  type AccountRecoveryRecord,
} from './account-storage';
import {
  createAccountWorkspaceController,
  type AccountWorkspaceOptions,
} from './account-workspace';
import {
  createWorkspaceCoordinator,
  type WorkspaceLockProvider,
  type WorkspaceStorageEvent,
} from './workspace-coordination';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';
const empty = JSON.stringify({ state: { dashboardEntries: [] }, version: 10 });
const session = (userId = A) =>
  new Response(
    JSON.stringify({
      userId,
      verifiedGoogleEmail: null,
      adoption: { status: 'unavailable', capability: false },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
const signedOut = () =>
  new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

class MemoryAccountDatabase implements AccountDatabase {
  readonly caches = new Map<string, AccountCacheRecord>();
  readonly metadata = new Map<string, unknown>();
  readonly payloads = new Map<string, AccountPayloadRecord>();
  readonly recovery: AccountRecoveryRecord[] = [];
  private nextIdentity = 0;
  onWrite: (() => void | Promise<void>) | undefined;
  onSyncStateRead: (() => void | Promise<void>) | undefined;
  onRead: (() => void | Promise<void>) | undefined;

  async readCache(accountId: string): Promise<AccountCacheRecord | null> {
    await this.onRead?.();
    return this.caches.get(accountId) ?? null;
  }

  async migrateCacheIfAbsent(accountId: string, cacheValue: string): Promise<AccountCacheRecord> {
    const existing = this.caches.get(accountId);
    if (existing !== undefined) return existing;
    await this.onWrite?.();
    const record: AccountCacheRecord = {
      version: 1,
      accountId,
      cacheValue,
      identity: `memory-${++this.nextIdentity}`,
      generation: 1,
    };
    this.caches.set(accountId, record);
    return record;
  }

  async compareAndSwapCache(
    accountId: string,
    expected: AccountCacheVersion | null,
    value: string | null,
  ): Promise<
    | { status: 'committed'; record: AccountCacheRecord | null }
    | { status: 'conflict'; record: AccountCacheRecord | null }
  > {
    const current = this.caches.get(accountId) ?? null;
    if (
      (expected === null && current !== null) ||
      (expected !== null &&
        (current?.identity !== expected.identity || current.generation !== expected.generation))
    ) {
      return { status: 'conflict', record: current };
    }
    if (value !== null && current?.cacheValue === value) {
      return { status: 'committed', record: current };
    }
    await this.onWrite?.();
    if (value === null) {
      this.caches.delete(accountId);
      return { status: 'committed', record: null };
    }
    const record: AccountCacheRecord = {
      version: 1,
      accountId,
      cacheValue: value,
      identity: `memory-${++this.nextIdentity}`,
      generation: (current?.generation ?? 0) + 1,
    };
    this.caches.set(accountId, record);
    return { status: 'committed', record };
  }

  async writeRecovery(accountId: string, rawValue: string): Promise<AccountRecoveryRecord> {
    await this.onWrite?.();
    const record: AccountRecoveryRecord = {
      version: 1,
      accountId,
      recoveryId: `memory-${++this.nextIdentity}`,
      rawValue,
      createdAt: Date.now(),
    };
    this.recovery.push(record);
    return record;
  }

  readMetadata(accountId: string, kind: AccountMetadataKind): Promise<unknown> {
    return Promise.resolve(this.metadata.get(`${accountId}:${kind}`) ?? null);
  }

  async writeMetadata(accountId: string, kind: AccountMetadataKind, value: unknown): Promise<void> {
    await this.onWrite?.();
    this.metadata.set(`${accountId}:${kind}`, value);
  }

  readPayload(accountId: string, kind: AccountPayloadKind): Promise<AccountPayloadRecord | null> {
    return Promise.resolve(this.payloads.get(`${accountId}:${kind}`) ?? null);
  }

  async writePayload(
    accountId: string,
    kind: AccountPayloadKind,
    payload: string,
  ): Promise<AccountPayloadRecord> {
    await this.onWrite?.();
    const record: AccountPayloadRecord = {
      version: 1,
      accountId,
      kind,
      payload,
      updatedAt: Date.now(),
    };
    this.payloads.set(`${accountId}:${kind}`, record);
    return record;
  }
}

class MemorySynchronizationDatabase
  extends MemoryAccountDatabase
  implements AccountSynchronizationDatabase
{
  readonly state: AccountSyncState = {
    cache: {
      version: 1,
      accountId: A,
      cacheValue: empty,
      identity: 'sync-cache',
      generation: 0,
    },
    acknowledgement: { version: 1, status: 'unknown', provenance: 'new-empty' },
    pendingRequest: null,
    activeConflict: null,
  };

  constructor() {
    super();
    if (this.state.cache !== null) this.caches.set(A, this.state.cache);
  }

  async readSyncState(): Promise<AccountSyncState> {
    await this.onSyncStateRead?.();
    return this.state;
  }

  establishCloudBaseline(): Promise<AccountSyncMutationResult> {
    return Promise.resolve({ status: 'committed', state: this.state });
  }

  fastForwardCleanCache(): Promise<AccountSyncMutationResult> {
    return Promise.resolve({ status: 'committed', state: this.state });
  }

  preparePendingRequest(
    accountId: string,
    expected: { readonly identity: string; readonly generation: number },
    intent: PendingRequestIntent,
  ): Promise<AccountSyncMutationResult> {
    if (intent.kind !== 'adoption')
      return Promise.resolve({ status: 'mismatch', state: this.state });
    Object.assign(this.state, {
      pendingRequest: {
        version: 1,
        accountId,
        kind: 'adoption',
        cacheVersion: expected,
        request: intent.request,
        createdAt: Date.now(),
      },
    });
    return Promise.resolve({ status: 'committed', state: this.state });
  }

  async acknowledgePendingRequest(
    accountId: string,
    requestId: string,
    completion: PendingCompletion,
  ): Promise<AccountSyncMutationResult> {
    await this.onWrite?.();
    const pending = this.state.pendingRequest;
    const cache = this.state.cache;
    if (
      pending?.kind !== 'adoption' ||
      pending.accountId !== accountId ||
      pending.request.expectedAccountWorkspaceId !== accountId ||
      pending.request.requestId !== requestId ||
      pending.request.decision !== 'no' ||
      completion.kind !== 'adoption-declined' ||
      completion.requestId !== requestId ||
      pending.cacheVersion.generation !== 0 ||
      cache === null ||
      cache.identity !== pending.cacheVersion.identity ||
      cache.generation !== 0 ||
      cache.cacheValue !== empty ||
      this.state.activeConflict !== null
    )
      return { status: 'conflict', state: this.state };
    Object.assign(this.state, {
      acknowledgement: {
        version: 1,
        status: 'adoption-declined',
        accountWorkspaceId: accountId,
        requestId,
        cacheIdentity: cache.identity,
        generation: cache.generation,
      },
      pendingRequest: null,
    });
    return { status: 'committed', state: this.state };
  }

  async completeAcceptedAdoption(
    accountId: string,
    requestId: string,
    acknowledgedRevision: string,
    timestamp: string,
  ): Promise<AccountSyncMutationResult> {
    await this.onWrite?.();
    const pending = this.state.pendingRequest;
    const previous = this.state.cache;
    if (
      pending?.kind !== 'adoption' ||
      pending.accountId !== accountId ||
      pending.request.requestId !== requestId ||
      pending.request.decision !== 'yes' ||
      acknowledgedRevision !== '1' ||
      previous === null
    )
      return { status: 'mismatch', state: this.state };
    const record: AccountCacheRecord = {
      version: 1,
      accountId,
      cacheValue: serializePersistedTrainingStateV10({
        dashboardEntries: pending.request.dashboard.state.dashboardEntries,
      }),
      identity: 'accepted-adoption-cache',
      generation: previous.generation + 1,
    };
    this.caches.set(accountId, record);
    Object.assign(this.state, {
      cache: record,
      acknowledgement: {
        version: 1,
        status: 'acknowledged',
        accountWorkspaceId: accountId,
        revision: acknowledgedRevision,
        requestId,
        cacheIdentity: record.identity,
        generation: record.generation,
        updatedAt: timestamp,
      },
      pendingRequest: null,
    });
    return { status: 'committed', state: this.state };
  }

  async reconcileAuthoritativeAdoption(
    accountId: string,
    completion: AuthoritativeAdoptionCompletion,
  ): Promise<AccountSyncMutationResult> {
    await this.onWrite?.();
    const pending = this.state.pendingRequest;
    const cache = this.state.cache;
    if (
      pending?.kind !== 'adoption' ||
      pending.accountId !== accountId ||
      pending.request.expectedAccountWorkspaceId !== accountId ||
      cache === null ||
      cache.identity !== pending.cacheVersion.identity ||
      pending.cacheVersion.generation !== 0 ||
      cache.generation !== 0 ||
      cache.cacheValue !== empty ||
      this.state.activeConflict !== null
    ) {
      return { status: 'conflict', state: this.state };
    }
    if (completion.decision === 'yes') {
      if (
        completion.cloud.accountWorkspaceId !== accountId ||
        completion.cloud.dashboard === null ||
        BigInt(completion.cloud.revision) < BigInt(completion.acknowledgedRevision) ||
        (completion.cloud.revision === completion.acknowledgedRevision &&
          completion.cloud.updatedAt !== completion.timestamp)
      )
        return { status: 'conflict', state: this.state };
      const value = JSON.stringify({ version: 10, state: completion.cloud.dashboard.state });
      const record: AccountCacheRecord = {
        version: 1,
        accountId,
        cacheValue: value,
        identity: 'authoritative-adoption-cache',
        generation: cache.generation + 1,
      };
      this.caches.set(accountId, record);
      Object.assign(this.state, {
        cache: record,
        acknowledgement: {
          version: 1,
          status: 'acknowledged',
          accountWorkspaceId: accountId,
          revision: completion.cloud.revision,
          requestId:
            completion.cloud.revision === completion.acknowledgedRevision
              ? completion.requestId
              : null,
          cacheIdentity: record.identity,
          generation: record.generation,
          updatedAt: completion.cloud.updatedAt,
        },
        pendingRequest: null,
      });
    } else {
      Object.assign(this.state, {
        acknowledgement: {
          version: 1,
          status: 'adoption-declined',
          accountWorkspaceId: accountId,
          requestId: completion.requestId,
          cacheIdentity: cache.identity,
          generation: cache.generation,
        },
        pendingRequest: null,
      });
    }
    return { status: 'committed', state: this.state };
  }

  recordActiveConflict(): Promise<AccountSyncMutationResult> {
    return Promise.resolve({ status: 'committed', state: this.state });
  }

  resolveConflictUsingCloud(): Promise<AccountSyncMutationResult> {
    return Promise.resolve({ status: 'committed', state: this.state });
  }

  resolveConflictUsingLocal(): Promise<AccountSyncMutationResult> {
    return Promise.resolve({ status: 'committed', state: this.state });
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('uninitialized');
  };
  let reject: (reason?: unknown) => void = () => {
    throw new Error('uninitialized');
  };
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture(withCoordination = true, guestRaw?: string) {
  const values = new Map<string, string>();
  const database = new MemoryAccountDatabase();
  if (guestRaw !== undefined) values.set('kendo-menu', guestRaw);
  const reads: string[] = [];
  const storage: StateStorage = {
    getItem: (key) => {
      reads.push(key);
      return values.get(key) ?? null;
    },
    setItem: (key, raw) => {
      values.set(key, raw);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  const guestStore = createTrainingStore({ storage });
  let csrfCookie = `__Host-kendomenu-csrf=${'A'.repeat(43)}`;
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() => Promise.resolve(session()));
  const api = createAccountApiClient({
    fetch,
    origin: 'https://kendomenu.test',
    readCookie: () => csrfCookie,
  });
  const locks: WorkspaceLockProvider = {
    request: async (name, callback) => callback({ name, mode: 'exclusive' }),
  };
  const listeners = new Set<(event: WorkspaceStorageEvent) => void>();
  const coordination = createWorkspaceCoordinator({
    locks: withCoordination ? locks : null,
    events: {
      addEventListener: (_type, listener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type, listener) => {
        listeners.delete(listener);
      },
    },
  });
  const notify = (key: string, newValue: string | null) => {
    for (const listener of listeners) listener({ key, newValue });
  };
  const controller = createAccountWorkspaceController({
    guestStore,
    storage,
    api,
    coordination,
    database,
  });
  return {
    values,
    database,
    reads,
    storage,
    guestStore,
    fetch,
    api,
    coordination,
    controller,
    notify,
    setCsrfCookie: (value: string) => {
      csrfCookie = value;
    },
  };
}

function adoptionFixture(
  postImplementation: AccountWorkspaceOptions['api']['postAdoption'] = () =>
    Promise.reject(new Error('Fixture adoption response is unavailable')),
  eligibleGuest = true,
) {
  const f = fixture();
  if (eligibleGuest) {
    const training = DEFAULT_TRAINING_SETS.find((set) =>
      getTrainingSetActivities(set).some(
        (activity) => activity.quantities?.repetitions !== undefined,
      ),
    );
    if (training === undefined) throw new Error('Expected a training set with editable quantities');
    f.guestStore.getState().addToDashboard(training.id);
    const entry = f.guestStore.getState().dashboardEntries[0];
    if (entry === undefined) throw new Error('Expected the guest dashboard entry');
    f.guestStore.getState().updateDashboardEntry(entry.id, { notes: 'Preserve this guest note' });
    const quantityActivity = getTrainingSetActivities(training).find(
      (activity) => activity.quantities?.repetitions !== undefined,
    );
    if (quantityActivity === undefined) throw new Error('Expected a quantity override activity');
    f.guestStore.getState().setQuantityOverride(entry.id, quantityActivity.id, 'repetitions', 17);
  }
  const syncDatabase = new MemorySynchronizationDatabase();
  let session: AccountSession = {
    userId: A,
    verifiedGoogleEmail: null,
    adoption: { status: 'pending', capability: true },
  };
  let cloud: DashboardReadResponse = {
    transportVersion: 1,
    accountWorkspaceId: A,
    catalogueVersion: 'a'.repeat(64),
    revision: '0',
    dashboard: null,
    updatedAt: null,
  };
  const getDashboard = vi.fn(() => Promise.resolve(cloud));
  const postAdoption = vi.fn(postImplementation);
  const getSession = vi.fn((): Promise<SessionResult> =>
    Promise.resolve({ status: 'authenticated', session }),
  );
  const locks: AccountSynchronizationLockProvider = {
    request: async (name, _options, callback) => await callback({ name, mode: 'exclusive' }),
  };
  const createController = () =>
    createAccountWorkspaceController({
      guestStore: f.guestStore,
      storage: f.storage,
      api: {
        getSession,
        logout: () => f.api.logout(),
        postAdoption,
      },
      coordination: f.coordination,
      database: f.database,
      synchronization: {
        api: {
          getDashboard,
          putDashboard: (accountId, request) => f.api.putDashboard(accountId, request),
          postAdoption,
        },
        database: syncDatabase,
        locks,
      },
    });
  const controller = createController();
  return {
    ...f,
    controller,
    createController,
    syncDatabase,
    postAdoption,
    getSession,
    getDashboard,
    setCloud: (next: DashboardReadResponse) => {
      cloud = next;
    },
    setSession: (next: AccountSession) => {
      session = next;
    },
  };
}

function add(store: TrainingStoreApi) {
  const training = DEFAULT_TRAINING_SETS[0];
  if (training === undefined) throw new Error('fixture missing');
  return store.getState().addToDashboard(training.id);
}

describe('internal account bootstrap and isolation', () => {
  it('keeps an ordinary revision-one dashboard save open when adoption becomes unavailable', async () => {
    const f = adoptionFixture(undefined, false);
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const opened = f.controller.getSnapshot();
    expect(opened).toMatchObject({ mode: 'account', adoption: { status: 'none' } });
    if (opened.mode !== 'account') throw new Error('Expected account workspace');
    add(opened.store);
    await f.controller.flushPersistence();
    const saved = f.syncDatabase.caches.get(A);
    if (saved === undefined) throw new Error('Expected a durable account edit');
    Object.assign(f.syncDatabase.state, {
      cache: saved,
      acknowledgement: {
        version: 1,
        status: 'acknowledged',
        accountWorkspaceId: A,
        revision: '1',
        requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        cacheIdentity: saved.identity,
        generation: saved.generation,
        updatedAt: '2026-09-30T10:00:00.000Z',
      },
    });
    f.setSession({
      userId: A,
      verifiedGoogleEmail: null,
      adoption: { status: 'unavailable', capability: false },
    });

    for (let check = 0; check < 2; check += 1) {
      expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
      const current = f.controller.getSnapshot();
      expect(current).toMatchObject({
        mode: 'account',
        session: { adoption: { status: 'unavailable' } },
        adoption: { status: 'none' },
      });
      if (current.mode !== 'account') throw new Error('Expected an open account workspace');
      expect(current.store.getState().dashboardEntries).toHaveLength(1);
    }
    expect(f.postAdoption).not.toHaveBeenCalled();
    await f.controller.dispose();
  });

  it.each(['session refresh', 'stale choice'] as const)(
    'closes a stale peer offer after an ordinary save on %s',
    async (action) => {
      const f = adoptionFixture();
      const guestBefore = f.values.get('kendo-menu');
      expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
      expect(f.controller.getSnapshot()).toMatchObject({
        mode: 'account',
        adoption: { status: 'offer' },
      });
      const previous = f.syncDatabase.state.cache;
      if (previous === null) throw new Error('Expected initial account cache');
      const saved: AccountCacheRecord = {
        version: 1,
        accountId: A,
        cacheValue: serializePersistedTrainingStateV10({
          dashboardEntries: f.guestStore.getState().dashboardEntries,
        }),
        identity: 'ordinary-peer-save',
        generation: previous.generation + 1,
      };
      f.syncDatabase.caches.set(A, saved);
      Object.assign(f.syncDatabase.state, {
        cache: saved,
        acknowledgement: {
          version: 1,
          status: 'acknowledged',
          accountWorkspaceId: A,
          revision: '1',
          requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          cacheIdentity: saved.identity,
          generation: saved.generation,
          updatedAt: '2026-09-30T10:00:00.000Z',
        },
      });
      f.setSession({
        userId: A,
        verifiedGoogleEmail: null,
        adoption: { status: 'unavailable', capability: false },
      });
      f.setCloud({
        transportVersion: 1,
        accountWorkspaceId: A,
        catalogueVersion: 'a'.repeat(64),
        revision: '2',
        dashboard: { version: 10, state: { dashboardEntries: [] } },
        updatedAt: '2026-09-30T10:01:00.000Z',
      });
      const cloudReadsBefore = f.getDashboard.mock.calls.length;

      if (action === 'session refresh')
        expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
      else await f.controller.chooseAdoption('no');
      const reopened = f.controller.getSnapshot();
      expect(reopened).toMatchObject({
        mode: 'account',
        session: { adoption: { status: 'unavailable' } },
        adoption: { status: 'none' },
      });
      if (reopened.mode !== 'account') throw new Error('Expected authoritative account cache');
      expect(reopened.store.getState().dashboardEntries).toHaveLength(1);
      expect(f.values.get('kendo-menu')).toBe(guestBefore);
      expect(f.postAdoption).not.toHaveBeenCalled();
      await vi.waitFor(
        () => expect(f.getDashboard.mock.calls.length).toBeGreaterThan(cloudReadsBefore),
        { timeout: 3_000 },
      );
      await f.controller.dispose();
    },
  );

  it('keeps guest mode hidden while a stale offer rehydrates the ordinary peer cache', async () => {
    const f = adoptionFixture();
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const previous = f.syncDatabase.state.cache;
    if (previous === null) throw new Error('Expected initial account cache');
    const saved: AccountCacheRecord = {
      version: 1,
      accountId: A,
      cacheValue: serializePersistedTrainingStateV10({
        dashboardEntries: f.guestStore.getState().dashboardEntries,
      }),
      identity: 'held-ordinary-peer-save',
      generation: 1,
    };
    f.syncDatabase.caches.set(A, saved);
    Object.assign(f.syncDatabase.state, {
      cache: saved,
      acknowledgement: {
        version: 1,
        status: 'acknowledged',
        accountWorkspaceId: A,
        revision: '1',
        requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        cacheIdentity: saved.identity,
        generation: saved.generation,
        updatedAt: '2026-09-30T10:00:00.000Z',
      },
    });
    f.setSession({
      userId: A,
      verifiedGoogleEmail: null,
      adoption: { status: 'unavailable', capability: false },
    });
    const gate = deferred<void>();
    let readStarted = false;
    f.syncDatabase.onRead = async () => {
      readStarted = true;
      await gate.promise;
    };

    const rechecking = f.controller.bootstrap();
    await vi.waitFor(() => expect(readStarted).toBe(true));
    expect(f.controller.getSnapshot().mode).toBe('adoption-completing');
    gate.resolve();
    expect(await rechecking).toEqual({ status: 'ready' });
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'none' },
    });
    await f.controller.dispose();
  });

  it('does not offer adoption over a durable revision-zero PUT when a peer adds guest data', async () => {
    const f = adoptionFixture(undefined, false);
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const opened = f.controller.getSnapshot();
    if (opened.mode !== 'account') throw new Error('Expected account workspace');

    add(opened.store);
    await f.controller.flushPersistence();
    const cache = f.syncDatabase.caches.get(A);
    if (cache === undefined) throw new Error('Expected the durable account edit');
    const request = {
      transportVersion: 1 as const,
      expectedAccountWorkspaceId: A,
      expectedRevision: '0' as const,
      requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      catalogueVersion: 'a'.repeat(64),
      dashboard: {
        version: 10 as const,
        state: { dashboardEntries: opened.store.getState().dashboardEntries },
      },
    };
    const pending = {
      version: 1 as const,
      accountId: A,
      kind: 'dashboard-put' as const,
      cacheVersion: { identity: cache.identity, generation: cache.generation },
      request,
      createdAt: Date.now(),
    };
    f.syncDatabase.caches.set(A, cache);
    Object.assign(f.syncDatabase.state, { cache, pendingRequest: pending });

    const peerGuestStore = createTrainingStore({ storage: f.storage });
    add(peerGuestStore);
    const guestBefore = f.values.get('kendo-menu');
    expect(guestBefore).toBeDefined();

    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'none' },
    });
    expect(f.syncDatabase.state.pendingRequest).toEqual(pending);
    expect(f.syncDatabase.state.cache).toEqual(cache);
    expect(f.postAdoption).not.toHaveBeenCalled();
    expect(f.values.get('kendo-menu')).toBe(guestBefore);
    await f.controller.dispose();
  });

  it.each(['choice', 'retry'] as const)(
    'rehydrates an untouched stale offer for a peer pending ordinary PUT on %s',
    async (action) => {
      const f = adoptionFixture();
      expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
      expect(f.controller.getSnapshot()).toMatchObject({
        mode: 'account',
        adoption: { status: 'offer' },
      });
      const guestBefore = f.values.get('kendo-menu');
      const dashboardEntries = f.guestStore.getState().dashboardEntries;
      const saved: AccountCacheRecord = {
        version: 1,
        accountId: A,
        cacheValue: serializePersistedTrainingStateV10({ dashboardEntries }),
        identity: `peer-pending-${action}`,
        generation: 1,
      };
      const pending = {
        version: 1 as const,
        accountId: A,
        kind: 'dashboard-put' as const,
        cacheVersion: { identity: saved.identity, generation: saved.generation },
        request: {
          transportVersion: 1 as const,
          expectedAccountWorkspaceId: A,
          expectedRevision: '0' as const,
          requestId:
            action === 'choice'
              ? '12121212-1212-4212-8212-121212121212'
              : '34343434-3434-4434-8434-343434343434',
          catalogueVersion: 'a'.repeat(64),
          dashboard: { version: 10 as const, state: { dashboardEntries } },
        },
        createdAt: Date.now(),
      };
      f.database.caches.set(A, saved);
      f.syncDatabase.caches.set(A, saved);
      Object.assign(f.syncDatabase.state, { cache: saved, pendingRequest: pending });

      if (action === 'choice') await f.controller.chooseAdoption('yes');
      else await f.controller.retryAdoption();

      const reopened = f.controller.getSnapshot();
      expect(reopened).toMatchObject({ mode: 'account', adoption: { status: 'none' } });
      if (reopened.mode !== 'account') throw new Error('Expected the peer pending cache to reopen');
      expect(reopened.store.getState().dashboardEntries).toEqual(dashboardEntries);
      expect(f.syncDatabase.state.pendingRequest).toEqual(pending);
      expect(f.postAdoption).not.toHaveBeenCalled();
      expect(f.values.get('kendo-menu')).toBe(guestBefore);
      await f.controller.dispose();
    },
  );

  it('rehydrates a newer local cache while an earlier ordinary generation remains pending', async () => {
    const f = adoptionFixture();
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const guestBefore = f.values.get('kendo-menu');
    const peerValues = new Map<string, string>();
    const peerStore = createTrainingStore({
      storage: {
        getItem: (key) => peerValues.get(key) ?? null,
        setItem: (key, value) => peerValues.set(key, value),
        removeItem: (key) => peerValues.delete(key),
      },
    });
    const first = DEFAULT_TRAINING_SETS[0];
    const second = DEFAULT_TRAINING_SETS[1];
    if (first === undefined || second === undefined) throw new Error('Expected two training sets');
    peerStore.getState().addToDashboard(first.id);
    const pendingDashboardEntries = peerStore.getState().dashboardEntries;
    peerStore.getState().addToDashboard(second.id);
    const latestDashboardEntries = peerStore.getState().dashboardEntries;
    const saved: AccountCacheRecord = {
      version: 1,
      accountId: A,
      cacheValue: serializePersistedTrainingStateV10({
        dashboardEntries: latestDashboardEntries,
      }),
      identity: 'peer-pending-with-later-edit',
      generation: 2,
    };
    const pending = {
      version: 1 as const,
      accountId: A,
      kind: 'dashboard-put' as const,
      cacheVersion: { identity: saved.identity, generation: 1 },
      request: {
        transportVersion: 1 as const,
        expectedAccountWorkspaceId: A,
        expectedRevision: '0' as const,
        requestId: '78787878-7878-4878-8878-787878787878',
        catalogueVersion: 'a'.repeat(64),
        dashboard: {
          version: 10 as const,
          state: { dashboardEntries: pendingDashboardEntries },
        },
      },
      createdAt: Date.now(),
    };
    f.database.caches.set(A, saved);
    f.syncDatabase.caches.set(A, saved);
    Object.assign(f.syncDatabase.state, { cache: saved, pendingRequest: pending });

    await f.controller.chooseAdoption('yes');

    const reopened = f.controller.getSnapshot();
    expect(reopened).toMatchObject({ mode: 'account', adoption: { status: 'none' } });
    if (reopened.mode !== 'account') throw new Error('Expected the latest peer cache to reopen');
    expect(reopened.store.getState().dashboardEntries).toEqual(latestDashboardEntries);
    expect(f.syncDatabase.state.pendingRequest).toEqual(pending);
    expect(f.syncDatabase.state.cache).toEqual(saved);
    expect(f.postAdoption).not.toHaveBeenCalled();
    expect(f.values.get('kendo-menu')).toBe(guestBefore);
    await f.controller.dispose();
  });

  it('blocks a stale offer when a pending ordinary request is not bound to its shared cache', async () => {
    const f = adoptionFixture();
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const guestBefore = f.values.get('kendo-menu');
    const dashboardEntries = f.guestStore.getState().dashboardEntries;
    const saved: AccountCacheRecord = {
      version: 1,
      accountId: A,
      cacheValue: serializePersistedTrainingStateV10({ dashboardEntries }),
      identity: 'divergent-peer-pending',
      generation: 1,
    };
    f.database.caches.set(A, saved);
    f.syncDatabase.caches.set(A, saved);
    Object.assign(f.syncDatabase.state, {
      cache: saved,
      pendingRequest: {
        version: 1,
        accountId: A,
        kind: 'dashboard-put',
        cacheVersion: { identity: saved.identity, generation: saved.generation },
        request: {
          transportVersion: 1,
          expectedAccountWorkspaceId: A,
          expectedRevision: '0',
          requestId: '56565656-5656-4656-8656-565656565656',
          catalogueVersion: 'a'.repeat(64),
          dashboard: { version: 10, state: { dashboardEntries: [] } },
        },
        createdAt: Date.now(),
      },
    });

    await f.controller.chooseAdoption('yes');

    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'storage-recovery', decisionConfirmed: false },
    });
    expect(f.syncDatabase.state.cache).toEqual(saved);
    expect(f.postAdoption).not.toHaveBeenCalled();
    expect(f.values.get('kendo-menu')).toBe(guestBefore);
    await f.controller.dispose();
  });

  it('rehydrates a peer ordinary save at cache generation two acknowledged at cloud revision one', async () => {
    const f = adoptionFixture();
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'offer' },
    });
    const guestBefore = f.values.get('kendo-menu');
    const dashboardEntries = f.guestStore.getState().dashboardEntries;
    const savedValue = serializePersistedTrainingStateV10({ dashboardEntries });
    const saved: AccountCacheRecord = {
      version: 1,
      accountId: A,
      cacheValue: savedValue,
      identity: 'ordinary-peer-generation-two',
      generation: 2,
    };
    f.database.caches.set(A, saved);
    f.syncDatabase.caches.set(A, saved);
    Object.assign(f.syncDatabase.state, {
      cache: saved,
      acknowledgement: {
        version: 1,
        status: 'acknowledged',
        accountWorkspaceId: A,
        revision: '1',
        requestId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        cacheIdentity: saved.identity,
        generation: saved.generation,
        updatedAt: '2026-09-30T10:00:00.000Z',
      },
    });
    f.setSession({
      userId: A,
      verifiedGoogleEmail: null,
      adoption: { status: 'unavailable', capability: false },
    });
    await f.controller.chooseAdoption('no');

    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      session: { adoption: { status: 'unavailable' } },
      adoption: { status: 'none' },
    });
    const reopened = f.controller.getSnapshot();
    if (reopened.mode !== 'account') throw new Error('Expected the peer account cache to reopen');
    expect(reopened.store.getState().dashboardEntries).toEqual(dashboardEntries);
    expect(f.postAdoption).not.toHaveBeenCalled();
    expect(f.values.get('kendo-menu')).toBe(guestBefore);
    await f.controller.dispose();
  });

  it('keeps a generation-two peer cache blocked when its acknowledgement is still at generation one', async () => {
    const f = adoptionFixture();
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const guestBefore = f.values.get('kendo-menu');
    const dashboardEntries = f.guestStore.getState().dashboardEntries;
    const saved: AccountCacheRecord = {
      version: 1,
      accountId: A,
      cacheValue: serializePersistedTrainingStateV10({ dashboardEntries }),
      identity: 'divergent-peer-generation-two',
      generation: 2,
    };
    f.database.caches.set(A, saved);
    f.syncDatabase.caches.set(A, saved);
    Object.assign(f.syncDatabase.state, {
      cache: saved,
      acknowledgement: {
        version: 1,
        status: 'acknowledged',
        accountWorkspaceId: A,
        revision: '1',
        requestId: 'abababab-abab-4bab-8bab-abababababab',
        cacheIdentity: 'previous-peer-generation',
        generation: 1,
        updatedAt: '2026-09-30T10:00:00.000Z',
      },
    });
    f.setSession({
      userId: A,
      verifiedGoogleEmail: null,
      adoption: { status: 'unavailable', capability: false },
    });

    await f.controller.chooseAdoption('no');

    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account-error',
      storageFailure: 'unavailable',
    });
    expect(f.syncDatabase.state.cache).toEqual(saved);
    expect(f.postAdoption).not.toHaveBeenCalled();
    expect(f.values.get('kendo-menu')).toBe(guestBefore);
    await f.controller.dispose();
  });

  it('resumes a pending ordinary PUT after the verified session makes adoption unavailable', async () => {
    const f = adoptionFixture(undefined, false);
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const opened = f.controller.getSnapshot();
    if (opened.mode !== 'account') throw new Error('Expected account workspace');
    add(opened.store);
    await f.controller.flushPersistence();
    const cache = f.syncDatabase.caches.get(A);
    if (cache === undefined) throw new Error('Expected a durable account edit');
    Object.assign(f.syncDatabase.state, {
      cache,
      pendingRequest: {
        version: 1,
        accountId: A,
        kind: 'dashboard-put',
        cacheVersion: { identity: cache.identity, generation: cache.generation },
        request: {
          transportVersion: 1,
          expectedAccountWorkspaceId: A,
          expectedRevision: '0',
          requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          catalogueVersion: 'a'.repeat(64),
          dashboard: {
            version: 10,
            state: { dashboardEntries: opened.store.getState().dashboardEntries },
          },
        },
        createdAt: Date.now(),
      },
    });
    f.setSession({
      userId: A,
      verifiedGoogleEmail: null,
      adoption: { status: 'unavailable', capability: false },
    });

    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'none' },
      session: { adoption: { status: 'unavailable' } },
    });
    expect(f.syncDatabase.state.pendingRequest?.kind).toBe('dashboard-put');
    await f.controller.dispose();
  });

  it('releases a stalled adoption eligibility read into explicit recovery', async () => {
    const f = adoptionFixture();
    f.getDashboard.mockImplementationOnce(() => new Promise<never>(() => undefined));
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'storage-recovery', decisionConfirmed: false },
    });
    await f.controller.dispose();
  }, 15_000);

  it('releases a stalled adoption POST while retaining the durable choice for retry', async () => {
    const f = adoptionFixture();
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    f.postAdoption.mockImplementationOnce(() => new Promise<never>(() => undefined));
    await f.controller.chooseAdoption('no');
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'retryable', decision: 'no' },
    });
    expect(f.syncDatabase.state.pendingRequest).toMatchObject({
      kind: 'adoption',
      request: { decision: 'no' },
    });
    await f.controller.dispose();
  }, 15_000);

  it('keeps a cold account activation blocked until durable adoption state is read', async () => {
    const f = adoptionFixture();
    const gate = deferred<void>();
    let readStarted = false;
    f.syncDatabase.onSyncStateRead = async () => {
      readStarted = true;
      await gate.promise;
    };

    const opening = f.controller.bootstrap();
    await vi.waitFor(() => expect(readStarted).toBe(true));
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'checking' },
    });

    gate.resolve();
    expect(await opening).toEqual({ status: 'ready' });
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'offer', entryCount: 1 },
    });
    await f.controller.dispose();
  });

  it('closes a stale same-account editor when a terminal receipt has no durable cache', async () => {
    const f = adoptionFixture();
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'offer', entryCount: 1 },
    });

    f.setSession({
      userId: A,
      verifiedGoogleEmail: null,
      adoption: {
        status: 'accepted',
        capability: false,
        completion: {
          decision: 'yes',
          requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          acknowledgedRevision: '1',
          timestamp: '2026-09-30T10:00:00.000Z',
        },
      },
    });

    expect(await f.controller.bootstrap()).toEqual({ status: 'retryable', reason: 'storage' });
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account-error',
      session: { adoption: { status: 'accepted' } },
    });
    await f.controller.dispose();
  });

  it.each(['yes', 'no'] as const)(
    'rehydrates a stale offer after another controller completes %s in shared storage',
    async (decision) => {
      const timestamp = '2026-09-30T10:00:00.000Z';
      const post: AccountWorkspaceOptions['api']['postAdoption'] = (accountId, request) => {
        if (request.decision === 'yes') {
          f.setSession({
            userId: A,
            verifiedGoogleEmail: null,
            adoption: {
              status: 'accepted',
              capability: false,
              completion: {
                decision: 'yes',
                requestId: request.requestId,
                acknowledgedRevision: '1',
                timestamp,
              },
            },
          });
          return Promise.resolve({
            status: 'accepted',
            completion: {
              decision: 'yes',
              requestId: request.requestId,
              acknowledgedRevision: '1',
              timestamp,
            },
            acknowledgement: {
              transportVersion: 1,
              accountWorkspaceId: accountId,
              requestId: request.requestId,
              revision: '1',
              updatedAt: timestamp,
            },
          });
        }
        f.setSession({
          userId: A,
          verifiedGoogleEmail: null,
          adoption: {
            status: 'declined',
            capability: false,
            completion: { decision: 'no', requestId: request.requestId },
          },
        });
        return Promise.resolve({
          status: 'declined',
          completion: { decision: 'no', requestId: request.requestId },
        });
      };
      const f = adoptionFixture(post);
      const peer = f.createController();
      const guestBefore = f.values.get('kendo-menu');
      expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
      expect(await peer.bootstrap()).toEqual({ status: 'ready' });
      expect(peer.getSnapshot()).toMatchObject({ mode: 'account', adoption: { status: 'offer' } });

      await f.controller.chooseAdoption(decision);
      expect(f.syncDatabase.state.pendingRequest).toBeNull();
      expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
      expect(f.controller.getSnapshot().mode).toBe('account');
      await peer.chooseAdoption(decision === 'yes' ? 'no' : 'yes');
      expect(peer.getSnapshot()).toMatchObject({
        mode: 'account',
        adoption: { status: 'none' },
      });
      expect(f.postAdoption).toHaveBeenCalledTimes(1);
      expect(f.syncDatabase.state.cache?.generation).toBe(decision === 'yes' ? 1 : 0);
      const peerSnapshot = peer.getSnapshot();
      expect(
        peerSnapshot.mode === 'account'
          ? peerSnapshot.store.getState().dashboardEntries.length
          : -1,
      ).toBe(decision === 'yes' ? 1 : 0);
      expect(f.values.get('kendo-menu')).toBe(guestBefore);
      await peer.dispose();
      await f.controller.dispose();
    },
  );

  it('rehydrates a peer completion that lands after the choice first reads shared storage', async () => {
    const f = adoptionFixture();
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'offer' },
    });
    const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const timestamp = '2026-09-30T10:00:00.000Z';
    const terminal: AccountSession = {
      userId: A,
      verifiedGoogleEmail: null,
      adoption: {
        status: 'accepted',
        capability: false,
        completion: { decision: 'yes', requestId, acknowledgedRevision: '1', timestamp },
      },
    };
    const cache: AccountCacheRecord = {
      version: 1,
      accountId: A,
      cacheValue: serializePersistedTrainingStateV10({
        dashboardEntries: f.guestStore.getState().dashboardEntries,
      }),
      identity: 'peer-after-first-read',
      generation: 1,
    };
    f.setSession(terminal);
    f.getSession.mockImplementationOnce(() => {
      // chooseAdoption already observed the old generation-zero state. The peer's
      // transaction becomes visible as the guarded session check completes.
      f.syncDatabase.caches.set(A, cache);
      Object.assign(f.syncDatabase.state, {
        cache,
        pendingRequest: null,
        acknowledgement: {
          version: 1,
          status: 'acknowledged',
          accountWorkspaceId: A,
          revision: '1',
          requestId,
          cacheIdentity: cache.identity,
          generation: 1,
          updatedAt: timestamp,
        },
      });
      return Promise.resolve({ status: 'authenticated', session: terminal });
    });

    await f.controller.chooseAdoption('no');
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'none' },
    });
    const snapshot = f.controller.getSnapshot();
    expect(
      snapshot.mode === 'account' ? snapshot.store.getState().dashboardEntries.length : -1,
    ).toBe(1);
    expect(f.postAdoption).not.toHaveBeenCalled();
    await f.controller.dispose();
  });

  it('keeps a completed peer cache gated until the server verifies the terminal account decision', async () => {
    const timestamp = '2026-09-30T10:00:00.000Z';
    const post: AccountWorkspaceOptions['api']['postAdoption'] = (accountId, request) => {
      if (request.decision !== 'yes') return Promise.reject(new Error('Expected Yes'));
      f.setSession({
        userId: A,
        verifiedGoogleEmail: null,
        adoption: {
          status: 'accepted',
          capability: false,
          completion: {
            decision: 'yes',
            requestId: request.requestId,
            acknowledgedRevision: '1',
            timestamp,
          },
        },
      });
      return Promise.resolve({
        status: 'accepted',
        completion: {
          decision: 'yes',
          requestId: request.requestId,
          acknowledgedRevision: '1',
          timestamp,
        },
        acknowledgement: {
          transportVersion: 1,
          accountWorkspaceId: accountId,
          requestId: request.requestId,
          revision: '1',
          updatedAt: timestamp,
        },
      });
    };
    const f = adoptionFixture(post);
    const peer = f.createController();
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    expect(await peer.bootstrap()).toEqual({ status: 'ready' });
    await f.controller.chooseAdoption('yes');
    f.setSession({
      userId: A,
      verifiedGoogleEmail: null,
      adoption: { status: 'pending', capability: true },
    });
    await peer.chooseAdoption('no');
    expect(peer.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'storage-recovery', decisionConfirmed: false },
    });
    const acknowledgement = f.syncDatabase.state.acknowledgement;
    if (acknowledgement.status !== 'acknowledged' || acknowledgement.requestId === null)
      throw new Error('Expected completed peer adoption');
    f.setSession({
      userId: A,
      verifiedGoogleEmail: null,
      adoption: {
        status: 'accepted',
        capability: false,
        completion: {
          decision: 'yes',
          requestId: acknowledgement.requestId,
          acknowledgedRevision: '1',
          timestamp,
        },
      },
    });
    await peer.retryAdoption();
    expect(peer.getSnapshot()).toMatchObject({ mode: 'account', adoption: { status: 'none' } });
    await peer.dispose();
    await f.controller.dispose();
  });

  it.each([
    { local: 'yes', winner: 'no' },
    { local: 'no', winner: 'yes' },
  ] as const)(
    'reconciles the other tab’s authoritative $winner decision over local $local',
    async ({ local, winner }) => {
      const authoritativeRequestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const timestamp = '2026-09-30T10:00:00.000Z';
      const post: AccountWorkspaceOptions['api']['postAdoption'] = () => {
        f.setSession({
          userId: A,
          verifiedGoogleEmail: null,
          adoption:
            winner === 'yes'
              ? {
                  status: 'accepted',
                  capability: false,
                  completion: {
                    decision: 'yes',
                    requestId: authoritativeRequestId,
                    acknowledgedRevision: '1',
                    timestamp,
                  },
                }
              : {
                  status: 'declined',
                  capability: false,
                  completion: { decision: 'no', requestId: authoritativeRequestId },
                },
        });
        if (winner === 'yes') {
          f.setCloud({
            transportVersion: 1,
            accountWorkspaceId: A,
            catalogueVersion: 'a'.repeat(64),
            revision: '1',
            dashboard: { version: 10, state: { dashboardEntries: [] } },
            updatedAt: timestamp,
          });
        }
        return Promise.reject(new Error('ADOPTION_UNAVAILABLE'));
      };
      const f = adoptionFixture(post);
      const guestBefore = f.values.get('kendo-menu');
      expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });

      await f.controller.chooseAdoption(local);

      expect(f.syncDatabase.state.pendingRequest).toBeNull();
      expect(f.syncDatabase.state.acknowledgement).toMatchObject(
        winner === 'yes'
          ? {
              status: 'acknowledged',
              requestId: authoritativeRequestId,
              revision: '1',
              updatedAt: timestamp,
            }
          : { status: 'adoption-declined', requestId: authoritativeRequestId },
      );
      expect(f.syncDatabase.state.cache?.cacheValue).toContain('"dashboardEntries":[]');
      expect(f.values.get('kendo-menu')).toBe(guestBefore);
      expect(f.controller.getSnapshot()).toMatchObject({
        mode: 'account',
        adoption: { status: 'none' },
      });

      await f.controller.dispose();
      const reloaded = f.createController();
      expect(await reloaded.bootstrap()).toEqual({ status: 'ready' });
      expect(reloaded.getSnapshot()).toMatchObject({
        mode: 'account',
        adoption: { status: 'none' },
      });
      expect(f.syncDatabase.state.pendingRequest).toBeNull();
      await reloaded.dispose();
    },
  );

  it.each(['yes', 'no'] as const)(
    'reconciles a same-decision terminal receipt with another tab’s request ID (%s)',
    async (decision) => {
      const authoritativeRequestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const timestamp = '2026-09-30T10:00:00.000Z';
      const post: AccountWorkspaceOptions['api']['postAdoption'] = () => {
        f.setSession({
          userId: A,
          verifiedGoogleEmail: null,
          adoption:
            decision === 'yes'
              ? {
                  status: 'accepted',
                  capability: false,
                  completion: {
                    decision: 'yes',
                    requestId: authoritativeRequestId,
                    acknowledgedRevision: '1',
                    timestamp,
                  },
                }
              : {
                  status: 'declined',
                  capability: false,
                  completion: { decision: 'no', requestId: authoritativeRequestId },
                },
        });
        if (decision === 'yes') {
          f.setCloud({
            transportVersion: 1,
            accountWorkspaceId: A,
            catalogueVersion: 'a'.repeat(64),
            revision: '1',
            dashboard: { version: 10, state: { dashboardEntries: [] } },
            updatedAt: timestamp,
          });
        }
        return Promise.reject(new Error('ADOPTION_UNAVAILABLE'));
      };
      const f = adoptionFixture(post);
      expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
      await f.controller.chooseAdoption(decision);

      expect(f.syncDatabase.state.pendingRequest).toBeNull();
      expect(f.syncDatabase.state.acknowledgement).toMatchObject({
        requestId: authoritativeRequestId,
        status: decision === 'yes' ? 'acknowledged' : 'adoption-declined',
      });
      if (decision === 'yes') {
        expect(f.syncDatabase.state.cache?.cacheValue).toContain('"dashboardEntries":[]');
        expect(f.syncDatabase.state.cache?.cacheValue).not.toContain('Preserve this guest note');
      }
      await f.controller.dispose();
    },
  );

  it('recovers a losing tab after 409 and a later authoritative session receipt', async () => {
    const timestamp = '2026-09-30T10:00:00.000Z';
    const authoritativeRequestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const post: AccountWorkspaceOptions['api']['postAdoption'] = () =>
      Promise.reject(new Error('ADOPTION_UNAVAILABLE'));
    const f = adoptionFixture(post);
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    await f.controller.chooseAdoption('yes');
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'retryable', decision: 'yes' },
    });
    expect(f.syncDatabase.state.pendingRequest).toMatchObject({ kind: 'adoption' });

    f.setSession({
      userId: A,
      verifiedGoogleEmail: null,
      adoption: {
        status: 'accepted',
        capability: false,
        completion: {
          decision: 'yes',
          requestId: authoritativeRequestId,
          acknowledgedRevision: '1',
          timestamp,
        },
      },
    });
    f.setCloud({
      transportVersion: 1,
      accountWorkspaceId: A,
      catalogueVersion: 'a'.repeat(64),
      revision: '1',
      dashboard: { version: 10, state: { dashboardEntries: [] } },
      updatedAt: timestamp,
    });
    await f.controller.retryAdoption();

    expect(f.postAdoption).toHaveBeenCalledTimes(1);
    expect(f.syncDatabase.state.pendingRequest).toBeNull();
    expect(f.syncDatabase.state.acknowledgement).toMatchObject({
      requestId: authoritativeRequestId,
      revision: '1',
      updatedAt: timestamp,
    });
    await f.controller.dispose();
  });

  it('installs the later authenticated cloud revision without attributing it to adoption', async () => {
    const post: AccountWorkspaceOptions['api']['postAdoption'] = () =>
      Promise.reject(new Error('ADOPTION_UNAVAILABLE'));
    const f = adoptionFixture(post);
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    await f.controller.chooseAdoption('yes');
    const guestBefore = f.values.get('kendo-menu');

    f.setSession({
      userId: A,
      verifiedGoogleEmail: null,
      adoption: {
        status: 'accepted',
        capability: false,
        completion: {
          decision: 'yes',
          requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          acknowledgedRevision: '1',
          timestamp: '2026-09-30T10:00:00.000Z',
        },
      },
    });
    f.setCloud({
      transportVersion: 1,
      accountWorkspaceId: A,
      catalogueVersion: 'a'.repeat(64),
      revision: '2',
      dashboard: { version: 10, state: { dashboardEntries: [] } },
      updatedAt: '2026-09-30T10:01:00.000Z',
    });
    await f.controller.retryAdoption();

    expect(f.syncDatabase.state.pendingRequest).toBeNull();
    expect(f.syncDatabase.state.cache?.cacheValue).toContain('"dashboardEntries":[]');
    expect(f.syncDatabase.state.acknowledgement).toMatchObject({
      status: 'acknowledged',
      revision: '2',
      updatedAt: '2026-09-30T10:01:00.000Z',
      requestId: null,
    });
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'none' },
    });
    expect(f.values.get('kendo-menu')).toBe(guestBefore);
    await f.controller.dispose();
  });

  it('uses the latest cloud snapshot even when the terminal receipt matches the pending request', async () => {
    const f = adoptionFixture();
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    await f.controller.chooseAdoption('yes');
    const pending = f.syncDatabase.state.pendingRequest;
    if (pending?.kind !== 'adoption') throw new Error('Expected pending Yes request');
    f.setSession({
      userId: A,
      verifiedGoogleEmail: null,
      adoption: {
        status: 'accepted',
        capability: false,
        completion: {
          decision: 'yes',
          requestId: pending.request.requestId,
          acknowledgedRevision: '1',
          timestamp: '2026-09-30T10:00:00.000Z',
        },
      },
    });
    f.setCloud({
      transportVersion: 1,
      accountWorkspaceId: A,
      catalogueVersion: 'a'.repeat(64),
      revision: '2',
      dashboard: { version: 10, state: { dashboardEntries: [] } },
      updatedAt: '2026-09-30T10:01:00.000Z',
    });
    await f.controller.retryAdoption();
    expect(f.syncDatabase.state.acknowledgement).toMatchObject({
      status: 'acknowledged',
      revision: '2',
      requestId: null,
    });
    expect(f.syncDatabase.state.cache?.cacheValue).not.toContain('Preserve this guest note');
    await f.controller.dispose();
  });

  it('keeps the adoption gate closed when identity changes during cloud reconciliation', async () => {
    const f = adoptionFixture();
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    await f.controller.chooseAdoption('yes');
    const pending = f.syncDatabase.state.pendingRequest;
    const cloudRead = deferred<DashboardReadResponse>();
    f.getDashboard.mockImplementationOnce(() => cloudRead.promise);
    const previousCloudReads = f.getDashboard.mock.calls.length;
    f.setSession({
      userId: A,
      verifiedGoogleEmail: null,
      adoption: {
        status: 'accepted',
        capability: false,
        completion: {
          decision: 'yes',
          requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          acknowledgedRevision: '1',
          timestamp: '2026-09-30T10:00:00.000Z',
        },
      },
    });
    const retry = f.controller.retryAdoption();
    await vi.waitFor(() =>
      expect(f.getDashboard.mock.calls.length).toBeGreaterThan(previousCloudReads),
    );
    f.setSession({
      userId: B,
      verifiedGoogleEmail: null,
      adoption: { status: 'unavailable', capability: false },
    });
    cloudRead.resolve({
      transportVersion: 1,
      accountWorkspaceId: A,
      catalogueVersion: 'a'.repeat(64),
      revision: '1',
      dashboard: { version: 10, state: { dashboardEntries: [] } },
      updatedAt: '2026-09-30T10:00:00.000Z',
    });
    await retry;
    expect(f.syncDatabase.state.pendingRequest).toEqual(pending);
    expect(f.syncDatabase.state.acknowledgement.status).toBe('unknown');
    expect(f.controller.getSnapshot().mode).toBe('guest');
    await f.controller.dispose();
  });

  it.each([
    { label: 'zero', revision: '0', updatedAt: null, dashboard: null, accountId: A },
    {
      label: 'lower',
      revision: '1',
      updatedAt: '2026-09-30T10:01:00.000Z',
      dashboard: { version: 10, state: { dashboardEntries: [] } },
      accountId: A,
    },
    {
      label: 'malformed',
      revision: 'bogus',
      updatedAt: '2026-09-30T10:01:00.000Z',
      dashboard: { version: 10, state: { dashboardEntries: [] } },
      accountId: A,
    },
    {
      label: 'wrong account',
      revision: '2',
      updatedAt: '2026-09-30T10:01:00.000Z',
      dashboard: { version: 10, state: { dashboardEntries: [] } },
      accountId: B,
    },
    {
      label: 'invalid timestamp',
      revision: '2',
      updatedAt: '2026-99-30T10:01:00.000Z',
      dashboard: { version: 10, state: { dashboardEntries: [] } },
      accountId: A,
    },
  ] as const)(
    'keeps pending adoption intact for a $label authoritative dashboard',
    async ({ revision, updatedAt, dashboard, accountId }) => {
      const f = adoptionFixture();
      expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
      await f.controller.chooseAdoption('yes');
      const pending = f.syncDatabase.state.pendingRequest;
      f.setSession({
        userId: A,
        verifiedGoogleEmail: null,
        adoption: {
          status: 'accepted',
          capability: false,
          completion: {
            decision: 'yes',
            requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            acknowledgedRevision: '2',
            timestamp: '2026-09-30T10:00:00.000Z',
          },
        },
      });
      f.setCloud({
        transportVersion: 1,
        accountWorkspaceId: accountId,
        catalogueVersion: 'a'.repeat(64),
        revision,
        dashboard,
        updatedAt,
      });
      await f.controller.retryAdoption();
      expect(f.syncDatabase.state.pendingRequest).toEqual(pending);
      expect(f.syncDatabase.state.acknowledgement.status).toBe('unknown');
      expect(f.controller.getSnapshot().mode).toBe('account-error');
      await f.controller.dispose();
    },
  );

  it('keeps reconciliation blocked when the cache diverges or IndexedDB fails', async () => {
    for (const failure of ['diverged', 'indexeddb'] as const) {
      const authoritativeRequestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      let terminalAvailable = false;
      const post: AccountWorkspaceOptions['api']['postAdoption'] = () => {
        f.setSession(
          terminalAvailable
            ? {
                userId: A,
                verifiedGoogleEmail: null,
                adoption: {
                  status: 'declined',
                  capability: false,
                  completion: { decision: 'no', requestId: authoritativeRequestId },
                },
              }
            : {
                userId: A,
                verifiedGoogleEmail: null,
                adoption: { status: 'pending', capability: true },
              },
        );
        return Promise.reject(new Error('ADOPTION_UNAVAILABLE'));
      };
      const f = adoptionFixture(post);
      expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
      await f.controller.chooseAdoption('yes');
      const pending = f.syncDatabase.state.pendingRequest;
      if (pending === null) throw new Error('Expected the pending local adoption request');
      const originalCache = f.syncDatabase.state.cache;
      if (originalCache === null) throw new Error('Expected the account cache');
      if (failure === 'diverged') {
        Object.assign(f.syncDatabase.state, {
          cache: { ...originalCache, generation: 1 },
        });
      } else {
        f.syncDatabase.onWrite = () => Promise.reject(new Error('IndexedDB quota fixture'));
      }
      terminalAvailable = true;
      f.setSession({
        userId: A,
        verifiedGoogleEmail: null,
        adoption: {
          status: 'declined',
          capability: false,
          completion: { decision: 'no', requestId: authoritativeRequestId },
        },
      });
      await f.controller.retryAdoption();
      expect(f.syncDatabase.state.pendingRequest).toEqual(pending);
      expect(f.syncDatabase.state.cache?.cacheValue).toBe(originalCache.cacheValue);
      expect(f.controller.getSnapshot().mode).toBe('account-error');
      await f.controller.dispose();
    }
  });

  it.each(['yes', 'no'] as const)(
    'keeps a durable %s decision request stable across retry and reload',
    async (decision) => {
      const f = adoptionFixture();
      expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });

      await f.controller.chooseAdoption(decision);
      expect(f.controller.getSnapshot()).toMatchObject({
        mode: 'account',
        adoption: { status: 'retryable', decision },
      });
      const pending = f.syncDatabase.state.pendingRequest;
      if (pending?.kind !== 'adoption') throw new Error('Expected a durable adoption request');
      const originalRequest = pending.request;
      expect(f.postAdoption).toHaveBeenCalledTimes(1);
      expect(f.postAdoption.mock.calls[0]?.[1]).toEqual(originalRequest);

      if (decision === 'yes') {
        if (originalRequest.decision !== 'yes') throw new Error('Expected a Yes request');
        const payloadEntry = originalRequest.dashboard.state.dashboardEntries[0];
        if (payloadEntry === undefined) throw new Error('Expected the guest payload entry');
        expect(payloadEntry.notes).toBe('Preserve this guest note');
        expect(Object.keys(payloadEntry.quantityOverrides)).toHaveLength(1);
        expect(Object.values(payloadEntry.quantityOverrides)[0]).toMatchObject({ repetitions: 17 });
      } else {
        expect(Object.keys(originalRequest).sort()).toEqual([
          'decision',
          'expectedAccountWorkspaceId',
          'requestId',
          'transportVersion',
        ]);
      }

      await f.controller.retryAdoption();
      expect(f.postAdoption).toHaveBeenCalledTimes(2);
      expect(f.postAdoption.mock.calls[1]?.[1]).toEqual(originalRequest);

      await f.controller.dispose();
      const restored = f.createController();
      expect(await restored.bootstrap()).toEqual({ status: 'ready' });
      await vi.waitFor(() => expect(f.postAdoption).toHaveBeenCalledTimes(3));
      expect(f.postAdoption.mock.calls[2]?.[1]).toEqual(originalRequest);
      expect(f.syncDatabase.state.pendingRequest).toMatchObject({
        kind: 'adoption',
        request: { decision, requestId: originalRequest.requestId },
      });
      await restored.dispose();
    },
  );

  it('completes from a matching Yes response when the following session request fails', async () => {
    const timestamp = '2026-09-30T10:00:00.000Z';
    const acceptedResponse: AccountWorkspaceOptions['api']['postAdoption'] = (
      accountId,
      request,
    ) => {
      if (request.decision !== 'yes') {
        return Promise.reject(new Error('Expected a Yes request'));
      }
      return Promise.resolve({
        status: 'accepted',
        completion: {
          decision: 'yes',
          requestId: request.requestId,
          acknowledgedRevision: '1',
          timestamp,
        },
        acknowledgement: {
          transportVersion: 1,
          accountWorkspaceId: accountId,
          requestId: request.requestId,
          revision: '1',
          updatedAt: timestamp,
        },
      });
    };
    const f = adoptionFixture(acceptedResponse);
    let sessionReads = 0;
    f.getSession.mockImplementation(() => {
      sessionReads += 1;
      if (sessionReads === 3) {
        expect(f.syncDatabase.state.pendingRequest).toBeNull();
        return Promise.reject(new Error('Session endpoint unavailable after acceptance'));
      }
      return Promise.resolve({
        status: 'authenticated' as const,
        session: {
          userId: A,
          verifiedGoogleEmail: null,
          adoption: { status: 'pending', capability: true },
        },
      });
    });

    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    await f.controller.chooseAdoption('yes');

    expect(f.syncDatabase.state.pendingRequest).toBeNull();
    expect(f.syncDatabase.state.acknowledgement).toMatchObject({
      status: 'acknowledged',
      revision: '1',
      updatedAt: timestamp,
    });
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      session: { adoption: { status: 'accepted' } },
      adoption: { status: 'none' },
    });
    expect(f.syncDatabase.state.cache?.cacheValue).toContain('Preserve this guest note');
    expect(sessionReads).toBe(2);
    expect(f.values.get('kendo-menu')).toContain('Preserve this guest note');
    await f.controller.dispose();
  });

  it('recovers a lost No response from the matching terminal session receipt', async () => {
    const lostResponse: AccountWorkspaceOptions['api']['postAdoption'] = (_accountId, request) => {
      f.setSession({
        userId: A,
        verifiedGoogleEmail: null,
        adoption: {
          status: 'declined',
          capability: false,
          completion: { decision: 'no', requestId: request.requestId },
        },
      });
      return Promise.reject(new Error('The accepted response was lost'));
    };
    const f = adoptionFixture(lostResponse);
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });

    await f.controller.chooseAdoption('no');

    expect(f.syncDatabase.state.pendingRequest).toBeNull();
    expect(f.syncDatabase.state.acknowledgement).toMatchObject({
      status: 'adoption-declined',
      accountWorkspaceId: A,
      requestId: f.postAdoption.mock.calls[0]?.[1].requestId,
    });
    expect(f.postAdoption).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'none' },
    });
    await f.controller.dispose();
  });

  it.each(['signed-out', 'different-account'] as const)(
    'hides account A when adoption recovery verifies %s',
    async (identityResult) => {
      const f = adoptionFixture(() => Promise.reject(new Error('Response was lost')));
      expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
      let recoveryReads = 0;
      f.getSession.mockImplementation(() => {
        recoveryReads += 1;
        if (recoveryReads === 1) {
          return Promise.resolve({
            status: 'authenticated' as const,
            session: {
              userId: A,
              verifiedGoogleEmail: null,
              adoption: { status: 'pending' as const, capability: true },
            },
          });
        }
        return Promise.resolve(
          identityResult === 'signed-out'
            ? { status: 'signed-out' as const }
            : {
                status: 'authenticated' as const,
                session: {
                  userId: B,
                  verifiedGoogleEmail: null,
                  adoption: { status: 'unavailable' as const, capability: false },
                },
              },
        );
      });

      await f.controller.chooseAdoption('no');

      expect(f.controller.getSnapshot().mode).toBe('guest');
      expect(f.syncDatabase.state.pendingRequest).toMatchObject({
        kind: 'adoption',
        request: { decision: 'no' },
      });
      await f.controller.dispose();
    },
  );

  it('keeps a declined request pending when the account cache diverges before completion', async () => {
    const response: AccountWorkspaceOptions['api']['postAdoption'] = (accountId, request) => {
      if (request.decision !== 'no') return Promise.reject(new Error('Expected No'));
      const cache = f.syncDatabase.state.cache;
      if (cache !== null) {
        Object.assign(f.syncDatabase.state, {
          cache: { ...cache, generation: 1 },
        });
      }
      return Promise.resolve({
        status: 'declined',
        completion: { decision: 'no', requestId: request.requestId },
      });
    };
    const f = adoptionFixture(response);
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });

    await f.controller.chooseAdoption('no');

    expect(f.syncDatabase.state.pendingRequest).toMatchObject({
      kind: 'adoption',
      request: { decision: 'no' },
    });
    expect(f.syncDatabase.state.cache).toMatchObject({ generation: 1, cacheValue: empty });
    expect(f.syncDatabase.state.acknowledgement.status).not.toBe('adoption-declined');
    expect(f.controller.getSnapshot()).toMatchObject({ mode: 'account-error' });
    await f.controller.dispose();
  });

  it('keeps editing hidden when acceptance is confirmed but the cache transaction fails', async () => {
    const timestamp = '2026-09-30T10:00:00.000Z';
    const acceptedResponse: AccountWorkspaceOptions['api']['postAdoption'] = (
      accountId,
      request,
    ) => {
      if (request.decision !== 'yes') return Promise.reject(new Error('Expected a Yes request'));
      return Promise.resolve({
        status: 'accepted',
        completion: {
          decision: 'yes',
          requestId: request.requestId,
          acknowledgedRevision: '1',
          timestamp,
        },
        acknowledgement: {
          transportVersion: 1,
          accountWorkspaceId: accountId,
          requestId: request.requestId,
          revision: '1',
          updatedAt: timestamp,
        },
      });
    };
    const f = adoptionFixture(acceptedResponse);
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    f.syncDatabase.onWrite = () => {
      throw new Error('IndexedDB quota fixture');
    };

    await f.controller.chooseAdoption('yes');

    expect(f.controller.getSnapshot()).toMatchObject({ mode: 'account-error', userId: A });
    expect(f.syncDatabase.state.pendingRequest).toMatchObject({
      kind: 'adoption',
      request: { decision: 'yes' },
    });
    expect(f.values.get('kendo-menu')).toContain('Preserve this guest note');
    await f.controller.dispose();
  });

  it('keeps a dedicated blocked state while the accepted cache transaction is pending', async () => {
    const gate = deferred<void>();
    const response: AccountWorkspaceOptions['api']['postAdoption'] = (accountId, request) => {
      if (request.decision !== 'yes') return Promise.reject(new Error('Expected Yes'));
      f.syncDatabase.onWrite = () => gate.promise;
      const timestamp = '2026-09-30T10:00:00.000Z';
      return Promise.resolve({
        status: 'accepted',
        completion: {
          decision: 'yes',
          requestId: request.requestId,
          acknowledgedRevision: '1',
          timestamp,
        },
        acknowledgement: {
          transportVersion: 1,
          accountWorkspaceId: accountId,
          requestId: request.requestId,
          revision: '1',
          updatedAt: timestamp,
        },
      });
    };
    const f = adoptionFixture(response);
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });

    const choosing = f.controller.chooseAdoption('yes');
    await vi.waitFor(() =>
      expect(f.controller.getSnapshot()).toMatchObject({
        mode: 'account',
        adoption: { status: 'completing', decision: 'yes' },
      }),
    );
    gate.resolve();
    await choosing;
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      session: { adoption: { status: 'accepted' } },
      adoption: { status: 'none' },
    });
    await f.controller.dispose();
  });

  it.each(['yes', 'no'] as const)(
    'does not reopen a signed-out account after a held %s completion commits',
    async (decision) => {
      const gate = deferred<void>();
      const response: AccountWorkspaceOptions['api']['postAdoption'] = (accountId, request) => {
        if (request.decision !== decision) return Promise.reject(new Error('Wrong decision'));
        f.syncDatabase.onWrite = () => gate.promise;
        const completion = {
          decision: 'yes' as const,
          requestId: request.requestId,
          acknowledgedRevision: '1',
          timestamp: '2026-09-30T10:00:00.000Z',
        };
        return Promise.resolve(
          decision === 'yes'
            ? {
                status: 'accepted',
                completion,
                acknowledgement: {
                  transportVersion: 1,
                  accountWorkspaceId: accountId,
                  requestId: request.requestId,
                  revision: '1',
                  updatedAt: completion.timestamp,
                },
              }
            : { status: 'declined', completion: { decision: 'no', requestId: request.requestId } },
        );
      };
      const f = adoptionFixture(response);
      expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
      const choosing = f.controller.chooseAdoption(decision);
      await vi.waitFor(() =>
        expect(f.controller.getSnapshot()).toMatchObject({
          mode: 'account',
          adoption: { status: 'completing', decision },
        }),
      );
      f.getSession.mockResolvedValue({ status: 'signed-out' });
      f.syncDatabase.onWrite = undefined;
      expect(await f.controller.bootstrap()).toEqual({ status: 'signed-out' });
      gate.resolve();
      await choosing;
      expect(f.controller.getSnapshot().mode).toBe('guest');
      expect(f.syncDatabase.state.pendingRequest).toBeNull();
      await f.controller.dispose();
    },
  );

  it.each(['yes', 'no'] as const)(
    'does not replace a newly verified account B after a held %s completion commits for A',
    async (decision) => {
      const gate = deferred<void>();
      const response: AccountWorkspaceOptions['api']['postAdoption'] = (accountId, request) => {
        if (request.decision !== decision) return Promise.reject(new Error('Wrong decision'));
        f.syncDatabase.onWrite = () => gate.promise;
        const timestamp = '2026-09-30T10:00:00.000Z';
        return Promise.resolve(
          decision === 'yes'
            ? {
                status: 'accepted',
                completion: {
                  decision: 'yes',
                  requestId: request.requestId,
                  acknowledgedRevision: '1',
                  timestamp,
                },
                acknowledgement: {
                  transportVersion: 1,
                  accountWorkspaceId: accountId,
                  requestId: request.requestId,
                  revision: '1',
                  updatedAt: timestamp,
                },
              }
            : { status: 'declined', completion: { decision: 'no', requestId: request.requestId } },
        );
      };
      const f = adoptionFixture(response);
      expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
      const choosing = f.controller.chooseAdoption(decision);
      await vi.waitFor(() =>
        expect(f.controller.getSnapshot()).toMatchObject({
          mode: 'account',
          adoption: { status: 'completing', decision },
        }),
      );
      f.setSession({
        userId: B,
        verifiedGoogleEmail: null,
        adoption: { status: 'unavailable', capability: false },
      });
      f.syncDatabase.onWrite = undefined;
      expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
      gate.resolve();
      await choosing;
      expect(f.controller.getSnapshot()).toMatchObject({ mode: 'account', userId: B });
      await f.controller.dispose();
    },
  );

  it('refreshes the offer when guest content changes without changing its displayed count', async () => {
    const f = fixture();
    add(f.guestStore);
    const guestRaw = f.values.get('kendo-menu');
    if (guestRaw === undefined) throw new Error('Expected the guest snapshot');

    const verifiedSession: AccountSession = {
      userId: A,
      verifiedGoogleEmail: null,
      adoption: { status: 'pending', capability: true },
    };
    const syncDatabase = new MemorySynchronizationDatabase();
    const cloud: DashboardReadResponse = {
      transportVersion: 1,
      accountWorkspaceId: A,
      catalogueVersion: 'a'.repeat(64),
      revision: '0',
      dashboard: null,
      updatedAt: null,
    };
    const postAdoptionRequest: AccountWorkspaceOptions['api']['postAdoption'] = (
      accountId,
      request,
    ) => f.api.postAdoption(accountId, request);
    const postAdoption = vi.fn(postAdoptionRequest);
    const controller = createAccountWorkspaceController({
      guestStore: f.guestStore,
      storage: f.storage,
      api: {
        getSession: vi.fn(() =>
          Promise.resolve({ status: 'authenticated' as const, session: verifiedSession }),
        ),
        logout: () => f.api.logout(),
        postAdoption,
      },
      coordination: f.coordination,
      database: f.database,
      synchronization: {
        api: {
          getDashboard: vi.fn(() => Promise.resolve(cloud)),
          putDashboard: (accountId, request) => f.api.putDashboard(accountId, request),
          postAdoption,
        },
        database: syncDatabase,
        locks: {
          request: async (name, _options, callback) => await callback({ name, mode: 'exclusive' }),
        },
      },
    });

    expect(await controller.bootstrap()).toEqual({ status: 'ready' });
    expect(controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'offer', entryCount: 1 },
    });
    const guestEntry = f.guestStore.getState().dashboardEntries[0];
    if (guestEntry === undefined) throw new Error('Expected one guest entry');
    f.guestStore.getState().updateDashboardEntry(guestEntry.id, { notes: 'Changed after offer' });
    const updatedGuestRaw = f.values.get('kendo-menu');
    expect(updatedGuestRaw).not.toBe(guestRaw);

    await controller.chooseAdoption('yes');

    expect(controller.getSnapshot()).toMatchObject({
      mode: 'account',
      adoption: { status: 'offer', entryCount: 1 },
    });
    expect(postAdoption).not.toHaveBeenCalled();
    expect(syncDatabase.state.pendingRequest).toBeNull();
    expect(f.values.get('kendo-menu')).toBe(updatedGuestRaw);
    await controller.dispose();
  });

  it('exposes account write pending state and waits for durable readback on flush', async () => {
    const f = fixture();
    await expect(f.controller.bootstrap()).resolves.toMatchObject({ status: 'ready' });
    const gate = deferred<void>();
    f.database.onWrite = () => gate.promise;

    const accountStore = f.controller.getSnapshot();
    if (accountStore.mode !== 'account') throw new Error('Expected verified account workspace');
    add(accountStore.store);

    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      persistencePending: true,
      persistenceFailure: null,
    });
    let flushFinished = false;
    const flush = f.controller.flushPersistence().finally(() => {
      flushFinished = true;
    });
    await Promise.resolve();
    expect(flushFinished).toBe(false);

    gate.resolve();
    await flush;
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      persistencePending: false,
      persistenceFailure: null,
    });
    const persisted = f.database.caches.get(A)?.cacheValue;
    expect(persisted).toContain('"id"');
  });

  it('exposes failed account writes and rejects an explicit durability flush', async () => {
    const f = fixture();
    await expect(f.controller.bootstrap()).resolves.toMatchObject({ status: 'ready' });
    f.database.onWrite = () => Promise.reject(new Error('quota exceeded'));

    const accountStore = f.controller.getSnapshot();
    if (accountStore.mode !== 'account') throw new Error('Expected verified account workspace');
    add(accountStore.store);

    await expect(f.controller.flushPersistence()).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      persistencePending: false,
      persistenceFailure: 'unavailable',
    });
  });

  it('keeps warm local persistence when Web Lock acquisition becomes unavailable', async () => {
    const f = fixture();
    let rejectLocks = false;
    const coordination = createWorkspaceCoordinator({
      events: null,
      locks: {
        request: async (name, callback) => {
          if (rejectLocks) throw new Error('Lock provider unavailable');
          return callback({ name, mode: 'exclusive' });
        },
      },
    });
    const controller = createAccountWorkspaceController({
      guestStore: f.guestStore,
      storage: f.storage,
      api: f.api,
      coordination,
      database: f.database,
    });
    expect(await controller.bootstrap()).toEqual({ status: 'ready' });
    const active = controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('Expected account');
    rejectLocks = true;
    add(active.store);
    expect(await controller.hideLocally()).toEqual({
      status: 'hidden',
      serverRevocationConfirmed: false,
    });
    expect(coordination.isAvailable).toBe(false);
    expect(await controller.bootstrap()).toEqual({ status: 'ready' });
    const reopened = controller.getSnapshot();
    if (reopened.mode !== 'account') throw new Error('Expected account');
    expect(reopened.store.getState().dashboardEntries).toHaveLength(1);
    expect(reopened.synchronization).toBe('unavailable');
    expect(reopened.persistenceFailure).toBeNull();
    await controller.dispose();
  });
  it('retains the existing guest migration at kendo-menu without adopting it', async () => {
    const f = fixture(
      true,
      JSON.stringify({
        version: 9,
        state: {
          dashboardEntries: [],
          customTrainingSets: [],
        },
      }),
    );
    const migrated = f.values.get('kendo-menu');
    expect(migrated).toBe(empty);
    add(f.guestStore);
    const populatedGuest = f.values.get('kendo-menu');
    await f.controller.bootstrap();
    const account = f.controller.getSnapshot();
    if (account.mode !== 'account') throw new Error('account missing');
    expect(account.store.getState().dashboardEntries).toHaveLength(0);
    await f.controller.hideLocally();
    expect(f.values.get('kendo-menu')).toBe(populatedGuest);
    expect(f.controller.getSnapshot().mode).toBe('guest');
  });
  it('uses the real strict session client', async () => {
    const f = fixture();
    await expect(f.api.getSession()).resolves.toMatchObject({ status: 'authenticated' });
  });
  it('does not touch a remembered account before session verification; 401 keeps guest intact', async () => {
    const f = fixture();
    add(f.guestStore);
    const guest = f.values.get('kendo-menu');
    f.values.set(deriveAccountStorageKey(A), empty);
    const pending = deferred<Response>();
    f.fetch.mockReturnValueOnce(pending.promise);
    const bootstrap = f.controller.bootstrap();
    expect(f.reads.every((key) => key === 'kendo-menu')).toBe(true);
    pending.resolve(signedOut());
    expect(await bootstrap).toEqual({ status: 'signed-out' });
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(f.values.get('kendo-menu')).toBe(guest);
    expect(f.reads.every((key) => key === 'kendo-menu')).toBe(true);
  });

  it.each(['network', 'html', '503'])(
    'cold %s failure keeps remembered caches hidden',
    async (failure) => {
      const f = fixture();
      f.values.set(deriveAccountStorageKey(A), empty);
      if (failure === 'network') f.fetch.mockRejectedValueOnce(new Error('offline'));
      else
        f.fetch.mockResolvedValueOnce(
          new Response(failure === 'html' ? '<html>SPA</html>' : '{}', {
            status: failure === '503' ? 503 : 200,
            headers: { 'content-type': failure === 'html' ? 'text/html' : 'application/json' },
          }),
        );
      expect(await f.controller.bootstrap()).toEqual({ status: 'retryable', reason: 'bootstrap' });
      expect(f.controller.getSnapshot().mode).toBe('guest');
      expect(f.reads.every((key) => key === 'kendo-menu')).toBe(true);
    },
  );

  it('uses distinct real stores, survives warm offline edits, hides and reopens the same user', async () => {
    const f = fixture();
    add(f.guestStore);
    const guest = f.values.get('kendo-menu');
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const initial = f.controller.getSnapshot();
    if (initial.mode !== 'account') throw new Error('account missing');
    expect(initial.store).not.toBe(f.guestStore);
    const entryId = add(initial.store);
    f.fetch.mockRejectedValueOnce(new Error('offline'));
    expect(await f.controller.bootstrap()).toEqual({ status: 'retryable', reason: 'bootstrap' });
    initial.store.getState().updateDashboardEntry(entryId, { notes: 'warm offline edit' });
    expect(await f.controller.hideLocally()).toEqual({
      status: 'hidden',
      serverRevocationConfirmed: false,
    });
    expect(initial.store.getState().dashboardEntries).toEqual([]);
    const retained = f.database.caches.get(A)?.cacheValue;
    add(initial.store);
    await Promise.resolve();
    expect(f.database.caches.get(A)?.cacheValue).toBe(retained);
    expect(f.values.get('kendo-menu')).toBe(guest);
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const reopened = f.controller.getSnapshot();
    if (reopened.mode !== 'account') throw new Error('account missing');
    expect(reopened.epoch).toBeGreaterThan(initial.epoch);
    expect(reopened.store).not.toBe(initial.store);
    expect(reopened.store.getState().dashboardEntries[0]?.notes).toBe('warm offline edit');
  });

  it('deactivates A before accessing B, never overwrites guest or A on a switch', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const old = f.controller.getSnapshot();
    if (old.mode !== 'account') throw new Error('account missing');
    add(old.store);
    await f.controller.hideLocally();
    await f.controller.bootstrap();
    const a = f.controller.getSnapshot();
    if (a.mode !== 'account') throw new Error('account missing');
    const retained = f.database.caches.get(A)?.cacheValue;
    const get = f.storage.getItem;
    f.storage.getItem = (key) => {
      if (key.startsWith(deriveAccountStorageKey(B)))
        expect(a.store.getState().dashboardEntries).toEqual([]);
      return get(key);
    };
    f.fetch.mockResolvedValueOnce(session(B));
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const b = f.controller.getSnapshot();
    expect(b.mode === 'account' && b.userId).toBe(B);
    expect(f.database.caches.get(A)?.cacheValue).toBe(retained);
    expect(f.database.caches.get(B)?.cacheValue).toBe(empty);
  });

  it('preserves malformed legacy cache and leaves obsolete sync markers unused', async () => {
    const corrupt = fixture();
    const key = deriveAccountStorageKey(A);
    corrupt.values.set(key, '{broken');
    expect(await corrupt.controller.bootstrap()).toEqual({
      status: 'retryable',
      reason: 'storage',
    });
    expect(corrupt.controller.getSnapshot()).toMatchObject({
      mode: 'account-error',
      storageFailure: 'invalid-persisted-value',
    });
    expect(corrupt.values.get(key)).toBe('{broken');

    for (const raw of ['{"version":1}', `{"version":999,"accountId":"${A}"}`]) {
      const f = fixture();
      const marker = `${deriveAccountStorageKey(A)}:sync`;
      f.values.set(marker, raw);
      expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
      expect(f.values.get(marker)).toBe(raw);
      expect(f.database.metadata.get(`${A}:ack`)).toEqual({ version: 1, status: 'unknown' });
    }
  });

  it('keeps Use this device ahead of a held account-error Retry', async () => {
    const f = fixture();
    f.values.set(deriveAccountStorageKey(A), '{broken');
    expect(await f.controller.bootstrap()).toEqual({ status: 'retryable', reason: 'storage' });
    expect(f.controller.getSnapshot()).toMatchObject({ mode: 'account-error', userId: A });

    const heldRetry = deferred<Response>();
    f.fetch.mockReturnValueOnce(heldRetry.promise);
    const retry = f.controller.bootstrap();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(2));
    const retrySignal = f.fetch.mock.calls[1]?.[1]?.signal;

    expect(await f.controller.hideLocally()).toEqual({
      status: 'hidden',
      serverRevocationConfirmed: false,
    });
    expect(retrySignal?.aborted).toBe(true);

    heldRetry.resolve(session(A));
    expect(await retry).toEqual({ status: 'superseded' });
    expect(f.controller.getSnapshot().mode).toBe('guest');
  });

  it('refreshes the current guest source into a non-persisting store without Web Locks', async () => {
    const f = fixture(false);
    add(f.guestStore);
    const currentGuest = f.values.get('kendo-menu');
    if (currentGuest === undefined) throw new Error('Expected a saved guest source');
    const lockless = createWorkspaceCoordinator({ locks: null, events: null });
    let prepared = false;
    let refreshedWithDurableWrites: boolean | undefined;
    const controller = createAccountWorkspaceController({
      guestStore: f.guestStore,
      storage: f.storage,
      api: f.api,
      coordination: lockless,
      database: f.database,
      guestCleanup: {
        readRaw: () => f.values.get('kendo-menu') ?? null,
        prepare: () => {
          prepared = true;
        },
        refreshFromRaw: (rawValue, { durableWrites }) => {
          refreshedWithDurableWrites = durableWrites;
          const refreshedStorage: StateStorage = {
            getItem: () => rawValue,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
          controller.replaceGuestStore(
            createTrainingStore({ storage: refreshedStorage, storageKey: 'kendo-menu' }),
          );
        },
      },
    });

    expect(await controller.refreshGuestWorkspace()).toBe(true);
    expect(prepared).toBe(false);
    expect(refreshedWithDurableWrites).toBe(false);
    const snapshot = controller.getSnapshot();
    expect(snapshot.mode).toBe('guest');
    if (snapshot.mode !== 'guest') throw new Error('Expected guest workspace');
    expect(snapshot.store.getState().dashboardEntries).toHaveLength(1);
    expect(f.values.get('kendo-menu')).toBe(currentGuest);
  });

  it('ignores old bootstrap responses and aborts on disposal', async () => {
    const f = fixture();
    const old = deferred<Response>();
    f.fetch.mockReturnValueOnce(old.promise).mockResolvedValueOnce(session(B));
    const first = f.controller.bootstrap();
    const signal = f.fetch.mock.calls[0]?.[1]?.signal;
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    expect(signal?.aborted).toBe(true);
    old.resolve(session(A));
    expect(await first).toEqual({ status: 'superseded' });
    expect(f.reads.some((key) => key.startsWith(deriveAccountStorageKey(A)))).toBe(false);
    const last = deferred<Response>();
    f.fetch.mockReturnValueOnce(last.promise);
    const pending = f.controller.bootstrap();
    await f.controller.dispose();
    last.resolve(session(A));
    expect(await pending).toEqual({ status: 'superseded' });
    expect(f.controller.getSnapshot().mode).toBe('disposed');
    expect(await f.controller.bootstrap()).toEqual({ status: 'disposed' });
  });

  it('successful logout preserves the cache, failed logout preserves the live account', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');
    add(active.store);
    f.fetch.mockRejectedValueOnce(new Error('indeterminate logout'));
    expect(await f.controller.logout()).toEqual({ status: 'retryable', reason: 'logout' });
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      serverRevocationConfirmed: false,
    });
    f.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await f.controller.logout()).toEqual({ status: 'signed-out' });
    expect(active.store.getState().dashboardEntries).toEqual([]);
    expect(f.database.caches.get(A)?.cacheValue).not.toBe(empty);
    expect(f.controller.getSnapshot().mode).toBe('guest');
  });

  it('does not let a same-account session check cancel an exit already in progress', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const exitResponse = deferred<Response>();
    f.fetch.mockReturnValueOnce(exitResponse.promise);
    const logout = f.controller.logout();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(2));

    const checkResponse = deferred<Response>();
    f.fetch.mockReturnValueOnce(checkResponse.promise);
    const check = f.controller.bootstrap();
    checkResponse.resolve(session(A));
    expect(await check).toEqual({ status: 'superseded' });
    exitResponse.resolve(new Response(null, { status: 204 }));
    expect(await logout).toEqual({ status: 'signed-out' });
    expect(f.controller.getSnapshot().mode).toBe('guest');
  });

  it('keeps a later local hide ahead of a B check started during logout', async () => {
    const f = fixture();
    add(f.guestStore);
    const guestValue = f.values.get('kendo-menu');
    await f.controller.bootstrap();

    const logoutResponse = deferred<Response>();
    f.fetch.mockReturnValueOnce(logoutResponse.promise);
    const logout = f.controller.logout();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(2));

    const sessionResponse = deferred<Response>();
    f.fetch.mockReturnValueOnce(sessionResponse.promise);
    const bootstrap = f.controller.bootstrap();
    const hide = f.controller.hideLocally();
    expect(await hide).toEqual({ status: 'hidden', serverRevocationConfirmed: false });

    sessionResponse.resolve(session(B));
    expect(await bootstrap).toEqual({ status: 'superseded' });
    logoutResponse.resolve(new Response(null, { status: 204 }));
    expect(await logout).toEqual({ status: 'superseded' });
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(f.values.get('kendo-menu')).toBe(guestValue);
  });

  it('does not let a same-account session check undo local hide', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const checkResponse = deferred<Response>();
    f.fetch.mockReturnValueOnce(checkResponse.promise);
    const check = f.controller.bootstrap();
    const hide = f.controller.hideLocally();
    checkResponse.resolve(session(A));
    expect(await check).toEqual({ status: 'superseded' });
    expect(await hide).toEqual({ status: 'hidden', serverRevocationConfirmed: false });
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not let a same-account GET supersede hide when hide starts first', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');
    const writeGate = deferred<void>();
    f.database.onWrite = () => writeGate.promise;
    add(active.store);
    const hide = f.controller.hideLocally();
    const checkResponse = deferred<Response>();
    f.fetch.mockReturnValueOnce(checkResponse.promise);
    const check = f.controller.bootstrap();
    checkResponse.resolve(session(A));
    expect(await check).toEqual({ status: 'superseded' });
    writeGate.resolve();
    expect(await hide).toEqual({ status: 'hidden', serverRevocationConfirmed: false });
    expect(f.controller.getSnapshot().mode).toBe('guest');
    f.database.onWrite = undefined;
  });

  it('does not activate a background account result that arrives after local hide completes', async () => {
    const f = fixture();
    add(f.guestStore);
    const guestValue = f.values.get('kendo-menu');
    await f.controller.bootstrap();
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');

    const writeGate = deferred<void>();
    f.database.onWrite = () => writeGate.promise;
    add(active.store);
    const hide = f.controller.hideLocally();
    const sessionResponse = deferred<Response>();
    f.fetch.mockReturnValueOnce(sessionResponse.promise);
    const bootstrap = f.controller.bootstrap();
    writeGate.resolve();
    expect(await hide).toEqual({ status: 'hidden', serverRevocationConfirmed: false });
    // Resolve the already-issued GET after hide. Its B result must not undo the exit.
    sessionResponse.resolve(session(B));
    expect(await bootstrap).toEqual({ status: 'superseded' });
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(f.values.get('kendo-menu')).toBe(guestValue);
    f.database.onWrite = undefined;
  });

  it('does not let a different-account GET supersede local hide while preservation is pending', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');

    const writeGate = deferred<void>();
    f.database.onWrite = () => writeGate.promise;
    add(active.store);
    const hide = f.controller.hideLocally();
    const sessionResponse = deferred<Response>();
    f.fetch.mockReturnValueOnce(sessionResponse.promise);
    const bootstrap = f.controller.bootstrap();
    sessionResponse.resolve(session(B));
    expect(await bootstrap).toEqual({ status: 'superseded' });
    writeGate.resolve();
    expect(await hide).toEqual({ status: 'hidden', serverRevocationConfirmed: false });
    expect(f.controller.getSnapshot().mode).toBe('guest');
    f.database.onWrite = undefined;
  });

  it('lets logout supersede a same-account bootstrap that started first', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const bootstrapResponse = deferred<Response>();
    f.fetch.mockReturnValueOnce(bootstrapResponse.promise);
    const bootstrap = f.controller.bootstrap();
    f.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const logout = f.controller.logout();
    bootstrapResponse.resolve(session(A));
    expect(await bootstrap).toEqual({ status: 'superseded' });
    expect(await logout).toEqual({ status: 'signed-out' });
    expect(f.controller.getSnapshot().mode).toBe('guest');
  });

  it('allows a session check to safely finish logout after an ambiguous lost 204', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');
    add(active.store);
    f.fetch.mockRejectedValueOnce(new Error('response lost after server commit'));
    expect(await f.controller.logout()).toEqual({ status: 'retryable', reason: 'logout' });
    expect(f.controller.getSnapshot().mode).toBe('account');

    f.fetch.mockResolvedValueOnce(signedOut());
    expect(await f.controller.bootstrap()).toEqual({ status: 'signed-out' });
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(active.store.getState().dashboardEntries).toEqual([]);
    expect(f.database.caches.get(A)?.cacheValue).not.toBe(empty);
    expect(f.values.get('kendo-menu')).toBeUndefined();
  });

  it('recovers an ambiguous logout when a stale cookie makes DELETE return UNAUTHENTICATED', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');
    add(active.store);
    f.fetch.mockRejectedValueOnce(new Error('response lost after server commit'));
    expect(await f.controller.logout()).toEqual({ status: 'retryable', reason: 'logout' });
    f.fetch.mockResolvedValueOnce(signedOut());
    expect(await f.controller.logout()).toEqual({ status: 'signed-out' });
    expect(f.fetch.mock.calls[2]?.[1]?.method).toBe('DELETE');
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(f.database.caches.get(A)?.cacheValue).not.toBe(empty);
    expect(active.store.getState().dashboardEntries).toEqual([]);
  });

  it('does not treat a 503 error body with UNAUTHENTICATED code as confirmed logout', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    f.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(await f.controller.logout()).toEqual({ status: 'retryable', reason: 'logout' });
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      serverRevocationConfirmed: false,
    });
  });

  it('uses authoritative session verification when a lost 204 already cleared the CSRF cookie', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');
    add(active.store);
    f.fetch.mockRejectedValueOnce(new Error('response lost after server commit'));
    expect(await f.controller.logout()).toEqual({ status: 'retryable', reason: 'logout' });

    f.setCsrfCookie('');
    f.fetch.mockResolvedValueOnce(signedOut());
    expect(await f.controller.logout()).toEqual({ status: 'signed-out' });
    expect(f.fetch).toHaveBeenCalledTimes(3);
    expect(f.fetch.mock.calls[1]?.[1]?.method).toBe('DELETE');
    expect(f.fetch.mock.calls[2]?.[1]?.method).toBe('GET');
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(f.database.caches.get(A)?.cacheValue).not.toBe(empty);
    expect(active.store.getState().dashboardEntries).toEqual([]);
  });

  it('a late 204 after aborted logout fetch cannot deactivate a newer account', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const response = deferred<Response>();
    f.fetch.mockReturnValueOnce(response.promise);
    const logout = f.controller.logout();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(2));
    const deleteSignal = f.fetch.mock.calls[1]?.[1]?.signal;
    f.fetch.mockResolvedValueOnce(session(B));
    await f.controller.bootstrap();
    expect(deleteSignal?.aborted).toBe(true);
    // The server can commit DELETE even though the client has already aborted its fetch.
    response.resolve(new Response(null, { status: 204 }));
    expect(await logout).toEqual({ status: 'superseded' });
    const current = f.controller.getSnapshot();
    expect(current.mode === 'account' && current.userId).toBe(B);
  });

  it('hides a revoked account but privately preserves edits if a write fails during logout', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const current = f.controller.getSnapshot();
    if (current.mode !== 'account') throw new Error('account missing');
    const response = deferred<Response>();
    f.fetch.mockReturnValueOnce(response.promise);
    const logout = f.controller.logout();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(2));
    f.database.onWrite = () => {
      throw new DOMException('quota fixture', 'QuotaExceededError');
    };
    add(current.store);
    response.resolve(new Response(null, { status: 204 }));
    expect(await logout).toEqual({
      status: 'retryable',
      reason: 'storage',
      serverRevocationConfirmed: true,
    });
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(current.store.getState().dashboardEntries).toEqual([]);
    f.database.onWrite = undefined;
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const restored = f.controller.getSnapshot();
    if (restored.mode !== 'account') throw new Error('account missing');
    expect(restored.store.getState().dashboardEntries).toHaveLength(1);
  });

  it('reports confirmed revocation when a local hide supersedes a successful logout save', async () => {
    const f = fixture();
    add(f.guestStore);
    const guestValue = f.values.get('kendo-menu');
    await f.controller.bootstrap();
    const account = f.controller.getSnapshot();
    if (account.mode !== 'account') throw new Error('account missing');

    const logoutResponse = deferred<Response>();
    f.fetch.mockReturnValueOnce(logoutResponse.promise);
    const logout = f.controller.logout();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(2));

    const writeGate = deferred<void>();
    let writeStarted = false;
    f.database.onWrite = async () => {
      writeStarted = true;
      await writeGate.promise;
    };
    add(account.store);
    await vi.waitFor(() => expect(writeStarted).toBe(true));
    logoutResponse.resolve(new Response(null, { status: 204 }));
    await vi.waitFor(() =>
      expect(f.controller.getSnapshot()).toMatchObject({
        mode: 'account',
        serverRevocationConfirmed: true,
      }),
    );

    const hide = f.controller.hideLocally();
    writeGate.resolve();
    expect(await hide).toEqual({ status: 'hidden', serverRevocationConfirmed: true });
    expect(await logout).toEqual({ status: 'superseded' });
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(account.store.getState().dashboardEntries).toEqual([]);
    expect(f.database.caches.get(A)?.cacheValue).not.toBe(empty);
    expect(f.values.get('kendo-menu')).toBe(guestValue);
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it('hides a revoked account when concurrent local hide and final preservation both fail', async () => {
    const f = fixture();
    add(f.guestStore);
    const guestValue = f.values.get('kendo-menu');
    await f.controller.bootstrap();
    const account = f.controller.getSnapshot();
    if (account.mode !== 'account') throw new Error('account missing');
    const logoutResponse = deferred<Response>();
    f.fetch.mockReturnValueOnce(logoutResponse.promise);
    const logout = f.controller.logout();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(2));

    const finalWrite = deferred<void>();
    let finalWriteStarted = false;
    f.database.onWrite = async () => {
      finalWriteStarted = true;
      await finalWrite.promise;
      throw new DOMException('quota fixture', 'QuotaExceededError');
    };
    add(account.store);
    await vi.waitFor(() => expect(finalWriteStarted).toBe(true));
    logoutResponse.resolve(new Response(null, { status: 204 }));
    await vi.waitFor(() =>
      expect(f.controller.getSnapshot()).toMatchObject({
        mode: 'account',
        serverRevocationConfirmed: true,
      }),
    );

    const hide = f.controller.hideLocally();
    finalWrite.resolve();
    expect(await hide).toEqual({
      status: 'retryable',
      reason: 'storage',
      serverRevocationConfirmed: true,
    });
    expect(await logout).toEqual({ status: 'superseded' });
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(account.store.getState().dashboardEntries).toEqual([]);
    expect(f.database.caches.get(A)?.cacheValue).toBe(empty);
    expect(f.values.get('kendo-menu')).toBe(guestValue);
    expect(f.guestStore.getState().dashboardEntries).toHaveLength(1);

    f.database.onWrite = undefined;
    f.fetch.mockResolvedValueOnce(session(B));
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const newer = f.controller.getSnapshot();
    if (newer.mode !== 'account') throw new Error('newer account missing');
    expect(newer.userId).toBe(B);
    expect(newer.store.getState().dashboardEntries).toEqual([]);
    f.fetch.mockResolvedValueOnce(session(A));
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const restored = f.controller.getSnapshot();
    if (restored.mode !== 'account') throw new Error('restored account missing');
    expect(restored.userId).toBe(A);
    expect(restored.store.getState().dashboardEntries).toHaveLength(1);
    expect(f.values.get('kendo-menu')).toBe(guestValue);
  });

  it('hides a revoked account when a second logout supersedes hide before final preservation fails', async () => {
    const f = fixture();
    add(f.guestStore);
    const guestValue = f.values.get('kendo-menu');
    await f.controller.bootstrap();
    const account = f.controller.getSnapshot();
    if (account.mode !== 'account') throw new Error('account missing');
    const logoutResponse = deferred<Response>();
    f.fetch.mockReturnValueOnce(logoutResponse.promise);
    const firstLogout = f.controller.logout();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(2));

    const finalWrite = deferred<void>();
    let finalWriteStarted = false;
    f.database.onWrite = async () => {
      finalWriteStarted = true;
      await finalWrite.promise;
      throw new DOMException('quota fixture', 'QuotaExceededError');
    };
    add(account.store);
    await vi.waitFor(() => expect(finalWriteStarted).toBe(true));
    logoutResponse.resolve(new Response(null, { status: 204 }));
    await vi.waitFor(() =>
      expect(f.controller.getSnapshot()).toMatchObject({
        mode: 'account',
        serverRevocationConfirmed: true,
      }),
    );

    const hide = f.controller.hideLocally();
    const secondLogout = f.controller.logout();
    finalWrite.resolve();
    expect(await hide).toEqual({ status: 'superseded' });
    expect(await firstLogout).toEqual({ status: 'superseded' });
    expect(await secondLogout).toEqual({
      status: 'retryable',
      reason: 'storage',
      serverRevocationConfirmed: true,
    });
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(account.store.getState().dashboardEntries).toEqual([]);
    expect(f.database.caches.get(A)?.cacheValue).toBe(empty);
    expect(f.values.get('kendo-menu')).toBe(guestValue);
    expect(f.guestStore.getState().dashboardEntries).toHaveLength(1);

    f.database.onWrite = undefined;
    f.fetch.mockResolvedValueOnce(session(B));
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const newer = f.controller.getSnapshot();
    if (newer.mode !== 'account') throw new Error('newer account missing');
    expect(newer.userId).toBe(B);
    expect(newer.store.getState().dashboardEntries).toEqual([]);
    f.fetch.mockResolvedValueOnce(session(A));
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const restored = f.controller.getSnapshot();
    if (restored.mode !== 'account') throw new Error('restored account missing');
    expect(restored.userId).toBe(A);
    expect(restored.store.getState().dashboardEntries).toHaveLength(1);
    expect(f.values.get('kendo-menu')).toBe(guestValue);
  });

  it('does not send DELETE when the initial logout preservation fails', async () => {
    const f = fixture();
    add(f.guestStore);
    const guestValue = f.values.get('kendo-menu');
    await f.controller.bootstrap();
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');
    f.database.onWrite = () => {
      throw new DOMException('quota fixture', 'QuotaExceededError');
    };
    add(active.store);
    expect(await f.controller.logout()).toEqual({ status: 'retryable', reason: 'storage' });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot().mode).toBe('account');
    expect(f.values.get('kendo-menu')).toBe(guestValue);
    expect(f.guestStore.getState().dashboardEntries).toHaveLength(1);
    f.database.onWrite = undefined;
  });

  it('keeps unconfirmed overlapping hide and logout retryable after storage failure', async () => {
    const f = fixture();
    add(f.guestStore);
    const guestValue = f.values.get('kendo-menu');
    await f.controller.bootstrap();
    const account = f.controller.getSnapshot();
    if (account.mode !== 'account') throw new Error('account missing');
    const finalWrite = deferred<void>();
    let finalWriteStarted = false;
    f.database.onWrite = async () => {
      finalWriteStarted = true;
      await finalWrite.promise;
      throw new DOMException('quota fixture', 'QuotaExceededError');
    };
    add(account.store);
    await vi.waitFor(() => expect(finalWriteStarted).toBe(true));

    const hide = f.controller.hideLocally();
    const logout = f.controller.logout();
    finalWrite.resolve();
    expect(await hide).toEqual({ status: 'superseded' });
    expect(await logout).toEqual({ status: 'retryable', reason: 'storage' });
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      userId: A,
      serverRevocationConfirmed: false,
    });
    expect(account.store.getState().dashboardEntries).toHaveLength(1);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.values.get('kendo-menu')).toBe(guestValue);
    f.database.onWrite = undefined;
  });

  it('retains edits when persistence fails during cleared-cookie session recovery', async () => {
    const f = fixture();
    add(f.guestStore);
    const guestValue = f.values.get('kendo-menu');
    await f.controller.bootstrap();
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');
    f.setCsrfCookie('');
    const sessionResponse = deferred<Response>();
    f.fetch.mockReturnValueOnce(sessionResponse.promise);
    const logout = f.controller.logout();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(2));
    expect(f.fetch.mock.calls[1]?.[1]?.method).toBe('GET');
    f.database.onWrite = () => {
      throw new DOMException('quota fixture', 'QuotaExceededError');
    };
    add(active.store);
    sessionResponse.resolve(signedOut());
    expect(await logout).toEqual({
      status: 'retryable',
      reason: 'storage',
      serverRevocationConfirmed: true,
    });
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(f.controller.hasHiddenUnsavedAccountChanges()).toBe(true);
    expect(f.controller.listDisposalEditRecovery().items).toEqual([]);
    expect(f.controller.readDisposalEditRecovery('not-yet-verified')).toBeNull();
    expect(f.guestStore.getState().dashboardEntries).toHaveLength(1);
    expect(f.values.get('kendo-menu')).toBe(guestValue);
    expect(active.store.getState().dashboardEntries).toEqual([]);
    f.database.onWrite = undefined;
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const restored = f.controller.getSnapshot();
    if (restored.mode !== 'account') throw new Error('account missing');
    expect(restored.store.getState().dashboardEntries).toHaveLength(1);
    expect(f.controller.hasHiddenUnsavedAccountChanges()).toBe(false);
  });

  it('retains failed writes privately when authentication changes, restoring only after same-user verification', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const a = f.controller.getSnapshot();
    if (a.mode !== 'account') throw new Error('account missing');
    f.database.onWrite = () => {
      throw new DOMException('quota fixture', 'QuotaExceededError');
    };
    add(a.store);
    const observedHiddenState: boolean[] = [];
    const unsubscribe = f.controller.subscribe(() => {
      observedHiddenState.push(f.controller.hasHiddenUnsavedAccountChanges());
    });
    f.fetch.mockResolvedValueOnce(session(B));
    expect(await f.controller.bootstrap()).toEqual({ status: 'retryable', reason: 'storage' });
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(f.controller.hasHiddenUnsavedAccountChanges()).toBe(true);
    expect(observedHiddenState.at(-1)).toBe(true);
    expect(a.store.getState().dashboardEntries).toEqual([]);
    expect(f.reads.some((key) => key.startsWith(deriveAccountStorageKey(B)))).toBe(false);
    f.database.onWrite = undefined;
    f.fetch.mockResolvedValueOnce(session(B));
    await f.controller.bootstrap();
    const b = f.controller.getSnapshot();
    if (b.mode !== 'account') throw new Error('account missing');
    expect(b.store.getState().dashboardEntries).toEqual([]);
    f.fetch.mockResolvedValueOnce(session(A));
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const restored = f.controller.getSnapshot();
    if (restored.mode !== 'account') throw new Error('account missing');
    expect(restored.store.getState().dashboardEntries).toHaveLength(1);
    expect(f.controller.hasHiddenUnsavedAccountChanges()).toBe(false);
    unsubscribe();
  });

  it('keeps a content-free hidden-edit signal after signed-out verification until same-account recovery is durable', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const account = f.controller.getSnapshot();
    if (account.mode !== 'account') throw new Error('account missing');

    f.database.onWrite = () => {
      throw new DOMException('quota fixture', 'QuotaExceededError');
    };
    add(account.store);
    await expect(f.controller.flushPersistence()).rejects.toMatchObject({ code: 'quota' });
    expect(f.controller.hasHiddenUnsavedAccountChanges()).toBe(false);

    f.fetch.mockResolvedValueOnce(signedOut());
    expect(await f.controller.bootstrap()).toEqual({ status: 'retryable', reason: 'storage' });
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(f.controller.hasHiddenUnsavedAccountChanges()).toBe(true);
    expect(f.controller.listDisposalEditRecovery().items).toEqual([]);
    expect(f.controller.readDisposalEditRecovery('unverified-copy')).toBeNull();

    f.database.onWrite = undefined;
    f.fetch.mockResolvedValueOnce(session(A));
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const restored = f.controller.getSnapshot();
    if (restored.mode !== 'account') throw new Error('account missing');
    expect(restored.store.getState().dashboardEntries).toHaveLength(1);
    expect(f.controller.hasHiddenUnsavedAccountChanges()).toBe(false);
    expect(f.controller.listDisposalEditRecovery().items).toEqual([]);
  });

  it('retains a failed edit when a peer advances and restores identical cache bytes', async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(session(D));
    await expect(f.controller.bootstrap()).resolves.toMatchObject({ status: 'ready' });
    const account = f.controller.getSnapshot();
    if (account.mode !== 'account') throw new Error('account missing');

    f.database.onWrite = () => Promise.reject(new Error('quota exceeded'));
    add(account.store);
    await expect(f.controller.flushPersistence()).rejects.toMatchObject({ code: 'unavailable' });
    f.fetch.mockResolvedValueOnce(signedOut());
    await expect(f.controller.bootstrap()).resolves.toMatchObject({
      status: 'retryable',
      reason: 'storage',
    });
    expect(f.controller.listDisposalEditRecovery().items).toEqual([]);

    const oldCache = f.database.caches.get(D);
    if (oldCache === undefined) throw new Error('Expected the original account cache');
    const newerCache = {
      ...oldCache,
      generation: oldCache.generation + 2,
      cacheValue: oldCache.cacheValue,
    };
    f.database.caches.set(D, newerCache);
    f.database.onWrite = undefined;
    f.fetch.mockResolvedValueOnce(session(D));
    await expect(f.controller.bootstrap()).resolves.toMatchObject({
      status: 'retryable',
      reason: 'storage',
    });
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account-error',
      userId: D,
      storageFailure: 'malformed-readback',
    });

    const recovery = f.controller.listDisposalEditRecovery();
    expect(recovery.items).toHaveLength(1);
    const copy = recovery.items[0];
    if (copy === undefined) throw new Error('Expected the retained controller edit');
    const rawCopy = f.controller.readDisposalEditRecovery(copy.recoveryId);
    expect(rawCopy).toContain('international-dojo-2-hour-session');
    expect(f.database.caches.get(D)).toEqual(newerCache);

    const readStarted = deferred<void>();
    const releaseRead = deferred<void>();
    f.database.onRead = () => {
      readStarted.resolve();
      return releaseRead.promise;
    };
    f.fetch.mockResolvedValueOnce(session(B));
    const switching = f.controller.bootstrap();
    await readStarted.promise;
    expect(f.controller.getSnapshot().mode).not.toBe('account-error');
    expect(f.controller.listDisposalEditRecovery().items).toEqual([]);
    expect(f.controller.readDisposalEditRecovery(copy.recoveryId)).toBeNull();
    releaseRead.resolve();
    expect(await switching).toEqual({ status: 'ready' });
  });

  it('does not flag a hidden account after signed-out verification when its latest value is durable', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const account = f.controller.getSnapshot();
    if (account.mode !== 'account') throw new Error('account missing');
    add(account.store);
    await f.controller.flushPersistence();

    f.fetch.mockResolvedValueOnce(signedOut());
    expect(await f.controller.bootstrap()).toEqual({ status: 'signed-out' });
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(f.controller.hasHiddenUnsavedAccountChanges()).toBe(false);
    await f.controller.dispose();
  });

  it('waits for an outstanding account write before switching', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const a = f.controller.getSnapshot();
    if (a.mode !== 'account') throw new Error('account missing');
    const gate = deferred<void>();
    f.database.onWrite = () => gate.promise;
    add(a.store);
    f.fetch.mockResolvedValueOnce(session(B));
    const switching = f.controller.bootstrap();
    await Promise.resolve();
    expect(f.reads.some((key) => key.startsWith(deriveAccountStorageKey(B)))).toBe(false);
    gate.resolve();
    expect(await switching).toEqual({ status: 'ready' });
    expect(f.database.caches.get(A)?.cacheValue).not.toBe(empty);
  });

  it('disposes pending hydration without activating or writing a late cache', async () => {
    const f = fixture();
    const gate = deferred<string | null>();
    const get = f.storage.getItem;
    let readingCache = false;
    f.storage.getItem = (key) => {
      if (key !== deriveAccountStorageKey(A)) return get(key);
      readingCache = true;
      return gate.promise;
    };
    const bootstrap = f.controller.bootstrap();
    await vi.waitFor(() => expect(readingCache).toBe(true));
    await f.controller.dispose();
    gate.resolve(empty);
    expect(await bootstrap).toEqual({ status: 'superseded' });
    expect(f.values.has(deriveAccountStorageKey(A))).toBe(false);
  });

  it('keeps the account writer enabled until an in-flight save is durable during disposal', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const account = f.controller.getSnapshot();
    if (account.mode !== 'account') throw new Error('Expected account workspace');

    const gate = deferred<void>();
    f.database.onWrite = () => gate.promise;
    add(account.store);
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      persistencePending: true,
    });

    const disposing = f.controller.dispose();
    expect(f.controller.getSnapshot().mode).toBe('disposed');
    gate.resolve();
    await disposing;

    await vi.waitFor(() => {
      const cache = f.database.caches.get(A)?.cacheValue;
      expect(cache).toBeDefined();
      expect(cache).not.toBe(empty);
      expect(cache).toContain('"id"');
    });
    expect(account.store.getState().dashboardEntries).toEqual([]);
  });

  it('restores a failed save across provider disposal only for the same verified cache', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const account = f.controller.getSnapshot();
    if (account.mode !== 'account') throw new Error('Expected account workspace');

    f.database.onWrite = () => Promise.reject(new Error('quota exceeded'));
    add(account.store);
    await expect(f.controller.flushPersistence()).rejects.toMatchObject({ code: 'unavailable' });
    await f.controller.dispose();

    f.database.onWrite = undefined;
    f.fetch.mockResolvedValueOnce(session(B));
    const remountedController = createAccountWorkspaceController({
      guestStore: f.guestStore,
      storage: f.storage,
      api: f.api,
      coordination: f.coordination,
      database: f.database,
    });
    expect(await remountedController.bootstrap()).toEqual({ status: 'ready' });
    const otherAccount = remountedController.getSnapshot();
    if (otherAccount.mode !== 'account') throw new Error('Expected verified account workspace');
    expect(otherAccount.userId).toBe(B);
    expect(otherAccount.store.getState().dashboardEntries).toHaveLength(0);

    f.fetch.mockResolvedValueOnce(session(A));
    expect(await remountedController.bootstrap()).toEqual({ status: 'ready' });
    const restored = remountedController.getSnapshot();
    if (restored.mode !== 'account') throw new Error('Expected restored account workspace');
    expect(restored.userId).toBe(A);
    expect(restored.store.getState().dashboardEntries).toHaveLength(1);
    await remountedController.flushPersistence();
    await remountedController.dispose();
  });

  it('keeps disposal-retained edits gated when the confirmed account cache changed', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const account = f.controller.getSnapshot();
    if (account.mode !== 'account') throw new Error('Expected account workspace');

    f.database.onWrite = () => Promise.reject(new Error('quota exceeded'));
    add(account.store);
    await expect(f.controller.flushPersistence()).rejects.toMatchObject({ code: 'unavailable' });
    await f.controller.dispose();

    const baseline = f.database.caches.get(A);
    if (baseline === undefined) throw new Error('Expected baseline account cache');
    f.database.caches.set(A, {
      ...baseline,
      identity: 'changed-by-peer',
      generation: baseline.generation + 1,
      cacheValue: `${baseline.cacheValue} `,
    });
    f.database.onWrite = undefined;

    const remountedController = createAccountWorkspaceController({
      guestStore: f.guestStore,
      storage: f.storage,
      api: f.api,
      coordination: f.coordination,
      database: f.database,
    });
    expect(await remountedController.bootstrap()).toEqual({
      status: 'retryable',
      reason: 'storage',
    });
    expect(remountedController.getSnapshot()).toMatchObject({
      mode: 'account-error',
      userId: A,
      storageFailure: 'malformed-readback',
    });

    f.database.caches.set(A, baseline);
    expect(await remountedController.bootstrap()).toEqual({ status: 'ready' });
    const restored = remountedController.getSnapshot();
    if (restored.mode !== 'account') throw new Error('Expected restored account workspace');
    expect(restored.store.getState().dashboardEntries).toHaveLength(1);
    await remountedController.dispose();
  });

  it('does not perform any automatic dashboard read, cloud write or adoption', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');
    add(active.store);
    await f.controller.hideLocally();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.fetch.mock.calls[0]?.[0]).toBe('/api/session');
    expect(f.fetch.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('retains guest and local account functionality without claiming synchronization without locks', async () => {
    const f = fixture(false);
    add(f.guestStore);
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');
    expect(active.synchronization).toBe('unavailable');
    add(active.store);
    expect(await f.controller.hideLocally()).toMatchObject({ status: 'hidden' });
    expect(f.guestStore.getState().dashboardEntries).toHaveLength(1);
  });

  it('storage notifications cannot authenticate, select accounts, or affect a deactivated account', async () => {
    const f = fixture();
    f.notify(deriveAccountStorageKey(A), empty);
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(f.fetch).not.toHaveBeenCalled();
    await f.controller.bootstrap();
    f.notify(deriveAccountStorageKey(A), empty);
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      userId: A,
      storageChanged: true,
    });
    f.fetch.mockResolvedValueOnce(session(B));
    await f.controller.bootstrap();
    f.notify(deriveAccountStorageKey(A), empty);
    f.notify(deriveAccountStorageKey(B), '{malformed');
    expect(f.controller.getSnapshot()).toMatchObject({
      mode: 'account',
      userId: B,
      storageChanged: false,
    });
    await f.controller.hideLocally();
    f.notify(deriveAccountStorageKey(B), empty);
    expect(f.controller.getSnapshot().mode).toBe('guest');
  });

  it('retains a divergent stale legacy write after an active storage event', async () => {
    const f = fixture();
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');
    add(active.store);
    await vi.waitFor(() => expect(f.database.caches.get(A)?.cacheValue).not.toBe(empty));
    const idbValue = f.database.caches.get(A)?.cacheValue;
    const key = deriveAccountStorageKey(A);
    f.values.set(key, empty);
    f.notify(key, empty);
    await vi.waitFor(() => expect(f.database.recovery).toHaveLength(1));
    expect(f.database.recovery[0]?.rawValue).toBe(empty);
    expect(f.database.caches.get(A)?.cacheValue).toBe(idbValue);
    expect(f.values.get(key)).toBe(empty);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it('retains an event value written during cleanup even after its key disappears', async () => {
    const f = fixture();
    add(f.guestStore);
    const newerLegacy = f.values.get('kendo-menu');
    if (newerLegacy === undefined) throw new Error('guest fixture missing');
    const key = deriveAccountStorageKey(A);
    f.values.set(key, empty);
    const remove = f.storage.removeItem;
    f.storage.removeItem = (name) => {
      if (name === key) {
        f.values.set(key, newerLegacy);
        f.notify(key, newerLegacy);
      }
      return remove(name);
    };
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    expect(f.values.has(key)).toBe(false);
    expect(f.database.caches.get(A)?.cacheValue).toBe(empty);
    expect(f.database.recovery[0]?.rawValue).toBe(newerLegacy);
    expect(f.controller.getSnapshot()).toMatchObject({ mode: 'account', storageChanged: true });
  });

  it('retains each validated preparation event despite a later removal event', async () => {
    const f = fixture();
    add(f.guestStore);
    const first = f.values.get('kendo-menu');
    add(f.guestStore);
    const second = f.values.get('kendo-menu');
    if (first === undefined || second === undefined) throw new Error('guest fixture missing');
    const key = deriveAccountStorageKey(A);
    f.values.set(key, empty);
    const remove = f.storage.removeItem;
    f.storage.removeItem = (name) => {
      if (name === key) {
        f.notify(key, first);
        f.notify(key, second);
      }
      const result = remove(name);
      if (name === key) f.notify(key, null);
      return result;
    };
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    expect(f.database.recovery.map(({ rawValue }) => rawValue)).toEqual([first, second]);
    expect(f.values.has(key)).toBe(false);
  });

  it('finds a divergent legacy write on the next verified activation without an event', async () => {
    const f = fixture();
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');
    add(active.store);
    expect(await f.controller.hideLocally()).toMatchObject({ status: 'hidden' });
    const idbValue = f.database.caches.get(A)?.cacheValue;
    f.values.set(deriveAccountStorageKey(A), empty);
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    expect(f.database.recovery[0]?.rawValue).toBe(empty);
    expect(f.database.caches.get(A)?.cacheValue).toBe(idbValue);
    expect(f.values.get(deriveAccountStorageKey(A))).toBe(empty);
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed recovery copy visible and leaves the legacy source intact', async () => {
    const f = fixture();
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');
    add(active.store);
    await vi.waitFor(() => expect(f.database.caches.get(A)?.cacheValue).not.toBe(empty));
    const key = deriveAccountStorageKey(A);
    f.database.onWrite = () => {
      throw new DOMException('quota fixture', 'QuotaExceededError');
    };
    f.values.set(key, empty);
    f.notify(key, empty);
    await vi.waitFor(() =>
      expect(f.controller.getSnapshot()).toMatchObject({
        mode: 'account',
        recoveryFailure: 'quota',
      }),
    );
    expect(f.values.get(key)).toBe(empty);
    expect(f.database.recovery).toHaveLength(0);
    f.database.onWrite = undefined;
    add(active.store);
    expect(await f.controller.hideLocally()).toMatchObject({ status: 'hidden' });
  });

  it('local hide cancels a pending cold bootstrap and requires a new verification', async () => {
    const f = fixture();
    const response = deferred<Response>();
    f.fetch.mockReturnValueOnce(response.promise);
    const bootstrap = f.controller.bootstrap();
    expect(await f.controller.hideLocally()).toEqual({
      status: 'hidden',
      serverRevocationConfirmed: false,
    });
    response.resolve(session(A));
    expect(await bootstrap).toEqual({ status: 'superseded' });
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(f.reads.every((key) => key === 'kendo-menu')).toBe(true);
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it('retains and exposes both divergent copies when same-account disposals settle out of order', async () => {
    const f = fixture();
    f.fetch.mockImplementation(() => Promise.resolve(session(C)));
    await f.controller.bootstrap();
    const first = f.controller.getSnapshot();
    if (first.mode !== 'account') throw new Error('first controller did not open account');

    const secondController = createAccountWorkspaceController({
      guestStore: f.guestStore,
      storage: f.storage,
      api: f.api,
      coordination: f.coordination,
      database: f.database,
    });
    await secondController.bootstrap();
    const second = secondController.getSnapshot();
    if (second.mode !== 'account') throw new Error('second controller did not open account');

    const firstTraining = DEFAULT_TRAINING_SETS[0];
    const secondTraining = DEFAULT_TRAINING_SETS[1];
    if (firstTraining === undefined || secondTraining === undefined)
      throw new Error('fixture requires two training sets');

    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    let writeIndex = 0;
    f.database.onWrite = () => {
      const write = [firstWrite, secondWrite][writeIndex];
      writeIndex += 1;
      if (write === undefined) throw new Error('unexpected extra write');
      return write.promise;
    };
    first.store.getState().addToDashboard(firstTraining.id);
    second.store.getState().addToDashboard(secondTraining.id);
    await vi.waitFor(() => expect(writeIndex).toBe(2));

    const firstFlush = f.controller.flushPersistence();
    const secondFlush = secondController.flushPersistence();
    const firstDispose = f.controller.dispose();
    const secondDispose = secondController.dispose();

    secondWrite.reject(new Error('second controller quota failure'));
    await expect(secondFlush).rejects.toMatchObject({ code: 'unavailable' });
    await secondDispose;
    firstWrite.reject(new Error('first controller quota failure'));
    await expect(firstFlush).rejects.toMatchObject({ code: 'unavailable' });
    await firstDispose;

    f.database.onWrite = undefined;
    const remountedController = createAccountWorkspaceController({
      guestStore: f.guestStore,
      storage: f.storage,
      api: f.api,
      coordination: f.coordination,
      database: f.database,
    });
    expect(await remountedController.bootstrap()).toEqual({
      status: 'retryable',
      reason: 'storage',
    });
    expect(remountedController.getSnapshot()).toMatchObject({
      mode: 'account-error',
      userId: C,
      storageFailure: 'malformed-readback',
    });

    const recovery = remountedController.listDisposalEditRecovery();
    expect(recovery.items).toHaveLength(2);
    expect(recovery.nextCursor).toBeNull();
    const firstCopy = recovery.items[0];
    const secondCopy = recovery.items[1];
    if (firstCopy === undefined || secondCopy === undefined)
      throw new Error('both retained copies should be listed');
    expect(firstCopy.recoveryId).not.toBe(secondCopy.recoveryId);
    expect(firstCopy.characterLength).toBeGreaterThan(0);
    expect(firstCopy.menuCount).toBe(1);
    const firstEnvelope = remountedController.readDisposalEditRecovery(firstCopy.recoveryId);
    const secondEnvelope = remountedController.readDisposalEditRecovery(secondCopy.recoveryId);
    expect(firstEnvelope).not.toBe(secondEnvelope);
    const envelopes = [firstEnvelope, secondEnvelope];
    expect(envelopes.some((value) => value?.includes(firstTraining.id))).toBe(true);
    expect(envelopes.some((value) => value?.includes(secondTraining.id))).toBe(true);

    expect(await remountedController.hideLocally()).toMatchObject({ status: 'hidden' });
    expect(remountedController.listDisposalEditRecovery().items).toHaveLength(0);
    expect(remountedController.readDisposalEditRecovery(firstCopy.recoveryId)).toBeNull();
    await remountedController.dispose();
  });

  it('keeps a recovery ID and cursor valid when a later disposal adds another copy', async () => {
    const f = fixture();
    f.fetch.mockImplementation(() => Promise.resolve(session(D)));
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const first = f.controller.getSnapshot();
    if (first.mode !== 'account') throw new Error('Expected first account workspace');

    f.database.onWrite = () => Promise.reject(new Error('first cache write failed'));
    add(first.store);
    await expect(f.controller.flushPersistence()).rejects.toMatchObject({ code: 'unavailable' });
    f.fetch.mockResolvedValueOnce(signedOut());
    expect(await f.controller.bootstrap()).toEqual({ status: 'retryable', reason: 'storage' });
    const baseline = f.database.caches.get(D);
    if (baseline === undefined) throw new Error('Expected the confirmed cache');
    f.database.caches.set(D, {
      ...baseline,
      generation: baseline.generation + 1,
      cacheValue: `${baseline.cacheValue} `,
    });
    f.database.onWrite = undefined;
    expect(await f.controller.bootstrap()).toEqual({ status: 'retryable', reason: 'storage' });
    const original = f.controller.listDisposalEditRecovery().items[0];
    if (original === undefined) throw new Error('Expected the controller-held recovery copy');

    const later = createAccountWorkspaceController({
      guestStore: f.guestStore,
      storage: f.storage,
      api: f.api,
      coordination: f.coordination,
      database: f.database,
    });
    expect(await later.bootstrap()).toEqual({ status: 'ready' });
    const second = later.getSnapshot();
    if (second.mode !== 'account') throw new Error('Expected second account workspace');
    const anotherTraining = DEFAULT_TRAINING_SETS[1];
    if (anotherTraining === undefined) throw new Error('Expected another training set');
    f.database.onWrite = () => Promise.reject(new Error('second cache write failed'));
    second.store.getState().addToDashboard(anotherTraining.id);
    await expect(later.flushPersistence()).rejects.toMatchObject({ code: 'unavailable' });
    await later.dispose();

    const recovery = f.controller.listDisposalEditRecovery();
    expect(recovery.items.map((copy) => copy.recoveryId)).toContain(original.recoveryId);
    const appended = f.controller.listDisposalEditRecovery(original.recoveryId).items;
    expect(appended).toHaveLength(1);
    expect(appended[0]?.recoveryId).not.toBe(original.recoveryId);
    expect(f.controller.readDisposalEditRecovery(original.recoveryId)).toContain(
      'international-dojo-2-hour-session',
    );
    expect(f.controller.readDisposalEditRecovery(appended[0]?.recoveryId ?? '')).toContain(
      anotherTraining.id,
    );
  });

  it('keeps an exposed recovery ID when a later disposal holds the same edit', async () => {
    const f = fixture();
    f.fetch.mockImplementation(() => Promise.resolve(session(E)));
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const first = f.controller.getSnapshot();
    if (first.mode !== 'account') throw new Error('Expected first account workspace');
    f.database.onWrite = () => Promise.reject(new Error('first cache write failed'));
    add(first.store);
    const originalEntries = first.store.getState().dashboardEntries;
    await expect(f.controller.flushPersistence()).rejects.toMatchObject({ code: 'unavailable' });
    f.fetch.mockResolvedValueOnce(signedOut());
    expect(await f.controller.bootstrap()).toEqual({ status: 'retryable', reason: 'storage' });
    expect(await f.controller.bootstrap()).toEqual({ status: 'retryable', reason: 'storage' });
    const original = f.controller.listDisposalEditRecovery().items[0];
    if (original === undefined) throw new Error('Expected a verified recovery copy');

    f.database.onWrite = undefined;
    const later = createAccountWorkspaceController({
      guestStore: f.guestStore,
      storage: f.storage,
      api: f.api,
      coordination: f.coordination,
      database: f.database,
    });
    expect(await later.bootstrap()).toEqual({ status: 'ready' });
    const second = later.getSnapshot();
    if (second.mode !== 'account') throw new Error('Expected second account workspace');
    f.database.onWrite = () => Promise.reject(new Error('duplicate cache write failed'));
    second.store.setState({ dashboardEntries: originalEntries });
    await expect(later.flushPersistence()).rejects.toMatchObject({ code: 'unavailable' });
    await later.dispose();

    expect(f.controller.listDisposalEditRecovery().items.map((copy) => copy.recoveryId)).toEqual([
      original.recoveryId,
    ]);
    expect(f.controller.readDisposalEditRecovery(original.recoveryId)).toContain(
      'international-dojo-2-hour-session',
    );
  });
});
