export const CANONICAL_ORIGIN = 'https://www.kendomenu.com';

const ROUTE_METADATA_ATTRIBUTE = 'data-kendo-menu-route-metadata';

function normalizePathname(pathname: string): string {
  if (pathname === '/') return '/app';
  return pathname.replace(/\/+$/, '');
}

function isCanonicalRoute(pathname: string): boolean {
  const normalizedPathname = normalizePathname(pathname);

  return (
    normalizedPathname === '/app' ||
    normalizedPathname === '/app/library' ||
    normalizedPathname === '/app/sources' ||
    normalizedPathname === '/app/glossary' ||
    normalizedPathname === '/cookies'
  );
}

export function getCanonicalUrl(pathname: string): string {
  const canonicalPathname = isCanonicalRoute(pathname) ? normalizePathname(pathname) : '/app';
  return new URL(canonicalPathname, CANONICAL_ORIGIN).href;
}

export function shouldNoIndexRoute(pathname: string, search: string, hash: string): boolean {
  return search.length > 0 || hash.length > 0 || !isCanonicalRoute(pathname);
}

function ensureCanonicalLink(): HTMLLinkElement {
  const existingLink = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (existingLink !== null) {
    return existingLink;
  }

  const link = document.createElement('link');
  link.rel = 'canonical';
  document.head.append(link);
  return link;
}

function ensureMeta(attribute: 'name' | 'property', value: string): HTMLMetaElement {
  const existingMeta = document.head.querySelector<HTMLMetaElement>(
    `meta[${attribute}="${value}"]`,
  );
  if (existingMeta !== null) {
    return existingMeta;
  }

  const meta = document.createElement('meta');
  meta.setAttribute(attribute, value);
  meta.setAttribute(ROUTE_METADATA_ATTRIBUTE, 'true');
  document.head.append(meta);
  return meta;
}

function removeRouteNoIndexMetadata(): void {
  for (const meta of document.head.querySelectorAll<HTMLMetaElement>(
    `meta[name="robots"][${ROUTE_METADATA_ATTRIBUTE}]`,
  )) {
    meta.remove();
  }
}

function updateRobotsMetadata(shouldNoIndex: boolean): void {
  if (!shouldNoIndex) {
    removeRouteNoIndexMetadata();
    return;
  }

  const robots = ensureMeta('name', 'robots');
  robots.setAttribute(ROUTE_METADATA_ATTRIBUTE, 'true');
  robots.content = 'noindex, nofollow';
}

export interface RouteMetadataInput {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly title: string;
}

export function updateRouteMetadata({ pathname, search, hash, title }: RouteMetadataInput): void {
  if (typeof document === 'undefined') {
    return;
  }

  const noIndex = shouldNoIndexRoute(pathname, search, hash);
  const canonicalUrl = getCanonicalUrl(noIndex ? '/app' : pathname);
  const canonicalLink = ensureCanonicalLink();
  canonicalLink.href = canonicalUrl;

  const openGraphUrl = ensureMeta('property', 'og:url');
  openGraphUrl.content = canonicalUrl;

  document.title = `${title} · KendoMenu`;
  updateRobotsMetadata(noIndex);
}
