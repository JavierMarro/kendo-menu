import type { MouseEventHandler, ReactElement } from 'react';

import { BrandLockup } from './BrandLockup';
import { PrimaryNavigationLinks } from './PrimaryNavigation';
import { Link } from 'react-router-dom';

interface SiteFooterProps {
  readonly libraryCount: number;
  readonly onNavigate?: MouseEventHandler<HTMLAnchorElement> | undefined;
}

export function SiteFooter({ libraryCount, onNavigate }: SiteFooterProps): ReactElement {
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
            <PrimaryNavigationLinks
              libraryCount={libraryCount}
              linkClassName="footer-nav-item"
              onNavigate={onNavigate}
            />
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
          </nav>
        </section>
      </div>
    </footer>
  );
}
