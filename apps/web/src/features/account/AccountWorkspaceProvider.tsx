import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { serializePersistedTrainingStateV10, type StateStorage } from '@kendo-menu/store';

import { AccountApiError, createAccountApiClient } from '../../lib/account-api';
import { createAccountWorkspaceController } from '../../lib/account-workspace';
import { createWorkspaceCoordinator } from '../../lib/workspace-coordination';
import { AdoptionDialog } from './AdoptionDialog';
import {
  broadcastAccountTransition,
  subscribeToAccountTransitions,
} from '../../lib/guest-pageview';
import { TrainingStoreProvider } from '../../lib/training-store-provider';
import { AccountPersistenceBridge } from '../persistence/AccountPersistenceBridge';
import type { TrainingStoreApi } from '@kendo-menu/store';

const GUEST_SIGN_IN_CONFIRMATION_TIMEOUT_MS = 5_000;

function confirmGuestWorkspaceBeforeDeadline(confirmDurable: () => Promise<void>): Promise<void> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new Error('Guest storage confirmation timed out.')),
      GUEST_SIGN_IN_CONFIRMATION_TIMEOUT_MS,
    );
  });
  return Promise.race([confirmDurable(), timeout]).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  });
}

export type AccountWorkspaceController = ReturnType<typeof createAccountWorkspaceController>;
export type AccountWorkspaceSnapshot = ReturnType<AccountWorkspaceController['getSnapshot']>;
export type AccountWorkspaceVerification =
  'checking' | 'signed-out' | 'authenticated' | 'retryable' | 'local-guest';

export interface AccountWorkspaceContextValue {
  readonly controller: AccountWorkspaceController;
  readonly snapshot: AccountWorkspaceSnapshot;
  readonly verification: AccountWorkspaceVerification;
  readonly operationResult: Awaited<ReturnType<AccountWorkspaceController['bootstrap']>> | null;
  readonly verifySession: () => Promise<void>;
  readonly signOut: () => Promise<Awaited<ReturnType<AccountWorkspaceController['logout']>>>;
  readonly openThisDevice: () => Promise<
    Awaited<ReturnType<AccountWorkspaceController['hideLocally']>>
  >;
  readonly startGoogleSignIn: () => void;
  readonly chooseAdoption: (decision: 'yes' | 'no') => Promise<void>;
  readonly retryAdoption: () => Promise<void>;
}

const AccountWorkspaceContext = createContext<AccountWorkspaceContextValue | null>(null);

interface AccountWorkspaceProviderProps {
  readonly children: ReactNode;
  readonly guestFallback?: ReactNode;
  readonly guestStore: TrainingStoreApi;
  readonly guestStorage: StateStorage;
  readonly guestCleanup?: {
    readonly readRaw: () => string | null | Promise<string | null>;
    readonly confirmDurable: () => Promise<void>;
    readonly prepare: () => void | Promise<void>;
    readonly refreshFromRaw: (
      rawValue: string | null,
      options: { readonly durableWrites: boolean },
    ) => TrainingStoreApi | Promise<TrainingStoreApi>;
  };
}

