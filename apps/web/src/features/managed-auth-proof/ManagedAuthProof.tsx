/**
 * Provides a development-only UI for managed session bootstrap and backend identity verification.
 * Each new action cancels and fences older requests.
 * Proof state stays apart from guest and account stores.
 */
import { useEffect, useRef, useState } from 'react';

import type {
  ManagedProofClient,
  ManagedProofIdentity,
  ManagedProofResult,
} from '../../lib/managed-auth-proof';
import './proof.css';

type ProofState = {
  readonly message: string;
  readonly busy: boolean;
  readonly identity?: ManagedProofIdentity;
};

function resultState(result: ManagedProofResult): ProofState {
  if (result.status === 'reloading') {
    return { message: 'Managed session established. Loading identity verification…', busy: true };
  }
  if (result.status === 'verified') {
    return {
      message: 'Managed identity verified by the development API.',
      busy: false,
      identity: result.identity,
    };
  }
  const messages = {
    'callback-failed':
      'The Google callback could not establish a managed session. Retry sign-in or verification.',
    'signed-out': 'No managed session. Continue with Google to sign in.',
    rejected: 'The development API rejected this credential. Check the configured Neon branch.',
    unavailable:
      'Managed verification is unavailable. Check local configuration and services, then retry.',
  };
  return { message: messages[result.status], busy: false };
}

export function ManagedAuthProof({ client }: { readonly client: ManagedProofClient | undefined }) {
  const [state, setState] = useState<ProofState>({
    message:
      client === undefined
        ? 'Set VITE_NEON_AUTH_URL in the private web configuration, then restart Vite.'
        : 'Checking the managed session…',
    busy: client !== undefined,
  });
  const epoch = useRef(0);
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const begin = (message: string) => {
    // The newest action owns the visible result; older requests cannot overwrite it when they settle.
    activeRequest.current?.abort();
    const request = new AbortController();
    activeRequest.current = request;
    epoch.current += 1;
    setState({ message, busy: true });
    return { request, version: epoch.current };
  };
  const verify = async () => {
    if (client === undefined) return;
    const { request, version } = begin('Checking identity with the KendoMenu development API…');
    const result = await client.verify(request.signal);
    if (version !== epoch.current) return;
    setState(resultState(result));
  };
  useEffect(() => {
    if (client !== undefined) {
      const request = new AbortController();
      const version = epoch.current;
      activeRequest.current = request;
      void client.verify(request.signal).then((result) => {
        if (version === epoch.current) setState(resultState(result));
      });
    }
    return () => {
      epoch.current += 1;
      activeRequest.current?.abort();
    };
  }, [client]);
  const signIn = async () => {
    if (client === undefined) return;
    const { version } = begin('Opening Google sign-in…');
    const success = await client.signIn();
    if (version === epoch.current) {
      setState({
        message: success
          ? 'Complete Google sign-in, then verify your identity here.'
          : 'Google sign-in is unavailable. Check managed provider settings and retry.',
        busy: false,
      });
    }
  };
  const signOut = async () => {
    if (client === undefined) return;
    const { version } = begin('Signing out of the managed session…');
    const success = await client.signOut();
    if (version === epoch.current) {
      setState({
        message: success
          ? 'Signed out of the managed session.'
          : 'Sign-out was not confirmed. Retry sign-out before changing accounts.',
        busy: false,
      });
    }
  };

  return (
    <main className="managed-proof">
      <h1>Managed authentication proof</h1>
      <p>
        This development page checks Google sign-in and backend identity verification. Your guest
        dashboard stays separate.
      </p>
      <div className="managed-proof-actions">
        <button
          type="button"
          disabled={client === undefined || state.busy}
          onClick={() => {
            void signIn();
          }}
        >
          Continue with Google
        </button>
        <button
          type="button"
          disabled={client === undefined || state.busy}
          onClick={() => {
            void verify();
          }}
        >
          Verify identity
        </button>
        <button
          type="button"
          disabled={client === undefined}
          onClick={() => {
            void signOut();
          }}
        >
          Sign out
        </button>
      </div>
      <p role="status" aria-live="polite">
        {state.message}
      </p>
      {state.identity !== undefined && (
        <section aria-labelledby="managed-proof-result">
          <h2 id="managed-proof-result">Verified identity</h2>
          <dl>
            <dt>Provider</dt>
            <dd>{state.identity.provider}</dd>
            <dt>Issuer</dt>
            <dd>{state.identity.issuer}</dd>
            <dt>Subject</dt>
            <dd>{state.identity.subject}</dd>
            <dt>Verified email</dt>
            <dd>{state.identity.verifiedEmail ?? 'Not supplied'}</dd>
            <dt>Credential expiry</dt>
            <dd>{new Date(state.identity.expiresAt * 1000).toLocaleString()}</dd>
          </dl>
        </section>
      )}
      <p className="managed-proof-note">
        Sign-out ends the browser session. An already issued bearer token may remain valid until
        expiry.
      </p>
    </main>
  );
}
