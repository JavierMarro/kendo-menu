import { afterEach, describe, expect, it, vi } from 'vitest';

import { getGuestPageviewPath, scheduleGuestPageview } from './guest-pageview';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('guest analytics page mapping', () => {
  it('maps supported routes to static, non-sensitive paths', () => {
    expect(getGuestPageviewPath('/app/dashboard')).toBe('/app/dashboard');
    expect(getGuestPageviewPath('/app/library/private-session-id')).toBe('/app/library/session');
    expect(getGuestPageviewPath('/cookies')).toBe('/cookies');
  });

  it('maps unknown routes to one fixed path', () => {
    expect(getGuestPageviewPath('/profile/private-email')).toBe('/404');
  });

  it('cancels a verified signed-out pageview when the browser goes offline before emission', () => {
    vi.useFakeTimers();
    const sendPixel = vi.spyOn(HTMLImageElement.prototype, 'src', 'set');
    const cancel = scheduleGuestPageview('/app/dashboard');

    window.dispatchEvent(new Event('offline'));
    vi.advanceTimersByTime(1_000);

    expect(sendPixel).not.toHaveBeenCalled();
    expect(cancel()).toBe(true);
  });
});
