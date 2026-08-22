import type { MouseEventHandler, ReactElement } from 'react';
import { NavLink } from 'react-router-dom';

import { primaryNavigationItems } from './primary-navigation-items';

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
  return (
    <>
      {primaryNavigationItems.map((item) => (
        <NavLink
          key={item.id}
          className={({ isActive }) => (isActive ? `${linkClassName} is-active` : linkClassName)}
          to={item.to}
          onClick={onNavigate}
        >
          {item.label}
          {item.showsCount ? <span className="nav-count">{libraryCount}</span> : null}
        </NavLink>
      ))}
    </>
  );
}
