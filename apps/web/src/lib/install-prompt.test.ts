import { describe, expect, it } from 'vitest';

import {
  INSTALL_LANDING_VISIT_STORAGE_KEY,
  getInstallInstructionsKind,
  isChromiumBrowser,
  isIosDevice,
  isPhoneClassDevice,
  readInstallLandingVisitCount,
  recordInstallLandingVisit,
} from './install-prompt';

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

  it('recognizes touch-capable iPhone and Android phones without classifying tablets', () => {
    expect(
      isPhoneClassDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 5),
    ).toBe(true);
    expect(
      isPhoneClassDevice(
        'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36',
        'Linux armv8l',
        5,
      ),
    ).toBe(true);
    expect(isPhoneClassDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'iPad', 5)).toBe(
      false,
    );
    expect(
      isPhoneClassDevice(
        'Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 Safari/537.36',
        'Linux armv8l',
        5,
      ),
    ).toBe(false);
  });

  it('rejects macOS, Windows, and Linux desktops even when they support touch', () => {
    expect(isPhoneClassDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)', 'MacIntel', 5)).toBe(
      false,
    );
    expect(isPhoneClassDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 10)).toBe(
      false,
    );
    expect(isPhoneClassDevice('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64', 5)).toBe(false);
    expect(
      isPhoneClassDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 0),
    ).toBe(false);
  });

  it('records the first landing visit and becomes eligible on the second', () => {
    expect(recordInstallLandingVisit(window.localStorage)).toEqual({
      visitCount: 1,
      isAutomaticPromptEligible: false,
    });
    expect(window.localStorage.getItem(INSTALL_LANDING_VISIT_STORAGE_KEY)).toBe('1');

    expect(recordInstallLandingVisit(window.localStorage)).toEqual({
      visitCount: 2,
      isAutomaticPromptEligible: true,
    });
    expect(recordInstallLandingVisit(window.localStorage)).toEqual({
      visitCount: 2,
      isAutomaticPromptEligible: true,
    });
  });

  it('treats malformed or unavailable landing-visit storage as a first visit', () => {
    window.localStorage.setItem(INSTALL_LANDING_VISIT_STORAGE_KEY, 'many');
    expect(readInstallLandingVisitCount(window.localStorage)).toBe(0);

    const unavailableStorage = {
      getItem: () => {
        throw new Error('Storage is unavailable.');
      },
      setItem: () => {
        throw new Error('Storage is unavailable.');
      },
    };
    expect(recordInstallLandingVisit(unavailableStorage)).toEqual({
      visitCount: 1,
      isAutomaticPromptEligible: false,
    });
  });
});
