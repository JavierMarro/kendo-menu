import {
  createTrainingStoreAsync,
  serializePersistedTrainingStateV10,
  type TrainingStoreApi,
  type StateStorage,
} from '@kendo-menu/store';
import type { DashboardEntry } from '@kendo-menu/domain';

import {
  createAccountStorage,
  type AccountStorageController,
  type AccountStorageFailureCode,
} from './account-storage';
import type { AccountApiClient, AccountSession, SessionResult } from './account-api';
import { accountWorkspaceScope, type WorkspaceCoordinator } from './workspace-coordination';

// Internal composition only. Public routes deliberately do not instantiate this controller.
// Session validation, storage validation, and coordination remain separate injected boundaries.

export type WorkspaceOperationResult =
  | { readonly status: 'ready' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'hidden'; readonly serverRevocationConfirmed: false }
  | { readonly status: 'superseded' }
  | { readonly status: 'disposed' }
  | {
      readonly status: 'retryable';
      readonly reason: 'bootstrap' | 'storage' | 'logout';
      readonly serverRevocationConfirmed?: true;
    };

export type WorkspaceSnapshot =
  | { readonly mode: 'guest'; readonly epoch: number; readonly store: TrainingStoreApi }
  | {
      readonly mode: 'account';
      readonly epoch: number;
      readonly userId: string;
      readonly session: AccountSession;
      readonly store: TrainingStoreApi;
      readonly coordination: 'available' | 'unavailable';
      readonly synchronization: 'not-implemented' | 'unavailable';
      readonly storageChanged: boolean;
      readonly persistenceFailure: AccountStorageFailureCode | null;
      readonly serverRevocationConfirmed: boolean;
    }
  | { readonly mode: 'disposed'; readonly epoch: number };

export interface AccountWorkspaceOptions {
  readonly guestStore: TrainingStoreApi;
  readonly api: Pick<AccountApiClient, 'getSession' | 'logout'>;
  readonly storage: StateStorage;
  readonly coordination: WorkspaceCoordinator;
}

interface ActiveWorkspace {
  readonly userId: string;
  session: AccountSession;
  readonly epoch: number;
  readonly store: TrainingStoreApi;
  readonly storage: AccountStorageController;
  readonly unsubscribe: () => void;
  storageChanged: boolean;
  serverRevocationConfirmed: boolean;
}

