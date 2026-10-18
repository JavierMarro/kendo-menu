import { afterEach, describe, expect, it, vi } from 'vitest';

import { getGuestPageviewPath, scheduleGuestPageview } from './guest-pageview';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('guest analytics page mapping', () => {
  it('maps supported routes to static, non-sensitive paths', () => {
    expect(getGuestPageviewPath('/app/guest/dashboard')).toBe('/app/guest/dashboard');
    expect(getGuestPageviewPath('/app/guest/library/private-session-id')).toBe(
      '/app/guest/library/session',
    );
    expect(getGuestPageviewPath('/app/dashboard')).toBe('/app/guest/dashboard');
    expect(getGuestPageviewPath('/privacy')).toBe('/privacy');
    expect(getGuestPageviewPath('/cookies')).toBe('/cookies');
  });

  it('maps unknown routes to one fixed path', () => {
    expect(getGuestPageviewPath('/profile/private-email')).toBe('/404');
  });

  it('cancels a verified signed-out pageview when the browser goes offline before emission', () => {
    vi.useFakeTimers();
    const sendPixel = vi.spyOn(HTMLImageElement.prototype, 'src', 'set');
    const cancel = scheduleGuestPageview('/app/guest/dashboard');

    window.dispatchEvent(new Event('offline'));
    vi.advanceTimersByTime(1_000);

    expect(sendPixel).not.toHaveBeenCalled();
    expect(cancel()).toBe(true);
  });
});
