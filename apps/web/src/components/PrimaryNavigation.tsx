import type { MouseEventHandler, ReactElement } from 'react';
import { Link } from 'react-router-dom';

const primaryNavigationItems = [
  { id: 'how-it-works', label: 'How it works', to: '/app#how-it-works-title' },
  { id: 'library', label: 'Keiko library', to: '/app/library' },
  { id: 'dashboard', label: 'Dashboard', to: '/app/dashboard' },
  { id: 'faq', label: 'FAQ', to: '/app#faq-title' },
] as const;

interface PrimaryNavigationLinksProps {
  readonly linkClassName: string;
  readonly onNavigate?: MouseEventHandler<HTMLAnchorElement> | undefined;
}

export function PrimaryNavigationLinks({
  linkClassName,
  onNavigate,
}: PrimaryNavigationLinksProps): ReactElement {
  return (
    <>
      {primaryNavigationItems.map((item) => {
        return (
          <Link key={item.id} className={linkClassName} to={item.to} onClick={onNavigate}>
            {item.id === 'library' ? (
              <span className="nav-label nav-label--wrappable">
                <span className="nav-label-word">Keiko</span>{' '}
                <span className="nav-label-word">library</span>
              </span>
            ) : (
              <span className="nav-label">{item.label}</span>
            )}
          </Link>
        );
      })}
    </>
  );
}
