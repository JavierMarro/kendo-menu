/**
 * Maps verified Neon bearer claims to the internal proof used by protected API handlers.
 * Writes require the exact configured application Origin; persistence rechecks identity mapping and
 * token expiry after waits.
 * Request-provided account or workspace identifiers never establish authority.
 */
import type { ManagedIdentity, ManagedIdentityVerifier } from './managed-identity.js';

const proofBrand: unique symbol = Symbol('AccountAuthorizationProof');

export interface AccountAuthorizationProof {
  readonly accountId: string;
  readonly provider: 'neon';
  readonly issuer: string;
  readonly subject: string;
  readonly verifiedEmail: string | null;
  /** JWT expiry in Unix seconds, rechecked after persistence waits. */
  readonly expiresAt: number;
  readonly [proofBrand]: true;
}

export type AccountAuthorizationResult =
  | { readonly status: 'authorized'; readonly proof: AccountAuthorizationProof }
  | { readonly status: 'unauthenticated' | 'unavailable' | 'not-initialized' | 'forbidden' };

export interface ManagedAccountLookup {
  findManagedAccount(identity: ManagedIdentity): Promise<{ readonly accountId: string } | null>;
}

export interface AccountAuthorization {
  authorizeRead(request: Request): Promise<AccountAuthorizationResult>;
  authorizeWrite(request: Request): Promise<AccountAuthorizationResult>;
  verifyIdentity(
    request: Request,
  ): Promise<
    | { readonly status: 'verified'; readonly identity: ManagedIdentity }
    | { readonly status: 'unauthenticated' | 'unavailable' | 'forbidden' }
  >;
  createProof(identity: ManagedIdentity, accountId: string): AccountAuthorizationProof;
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  if (header === null || header.length > 16_384) return undefined;
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(header);
  return match?.[1];
}

function isCurrent(proof: Pick<AccountAuthorizationProof, 'expiresAt'>, now: number): boolean {
  return Number.isSafeInteger(proof.expiresAt) && proof.expiresAt > now;
}

export function accountAuthorizationFailureResponse(
  status: Exclude<AccountAuthorizationResult['status'], 'authorized'>,
): Response {
  switch (status) {
    case 'unauthenticated':
      return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
    case 'unavailable':
      return Response.json({ error: 'AUTH_UNAVAILABLE' }, { status: 503 });
    case 'not-initialized':
      return Response.json({ error: 'ACCOUNT_NOT_INITIALIZED' }, { status: 409 });
    case 'forbidden':
      return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
  }
}

export function createAccountAuthorization(dependencies: {
  readonly verify: ManagedIdentityVerifier;
  readonly lookup: ManagedAccountLookup;
  readonly getAppOrigin: () => string | Promise<string>;
  readonly now?: () => number;
}): AccountAuthorization {
  const now = dependencies.now ?? (() => Math.floor(Date.now() / 1000));

  const createProof = (identity: ManagedIdentity, accountId: string): AccountAuthorizationProof => {
    const proof: AccountAuthorizationProof = {
      accountId,
      provider: identity.provider,
      issuer: identity.issuer,
      subject: identity.subject,
      verifiedEmail: identity.verifiedEmail,
      expiresAt: identity.expiresAt,
      [proofBrand]: true,
    };
    return Object.freeze(proof);
  };

  async function authorize(request: Request, write: boolean): Promise<AccountAuthorizationResult> {
    const verified = await verifyIdentity(request, write);
    if (verified.status !== 'verified') return verified;

    let account: { readonly accountId: string } | null;
    try {
      account = await dependencies.lookup.findManagedAccount(verified.identity);
    } catch {
      // The persistence layer can detect token expiry after waiting on its
      // connection or query. Preserve the auth boundary's sanitized 401 for
      // that case while keeping genuine lookup failures at 503.
      if (!isCurrent(verified.identity, now())) return { status: 'unauthenticated' };
      return { status: 'unavailable' };
    }
    // Reject a token that expired while the internal account lookup was waiting on persistence.
    if (!isCurrent(verified.identity, now())) return { status: 'unauthenticated' };
    if (account === null) return { status: 'not-initialized' };
    return { status: 'authorized', proof: createProof(verified.identity, account.accountId) };
  }

  async function verifyIdentity(request: Request, write: boolean) {
    const token = bearerToken(request);
    if (token === undefined) return { status: 'unauthenticated' as const };
    if (write) {
      // Check browser origin before remote token verification on mutation paths.
      const origin = request.headers.get('origin');
      let expected: string;
      try {
        expected = await dependencies.getAppOrigin();
      } catch {
        return { status: 'unavailable' as const };
      }
      if (origin === null || origin !== expected) return { status: 'forbidden' as const };
    }
    let verified: Awaited<ReturnType<ManagedIdentityVerifier>>;
    try {
      verified = await dependencies.verify(token);
    } catch {
      return { status: 'unavailable' as const };
    }
    if (verified.status === 'invalid') return { status: 'unauthenticated' as const };
    if (verified.status === 'unavailable') return { status: 'unavailable' as const };
    if (!isCurrent(verified.identity, now())) return { status: 'unauthenticated' as const };
    return { status: 'verified' as const, identity: verified.identity };
  }

  return {
    authorizeRead: (request) => authorize(request, false),
    authorizeWrite: (request) => authorize(request, true),
    verifyIdentity: (request) => verifyIdentity(request, true),
    createProof,
  };
}
