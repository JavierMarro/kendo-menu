import { useEffect, type MouseEventHandler, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';

const primaryNavigationItems = [
  { id: 'how-it-works', label: 'How it works', to: '/app#how-it-works-title', showsCount: false },
  { id: 'library', label: 'Keiko library', to: '/app/library', showsCount: true },
  { id: 'dashboard', label: 'Dashboard', to: '/app/dashboard', showsCount: false },
  { id: 'faq', label: 'FAQ', to: '/app#faq-title', showsCount: false },
] as const;

interface PrimaryNavigationLinksProps {
  readonly libraryCount: number;
  readonly linkClassName: string;
  readonly onNavigate?: MouseEventHandler<HTMLAnchorElement> | undefined;
}

export function PrimaryNavigationLinks({
  libraryCount,
  linkClassName,
  onNavigate,
}: PrimaryNavigationLinksProps): ReactElement {
  const location = useLocation();

  useEffect(() => {
    const targetId = location.hash.slice(1);
    if (targetId.length > 0) {
      document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
    }
  }, [location.hash, location.pathname]);

  return (
    <>
      {primaryNavigationItems.map((item) => {
        return (
          <Link key={item.id} className={linkClassName} to={item.to} onClick={onNavigate}>
            {item.label}
            {item.showsCount ? <span className="nav-count">{libraryCount}</span> : null}
          </Link>
        );
      })}
    </>
  );
}
