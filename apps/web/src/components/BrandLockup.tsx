import type { MouseEventHandler, ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';

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
  const location = useLocation();
  const rootClassName = className === undefined ? 'brand-lockup' : `brand-lockup ${className}`;
  const handleClick: MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick?.(event);

    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    if (location.pathname === '/app') {
      if (location.search.length === 0 && location.hash.length === 0) {
        event.preventDefault();
      }
      window.scrollTo({ top: 0, left: 0 });
    }
  };

  return (
    <Link className={rootClassName} to="/app" aria-label="KendoMenu home" onClick={handleClick}>
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
