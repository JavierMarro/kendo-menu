export const COOKIE_NOTICE_ACKNOWLEDGEMENT_STORAGE_KEY =
  'kendo-menu-cookie-notice-acknowledged-until';

export const COOKIE_NOTICE_ACKNOWLEDGEMENT_DURATION_MS = 21 * 24 * 60 * 60 * 1_000;

type CookieNoticeReadableStorage = Pick<Storage, 'getItem'>;
type CookieNoticeWritableStorage = Pick<Storage, 'setItem'>;

export function readCookieNoticeAcknowledgement(
  storage: CookieNoticeReadableStorage,
  now: number = Date.now(),
): boolean {
  if (!Number.isFinite(now)) {
    return false;
  }

  try {
    const rawExpiry = storage.getItem(COOKIE_NOTICE_ACKNOWLEDGEMENT_STORAGE_KEY);
    if (rawExpiry === null) {
      return false;
    }

    const expiry = Number(rawExpiry);
    return Number.isSafeInteger(expiry) && expiry > now;
  } catch {
    return false;
  }
}

export function persistCookieNoticeAcknowledgement(
  storage: CookieNoticeWritableStorage,
  now: number = Date.now(),
): boolean {
  const expiry = now + COOKIE_NOTICE_ACKNOWLEDGEMENT_DURATION_MS;
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(expiry)) {
    return false;
  }

  try {
    storage.setItem(COOKIE_NOTICE_ACKNOWLEDGEMENT_STORAGE_KEY, String(expiry));
    return true;
  } catch {
    return false;
  }
}