/** Verifies the server session before the controller can expose an account store to routes. */
export function AccountWorkspaceProvider({
  children,
  guestFallback,
  guestStore,
  guestStorage,
  guestCleanup,
}: AccountWorkspaceProviderProps) {
  const [controller, setController] = useState<AccountWorkspaceController | null>(null);
  const [snapshot, setSnapshot] = useState<AccountWorkspaceSnapshot>(() => ({
    mode: 'guest',
    epoch: 0,
    store: guestStore,
  }));
  const [verification, setVerification] = useState<AccountWorkspaceVerification>('checking');
  const initialGuestStore = useRef(guestStore);
  const verificationGeneration = useRef(0);
  const verificationPending = useRef(false);
  const verifiedSignedOut = useRef(false);
  const signInInFlight = useRef(false);
  const signInAttemptGeneration = useRef(0);
  const restoredSessionGeneration = useRef(0);
  const restoredSessionPending = useRef(false);
  const [restoredSessionState, setRestoredSessionState] = useState<'idle' | 'checking' | 'failed'>(
    'idle',
  );
  const [signInState, setSignInState] = useState<'idle' | 'saving' | 'failed'>('idle');
  useEffect(() => {
    if (signInState === 'saving') document.getElementById('guest-sign-in-status')?.focus();
  }, [signInState]);
  const confirmedRevocationSequence = useRef(0);
  const externalExitGeneration = useRef(0);
  const externalExitInFlight = useRef(false);
  const externalExitWorkspace = useRef<AccountWorkspaceController | null>(null);
  const externalSessionWorkspace = useRef<AccountWorkspaceController | null>(null);
  const externalSessionInFlight = useRef(false);
  const externalSessionGeneration = useRef(0);
  const peerSignInPending = useRef(false);
  const localGuestSelected = useRef(false);
  const [localGuestChoice, setLocalGuestChoice] = useState(false);
  const [externalExitState, setExternalExitState] = useState<'none' | 'preserving' | 'failed'>(
    'none',
  );
  const [externalSessionState, setExternalSessionState] = useState<
    'none' | 'awaiting' | 'checking' | 'failed'
  >('none');
  const [externalBackupError, setExternalBackupError] = useState(false);
  const [operationResult, setOperationResult] = useState<Awaited<
    ReturnType<AccountWorkspaceController['bootstrap']>
  > | null>(null);

  const runVerification = useCallback(
    async (workspace: AccountWorkspaceController, broadcast: boolean) => {
      const generation = ++verificationGeneration.current;
      verificationPending.current = true;
      setVerification('checking');
      const result = await workspace.bootstrap();
      if (generation !== verificationGeneration.current) return null;
      verificationPending.current = false;
      const next = workspace.getSnapshot();
      if (result.status === 'signed-out' && next.mode === 'guest') {
        verifiedSignedOut.current = true;
      } else if (result.status === 'ready' || next.mode !== 'guest') {
        verifiedSignedOut.current = false;
      }
      setOperationResult(result);
      setSnapshot(next);
      setVerification(
        result.status === 'ready' || next.mode === 'account-error'
          ? 'authenticated'
          : result.status === 'signed-out'
            ? 'signed-out'
            : 'retryable',
      );
      if (broadcast && result.status === 'ready' && next.mode === 'account') {
        broadcastAccountTransition('verified-account-active');
      }
      return result;
    },
    [],
  );

  const recheckRestoredSession = useCallback(
    async (workspace: AccountWorkspaceController) => {
      const generation = ++restoredSessionGeneration.current;
      restoredSessionPending.current = true;
      localGuestSelected.current = false;
      verifiedSignedOut.current = false;
      peerSignInPending.current = false;
      externalSessionInFlight.current = false;
      externalSessionWorkspace.current = null;
      setExternalSessionState('none');
      setRestoredSessionState('checking');
      window.dispatchEvent(new Event('kendomenu:session-verification-started'));
      const result = await runVerification(workspace, true);
      if (generation !== restoredSessionGeneration.current) return;
      restoredSessionPending.current = false;
      setRestoredSessionState(
        result?.status === 'ready' || result?.status === 'signed-out' ? 'idle' : 'failed',
      );
    },
    [runVerification],
  );

  const checkExternalSession = useCallback(
    async (workspace: AccountWorkspaceController) => {
      if (
        restoredSessionPending.current ||
        localGuestSelected.current ||
        externalExitWorkspace.current !== null ||
        externalSessionInFlight.current
      )
        return;
      const generation = ++externalSessionGeneration.current;
      externalSessionInFlight.current = true;
      externalSessionWorkspace.current = workspace;
      setExternalBackupError(false);
      setExternalSessionState('checking');
      const result = await runVerification(workspace, false);
      if (
        generation !== externalSessionGeneration.current ||
        externalSessionWorkspace.current !== workspace
      )
        return;
      externalSessionInFlight.current = false;
      const next = workspace.getSnapshot();
      if (peerSignInPending.current && next.mode === 'account' && result?.status === 'ready') {
        setExternalSessionState('awaiting');
        return;
      }
      if (result === null) {
        setExternalSessionState(next.mode === 'account' ? 'failed' : 'none');
        if (next.mode !== 'account') externalSessionWorkspace.current = null;
        return;
      }
      if (
        next.mode === 'account' &&
        (result.status === 'retryable' || result.status === 'superseded')
      ) {
        setExternalSessionState('failed');
        return;
      }
      externalSessionWorkspace.current = null;
      setExternalSessionState('none');
    },
    [runVerification],
  );

  const secureExternalSignOut = useCallback(
    async (
      workspace: AccountWorkspaceController,
      useGuest = false,
    ): Promise<Awaited<ReturnType<AccountWorkspaceController['hideLocally']>>> => {
      if (externalExitInFlight.current) return { status: 'superseded' };
      const mode = workspace.getSnapshot().mode;
      if (mode !== 'account' && mode !== 'account-error') {
        if (useGuest) localGuestSelected.current = true;
        externalSessionGeneration.current += 1;
        peerSignInPending.current = false;
        externalSessionWorkspace.current = null;
        externalSessionInFlight.current = false;
        setExternalSessionState('none');
        verificationGeneration.current += 1;
        verificationPending.current = false;
        externalExitWorkspace.current = null;
        setExternalExitState('none');
        // Even a guest snapshot can have an older authenticated bootstrap in flight.
        // Cancel it before a local guest choice or a fresh signed-out verification.
        await workspace.hideLocally();
        if (useGuest || localGuestSelected.current) {
          await workspace.refreshGuestWorkspace();
          setVerification('local-guest');
        } else {
          await runVerification(workspace, false);
        }
        return { status: 'hidden', serverRevocationConfirmed: false };
      }
      externalExitInFlight.current = true;
      externalExitWorkspace.current = workspace;
      externalSessionGeneration.current += 1;
      peerSignInPending.current = false;
      externalSessionWorkspace.current = null;
      externalSessionInFlight.current = false;
      setExternalSessionState('none');
      setLocalGuestChoice(useGuest);
      setExternalBackupError(false);
      const generation = ++externalExitGeneration.current;
      verificationGeneration.current += 1;
      verificationPending.current = false;
      setExternalExitState('preserving');
      const result = await workspace.hideLocally();
      if (generation !== externalExitGeneration.current) return { status: 'superseded' };
      if (result.status !== 'hidden') {
        // Keep the account writer alive and its editor hidden until a retry can save it.
        externalExitInFlight.current = false;
        setExternalExitState('failed');
        setVerification('retryable');
        return result;
      }
      if (useGuest) {
        // A local hide is an explicit workspace choice, not evidence of server sign-out.
        // Refresh the guest source before revealing it and do not reopen the live session.
        await workspace.refreshGuestWorkspace();
        if (generation !== externalExitGeneration.current) return { status: 'superseded' };
        localGuestSelected.current = true;
        externalExitInFlight.current = false;
        externalExitWorkspace.current = null;
        setExternalExitState('none');
        setVerification('local-guest');
        return result;
      }
      externalExitInFlight.current = false;
      externalExitWorkspace.current = null;
      setExternalExitState('none');
      await runVerification(workspace, false);
      return result;
    },
    [runVerification],
  );

  useEffect(() => {
    const browserApi = createAccountApiClient();
    const api = {
      ...browserApi,
      logout: async (signal?: AbortSignal) => {
        try {
          await browserApi.logout(signal);
          // A 204 confirms revocation even if a newer UI operation supersedes this call.
          confirmedRevocationSequence.current += 1;
          broadcastAccountTransition('signed-out');
        } catch (error) {
          if (
            error instanceof AccountApiError &&
            error.kind === 'http' &&
            error.status === 401 &&
            error.code === 'UNAUTHENTICATED'
          ) {
            confirmedRevocationSequence.current += 1;
            broadcastAccountTransition('signed-out');
          }
          throw error;
        }
      },
    };
    const coordination = createWorkspaceCoordinator();
    const workspace = createAccountWorkspaceController({
      guestStore: initialGuestStore.current,
      api,
      storage: guestStorage,
      coordination,
      synchronization: { api },
      ...(guestCleanup === undefined
        ? {}
        : {
            guestCleanup: {
              readRaw: () => guestCleanup.readRaw(),
              prepare: () => guestCleanup.prepare(),
              refreshFromRaw: async (
                rawValue: string | null,
                refreshOptions: { readonly durableWrites: boolean },
              ) => {
                const fresh = await guestCleanup.refreshFromRaw(rawValue, refreshOptions);
                workspace.replaceGuestStore(fresh);
              },
            },
          }),
    });
    setController(workspace);
    setSnapshot(workspace.getSnapshot());
    const unsubscribe = workspace.subscribe(() => {
      const next = workspace.getSnapshot();
      setSnapshot(next);
      if (verificationPending.current) return;
      if (next.mode === 'account' || next.mode === 'account-error') {
        setVerification('authenticated');
      } else if (next.mode === 'guest') {
        // Hiding after a dashboard 401 or local hide is not signed-out proof. Only a
        // completed /api/session result below may authorize the guest-only pixel.
        setVerification((current) => (current === 'authenticated' ? 'retryable' : current));
      }
    });
    const transitions = subscribeToAccountTransitions((signal) => {
      if (signal === 'signed-out') {
        void secureExternalSignOut(workspace);
      } else if (signal === 'sign-in-started') {
        const mode = workspace.getSnapshot().mode;
        if (
          !localGuestSelected.current &&
          externalExitWorkspace.current === null &&
          (mode === 'account' || mode === 'account-error')
        ) {
          // A sign-in attempt can still be showing the old server session. Hide the old
          // workspace until a completed transition hint or an explicit retry verifies it.
          peerSignInPending.current = true;
          externalSessionGeneration.current += 1;
          externalSessionInFlight.current = false;
          externalSessionWorkspace.current = workspace;
          verificationGeneration.current += 1;
          verificationPending.current = false;
          setExternalBackupError(false);
          setExternalSessionState('awaiting');
        }
      } else if (
        signal === 'verified-account-active' &&
        externalExitWorkspace.current === null &&
        !localGuestSelected.current
      ) {
        // A cross-tab hint is never authentication proof. The controller checks /api/session
        // while the old account editor stays gated.
        peerSignInPending.current = false;
        void checkExternalSession(workspace);
      }
    });
    const reverifyVisibleAccount = () => {
      if (restoredSessionPending.current) return;
      const mode = workspace.getSnapshot().mode;
      if (
        !transitions.available &&
        verifiedSignedOut.current &&
        !localGuestSelected.current &&
        mode === 'guest' &&
        !externalSessionInFlight.current
      ) {
        window.dispatchEvent(new Event('kendomenu:session-verification-started'));
        void checkExternalSession(workspace);
        return;
      }
      if (!peerSignInPending.current && (mode === 'account' || mode === 'account-error'))
        void checkExternalSession(workspace);
    };
    const reverifyOnVisibility = () => {
      if (document.visibilityState !== 'hidden') reverifyVisibleAccount();
    };
    const reverifyAfterBfCache = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      // A restored document carries presentation state only. Hide it until a fresh session
      // request establishes which workspace, if any, belongs in this tab.
      signInAttemptGeneration.current += 1;
      signInInFlight.current = false;
      setSignInState('idle');
      setLocalGuestChoice(false);
      void recheckRestoredSession(workspace);
    };
    window.addEventListener('focus', reverifyVisibleAccount);
    document.addEventListener('visibilitychange', reverifyOnVisibility);
    window.addEventListener('pageshow', reverifyAfterBfCache);
    // StrictMode replays effect setup and cleanup on the initial document. Schedule the
    // first check after that replay so one document sends one session request.
    const initialVerification = window.setTimeout(() => {
      void runVerification(workspace, true);
    }, 0);

    return () => {
      window.clearTimeout(initialVerification);
      verificationGeneration.current += 1;
      verificationPending.current = false;
      externalExitGeneration.current += 1;
      externalExitInFlight.current = false;
      externalExitWorkspace.current = null;
      externalSessionGeneration.current += 1;
      peerSignInPending.current = false;
      externalSessionInFlight.current = false;
      externalSessionWorkspace.current = null;
      unsubscribe();
      transitions.unsubscribe();
      window.removeEventListener('focus', reverifyVisibleAccount);
      document.removeEventListener('visibilitychange', reverifyOnVisibility);
      window.removeEventListener('pageshow', reverifyAfterBfCache);
      void workspace.dispose();
      coordination.dispose();
    };
  }, [
    checkExternalSession,
    guestCleanup,
    guestStorage,
    recheckRestoredSession,
    runVerification,
    secureExternalSignOut,
  ]);

  useEffect(() => {
    if (controller !== null && guestStore !== initialGuestStore.current) {
      controller.replaceGuestStore(guestStore);
      initialGuestStore.current = guestStore;
    }
  }, [controller, guestStore]);

  const accountWriteUnconfirmed =
    snapshot.mode === 'account' &&
    (snapshot.persistencePending || snapshot.persistenceFailure !== null);
  const hiddenUnsavedAccountChanges = controller?.hasHiddenUnsavedAccountChanges() ?? false;
  const restoreFocusAfterAdoption = useRef(false);
  useEffect(() => {
    if (
      snapshot.mode === 'adoption-completing' ||
      (snapshot.mode === 'account' && snapshot.adoption.status !== 'none')
    ) {
      restoreFocusAfterAdoption.current = true;
    } else if (
      snapshot.mode === 'account' &&
      snapshot.adoption.status === 'none' &&
      restoreFocusAfterAdoption.current
    ) {
      restoreFocusAfterAdoption.current = false;
      document.getElementById('main-content')?.focus({ preventScroll: true });
    }
  }, [snapshot]);
  useEffect(() => {
    if (!accountWriteUnconfirmed && !hiddenUnsavedAccountChanges) return undefined;
    // Browsers may show a leave prompt for a pending account cache write. Unload prompts are
    // best effort, especially on mobile; explicit save feedback still awaits durable readback.
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [accountWriteUnconfirmed, hiddenUnsavedAccountChanges]);

  const verifySession = useCallback(async () => {
    if (controller === null) return;
    localGuestSelected.current = false;
    await runVerification(controller, true);
  }, [controller, runVerification]);

  const signOut = useCallback(async () => {
    if (controller === null) return { status: 'disposed' } as const;
    const generation = ++verificationGeneration.current;
    const revocationSequence = confirmedRevocationSequence.current;
    verificationPending.current = true;
    const result = await controller.logout();
    const revocationConfirmed =
      confirmedRevocationSequence.current > revocationSequence ||
      result.status === 'signed-out' ||
      ('serverRevocationConfirmed' in result && result.serverRevocationConfirmed === true);
    if (revocationConfirmed) {
      broadcastAccountTransition('signed-out');
      externalSessionGeneration.current += 1;
      peerSignInPending.current = false;
      externalSessionWorkspace.current = null;
      externalSessionInFlight.current = false;
      setExternalSessionState('none');
    }
    if (generation !== verificationGeneration.current) {
      // A superseded logout can still have revoked the browser session. Its own
      // BroadcastChannel message is ignored, so preserve and hide this tab locally.
      if (revocationConfirmed) {
        const protectedExit = await secureExternalSignOut(controller);
        if (protectedExit.status === 'hidden') window.location.replace('/app');
      }
      return result;
    }
    verificationPending.current = false;
    const next = controller.getSnapshot();
    setSnapshot(next);
    setOperationResult(result);
    setVerification(
      result.status === 'signed-out'
        ? 'signed-out'
        : next.mode === 'account' || next.mode === 'account-error'
          ? 'authenticated'
          : 'retryable',
    );
    if (externalSessionWorkspace.current !== null) {
      if (next.mode === 'account') {
        setExternalSessionState('failed');
      } else {
        externalSessionWorkspace.current = null;
        setExternalSessionState('none');
      }
    }
    if (result.status === 'signed-out') window.location.replace('/app');
    return result;
  }, [controller, secureExternalSignOut]);

  const openThisDevice = useCallback(async () => {
    if (controller === null) return { status: 'disposed' } as const;
    return secureExternalSignOut(controller, true);
  }, [controller, secureExternalSignOut]);

  const startGoogleSignIn = useCallback(() => {
    if (controller === null || signInInFlight.current) return;
    const attempt = ++signInAttemptGeneration.current;
    signInInFlight.current = true;
    setSignInState('saving');
    // The current document must cancel its own pending pixel at initiation.
    window.dispatchEvent(new Event('kendomenu:sign-in-started'));
    void (async () => {
      try {
        if (guestCleanup === undefined) throw new Error('Guest storage is unavailable.');
        await confirmGuestWorkspaceBeforeDeadline(guestCleanup.confirmDurable);
      } catch {
        if (attempt !== signInAttemptGeneration.current) return;
        signInAttemptGeneration.current += 1;
        signInInFlight.current = false;
        setSignInState('failed');
        return;
      }
      if (attempt !== signInAttemptGeneration.current) return;
      localGuestSelected.current = false;
      verifiedSignedOut.current = false;
      verificationGeneration.current += 1;
      verificationPending.current = false;
      broadcastAccountTransition('sign-in-started');
      controller.beginSignIn();
      window.location.assign('/api/auth/google/start');
    })();
  }, [controller, guestCleanup]);

  const downloadExternalAccountBackup = useCallback(() => {
    const current = (
      externalExitWorkspace.current ?? externalSessionWorkspace.current
    )?.getSnapshot();
    if (current?.mode !== 'account') {
      setExternalBackupError(true);
      return;
    }
    try {
      const rawValue = serializePersistedTrainingStateV10({
        dashboardEntries: current.store.getState().dashboardEntries,
      });
      const url = URL.createObjectURL(new Blob([rawValue], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'kendo-menu-account-recovery.json';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setExternalBackupError(false);
    } catch {
      setExternalBackupError(true);
    }
  }, []);

  const value = useMemo<AccountWorkspaceContextValue | null>(
    () =>
      controller === null
        ? null
        : {
            controller,
            snapshot,
            verification,
            operationResult,
            verifySession,
            signOut,
            openThisDevice,
            startGoogleSignIn,
            chooseAdoption: controller.chooseAdoption,
            retryAdoption: controller.retryAdoption,
          },
    [
      controller,
      operationResult,
      signOut,
      openThisDevice,
      snapshot,
      startGoogleSignIn,
      verification,
      verifySession,
    ],
  );

  // The context holds callbacks that read refs on user actions; this branch only checks null.
  // eslint-disable-next-line react-hooks/refs
  if (value === null) {
    return (
      <AccountWorkspaceContext.Provider value={null}>
        {hiddenUnsavedAccountChanges ? (
          <HiddenUnsavedAccountNotice onRetry={verifySession} />
        ) : null}
        <TrainingStoreProvider store={guestStore}>
          <GuestWorkspaceSurface signInState={signInState} onRetry={startGoogleSignIn}>
            {guestFallback ?? children}
          </GuestWorkspaceSurface>
        </TrainingStoreProvider>
      </AccountWorkspaceContext.Provider>
    );
  }

  if (restoredSessionState !== 'idle') {
    return (
      <AccountWorkspaceContext.Provider value={value}>
        <RestoredSessionGate
          state={restoredSessionState}
          onRetry={() => void recheckRestoredSession(value.controller)}
        />
      </AccountWorkspaceContext.Provider>
    );
  }

  if (externalExitState !== 'none') {
    return (
      <AccountWorkspaceContext.Provider value={value}>
        {hiddenUnsavedAccountChanges ? (
          <HiddenUnsavedAccountNotice onRetry={verifySession} />
        ) : null}
        <main className="persistence-recovery" aria-labelledby="account-transition-title">
          <section className="recovery-card">
            <p className="eyebrow">Account session</p>
            <h1 id="account-transition-title">
              {localGuestChoice ? 'Opening this device workspace' : 'Saving recent account changes'}
            </h1>
            <p role="status">
              {externalExitState === 'failed'
                ? localGuestChoice
                  ? 'Recent account changes could not be saved before switching to this device workspace. Keep this tab open and retry or download an account backup.'
                  : 'Another tab signed out, but recent account changes could not be saved on this device. Keep this tab open and retry or download an account backup before leaving this page.'
                : localGuestChoice
                  ? 'KendoMenu is saving recent account changes before opening this device workspace.'
                  : 'Another tab signed out. KendoMenu is saving recent account changes before opening this device workspace.'}
            </p>
            {externalExitState === 'failed' ? (
              <div className="recovery-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    const workspace = externalExitWorkspace.current;
                    if (workspace !== null) void secureExternalSignOut(workspace, localGuestChoice);
                  }}
                >
                  Retry saving
                </button>
                {snapshot.mode === 'account' ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={downloadExternalAccountBackup}
                  >
                    Download account backup
                  </button>
                ) : null}
              </div>
            ) : null}
            {externalBackupError ? (
              <p role="alert">
                The account backup could not be created. Keep this tab open and retry.
              </p>
            ) : null}
          </section>
        </main>
      </AccountWorkspaceContext.Provider>
    );
  }

  if (externalSessionState !== 'none') {
    return (
      <AccountWorkspaceContext.Provider value={value}>
        {hiddenUnsavedAccountChanges ? (
          <HiddenUnsavedAccountNotice onRetry={verifySession} />
        ) : null}
        <main className="persistence-recovery" aria-labelledby="account-recheck-title">
          <section className="recovery-card">
            <p className="eyebrow">Account session</p>
            <h1 id="account-recheck-title">Checking account status</h1>
            <p role="status">
              {externalSessionState === 'failed'
                ? snapshot.mode === 'account'
                  ? 'KendoMenu could not verify which account is active. The previous account is hidden. Retry, or save a backup and use this device.'
                  : 'KendoMenu could not verify which account is active. Retry the account check or use this device.'
                : externalSessionState === 'awaiting'
                  ? 'Sign-in started in another tab. The previous account is hidden until that tab finishes. If sign-in was cancelled, retry the account check.'
                  : 'KendoMenu is checking the account after activity in another tab. The previous account is hidden until verification finishes.'}
            </p>
            {externalSessionState === 'failed' || externalSessionState === 'awaiting' ? (
              <div className="recovery-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    const workspace = externalSessionWorkspace.current;
                    if (workspace !== null) {
                      peerSignInPending.current = false;
                      void checkExternalSession(workspace);
                    }
                  }}
                >
                  Retry account check
                </button>
                {snapshot.mode === 'account' ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={downloadExternalAccountBackup}
                  >
                    Download account backup
                  </button>
                ) : null}
              </div>
            ) : null}
            {externalBackupError ? (
              <p role="alert">
                The account backup could not be created. Keep this tab open and retry.
              </p>
            ) : null}
          </section>
        </main>
      </AccountWorkspaceContext.Provider>
    );
  }

  const visibleStore =
    snapshot.mode === 'account' || snapshot.mode === 'guest' ? snapshot.store : null;
  if (visibleStore === null) {
    return (
      <AccountWorkspaceContext.Provider value={value}>
        {hiddenUnsavedAccountChanges ? (
          <HiddenUnsavedAccountNotice onRetry={verifySession} />
        ) : null}
        {snapshot.mode === 'guest-refreshing' ? (
          <GuestWorkspaceRefresh />
        ) : snapshot.mode === 'adoption-completing' ? (
          <AdoptionCompletionGate />
        ) : (
          <AccountStorageRecovery />
        )}
      </AccountWorkspaceContext.Provider>
    );
  }
  const activeAdoption =
    snapshot.mode === 'account' ? snapshot.adoption : ({ status: 'none' } as const);

  return (
    <AccountWorkspaceContext.Provider value={value}>
      {hiddenUnsavedAccountChanges ? <HiddenUnsavedAccountNotice onRetry={verifySession} /> : null}
      <TrainingStoreProvider store={visibleStore}>
        {snapshot.mode === 'guest' ? (
          <GuestWorkspaceSurface signInState={signInState} onRetry={startGoogleSignIn}>
            {guestFallback ?? children}
          </GuestWorkspaceSurface>
        ) : (
          <AccountPersistenceBridge workspace={value}>
            {activeAdoption.status === 'checking' ||
            activeAdoption.status === 'completing' ||
            (activeAdoption.status === 'retryable' && activeAdoption.decision === undefined) ||
            activeAdoption.status === 'storage-recovery' ? (
              <AdoptionProgress workspace={value} />
            ) : (
              <>
                {children}
                {activeAdoption.status === 'offer' ||
                activeAdoption.status === 'submitting' ||
                activeAdoption.status === 'retryable' ? (
                  <AdoptionDialog
                    state={activeAdoption}
                    onChoose={(decision) => value.chooseAdoption(decision)}
                    onRetry={value.retryAdoption}
                  />
                ) : null}
              </>
            )}
          </AccountPersistenceBridge>
        )}
      </TrainingStoreProvider>
    </AccountWorkspaceContext.Provider>
  );
}

