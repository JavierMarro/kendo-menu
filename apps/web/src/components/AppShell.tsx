import type { ReactNode } from 'react';

export type AppView = 'dashboard' | 'library';

interface AppShellProps {
  readonly activeView: AppView;
  readonly libraryCount: number;
  readonly onViewChange: (view: AppView) => void;
  readonly children: ReactNode;
}

export function AppShell({ activeView, libraryCount, onViewChange, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            結
          </span>
          <div>
            <p className="eyebrow">Kendo practice</p>
            <h1>KendoMenu</h1>
          </div>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          <button
            className={activeView === 'dashboard' ? 'nav-item is-active' : 'nav-item'}
            type="button"
            onClick={() => onViewChange('dashboard')}
          >
            <span aria-hidden="true">▦</span>
            Dashboard
          </button>
          <button
            className={activeView === 'library' ? 'nav-item is-active' : 'nav-item'}
            type="button"
            onClick={() => onViewChange('library')}
          >
            <span aria-hidden="true">◫</span>
            Drill library
            <span className="nav-count">{libraryCount}</span>
          </button>
        </nav>

        <div className="sidebar-note">
          <span className="note-dot" aria-hidden="true" />
          <p>Your sessions stay on this device in the free tier.</p>
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
