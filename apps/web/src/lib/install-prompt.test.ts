import { describe, expect, it } from 'vitest';

import { getInstallInstructionsKind, isChromiumBrowser, isIosDevice } from './install-prompt';

describe('install prompt browser detection', () => {
  it('recognizes iPhone, iPad, and touch-enabled iPadOS desktop user agents', () => {
    expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 0)).toBe(
      true,
    );
    expect(isIosDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'iPad', 0)).toBe(true);
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 'MacIntel', 5)).toBe(true);
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 'MacIntel', 0)).toBe(false);
  });

  it('distinguishes Chromium from other desktop browsers', () => {
    expect(isChromiumBrowser('Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36')).toBe(true);
    expect(isChromiumBrowser('Mozilla/5.0 Edg/126.0.0.0 Chrome/126.0.0.0 Safari/537.36')).toBe(
      true,
    );
    expect(isChromiumBrowser('Mozilla/5.0 Version/17.5 Safari/605.1.15')).toBe(false);
  });

  it('prioritizes iOS guidance over the browser user agent', () => {
    expect(
      getInstallInstructionsKind(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/126.0.0.0',
        'iPhone',
        0,
      ),
    ).toBe('ios');
    expect(
      getInstallInstructionsKind('Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36', 'Win32', 0),
    ).toBe('chromium');
    expect(
      getInstallInstructionsKind('Mozilla/5.0 Version/17.5 Safari/605.1.15', 'MacIntel', 0),
    ).toBe('generic');
  });
});
