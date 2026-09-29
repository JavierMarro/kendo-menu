/**
 * Provides the shared app navigation and visible device-persistence status.
 * The label comes from the persistence provider, not from an inferred account state.
 * Navigation focus and menu dismissal remain independent of save activity.
 */
import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import {
  getPersistenceStatusLabel,
  usePersistenceStatus,
} from '../features/persistence/persistence-context';
import { useOptionalAccountWorkspace } from '../features/account/AccountWorkspaceProvider';
import { BrandLockup } from './BrandLockup';
import { PrimaryNavigationLinks } from './PrimaryNavigation';
import { SiteFooter } from './SiteFooter';

export function AppShell() {
  const { mode, writeFailed, pending } = usePersistenceStatus();
  const accountWorkspace = useOptionalAccountWorkspace();
  const location = useLocation();
  const [openLocationKey, setOpenLocationKey] = useState<string | null>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const persistenceStatusLabel = getPersistenceStatusLabel({ mode, writeFailed, pending });
  const isMenuOpen = openLocationKey === location.key;
  const isLandingPage = location.pathname === '/app';

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined;
    }

    // Escape closes mobile navigation and restores focus to its controlling button.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      setOpenLocationKey(null);
      menuToggleRef.current?.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMenuOpen]);

  const closeMenu = () => setOpenLocationKey(null);
  const toggleMenu = () => setOpenLocationKey(isMenuOpen ? null : location.key);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="top-bar">
        <BrandLockup onClick={closeMenu} />
        {accountWorkspace?.snapshot.mode === 'account' ? null : (
          <div
            className={writeFailed ? 'session-status is-error' : 'session-status'}
            aria-label={persistenceStatusLabel}
            role="status"
          >
            <span className="status-pulse" aria-hidden="true" />
            <span className="session-status-label">{persistenceStatusLabel}</span>
          </div>
        )}
        {accountWorkspace === null ? null : <AccountSessionControls workspace={accountWorkspace} />}
        <button
          ref={menuToggleRef}
          className="menu-toggle"
          type="button"
          aria-controls="primary-navigation"
          aria-expanded={isMenuOpen}
          aria-label={isMenuOpen ? 'Close navigation' : 'Open navigation'}
          onClick={toggleMenu}
        >
          <span className="menu-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
        <nav
          id="primary-navigation"
          className={isMenuOpen ? 'primary-nav is-open' : 'primary-nav'}
          aria-label="Primary navigation"
        >
          <PrimaryNavigationLinks linkClassName="nav-item" onNavigate={closeMenu} />
        </nav>
      </header>

      <main
        id="main-content"
        className={isLandingPage ? 'main-content main-content--landing' : 'main-content'}
        tabIndex={-1}
      >
        <Outlet />
      </main>
      <SiteFooter onNavigate={closeMenu} />
    </div>
  );
}

function AccountSessionControls({
  workspace,
}: {
  readonly workspace: NonNullable<ReturnType<typeof useOptionalAccountWorkspace>>;
}) {
  const [exitMessage, setExitMessage] = useState<string | null>(null);
  const snapshot = workspace.snapshot;

  if (snapshot.mode === 'account-error') return null;
  if (snapshot.mode === 'account') {
    const identity = snapshot.session.verifiedGoogleEmail
      ? `Signed in as ${snapshot.session.verifiedGoogleEmail}`
      : 'Signed in';
    return (
      <div className="account-session-controls" aria-label="Account session">
        <span>{identity}</span>
        <button
          className="text-button"
          type="button"
          onClick={() => {
            setExitMessage(null);
            void workspace.signOut().then((result) => {
              if (result.status === 'retryable') {
                setExitMessage(
                  result.reason === 'storage'
                    ? 'Sign-out is waiting for local account storage. Your account remains available; retry after storage recovers.'
                    : 'KendoMenu could not sign you out. Check your connection and retry.',
                );
              }
            });
          }}
        >
          Sign out
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => {
            setExitMessage(null);
            void workspace.openThisDevice().then((result) => {
              if (result.status === 'retryable') {
                setExitMessage(
                  result.reason === 'storage'
                    ? 'Could not switch to this device because account changes could not be saved. Your account remains open. Retry when local storage is available.'
                    : 'Could not switch to this device. Your account remains open; please retry.',
                );
              }
            });
          }}
        >
          Use this device
        </button>
        {exitMessage ? <span role="status">{exitMessage}</span> : null}
      </div>
    );
  }
  if (workspace.verification === 'checking') {
    return (
      <span className="account-session-status" role="status">
        Checking account status
      </span>
    );
  }
  if (workspace.verification === 'retryable') {
    return (
      <div className="account-session-controls" role="status">
        <span>Account unavailable; guest use works.</span>
        <button
          type="button"
          className="text-button"
          onClick={() => void workspace.verifySession()}
        >
          Retry
        </button>
      </div>
    );
  }
  if (workspace.verification === 'signed-out') {
    return null;
  }
  return null;
}