function GuestWorkspaceSurface({
  children,
  signInState,
  onRetry,
}: {
  readonly children: ReactNode;
  readonly signInState: 'idle' | 'saving' | 'failed';
  readonly onRetry: () => void;
}) {
  const retryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (signInState === 'failed') retryRef.current?.focus({ preventScroll: true });
  }, [signInState]);

  return (
    <>
      {signInState === 'saving' ? (
        <section
          id="guest-sign-in-status"
          className="persistence-recovery"
          aria-labelledby="guest-sign-in-title"
          role="status"
          tabIndex={-1}
        >
          <div className="recovery-card">
            <h1 id="guest-sign-in-title">Saving before sign-in</h1>
            <p>KendoMenu is confirming your latest guest changes on this device.</p>
          </div>
        </section>
      ) : null}
      {signInState === 'failed' ? (
        <aside className="persistence-warning" role="alert">
          <h2>Guest changes could not be saved</h2>
          <p>Your guest workspace is still here. Retry sign-in after storage recovers.</p>
          <button ref={retryRef} className="primary-button" type="button" onClick={onRetry}>
            Retry sign-in
          </button>
        </aside>
      ) : null}
      <div inert={signInState === 'saving'} aria-hidden={signInState === 'saving'}>
        {children}
      </div>
    </>
  );
}

