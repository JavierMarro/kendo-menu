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
            className="footer-brand-lockup"
            nameClassName="footer-brand-name"
            onClick={onNavigate}
          />
        </div>

        <section className="site-footer-column" aria-labelledby="footer-navigation-title">
          <h2 id="footer-navigation-title">Navigation</h2>
          <nav className="footer-nav" aria-labelledby="footer-navigation-title">
            <PrimaryNavigationLinks linkClassName="footer-nav-item" onNavigate={onNavigate} />
          </nav>
        </section>

        <section className="site-footer-column" aria-labelledby="footer-social-title">
          <h2 id="footer-social-title">Information</h2>
          <nav className="footer-social-links" aria-labelledby="footer-social-title">
            <Link className="footer-social-link" to="/app/sources">
              Sources
            </Link>
            <Link className="footer-social-link" to="/cookies">
              Cookies
            </Link>
            {isInstallActionAvailable ? (
              <button
                ref={registerInstallAction}
                className="footer-social-link install-footer-link"
                type="button"
                onClick={(event) => openInstallExperience(event.currentTarget)}
              >
                Install KendoMenu
              </button>
            ) : null}
          </nav>
        </section>
      </div>
    </footer>
  );
}
