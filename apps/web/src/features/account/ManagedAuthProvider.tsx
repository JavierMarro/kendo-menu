/**
 * Owns managed-auth client access and the account identity verified by the server.
 * Request generations fence late checks. The SDK remains responsible for browser-managed
 * session cookies.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  AccountApiError,
  createAccountApiClient,
  type ManagedAccountRecord,
} from '../../lib/account-api';
import { createManagedAuthClient } from '../../lib/managed-auth';
import {
  ManagedAuthContext,
  type ManagedAuthContextValue,
  type ManagedIdentityState,
} from '../../lib/managed-auth-context';
import {
  broadcastAccountTransition,
  subscribeToAccountTransitions,
} from '../../lib/guest-pageview';

export function ManagedAuthProvider({ children }: { readonly children: ReactNode }) {
  const configuredAuthUrl: unknown = import.meta.env['VITE_NEON_AUTH_URL'];
  const authUrl = typeof configuredAuthUrl === 'string' ? configuredAuthUrl : '';
  const client = useMemo(() => createManagedAuthClient(authUrl), [authUrl]);
  const api = useMemo(
    () =>
      createAccountApiClient({
        getToken: (signal) =>
          client === undefined
            ? Promise.resolve({ status: 'unavailable' as const })
            : client.getToken(signal),
      }),
    [client],
  );
  const [identity, setIdentity] = useState<ManagedIdentityState>({ status: 'checking' });
  const identityRef = useRef<ManagedIdentityState>({ status: 'checking' });
  const generation = useRef(0);
  const signOutPending = useRef(false);
  const signOutFailed = useRef(false);

  const verifyIdentity = useCallback(async (): Promise<ManagedIdentityState> => {
    if (signOutPending.current || signOutFailed.current) return identityRef.current;
    // Each check owns a generation so sign-out or a newer transition wins over its late response.
    const requestGeneration = ++generation.current;
    window.dispatchEvent(new Event('kendomenu:session-verification-started'));
    setIdentity({ status: 'checking' });
    let next: ManagedIdentityState;
    try {
      const account = await api.getAccount();
      next = { status: 'verified', account };
    } catch (error) {
      next =
        error instanceof AccountApiError && error.status === 401
          ? { status: 'signed-out' }
          : error instanceof AccountApiError &&
              error.status === 409 &&
              error.code === 'ACCOUNT_NOT_INITIALIZED'
            ? { status: 'uninitialized' }
            : { status: 'unavailable' };
    }
    if (
      signOutPending.current ||
      signOutFailed.current ||
      generation.current !== requestGeneration
    ) {
      return identityRef.current;
    }
    identityRef.current = next;
    setIdentity(next);
    return next;
  }, [api]);

  const setVerifiedAccount = useCallback((account: ManagedAccountRecord) => {
    if (signOutPending.current || signOutFailed.current) return;
    generation.current += 1;
    const next: ManagedIdentityState = { status: 'verified', account };
    identityRef.current = next;
    setIdentity(next);
  }, []);

  const invalidateIdentity = useCallback(() => {
    if (signOutPending.current || signOutFailed.current) return;
    generation.current += 1;
    const next: ManagedIdentityState = { status: 'unavailable' };
    identityRef.current = next;
    setIdentity(next);
  }, []);

  const startGoogleSignIn = useCallback(async () => {
    if (client === undefined) return false;
    window.dispatchEvent(new Event('kendomenu:sign-in-started'));
    broadcastAccountTransition('sign-in-started');
    return client.signIn();
  }, [client]);

  const signOutProvider = useCallback(async () => {
    if (signOutPending.current) return false;
    // Hide account state before provider sign-out; failure stays fenced until explicit retry succeeds.
    signOutPending.current = true;
    signOutFailed.current = true;
    const requestGeneration = ++generation.current;
    identityRef.current = { status: 'unavailable' };
    setIdentity({ status: 'unavailable' });
    let signedOut: boolean;
    try {
      signedOut = (await client?.signOut()) ?? false;
    } catch {
      signedOut = false;
    }
    const next = signedOut ? { status: 'signed-out' as const } : { status: 'unavailable' as const };
    identityRef.current = next;
    if (generation.current === requestGeneration) setIdentity(next);
    if (signedOut) {
      signOutFailed.current = false;
      window.dispatchEvent(new Event('kendomenu:signed-out'));
      broadcastAccountTransition('signed-out');
    }
    signOutPending.current = false;
    return signedOut;
  }, [client]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void verifyIdentity();
    });
    return () => {
      active = false;
    };
  }, [verifyIdentity]);

  useEffect(() => {
    const recheck = () => void verifyIdentity();
    window.addEventListener('focus', recheck);
    window.addEventListener('pageshow', recheck);
    const transition = subscribeToAccountTransitions(recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      window.removeEventListener('pageshow', recheck);
      transition.unsubscribe();
      generation.current += 1;
    };
  }, [verifyIdentity]);

  const value = useMemo<ManagedAuthContextValue>(
    () => ({
      client,
      api,
      identity,
      verifyIdentity,
      setVerifiedAccount,
      invalidateIdentity,
      startGoogleSignIn,
      signOutProvider,
    }),
    [
      api,
      client,
      identity,
      invalidateIdentity,
      setVerifiedAccount,
      signOutProvider,
      startGoogleSignIn,
      verifyIdentity,
    ],
  );
  return <ManagedAuthContext.Provider value={value}>{children}</ManagedAuthContext.Provider>;
}