function RestoredSessionGate({
  state,
  onRetry,
}: {
  readonly state: 'checking' | 'failed';
  readonly onRetry: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    (state === 'failed' ? retryRef.current : headingRef.current)?.focus({ preventScroll: true });
  }, [state]);

  return (
    <main className="persistence-recovery" aria-labelledby="restored-session-title">
      <section className="recovery-card">
        <p className="eyebrow">Account session</p>
        <h1 id="restored-session-title" ref={headingRef} tabIndex={-1}>
          Checking account status
        </h1>
        <p role={state === 'failed' ? 'alert' : 'status'}>
          {state === 'failed'
            ? 'KendoMenu could not verify the current account session. Retry before opening this device workspace.'
            : 'KendoMenu is verifying the current account session before opening a workspace.'}
        </p>
        {state === 'failed' ? (
          <button ref={retryRef} className="primary-button" type="button" onClick={onRetry}>
            Retry account check
          </button>
        ) : null}
      </section>
    </main>
  );
}

function AdoptionProgress({ workspace }: { readonly workspace: AccountWorkspaceContextValue }) {
  const state = workspace.snapshot.mode === 'account' ? workspace.snapshot.adoption : null;
  const storageFailure = state?.status === 'storage-recovery';
  const decisionConfirmed = storageFailure && state.decisionConfirmed;
  const decisionCompleting = state?.status === 'completing';
  const headingRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const retryVisible = storageFailure || state?.status === 'retryable';
  const focusRecovery = retryVisible || decisionCompleting;

  useEffect(() => {
    if (!focusRecovery) return;
    (retryVisible ? retryRef.current : headingRef.current)?.focus({ preventScroll: true });
  }, [focusRecovery, retryVisible]);

  return (
    <main className="persistence-recovery" aria-labelledby="adoption-progress-title">
      <section className="recovery-card">
        <p className="eyebrow">Account workspace</p>
        <h1 id="adoption-progress-title" ref={headingRef} tabIndex={-1}>
          {decisionConfirmed || decisionCompleting
            ? 'Saving your account decision'
            : storageFailure
              ? 'Recovering account storage'
              : 'Checking your guest menus'}
        </h1>
        <p role={storageFailure ? 'alert' : 'status'} aria-live="polite">
          {decisionConfirmed
            ? 'The server confirmed your choice, but this device could not finish saving the account workspace. Your guest menus remain untouched. Retry to recover the account copy.'
            : decisionCompleting
              ? 'KendoMenu confirmed your choice and is saving the account workspace on this device. Your guest menus remain untouched.'
              : storageFailure
                ? 'This device could not safely read or prepare account storage. Your guest menus remain untouched, and no adoption decision was confirmed. Retry after storage recovers.'
                : state?.status === 'retryable'
                  ? 'KendoMenu could not check whether a guest copy is available. Your account menus remain protected until the check succeeds.'
                  : 'KendoMenu is checking whether this new account can copy the complete guest workspace.'}
        </p>
        {storageFailure || state?.status === 'retryable' ? (
          <button
            ref={retryRef}
            className="primary-button"
            type="button"
            onClick={() => void workspace.retryAdoption()}
          >
            Retry
          </button>
        ) : null}
      </section>
    </main>
  );
}

