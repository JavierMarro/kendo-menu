/**
 * Gives guest and verified account routes a shared workspace frame without owning either store.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { BrandLockup } from './BrandLockup';
import { SiteFooter } from './SiteFooter';

interface WorkspaceShellProps {
  readonly basePath: '/app/guest' | '/app/account';
  readonly children: ReactNode;
  readonly contentElement?: 'div' | 'main';
  readonly userContent: ReactNode;
}

function WorkspaceIcon({ name }: { readonly name: 'dashboard' | 'library' | 'user' }) {
  if (name === 'dashboard') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
      </svg>
    );
  }
  if (name === 'library') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 5.5h5.5A2.5 2.5 0 0 1 12 8v12a3.5 3.5 0 0 0-3.5-2.5H4z" />
        <path d="M20 5.5h-5.5A2.5 2.5 0 0 0 12 8v12a3.5 3.5 0 0 1 3.5-2.5H20z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

export function WorkspaceShell({
  basePath,
  children,
  contentElement = 'main',
  userContent,
}: WorkspaceShellProps) {
  const location = useLocation();
  const [lastLocationKey, setLastLocationKey] = useState(location.key);
  const [isUserOpen, setIsUserOpen] = useState(false);
  if (lastLocationKey !== location.key) {
    setLastLocationKey(location.key);
    setIsUserOpen(false);
  }
  const menuId = useId();
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const userItemRef = useRef<HTMLLIElement>(null);
  const dashboardPath = `${basePath}/dashboard`;
  const libraryPath = `${basePath}/library`;
  const isDashboard = location.pathname === dashboardPath;
  const isLibrary =
    location.pathname === libraryPath || location.pathname.startsWith(`${libraryPath}/`);

  useEffect(() => {
    if (!isUserOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('dialog[open]') !== null) return;
      setIsUserOpen(false);
      userButtonRef.current?.focus();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (document.querySelector('dialog[open]') !== null) return;
      if (event.target instanceof Node && !userItemRef.current?.contains(event.target)) {
        setIsUserOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isUserOpen]);

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="workspace-desktop-brand">
        <BrandLockup />
      </header>
      <header className="workspace-mobile-brand">
        <BrandLockup />
      </header>
      <nav className="workspace-navigation" aria-label="Workspace navigation">
        <ul className="workspace-navigation-list">
          <li>
            <Link
              className="workspace-navigation-link"
              to={dashboardPath}
              aria-current={isDashboard ? 'page' : undefined}
            >
              <WorkspaceIcon name="dashboard" />
              <span>Dashboard</span>
            </Link>
          </li>
          <li>
            <Link
              className="workspace-navigation-link"
              to={libraryPath}
              aria-current={isLibrary ? 'page' : undefined}
            >
              <WorkspaceIcon name="library" />
              <span>Library</span>
            </Link>
          </li>
          <li ref={userItemRef} className="workspace-user-item">
            <button
              ref={userButtonRef}
              className="workspace-navigation-link workspace-user-toggle"
              type="button"
              aria-expanded={isUserOpen}
              aria-controls={menuId}
              onClick={() => setIsUserOpen((open) => !open)}
            >
              <WorkspaceIcon name="user" />
              <span>User</span>
            </button>
            <div
              id={menuId}
              className="workspace-user-panel"
              role="region"
              aria-label="User options"
              hidden={!isUserOpen}
            >
              {userContent}
            </div>
          </li>
        </ul>
      </nav>
      {contentElement === 'main' ? (
        <main id="main-content" className="workspace-main" tabIndex={-1}>
          {children}
        </main>
      ) : (
        <div id="main-content" className="workspace-main" tabIndex={-1}>
          {children}
        </div>
      )}
      <SiteFooter />
    </div>
  );
}
