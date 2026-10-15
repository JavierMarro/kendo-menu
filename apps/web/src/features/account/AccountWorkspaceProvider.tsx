/**
 * Owns the verified account route's memory-only draft and connects it to shared workspace UI.
 * Identity uncertainty hides and fences the draft; only matching server verification can reveal it.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Link, Navigate, Outlet, useBlocker, useLocation, useNavigate } from 'react-router-dom';

import { PersistenceContext } from '../persistence/persistence-context';
import { WorkspaceShell } from '../../components/WorkspaceShell';
import { useManagedAuth } from '../../lib/managed-auth-context';
import { TrainingStoreProvider } from '../../lib/training-store-provider';
import { createAccountDraftController } from '../../lib/account-draft';
import { AccountSetupContext } from './AccountSetupPage';
import { WorkspaceContextProvider, type WorkspaceContextValue } from '../../lib/workspace-context';
import type { ManagedAccountInitialization, ManagedAccountRecord } from '../../lib/account-api';

type AccountDraftController = ReturnType<typeof createAccountDraftController>;
type AccountDraftSnapshot = ReturnType<AccountDraftController['getSnapshot']>;

function LoadingStatus({ children }: { readonly children: ReactNode }) {
  return (
    <section className="account-route-state" aria-live="polite">
      <p className="eyebrow">Your account</p>
      <h1>{children}</h1>
    </section>
  );
}

export function AccountWorkspaceRoute() {
  const { api, identity, verifyIdentity, setVerifiedAccount, signOutProvider } = useManagedAuth();
  const [account, setAccount] = useState<ManagedAccountRecord | null>(null);
  const [initialization, setInitialization] = useState<ManagedAccountInitialization | undefined>();
  const [loadErrorIdentity, setLoadErrorIdentity] = useState<typeof identity | null>(null);
  const generation = useRef(0);
  const navigate = useNavigate();
  const releaseCreationHandoff = useCallback(() => {
    setInitialization(undefined);
  }, []);
  const navigateHome = useCallback(() => navigate('/app', { replace: true }), [navigate]);

  if (
    identity.status === 'verified' &&
    (account === null ||
      account.accountId !== identity.account.accountId ||
      account.email !== identity.account.email)
  ) {
    setAccount(identity.account);
  }
  if (
    initialization?.created === true &&
    (identity.status === 'signed-out' ||
      (identity.status === 'verified' && identity.account.accountId !== initialization.accountId))
  ) {
    setInitialization(undefined);
  }

  useEffect(() => {
    if (identity.status !== 'uninitialized') return;
    const current = ++generation.current;
    const controller = new AbortController();
    void api
      .initializeAccount(controller.signal)
      .then((created) => {
        if (generation.current !== current) return;
        setAccount({ accountId: created.accountId, email: created.email });
        setInitialization(created);
        setVerifiedAccount({ accountId: created.accountId, email: created.email });
      })
      .catch(() => {
        if (generation.current === current) setLoadErrorIdentity(identity);
      });
    return () => {
      controller.abort();
      generation.current += 1;
    };
  }, [api, identity, setVerifiedAccount]);

  const routeAccount =
    identity.status === 'verified'
      ? identity.account
      : identity.status === 'checking' || identity.status === 'unavailable'
        ? account
        : null;
  const routeInitialization =
    routeAccount !== null && initialization?.accountId === routeAccount.accountId
      ? initialization
      : undefined;
  const loadError = loadErrorIdentity === identity;

  if (identity.status === 'checking' || (identity.status === 'uninitialized' && !loadError)) {
    if (routeAccount !== null) {
      return (
        <LoadedAccountWorkspace
          key={routeAccount.accountId}
          account={routeAccount}
          initialization={routeInitialization}
          navigateHome={navigateHome}
          signOutProvider={signOutProvider}
          releaseCreationHandoff={releaseCreationHandoff}
        />
      );
    }
    return (
      <AccountWorkspaceFrame userContent={<p>Checking your account access…</p>}>
        <LoadingStatus>Checking your KendoMenu account…</LoadingStatus>
      </AccountWorkspaceFrame>
    );
  }
  if (identity.status === 'signed-out') {
    if (account !== null) return <Navigate replace to="/app" />;
    return <Navigate replace to="/app/sign-in" />;
  }
  if (identity.status === 'unavailable') {
    if (routeAccount !== null) {
      return (
        <LoadedAccountWorkspace
          key={routeAccount.accountId}
          account={routeAccount}
          initialization={routeInitialization}
          navigateHome={navigateHome}
          signOutProvider={signOutProvider}
          releaseCreationHandoff={releaseCreationHandoff}
        />
      );
    }
    return (
      <AccountWorkspaceFrame
        userContent={<p>Account details are hidden until verification succeeds.</p>}
      >
        <section className="account-route-state" role="status">
          <p className="eyebrow">Account connection</p>
          <h1>Your account could not be verified.</h1>
          <p>
            Account content stays hidden until verification succeeds. Guest use remains available.
          </p>
          <div className="empty-actions">
            <button className="primary-button" type="button" onClick={() => void verifyIdentity()}>
              Retry account check
            </button>
            <Link className="secondary-button" to="/app/guest/dashboard">
              Continue as a guest
            </Link>
          </div>
        </section>
      </AccountWorkspaceFrame>
    );
  }
  if (loadError || identity.status === 'uninitialized' || identity.status !== 'verified') {
    return (
      <AccountWorkspaceFrame
        userContent={<p>Account details are hidden until verification succeeds.</p>}
      >
        <section className="account-route-state" role="alert">
          <p className="eyebrow">Account connection</p>
          <h1>KendoMenu could not open your account.</h1>
          <p>No account dashboard was loaded. Retry to verify the account again.</p>
          <button className="primary-button" type="button" onClick={() => void verifyIdentity()}>
            Retry
          </button>
        </section>
      </AccountWorkspaceFrame>
    );
  }

  return (
    <LoadedAccountWorkspace
      key={identity.account.accountId}
      account={identity.account}
      initialization={routeInitialization}
      navigateHome={navigateHome}
      signOutProvider={signOutProvider}
      releaseCreationHandoff={releaseCreationHandoff}
    />
  );
}

function AccountWorkspaceFrame({
  children,
  userContent,
}: {
  readonly children: ReactNode;
  readonly userContent: ReactNode;
}) {
  return (
    <WorkspaceShell basePath="/app/account" userContent={userContent}>
      {children}
    </WorkspaceShell>
  );
}

function LoadedAccountWorkspace({
  account,
  initialization,
  navigateHome,
  signOutProvider,
  releaseCreationHandoff,
}: {
  readonly account: ManagedAccountRecord;
  readonly initialization: ManagedAccountInitialization | undefined;
  readonly navigateHome: () => void;
  readonly signOutProvider: () => Promise<boolean>;
  readonly releaseCreationHandoff: () => void;
}) {
  const { api, identity, verifyIdentity, invalidateIdentity } = useManagedAuth();
  const [initialAccount] = useState(account);
  const [initialHandoff] = useState(initialization);
  const [controller, setController] = useState<AccountDraftController | null>(null);

  useEffect(() => {
    let active = true;
    const created = createAccountDraftController({
      account: initialAccount,
      api,
      onAuthenticationRejected: invalidateIdentity,
      onIdentityChanged: () => void verifyIdentity(),
      onCreationHandoffReleased: releaseCreationHandoff,
      ...(initialHandoff === undefined ? {} : { initialization: initialHandoff }),
    });
    queueMicrotask(() => {
      if (active) {
        setController(created);
        void created.load();
      }
    });
    return () => {
      active = false;
      created.dispose();
    };
  }, [
    api,
    initialAccount,
    initialHandoff,
    invalidateIdentity,
    releaseCreationHandoff,
    verifyIdentity,
  ]);

  if (controller === null) {
    return (
      <AccountWorkspaceFrame userContent={<p>Preparing your account dashboard…</p>}>
        <LoadingStatus>Preparing your account dashboard…</LoadingStatus>
      </AccountWorkspaceFrame>
    );
  }
  return (
    <LoadedAccountWorkspaceView
      account={account}
      controller={controller}
      identity={identity}
      verifyIdentity={verifyIdentity}
      navigateHome={navigateHome}
      signOutProvider={signOutProvider}
    />
  );
}

function LoadedAccountWorkspaceView({
  account,
  controller,
  identity,
  verifyIdentity,
  navigateHome,
  signOutProvider,
}: {
  readonly account: ManagedAccountRecord;
  readonly controller: AccountDraftController;
  readonly identity: ReturnType<typeof useManagedAuth>['identity'];
  readonly verifyIdentity: ReturnType<typeof useManagedAuth>['verifyIdentity'];
  readonly navigateHome: () => void;
  readonly signOutProvider: () => Promise<boolean>;
}) {
  const subscribe = useCallback((notify: () => void) => controller.subscribe(notify), [controller]);
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller]);
  const snapshot: AccountDraftSnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const [builderDirty, setBuilderDirty] = useState(false);
  const [editorDraftDirty, setEditorDraftDirty] = useState(false);
  const [workspaceStoreGeneration, setWorkspaceStoreGeneration] = useState(0);
  const discardDialogRef = useRef<HTMLDialogElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const signOutTriggerRef = useRef<HTMLButtonElement>(null);
  const dialogWasOpened = useRef(false);
  const [lastVisibleStore, setLastVisibleStore] = useState(() => snapshot.store);
  const location = useLocation();
  const navigate = useNavigate();
  const navigateToSetup = useCallback(
    () => navigate('/app/account/setup', { replace: true }),
    [navigate],
  );
  const previousPath = useRef(location.pathname);
  if (snapshot.status === 'disposed' && lastVisibleStore !== null) {
    setLastVisibleStore(() => null);
  } else if (snapshot.store !== null && snapshot.store !== lastVisibleStore) {
    setLastVisibleStore(() => snapshot.store);
  }

  useLayoutEffect(() => {
    controller.setEditingBlocked(
      location.pathname === '/app/account/setup' || controller.getCreationHandoff() !== null,
    );
  }, [controller, location.pathname, snapshot.revision, snapshot.saveState, snapshot.status]);

  useLayoutEffect(() => {
    // Hide before paint on identity changes; only the same account can reveal its retained draft.
    if (identity.status === 'verified' && identity.account.accountId === account.accountId) {
      controller.revealForVerifiedAccount(identity.account);
    } else if (identity.status === 'signed-out') {
      controller.discard();
      navigateHome();
    } else {
      controller.hideForIdentityUncertainty();
    }
  }, [account.accountId, controller, identity, navigateHome]);

  useEffect(() => {
    const updateOnline = () => controller.setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, [controller]);

  useEffect(() => {
    const dialog = discardDialogRef.current;
    if (discardPrompt) {
      dialogWasOpened.current = true;
      if (dialog !== null && !dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      }
      keepEditingRef.current?.focus();
      return;
    }
    if (dialog?.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    if (dialogWasOpened.current) {
      dialogWasOpened.current = false;
      signOutTriggerRef.current?.focus();
    }
  }, [discardPrompt]);

  const discardAndSignOut = async () => {
    controller.discard();
    const confirmed = await signOutProvider();
    setDiscardPrompt(false);
    if (!confirmed) {
      setSignOutError(true);
      return;
    }
    navigateHome();
  };

  const isVerifiedAccount =
    identity.status === 'verified' && identity.account.accountId === account.accountId;
  const isIdentityHidden =
    snapshot.status === 'auth-hidden' || snapshot.status === 'disposed' || !isVerifiedAccount;
  const reloadAccount = useCallback(async () => {
    const current = controller.getSnapshot();
    if (
      current.dirty ||
      editorDraftDirty ||
      current.saveState === 'saving' ||
      current.saveState === 'uncertain'
    ) {
      const confirmed = window.confirm(
        'Unsaved account changes, including any unfinished quantity field, exist only in this tab’s memory. Reloading will discard them. Continue?',
      );
      if (!confirmed) return;
    }
    await controller.reload();
    const reloaded = controller.getSnapshot();
    if (reloaded.store !== null && reloaded.store !== current.store) {
      setEditorDraftDirty(false);
      setWorkspaceStoreGeneration((generation) => generation + 1);
    }
  }, [controller, editorDraftDirty]);
  const downloadAccountDraft = useCallback(() => {
    if (!editorDraftDirty) controller.download();
  }, [controller, editorDraftDirty]);
  const releaseSetupHandoff = useCallback(() => controller.releaseCreationHandoff(), [controller]);
  const submitAdoption = useCallback(
    (request: Parameters<AccountDraftController['submitAdoption']>[0]) =>
      controller.submitAdoption(request),
    [controller],
  );
  const reloadSetupDashboard = useCallback(
    () => controller.loadAuthoritativeDashboard(),
    [controller],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      kind: 'account',
      basePath: '/app/account',
      canEdit: snapshot.canEdit && isVerifiedAccount,
      accountEmail: account.email,
      saveToAccount: () => controller.save(),
      retrySave: () => controller.retrySave(),
      reloadAccount,
      downloadAccountDraft,
      saveLabel: snapshot.saveState,
      saveError: snapshot.error,
      isDirty: snapshot.dirty,
      builderDirty: setBuilderDirty,
      hasUncommittedEditorDraft: editorDraftDirty,
      onEditorDraftDirtyChange: setEditorDraftDirty,
    }),
    [
      account.email,
      controller,
      downloadAccountDraft,
      editorDraftDirty,
      isVerifiedAccount,
      reloadAccount,
      setEditorDraftDirty,
      snapshot,
    ],
  );
  const pending = snapshot.saveState === 'saving' || snapshot.saveState === 'uncertain';
  const warnBeforeLeaving =
    builderDirty ||
    (snapshot.status !== 'disposed' && editorDraftDirty) ||
    snapshot.dirty ||
    snapshot.saveState === 'uncertain' ||
    snapshot.saveState === 'saving';
  const navigationGuard = (
    <AccountNavigationGuard
      shouldWarn={warnBeforeLeaving}
      builderDirty={builderDirty}
      editorDraftDirty={snapshot.status !== 'disposed' && editorDraftDirty}
      onEditorDraftDiscard={() => setEditorDraftDirty(false)}
    />
  );
  const isLoadState = snapshot.status === 'loading' || snapshot.status === 'load-error';
  const isVisible = !isIdentityHidden && !isLoadState && snapshot.store !== null;
  const workspaceStore = snapshot.store ?? lastVisibleStore;
  // Setup consumes only the controller's live creation handoff at an authoritative empty revision.
  const currentHandoff =
    isVerifiedAccount && snapshot.revision === '0' ? controller.getCreationHandoff() : null;
  const shouldOpenSetup =
    currentHandoff !== null &&
    snapshot.status === 'ready' &&
    location.pathname !== '/app/account/setup';
  const userContent = isIdentityHidden ? (
    <p>Account details are hidden until verification succeeds.</p>
  ) : (
    <div className="workspace-user-content account-session-controls" aria-label="Account session">
      <p className="workspace-user-eyebrow">Account</p>
      <p>{account.email ? `Signed in as ${account.email}` : 'Signed in'}</p>
      <button
        ref={signOutTriggerRef}
        className="text-button"
        type="button"
        onClick={() => {
          if (warnBeforeLeaving) setDiscardPrompt(true);
          else void discardAndSignOut();
        }}
      >
        Sign out
      </button>
      {signOutError ? (
        <span role="alert">
          KendoMenu could not confirm sign-out. Retry after checking the connection.
        </span>
      ) : null}
      <div className="workspace-delete-account">
        <button type="button" disabled aria-describedby="account-delete-status">
          Delete account
        </button>
        <span id="account-delete-status">Coming soon</span>
      </div>
    </div>
  );

  useEffect(() => {
    const leftSetup =
      previousPath.current === '/app/account/setup' && location.pathname !== '/app/account/setup';
    previousPath.current = location.pathname;
    if (leftSetup) {
      controller.releaseCreationHandoff();
      return;
    }
    if (shouldOpenSetup) void navigateToSetup();
  }, [controller, location.pathname, navigateToSetup, shouldOpenSetup]);

  const setupValue = useMemo(
    () => ({
      accountId: account.accountId,
      handoff: currentHandoff,
      revision: snapshot.revision,
      catalogueVersion: snapshot.catalogueVersion,
      ready: snapshot.status === 'ready' && isVerifiedAccount,
      identityVerified: isVerifiedAccount,
      dashboardStatus: snapshot.status,
      dashboardLoaded:
        snapshot.store !== null &&
        snapshot.status !== 'loading' &&
        snapshot.status !== 'load-error' &&
        !isIdentityHidden,
      submit: submitAdoption,
      release: releaseSetupHandoff,
      reload: reloadSetupDashboard,
    }),
    [
      account.accountId,
      currentHandoff,
      isIdentityHidden,
      isVerifiedAccount,
      reloadSetupDashboard,
      releaseSetupHandoff,
      snapshot.catalogueVersion,
      snapshot.revision,
      snapshot.status,
      snapshot.store,
      submitAdoption,
    ],
  );

  return shouldOpenSetup ? (
    <AccountWorkspaceFrame userContent={<p>Preparing your account dashboard…</p>}>
      <LoadingStatus>Preparing your account setup…</LoadingStatus>
    </AccountWorkspaceFrame>
  ) : (
    <WorkspaceContextProvider value={value}>
      <AccountSetupContext.Provider value={setupValue}>
        <PersistenceContext.Provider
          value={{
            mode: 'account',
            writeFailed: snapshot.saveState === 'uncertain' || snapshot.saveState === 'blocked',
            pending,
            flush: () => Promise.resolve(),
            canEdit: snapshot.canEdit,
            dirty: snapshot.dirty,
            saveState: snapshot.saveState,
            save: () => controller.save(),
            retry: () => controller.retrySave(),
            reload: reloadAccount,
            download: downloadAccountDraft,
            downloadAllowed: !editorDraftDirty,
            error: snapshot.error,
          }}
        >
          <WorkspaceShell basePath="/app/account" userContent={userContent}>
            {navigationGuard}
            {isLoadState ? (
              <section
                className="account-route-state"
                role={snapshot.status === 'load-error' ? 'alert' : 'status'}
              >
                <p className="eyebrow">Your account</p>
                <h1>
                  {snapshot.status === 'loading'
                    ? 'Loading your dashboard…'
                    : 'Your dashboard could not be loaded.'}
                </h1>
                {snapshot.status === 'load-error' ? (
                  <>
                    <p>
                      {snapshot.error ??
                        'The account service is unavailable. Your account was not changed.'}
                    </p>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => void reloadAccount()}
                    >
                      Retry
                    </button>
                  </>
                ) : null}
              </section>
            ) : null}
            {isIdentityHidden ? (
              <section className="account-route-state" role="status">
                <p className="eyebrow">Account verification</p>
                <h1>Your account is hidden until it can be verified.</h1>
                <p>
                  {signOutError
                    ? 'KendoMenu could not confirm sign-out. Your account remains hidden until you retry sign-out.'
                    : 'Your current-tab draft is retained in memory. Verify the same account to reveal it.'}
                </p>
                {signOutError ? (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() =>
                      void signOutProvider().then((signedOut) => {
                        if (signedOut) navigateHome();
                      })
                    }
                  >
                    Retry sign-out
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void verifyIdentity()}
                  >
                    Retry verification
                  </button>
                )}
              </section>
            ) : null}
            {!isIdentityHidden && snapshot.status === 'unavailable' ? (
              <aside className="persistence-warning" role="status">
                <h2>Account service unavailable</h2>
                <p>
                  Your draft stays in this tab’s memory and is read-only until the service returns.
                  Reloading or closing this tab can lose it.
                </p>
                {snapshot.error ? <p>{snapshot.error}</p> : null}
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void controller.checkAvailability()}
                >
                  Retry connection
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={downloadAccountDraft}
                  disabled={editorDraftDirty}
                >
                  Download draft
                </button>
                {editorDraftDirty ? (
                  <p>
                    Complete or clear the unfinished quantity field before downloading the account
                    draft.
                  </p>
                ) : null}
              </aside>
            ) : null}
            {!isIdentityHidden &&
            (snapshot.dirty || editorDraftDirty || snapshot.saveState === 'uncertain') ? (
              <aside className="persistence-warning" role="status">
                <p>
                  {snapshot.saveState === 'uncertain'
                    ? 'Save status is uncertain. Retry the same save to confirm it.'
                    : editorDraftDirty
                      ? 'An unfinished quantity field is held in this tab and is not part of the account save yet. Complete or clear it before leaving; reloading or closing this tab can lose it.'
                      : 'Account changes are held in memory until you save. Reloading or closing this tab can lose unsaved changes.'}
                </p>
                {!editorDraftDirty ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={downloadAccountDraft}
                    disabled={editorDraftDirty}
                  >
                    Download draft
                  </button>
                ) : null}
              </aside>
            ) : null}
            <div key={workspaceStoreGeneration} hidden={!isVisible} inert={!isVisible}>
              {workspaceStore === null ? null : (
                <TrainingStoreProvider store={workspaceStore}>
                  <Outlet />
                </TrainingStoreProvider>
              )}
            </div>
            {discardPrompt ? (
              <dialog
                ref={discardDialogRef}
                className="confirmation-dialog"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="account-exit-title"
                onCancel={(event) => {
                  event.preventDefault();
                  setDiscardPrompt(false);
                }}
                onClose={() => setDiscardPrompt(false)}
              >
                <h2 id="account-exit-title">Leave this account?</h2>
                <p>
                  Unsaved account changes, including any unfinished quantity field, exist only in
                  this tab’s memory. Sign-out discards them. Reloading or closing this tab can also
                  lose them.
                </p>
                <div className="dialog-actions">
                  <button
                    ref={keepEditingRef}
                    className="secondary-button"
                    type="button"
                    onClick={() => setDiscardPrompt(false)}
                  >
                    Keep editing
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void discardAndSignOut()}
                  >
                    Discard and sign out
                  </button>
                </div>
              </dialog>
            ) : null}
          </WorkspaceShell>
        </PersistenceContext.Provider>
      </AccountSetupContext.Provider>
    </WorkspaceContextProvider>
  );
}

function AccountNavigationGuard({
  shouldWarn,
  builderDirty,
  editorDraftDirty,
  onEditorDraftDiscard,
}: {
  readonly shouldWarn: boolean;
  readonly builderDirty: boolean;
  readonly editorDraftDirty: boolean;
  readonly onEditorDraftDiscard: () => void;
}) {
  useBlocker(({ currentLocation, nextLocation }) => {
    if (!shouldWarn) return false;
    if (builderDirty && currentLocation.pathname.endsWith('/drills/new')) {
      return !window.confirm(
        'Your custom-session draft exists only in memory and may be lost. Leave this page?',
      );
    }
    if (editorDraftDirty && currentLocation.pathname !== nextLocation.pathname) {
      const confirmed = window.confirm(
        'Unsaved account editor values and account changes exist only in this tab’s memory and may be lost. Leave this page?',
      );
      if (confirmed) onEditorDraftDiscard();
      return !confirmed;
    }
    if (nextLocation.pathname.startsWith('/app/account/')) return false;
    return !window.confirm(
      'Unsaved account changes exist only in this tab’s memory and may be lost. Leave the account?',
    );
  });
  useEffect(() => {
    if (!shouldWarn) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [shouldWarn]);
  return null;
}

export function AccountWorkspaceIndex() {
  return <Navigate replace to="/app/account/dashboard" />;
}
