import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import {
  getPersistenceStatusLabel,
  usePersistenceStatus,
} from '../features/persistence/persistence-context';

interface AppShellProps {
  readonly libraryCount: number;
}

export function AppShell({ libraryCount }: AppShellProps) {
  const { mode, writeFailed } = usePersistenceStatus();
  const location = useLocation();
  const [openLocationKey, setOpenLocationKey] = useState<string | null>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const persistenceStatusLabel = getPersistenceStatusLabel({ mode, writeFailed });
  const isMenuOpen = openLocationKey === location.key;
  const isLandingPage = location.pathname === '/app';

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined;
    }

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
        <Link className="brand-lockup" to="/app" aria-label="KendoMenu home" onClick={closeMenu}>
          <span className="brand-logo-frame" aria-hidden="true">
            <img
              className="brand-logo"
              src="/assets/kendo-menu-logo.jpeg"
              alt=""
              width="88"
              height="48"
              fetchPriority="high"
            />
          </span>
          <span className="brand-name">KendoMenu</span>
        </Link>
        <div
          className={writeFailed ? 'session-status is-error' : 'session-status'}
          aria-label={persistenceStatusLabel}
          role="status"
        >
          <span className="status-pulse" aria-hidden="true" />
          <span className="session-status-label">{persistenceStatusLabel}</span>
        </div>
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
          <NavLink
            className={({ isActive }) => (isActive ? 'nav-item is-active' : 'nav-item')}
            to="/app/library"
            onClick={closeMenu}
          >
            Drill library <span className="nav-count">{libraryCount}</span>
          </NavLink>
          <NavLink
            className={({ isActive }) => (isActive ? 'nav-item is-active' : 'nav-item')}
            to="/app/dashboard"
            onClick={closeMenu}
          >
            Dashboard
          </NavLink>
          <NavLink
            className={({ isActive }) => (isActive ? 'nav-item is-active' : 'nav-item')}
            to="/app/drills/new"
            onClick={closeMenu}
          >
            Create drill
          </NavLink>
        </nav>
      </header>

      <main
        id="main-content"
        className={isLandingPage ? 'main-content main-content--landing' : 'main-content'}
        tabIndex={-1}
      >
        <Outlet />
      </main>
    </div>
  );
}
