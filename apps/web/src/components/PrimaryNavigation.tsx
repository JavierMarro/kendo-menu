import type { MouseEventHandler, ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useOptionalWorkspace, workspacePath } from '../lib/workspace-context';

interface PrimaryNavigationLinksProps {
  readonly linkClassName: string;
  readonly onNavigate?: MouseEventHandler<HTMLAnchorElement> | undefined;
}

export function PrimaryNavigationLinks({
  linkClassName,
  onNavigate,
}: PrimaryNavigationLinksProps): ReactElement {
  const workspace = useOptionalWorkspace();
  const location = useLocation();
  const basePath = location.pathname.startsWith('/app/account')
    ? '/app/account'
    : (workspace?.basePath ?? '/app/guest');
  const primaryNavigationItems = [
    { id: 'how-it-works', label: 'How it works', to: '/app#how-it-works-title' },
    { id: 'library', label: 'Keiko library', to: workspacePath(basePath, 'library') },
    { id: 'dashboard', label: 'Dashboard', to: workspacePath(basePath, 'dashboard') },
    { id: 'faq', label: 'FAQ', to: '/app#faq-title' },
  ] as const;
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
