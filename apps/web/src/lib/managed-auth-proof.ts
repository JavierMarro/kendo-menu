import { createAuthClient, isAuthError } from '@neondatabase/auth';
import { BetterAuthVanillaAdapter } from '@neondatabase/auth/vanilla';

export interface ManagedProofIdentity {
  readonly provider: 'neon';
  readonly issuer: string;
  readonly subject: string;
  readonly verifiedEmail: string | null;
  readonly expiresAt: number;
}

export type ManagedProofResult =
  | { readonly status: 'verified'; readonly identity: ManagedProofIdentity }
  | {
      readonly status: 'signed-out' | 'rejected' | 'unavailable' | 'callback-failed' | 'reloading';
    };

export interface ManagedProofClient {
  signIn(): Promise<boolean>;
  verify(signal: AbortSignal): Promise<ManagedProofResult>;
  signOut(): Promise<boolean>;
}

function parseIdentity(value: unknown): ManagedProofIdentity | null {
  if (typeof value !== 'object' || value === null || !('identity' in value)) return null;
  const identity = value.identity;
  if (typeof identity !== 'object' || identity === null) return null;
  if (
    !('provider' in identity) ||
    identity.provider !== 'neon' ||
    !('issuer' in identity) ||
    typeof identity.issuer !== 'string' ||
    !('subject' in identity) ||
    typeof identity.subject !== 'string' ||
    identity.subject.length === 0 ||
    !('verifiedEmail' in identity) ||
    (identity.verifiedEmail !== null && typeof identity.verifiedEmail !== 'string') ||
    !('expiresAt' in identity) ||
    typeof identity.expiresAt !== 'number' ||
    !Number.isSafeInteger(identity.expiresAt) ||
    identity.expiresAt <= Date.now() / 1000 ||
    Object.keys(identity).length !== 5 ||
    Object.keys(value).length !== 1
  )
    return null;
  return {
    provider: identity.provider,
    issuer: identity.issuer,
    subject: identity.subject,
    verifiedEmail: identity.verifiedEmail,
    expiresAt: identity.expiresAt,
  };
}

/** One successful callback exchange per fresh document; later verification retrieves only tokens. */
export function createManagedProofClient(
  authUrl: string,
  reloadProof: () => void = () => window.location.replace('/managed-auth-proof.html'),
): ManagedProofClient | undefined {
  let url: URL;
  try {
    url = new URL(authUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  const auth = createAuthClient(url.href.replace(/\/$/, ''), {
    adapter: BetterAuthVanillaAdapter({
      fetchOptions: { credentials: 'include' },
      sessionOptions: {
        refetchOnWindowFocus: false,
        refetchInterval: 0,
        refetchWhenOffline: false,
      },
    }),
    allowAnonymous: false,
  });
  let callbackBootstrap: Promise<boolean> | undefined;
  let reloadRequested = false;
  return {
    async signIn() {
      try {
        const result = await auth.signIn.social({
          provider: 'google',
          callbackURL: new URL('/managed-auth-proof.html', window.location.origin).href,
        });
        return result.error === null;
      } catch {
        return false;
      }
    },
    async verify(signal) {
      if (signal.aborted) return { status: 'unavailable' };
      if (
        callbackBootstrap !== undefined ||
        new URLSearchParams(window.location.search).has('neon_auth_session_verifier')
      ) {
        // Only get-session exchanges the verifier for a managed browser session.
        // Never refresh sessions in this document: that SDK lifecycle broadcasts credentials.
        callbackBootstrap ??= auth
          .getSession({ fetchOptions: { signal } })
          .then(
            (result) =>
              result.error === null && result.data?.session != null && result.data.user != null,
          )
          .catch(() => false);
        const established = await callbackBootstrap;
        if (!established) callbackBootstrap = undefined;
        if (signal.aborted) return { status: 'unavailable' };
        if (!established) return { status: 'callback-failed' };
        // The SDK shares its session cache with /token. A full document replacement
        // drops that in-memory cache; cookies survive for token-only verification.
        if (!reloadRequested) {
          try {
            reloadProof();
            reloadRequested = true;
          } catch {
            return { status: 'unavailable' };
          }
        }
        return { status: 'reloading' };
      }
      try {
        const result = await auth.token();
        if (signal.aborted) return { status: 'unavailable' };
        if (result.error !== null) {
          return { status: result.error.status === 401 ? 'signed-out' : 'unavailable' };
        }
        const token = result.data?.token;
        if (typeof token !== 'string' || token.length === 0) return { status: 'unavailable' };
        const response = await fetch('/api/dev/managed-identity', {
          headers: { authorization: `Bearer ${token}` },
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          signal,
        });
        if (response.status === 401) return { status: 'rejected' };
        if (!response.ok) return { status: 'unavailable' };
        const text = await response.text();
        if (text.length > 8192) return { status: 'unavailable' };
        const identity = parseIdentity(JSON.parse(text));
        return identity === null ? { status: 'unavailable' } : { status: 'verified', identity };
      } catch (error) {
        return {
          status: isAuthError(error) && error.status === 401 ? 'signed-out' : 'unavailable',
        };
      }
    },
    async signOut() {
      try {
        // Finish/cancel any cookie-establishing exchange before invalidating the session.
        await callbackBootstrap;
        const success = (await auth.signOut()).error === null;
        if (success) callbackBootstrap = undefined;
        if (
          success &&
          new URLSearchParams(window.location.search).has('neon_auth_session_verifier')
        ) {
          window.history.replaceState(null, '', '/managed-auth-proof.html');
        }
        return success;
      } catch {
        return false;
      }
    },
  };
}