function HiddenUnsavedAccountNotice({ onRetry }: { readonly onRetry: () => Promise<void> }) {
  return (
    <aside
      className="persistence-warning"
      role="alert"
      aria-labelledby="hidden-account-changes-title"
    >
      <h2 id="hidden-account-changes-title">Unsaved account changes remain in this tab</h2>
      <p>
        An account session ended before KendoMenu could confirm a device save. Keep this tab open.
        Sign back in to the same account to recover the changes. Your guest menus remain separate.
      </p>
      <button className="secondary-button" type="button" onClick={() => void onRetry()}>
        Check account again
      </button>
    </aside>
  );
}

function GuestWorkspaceRefresh() {
  const workspace = useAccountWorkspace();
  return (
    <main className="persistence-recovery" aria-labelledby="guest-refresh-title">
      <section className="recovery-card">
        <h1 id="guest-refresh-title">Checking menus saved on this device</h1>
        <p role="status">
          KendoMenu is reading the current guest workspace before showing it. Your account and guest
          menus remain separate.
        </p>
        {workspace.snapshot.mode === 'guest-refreshing' && workspace.snapshot.failed ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => void workspace.controller.refreshGuestWorkspace()}
          >
            Retry
          </button>
        ) : null}
      </section>
    </main>
  );
}