/** Owns an application-lifetime activation, never a remembered authentication flag. */
export function createAccountWorkspaceController(options: AccountWorkspaceOptions) {
  let epoch = 0;
  let requestSequence = 0;
  let disposed = false;
  let active: ActiveWorkspace | undefined;
  let preparing: AccountStorageController | undefined;
  let request: AbortController | undefined;
  let exitIntent:
    { readonly workspace: ActiveWorkspace; readonly kind: 'logout' | 'hide' } | undefined;
  // A failed durable write must not discard edits when authentication changes. This holds
  // only the existing immutable state references (no extra LocalStorage payload), with no
  // store/actions/writer, and is considered only after fresh verification of that same ID.
  const unconfirmedEdits = new Map<
    string,
    {
      readonly entries: readonly DashboardEntry[];
      readonly baseline: string | null | undefined;
    }
  >();

  const cancelRequests = () => {
    requestSequence += 1;
    request?.abort();
    request = undefined;
  };

  const deactivate = (retainUnconfirmed = false) => {
    epoch += 1;
    preparing?.disable();
    preparing = undefined;
    const previous = active;
    active = undefined;
    if (previous !== undefined) {
      if (exitIntent?.workspace === previous) exitIntent = undefined;
      if (retainUnconfirmed) {
        unconfirmedEdits.set(previous.userId, {
          entries: previous.store.getState().dashboardEntries,
          baseline: previous.storage.confirmedCacheValue,
        });
      }
      previous.unsubscribe();
      previous.storage.disable();
      // Captured old store references no longer expose a hidden dashboard. Its disabled
      // persistence adapter must not overwrite the retained cache with this empty state.
      previous.store.setState({ dashboardEntries: [] });
    }
  };

  const startRequest = () => {
    cancelRequests();
    const abort = new AbortController();
    request = abort;
    return { abort, sequence: requestSequence, epoch, userId: active?.userId };
  };

  const isCurrent = (operation: ReturnType<typeof startRequest>) =>
    !disposed &&
    operation.sequence === requestSequence &&
    operation.epoch === epoch &&
    operation.userId === active?.userId &&
    !operation.abort.signal.aborted;

  const preserve = async (workspace: ActiveWorkspace): Promise<boolean> => {
    try {
      await workspace.storage.flush();
      const raw = serializePersistedTrainingStateV10({
        dashboardEntries: workspace.store.getState().dashboardEntries,
      });
      await workspace.storage.confirmCurrentValue(raw);
      return (
        active === workspace &&
        workspace.epoch === epoch &&
        raw ===
          serializePersistedTrainingStateV10({
            dashboardEntries: workspace.store.getState().dashboardEntries,
          })
      );
    } catch {
      return false;
    }
  };

  const isUnauthenticated = (error: unknown) =>
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    error.kind === 'http' &&
    'status' in error &&
    error.status === 401 &&
    'code' in error &&
    error.code === 'UNAUTHENTICATED';
  const isMissingCsrf = (error: unknown) =>
    typeof error === 'object' && error !== null && 'kind' in error && error.kind === 'csrf';

  const finishExitAfterSessionCheck = async (
    workspace: ActiveWorkspace,
    confirmed: boolean,
    intent: NonNullable<typeof exitIntent>,
  ): Promise<WorkspaceOperationResult> => {
    if (active !== workspace || exitIntent !== intent) return { status: 'superseded' };
    const saved = await preserve(workspace);
    if (active !== workspace || exitIntent !== intent) return { status: 'superseded' };
    if (confirmed) workspace.serverRevocationConfirmed = true;
    cancelRequests();
    deactivate(!saved);
    return saved
      ? { status: 'signed-out' }
      : {
          status: 'retryable',
          reason: 'storage',
          ...(confirmed ? { serverRevocationConfirmed: true as const } : {}),
        };
  };

  return {
    getSnapshot: (): WorkspaceSnapshot => {
      if (disposed) return { mode: 'disposed', epoch };
      if (active === undefined) return { mode: 'guest', epoch, store: options.guestStore };
      return {
        mode: 'account',
        epoch,
        userId: active.userId,
        session: active.session,
        store: active.store,
        coordination: options.coordination.availability,
        synchronization: options.coordination.isAvailable ? 'not-implemented' : 'unavailable',
        storageChanged: active.storageChanged,
        persistenceFailure: active.storage.lastFailure?.code ?? null,
        serverRevocationConfirmed: active.serverRevocationConfirmed,
      };
    },

    bootstrap: async (): Promise<WorkspaceOperationResult> => {
      if (disposed) return { status: 'disposed' };
      let result: SessionResult;
      let operation: ReturnType<typeof startRequest>;
      const pendingExit = exitIntent;
      if (pendingExit !== undefined) {
        // A bootstrap may discover a genuinely different account, but it cannot cancel
        // an exit merely by revalidating the account that is already leaving.
        const check = new AbortController();
        try {
          result = await options.api.getSession(check.signal);
        } catch {
          return { status: 'retryable', reason: 'bootstrap' };
        }
        if (disposed) return { status: 'disposed' };
        if (
          result.status === 'authenticated' &&
          result.session.userId === pendingExit.workspace.userId
        ) {
          return { status: 'superseded' };
        }
        const currentExit = exitIntent;
        if (
          result.status === 'authenticated' &&
          (active !== pendingExit.workspace ||
            pendingExit.kind === 'hide' ||
            (currentExit?.kind === 'hide' && currentExit.workspace === pendingExit.workspace))
        ) {
          // An exit or later replacement of its workspace makes this background
          // verification stale. Local hide also blocks a different account while pending.
          return { status: 'superseded' };
        }
        if (result.status === 'signed-out') {
          if (
            currentExit?.workspace === pendingExit.workspace &&
            active === pendingExit.workspace
          ) {
            return finishExitAfterSessionCheck(
              pendingExit.workspace,
              currentExit.kind === 'logout',
              currentExit,
            );
          }
          if (active !== pendingExit.workspace) return { status: 'superseded' };
        }
        operation = startRequest();
      } else {
        operation = startRequest();
        try {
          result = await options.api.getSession(operation.abort.signal);
        } catch {
          return isCurrent(operation)
            ? { status: 'retryable', reason: 'bootstrap' }
            : { status: 'superseded' };
        }
      }
      if (!isCurrent(operation)) return { status: 'superseded' };
      if (result.status === 'signed-out') {
        const saved = active === undefined || (await preserve(active));
        if (!isCurrent(operation)) return { status: 'superseded' };
        deactivate(!saved);
        if (!saved) return { status: 'retryable', reason: 'storage' };
        return { status: 'signed-out' };
      }
      const userId = result.session.userId;
      if (active?.userId === userId) {
        active.session = result.session;
        active.serverRevocationConfirmed = false;
        return { status: 'ready' };
      }

      const saved = active === undefined || (await preserve(active));
      if (!isCurrent(operation)) return { status: 'superseded' };

      // No account storage lookup precedes this validated session result. Tear down A
      // completely before even deriving B's adapter, including a pending activation.
      deactivate(!saved);
      if (!saved) return { status: 'retryable', reason: 'storage' };
      const activationEpoch = epoch;
      const storage = createAccountStorage({
        accountId: userId,
        storage: options.storage,
        coordination: options.coordination,
      });
      preparing = storage;
      const activationCurrent = () =>
        !disposed &&
        epoch === activationEpoch &&
        requestSequence === operation.sequence &&
        active === undefined &&
        preparing === storage &&
        storage.accountId === userId;
      let store: TrainingStoreApi | undefined;
      try {
        // Metadata is separately validated; its presence never establishes identity.
        await storage.readSyncMetadata();
        if (!activationCurrent()) return { status: 'superseded' };
        let hydrationFailed = false;
        store = await createTrainingStoreAsync({
          storage,
          storageKey: storage.cacheKey,
          onHydrationError: () => {
            hydrationFailed = true;
          },
        });
        if (!activationCurrent()) return { status: 'superseded' };
        if (hydrationFailed) return { status: 'retryable', reason: 'storage' };
        const retained = unconfirmedEdits.get(userId);
        if (retained !== undefined) {
          // A newer tab's cache and this unsaved state are two different versions. Job 6B
          // preserves both and stops; it must not implement automatic conflict resolution.
          if (retained.baseline !== storage.confirmedCacheValue) {
            return { status: 'retryable', reason: 'storage' };
          }
          store.setState({ dashboardEntries: retained.entries });
        }
        await storage.initializeSyncMetadata();
        if (!activationCurrent()) return { status: 'superseded' };
        // Persist one canonical v10 cache, including a new empty workspace, and confirm it.
        await storage.setItem(
          storage.cacheKey,
          serializePersistedTrainingStateV10({
            dashboardEntries: store.getState().dashboardEntries,
          }),
        );
        await storage.flush();
        if (!activationCurrent()) return { status: 'superseded' };
        await storage.confirmCurrentValue(
          serializePersistedTrainingStateV10({
            dashboardEntries: store.getState().dashboardEntries,
          }),
        );
        if (!activationCurrent()) return { status: 'superseded' };
        const unsubscribe = options.coordination.subscribe(accountWorkspaceScope(userId), () => {
          if (active?.epoch === activationEpoch && active.userId === userId) {
            active.storageChanged = true;
          }
        });
        active = {
          userId,
          session: result.session,
          epoch: activationEpoch,
          store,
          storage,
          unsubscribe,
          storageChanged: false,
          serverRevocationConfirmed: false,
        };
        preparing = undefined;
        unconfirmedEdits.delete(userId);
        return { status: 'ready' };
      } catch {
        return activationCurrent()
          ? { status: 'retryable', reason: 'storage' }
          : { status: 'superseded' };
      } finally {
        if (active?.storage !== storage) {
          storage.disable();
          store?.setState({ dashboardEntries: [] });
          if (preparing === storage) preparing = undefined;
        }
      }
    },

    logout: async (): Promise<WorkspaceOperationResult> => {
      if (disposed) return { status: 'disposed' };
      const workspace = active;
      if (workspace === undefined) return { status: 'signed-out' };
      const intent = { workspace, kind: 'logout' as const };
      exitIntent = intent;
      const operation = startRequest();
      if (!(await preserve(workspace))) {
        if (exitIntent === intent) exitIntent = undefined;
        return isCurrent(operation)
          ? { status: 'retryable', reason: 'storage' }
          : { status: 'superseded' };
      }
      if (!isCurrent(operation)) return { status: 'superseded' };
      try {
        if (!workspace.serverRevocationConfirmed) await options.api.logout(operation.abort.signal);
      } catch (error) {
        if (!isCurrent(operation)) return { status: 'superseded' };
        if (isMissingCsrf(error)) {
          // A lost 204 may already have cleared the browser-managed cookies. In that
          // case logout cannot construct a CSRF-protected retry, so verify the session.
          try {
            const sessionResult = await options.api.getSession(operation.abort.signal);
            if (!isCurrent(operation)) return { status: 'superseded' };
            if (sessionResult.status === 'signed-out') {
              workspace.serverRevocationConfirmed = true;
            } else {
              if (exitIntent === intent) exitIntent = undefined;
              return { status: 'retryable', reason: 'logout' };
            }
          } catch {
            if (exitIntent === intent) exitIntent = undefined;
            return { status: 'retryable', reason: 'logout' };
          }
        } else if (!isUnauthenticated(error)) {
          if (exitIntent === intent) exitIntent = undefined;
          return { status: 'retryable', reason: 'logout' };
        } else {
          workspace.serverRevocationConfirmed = true;
        }
      }
      if (!isCurrent(operation)) return { status: 'superseded' };
      workspace.serverRevocationConfirmed = true;
      // Preserve any edit made while the request was in flight before hiding the store.
      const saved = await preserve(workspace);
      if (!isCurrent(operation)) return { status: 'superseded' };
      cancelRequests();
      deactivate(!saved);
      if (!saved)
        return { status: 'retryable', reason: 'storage', serverRevocationConfirmed: true };
      return { status: 'signed-out' };
    },

    hideLocally: async (): Promise<WorkspaceOperationResult> => {
      if (disposed) return { status: 'disposed' };
      const workspace = active;
      const intent = workspace === undefined ? undefined : { workspace, kind: 'hide' as const };
      if (intent !== undefined) exitIntent = intent;
      cancelRequests();
      const hidingEpoch = epoch;
      const hidingSequence = requestSequence;
      const saved = workspace === undefined || (await preserve(workspace));
      if (
        disposed ||
        epoch !== hidingEpoch ||
        requestSequence !== hidingSequence ||
        active !== workspace
      )
        return { status: 'superseded' };
      if (!saved) {
        if (intent !== undefined && exitIntent === intent) exitIntent = undefined;
        return { status: 'retryable', reason: 'storage' };
      }
      deactivate();
      return { status: 'hidden', serverRevocationConfirmed: false };
    },

    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelRequests();
      deactivate();
    },
  };
}
