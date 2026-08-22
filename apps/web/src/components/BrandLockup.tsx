import type { MouseEventHandler, ReactElement } from 'react';
import { Link } from 'react-router-dom';

interface BrandLockupProps {
  readonly className?: string;
  readonly fetchPriority?: 'high' | 'low' | 'auto';
  readonly nameClassName?: string;
  readonly onClick?: MouseEventHandler<HTMLAnchorElement> | undefined;
}

export function BrandLockup({
  className,
  fetchPriority = 'auto',
  nameClassName = 'brand-name',
  onClick,
}: BrandLockupProps): ReactElement {
  const rootClassName = className === undefined ? 'brand-lockup' : `brand-lockup ${className}`;

  return (
    <Link className={rootClassName} to="/app" aria-label="KendoMenu home" onClick={onClick}>
      <span className="brand-logo-frame" aria-hidden="true">
        <img
          className="brand-logo"
          src="/assets/kendo-menu-logo.jpeg"
          alt=""
          width="88"
          height="48"
          fetchPriority={fetchPriority}
        />
      </span>
      <span className={nameClassName}>KendoMenu</span>
    </Link>
  );
}
