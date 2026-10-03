/**
 * Binds a verified server session to one account-scoped local training store.
 * The controller owns activation, account switching, and exit; a cached ID alone never
 * activates a workspace. Epochs and request sequences keep late responses from reopening
 * or mutating an account after another lifecycle operation has taken over. Remote replacement
 * briefly closes its editor; authentication rejection requires fresh session verification.
 */
import {
  classifyTrainingStorageValue,
  createTrainingStoreAsync,
  serializePersistedTrainingStateV10,
  type TrainingStoreApi,
  type StateStorage,
} from '@kendo-menu/store';
import type { DashboardEntry } from '@kendo-menu/domain';

import {
  AccountStorageError,
  createAccountStorage,
  type AccountCacheVersion,
  type AccountDatabase,
  type AccountStorageController,
  type AccountStorageFailureCode,
} from './account-storage';
import {
  type AccountApiClient,
  type AccountSession,
  type DashboardSnapshot,
  type DashboardReadResponse,
  type AdoptionRequest,
  type AdoptionResponse,
  type SessionResult,
  isRevision,
  isTimestamp,
} from './account-api';
import {
  createIndexedDbAccountDatabase,
  type AccountAdoptionRequest,
  type AuthoritativeAdoptionCompletion,
  type AccountSyncState,
  type AccountSynchronizationDatabase,
} from './account-database';
import {
  createAccountSynchronizer,
  type AccountSynchronizationLockProvider,
  type AccountSynchronizationResult,
  inspectGuestAdoptionEligibility,
  withAccountSynchronizationLock,
} from './account-synchronization';
import {
  accountWorkspaceScope,
  type WorkspaceCoordinator,
  withGuestWorkspaceLock,
} from './workspace-coordination';

export type AdoptionWorkspaceState =
  | { readonly status: 'none' }
  | { readonly status: 'checking' }
  | { readonly status: 'offer'; readonly entryCount: number }
  | { readonly status: 'submitting'; readonly decision: 'yes' | 'no' }
  | { readonly status: 'completing'; readonly decision: 'yes' | 'no' }
  | { readonly status: 'retryable'; readonly decision?: 'yes' | 'no' }
  | { readonly status: 'storage-recovery'; readonly decisionConfirmed: boolean };

type AdoptionProof =
  | { readonly kind: 'response'; readonly response: AdoptionResponse }
  | { readonly kind: 'session'; readonly session: AccountSession };

// Internal composition only. Public routes deliberately do not instantiate this controller.

interface UnconfirmedWorkspaceEdits {
  readonly recoveryId: string;
  readonly entries: readonly DashboardEntry[];
  readonly baseline: string | null | undefined;
  readonly baselineVersion: AccountCacheVersion | null | undefined;
}

// A provider can be remounted after an IndexedDB write fails. Keep every distinct in-memory edit
// and its last confirmed cache value until a fresh session check opens that exact account/cache.
const editsRetainedAcrossDisposal = new Map<string, readonly UnconfirmedWorkspaceEdits[]>();
let disposalRecoverySequence = 0;
const DISPOSAL_RECOVERY_PAGE_SIZE = 20;

const createUnconfirmedWorkspaceEdits = (
  entries: readonly DashboardEntry[],
  baseline: string | null | undefined,
  baselineVersion: AccountCacheVersion | null | undefined,
): UnconfirmedWorkspaceEdits => ({
  recoveryId: `retained-${(++disposalRecoverySequence).toString(36)}`,
  entries,
  baseline,
  baselineVersion,
});

const sameCacheVersion = (
  left: AccountCacheVersion | null | undefined,
  right: AccountCacheVersion | null | undefined,
): boolean =>
  left === right ||
  (left !== null &&
    left !== undefined &&
    right !== null &&
    right !== undefined &&
    left.identity === right.identity &&
    left.generation === right.generation);

const hasUnconfirmedWorkspaceContent = (
  entries: readonly DashboardEntry[],
  baseline: string | null | undefined,
): boolean => {
  try {
    return serializePersistedTrainingStateV10({ dashboardEntries: entries }) !== baseline;
  } catch {
    // Keep data when it cannot be compared safely with the last durable value.
    return true;
  }
};

const sameUnconfirmedEdit = (
  left: UnconfirmedWorkspaceEdits,
  right: UnconfirmedWorkspaceEdits,
): boolean => {
  if (
    left.baseline !== right.baseline ||
    !sameCacheVersion(left.baselineVersion, right.baselineVersion)
  )
    return false;
  try {
    return (
      serializePersistedTrainingStateV10({ dashboardEntries: left.entries }) ===
      serializePersistedTrainingStateV10({ dashboardEntries: right.entries })
    );
  } catch {
    return false;
  }
};

const retainDisposalEdits = (userId: string, edits: UnconfirmedWorkspaceEdits): void => {
  const current = editsRetainedAcrossDisposal.get(userId) ?? [];
  if (current.some((candidate) => sameUnconfirmedEdit(candidate, edits))) return;
  editsRetainedAcrossDisposal.set(userId, [...current, edits]);
};

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
  | { readonly mode: 'guest-refreshing'; readonly epoch: number; readonly failed: boolean }
  | { readonly mode: 'adoption-completing'; readonly epoch: number }
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
      readonly persistencePending: boolean;
      readonly recoveryFailure: AccountStorageFailureCode | null;
      readonly serverRevocationConfirmed: boolean;
      readonly adoption: AdoptionWorkspaceState;
    }
  | {
      readonly mode: 'account-error';
      readonly epoch: number;
      readonly userId: string;
      readonly session: AccountSession;
      readonly storageFailure: AccountStorageFailureCode;
    }
  | { readonly mode: 'disposed'; readonly epoch: number };

