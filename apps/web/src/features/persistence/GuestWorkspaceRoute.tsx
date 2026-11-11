/**
 * Keeps guest routes on their independent local workspace and coordinates exits to a verified account.
 * Navigation waits for persistence confirmation; authentication never transfers or replaces guest data.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, matchRoutes, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { WorkspaceShell } from '../../components/WorkspaceShell';
import { GuestApplicationRecovery } from '../errors/ApplicationRecovery';
import { useOptionalTrainingStoreApi } from '../../lib/training-store-context';
import {
  useOptionalWorkspace,
  workspaceBuilderPaths,
  workspacePath,
  type WorkspaceContextValue,
} from '../../lib/workspace-context';
import { WorkspaceContextProvider } from '../../lib/workspace-context-provider';
import { useManagedAuth } from '../../lib/managed-auth-context';
import { getPersistenceStatusLabel, usePersistenceStatus } from './persistence-context';

const guestAccountDestinations = [
  { path: '/app/guest/mitori-room', accountPath: '/app/account/mitori-room' },
  {
    path: workspacePath('/app/guest', workspaceBuilderPaths.create),
    accountPath: workspacePath('/app/account', workspaceBuilderPaths.create),
  },
  { path: '/app/guest/library', accountPath: '/app/account/library' },
  { path: '/app/guest/library/:trainingSetId', accountPath: '/app/account/library' },
];

function accountDestination(pathname: string): string {
  const match = matchRoutes(guestAccountDestinations, pathname)?.[0];
  const trainingSetId = match?.params['trainingSetId'];
  if (trainingSetId !== undefined)
    return `/app/account/library/${encodeURIComponent(trainingSetId)}`;
  return match?.route.accountPath ?? '/app/account/dashboard';
}

export function GuestWorkspaceRoute() {
  const parentWorkspace = useOptionalWorkspace();
  const parentStore = useOptionalTrainingStoreApi();
  if (parentWorkspace?.kind === 'guest' && parentStore !== null) {
    return <GuestWorkspaceContent />;
  }
  return (
    <GuestApplicationRecovery
      recoveryLayout={(recoveryView) => (
        <WorkspaceShell
          basePath="/app/guest"
          contentElement="div"
          userContent={
            <div className="workspace-user-content">
              <p className="workspace-user-eyebrow">Guest mode</p>
              <p>Complete the local data check before returning to your dashboard.</p>
            </div>
          }
        >
          {recoveryView}
        </WorkspaceShell>
      )}
    >
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
  const [signUpPreparationFailed, setSignUpPreparationFailed] = useState(false);
  const [signUpRequest, setSignUpRequest] = useState<{
    readonly identity: typeof identity;
    readonly locationKey: string;
  } | null>(null);
  const signUpGeneration = useRef(0);
  const signUpPendingGeneration = useRef<number | null>(null);
  const signUpContext = useRef<{
    readonly identity: typeof identity;
    readonly locationKey: string;
  } | null>({ identity, locationKey: location.key });
  if (
    signUpRequest !== null &&
    (signUpRequest.identity !== identity || signUpRequest.locationKey !== location.key)
  ) {
    setSignUpRequest(null);
  }
  const builderDirty = persistence.builderDirty ?? false;
  const confirmationGeneration = useRef(0);
  const wantsAccount = identity.status === 'verified' || identity.status === 'uninitialized';
  const confirmGuestExit = useCallback(async () => {
    // Verified identity does not authorize discarding guest edits; require a persisted readback first.
    const requestGeneration = ++confirmationGeneration.current;
    setFailedIdentity(null);
    try {
      await (persistence.confirmExit ?? persistence.flush)();
      if (confirmationGeneration.current !== requestGeneration) return;
      await navigate(
        {
          pathname: accountDestination(location.pathname),
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
  useLayoutEffect(() => {
    signUpContext.current = { identity, locationKey: location.key };
    return () => {
      signUpContext.current = null;
      signUpGeneration.current += 1;
      signUpPendingGeneration.current = null;
    };
  }, [identity, location.key]);
  useEffect(() => {
    let active = true;
    // Automatic account navigation still passes through the guest-save guard.
    if (wantsAccount && !builderDirty) {
      queueMicrotask(() => {
        if (active) void confirmGuestExit();
      });
    }
    return () => {
      active = false;
      confirmationGeneration.current += 1;
    };
  }, [builderDirty, confirmGuestExit, location.key, wantsAccount]);
  const continueToAccount = () => {
    void confirmGuestExit();
  };
  const continueToSignUp = async () => {
    if (signUpPendingGeneration.current !== null) return;
    const requestGeneration = ++signUpGeneration.current;
    const requestIdentity = identity;
    const requestLocationKey = location.key;
    signUpPendingGeneration.current = requestGeneration;
    setSignUpRequest({
      identity: requestIdentity,
      locationKey: requestLocationKey,
    });
    setSignUpPreparationFailed(false);
    try {
      await (persistence.confirmExit ?? persistence.flush)();
      if (
        signUpGeneration.current !== requestGeneration ||
        signUpPendingGeneration.current !== requestGeneration ||
        signUpContext.current?.identity !== requestIdentity ||
        signUpContext.current?.locationKey !== requestLocationKey
      ) {
        return;
      }
      await navigate('/app/sign-in');
    } catch {
      if (
        signUpGeneration.current === requestGeneration &&
        signUpPendingGeneration.current === requestGeneration &&
        signUpContext.current?.identity === requestIdentity &&
        signUpContext.current?.locationKey === requestLocationKey
      ) {
        setSignUpPreparationFailed(true);
      }
    } finally {
      if (
        signUpGeneration.current === requestGeneration &&
        signUpPendingGeneration.current === requestGeneration &&
        signUpContext.current?.identity === requestIdentity &&
        signUpContext.current?.locationKey === requestLocationKey
      ) {
        signUpPendingGeneration.current = null;
        setSignUpRequest(null);
      }
    }
  };
  const isPreparingSignUp =
    signUpRequest !== null &&
    signUpRequest.identity === identity &&
    signUpRequest.locationKey === location.key;
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
      <WorkspaceShell
        basePath="/app/guest"
        userContent={
          <div className="workspace-user-content">
            <p className="workspace-user-eyebrow">Guest mode</p>
            <div
              className={persistence.writeFailed ? 'session-status is-error' : 'session-status'}
              role="status"
              aria-label={getPersistenceStatusLabel(persistence)}
            >
              <span className="status-pulse" aria-hidden="true" />
              <span className="session-status-label">{getPersistenceStatusLabel(persistence)}</span>
            </div>
            <p>Your menus stay on this device.</p>
            <Link
              className="primary-button"
              to="/app/sign-in"
              aria-disabled={isPreparingSignUp}
              onClick={(event) => {
                event.preventDefault();
                void continueToSignUp();
              }}
            >
              {isPreparingSignUp ? 'Checking guest save…' : 'Sign up'}
            </Link>
            {signUpPreparationFailed ? (
              <p role="alert">
                KendoMenu could not confirm your guest dashboard. Your guest workspace remains
                available; retry after checking local storage.
              </p>
            ) : null}
          </div>
        }
      >
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
          <Outlet />
        </div>
      </WorkspaceShell>
    </WorkspaceContextProvider>
  );
}
