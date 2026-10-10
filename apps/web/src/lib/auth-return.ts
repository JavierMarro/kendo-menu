export type AuthFlow = 'proof' | 'application';

export const AUTH_RETURN_KEY = 'kendomenu:auth-return-v1';
export const AUTH_RETURN_TTL_MS = 15 * 60 * 1000;
export const PROOF_CALLBACK_PATH = '/managed-auth-proof.html';
export const APPLICATION_CALLBACK_PATH = '/app/auth/callback';
export const AUTH_VERIFIER_PARAMETER = 'neon_auth_session_verifier';

export interface AuthReturnMarker {
  readonly version: 1;
  readonly flow: AuthFlow;
  readonly expiresAt: number;
}

export type AuthReturnResolution =
  | { readonly kind: 'ordinary' }
  | { readonly kind: 'callback'; readonly flow: AuthFlow; readonly verifier: string }
  | { readonly kind: 'cancelled'; readonly flow: AuthFlow }
  | { readonly kind: 'invalid'; readonly reason: 'marker' | 'missing-marker' | 'flow-mismatch' };

type MarkerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserSessionStorage(): MarkerStorage {
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

function isAuthFlow(value: unknown): value is AuthFlow {
  return value === 'proof' || value === 'application';
}

function parseMarker(value: string | null, now: number): AuthReturnMarker | null {
  if (value === null || value.length > 256) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('flow' in parsed) ||
      !isAuthFlow(parsed.flow) ||
      !('expiresAt' in parsed) ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      parsed.expiresAt <= now ||
      parsed.expiresAt > now + AUTH_RETURN_TTL_MS ||
      Object.keys(parsed).length !== 3
    ) {
      return null;
    }
    return { version: 1, flow: parsed.flow, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

export function writeAuthReturnMarker(
  flow: AuthFlow,
  storage?: MarkerStorage,
  now = Date.now(),
): boolean {
  const target = storage ?? browserSessionStorage();
  const marker: AuthReturnMarker = { version: 1, flow, expiresAt: now + AUTH_RETURN_TTL_MS };
  try {
    target.setItem(AUTH_RETURN_KEY, JSON.stringify(marker));
    const verified = parseMarker(target.getItem(AUTH_RETURN_KEY), now)?.flow === flow;
    if (!verified) target.removeItem(AUTH_RETURN_KEY);
    return verified;
  } catch {
    try {
      target.removeItem(AUTH_RETURN_KEY);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
    return false;
  }
}

export function readAuthReturnMarker(
  storage?: Pick<Storage, 'getItem'>,
  now = Date.now(),
): AuthReturnMarker | null {
  try {
    return parseMarker((storage ?? browserSessionStorage()).getItem(AUTH_RETURN_KEY), now);
  } catch {
    return null;
  }
}

export function clearAuthReturnMarker(storage?: Pick<Storage, 'removeItem'>): void {
  try {
    (storage ?? browserSessionStorage()).removeItem(AUTH_RETURN_KEY);
  } catch {
    // Clearing is best effort when browser storage is unavailable.
  }
}

export function resolveAuthReturn(
  pathname: string,
  search: string,
  storage?: Pick<Storage, 'getItem'>,
  now = Date.now(),
): AuthReturnResolution {
  const source = storage ?? browserSessionStorage();
  const params = new URLSearchParams(search);
  const verifierValues = params.getAll(AUTH_VERIFIER_PARAMETER);
  const hasVerifier = verifierValues.length > 0;
  const verifier = params.get(AUTH_VERIFIER_PARAMETER);
  const explicitFlow: AuthFlow | null =
    pathname === PROOF_CALLBACK_PATH
      ? 'proof'
      : pathname === APPLICATION_CALLBACK_PATH
        ? 'application'
        : null;

  if (explicitFlow !== null) {
    const rawMarker = (() => {
      try {
        return source.getItem(AUTH_RETURN_KEY);
      } catch {
        return null;
      }
    })();
    if (rawMarker !== null) {
      const marker = parseMarker(rawMarker, now);
      if (marker === null) return { kind: 'invalid', reason: 'marker' };
      if (marker.flow !== explicitFlow) return { kind: 'invalid', reason: 'flow-mismatch' };
    }
    if (params.has('error') || params.has('error_description')) {
      return { kind: 'cancelled', flow: explicitFlow };
    }
    if (!hasVerifier) return { kind: 'ordinary' };
    if (
      verifierValues.length !== 1 ||
      verifier === null ||
      verifier.length === 0 ||
      verifier.length > 4096
    ) {
      return { kind: 'invalid', reason: 'marker' };
    }
    return { kind: 'callback', flow: explicitFlow, verifier };
  }

  if (pathname !== '/') return { kind: 'ordinary' };
  if (params.has('error') || params.has('error_description')) {
    const marker = readAuthReturnMarker(source, now);
    return marker === null
      ? { kind: 'invalid', reason: 'missing-marker' }
      : { kind: 'cancelled', flow: marker.flow };
  }
  if (!hasVerifier) return { kind: 'ordinary' };
  if (
    verifierValues.length !== 1 ||
    verifier === null ||
    verifier.length === 0 ||
    verifier.length > 4096
  ) {
    return { kind: 'invalid', reason: 'missing-marker' };
  }
  const marker = readAuthReturnMarker(source, now);
  return marker === null
    ? { kind: 'invalid', reason: 'missing-marker' }
    : { kind: 'callback', flow: marker.flow, verifier };
}

export function callbackDestination(flow: AuthFlow): string {
  return flow === 'proof' ? PROOF_CALLBACK_PATH : APPLICATION_CALLBACK_PATH;
}