export interface AccountWorkspaceOptions {
  readonly guestStore: TrainingStoreApi;
  readonly api: Pick<AccountApiClient, 'getSession' | 'logout' | 'postAdoption'>;
  readonly storage: StateStorage;
  readonly coordination: WorkspaceCoordinator;
  /** Provider-owned guest snapshot reads and coordinated guest-store refreshes. */
  readonly guestCleanup?: {
    readonly readRaw: () => string | null | Promise<string | null>;
    readonly prepare: () => void | Promise<void>;
    readonly refreshFromRaw: (
      rawValue: string | null,
      options: { readonly durableWrites: boolean },
    ) => void | Promise<void>;
  };
  readonly database?: AccountDatabase;
  readonly synchronization?: {
    readonly api: Pick<AccountApiClient, 'getDashboard' | 'putDashboard' | 'postAdoption'>;
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
  synchronizationDatabase?: AccountSynchronizationDatabase;
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
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  let epoch = 0;
  let requestSequence = 0;
  let disposed = false;
  let active: ActiveWorkspace | undefined;
  let adoptionState: AdoptionWorkspaceState = { status: 'none' };
  let offeredGuestSnapshot: string | undefined;
  let adoptionRecoveryAccountId: string | undefined;
  let adoptionCompletionPending = false;
  const adoptionSessionOverrides = new Map<string, AccountSession>();
  let pendingAdoptionResume: AccountSession | undefined;
  let adoptionOperation = 0;
  const withAdoptionTimeout = async <T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const abort = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        abort.abort();
        reject(new Error('Adoption request timed out.'));
      }, 10_000);
    });
    try {
      // A transport or test double may ignore AbortSignal; the race still releases the
      // account lock and leaves the durable request available for a verified retry.
      return await Promise.race([work(abort.signal), timeout]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  };
  let guestStore = options.guestStore;
  let guestRefreshPending = false;
  let guestRefreshFailed = false;
  let authenticationReverificationRequired = false;
  let authenticationRecoverySession: AccountSession | undefined;
  let verifiedStorageFailure:
    { readonly session: AccountSession; readonly code: AccountStorageFailureCode } | undefined;
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
  let disposalTask: Promise<void> = Promise.resolve();
  let exitIntent:
    { readonly workspace: ActiveWorkspace; readonly kind: 'logout' | 'hide' } | undefined;
  // A failed durable write must not discard edits when authentication changes. This holds
  // only the existing immutable state references (no extra LocalStorage payload), with no
  // store/actions/writer, and is considered only after fresh verification of that same ID.
  const unconfirmedEdits = new Map<string, UnconfirmedWorkspaceEdits>();
  // Once recovery has exposed a copy ID, later disposals may only append to its view. This
  // preserves download links and cursors even when another controller retains a duplicate.
  const recoveryViews = new Map<
    string,
    { readonly copies: UnconfirmedWorkspaceEdits[]; readonly observedIds: Set<string> }
  >();

  const cancelRequests = () => {
    requestSequence += 1;
    request?.abort();
    request = undefined;
  };

  const getDisposalRecoveryScope = () => {
    if (disposed) return undefined;
    const workspace = active;
    if (workspace !== undefined) {
      if (authenticationReverificationRequired) return undefined;
      return {
        userId: workspace.userId,
        isCurrent: () => !disposed && !authenticationReverificationRequired && active === workspace,
      };
    }
    const failure = verifiedStorageFailure;
    // A dashboard rejection keeps edits hidden until a fresh session response. Once that
    // response has verified an account but opening its cache fails, that verified account's
    // recovery copies remain available even though authentication recovery is still pending.
    if (failure !== undefined) {
      return {
        userId: failure.session.userId,
        isCurrent: () => !disposed && active === undefined && verifiedStorageFailure === failure,
      };
    }
    return undefined;
  };

  const getRecoveryCopies = (userId: string): readonly UnconfirmedWorkspaceEdits[] => {
    let view = recoveryViews.get(userId);
    if (view === undefined) {
      view = { copies: [], observedIds: new Set<string>() };
      recoveryViews.set(userId, view);
    }
    const candidates = [
      ...(editsRetainedAcrossDisposal.get(userId) ?? []),
      ...(unconfirmedEdits.has(userId) ? [unconfirmedEdits.get(userId)] : []),
    ].filter((candidate): candidate is UnconfirmedWorkspaceEdits => candidate !== undefined);
    for (const candidate of candidates) {
      if (view.observedIds.has(candidate.recoveryId)) continue;
      view.observedIds.add(candidate.recoveryId);
      if (!view.copies.some((prior) => sameUnconfirmedEdit(prior, candidate))) {
        view.copies.push(candidate);
      }
    }
    return view.copies;
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
        const entries = previous.store.getState().dashboardEntries;
        const baseline = previous.storage.confirmedCacheValue;
        if (hasUnconfirmedWorkspaceContent(entries, baseline)) {
          unconfirmedEdits.set(
            previous.userId,
            createUnconfirmedWorkspaceEdits(
              entries,
              baseline,
              previous.storage.confirmedCacheVersion,
            ),
          );
        }
      }
      previous.unsubscribe();
      previous.unsubscribeStore?.();
      previous.synchronizer?.stop();
      previous.storage.disable();
      // Captured old store references no longer expose a hidden dashboard. Its disabled
      // persistence adapter must not overwrite the retained cache with this empty state.
      previous.store.setState({ dashboardEntries: [] });
    }
    // Subscribers derive the content-free retained-edit warning from this controller. Notify
    // only after the hidden copy has been installed and the active account has been removed.
    notify();
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

  const workspaceIsCurrent = (workspace: ActiveWorkspace): boolean =>
    !disposed && active === workspace && workspace.epoch === epoch;

  const setAdoptionState = (state: AdoptionWorkspaceState): void => {
    adoptionState = state;
    if (state.status === 'none') active?.synchronizer?.schedule();
    notify();
  };

  const queueCompletionSynchronization = (): void => {
    const reopened = active;
    if (reopened === undefined) return;
    // Completion may still be returning from the exclusive account Web Lock.
    // Queue the cloud check after that caller releases the non-reentrant lock.
    setTimeout(() => {
      if (
        workspaceIsCurrent(reopened) &&
        adoptionState.status === 'none' &&
        !adoptionCompletionPending
      ) {
        reopened.synchronizer?.schedule();
      }
    }, 0);
  };

  const applyDurableDecline = (
    session: AccountSession,
    state: AccountSyncState | undefined,
  ): AccountSession => {
    const acknowledgement = state?.acknowledgement;
    if (
      acknowledgement?.status !== 'adoption-declined' ||
      acknowledgement.accountWorkspaceId !== session.userId
    )
      return session;
    return {
      ...session,
      adoption: {
        status: 'declined',
        capability: false,
        completion: { decision: 'no', requestId: acknowledgement.requestId },
      },
    };
  };

  const hasPotentialAdoptionCompletion = (state: AccountSyncState | undefined): boolean =>
    state !== undefined &&
    state.pendingRequest === null &&
    (state.acknowledgement.status === 'adoption-declined' ||
      (state.acknowledgement.status === 'acknowledged' && state.acknowledgement.revision !== '0'));

  const reopenPeerDashboardSave = async (
    workspace: ActiveWorkspace,
    session: AccountSession,
    state: AccountSyncState,
  ): Promise<'unchanged' | 'reopened' | 'blocked'> => {
    const cache = state.cache;
    const localVersion = workspace.storage.confirmedCacheVersion;
    if (
      cache !== null &&
      localVersion?.identity === cache.identity &&
      localVersion.generation === cache.generation &&
      workspace.storage.confirmedCacheValue === cache.cacheValue
    )
      return 'unchanged';

    const acknowledgement = state.acknowledgement;
    const empty = serializePersistedTrainingStateV10({ dashboardEntries: [] });
    const safeOrdinarySave =
      session.adoption.status === 'unavailable' &&
      state.pendingRequest === null &&
      state.activeConflict === null &&
      cache !== null &&
      cache.accountId === workspace.userId &&
      cache.generation > 0 &&
      acknowledgement.status === 'acknowledged' &&
      acknowledgement.accountWorkspaceId === workspace.userId &&
      acknowledgement.requestId !== null &&
      isRevision(acknowledgement.revision) &&
      acknowledgement.revision !== '0' &&
      acknowledgement.updatedAt !== null &&
      isTimestamp(acknowledgement.updatedAt) &&
      acknowledgement.cacheIdentity === cache.identity &&
      acknowledgement.generation === cache.generation &&
      localVersion?.generation === 0 &&
      workspace.storage.confirmedCacheValue === empty &&
      serializePersistedTrainingStateV10({
        dashboardEntries: workspace.store.getState().dashboardEntries,
      }) === empty;
    if (!safeOrdinarySave) {
      verifiedStorageFailure = { session, code: 'unavailable' };
      setAdoptionState({ status: 'storage-recovery', decisionConfirmed: false });
      deactivate(true);
      return 'blocked';
    }

    pendingAdoptionResume = session;
    adoptionCompletionPending = true;
    deactivate();
    const reopened = await controller.bootstrap();
    if (reopened.status === 'ready') {
      try {
        const latest = await workspace.synchronizationDatabase?.readSyncState(workspace.userId);
        if (
          latest === undefined ||
          latest.pendingRequest !== null ||
          latest.cache?.identity !== cache.identity ||
          latest.cache.generation !== cache.generation ||
          JSON.stringify(latest.acknowledgement) !== JSON.stringify(acknowledgement)
        ) {
          verifiedStorageFailure = { session, code: 'unavailable' };
          deactivate(true);
        }
      } catch {
        verifiedStorageFailure = { session, code: 'unavailable' };
        deactivate(true);
      }
    }
    if (
      reopened.status === 'retryable' &&
      active === undefined &&
      verifiedStorageFailure === undefined
    )
      verifiedStorageFailure = { session, code: 'unavailable' };
    adoptionCompletionPending = false;
    queueCompletionSynchronization();
    notify();
    return reopened.status === 'ready' && active?.userId === workspace.userId
      ? 'reopened'
      : 'blocked';
  };

  const resumePendingDashboardPut = async (
    workspace: ActiveWorkspace,
    session: AccountSession,
    state: AccountSyncState,
  ): Promise<'open' | 'reopened' | 'blocked'> => {
    const pending = state.pendingRequest;
    if (pending?.kind !== 'dashboard-put') return 'blocked';
    const cache = state.cache;
    const localVersion = workspace.storage.confirmedCacheVersion;
    const pendingCacheValue = serializePersistedTrainingStateV10({
      dashboardEntries: pending.request.dashboard.state.dashboardEntries,
    });
    if (
      cache === null ||
      cache.accountId !== workspace.userId ||
      pending.accountId !== workspace.userId ||
      pending.request.expectedAccountWorkspaceId !== workspace.userId ||
      pending.request.expectedRevision !== '0' ||
      pending.cacheVersion.identity !== cache.identity ||
      pending.cacheVersion.generation > cache.generation ||
      (pending.cacheVersion.generation === cache.generation &&
        pendingCacheValue !== cache.cacheValue) ||
      state.activeConflict !== null
    ) {
      setAdoptionState({ status: 'storage-recovery', decisionConfirmed: false });
      return 'blocked';
    }
    if (
      cache.identity !== localVersion?.identity ||
      cache.generation !== localVersion.generation ||
      cache.cacheValue !== workspace.storage.confirmedCacheValue
    ) {
      const empty = serializePersistedTrainingStateV10({ dashboardEntries: [] });
      const safePeerPending =
        localVersion?.generation === 0 &&
        workspace.storage.confirmedCacheValue === empty &&
        serializePersistedTrainingStateV10({
          dashboardEntries: workspace.store.getState().dashboardEntries,
        }) === empty;
      if (!safePeerPending) {
        setAdoptionState({ status: 'storage-recovery', decisionConfirmed: false });
        return 'blocked';
      }
      // A stale offered tab may still hold the untouched generation-zero cache while another
      // tab has durably prepared the ordinary write. Reopen the exactly bound shared cache so
      // the existing request can replay without manufacturing an adoption choice.
      pendingAdoptionResume = session;
      adoptionCompletionPending = true;
      deactivate();
      const reopened = await controller.bootstrap();
      adoptionCompletionPending = false;
      queueCompletionSynchronization();
      notify();
      return reopened.status === 'ready' &&
        active?.userId === workspace.userId &&
        adoptionState.status === 'none'
        ? 'reopened'
        : 'blocked';
    }
    workspace.session = session;
    workspace.synchronizer?.updateSession(session);
    offeredGuestSnapshot = undefined;
    adoptionRecoveryAccountId = undefined;
    setAdoptionState({ status: 'none' });
    return 'open';
  };

  const resolveUnavailableAdoption = async (
    workspace: ActiveWorkspace,
    session: AccountSession,
    state: AccountSyncState,
  ): Promise<'open' | 'reopened' | 'blocked'> => {
    if (session.adoption.status !== 'unavailable' || state.pendingRequest?.kind === 'adoption')
      return 'blocked';
    if (state.pendingRequest?.kind === 'dashboard-put') {
      return resumePendingDashboardPut(workspace, session, state);
    }
    const peer = await reopenPeerDashboardSave(workspace, session, state);
    if (peer !== 'unchanged') return peer;
    if (!workspaceIsCurrent(workspace)) return 'blocked';
    workspace.session = session;
    workspace.synchronizer?.updateSession(session);
    offeredGuestSnapshot = undefined;
    adoptionRecoveryAccountId = undefined;
    setAdoptionState({ status: 'none' });
    return 'open';
  };

  const readGuestSnapshot = async (
    accountId: string,
    catalogueVersion: string,
  ): Promise<{
    readonly canonical: string;
    readonly entryCount: number;
    readonly dashboard: DashboardSnapshot;
  } | null> => {
    let raw: string | null;
    try {
      // Read the durable guest value inside guest coordination. The guest store's writer
      // tracks an older expected value and can reject a legitimate edit from another tab.
      raw = await (options.guestCleanup === undefined
        ? options.storage.getItem('kendo-menu')
        : options.guestCleanup.readRaw());
    } catch {
      throw new Error('GUEST_READ_FAILED');
    }
    const eligibility = inspectGuestAdoptionEligibility(raw, accountId, catalogueVersion);
    if (eligibility.status !== 'eligible') return null;
    const inspected = classifyTrainingStorageValue(raw);
    if (inspected.status !== 'ready' && inspected.status !== 'migrated') return null;
    try {
      return {
        canonical: serializePersistedTrainingStateV10(inspected.state),
        entryCount: eligibility.dashboard.state.dashboardEntries.length,
        dashboard: eligibility.dashboard,
      };
    } catch {
      return null;
    }
  };

  const verifyAdoptionSession = async (
    workspace: ActiveWorkspace,
  ): Promise<AccountSession | null> => {
    let result: SessionResult;
    try {
      result = await options.api.getSession();
    } catch (error) {
      // A 401 is an authoritative identity transition. Other failures remain retryable and
      // keep the verified workspace protected behind the adoption recovery UI.
      if (isUnauthenticated(error) && workspaceIsCurrent(workspace)) {
        authenticationReverificationRequired = true;
        authenticationRecoverySession = workspace.session;
        deactivate(true);
      }
      return null;
    }
    if (!workspaceIsCurrent(workspace)) return null;
    if (result.status !== 'authenticated' || result.session.userId !== workspace.userId) {
      authenticationReverificationRequired = true;
      authenticationRecoverySession = workspace.session;
      deactivate(true);
      return null;
    }
    workspace.session = result.session;
    workspace.synchronizer?.updateSession(result.session);
    notify();
    return result.session;
  };

  const hasMatchingTerminalReceipt = (
    session: AccountSession,
    request: AdoptionRequest,
  ): boolean => {
    if (session.userId !== request.expectedAccountWorkspaceId) return false;
    if (request.decision === 'no') {
      return (
        session.adoption.status === 'declined' &&
        session.adoption.completion.decision === 'no' &&
        session.adoption.completion.requestId === request.requestId
      );
    }
    return (
      session.adoption.status === 'accepted' &&
      session.adoption.completion.decision === 'yes' &&
      session.adoption.completion.requestId === request.requestId &&
      session.adoption.completion.acknowledgedRevision === '1' &&
      session.adoption.completion.timestamp.length > 0
    );
  };

  const hasTerminalAdoptionDecision = (session: AccountSession): boolean =>
    session.adoption.status === 'accepted' || session.adoption.status === 'declined';

  const reopenPeerCompletion = async (
    workspace: ActiveWorkspace,
    session: AccountSession,
    state: AccountSyncState,
  ): Promise<'not-completed' | 'reopened' | 'blocked'> => {
    if (state.pendingRequest !== null) return 'not-completed';
    const terminal = session.adoption;
    const acknowledgement = state.acknowledgement;
    if (terminal.status !== 'accepted' && terminal.status !== 'declined') return 'not-completed';
    if (acknowledgement.status !== 'acknowledged' && acknowledgement.status !== 'adoption-declined')
      return 'not-completed';
    const cache = state.cache;
    const localVersion = workspace.storage.confirmedCacheVersion;
    const empty = serializePersistedTrainingStateV10({ dashboardEntries: [] });
    const localUntouched =
      localVersion !== null &&
      localVersion !== undefined &&
      localVersion.generation === 0 &&
      workspace.storage.confirmedCacheValue === empty &&
      serializePersistedTrainingStateV10({
        dashboardEntries: workspace.store.getState().dashboardEntries,
      }) === empty;
    const commonValid =
      cache !== null &&
      cache.accountId === workspace.userId &&
      acknowledgement.accountWorkspaceId === workspace.userId &&
      acknowledgement.cacheIdentity === cache.identity &&
      acknowledgement.generation === cache.generation &&
      state.activeConflict === null;
    const acceptedValid =
      terminal.status === 'accepted' &&
      acknowledgement.status === 'acknowledged' &&
      cache?.generation === 1 &&
      isRevision(acknowledgement.revision) &&
      BigInt(acknowledgement.revision) >= BigInt(terminal.completion.acknowledgedRevision) &&
      isTimestamp(acknowledgement.updatedAt) &&
      (acknowledgement.revision !== terminal.completion.acknowledgedRevision ||
        (acknowledgement.requestId === terminal.completion.requestId &&
          acknowledgement.updatedAt === terminal.completion.timestamp));
    const declinedValid =
      terminal.status === 'declined' &&
      acknowledgement.status === 'adoption-declined' &&
      acknowledgement.requestId === terminal.completion.requestId &&
      cache?.generation === 0 &&
      cache.cacheValue === empty &&
      cache.identity === localVersion?.identity;
    if (!localUntouched || !commonValid || (!acceptedValid && !declinedValid)) {
      verifiedStorageFailure = { session, code: 'unavailable' };
      setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
      deactivate(true);
      return 'blocked';
    }
    adoptionSessionOverrides.set(workspace.userId, session);
    pendingAdoptionResume = session;
    adoptionCompletionPending = true;
    deactivate();
    offeredGuestSnapshot = undefined;
    adoptionRecoveryAccountId = undefined;
    adoptionState = { status: 'none' };
    const reopened = await controller.bootstrap();
    if (reopened.status === 'ready') {
      try {
        const latest = await workspace.synchronizationDatabase?.readSyncState(workspace.userId);
        if (
          latest === undefined ||
          latest.pendingRequest !== null ||
          latest.cache?.identity !== cache.identity ||
          latest.cache.generation !== cache.generation ||
          JSON.stringify(latest.acknowledgement) !== JSON.stringify(acknowledgement)
        ) {
          verifiedStorageFailure = { session, code: 'unavailable' };
          deactivate(true);
        }
      } catch {
        verifiedStorageFailure = { session, code: 'unavailable' };
        deactivate(true);
      }
    }
    adoptionCompletionPending = false;
    queueCompletionSynchronization();
    notify();
    return reopened.status === 'ready' && active !== undefined ? 'reopened' : 'blocked';
  };

  const reconcileTerminalSession = async (
    workspace: ActiveWorkspace,
    pendingRequest: AdoptionRequest,
    terminalSession: AccountSession,
    verificationSequence: number,
  ): Promise<boolean> => {
    if (
      !workspaceIsCurrent(workspace) ||
      requestSequence !== verificationSequence ||
      terminalSession.userId !== pendingRequest.expectedAccountWorkspaceId
    ) {
      return false;
    }
    const terminal = terminalSession.adoption;
    if (terminal.status !== 'accepted' && terminal.status !== 'declined') return false;

    let existing: AccountSyncState | undefined;
    try {
      existing = await workspace.synchronizationDatabase?.readSyncState(workspace.userId);
    } catch {
      if (workspaceIsCurrent(workspace) && requestSequence === verificationSequence) {
        verifiedStorageFailure = { session: terminalSession, code: 'unavailable' };
        setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
        deactivate(true);
      }
      return false;
    }
    if (!workspaceIsCurrent(workspace) || requestSequence !== verificationSequence) return false;
    if (existing !== undefined) {
      const peer = await reopenPeerCompletion(workspace, terminalSession, existing);
      if (peer !== 'not-completed') return peer === 'reopened';
    }

    // Keep the original request's matching idempotent receipt fast path. A different request
    // ID or opposite terminal choice belongs to the server's winning tab and is reconciled
    // from that authoritative receipt instead.
    if (
      terminal.status === 'declined' &&
      hasMatchingTerminalReceipt(terminalSession, pendingRequest)
    ) {
      return finishPendingAdoption(workspace, pendingRequest, terminalSession, {
        kind: 'session',
        session: terminalSession,
      });
    }
    const database = workspace.synchronizationDatabase;
    if (database === undefined) return false;
    const reconciliationId = ++adoptionOperation;
    const reconciliationIsCurrent = () =>
      workspaceIsCurrent(workspace) &&
      requestSequence === verificationSequence &&
      reconciliationId === adoptionOperation;

    let completion: AuthoritativeAdoptionCompletion;
    if (terminal.status === 'declined') {
      completion = {
        decision: 'no',
        requestId: terminal.completion.requestId,
      };
    } else {
      let cloud: DashboardReadResponse | undefined;
      try {
        const syncApi = options.synchronization?.api;
        cloud =
          syncApi === undefined
            ? undefined
            : await withAdoptionTimeout((signal) =>
                syncApi.getDashboard(terminalSession.userId, signal),
              );
      } catch {
        if (reconciliationIsCurrent()) {
          verifiedStorageFailure = { session: terminalSession, code: 'unavailable' };
          setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
          deactivate(true);
        }
        return false;
      }
      if (
        !reconciliationIsCurrent() ||
        cloud === undefined ||
        cloud.accountWorkspaceId !== terminalSession.userId ||
        cloud.dashboard === null ||
        !isRevision(cloud.revision) ||
        !isTimestamp(cloud.updatedAt) ||
        BigInt(cloud.revision) < BigInt(terminal.completion.acknowledgedRevision) ||
        (cloud.revision === terminal.completion.acknowledgedRevision &&
          cloud.updatedAt !== terminal.completion.timestamp)
      ) {
        if (reconciliationIsCurrent()) {
          verifiedStorageFailure = { session: terminalSession, code: 'unavailable' };
          setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
          deactivate(true);
        }
        return false;
      }
      // Fetching the snapshot can take time. Reverify identity and terminal receipt before
      // allowing the account-scoped transaction to reconcile either local record.
      const refreshedSession = await verifyAdoptionSession(workspace);
      if (
        refreshedSession === null ||
        !reconciliationIsCurrent() ||
        refreshedSession.userId !== terminalSession.userId ||
        refreshedSession.adoption.status !== 'accepted' ||
        refreshedSession.adoption.completion.requestId !== terminal.completion.requestId ||
        refreshedSession.adoption.completion.acknowledgedRevision !==
          terminal.completion.acknowledgedRevision ||
        refreshedSession.adoption.completion.timestamp !== terminal.completion.timestamp
      ) {
        if (reconciliationIsCurrent()) {
          verifiedStorageFailure = { session: terminalSession, code: 'unavailable' };
          setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
          deactivate(true);
        }
        return false;
      }
      completion = {
        decision: 'yes',
        requestId: refreshedSession.adoption.completion.requestId,
        acknowledgedRevision: refreshedSession.adoption.completion.acknowledgedRevision,
        timestamp: refreshedSession.adoption.completion.timestamp,
        cloud,
      };
      terminalSession = refreshedSession;
    }

    adoptionRecoveryAccountId = terminalSession.userId;
    if (!reconciliationIsCurrent()) return false;
    setAdoptionState({ status: 'completing', decision: completion.decision });
    try {
      const reconciled = await database.reconcileAuthoritativeAdoption(
        terminalSession.userId,
        completion,
      );
      if (!reconciliationIsCurrent()) return false;
      if (reconciled.status !== 'committed' || reconciled.state.pendingRequest !== null) {
        if (reconciled.state.pendingRequest === null) {
          const peer = await reopenPeerCompletion(workspace, terminalSession, reconciled.state);
          if (peer === 'reopened') return true;
          if (peer === 'blocked') return false;
        }
        verifiedStorageFailure = { session: terminalSession, code: 'unavailable' };
        setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
        deactivate(true);
        return false;
      }
      const completedSession: AccountSession = {
        ...terminalSession,
        adoption:
          completion.decision === 'yes'
            ? {
                status: 'accepted',
                capability: false,
                completion: {
                  decision: 'yes',
                  requestId: completion.requestId,
                  acknowledgedRevision: completion.acknowledgedRevision,
                  timestamp: completion.timestamp,
                },
              }
            : {
                status: 'declined',
                capability: false,
                completion: { decision: 'no', requestId: completion.requestId },
              },
      };
      workspace.session = completedSession;
      workspace.synchronizer?.updateSession(completedSession);
      adoptionSessionOverrides.set(workspace.userId, completedSession);
      pendingAdoptionResume = completedSession;
      adoptionCompletionPending = true;
      deactivate();
      verifiedStorageFailure = undefined;
      adoptionRecoveryAccountId = undefined;
      offeredGuestSnapshot = undefined;
      adoptionState = { status: 'none' };
      const reopened = await controller.bootstrap();
      adoptionCompletionPending = false;
      queueCompletionSynchronization();
      notify();
      return reopened.status === 'ready';
    } catch {
      if (reconciliationIsCurrent()) {
        verifiedStorageFailure = { session: terminalSession, code: 'unavailable' };
        setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
        deactivate(true);
      }
      return false;
    }
  };

  const responseMatchesRequest = (response: AdoptionResponse, request: AdoptionRequest): boolean =>
    response.completion.decision === request.decision &&
    response.completion.requestId === request.requestId &&
    (request.decision === 'no'
      ? response.status === 'declined' || response.status === 'replayed'
      : (response.status === 'accepted' || response.status === 'replayed') &&
        response.completion.decision === 'yes' &&
        response.completion.acknowledgedRevision === '1' &&
        response.completion.timestamp.length > 0);

  const finishPendingAdoption = async (
    workspace: ActiveWorkspace,
    request: AdoptionRequest,
    verifiedSession: AccountSession,
    proof: AdoptionProof,
  ): Promise<boolean> => {
    if (
      !workspaceIsCurrent(workspace) ||
      verifiedSession.userId !== request.expectedAccountWorkspaceId
    )
      return false;
    if (
      proof.kind === 'response'
        ? !responseMatchesRequest(proof.response, request)
        : proof.session.userId !== verifiedSession.userId ||
          !hasMatchingTerminalReceipt(proof.session, request)
    )
      return false;
    const database = workspace.synchronizationDatabase;
    if (database === undefined) return false;
    let acknowledgedRevision: string | undefined;
    let timestamp: string | undefined;
    if (request.decision === 'yes') {
      if (proof.kind === 'response' && proof.response.completion.decision === 'yes') {
        acknowledgedRevision = proof.response.completion.acknowledgedRevision;
        timestamp = proof.response.completion.timestamp;
      } else if (proof.kind === 'session' && proof.session.adoption.status === 'accepted') {
        acknowledgedRevision = proof.session.adoption.completion.acknowledgedRevision;
        timestamp = proof.session.adoption.completion.timestamp;
      }
      if (acknowledgedRevision !== '1' || timestamp === undefined || timestamp.length === 0)
        return false;
    }
    const completedSession: AccountSession = {
      ...verifiedSession,
      adoption:
        request.decision === 'yes'
          ? {
              status: 'accepted',
              capability: false,
              completion: {
                decision: 'yes',
                requestId: request.requestId,
                acknowledgedRevision: acknowledgedRevision ?? '1',
                timestamp: timestamp ?? '',
              },
            }
          : {
              status: 'declined',
              capability: false,
              completion: { decision: 'no', requestId: request.requestId },
            },
    };
    // A matching POST response is authoritative even if /api/session has not reflected it yet.
    // Refresh the synchronizer before the workspace is reopened so it cannot remain paused.
    workspace.session = completedSession;
    workspace.synchronizer?.updateSession(completedSession);
    adoptionSessionOverrides.set(workspace.userId, completedSession);
    const requestGeneration = ++adoptionOperation;
    const verificationSequence = requestSequence;
    adoptionRecoveryAccountId = workspace.userId;
    setAdoptionState({ status: 'completing', decision: request.decision });
    // The provider renders the dedicated completing state, so no editor can race this
    // transaction. Keep this controller snapshot blocked across the cache reopen as well.
    try {
      let completed;
      if (request.decision === 'yes') {
        completed = await database.completeAcceptedAdoption(
          request.expectedAccountWorkspaceId,
          request.requestId,
          acknowledgedRevision ?? '1',
          timestamp ?? '',
        );
      } else {
        completed = await database.acknowledgePendingRequest(
          request.expectedAccountWorkspaceId,
          request.requestId,
          { kind: 'adoption-declined', requestId: request.requestId },
        );
      }
      // A newer verification or exit owns the visible workspace, even when this
      // transaction committed for the former account while it was in flight.
      if (!workspaceIsCurrent(workspace) || requestSequence !== verificationSequence) return false;
      if (requestGeneration !== adoptionOperation) return false;
      if (completed.status !== 'committed' || completed.state.pendingRequest !== null) {
        if (completed.state.pendingRequest === null) {
          const refreshed = await verifyAdoptionSession(workspace);
          if (!workspaceIsCurrent(workspace) || requestSequence !== verificationSequence)
            return false;
          if (refreshed !== null) {
            const peer = await reopenPeerCompletion(
              workspace,
              refreshed.adoption.status === 'pending' && proof.kind === 'response'
                ? completedSession
                : refreshed,
              completed.state,
            );
            if (peer === 'reopened') return true;
            if (peer === 'blocked') return false;
          }
        }
        verifiedStorageFailure = { session: completedSession, code: 'unavailable' };
        setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
        deactivate(true);
        return false;
      }
      adoptionCompletionPending = true;
      pendingAdoptionResume = completedSession;
      deactivate();
      verifiedStorageFailure = undefined;
      adoptionRecoveryAccountId = undefined;
      offeredGuestSnapshot = undefined;
      adoptionState = { status: 'none' };
      const reopened = await controller.bootstrap();
      adoptionCompletionPending = false;
      queueCompletionSynchronization();
      notify();
      if (reopened.status !== 'ready') return false;
      return true;
    } catch {
      if (
        workspaceIsCurrent(workspace) &&
        requestSequence === verificationSequence &&
        requestGeneration === adoptionOperation
      ) {
        verifiedStorageFailure = { session: completedSession, code: 'unavailable' };
        setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
        deactivate(true);
      }
      return false;
    }
  };

  const recoverOrReplayPendingAdoption = async (
    workspace: ActiveWorkspace,
    request: AdoptionRequest,
  ): Promise<boolean> => {
    if (!workspaceIsCurrent(workspace)) return false;
    const verificationSequence = requestSequence;
    const session = await verifyAdoptionSession(workspace);
    if (
      session === null ||
      !workspaceIsCurrent(workspace) ||
      requestSequence !== verificationSequence
    )
      return false;
    if (session.adoption.status === 'accepted' || session.adoption.status === 'declined') {
      return reconcileTerminalSession(workspace, request, session, verificationSequence);
    }
    if (
      session.adoption.status !== 'pending' ||
      !session.adoption.capability ||
      session.userId !== request.expectedAccountWorkspaceId
    ) {
      return false;
    }
    const database = workspace.synchronizationDatabase;
    if (database === undefined) return false;
    const locked = await withAccountSynchronizationLock(
      workspace.userId,
      async () => submitStoredAdoptionUnderLock(workspace, request, verificationSequence),
      options.synchronization?.locks,
    );
    if (!workspaceIsCurrent(workspace) || requestSequence !== verificationSequence) return false;
    if (locked.status === 'unavailable') {
      setAdoptionState({ status: 'retryable', decision: request.decision });
      return false;
    }
    return locked.value;
  };

  const submitStoredAdoptionUnderLock = async (
    workspace: ActiveWorkspace,
    request: AdoptionRequest,
    expectedVerificationSequence: number,
  ): Promise<boolean> => {
    const stillCurrent = () =>
      workspaceIsCurrent(workspace) && requestSequence === expectedVerificationSequence;
    if (!stillCurrent()) return false;
    const operationId = ++adoptionOperation;
    setAdoptionState({ status: 'submitting', decision: request.decision });
    const verifiedBeforeSend = workspace.session;
    if (
      !stillCurrent() ||
      verifiedBeforeSend.userId !== request.expectedAccountWorkspaceId ||
      verifiedBeforeSend.adoption.status !== 'pending' ||
      !verifiedBeforeSend.adoption.capability
    ) {
      if (stillCurrent()) setAdoptionState({ status: 'retryable', decision: request.decision });
      return false;
    }
    try {
      const response = await withAdoptionTimeout((signal) =>
        options.api.postAdoption(workspace.userId, request, signal),
      );
      if (!stillCurrent() || operationId !== adoptionOperation) return false;
      if (!responseMatchesRequest(response, request)) {
        setAdoptionState({ status: 'retryable', decision: request.decision });
        return false;
      }
      return finishPendingAdoption(workspace, request, verifiedBeforeSend, {
        kind: 'response',
        response,
      });
    } catch {
      if (!stillCurrent() || operationId !== adoptionOperation) return false;
      const verified = await verifyAdoptionSession(workspace);
      if (!stillCurrent()) return false;
      if (
        verified !== null &&
        (verified.adoption.status === 'accepted' || verified.adoption.status === 'declined')
      ) {
        return reconcileTerminalSession(workspace, request, verified, expectedVerificationSequence);
      }
      setAdoptionState({ status: 'retryable', decision: request.decision });
      return false;
    }
  };

  const checkAdoptionEligibility = async (workspace: ActiveWorkspace): Promise<void> => {
    const verificationSequence = requestSequence;
    const stillCurrent = () =>
      workspaceIsCurrent(workspace) && requestSequence === verificationSequence;
    if (!stillCurrent()) return;
    if (workspace.session.adoption.status !== 'pending' || !workspace.session.adoption.capability) {
      adoptionState = { status: 'none' };
      return;
    }
    setAdoptionState({ status: 'checking' });
    try {
      const locked = await withAccountSynchronizationLock(
        workspace.userId,
        async () => {
          const durableState = await workspace.synchronizationDatabase?.readSyncState(
            workspace.userId,
          );
          if (!stillCurrent()) return null;
          if (durableState?.pendingRequest?.kind === 'dashboard-put') {
            await resumePendingDashboardPut(workspace, workspace.session, durableState);
            return null;
          }
          const syncApi = options.synchronization?.api;
          const cloud =
            syncApi === undefined
              ? undefined
              : await withAdoptionTimeout((signal) =>
                  syncApi.getDashboard(workspace.userId, signal),
                );
          if (cloud === undefined || !stillCurrent()) return null;
          if (cloud.revision !== '0' || cloud.dashboard !== null) {
            const verified = await verifyAdoptionSession(workspace);
            if (!stillCurrent() || verified === null) return null;
            const latest = await workspace.synchronizationDatabase?.readSyncState(workspace.userId);
            if (!stillCurrent()) return null;
            if (latest?.pendingRequest?.kind === 'adoption') {
              setAdoptionState({
                status: 'retryable',
                decision: latest.pendingRequest.request.decision,
              });
              return null;
            }
            if (latest !== undefined && verified.adoption.status === 'unavailable') {
              await resolveUnavailableAdoption(workspace, verified, latest);
              return null;
            }
            if (latest !== undefined && hasPotentialAdoptionCompletion(latest)) {
              if (hasTerminalAdoptionDecision(verified)) {
                const peer = await reopenPeerCompletion(workspace, verified, latest);
                if (peer !== 'not-completed') return null;
              }
            }
            setAdoptionState({
              status: 'storage-recovery',
              decisionConfirmed:
                verified.adoption.status === 'accepted' || verified.adoption.status === 'declined',
            });
            return null;
          }
          return withGuestWorkspaceLock(options.coordination, async () => {
            if (!stillCurrent()) return null;
            const guest = await readGuestSnapshot(workspace.userId, cloud.catalogueVersion);
            return stillCurrent() ? guest : null;
          });
        },
        options.synchronization?.locks,
      );
      if (!stillCurrent()) return;
      if (locked.status === 'unavailable') {
        setAdoptionState({ status: 'retryable' });
        return;
      }
      if (adoptionState.status === 'storage-recovery' || adoptionState.status === 'retryable')
        return;
      const guest = locked.value;
      if (guest === null) {
        setAdoptionState({ status: 'none' });
        return;
      }
      offeredGuestSnapshot = guest.canonical;
      setAdoptionState({ status: 'offer', entryCount: guest.entryCount });
    } catch {
      if (stillCurrent())
        setAdoptionState({ status: 'storage-recovery', decisionConfirmed: false });
    }
  };

  const chooseAdoption = async (decision: 'yes' | 'no'): Promise<void> => {
    const workspace = active;
    if (workspace === undefined || !workspaceIsCurrent(workspace)) return;
    const verificationSequence = requestSequence;
    const stillCurrent = () =>
      workspaceIsCurrent(workspace) && requestSequence === verificationSequence;
    let pendingState;
    try {
      pendingState = await workspace.synchronizationDatabase?.readSyncState(workspace.userId);
    } catch {
      if (stillCurrent())
        setAdoptionState({ status: 'storage-recovery', decisionConfirmed: false });
      return;
    }
    if (!stillCurrent()) return;
    if (pendingState?.pendingRequest?.kind === 'dashboard-put') {
      const session = await verifyAdoptionSession(workspace);
      if (!stillCurrent() || session === null) return;
      if (session.adoption.status === 'unavailable') {
        await resolveUnavailableAdoption(workspace, session, pendingState);
      } else if (session.adoption.status === 'pending' && session.adoption.capability) {
        await resumePendingDashboardPut(workspace, session, pendingState);
      } else {
        setAdoptionState({ status: 'storage-recovery', decisionConfirmed: false });
      }
      return;
    }
    if (hasPotentialAdoptionCompletion(pendingState) && pendingState !== undefined) {
      const session = await verifyAdoptionSession(workspace);
      if (!stillCurrent() || session === null) return;
      if (hasTerminalAdoptionDecision(session)) {
        const peer = await reopenPeerCompletion(workspace, session, pendingState);
        if (peer !== 'not-completed') return;
        setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
      } else if (session.adoption.status === 'unavailable') {
        await resolveUnavailableAdoption(workspace, session, pendingState);
      } else {
        setAdoptionState({ status: 'storage-recovery', decisionConfirmed: false });
      }
      return;
    }
    if (pendingState?.pendingRequest?.kind === 'adoption') {
      setAdoptionState({
        status: 'retryable',
        decision: pendingState.pendingRequest.request.decision,
      });
      await recoverOrReplayPendingAdoption(workspace, pendingState.pendingRequest.request);
      return;
    }
    if (adoptionState.status !== 'offer' || offeredGuestSnapshot === undefined) return;
    if (workspace.session.adoption.status !== 'pending' || !workspace.session.adoption.capability) {
      setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
      return;
    }
    const database = workspace.synchronizationDatabase;
    if (database === undefined) {
      setAdoptionState({ status: 'storage-recovery', decisionConfirmed: false });
      return;
    }
    const displayedSnapshot = offeredGuestSnapshot;
    try {
      const locked = await withAccountSynchronizationLock(
        workspace.userId,
        async (): Promise<
          | { readonly status: 'refreshed' | 'ineligible' | 'pending' | 'storage' | 'terminal' }
          | { readonly status: 'prepared'; readonly request: AdoptionRequest }
          | { readonly status: 'finished'; readonly succeeded: boolean }
        > => {
          const verified = await verifyAdoptionSession(workspace);
          if (!stillCurrent() || verified === null) {
            return { status: 'ineligible' };
          }
          if (verified.adoption.status === 'accepted' || verified.adoption.status === 'declined') {
            // The server can become terminal after the offer's first shared-IDB read.
            // Recheck under the account lock before reopening this stale editor.
            const latest = await database.readSyncState(workspace.userId);
            if (!stillCurrent()) return { status: 'ineligible' };
            if (latest.pendingRequest?.kind === 'adoption') return { status: 'pending' };
            const peer = await reopenPeerCompletion(workspace, verified, latest);
            if (peer === 'not-completed') {
              setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
            }
            return { status: 'terminal' };
          }
          if (verified.adoption.status === 'unavailable') {
            const latest = await database.readSyncState(workspace.userId);
            if (!stillCurrent()) return { status: 'ineligible' };
            if (latest.pendingRequest?.kind === 'adoption') return { status: 'pending' };
            await resolveUnavailableAdoption(workspace, verified, latest);
            return { status: 'terminal' };
          }
          if (verified.adoption.status !== 'pending' || !verified.adoption.capability) {
            return { status: 'ineligible' };
          }
          const syncApi = options.synchronization?.api;
          const cloud =
            syncApi === undefined
              ? undefined
              : await withAdoptionTimeout((signal) =>
                  syncApi.getDashboard(workspace.userId, signal),
                );
          if (!stillCurrent()) return { status: 'ineligible' };
          if (cloud === undefined || cloud.revision !== '0' || cloud.dashboard !== null) {
            await verifyAdoptionSession(workspace);
            return { status: 'ineligible' };
          }
          const syncState = await database.readSyncState(workspace.userId);
          if (!stillCurrent()) return { status: 'ineligible' };
          if (syncState.pendingRequest !== null) return { status: 'pending' };
          const currentCache = syncState.cache;
          if (
            currentCache === null ||
            syncState.activeConflict !== null ||
            currentCache.generation !== 0 ||
            currentCache.cacheValue !== serializePersistedTrainingStateV10({ dashboardEntries: [] })
          ) {
            return { status: 'ineligible' };
          }
          if (decision === 'yes') {
            const prepared = await withGuestWorkspaceLock(options.coordination, async () => {
              const guest = await readGuestSnapshot(workspace.userId, cloud.catalogueVersion);
              if (!stillCurrent()) return { status: 'ineligible' as const };
              if (guest === null) return { status: 'ineligible' as const };
              if (guest.canonical !== displayedSnapshot) {
                offeredGuestSnapshot = guest.canonical;
                setAdoptionState({ status: 'offer', entryCount: guest.entryCount });
                return { status: 'refreshed' as const };
              }
              const requestId = globalThis.crypto.randomUUID();
              const request: AccountAdoptionRequest = {
                decision: 'yes',
                transportVersion: 1,
                expectedAccountWorkspaceId: workspace.userId,
                expectedRevision: '0',
                requestId,
                catalogueVersion: cloud.catalogueVersion,
                dashboard: guest.dashboard,
              };
              if (!stillCurrent()) return { status: 'ineligible' as const };
              const result = await database.preparePendingRequest(workspace.userId, currentCache, {
                kind: 'adoption',
                request,
              });
              return result.status === 'committed'
                ? { status: 'prepared' as const, request }
                : { status: 'storage' as const };
            });
            if (prepared.status === 'ineligible' || prepared.status === 'refreshed') {
              return { status: prepared.status };
            }
            if (prepared.status !== 'prepared') return { status: 'storage' };
            return {
              status: 'finished',
              succeeded: await submitStoredAdoptionUnderLock(
                workspace,
                prepared.request,
                verificationSequence,
              ),
            };
          }
          const requestId = globalThis.crypto.randomUUID();
          const request: AccountAdoptionRequest = {
            decision: 'no',
            transportVersion: 1,
            expectedAccountWorkspaceId: workspace.userId,
            requestId,
          };
          if (currentCache === null) return { status: 'storage' };
          if (!stillCurrent()) return { status: 'ineligible' };
          const result = await database.preparePendingRequest(workspace.userId, currentCache, {
            kind: 'adoption',
            request,
          });
          return result.status === 'committed'
            ? {
                status: 'finished',
                succeeded: await submitStoredAdoptionUnderLock(
                  workspace,
                  request,
                  verificationSequence,
                ),
              }
            : { status: 'storage' };
        },
        options.synchronization?.locks,
      );
      if (!stillCurrent()) return;
      if (locked.status === 'unavailable') {
        setAdoptionState({ status: 'retryable' });
        return;
      }
      if (locked.value.status === 'refreshed') return;
      if (locked.value.status === 'pending') {
        const state = await database.readSyncState(workspace.userId);
        if (!stillCurrent()) return;
        if (state.pendingRequest?.kind === 'adoption') {
          setAdoptionState({
            status: 'retryable',
            decision: state.pendingRequest.request.decision,
          });
          await recoverOrReplayPendingAdoption(workspace, state.pendingRequest.request);
        }
        return;
      }
      if (locked.value.status === 'ineligible') {
        // An ineligible offer can mean identity, cloud, or guest state changed while
        // preflighting. Keep editing closed until a fresh verified recovery resolves it.
        setAdoptionState({
          status: 'storage-recovery',
          decisionConfirmed: hasTerminalAdoptionDecision(workspace.session),
        });
        return;
      }
      if (locked.value.status === 'terminal') return;
      if (locked.value.status === 'storage') {
        setAdoptionState({ status: 'storage-recovery', decisionConfirmed: false });
        return;
      }
      // An ambiguous POST keeps its durable request and retry state. It never authorizes an
      // opposite choice or closes the account decision gate.
      if (locked.value.status === 'finished') return;
    } catch {
      if (stillCurrent())
        setAdoptionState({ status: 'storage-recovery', decisionConfirmed: false });
    }
  };

  const retryAdoption = async (): Promise<void> => {
    const workspace = active;
    if (workspace === undefined) {
      if (adoptionRecoveryAccountId !== undefined) {
        await controller.bootstrap();
      }
      return;
    }
    const verificationSequence = requestSequence;
    const stillCurrent = () =>
      workspaceIsCurrent(workspace) && requestSequence === verificationSequence;
    let state;
    try {
      state = await workspace.synchronizationDatabase?.readSyncState(workspace.userId);
    } catch {
      if (stillCurrent())
        setAdoptionState({ status: 'storage-recovery', decisionConfirmed: false });
      return;
    }
    if (!stillCurrent()) return;
    if (state?.pendingRequest?.kind === 'dashboard-put') {
      const session = await verifyAdoptionSession(workspace);
      if (!stillCurrent() || session === null) return;
      if (session.adoption.status === 'unavailable') {
        await resolveUnavailableAdoption(workspace, session, state);
      } else if (session.adoption.status === 'pending' && session.adoption.capability) {
        await resumePendingDashboardPut(workspace, session, state);
      } else {
        setAdoptionState({ status: 'storage-recovery', decisionConfirmed: false });
      }
      return;
    }
    if (hasPotentialAdoptionCompletion(state) && state !== undefined) {
      const session = await verifyAdoptionSession(workspace);
      if (!stillCurrent() || session === null) return;
      if (hasTerminalAdoptionDecision(session)) {
        const peer = await reopenPeerCompletion(workspace, session, state);
        if (peer !== 'not-completed') return;
        setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
        return;
      }
      if (session.adoption.status === 'unavailable') {
        await resolveUnavailableAdoption(workspace, session, state);
        return;
      }
    }
    if (state?.pendingRequest?.kind === 'adoption') {
      setAdoptionState({ status: 'retryable', decision: state.pendingRequest.request.decision });
      await recoverOrReplayPendingAdoption(workspace, state.pendingRequest.request);
      return;
    }
    if (hasTerminalAdoptionDecision(workspace.session)) {
      setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
      return;
    }
    await checkAdoptionEligibility(workspace);
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
    hasHiddenUnsavedAccountChanges: (): boolean =>
      unconfirmedEdits.size > 0 ||
      [...editsRetainedAcrossDisposal.values()].some((copies) => copies.length > 0),

    listDisposalEditRecovery: (cursor?: string) => {
      const scope = getDisposalRecoveryScope();
      if (scope === undefined) return { items: [], nextCursor: null };
      const copies = getRecoveryCopies(scope.userId);
      let start = 0;
      if (cursor !== undefined) {
        const cursorIndex = copies.findIndex((copy) => copy.recoveryId === cursor);
        if (cursorIndex < 0) return { items: [], nextCursor: null };
        start = cursorIndex + 1;
      }
      const page = copies.slice(start, start + DISPOSAL_RECOVERY_PAGE_SIZE);
      const last = page.at(-1);
      const items = page.map((copy) => {
        let characterLength: number | null = null;
        let menuCount = 0;
        try {
          if (Array.isArray(copy.entries)) menuCount = copy.entries.length;
          const rawValue = serializePersistedTrainingStateV10({
            dashboardEntries: copy.entries,
          });
          const inspection = classifyTrainingStorageValue(rawValue);
          if (inspection.status === 'ready' || inspection.status === 'empty') {
            characterLength = rawValue.length;
          }
        } catch {
          // Keep the copy listed even when its contents cannot currently be serialized.
        }
        return { recoveryId: copy.recoveryId, menuCount, characterLength };
      });
      if (!scope.isCurrent()) return { items: [], nextCursor: null };
      return {
        items,
        nextCursor: start + page.length < copies.length ? (last?.recoveryId ?? null) : null,
      };
    },

    readDisposalEditRecovery: (recoveryId: string): string | null => {
      const scope = getDisposalRecoveryScope();
      if (scope === undefined) return null;
      const copy = getRecoveryCopies(scope.userId).find(
        (candidate) => candidate.recoveryId === recoveryId,
      );
      if (copy === undefined) return null;
      try {
        const rawValue = serializePersistedTrainingStateV10({
          dashboardEntries: copy.entries,
        });
        const inspection = classifyTrainingStorageValue(rawValue);
        return scope.isCurrent() && (inspection.status === 'ready' || inspection.status === 'empty')
          ? rawValue
          : null;
      } catch {
        return null;
      }
    },

    getSnapshot: (): WorkspaceSnapshot => {
      if (disposed) return { mode: 'disposed', epoch };
      if (adoptionCompletionPending) return { mode: 'adoption-completing', epoch };
      if (verifiedStorageFailure !== undefined)
        return {
          mode: 'account-error',
          epoch,
          userId: verifiedStorageFailure.session.userId,
          session: verifiedStorageFailure.session,
          storageFailure: verifiedStorageFailure.code,
        };
      if (active === undefined) {
        if (guestRefreshPending || guestRefreshFailed) {
          return { mode: 'guest-refreshing', epoch, failed: guestRefreshFailed };
        }
        return { mode: 'guest', epoch, store: guestStore };
      }
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
        persistencePending: active.storage.hasPendingWrites,
        recoveryFailure: active.storage.lastRecoveryFailure?.code ?? null,
        serverRevocationConfirmed: active.serverRevocationConfirmed,
        adoption: adoptionState,
      };
    },

    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Waits for the active account cache write and confirms the current store readback. */
    flushPersistence: async (): Promise<void> => {
      const workspace = active;
      if (workspace === undefined) {
        throw new AccountStorageError(
          'interrupted',
          'write',
          'There is no active account workspace to confirm.',
        );
      }
      await workspace.storage.flush();
      const value = serializePersistedTrainingStateV10({
        dashboardEntries: workspace.store.getState().dashboardEntries,
      });
      await workspace.storage.confirmCurrentValue(value);
      if (
        active !== workspace ||
        workspace.epoch !== epoch ||
        value !==
          serializePersistedTrainingStateV10({
            dashboardEntries: workspace.store.getState().dashboardEntries,
          })
      ) {
        throw new AccountStorageError(
          'interrupted',
          'write',
          'The account workspace changed before its save could be confirmed.',
        );
      }
    },

    beginSignIn: (): void => {
      notify();
    },

    replaceGuestStore: (replacement: TrainingStoreApi): void => {
      guestStore = replacement;
      notify();
    },

    refreshGuestWorkspace: async (): Promise<boolean> => {
      if (active !== undefined || options.guestCleanup === undefined) return false;
      guestRefreshPending = true;
      guestRefreshFailed = false;
      notify();
      try {
        if (!options.coordination.isAvailable) {
          // Keep guest menus accessible when this browser cannot coordinate writers. The
          // provider installs the validated current source in memory, where edits cannot
          // overwrite another tab's LocalStorage value without a lock.
          const rawValue = await options.guestCleanup.readRaw();
          await options.guestCleanup.refreshFromRaw(rawValue ?? null, { durableWrites: false });
          guestRefreshPending = false;
          guestRefreshFailed = false;
          notify();
          return true;
        }
        try {
          await options.guestCleanup.prepare();
          await options.coordination.withLock({ kind: 'guest' }, async () => {
            const rawValue = await options.guestCleanup?.readRaw();
            await options.guestCleanup?.refreshFromRaw(rawValue ?? null, { durableWrites: true });
          });
        } catch (error) {
          if (options.coordination.isAvailable) throw error;
          // Lock acquisition can fail after `prepare` disabled the previous writer. Re-read
          // the source and expose it through the provider's non-persisting fallback.
          const rawValue = await options.guestCleanup.readRaw();
          await options.guestCleanup.refreshFromRaw(rawValue ?? null, { durableWrites: false });
        }
        guestRefreshPending = false;
        guestRefreshFailed = false;
        notify();
        return true;
      } catch {
        guestRefreshPending = false;
        guestRefreshFailed = true;
        notify();
        return false;
      }
    },

    bootstrap: async (): Promise<WorkspaceOperationResult> => {
      const localResume = pendingLocalResume;
      pendingLocalResume = undefined;
      const adoptionResume = pendingAdoptionResume;
      pendingAdoptionResume = undefined;
      const ordinaryBootstrap = localResume === undefined && adoptionResume === undefined;
      if (ordinaryBootstrap) ordinaryBootstrapsInFlight += 1;
      try {
        if (disposed) return { status: 'disposed' };
        if (active === undefined && authenticationLogoutInFlight) return { status: 'superseded' };
        if (
          localResume === undefined &&
          adoptionResume === undefined &&
          replacementGate?.resuming
        ) {
          // A competing verification must not cancel offline rehydration of the
          // already-open workspace. Hide and logout still supersede it directly.
          return { status: 'superseded' };
        }
        let result: SessionResult;
        let operation: ReturnType<typeof startRequest>;
        const pendingExit = exitIntent;
        if (adoptionResume !== undefined) {
          // A matching POST acknowledgement or session receipt is authoritative. Reopen
          // the committed cache without a stale follow-up /session response vetoing it.
          operation = startRequest();
          result = { status: 'authenticated', session: adoptionResume };
        } else if (localResume !== undefined) {
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
        if (result.status === 'authenticated') {
          const localTerminal = adoptionSessionOverrides.get(result.session.userId);
          if (
            localTerminal !== undefined &&
            (localTerminal.adoption.status === 'accepted' ||
              localTerminal.adoption.status === 'declined')
          ) {
            // A direct matching POST acknowledgement is authoritative even if the next
            // session read still reports the former pending capability.
            result = { status: 'authenticated', session: localTerminal };
          }
        }
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
          verifiedStorageFailure = undefined;
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
        if (
          verifiedStorageFailure !== undefined &&
          verifiedStorageFailure.session.userId !== userId
        ) {
          // The previous account's recovery UI loses authorization as soon as this
          // different verified identity is known, before its cache preparation can wait.
          verifiedStorageFailure = undefined;
          notify();
        }
        if (active?.userId === userId) {
          const adoptionGateOpen =
            active.session.adoption.status === 'pending' || adoptionState.status !== 'none';
          let syncState: AccountSyncState | undefined;
          try {
            syncState = await active.synchronizationDatabase?.readSyncState(userId);
          } catch {
            active.session = result.session;
            active.synchronizer?.updateSession(result.session);
            offeredGuestSnapshot = undefined;
            setAdoptionState({ status: 'storage-recovery', decisionConfirmed: false });
            return { status: 'ready' };
          }
          if (!workspaceIsCurrent(active)) return { status: 'superseded' };
          if (adoptionGateOpen && syncState !== undefined && syncState.pendingRequest === null) {
            if (hasTerminalAdoptionDecision(result.session)) {
              const peer = await reopenPeerCompletion(active, result.session, syncState);
              if (peer === 'reopened') return { status: 'ready' };
              if (peer === 'blocked') return { status: 'retryable', reason: 'storage' };
              if (hasPotentialAdoptionCompletion(syncState)) {
                setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
                return { status: 'ready' };
              }
            }
          }
          if (
            adoptionGateOpen &&
            result.session.adoption.status === 'unavailable' &&
            syncState !== undefined &&
            syncState.pendingRequest?.kind !== 'adoption'
          ) {
            const resolved = await resolveUnavailableAdoption(active, result.session, syncState);
            if (resolved === 'reopened' || resolved === 'open') return { status: 'ready' };
            return active === undefined
              ? { status: 'retryable', reason: 'storage' }
              : { status: 'ready' };
          }
          if (
            adoptionGateOpen &&
            (result.session.adoption.status === 'accepted' ||
              result.session.adoption.status === 'declined')
          ) {
            verifiedStorageFailure = { session: result.session, code: 'unavailable' };
            setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
            deactivate(true);
            return { status: 'retryable', reason: 'storage' };
          }
          if (syncState?.pendingRequest?.kind === 'adoption') {
            active.session = result.session;
            adoptionRecoveryAccountId = userId;
            setAdoptionState({
              status: 'retryable',
              decision: syncState.pendingRequest.request.decision,
            });
            await recoverOrReplayPendingAdoption(active, syncState.pendingRequest.request);
            if (!workspaceIsCurrent(active)) return { status: 'superseded' };
          } else {
            const reconciledSession = applyDurableDecline(result.session, syncState);
            active.session = reconciledSession;
            active.synchronizer?.updateSession(reconciledSession);
            offeredGuestSnapshot = undefined;
            if (
              reconciledSession.adoption.status === 'pending' &&
              reconciledSession.adoption.capability
            ) {
              adoptionRecoveryAccountId = undefined;
              setAdoptionState({ status: 'checking' });
              await checkAdoptionEligibility(active);
            } else {
              adoptionRecoveryAccountId = undefined;
              setAdoptionState({ status: 'none' });
            }
          }
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
              onWriteStateChange: notify,
              ...((synchronizationDatabase ?? options.database) === undefined
                ? {}
                : { database: synchronizationDatabase ?? options.database }),
            });
            return { synchronizationDatabase, storage };
          } catch {
            return null;
          }
        })();
        if (preparation === null) {
          verifiedStorageFailure = { session: result.session, code: 'unavailable' };
          notify();
          return { status: 'retryable', reason: 'storage' };
        }
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
          if (hydrationFailed) {
            verifiedStorageFailure = { session: result.session, code: 'invalid-persisted-value' };
            notify();
            return { status: 'retryable', reason: 'storage' };
          }
          const retainedCandidates = [
            ...(unconfirmedEdits.has(userId) ? [unconfirmedEdits.get(userId)] : []),
            ...(editsRetainedAcrossDisposal.get(userId) ?? []),
          ].filter((candidate): candidate is UnconfirmedWorkspaceEdits => candidate !== undefined);
          const uniqueRetainedCandidates = retainedCandidates.filter(
            (candidate, index) =>
              !retainedCandidates
                .slice(0, index)
                .some((prior) => sameUnconfirmedEdit(candidate, prior)),
          );
          const retained = uniqueRetainedCandidates[0];
          if (
            uniqueRetainedCandidates.length > 1 ||
            uniqueRetainedCandidates.some(
              (candidate) =>
                candidate.baseline !== storage.confirmedCacheValue ||
                !sameCacheVersion(candidate.baselineVersion, storage.confirmedCacheVersion),
            )
          ) {
            // Multiple disposed controllers can hold different unsaved versions. Keep every
            // copy and require recovery instead of choosing one by disposal completion order.
            verifiedStorageFailure = { session: result.session, code: 'malformed-readback' };
            notify();
            return { status: 'retryable', reason: 'storage' };
          }
          if (retained !== undefined) {
            // A newer tab's cache and this unsaved state are two different versions. Job 6B
            // preserves both and stops; it must not implement automatic conflict resolution.
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
          // Keep a verified account uneditable until its durable adoption state has been
          // read. This also covers reloads where a terminal server receipt and a pending
          // local request must be reconciled before the empty cache can become visible.
          adoptionState = { status: 'checking' };
          active = {
            userId,
            session: result.session,
            epoch: activationEpoch,
            store: activatedStore,
            storage,
            unsubscribe,
            ...(synchronizationDatabase === undefined ? {} : { synchronizationDatabase }),
            storageChanged: sawLegacyChange,
            serverRevocationConfirmed: false,
          };
          const openedWorkspace = active;
          verifiedStorageFailure = undefined;
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
              canSynchronize: () =>
                workspaceIsCurrent(openedWorkspace) &&
                adoptionState.status === 'none' &&
                !adoptionCompletionPending &&
                verifiedStorageFailure === undefined,
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
            active.unsubscribeStore = activatedStore.subscribe(() => {
              synchronizer.schedule();
              notify();
            });
          }
          const syncState = await synchronizationDatabase?.readSyncState(userId);
          if (!workspaceIsCurrent(openedWorkspace)) return { status: 'superseded' };
          const reconciledSession = applyDurableDecline(openedWorkspace.session, syncState);
          openedWorkspace.session = reconciledSession;
          openedWorkspace.synchronizer?.updateSession(reconciledSession);
          if (syncState?.pendingRequest?.kind === 'adoption') {
            setAdoptionState({
              status: 'retryable',
              decision: syncState.pendingRequest.request.decision,
            });
            await recoverOrReplayPendingAdoption(openedWorkspace, syncState.pendingRequest.request);
            if (active !== openedWorkspace) return { status: 'superseded' };
          } else {
            offeredGuestSnapshot = undefined;
            if (
              (openedWorkspace.session.adoption.status === 'accepted' &&
                syncState?.acknowledgement.status !== 'acknowledged') ||
              (openedWorkspace.session.adoption.status === 'declined' &&
                syncState?.acknowledgement.status !== 'adoption-declined')
            ) {
              verifiedStorageFailure = { session: openedWorkspace.session, code: 'unavailable' };
              setAdoptionState({ status: 'storage-recovery', decisionConfirmed: true });
              deactivate(true);
              return { status: 'retryable', reason: 'storage' };
            }
            if (syncState?.acknowledgement.status === 'adoption-declined') {
              setAdoptionState({ status: 'none' });
            } else {
              await checkAdoptionEligibility(openedWorkspace);
            }
            if (!workspaceIsCurrent(openedWorkspace)) return { status: 'superseded' };
          }
          openedWorkspace.synchronizer?.start();
          preparing = undefined;
          unconfirmedEdits.delete(userId);
          recoveryViews.delete(userId);
          if (retained !== undefined) {
            const remaining = (editsRetainedAcrossDisposal.get(userId) ?? []).filter(
              (candidate) => !sameUnconfirmedEdit(candidate, retained),
            );
            if (remaining.length > 0) editsRetainedAcrossDisposal.set(userId, remaining);
            else editsRetainedAcrossDisposal.delete(userId);
          }
          authenticationReverificationRequired = false;
          authenticationRecoverySession = undefined;
          if (pendingReplacement !== undefined) {
            pendingReplacement.reopenAllowed = false;
            settleReplacementGate(pendingReplacement);
          }
          return { status: 'ready' };
        } catch (error) {
          if (activationCurrent()) {
            verifiedStorageFailure = {
              session: result.session,
              code: error instanceof AccountStorageError ? error.code : 'unavailable',
            };
            notify();
          }
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
        notify();
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
      if (verifiedStorageFailure !== undefined && active === undefined && gate === undefined) {
        const operation = startRequest();
        authenticationLogoutInFlight = true;
        try {
          await options.api.logout(operation.abort.signal);
          if (!isCurrent(operation)) return { status: 'superseded' };
          verifiedStorageFailure = undefined;
          notify();
          return { status: 'signed-out' };
        } catch (error) {
          if (!isCurrent(operation)) return { status: 'superseded' };
          if (isUnauthenticated(error)) {
            verifiedStorageFailure = undefined;
            notify();
            return { status: 'signed-out' };
          }
          return { status: 'retryable', reason: 'logout' };
        } finally {
          authenticationLogoutInFlight = false;
        }
      }
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
      if (
        workspace === undefined &&
        verifiedStorageFailure !== undefined &&
        replacementGate === undefined
      ) {
        // A Retry may still be waiting on /api/session or IndexedDB preparation. Invalidate
        // that generation before clearing the verified error so Use this device stays local.
        cancelRequests();
        verifiedStorageFailure = undefined;
        notify();
        return { status: 'hidden', serverRevocationConfirmed: false };
      }
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

    chooseAdoption,
    retryAdoption,

    useCloudVersion: async (conflictId: string): Promise<AccountSynchronizationResult> =>
      active?.synchronizer?.useCloud(conflictId) ?? { status: 'paused' },

    useLocalVersion: async (conflictId: string): Promise<AccountSynchronizationResult> =>
      active?.synchronizer?.useLocal(conflictId) ?? { status: 'paused' },

    dispose: (): Promise<void> => {
      if (disposed) return disposalTask;
      disposed = true;
      cancelRequests();
      const workspace = active;
      listeners.clear();
      for (const [userId, edits] of unconfirmedEdits) {
        retainDisposalEdits(userId, edits);
      }
      if (workspace === undefined || !workspace.storage.hasPendingWrites) {
        if (workspace !== undefined && workspace.storage.lastFailure !== null) {
          const entries = workspace.store.getState().dashboardEntries;
          const baseline = workspace.storage.confirmedCacheValue;
          if (hasUnconfirmedWorkspaceContent(entries, baseline)) {
            retainDisposalEdits(
              workspace.userId,
              createUnconfirmedWorkspaceEdits(
                entries,
                baseline,
                workspace.storage.confirmedCacheVersion,
              ),
            );
          }
        }
        deactivate();
        return disposalTask;
      }

      // React cleanup cannot await controller disposal. Keep the account adapter enabled until
      // writes already accepted by Zustand have settled and the last store value has been read
      // back. Disabling it here aborts an IndexedDB-backed write that may still be in flight.
      disposalTask = preserve(workspace).then((saved) => {
        if (active !== workspace) return;
        if (!saved) {
          const entries = workspace.store.getState().dashboardEntries;
          const baseline = workspace.storage.confirmedCacheValue;
          if (hasUnconfirmedWorkspaceContent(entries, baseline)) {
            retainDisposalEdits(
              workspace.userId,
              createUnconfirmedWorkspaceEdits(
                entries,
                baseline,
                workspace.storage.confirmedCacheVersion,
              ),
            );
          }
        }
        deactivate();
      });
      return disposalTask;
    },
  };
  return controller;
}
