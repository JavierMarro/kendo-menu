import { Link, NavLink, Outlet } from 'react-router-dom';

import {
  getPersistenceStatusLabel,
  usePersistenceStatus,
} from '../features/persistence/persistence-context';

interface AppShellProps {
  readonly libraryCount: number;
}

export function AppShell({ libraryCount }: AppShellProps) {
  const { mode, writeFailed } = usePersistenceStatus();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="top-bar">
        <Link className="brand-lockup" to="/app/dashboard" aria-label="KendoMenu dashboard">
          <span className="brand-wordmark">KendoMenu</span>
          <span className="brand-context">Kendo practice</span>
        </Link>
        <nav className="primary-nav" aria-label="Primary navigation">
          <NavLink
            className={({ isActive }) => (isActive ? 'nav-item is-active' : 'nav-item')}
            to="/app/dashboard"
          >
            Dashboard
          </NavLink>
          <NavLink
            className={({ isActive }) => (isActive ? 'nav-item is-active' : 'nav-item')}
            to="/app/library"
          >
            Drill library <span className="nav-count">{libraryCount}</span>
          </NavLink>
          <NavLink
            className={({ isActive }) => (isActive ? 'nav-item is-active' : 'nav-item')}
            to="/app/drills/new"
          >
            Create drill
          </NavLink>
        </nav>
        <div className={writeFailed ? 'session-status is-error' : 'session-status'} role="status">
          <span className="status-pulse" aria-hidden="true" />
          {getPersistenceStatusLabel({ mode, writeFailed })}
        </div>
      </header>

      <main id="main-content" className="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
