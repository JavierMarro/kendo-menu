import { afterEach, describe, expect, it } from 'vitest';

import {
  CANONICAL_ORIGIN,
  getCanonicalUrl,
  shouldNoIndexRoute,
  updateRouteMetadata,
} from './route-metadata';

afterEach(() => {
  document.head
    .querySelectorAll('link[rel="canonical"], meta[data-kendo-menu-route-metadata]')
    .forEach((element) => element.remove());
});

describe('canonical and indexing boundaries', () => {
  it.each([
    '//external.example',
    '/\\external.example',
    'https://external.example',
    '/app/dashboard',
    '/app/drills/new',
    '/app/library/private-id',
    '/missing',
    '//app',
  ])('keeps %s on the canonical origin and out of the index', (pathname) => {
    expect(getCanonicalUrl(pathname)).toBe(`${CANONICAL_ORIGIN}/app`);
    expect(shouldNoIndexRoute(pathname, '', '')).toBe(true);
  });

  it.each(['/app', '/app/library', '/app/sources', '/cookies'])(
    'canonicalizes the public route %s',
    (pathname) => {
      expect(getCanonicalUrl(`${pathname}/`)).toBe(`${CANONICAL_ORIGIN}${pathname}`);
      expect(shouldNoIndexRoute(pathname, '', '')).toBe(false);
      expect(shouldNoIndexRoute(pathname, '?personal=value', '')).toBe(true);
      expect(shouldNoIndexRoute(pathname, '', '#section')).toBe(true);
    },
  );

  it('removes route noindex on client navigation without duplicating canonical or OG metadata', () => {
    updateRouteMetadata({ pathname: '/missing', search: '', hash: '', title: 'Not found' });
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
    updateRouteMetadata({ pathname: '/app', search: '', hash: '', title: 'Plan your keiko' });
    updateRouteMetadata({ pathname: '/app', search: '', hash: '', title: 'Plan your keiko' });
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[property="og:url"]')).toHaveLength(1);
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${CANONICAL_ORIGIN}/app`,
    );
  });
});