function AdoptionCompletionGate() {
  return (
    <main className="persistence-recovery" aria-labelledby="adoption-completion-title">
      <section className="recovery-card">
        <p className="eyebrow">Account workspace</p>
        <h1 id="adoption-completion-title">Saving your account decision</h1>
        <p role="status">
          KendoMenu is confirming the saved account workspace. Keep this tab open.
        </p>
      </section>
    </main>
  );
}

function AccountStorageRecovery() {
  const workspace = useAccountWorkspace();
  const [feedback, setFeedback] = useState<string | null>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    retryRef.current?.focus({ preventScroll: true });
  }, []);
  const isLogoutAvailable = workspace.snapshot.mode === 'account-error';
  const accountId = isLogoutAvailable ? workspace.snapshot.userId : null;
  const [recoveryPage, setRecoveryPage] = useState<{
    readonly accountId: string;
    readonly cursor: string;
  } | null>(null);
  const cursor = recoveryPage?.accountId === accountId ? recoveryPage.cursor : undefined;
  const recoveryCopies = isLogoutAvailable
    ? workspace.controller.listDisposalEditRecovery(cursor)
    : { items: [], nextCursor: null };
  const nextCursor = recoveryCopies.nextCursor;
  const downloadAccountCopy = (recoveryId: string, index: number) => {
    try {
      const raw = workspace.controller.readDisposalEditRecovery(recoveryId);
      if (raw === null) throw new Error('Account recovery copy is unavailable.');
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `kendo-menu-account-copy-${index + 1}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setFeedback(null);
    } catch {
      setFeedback('This account copy could not be downloaded. Keep this tab open and retry.');
    }
  };
  return (
    <main className="persistence-recovery" aria-labelledby="account-storage-title">
      <section className="recovery-card">
        <p className="eyebrow">Account storage</p>
        <h1 id="account-storage-title">Your account workspace could not be opened</h1>
        <p role="status">
          {recoveryCopies.items.length > 0 || cursor !== undefined
            ? 'KendoMenu retained unsaved account copies after a storage failure. Download them before leaving this page. Your guest menus remain separate.'
            : 'KendoMenu could not read this account’s saved workspace. Your guest menus remain separate.'}
        </p>
        {recoveryCopies.items.length > 0 || cursor !== undefined ? (
          <section aria-labelledby="account-copies-title">
            <h2 id="account-copies-title">Unsaved account copies</h2>
            <ul>
              {recoveryCopies.items.map((copy, index) => (
                <li key={copy.recoveryId}>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={copy.characterLength === null}
                    onClick={() => downloadAccountCopy(copy.recoveryId, index)}
                  >
                    Download account copy {index + 1} ({copy.menuCount} menus)
                  </button>
                  {copy.characterLength === null ? (
                    <span> This copy needs another recovery attempt before download.</span>
                  ) : null}
                </li>
              ))}
            </ul>
            {cursor !== undefined ? (
              <button className="text-button" type="button" onClick={() => setRecoveryPage(null)}>
                First copies
              </button>
            ) : null}
            {nextCursor !== null && accountId !== null ? (
              <button
                className="text-button"
                type="button"
                onClick={() => setRecoveryPage({ accountId, cursor: nextCursor })}
              >
                Next copies
              </button>
            ) : null}
          </section>
        ) : null}
        <div className="recovery-actions">
          <button
            ref={retryRef}
            className="primary-button"
            type="button"
            onClick={() => {
              setFeedback(null);
              void workspace.verifySession();
            }}
          >
            Retry
          </button>
          {isLogoutAvailable ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setFeedback(null);
                void workspace.signOut().then((result) => {
                  if (result.status === 'retryable') {
                    setFeedback(
                      'KendoMenu could not confirm sign-out. You can retry or keep using this device.',
                    );
                  }
                });
              }}
            >
              Sign out
            </button>
          ) : null}
          {isLogoutAvailable ? (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setFeedback(null);
                void workspace.openThisDevice().then((result) => {
                  if (result.status === 'retryable') {
                    setFeedback('KendoMenu could not hide this account yet. Please retry.');
                  }
                });
              }}
            >
              Use this device
            </button>
          ) : null}
        </div>
        {feedback ? <p role="status">{feedback}</p> : null}
      </section>
    </main>
  );
}

export function useAccountWorkspace(): AccountWorkspaceContextValue {
  const value = useContext(AccountWorkspaceContext);
  if (value === null)
    throw new Error('useAccountWorkspace must be inside AccountWorkspaceProvider.');
  return value;
}

export function useOptionalAccountWorkspace(): AccountWorkspaceContextValue | null {
  return useContext(AccountWorkspaceContext);
}
