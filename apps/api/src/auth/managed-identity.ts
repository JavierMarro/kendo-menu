import { createRemoteJWKSet, customFetch, errors, jwtVerify } from 'jose';

export interface ManagedIdentity {
  readonly provider: 'neon';
  readonly issuer: string;
  readonly subject: string;
  readonly verifiedEmail: string | null;
  readonly expiresAt: number;
}

export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }
  return false;
}

export type ManagedIdentityResult =
  | { readonly status: 'verified'; readonly identity: ManagedIdentity }
  | { readonly status: 'invalid' }
  | { readonly status: 'unavailable' };

export type ManagedIdentityVerifier = (token: string) => Promise<ManagedIdentityResult>;

class JwksUnavailable extends Error {
  constructor() {
    super('Managed identity verification service unavailable');
  }
}

function readIssuerOrigin(baseUrl: string): string | undefined {
  try {
    const url = new URL(baseUrl);
    const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function containsUnavailableCause(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof JwksUnavailable) return true;
    seen.add(current);
    current = current.cause;
  }
  return false;
}

function isVerificationUnavailable(error: unknown): boolean {
  return (
    containsUnavailableCause(error) ||
    error instanceof errors.JWKInvalid ||
    error instanceof errors.JWKSInvalid ||
    error instanceof errors.JWKSMultipleMatchingKeys ||
    error instanceof errors.JWKSTimeout
  );
}

function unavailableResult(): Promise<ManagedIdentityResult> {
  return Promise.resolve({ status: 'unavailable' });
}

/** Creates a verifier bound to one configured Neon Auth branch. */
export function createManagedIdentityVerifier(
  baseUrl: string | undefined,
): ManagedIdentityVerifier {
  if (baseUrl === undefined || baseUrl.trim() === '') {
    return unavailableResult;
  }

  const issuer = readIssuerOrigin(baseUrl);
  if (issuer === undefined) return unavailableResult;

  const jwksUrl = `${baseUrl.replace(/\/+$/u, '')}/.well-known/jwks.json`;
  let remoteJwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  try {
    remoteJwks = createRemoteJWKSet(new URL(jwksUrl), {
      [customFetch]: async (input, init) => {
        try {
          const response = await fetch(input, init);
          if (!response.ok) throw new JwksUnavailable();
          let jwks: unknown;
          try {
            jwks = await response.clone().json();
          } catch {
            throw new JwksUnavailable();
          }
          if (
            typeof jwks !== 'object' ||
            jwks === null ||
            !('keys' in jwks) ||
            !Array.isArray(jwks['keys']) ||
            jwks['keys'].length === 0
          ) {
            throw new JwksUnavailable();
          }
          return response;
        } catch (error) {
          if (error instanceof JwksUnavailable) throw error;
          throw new JwksUnavailable();
        }
      },
    });
  } catch {
    return unavailableResult;
  }
  if (remoteJwks === undefined) return unavailableResult;

  const jwks = async (
    protectedHeader?: Parameters<typeof remoteJwks>[0],
    token?: Parameters<typeof remoteJwks>[1],
  ) => {
    try {
      return await remoteJwks(protectedHeader, token);
    } catch (error) {
      if (error instanceof errors.JWKSNoMatchingKey) throw error;
      throw new JwksUnavailable();
    }
  };

  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        algorithms: ['EdDSA'],
        issuer,
        audience: issuer,
        requiredClaims: ['sub', 'exp'],
      });
      if (
        typeof payload.sub !== 'string' ||
        payload.sub.length === 0 ||
        payload.sub.length > 255 ||
        hasControlCharacters(payload.sub) ||
        typeof payload.exp !== 'number' ||
        !Number.isSafeInteger(payload.exp) ||
        payload['role'] !== 'authenticated' ||
        payload['isAnonymous'] === true
      ) {
        return { status: 'invalid' };
      }

      const verifiedEmail = payload['emailVerified'] === true ? payload['email'] : null;
      if (
        payload['emailVerified'] === true &&
        (typeof verifiedEmail !== 'string' ||
          verifiedEmail.length === 0 ||
          verifiedEmail.length > 320 ||
          verifiedEmail.trim() !== verifiedEmail ||
          hasControlCharacters(verifiedEmail))
      ) {
        return { status: 'invalid' };
      }

      return {
        status: 'verified',
        identity: {
          provider: 'neon',
          issuer,
          subject: payload.sub,
          verifiedEmail: typeof verifiedEmail === 'string' ? verifiedEmail : null,
          expiresAt: payload.exp,
        },
      };
    } catch (error) {
      if (isVerificationUnavailable(error)) return { status: 'unavailable' };
      return { status: 'invalid' };
    }
  };
}
