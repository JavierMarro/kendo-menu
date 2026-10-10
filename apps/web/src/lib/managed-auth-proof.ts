import { createManagedAuthClient } from './managed-auth';
import { AUTH_VERIFIER_PARAMETER } from './auth-return';

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
  ) {
    return null;
  }
  return {
    provider: identity.provider,
    issuer: identity.issuer,
    subject: identity.subject,
    verifiedEmail: identity.verifiedEmail,
    expiresAt: identity.expiresAt,
  };
}

/** The proof adapter only calls the isolated identity endpoint after cookie-backed token retrieval. */
export function createManagedProofClient(
  authUrl: string,
  reloadProof: () => void = () => window.location.replace('/managed-auth-proof.html'),
): ManagedProofClient | undefined {
  const client = createManagedAuthClient(authUrl, 'proof', {
    replaceDocument: () => reloadProof(),
  });
  if (client === undefined) return undefined;

  return {
    signIn: () => client.signIn(),
    async verify(signal) {
      if (new URLSearchParams(window.location.search).has(AUTH_VERIFIER_PARAMETER)) {
        const result = await client.bootstrapCallback(signal);
        return { status: result.status };
      }
      const token = await client.getToken(signal);
      if (token.status !== 'token') return { status: token.status };
      try {
        const response = await fetch('/api/dev/managed-identity', {
          headers: { authorization: `Bearer ${token.token}` },
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
      } catch {
        return { status: 'unavailable' };
      }
    },
    signOut: () => client.signOut(),
  };
}
