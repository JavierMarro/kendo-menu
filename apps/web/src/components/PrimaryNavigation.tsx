/** The public navigation stays on the informational landing page. */
import type { MouseEventHandler, ReactElement } from 'react';
import { Link } from 'react-router-dom';

interface PrimaryNavigationLinksProps {
  readonly linkClassName: string;
  readonly onNavigate?: MouseEventHandler<HTMLAnchorElement> | undefined;
}

export function PrimaryNavigationLinks({
  linkClassName,
  onNavigate,
}: PrimaryNavigationLinksProps): ReactElement {
  const primaryNavigationItems = [
    { id: 'how-it-works', label: 'How it works', to: '/app#how-it-works-title' },
    { id: 'library', label: 'Keiko menus', to: '/app#library-story-title' },
    { id: 'faq', label: 'FAQ', to: '/app#faq-title' },
  ] as const;
  return (
    <>
      {primaryNavigationItems.map((item) => {
        return (
          <Link key={item.id} className={linkClassName} to={item.to} onClick={onNavigate}>
            <span className="nav-label">{item.label}</span>
          </Link>
        );
      })}
    </>
  );
}
