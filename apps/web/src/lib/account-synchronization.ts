/**
 * Coordinates foreground, whole-dashboard synchronization for one verified account workspace.
 * IndexedDB owns durable request and conflict state; the API remains the authority for cloud
 * revisions and authentication. A separate Web Lock serializes network work across tabs without
 * holding a storage transaction open across fetch.
 */
import { parseDashboardPersistenceV10 } from '@kendo-menu/domain/dashboard-persistence';
import {
  classifyTrainingStorageValue,
  serializePersistedTrainingStateV10,
  type StateStorage,
} from '@kendo-menu/store';

import {
  AccountApiError,
  isAccountWorkspaceId,
  MAX_DASHBOARD_REQUEST_BYTES,
  type AccountApiClient,
  type AccountSession,
  type DashboardReadResponse,
  type DashboardSnapshot,
  type DashboardWriteRequest,
} from './account-api';
import type {
  AccountCacheRecord,
  AccountSynchronizationDatabase,
  AccountSyncMutationResult,
  AccountSyncState,
  PendingAccountRequest,
} from './account-database';
import type { AccountStorageController } from './account-storage';

const ADOPTION_PREFLIGHT_REQUEST_ID = '00000000-0000-4000-8000-000000000000';
const SYNC_LOCK_PREFIX = 'kendo-menu:account:';

export interface AccountSynchronizationLockProvider {
  readonly request: <T>(
    name: string,
    options: { readonly mode: 'exclusive'; readonly ifAvailable: true },
    callback: (lock: Lock | null) => T | PromiseLike<T>,
  ) => Promise<T>;
}

export type AccountSynchronizationLockResult<T> =
  { readonly status: 'acquired'; readonly value: T } | { readonly status: 'unavailable' };

/** The sync lock may span HTTP. Account storage locks and IDB transactions never do. */
export async function withAccountSynchronizationLock<T>(
  accountId: string,
  operation: () => T | PromiseLike<T>,
  providedLocks?: AccountSynchronizationLockProvider | null,
): Promise<AccountSynchronizationLockResult<T>> {
  if (!isAccountWorkspaceId(accountId)) return { status: 'unavailable' };
  let locks = providedLocks;
  if (locks === undefined) {
    try {
      locks = typeof navigator === 'undefined' ? null : navigator.locks;
    } catch {
      locks = null;
    }
  }
  if (locks === null) return { status: 'unavailable' };
  let operationStarted = false;
  try {
    return await locks.request(
      `${SYNC_LOCK_PREFIX}${accountId}:sync`,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (lock === null) return { status: 'unavailable' };
        operationStarted = true;
        return { status: 'acquired', value: await operation() };
      },
    );
  } catch (error) {
    if (operationStarted) throw error;
    return { status: 'unavailable' };
  }
}

export type GuestAdoptionEligibility =
  | { readonly status: 'eligible'; readonly dashboard: DashboardSnapshot }
  | { readonly status: 'ineligible' };

/** Preflight the complete Yes envelope; absent, invalid, empty or oversized guests are inert. */
export function inspectGuestAdoptionEligibility(
  rawValue: string | null,
  accountId: string,
  catalogueVersion: string,
): GuestAdoptionEligibility {
  if (!isAccountWorkspaceId(accountId) || !/^[0-9a-f]{64}$/u.test(catalogueVersion)) {
    return { status: 'ineligible' };
  }
  const inspected = classifyTrainingStorageValue(rawValue);
  if (
    (inspected.status !== 'ready' && inspected.status !== 'migrated') ||
    inspected.state.dashboardEntries.length === 0
  ) {
    return { status: 'ineligible' };
  }
  try {
    const canonical = serializePersistedTrainingStateV10(inspected.state);
    const parsed: unknown = JSON.parse(canonical);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { status: 'ineligible' };
    }
    const envelope = parsed as Record<string, unknown>;
    const state = parseDashboardPersistenceV10(envelope['state']);
    if (state === null || envelope['version'] !== 10) return { status: 'ineligible' };
    const dashboard: DashboardSnapshot = { version: 10, state };
    const request = {
      decision: 'yes',
      transportVersion: 1,
      expectedAccountWorkspaceId: accountId,
      expectedRevision: '0',
      requestId: ADOPTION_PREFLIGHT_REQUEST_ID,
      catalogueVersion,
      dashboard,
    };
    if (
      new TextEncoder().encode(JSON.stringify(request)).byteLength > MAX_DASHBOARD_REQUEST_BYTES
    ) {
      return { status: 'ineligible' };
    }
    return { status: 'eligible', dashboard };
  } catch {
    return { status: 'ineligible' };
  }
}

