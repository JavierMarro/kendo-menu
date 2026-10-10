import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { GuestApplicationRecovery } from '../errors/ApplicationRecovery';
import { useOptionalTrainingStoreApi } from '../../lib/training-store-context';
import {
  useOptionalWorkspace,
  WorkspaceContextProvider,
  type WorkspaceContextValue,
} from '../../lib/workspace-context';
import { useManagedAuth } from '../../lib/managed-auth-context';
import { getPersistenceStatusLabel, usePersistenceStatus } from './persistence-context';

function AccountDestination(pathname: string): string {
  if (pathname.endsWith('/drills/new')) return '/app/account/drills/new';
  const detail = pathname.match(/^\/app\/guest\/library\/([^/]+)$/u);
  if (detail !== null) return `/app/account/library/${encodeURIComponent(detail[1] ?? '')}`;
  if (pathname.endsWith('/library')) return '/app/account/library';
  return '/app/account/dashboard';
}

export function GuestWorkspaceRoute() {
  const parentWorkspace = useOptionalWorkspace();
  const parentStore = useOptionalTrainingStoreApi();
  if (parentWorkspace?.kind === 'guest' && parentStore !== null) {
    return <GuestWorkspaceContent />;
  }
  return (
    <GuestApplicationRecovery>
      <GuestWorkspaceContent />
    </GuestApplicationRecovery>
  );
}

function GuestWorkspaceContent() {
  const { identity } = useManagedAuth();
  const persistence = usePersistenceStatus();
  const location = useLocation();
  const navigate = useNavigate();
  const [failedIdentity, setFailedIdentity] = useState<typeof identity | null>(null);
  const builderDirty = persistence.builderDirty ?? false;
  const confirmationGeneration = useRef(0);
  const wantsAccount = identity.status === 'verified' || identity.status === 'uninitialized';
  const confirmGuestExit = useCallback(async () => {
    const requestGeneration = ++confirmationGeneration.current;
    setFailedIdentity(null);
    try {
      await (persistence.confirmExit ?? persistence.flush)();
      if (confirmationGeneration.current !== requestGeneration) return;
      await navigate(
        {
          pathname: AccountDestination(location.pathname),
          search: location.search,
          hash: location.hash,
        },
        { replace: true },
      );
    } catch {
      if (confirmationGeneration.current !== requestGeneration) return;
      setFailedIdentity(identity);
    }
  }, [
    identity,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    persistence.confirmExit,
    persistence.flush,
  ]);
  useEffect(() => {
    let active = true;
    if (wantsAccount && !builderDirty) {
      queueMicrotask(() => {
        if (active) void confirmGuestExit();
      });
    }
    return () => {
      active = false;
      confirmationGeneration.current += 1;
    };
  }, [builderDirty, confirmGuestExit, wantsAccount]);
  const continueToAccount = () => {
    void confirmGuestExit();
  };
  const value = useMemo<WorkspaceContextValue>(
    () => ({
      kind: 'guest',
      basePath: '/app/guest',
      canEdit: !wantsAccount,
      accountEmail: null,
      ...(persistence.onBuilderDirtyChange === undefined
        ? {}
        : { builderDirty: persistence.onBuilderDirtyChange }),
    }),
    [persistence.onBuilderDirtyChange, wantsAccount],
  );
  const confirmError = failedIdentity === identity;
  return (
    <WorkspaceContextProvider value={value}>
      <section
        className="account-route-state"
        role={confirmError ? 'alert' : 'status'}
        hidden={!wantsAccount}
      >
        <h1>
          {confirmError
            ? 'Guest changes could not be confirmed.'
            : builderDirty
              ? 'Your guest session draft is still open.'
              : 'Confirming your guest dashboard…'}
        </h1>
        {builderDirty ? (
          <p>
            Your unfinished session stays in this tab. Continuing to your account discards that
            draft and keeps your guest dashboard on this device.
          </p>
        ) : null}
        {wantsAccount ? (
          <button className="primary-button" type="button" onClick={continueToAccount}>
            Continue to account
          </button>
        ) : null}
        {confirmError ? (
          <>
            <p>
              {builderDirty
                ? 'KendoMenu could not confirm your guest dashboard. Your unfinished session is still in this tab.'
                : 'Your guest workspace remains available. Try again before opening the account.'}
            </p>
            {builderDirty ? null : (
              <button
                className="primary-button"
                type="button"
                onClick={() => void confirmGuestExit()}
              >
                Retry guest save check
              </button>
            )}
          </>
        ) : null}
      </section>
      <div hidden={wantsAccount} inert={wantsAccount} aria-hidden={wantsAccount}>
        <div
          className={persistence.writeFailed ? 'session-status is-error' : 'session-status'}
          role="status"
          aria-label={getPersistenceStatusLabel(persistence)}
        >
          <span className="status-pulse" aria-hidden="true" />
          <span className="session-status-label">{getPersistenceStatusLabel(persistence)}</span>
        </div>
        <GuestAccountShortcut />
        <Outlet />
      </div>
    </WorkspaceContextProvider>
  );
}

function GuestAccountShortcut() {
  const { identity, startGoogleSignIn } = useManagedAuth();
  const persistence = usePersistenceStatus();
  const { setExitConfirmed } = persistence;
  const [error, setError] = useState(false);
  const signInGeneration = useRef(0);
  const signInPending = useRef(false);
  useEffect(() => {
    const restoreExitProtection = () => {
      signInGeneration.current += 1;
      signInPending.current = false;
      setExitConfirmed?.(false);
    };
    window.addEventListener('pageshow', restoreExitProtection);
    window.addEventListener('kendomenu:sign-in-cancelled', restoreExitProtection);
    return () => {
      window.removeEventListener('pageshow', restoreExitProtection);
      window.removeEventListener('kendomenu:sign-in-cancelled', restoreExitProtection);
    };
  }, [setExitConfirmed]);
  const beginGoogleSignIn = async () => {
    if (signInPending.current) return;
    if (
      persistence.builderDirty === true &&
      !window.confirm(
        'Your unfinished guest session is only in this tab. Continue with Google and discard that session draft? Your guest dashboard stays on this device.',
      )
    ) {
      return;
    }
    signInPending.current = true;
    const generation = ++signInGeneration.current;
    try {
      await (persistence.confirmExit ?? persistence.flush)();
      if (generation !== signInGeneration.current) return;
      flushSync(() => setExitConfirmed?.(true));
      const started = await startGoogleSignIn();
      if (generation !== signInGeneration.current) return;
      if (!started) {
        signInPending.current = false;
        flushSync(() => setExitConfirmed?.(false));
        setError(true);
      }
    } catch {
      if (generation !== signInGeneration.current) return;
      signInPending.current = false;
      flushSync(() => setExitConfirmed?.(false));
      setError(true);
    }
  };
  if (identity.status === 'verified' || identity.status === 'uninitialized') return null;
  return (
    <aside className="guest-account-shortcut" aria-busy={identity.status === 'checking'}>
      <p>Keep this dashboard on your device, or sign in to prepare an online account dashboard.</p>
      <button
        className="text-button"
        type="button"
        onClick={() => {
          setError(false);
          void beginGoogleSignIn();
        }}
      >
        Continue with Google
      </button>
      {error ? (
        <p role="alert">
          KendoMenu could not confirm the guest dashboard or start sign-in. Your guest workspace
          remains open; retry when it is ready.
        </p>
      ) : null}
    </aside>
  );
}
