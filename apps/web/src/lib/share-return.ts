/** Per-tab, short-lived continuation for the one shared menu the visitor chose to add. */
export const SHARE_RETURN_KEY = 'kendomenu:share-return-v1';
export const SHARE_RETURN_TTL_MS = 15 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface ShareReturnMarker {
  readonly version: 1;
  readonly token: string;
  readonly expiresAt: number;
}

type MarkerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function sessionStorageOrUnavailable(): MarkerStorage {
  try {
    return window.sessionStorage;
  } catch {
    return {
      getItem: () => null,
      setItem: () => {
        throw new Error('Session storage is unavailable.');
      },
      removeItem: () => undefined,
    };
  }
}

export function isShareToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

function parseMarker(value: string | null, now: number): ShareReturnMarker | null {
  if (value === null || value.length > 128) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('token' in parsed) ||
      !isShareToken(parsed.token) ||
      !('expiresAt' in parsed) ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      parsed.expiresAt <= now ||
      parsed.expiresAt > now + SHARE_RETURN_TTL_MS ||
      Object.keys(parsed).length !== 3
    )
      return null;
    return { version: 1, token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

export function writeShareReturnMarker(
  token: string,
  storage?: MarkerStorage,
  now = Date.now(),
): boolean {
  if (!isShareToken(token)) return false;
  const target = storage ?? sessionStorageOrUnavailable();
  const marker: ShareReturnMarker = { version: 1, token, expiresAt: now + SHARE_RETURN_TTL_MS };
  try {
    target.setItem(SHARE_RETURN_KEY, JSON.stringify(marker));
    if (parseMarker(target.getItem(SHARE_RETURN_KEY), now)?.token === token) return true;
  } catch {
    // The preview stays usable if session storage is unavailable.
  }
  try {
    target.removeItem(SHARE_RETURN_KEY);
  } catch {
    /* Best effort in restricted browsers. */
  }
  return false;
}

export function readShareReturnMarker(
  storage?: Pick<Storage, 'getItem'>,
  now = Date.now(),
): ShareReturnMarker | null {
  try {
    return parseMarker((storage ?? sessionStorageOrUnavailable()).getItem(SHARE_RETURN_KEY), now);
  } catch {
    return null;
  }
}

export function shareReturnPath(token: string): string | null {
  return isShareToken(token) ? `/app/account/shared/${token}` : null;
}

export function consumeShareReturnMarker(
  storage?: Pick<Storage, 'getItem' | 'removeItem'>,
  now = Date.now(),
): string | null {
  const target = storage ?? sessionStorageOrUnavailable();
  try {
    const token = parseMarker(target.getItem(SHARE_RETURN_KEY), now)?.token;
    target.removeItem(SHARE_RETURN_KEY);
    return token === undefined ? null : shareReturnPath(token);
  } catch {
    return null;
  }
}

export function clearShareReturnMarker(storage?: Pick<Storage, 'removeItem'>): void {
  try {
    (storage ?? sessionStorageOrUnavailable()).removeItem(SHARE_RETURN_KEY);
  } catch {
    // Clearing is best effort when browser storage is unavailable.
  }
}