export type AccountSynchronizationResult =
  | { readonly status: 'synced' | 'uploaded' | 'refreshed' }
  | {
      readonly status:
        'awaiting-adoption' | 'conflict' | 'paused' | 'retryable' | 'oversized' | 'blocked';
    };

export interface AccountSynchronizationOptions {
  readonly accountId: string;
  readonly session: AccountSession;
  readonly api: Pick<AccountApiClient, 'getDashboard' | 'putDashboard'>;
  readonly database: AccountSynchronizationDatabase;
  readonly accountStorage: AccountStorageController;
  readonly guestStorage: StateStorage;
  readonly currentCacheValue: () => string;
  readonly locks?: AccountSynchronizationLockProvider | null;
  readonly createRequestId?: () => string;
  /** Synchronously hide the confirmed store before a remote cache transaction starts. */
  readonly beginRemoteReplacement: (expectedCacheValue: string) => (() => void) | null;
  readonly onAuthenticationRejected?: () => void;
}

function cacheSnapshot(rawValue: string): DashboardSnapshot | null {
  if (classifyTrainingStorageValue(rawValue).status !== 'ready') return null;
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const envelope = parsed as Record<string, unknown>;
    if (envelope['version'] !== 10) return null;
    const state = parseDashboardPersistenceV10(envelope['state']);
    return state === null ? null : { version: 10, state };
  } catch {
    return null;
  }
}

function normalizedSnapshot(snapshot: DashboardSnapshot): string | null {
  try {
    const raw = JSON.stringify({ state: snapshot.state, version: snapshot.version });
    const inspected = classifyTrainingStorageValue(raw);
    return inspected.status === 'ready'
      ? serializePersistedTrainingStateV10(inspected.state)
      : null;
  } catch {
    return null;
  }
}

function cacheMatchesCloud(cache: AccountCacheRecord, cloud: DashboardReadResponse): boolean {
  const local = cacheSnapshot(cache.cacheValue);
  return (
    local !== null &&
    cloud.dashboard !== null &&
    normalizedSnapshot(local) === normalizedSnapshot(cloud.dashboard)
  );
}

function cacheIsEmpty(cache: AccountCacheRecord): boolean {
  const inspected = classifyTrainingStorageValue(cache.cacheValue);
  return inspected.status === 'ready' && inspected.state.dashboardEntries.length === 0;
}

function sameCacheVersion(left: AccountCacheRecord, right: AccountCacheRecord | null): boolean {
  return (
    right !== null &&
    left.identity === right.identity &&
    left.generation === right.generation &&
    left.cacheValue === right.cacheValue
  );
}

function requestWithinCloudLimit(request: DashboardWriteRequest): boolean {
  try {
    return (
      new TextEncoder().encode(JSON.stringify(request)).byteLength <= MAX_DASHBOARD_REQUEST_BYTES
    );
  } catch {
    return false;
  }
}

