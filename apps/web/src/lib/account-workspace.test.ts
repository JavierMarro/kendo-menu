import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';
import { createTrainingStore, type StateStorage, type TrainingStoreApi } from '@kendo-menu/store';
import { describe, expect, it, vi } from 'vitest';

import { createAccountApiClient } from './account-api';
import { deriveAccountStorageKey } from './account-storage';
import { createAccountWorkspaceController } from './account-workspace';
import {
  createWorkspaceCoordinator,
  type WorkspaceLockProvider,
  type WorkspaceStorageEvent,
} from './workspace-coordination';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
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

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('uninitialized');
  };
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function fixture(withCoordination = true, guestRaw?: string) {
  const values = new Map<string, string>();
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
  const controller = createAccountWorkspaceController({ guestStore, storage, api, coordination });
  return {
    values,
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

function add(store: TrainingStoreApi) {
  const training = DEFAULT_TRAINING_SETS[0];
  if (training === undefined) throw new Error('fixture missing');
  return store.getState().addToDashboard(training.id);
}

describe('internal account bootstrap and isolation', () => {
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
    controller.dispose();
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
    const retained = f.values.get(deriveAccountStorageKey(A));
    add(initial.store);
    await Promise.resolve();
    expect(f.values.get(deriveAccountStorageKey(A))).toBe(retained);
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
    const retained = f.values.get(deriveAccountStorageKey(A));
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
    expect(f.values.get(deriveAccountStorageKey(A))).toBe(retained);
    expect(f.values.get(deriveAccountStorageKey(B))).toBe(empty);
  });

  it('preserves malformed metadata/cache and never hydrates them', async () => {
    for (const [suffix, raw] of [
      [':sync', '{"version":1}'],
      ['', '{broken'],
      [':sync', '{"version":999,"accountId":"' + A + '"}'],
    ]) {
      const f = fixture();
      const key = deriveAccountStorageKey(A) + suffix;
      if (raw === undefined) throw new Error('fixture missing');
      f.values.set(key, raw);
      expect(await f.controller.bootstrap()).toEqual({ status: 'retryable', reason: 'storage' });
      expect(f.controller.getSnapshot().mode).toBe('guest');
      expect(f.values.get(key)).toBe(raw);
    }
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
    f.controller.dispose();
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
    expect(f.values.get(deriveAccountStorageKey(A))).not.toBe(empty);
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
    const write = f.storage.setItem;
    f.storage.setItem = async (key, raw) => {
      await writeGate.promise;
      await write(key, raw);
    };
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
    f.storage.setItem = write;
  });

  it('does not activate a background account result that arrives after local hide completes', async () => {
    const f = fixture();
    add(f.guestStore);
    const guestValue = f.values.get('kendo-menu');
    await f.controller.bootstrap();
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');

    const writeGate = deferred<void>();
    const write = f.storage.setItem;
    f.storage.setItem = async (key, raw) => {
      await writeGate.promise;
      await write(key, raw);
    };
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
    f.storage.setItem = write;
  });

  it('does not let a different-account GET supersede local hide while preservation is pending', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');

    const writeGate = deferred<void>();
    const write = f.storage.setItem;
    f.storage.setItem = async (key, raw) => {
      await writeGate.promise;
      await write(key, raw);
    };
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
    f.storage.setItem = write;
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
    expect(f.values.get(deriveAccountStorageKey(A))).not.toBe(empty);
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
    expect(f.values.get(deriveAccountStorageKey(A))).not.toBe(empty);
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
    expect(f.values.get(deriveAccountStorageKey(A))).not.toBe(empty);
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
    const write = f.storage.setItem;
    f.storage.setItem = () => {
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
    f.storage.setItem = write;
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const restored = f.controller.getSnapshot();
    if (restored.mode !== 'account') throw new Error('account missing');
    expect(restored.store.getState().dashboardEntries).toHaveLength(1);
  });

  it('does not send DELETE when the initial logout preservation fails', async () => {
    const f = fixture();
    add(f.guestStore);
    const guestValue = f.values.get('kendo-menu');
    await f.controller.bootstrap();
    const active = f.controller.getSnapshot();
    if (active.mode !== 'account') throw new Error('account missing');
    const write = f.storage.setItem;
    f.storage.setItem = () => {
      throw new DOMException('quota fixture', 'QuotaExceededError');
    };
    add(active.store);
    expect(await f.controller.logout()).toEqual({ status: 'retryable', reason: 'storage' });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot().mode).toBe('account');
    expect(f.values.get('kendo-menu')).toBe(guestValue);
    expect(f.guestStore.getState().dashboardEntries).toHaveLength(1);
    f.storage.setItem = write;
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
    const write = f.storage.setItem;
    f.storage.setItem = () => {
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
    expect(f.guestStore.getState().dashboardEntries).toHaveLength(1);
    expect(f.values.get('kendo-menu')).toBe(guestValue);
    expect(active.store.getState().dashboardEntries).toEqual([]);
    f.storage.setItem = write;
    expect(await f.controller.bootstrap()).toEqual({ status: 'ready' });
    const restored = f.controller.getSnapshot();
    if (restored.mode !== 'account') throw new Error('account missing');
    expect(restored.store.getState().dashboardEntries).toHaveLength(1);
  });

  it('retains failed writes privately when authentication changes, restoring only after same-user verification', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const a = f.controller.getSnapshot();
    if (a.mode !== 'account') throw new Error('account missing');
    const write = f.storage.setItem;
    f.storage.setItem = () => {
      throw new DOMException('quota fixture', 'QuotaExceededError');
    };
    add(a.store);
    f.fetch.mockResolvedValueOnce(session(B));
    expect(await f.controller.bootstrap()).toEqual({ status: 'retryable', reason: 'storage' });
    expect(f.controller.getSnapshot().mode).toBe('guest');
    expect(a.store.getState().dashboardEntries).toEqual([]);
    expect(f.reads.some((key) => key.startsWith(deriveAccountStorageKey(B)))).toBe(false);
    f.storage.setItem = write;
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
  });

  it('waits for an outstanding account write before switching', async () => {
    const f = fixture();
    await f.controller.bootstrap();
    const a = f.controller.getSnapshot();
    if (a.mode !== 'account') throw new Error('account missing');
    const gate = deferred<void>();
    const write = f.storage.setItem;
    f.storage.setItem = async (key, raw) => {
      await gate.promise;
      await write(key, raw);
    };
    add(a.store);
    f.fetch.mockResolvedValueOnce(session(B));
    const switching = f.controller.bootstrap();
    await Promise.resolve();
    expect(f.reads.some((key) => key.startsWith(deriveAccountStorageKey(B)))).toBe(false);
    gate.resolve();
    expect(await switching).toEqual({ status: 'ready' });
    expect(f.values.get(deriveAccountStorageKey(A))).not.toBe(empty);
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
    f.controller.dispose();
    gate.resolve(empty);
    expect(await bootstrap).toEqual({ status: 'superseded' });
    expect(f.values.has(deriveAccountStorageKey(A))).toBe(false);
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
});
