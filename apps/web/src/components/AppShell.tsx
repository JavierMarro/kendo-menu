/**
 * Composes the shared header, main outlet, and footer around each app route. Navigation links keep
 * the active workspace destination, while the mobile menu closes on Escape and route changes.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

import { BrandLockup } from './BrandLockup';
import { PrimaryNavigationLinks } from './PrimaryNavigation';
import { SiteFooter } from './SiteFooter';

export function AppShell() {
  const location = useLocation();
  const [openLocationKey, setOpenLocationKey] = useState<string | null>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const isMenuOpen = openLocationKey === location.key;
  const isLandingPage = location.pathname === '/app';

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenLocationKey(null);
      menuToggleRef.current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
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
          aria-label="Landing navigation"
        >
          <PrimaryNavigationLinks linkClassName="nav-item" onNavigate={closeMenu} />
          <Link className="nav-item nav-item--get-started" to="/app/sign-in" onClick={closeMenu}>
            <span className="nav-label">Get started</span>
          </Link>
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