/** A stopped controller never reads or uploads another verified account's cache. */
export function createAccountSynchronizer(options: AccountSynchronizationOptions) {
  if (!isAccountWorkspaceId(options.accountId) || options.session.userId !== options.accountId) {
    throw new Error('Synchronization requires the verified account workspace ID.');
  }
  let stopped = false;
  let permanentlyBlocked = false;
  let authenticationPaused = false;
  let retryAttempt = 0;
  let session = options.session;
  let activeRun: Promise<AccountSynchronizationResult> | undefined;
  let rerunRequested = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  let lastResult: AccountSynchronizationResult = { status: 'paused' };
  const abort = new AbortController();
  const createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
  const rejectAuthentication = (error: unknown): boolean => {
    if (!(error instanceof AccountApiError) || error.kind !== 'http' || error.status !== 401) {
      return false;
    }
    if (!authenticationPaused) {
      authenticationPaused = true;
      options.onAuthenticationRejected?.();
    }
    return true;
  };

  // Send only a request already committed to IndexedDB. If the response is lost, replay uses its
  // stable ID; a 401 instead invalidates the active workspace before any automatic retry.
  const savePending = async (
    pending: PendingAccountRequest,
  ): Promise<AccountSynchronizationResult> => {
    if (stopped) return { status: 'paused' };
    if (pending.kind === 'adoption') return { status: 'awaiting-adoption' };
    const dashboard = cacheSnapshot(
      JSON.stringify({ state: pending.request.dashboard.state, version: 10 }),
    );
    if (dashboard === null) return { status: 'retryable' };
    const request: DashboardWriteRequest = { ...pending.request, dashboard };
    try {
      const acknowledgement = await options.api.putDashboard(
        options.accountId,
        request,
        abort.signal,
      );
      if (stopped) return { status: 'paused' };
      const result = await options.database.acknowledgePendingRequest(
        options.accountId,
        pending.request.requestId,
        { kind: 'dashboard-ack', acknowledgement },
      );
      if (result.status !== 'committed') return { status: 'retryable' };
      if (
        result.state.cache === null ||
        result.state.cache.identity !== pending.cacheVersion.identity ||
        result.state.cache.generation !== pending.cacheVersion.generation
      ) {
        rerunRequested = true;
      }
      return { status: 'uploaded' };
    } catch (error) {
      if (stopped) return { status: 'paused' };
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 409 &&
        'code' in error &&
        error.code === 'REVISION_CONFLICT'
      ) {
        try {
          const cloud = await options.api.getDashboard(options.accountId, abort.signal);
          if (stopped) return { status: 'paused' };
          const result = await options.database.recordActiveConflict(
            options.accountId,
            pending.cacheVersion,
            cloud,
            pending.request.requestId,
          );
          return result.status === 'committed'
            ? { status: result.state.activeConflict === null ? 'synced' : 'conflict' }
            : { status: 'retryable' };
        } catch (error) {
          if (rejectAuthentication(error)) return { status: 'paused' };
          return { status: 'retryable' };
        }
      }
      if (error instanceof AccountApiError) {
        if (rejectAuthentication(error)) return { status: 'paused' };
        if (
          error.kind === 'request-invalid' ||
          error.kind === 'oversized' ||
          error.kind === 'invalid-response' ||
          (error.kind === 'http' && error.status !== undefined && error.status < 500)
        ) {
          permanentlyBlocked = true;
          return { status: 'blocked' };
        }
      }
      return { status: 'retryable' };
    }
  };

  // Guest adoption retains priority while a first-write capability is still usable. An ordinary
  // pending PUT resumes only after that eligibility check no longer requires a Yes/No choice.
  const replayPending = async (
    pending: PendingAccountRequest,
  ): Promise<AccountSynchronizationResult> => {
    if (stopped) return { status: 'paused' };
    if (pending.kind === 'adoption') return { status: 'awaiting-adoption' };
    if (
      pending.request.expectedRevision === '0' &&
      session.adoption.status === 'pending' &&
      session.adoption.capability
    ) {
      const cloud = await options.api.getDashboard(options.accountId, abort.signal);
      if (stopped) return { status: 'paused' };
      if (cloud.revision === '0') {
        const guestRaw = await options.guestStorage.getItem('kendo-menu');
        if (
          inspectGuestAdoptionEligibility(guestRaw, options.accountId, cloud.catalogueVersion)
            .status === 'eligible'
        ) {
          return { status: 'awaiting-adoption' };
        }
      }
    }
    return savePending(pending);
  };

  const prepareAndSend = async (
    cache: AccountCacheRecord,
    cloud: DashboardReadResponse,
  ): Promise<AccountSynchronizationResult> => {
    const dashboard = cacheSnapshot(cache.cacheValue);
    if (dashboard === null) return { status: 'retryable' };
    const request: DashboardWriteRequest = {
      transportVersion: 1,
      expectedAccountWorkspaceId: options.accountId,
      expectedRevision: cloud.revision,
      requestId: createRequestId(),
      catalogueVersion: cloud.catalogueVersion,
      dashboard,
    };
    if (!requestWithinCloudLimit(request)) return { status: 'oversized' };
    const prepared = await options.database.preparePendingRequest(options.accountId, cache, {
      kind: 'dashboard-put',
      request,
    });
    if (prepared.status !== 'committed' || prepared.state.pendingRequest === null) {
      return { status: 'retryable' };
    }
    return replayPending(prepared.state.pendingRequest);
  };

  const replaceRemoteCache = async (
    expectedVisibleValue: string,
    replacement: () => Promise<AccountSyncMutationResult>,
  ): Promise<AccountSynchronizationResult> => {
    // A late edit after commit cannot be made durable if a second recovery write hits
    // quota. Close the visible editor synchronously before starting the transaction.
    const finish = options.beginRemoteReplacement(expectedVisibleValue);
    if (finish === null) return { status: 'retryable' };
    try {
      const result = await replacement();
      return result.status === 'committed' ? { status: 'refreshed' } : { status: 'retryable' };
    } finally {
      finish();
    }
  };

  // Confirm the visible Zustand value on device before consulting the cloud. Every subsequent
  // comparison uses cache identity/generation so a late local edit cannot be marked clean.
  const synchronize = async (): Promise<AccountSynchronizationResult> => {
    if (stopped) return { status: 'paused' };
    try {
      await options.accountStorage.flush();
      const localValue = options.currentCacheValue();
      await options.accountStorage.confirmCurrentValue(localValue);
      if (stopped) return { status: 'paused' };
      const initial = await options.database.readSyncState(options.accountId);
      if (initial.pendingRequest !== null) return replayPending(initial.pendingRequest);
      if (initial.activeConflict !== null) return { status: 'conflict' };
      if (initial.cache === null || initial.cache.cacheValue !== localValue) {
        return { status: 'retryable' };
      }
      const cloud = await options.api.getDashboard(options.accountId, abort.signal);
      if (stopped) return { status: 'paused' };
      const current = await options.database.readSyncState(options.accountId);
      if (current.pendingRequest !== null) return replayPending(current.pendingRequest);
      if (current.activeConflict !== null) return { status: 'conflict' };
      if (!sameCacheVersion(initial.cache, current.cache)) return { status: 'retryable' };
      if (options.currentCacheValue() !== localValue) return { status: 'retryable' };

      if (session.adoption.status === 'pending' && session.adoption.capability) {
        const guestRaw = await options.guestStorage.getItem('kendo-menu');
        if (
          cloud.revision === '0' &&
          inspectGuestAdoptionEligibility(guestRaw, options.accountId, cloud.catalogueVersion)
            .status === 'eligible'
        ) {
          return { status: 'awaiting-adoption' };
        }
      }

      const cache = current.cache;
      if (cache === null) return { status: 'retryable' };
      const acknowledgement = current.acknowledgement;
      if (
        acknowledgement.status === 'acknowledged' &&
        (acknowledgement.cacheIdentity !== cache.identity ||
          acknowledgement.generation > cache.generation)
      ) {
        return { status: 'retryable' };
      }
      if (acknowledgement.status === 'adoption-declined') {
        if (cloud.revision === '0') {
          return cacheIsEmpty(cache) ? { status: 'synced' } : prepareAndSend(cache, cloud);
        }
        const result = await options.database.recordActiveConflict(options.accountId, cache, cloud);
        return result.status === 'committed'
          ? { status: result.state.activeConflict === null ? 'synced' : 'conflict' }
          : { status: 'retryable' };
      }
      if (acknowledgement.status !== 'acknowledged') {
        if (cloud.revision === '0' && cacheIsEmpty(cache)) {
          const result = await options.database.establishCloudBaseline(
            options.accountId,
            cache,
            cloud,
          );
          return result.status === 'committed' ? { status: 'synced' } : { status: 'retryable' };
        }
        if (cacheMatchesCloud(cache, cloud)) {
          const result = await options.database.establishCloudBaseline(
            options.accountId,
            cache,
            cloud,
          );
          return result.status === 'committed' ? { status: 'synced' } : { status: 'retryable' };
        }
        if (
          cacheIsEmpty(cache) &&
          cache.generation === 0 &&
          acknowledgement.provenance === 'new-empty' &&
          cloud.dashboard !== null
        ) {
          return replaceRemoteCache(localValue, () =>
            options.database.establishCloudBaseline(options.accountId, cache, cloud),
          );
        }
        if (cloud.revision === '0') return prepareAndSend(cache, cloud);
        const result = await options.database.recordActiveConflict(options.accountId, cache, cloud);
        return result.status === 'committed'
          ? { status: result.state.activeConflict === null ? 'synced' : 'conflict' }
          : { status: 'retryable' };
      }

      if (cloud.revision !== acknowledgement.revision) {
        if (cache.generation === acknowledgement.generation) {
          return replaceRemoteCache(localValue, () =>
            options.database.fastForwardCleanCache(
              options.accountId,
              cache,
              acknowledgement.revision,
              cloud,
            ),
          );
        }
        const result = await options.database.recordActiveConflict(options.accountId, cache, cloud);
        return result.status === 'committed'
          ? { status: result.state.activeConflict === null ? 'synced' : 'conflict' }
          : { status: 'retryable' };
      }
      if (cache.generation === acknowledgement.generation) return { status: 'synced' };
      return prepareAndSend(cache, cloud);
    } catch (error) {
      if (rejectAuthentication(error)) return { status: 'paused' };
      return { status: 'retryable' };
    }
  };

  const check = (): Promise<AccountSynchronizationResult> => {
    if (stopped) return Promise.resolve({ status: 'paused' });
    if (authenticationPaused) return Promise.resolve({ status: 'paused' });
    if (permanentlyBlocked) return Promise.resolve({ status: 'blocked' });
    if (activeRun !== undefined) {
      rerunRequested = true;
      return activeRun;
    }
    const run = withAccountSynchronizationLock(options.accountId, synchronize, options.locks)
      .then((result): AccountSynchronizationResult =>
        result.status === 'acquired' ? result.value : { status: 'paused' },
      )
      .catch((error): AccountSynchronizationResult =>
        rejectAuthentication(error) ? { status: 'paused' } : { status: 'retryable' },
      )
      .then((result) => {
        lastResult = result;
        if (result.status === 'retryable' && retryAttempt < 3 && !stopped) {
          retryAttempt += 1;
          if (timer !== undefined) clearTimeout(timer);
          timer = setTimeout(
            () => {
              timer = undefined;
              void check();
            },
            1_000 * 2 ** (retryAttempt - 1),
          );
        } else if (result.status !== 'retryable') {
          retryAttempt = 0;
        }
        return result;
      });
    activeRun = run;
    void run.finally(() => {
      if (activeRun === run) activeRun = undefined;
      if (rerunRequested && !stopped) {
        rerunRequested = false;
        schedule();
      }
    });
    return run;
  };

  const schedule = () => {
    if (stopped || permanentlyBlocked || authenticationPaused) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void check();
    }, 1_000);
  };

  const confirmVisibleCache = async (): Promise<boolean> => {
    if (stopped) return false;
    await options.accountStorage.flush();
    const value = options.currentCacheValue();
    await options.accountStorage.confirmCurrentValue(value);
    return !stopped && options.currentCacheValue() === value;
  };

  // Re-read the current cloud before honoring an explicit choice: the stored conflict snapshot
  // may already be stale. The replacement gate closes editing before the atomic losing-copy save.
  const useCloud = async (conflictId: string): Promise<AccountSynchronizationResult> => {
    if (stopped) return { status: 'paused' };
    try {
      const locked = await withAccountSynchronizationLock(
        options.accountId,
        async (): Promise<AccountSynchronizationResult> => {
          if (!(await confirmVisibleCache())) {
            return { status: stopped ? 'paused' : 'retryable' };
          }
          const latestCloud = await options.api.getDashboard(options.accountId, abort.signal);
          if (stopped) return { status: 'paused' };
          const visibleValue = options.currentCacheValue();
          if (!(await confirmVisibleCache()) || options.currentCacheValue() !== visibleValue) {
            return { status: stopped ? 'paused' : 'retryable' };
          }
          return replaceRemoteCache(visibleValue, () =>
            options.database.resolveConflictUsingCloud(options.accountId, conflictId, latestCloud),
          );
        },
        options.locks,
      );
      if (locked.status === 'unavailable') return { status: 'paused' };
      const result = locked.value;
      lastResult = result;
      return result;
    } catch (error) {
      if (rejectAuthentication(error)) return { status: 'paused' };
      return { status: 'retryable' };
    }
  };

  const useLocal = async (conflictId: string): Promise<AccountSynchronizationResult> => {
    if (stopped) return { status: 'paused' };
    try {
      const locked = await withAccountSynchronizationLock(
        options.accountId,
        async () => {
          if (!(await confirmVisibleCache())) {
            return { status: stopped ? 'paused' : 'retryable' } as const;
          }
          const cloud = await options.api.getDashboard(options.accountId, abort.signal);
          if (stopped) return { status: 'paused' } as const;
          if (!(await confirmVisibleCache())) {
            return { status: stopped ? 'paused' : 'retryable' } as const;
          }
          const prepared = await options.database.resolveConflictUsingLocal(
            options.accountId,
            conflictId,
            cloud,
            createRequestId(),
          );
          if (prepared.status !== 'committed' || prepared.state.pendingRequest === null) {
            return { status: 'retryable' } as const;
          }
          return savePending(prepared.state.pendingRequest);
        },
        options.locks,
      );
      return locked.status === 'unavailable' ? { status: 'paused' } : locked.value;
    } catch (error) {
      if (rejectAuthentication(error)) return { status: 'paused' };
      return { status: 'retryable' };
    }
  };

  return {
    check,
    retry: () => {
      permanentlyBlocked = false;
      retryAttempt = 0;
      return check();
    },
    readState: async (): Promise<AccountSyncState | null> => {
      if (stopped) return null;
      const state = await options.database.readSyncState(options.accountId);
      return stopped ? null : state;
    },
    getStatus: () => lastResult,
    updateSession: (verifiedSession: AccountSession) => {
      if (verifiedSession.userId !== options.accountId) return;
      session = verifiedSession;
      authenticationPaused = false;
      schedule();
    },
    schedule,
    useCloud,
    useLocal,
    start: () => {
      if (stopped || started) return;
      started = true;
      if (typeof window !== 'undefined') {
        window.addEventListener('focus', schedule);
        window.addEventListener('online', schedule);
      }
      void check();
    },
    stop: () => {
      stopped = true;
      abort.abort();
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (started && typeof window !== 'undefined') {
        window.removeEventListener('focus', schedule);
        window.removeEventListener('online', schedule);
      }
      started = false;
    },
  };
}
