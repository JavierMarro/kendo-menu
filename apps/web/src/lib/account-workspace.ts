/**
 * Binds a verified server session to one account-scoped local training store.
 * The controller owns activation, account switching, and exit; a cached ID alone never
 * activates a workspace. Epochs and request sequences keep late responses from reopening
 * or mutating an account after another lifecycle operation has taken over. Remote replacement
 * briefly closes its editor; authentication rejection requires fresh session verification.
 */
import {
  createTrainingStoreAsync,
  serializePersistedTrainingStateV10,
  type TrainingStoreApi,
  type StateStorage,
} from '@kendo-menu/store';
import type { DashboardEntry } from '@kendo-menu/domain';

import {
  createAccountStorage,
  type AccountDatabase,
  type AccountStorageController,
  type AccountStorageFailureCode,
} from './account-storage';
import type { AccountApiClient, AccountSession, SessionResult } from './account-api';
import {
  createIndexedDbAccountDatabase,
  type AccountSynchronizationDatabase,
} from './account-database';
import {
  createAccountSynchronizer,
  type AccountSynchronizationLockProvider,
  type AccountSynchronizationResult,
} from './account-synchronization';
import { accountWorkspaceScope, type WorkspaceCoordinator } from './workspace-coordination';

// Internal composition only. Public routes deliberately do not instantiate this controller.

export type WorkspaceOperationResult =
  | { readonly status: 'ready' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'hidden'; readonly serverRevocationConfirmed: boolean }
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
      readonly synchronization:
        'not-implemented' | 'unavailable' | AccountSynchronizationResult['status'];
      readonly storageChanged: boolean;
      readonly persistenceFailure: AccountStorageFailureCode | null;
      readonly recoveryFailure: AccountStorageFailureCode | null;
      readonly serverRevocationConfirmed: boolean;
    }
  | { readonly mode: 'disposed'; readonly epoch: number };

export interface AccountWorkspaceOptions {
  readonly guestStore: TrainingStoreApi;
  readonly api: Pick<AccountApiClient, 'getSession' | 'logout'>;
  readonly storage: StateStorage;
  readonly coordination: WorkspaceCoordinator;
  readonly database?: AccountDatabase;
  readonly synchronization?: {
    readonly api: Pick<AccountApiClient, 'getDashboard' | 'putDashboard'>;
    readonly database?: AccountSynchronizationDatabase;
    readonly locks?: AccountSynchronizationLockProvider | null;
  };
}

interface ActiveWorkspace {
  readonly userId: string;
  session: AccountSession;
  readonly epoch: number;
  readonly store: TrainingStoreApi;
  readonly storage: AccountStorageController;
  readonly unsubscribe: () => void;
  synchronizer?: ReturnType<typeof createAccountSynchronizer>;
  unsubscribeStore?: () => void;
  storageChanged: boolean;
  serverRevocationConfirmed: boolean;
}

interface RemoteReplacementGate {
  readonly workspace: ActiveWorkspace;
  reopenAllowed: boolean;
  transactionComplete: boolean;
  resuming: boolean;
  logoutInFlight: boolean;
  revocationPending: boolean;
  hideRequested: boolean;
}

