import type { MouseEventHandler, ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';

interface BrandLockupProps {
  readonly className?: string;
  readonly compact?: boolean;
  readonly nameClassName?: string;
  readonly onClick?: MouseEventHandler<HTMLAnchorElement> | undefined;
}

export function BrandLockup({
  className,
  compact = false,
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
        <picture>
          <source
            type="image/avif"
            srcSet="/assets/kendo-menu-logo-44.avif 44w, /assets/kendo-menu-logo-88.avif 88w, /assets/kendo-menu-logo-176.avif 176w, /assets/kendo-menu-logo-264.avif 264w"
            sizes={compact ? '44px' : '88px'}
          />
          <source
            type="image/webp"
            srcSet="/assets/kendo-menu-logo-44.webp 44w, /assets/kendo-menu-logo-88.webp 88w, /assets/kendo-menu-logo-176.webp 176w, /assets/kendo-menu-logo-264.webp 264w"
            sizes={compact ? '44px' : '88px'}
          />
          <img
            className="brand-logo"
            src="/assets/kendo-menu-logo-88.jpeg"
            srcSet="/assets/kendo-menu-logo-44.jpeg 44w, /assets/kendo-menu-logo-88.jpeg 88w, /assets/kendo-menu-logo-176.jpeg 176w, /assets/kendo-menu-logo-264.jpeg 264w"
            sizes={compact ? '44px' : '88px'}
            alt=""
            width="88"
            height="44"
            loading={compact ? 'lazy' : undefined}
          />
        </picture>
      </span>
      <span className={nameClassName}>KendoMenu</span>
    </Link>
  );
}
