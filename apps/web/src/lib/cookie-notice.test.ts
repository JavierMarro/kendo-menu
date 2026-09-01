import { describe, expect, it } from 'vitest';

import {
  COOKIE_NOTICE_ACKNOWLEDGEMENT_DURATION_MS,
  COOKIE_NOTICE_ACKNOWLEDGEMENT_STORAGE_KEY,
  persistCookieNoticeAcknowledgement,
  readCookieNoticeAcknowledgement,
} from './cookie-notice';

describe('cookie notice acknowledgement', () => {
  it('persists an explicit 21-day expiry and treats the exact expiry as unacknowledged', () => {
    const now = Date.UTC(2026, 7, 31, 12);

    expect(persistCookieNoticeAcknowledgement(window.localStorage, now)).toBe(true);
    expect(window.localStorage.getItem(COOKIE_NOTICE_ACKNOWLEDGEMENT_STORAGE_KEY)).toBe(
      String(now + COOKIE_NOTICE_ACKNOWLEDGEMENT_DURATION_MS),
    );
    expect(
      readCookieNoticeAcknowledgement(
        window.localStorage,
        now + COOKIE_NOTICE_ACKNOWLEDGEMENT_DURATION_MS - 1,
      ),
    ).toBe(true);
    expect(
      readCookieNoticeAcknowledgement(
        window.localStorage,
        now + COOKIE_NOTICE_ACKNOWLEDGEMENT_DURATION_MS,
      ),
    ).toBe(false);
  });

  it('treats missing, malformed, non-finite, and expired values as unacknowledged', () => {
    const now = Date.UTC(2026, 7, 31, 12);
    expect(readCookieNoticeAcknowledgement(window.localStorage, now)).toBe(false);

    for (const value of ['', 'not-a-timestamp', 'Infinity', '{}', String(now - 1)]) {
      window.localStorage.setItem(COOKIE_NOTICE_ACKNOWLEDGEMENT_STORAGE_KEY, value);
      expect(readCookieNoticeAcknowledgement(window.localStorage, now)).toBe(false);
    }
  });

  it('degrades safely when storage cannot be read or written', () => {
    const unavailableStorage = {
      getItem: () => {
        throw new Error('Storage is unavailable.');
      },
      setItem: () => {
        throw new Error('Storage is unavailable.');
      },
    };

    expect(readCookieNoticeAcknowledgement(unavailableStorage)).toBe(false);
    expect(persistCookieNoticeAcknowledgement(unavailableStorage)).toBe(false);
  });
});