/** Owns an application-lifetime activation, never a remembered authentication flag. */
export function createAccountWorkspaceController(options: AccountWorkspaceOptions) {
  let epoch = 0;
  let requestSequence = 0;
  let disposed = false;
  let active: ActiveWorkspace | undefined;
  let authenticationReverificationRequired = false;
  let authenticationRecoverySession: AccountSession | undefined;
  let authenticationLogoutInFlight = false;
  let preparing: AccountStorageController | undefined;
  let replacementGate: RemoteReplacementGate | undefined;
  let ordinaryBootstrapsInFlight = 0;
  // A replacement does not revoke the session that already opened this workspace.
  // Consume this one-shot context synchronously in bootstrap, before any await.
  let pendingLocalResume: RemoteReplacementGate | undefined;
  // A successful remote replacement does not erase the session that opened this editor. Resume
  // that same account locally after the short transaction, unless a competing verified switch,
  // hide, logout, or dashboard 401 has taken authority away.
  const resumeAfterReplacement = (
    gate: RemoteReplacementGate,
  ): Promise<WorkspaceOperationResult> => {
    gate.resuming = true;
    pendingLocalResume = gate;
    return controller
      .bootstrap()
      .then((result) => {
        if (
          result.status !== 'ready' &&
          replacementGate === gate &&
          !gate.hideRequested &&
          !gate.revocationPending &&
          !gate.logoutInFlight &&
          !authenticationReverificationRequired
        ) {
          // A local storage failure can be retried without waiting for connectivity.
          gate.reopenAllowed = true;
        }
        return result;
      })
      .finally(() => {
        gate.resuming = false;
        settleReplacementGate(gate);
      });
  };
  const currentSynchronizer = () => active?.synchronizer;
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
      previous.unsubscribeStore?.();
      previous.synchronizer?.stop();
      previous.storage.disable();
      // Captured old store references no longer expose a hidden dashboard. Its disabled
      // persistence adapter must not overwrite the retained cache with this empty state.
      previous.store.setState({ dashboardEntries: [] });
    }
  };

  const settleReplacementGate = (gate: RemoteReplacementGate) => {
    if (
      replacementGate !== gate ||
      !gate.transactionComplete ||
      gate.resuming ||
      gate.logoutInFlight ||
      gate.revocationPending ||
      gate.reopenAllowed
    ) {
      return;
    }
    replacementGate = undefined;
    if (exitIntent?.workspace === gate.workspace) exitIntent = undefined;
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
    // A save acknowledgement is meaningful only if the cache still equals the current store.
    // Edits can arrive while the asynchronous flush or readback is in progress.
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
    // Record confirmed revocation before a fallible local flush. A newer exit intent must
    // still know the server session is gone even if it supersedes this operation.
    if (confirmed) workspace.serverRevocationConfirmed = true;
    const saved = await preserve(workspace);
    if (active !== workspace || exitIntent !== intent) return { status: 'superseded' };
    cancelRequests();
    deactivate(!saved);
    return saved
      ? { status: 'signed-out' }
      : {
          status: 'retryable',
          reason: 'storage',
          ...(workspace.serverRevocationConfirmed
            ? { serverRevocationConfirmed: true as const }
            : {}),
        };
  };

  const controller = {
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
        synchronization:
          active.synchronizer?.getStatus().status ??
          (options.coordination.isAvailable ? 'not-implemented' : 'unavailable'),
        storageChanged: active.storageChanged,
        persistenceFailure: active.storage.lastFailure?.code ?? null,
        recoveryFailure: active.storage.lastRecoveryFailure?.code ?? null,
        serverRevocationConfirmed: active.serverRevocationConfirmed,
      };
    },

    bootstrap: async (): Promise<WorkspaceOperationResult> => {
      const localResume = pendingLocalResume;
      pendingLocalResume = undefined;
      const ordinaryBootstrap = localResume === undefined;
      if (ordinaryBootstrap) ordinaryBootstrapsInFlight += 1;
      try {
        if (disposed) return { status: 'disposed' };
        if (active === undefined && authenticationLogoutInFlight) return { status: 'superseded' };
        if (localResume === undefined && replacementGate?.resuming) {
          // A competing verification must not cancel offline rehydration of the
          // already-open workspace. Hide and logout still supersede it directly.
          return { status: 'superseded' };
        }
        let result: SessionResult;
        let operation: ReturnType<typeof startRequest>;
        const pendingExit = exitIntent;
        if (localResume !== undefined) {
          if (
            replacementGate !== localResume ||
            !localResume.transactionComplete ||
            !localResume.reopenAllowed ||
            localResume.logoutInFlight ||
            localResume.revocationPending ||
            localResume.hideRequested ||
            localResume.workspace.serverRevocationConfirmed ||
            authenticationReverificationRequired ||
            pendingExit !== undefined ||
            active !== undefined
          ) {
            return { status: 'superseded' };
          }
          // The editor was open under this verified session until the short local
          // replacement transaction. Keep that offline access while rehydrating the
          // new cache. A dashboard 401 uses a separate path that requires /api/session.
          operation = startRequest();
          result = { status: 'authenticated', session: localResume.workspace.session };
        } else if (pendingExit !== undefined) {
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
        const pendingReplacement = replacementGate;
        if (pendingReplacement !== undefined) {
          if (pendingReplacement.revocationPending || pendingReplacement.logoutInFlight) {
            return { status: 'superseded' };
          }
          if (
            !pendingReplacement.transactionComplete &&
            result.status === 'authenticated' &&
            result.session.userId === pendingReplacement.workspace.userId
          ) {
            // A session check begun while replacement owns the cache cannot reopen the
            // pre-replacement editor. Its completion callback will verify again afterward.
            return { status: 'superseded' };
          }
          pendingReplacement.reopenAllowed = false;
        }
        if (result.status === 'signed-out') {
          const saved = active === undefined || (await preserve(active));
          if (!isCurrent(operation)) return { status: 'superseded' };
          authenticationReverificationRequired = false;
          authenticationRecoverySession = undefined;
          deactivate(!saved);
          if (pendingReplacement !== undefined) {
            pendingReplacement.reopenAllowed = false;
            settleReplacementGate(pendingReplacement);
          }
          if (!saved) return { status: 'retryable', reason: 'storage' };
          return { status: 'signed-out' };
        }
        const userId = result.session.userId;
        if (active?.userId === userId) {
          active.session = result.session;
          active.synchronizer?.updateSession(result.session);
          active.serverRevocationConfirmed = false;
          authenticationReverificationRequired = false;
          authenticationRecoverySession = undefined;
          if (pendingReplacement !== undefined) {
            pendingReplacement.reopenAllowed = false;
            settleReplacementGate(pendingReplacement);
          }
          return { status: 'ready' };
        }

        const saved = active === undefined || (await preserve(active));
        if (!isCurrent(operation)) return { status: 'superseded' };

        // No account storage lookup precedes this validated session result. Tear down A
        // completely before even deriving B's adapter, including a pending activation.
        deactivate(!saved);
        if (!saved) return { status: 'retryable', reason: 'storage' };
        if (pendingReplacement !== undefined && userId !== pendingReplacement.workspace.userId) {
          pendingReplacement.reopenAllowed = false;
        }
        const activationEpoch = epoch;
        const preparation = (() => {
          try {
            const synchronizationDatabase =
              options.synchronization === undefined
                ? undefined
                : (options.synchronization.database ?? createIndexedDbAccountDatabase());
            const storage = createAccountStorage({
              accountId: userId,
              storage: options.storage,
              coordination: options.coordination,
              ...((synchronizationDatabase ?? options.database) === undefined
                ? {}
                : { database: synchronizationDatabase ?? options.database }),
            });
            return { synchronizationDatabase, storage };
          } catch {
            return null;
          }
        })();
        if (preparation === null) return { status: 'retryable', reason: 'storage' };
        const { synchronizationDatabase, storage } = preparation;
        preparing = storage;
        const activationCurrent = () =>
          !disposed &&
          epoch === activationEpoch &&
          requestSequence === operation.sequence &&
          active === undefined &&
          preparing === storage &&
          storage.accountId === userId;
        const observedLegacyValues: string[] = [];
        let sawLegacyChange = false;
        // Subscribe during verified preparation so a stale tab's event value survives
        // even if migration removes the key before the event callback can read it.
        const unsubscribe = options.coordination.subscribe(
          accountWorkspaceScope(userId),
          (change) => {
            if (change.kind === 'cache') {
              if (active?.storage === storage) {
                active.storageChanged = true;
                void storage.preserveLegacyDivergence(change.newValue).catch(() => undefined);
              } else if (activationCurrent()) {
                if (change.newValue !== null) observedLegacyValues.push(change.newValue);
                sawLegacyChange = true;
              }
            } else if (active?.storage === storage) {
              active.storageChanged = true;
            }
          },
        );
        let store: TrainingStoreApi | undefined;
        try {
          // Only a verified session reaches migration. Its account lock covers the short
          // LocalStorage-to-IndexedDB cutover, never an HTTP request.
          await storage.migrateLegacy();
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
          let observedIndex = 0;
          while (observedIndex < observedLegacyValues.length) {
            const value = observedLegacyValues[observedIndex];
            observedIndex += 1;
            if (value === undefined) continue;
            await storage.preserveLegacyDivergence(value);
            if (!activationCurrent()) return { status: 'superseded' };
          }
          const activatedStore = store;
          active = {
            userId,
            session: result.session,
            epoch: activationEpoch,
            store: activatedStore,
            storage,
            unsubscribe,
            storageChanged: sawLegacyChange,
            serverRevocationConfirmed: false,
          };
          if (options.synchronization !== undefined && synchronizationDatabase !== undefined) {
            const synchronizer = createAccountSynchronizer({
              accountId: userId,
              session: result.session,
              api: options.synchronization.api,
              database: synchronizationDatabase,
              accountStorage: storage,
              guestStorage: options.storage,
              currentCacheValue: () =>
                serializePersistedTrainingStateV10({
                  dashboardEntries: activatedStore.getState().dashboardEntries,
                }),
              // This synchronous gate closes account editing before IndexedDB can replace its
              // cache. The callback settles only after the transaction and synchronization lock.
              beginRemoteReplacement: (expectedCacheValue) => {
                if (
                  active?.storage !== storage ||
                  exitIntent?.workspace === active ||
                  ordinaryBootstrapsInFlight > 0 ||
                  storage.confirmedCacheValue !== expectedCacheValue ||
                  serializePersistedTrainingStateV10({
                    dashboardEntries: activatedStore.getState().dashboardEntries,
                  }) !== expectedCacheValue
                ) {
                  return null;
                }
                const gate: RemoteReplacementGate = {
                  workspace: active,
                  reopenAllowed: true,
                  transactionComplete: false,
                  resuming: false,
                  logoutInFlight: false,
                  revocationPending: false,
                  hideRequested: false,
                };
                replacementGate = gate;
                cancelRequests();
                // No visible editor can accept an edit after this point. The confirmed
                // local cache is still in IndexedDB until the replacement commits, and
                // use-cloud preserves it in that same transaction.
                deactivate();
                return () => {
                  // Let the synchronization Web Lock release before the verified workspace
                  // reopens. A failed transaction reopens the original durable cache.
                  setTimeout(() => {
                    if (replacementGate !== gate) return;
                    gate.transactionComplete = true;
                    if (
                      gate.reopenAllowed &&
                      !gate.revocationPending &&
                      ordinaryBootstrapsInFlight === 0
                    ) {
                      void resumeAfterReplacement(gate).catch(() => undefined);
                    }
                    settleReplacementGate(gate);
                  }, 0);
                };
              },
              onAuthenticationRejected: () => {
                if (active?.storage !== storage) return;
                // A dashboard 401 invalidates the currently verified session context. Hide
                // the account synchronously, retain its latest entries in private memory,
                // and require an explicit fresh session verification before reactivation.
                authenticationReverificationRequired = true;
                authenticationRecoverySession = active.session;
                cancelRequests();
                deactivate(true);
              },
              ...(options.synchronization.locks === undefined
                ? {}
                : { locks: options.synchronization.locks }),
            });
            active.synchronizer = synchronizer;
            active.unsubscribeStore = activatedStore.subscribe(() => synchronizer.schedule());
            synchronizer.start();
          }
          preparing = undefined;
          unconfirmedEdits.delete(userId);
          authenticationReverificationRequired = false;
          authenticationRecoverySession = undefined;
          if (pendingReplacement !== undefined) {
            pendingReplacement.reopenAllowed = false;
            settleReplacementGate(pendingReplacement);
          }
          return { status: 'ready' };
        } catch {
          return activationCurrent()
            ? { status: 'retryable', reason: 'storage' }
            : { status: 'superseded' };
        } finally {
          if (active?.storage !== storage) {
            unsubscribe();
            storage.disable();
            store?.setState({ dashboardEntries: [] });
            if (preparing === storage) preparing = undefined;
          }
        }
      } finally {
        if (ordinaryBootstrap) {
          ordinaryBootstrapsInFlight -= 1;
          const gate = replacementGate;
          if (
            ordinaryBootstrapsInFlight === 0 &&
            gate !== undefined &&
            gate.transactionComplete &&
            gate.reopenAllowed &&
            !gate.resuming &&
            !gate.logoutInFlight &&
            !gate.revocationPending &&
            !gate.hideRequested &&
            active === undefined &&
            !authenticationReverificationRequired
          ) {
            void resumeAfterReplacement(gate).catch(() => undefined);
          }
        }
      }
    },

    logout: async (): Promise<WorkspaceOperationResult> => {
      if (disposed) return { status: 'disposed' };
      const gate = replacementGate;
      const workspace = active ?? gate?.workspace;
      if (authenticationLogoutInFlight || gate?.logoutInFlight) return { status: 'superseded' };
      if (
        active === undefined &&
        gate === undefined &&
        authenticationReverificationRequired &&
        authenticationRecoverySession !== undefined
      ) {
        // Abort an explicit session retry before revoking the rejected session, so its
        // response cannot reactivate the workspace while logout is in progress.
        const operation = startRequest();
        authenticationLogoutInFlight = true;
        try {
          await options.api.logout(operation.abort.signal);
          if (!isCurrent(operation)) return { status: 'superseded' };
          authenticationReverificationRequired = false;
          authenticationRecoverySession = undefined;
          return { status: 'signed-out' };
        } catch (error) {
          if (!isCurrent(operation)) return { status: 'superseded' };
          if (isUnauthenticated(error)) {
            authenticationReverificationRequired = false;
            authenticationRecoverySession = undefined;
            return { status: 'signed-out' };
          }
          if (isMissingCsrf(error)) {
            try {
              const verified = await options.api.getSession(operation.abort.signal);
              if (!isCurrent(operation)) return { status: 'superseded' };
              if (verified.status === 'signed-out') {
                authenticationReverificationRequired = false;
                authenticationRecoverySession = undefined;
                return { status: 'signed-out' };
              }
            } catch {
              // Keep the rejected workspace hidden when revocation cannot be verified.
            }
          }
          return { status: 'retryable', reason: 'logout' };
        } finally {
          authenticationLogoutInFlight = false;
        }
      }
      if (workspace === undefined) return { status: 'signed-out' };
      if (active === undefined && gate !== undefined) {
        // The editor is already hidden for a remote replacement. Still revoke the
        // server session, and suppress the replacement callback's automatic reopen.
        gate.reopenAllowed = false;
        const intent = { workspace, kind: 'logout' as const };
        exitIntent = intent;
        gate.logoutInFlight = true;
        const operation = startRequest();
        try {
          await options.api.logout(operation.abort.signal);
          if (!isCurrent(operation) || exitIntent !== intent) return { status: 'superseded' };
          workspace.serverRevocationConfirmed = true;
          gate.revocationPending = false;
          exitIntent = undefined;
          return { status: 'signed-out' };
        } catch (error) {
          if (!isCurrent(operation) || exitIntent !== intent) return { status: 'superseded' };
          if (isUnauthenticated(error)) {
            workspace.serverRevocationConfirmed = true;
            gate.revocationPending = false;
            exitIntent = undefined;
            return { status: 'signed-out' };
          }
          if (isMissingCsrf(error)) {
            try {
              const verified = await options.api.getSession(operation.abort.signal);
              if (!isCurrent(operation) || exitIntent !== intent) return { status: 'superseded' };
              if (verified.status === 'signed-out') {
                workspace.serverRevocationConfirmed = true;
                gate.revocationPending = false;
                exitIntent = undefined;
                return { status: 'signed-out' };
              }
            } catch {
              // Leave the account hidden. A fresh explicit logout or session check may retry.
            }
          }
          gate.revocationPending = true;
          if (exitIntent === intent) exitIntent = undefined;
          return { status: 'retryable', reason: 'logout' };
        } finally {
          gate.logoutInFlight = false;
          if (gate.hideRequested && exitIntent === intent) exitIntent = undefined;
          settleReplacementGate(gate);
        }
      }
      const intent = { workspace, kind: 'logout' as const };
      exitIntent = intent;
      const operation = startRequest();
      if (!(await preserve(workspace))) {
        if (!isCurrent(operation)) return { status: 'superseded' };
        if (workspace.serverRevocationConfirmed) {
          // The server session is already gone: retain the unsaved state privately, but do not
          // leave the revoked account visible while waiting for storage recovery.
          cancelRequests();
          deactivate(true);
          return { status: 'retryable', reason: 'storage', serverRevocationConfirmed: true };
        }
        if (exitIntent === intent) exitIntent = undefined;
        return { status: 'retryable', reason: 'storage' };
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
      if (workspace === undefined && replacementGate !== undefined) {
        const gate = replacementGate;
        gate.reopenAllowed = false;
        gate.hideRequested = true;
        if (!gate.logoutInFlight) {
          cancelRequests();
          if (exitIntent?.workspace === gate.workspace) exitIntent = undefined;
        }
        settleReplacementGate(gate);
        return {
          status: 'hidden',
          serverRevocationConfirmed: gate.workspace.serverRevocationConfirmed,
        };
      }
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
        if (workspace?.serverRevocationConfirmed) {
          deactivate(true);
          return { status: 'retryable', reason: 'storage', serverRevocationConfirmed: true };
        }
        if (intent !== undefined && exitIntent === intent) exitIntent = undefined;
        return { status: 'retryable', reason: 'storage' };
      }
      // Local hide can supersede a logout whose 204 already arrived. Preserve that fact in
      // the result even though this operation does not call the server itself.
      const serverRevocationConfirmed = workspace?.serverRevocationConfirmed ?? false;
      deactivate();
      return { status: 'hidden', serverRevocationConfirmed };
    },

    checkSynchronization: async (): Promise<AccountSynchronizationResult> =>
      active?.synchronizer?.check() ?? { status: 'paused' },

    retrySynchronization: async (): Promise<AccountSynchronizationResult> => {
      const existing = currentSynchronizer();
      if (existing !== undefined) return existing.retry();
      const gate = replacementGate;
      if (
        gate !== undefined &&
        gate.transactionComplete &&
        gate.reopenAllowed &&
        !gate.resuming &&
        !gate.revocationPending &&
        !gate.logoutInFlight &&
        !authenticationReverificationRequired
      ) {
        const restored = await resumeAfterReplacement(gate);
        return restored.status === 'ready'
          ? (currentSynchronizer()?.check() ?? { status: 'paused' })
          : { status: 'paused' };
      }
      if (!authenticationReverificationRequired) return { status: 'paused' };
      const verified = await controller.bootstrap();
      const restored = currentSynchronizer();
      return verified.status === 'ready'
        ? (restored?.check() ?? { status: 'paused' })
        : { status: 'paused' };
    },

    readSynchronizationState: async () => active?.synchronizer?.readState() ?? null,

    useCloudVersion: async (conflictId: string): Promise<AccountSynchronizationResult> =>
      active?.synchronizer?.useCloud(conflictId) ?? { status: 'paused' },

    useLocalVersion: async (conflictId: string): Promise<AccountSynchronizationResult> =>
      active?.synchronizer?.useLocal(conflictId) ?? { status: 'paused' },

    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelRequests();
      deactivate();
    },
  };
  return controller;
}
