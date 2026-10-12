/**
 * Adapts Neon managed auth to fixed application/proof callbacks and token-only API requests.
 * The SDK owns browser-managed cookies; callback exchange is separate from transient bearer retrieval.
 */
import { createAuthClient, isAuthError } from '@neondatabase/auth';
import { BetterAuthVanillaAdapter } from '@neondatabase/auth/vanilla';

import {
  AUTH_VERIFIER_PARAMETER,
  callbackDestination,
  clearAuthReturnMarker,
  resolveAuthReturn,
  writeAuthReturnMarker,
} from './auth-return';
import type { AuthFlow } from './auth-return';

export type ManagedTokenResult =
  | { readonly status: 'token'; readonly token: string }
  | { readonly status: 'signed-out' | 'unavailable' };

export type ManagedCallbackResult = {
  readonly status: 'reloading' | 'callback-failed' | 'unavailable';
};

export interface ManagedAuthClient {
  signIn(): Promise<boolean>;
  getToken(signal: AbortSignal): Promise<ManagedTokenResult>;
  bootstrapCallback(signal: AbortSignal): Promise<ManagedCallbackResult>;
  signOut(): Promise<boolean>;
}

export interface ManagedAuthNavigation {
  readonly replaceDocument?: (path: string) => void;
}

/** Creates the managed browser client without exposing a credential persistence path. */
export function createManagedAuthClient(
  authUrl: string,
  flow: AuthFlow = 'application',
  navigation: ManagedAuthNavigation = {},
): ManagedAuthClient | undefined {
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
  let signInAttempt = 0;
  let signInInProgress = false;

  return {
    async signIn() {
      if (signInInProgress) return true;
      if (!writeAuthReturnMarker(flow)) return false;
      const attempt = ++signInAttempt;
      signInInProgress = true;
      // Scope listeners to this attempt so late failure cannot clear a newer attempt's marker.
      const removeAttemptListeners = () => {
        window.removeEventListener('pageshow', resetAfterBfCache);
        window.navigation?.removeEventListener('navigateerror', resetAfterCanceledNavigation);
      };
      const resetAfterBfCache = (event: PageTransitionEvent) => {
        if (!event.persisted || attempt !== signInAttempt) return;
        signInAttempt += 1;
        signInInProgress = false;
        removeAttemptListeners();
        window.dispatchEvent(new Event('kendomenu:sign-in-cancelled'));
      };
      const resetAfterCanceledNavigation = () => {
        if (attempt !== signInAttempt) return;
        failAttempt();
        window.dispatchEvent(new Event('kendomenu:sign-in-cancelled'));
      };
      const failAttempt = () => {
        removeAttemptListeners();
        if (attempt !== signInAttempt) return;
        signInInProgress = false;
        clearAuthReturnMarker();
      };
      window.addEventListener('pageshow', resetAfterBfCache);
      window.navigation?.addEventListener('navigateerror', resetAfterCanceledNavigation);
      try {
        const result = await auth.signIn.social({
          provider: 'google',
          callbackURL: new URL(callbackDestination(flow), window.location.origin).href,
        });
        if (result.error !== null) {
          failAttempt();
          return false;
        }
        return true;
      } catch {
        failAttempt();
        return false;
      }
    },

    async getToken(signal) {
      if (signal.aborted) return { status: 'unavailable' };
      try {
        const result = await auth.token({ fetchOptions: { signal } });
        if (signal.aborted) return { status: 'unavailable' };
        if (result.error !== null) {
          return { status: result.error.status === 401 ? 'signed-out' : 'unavailable' };
        }
        const token = result.data?.token;
        return typeof token === 'string' && token.length > 0
          ? { status: 'token', token }
          : { status: 'unavailable' };
      } catch (error) {
        return {
          status: isAuthError(error) && error.status === 401 ? 'signed-out' : 'unavailable',
        };
      }
    },

    async bootstrapCallback(signal) {
      if (signal.aborted) return { status: 'unavailable' };
      // Only this client's fixed callback path and a single verifier may enter session exchange.
      const resolution = resolveAuthReturn(window.location.pathname, window.location.search);
      if (
        resolution.kind !== 'callback' ||
        resolution.flow !== flow ||
        !new URLSearchParams(window.location.search).has(AUTH_VERIFIER_PARAMETER)
      ) {
        return { status: 'unavailable' };
      }
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
      if (reloadRequested) return { status: 'reloading' };
      try {
        clearAuthReturnMarker();
        const destination = flow === 'proof' ? callbackDestination(flow) : '/app/account/dashboard';
        (navigation.replaceDocument ?? ((path: string) => window.location.replace(path)))(
          destination,
        );
        reloadRequested = true;
        return { status: 'reloading' };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async signOut() {
      try {
        // Finish any callback exchange before invalidating the managed session.
        await callbackBootstrap;
        const success = (await auth.signOut()).error === null;
        if (success) {
          callbackBootstrap = undefined;
          clearAuthReturnMarker();
        }
        return success;
      } catch {
        return false;
      }
    },
  };
}
