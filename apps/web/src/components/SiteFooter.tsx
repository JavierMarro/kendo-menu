/**
 * Renders shared navigation, information links, and the install action from route-level contexts.
 * The provider supplies prompt state and focus restoration to the landing-page and footer actions.
 */
import type { MouseEventHandler, ReactElement } from 'react';

import { useInstallExperience } from '../features/install/install-context';
import { BrandLockup } from './BrandLockup';
import { PrimaryNavigationLinks } from './PrimaryNavigation';
import { Link } from 'react-router-dom';

interface SiteFooterProps {
  readonly onNavigate?: MouseEventHandler<HTMLAnchorElement> | undefined;
}

export function SiteFooter({ onNavigate }: SiteFooterProps): ReactElement {
  const { isInstallActionAvailable, openInstallExperience, registerInstallAction } =
    useInstallExperience();

  return (
    <footer className="site-footer" aria-label="Site footer">
      <div className="site-footer-grid">
        <div className="site-footer-column site-footer-brand-column">
          <BrandLockup
            compact
            className="footer-brand-lockup"
            nameClassName="footer-brand-name"
            onClick={onNavigate}
          />
        </div>

        <section className="site-footer-column" aria-labelledby="footer-navigation-title">
          <h2 id="footer-navigation-title">Navigation</h2>
          <nav className="footer-nav" aria-labelledby="footer-navigation-title">
            <PrimaryNavigationLinks linkClassName="footer-nav-item" onNavigate={onNavigate} />
            {isInstallActionAvailable ? (
              <button
                ref={registerInstallAction}
                className="footer-social-link install-footer-link"
                type="button"
                onClick={(event) => openInstallExperience(event.currentTarget)}
              >
                Install as app
              </button>
            ) : null}
          </nav>
        </section>

        <section className="site-footer-column" aria-labelledby="footer-social-title">
          <h2 id="footer-social-title">Information</h2>
          <nav className="footer-social-links" aria-labelledby="footer-social-title">
            <a
              className="footer-social-link"
              href="https://github.com/JavierMarro/kendo-menu"
              aria-label="GitHub"
            >
              <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="currentColor"
                  d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.726-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.73.083-.73 1.205.084 1.84 1.236 1.84 1.236 1.07 1.835 2.807 1.305 3.492.998.108-.776.418-1.305.762-1.605-2.665-.303-5.467-1.332-5.467-5.93 0-1.31.47-2.38 1.236-3.22-.124-.303-.536-1.524.117-3.176 0 0 1.008-.322 3.3 1.23.956-.266 1.98-.4 3-.405 1.02.005 2.044.14 3 .405 2.29-1.552 3.297-1.23 3.297-1.23.655 1.652.243 2.873.12 3.176.77.84 1.233 1.91 1.233 3.22 0 4.61-2.807 5.624-5.48 5.92.43.372.823 1.102.823 2.222 0 1.604-.015 2.896-.015 3.286 0 .322.216.694.825.576C20.565 22.092 24 17.595 24 12.297c0-6.627-5.373-12-12-12"
                />
              </svg>
              GitHub
            </a>
            <Link className="footer-social-link" to="/app/sources" onClick={onNavigate}>
              Sources
            </Link>
            <Link className="footer-social-link" to="/cookies" onClick={onNavigate}>
              Cookies
            </Link>
            <Link className="footer-social-link" to="/privacy" onClick={onNavigate}>
              Privacy
            </Link>
          </nav>
        </section>
      </div>
    </footer>
  );
}
