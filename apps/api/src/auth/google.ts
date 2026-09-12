/**
 * Google OIDC adapter for the server-side authorization-code flow.
 *
 * The established Google library performs code exchange and signature
 * verification. This adapter additionally enforces KendoMenu's exact scopes,
 * callback, issuer, audience, time, nonce, and claim policy before reducing the
 * provider response to the small identity shape used by the application.
 */
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import type { GenerateAuthUrlOpts, GetTokenOptions, TokenPayload } from 'google-auth-library';

import {
  GOOGLE_CLOCK_SKEW_SECONDS,
  type Clock,
  type GoogleAuthenticationAdapter,
  type GoogleAuthorizationInput,
  type GoogleConfiguration,
  type GoogleExchangeInput,
  type GoogleIdentity,
} from './contracts.js';
import {
  AuthenticationFailed,
  defaultClock,
  hashesEqual,
  hasControlCharacters,
  isFiniteDate,
  isPrintableAscii,
  sha256,
} from './security.js';
import {
  GOOGLE_SUB_MAX_LENGTH,
  VERIFIED_EMAIL_MAX_LENGTH,
  validateGoogleSub,
  validateVerifiedGoogleEmail,
} from '../persistence/validation.js';

const GOOGLE_AUTHORIZATION_ORIGIN = 'https://accounts.google.com';
const MAX_ID_TOKEN_LENGTH = 16_384;
const MAX_NONCE_LENGTH = 512;

export interface GoogleOAuthClient {
  generateAuthUrl(options: GenerateAuthUrlOpts): string;
  getToken(options: GetTokenOptions): Promise<{
    readonly tokens: {
      readonly id_token?: string;
    };
  }>;
  verifyIdToken(options: {
    readonly idToken: string;
    readonly audience: string;
  }): Promise<GoogleLoginTicket>;
}

export interface GoogleLoginTicket {
  getPayload(): TokenPayload | undefined;
}

export type GoogleOAuthClientFactory = (config: GoogleConfiguration) => GoogleOAuthClient;

export interface GoogleAuthenticationAdapterOptions {
  readonly clientFactory?: GoogleOAuthClientFactory;
  readonly clock?: Clock;
}

function defaultClientFactory(config: GoogleConfiguration): GoogleOAuthClient {
  // Keep the third-party client behind the narrow local interface above. The
  // wrapper exposes only the ID token needed for identity verification and does
  // not return or persist Google's access and refresh tokens.
  const client = new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    useAuthRequestParameters: false,
  });
  return {
    generateAuthUrl: (options) => client.generateAuthUrl(options),
    getToken: async (options) => {
      const response = await client.getToken(options);
      const idToken = response.tokens.id_token;
      return idToken === undefined || idToken === null
        ? { tokens: {} }
        : { tokens: { id_token: idToken } };
    },
    verifyIdToken: (options) => client.verifyIdToken(options),
  };
}

function requireUniqueParameter(url: URL, name: string, expected: string): void {
  const values = url.searchParams.getAll(name);
  if (values.length !== 1 || values[0] !== expected) {
    throw new AuthenticationFailed();
  }
}

function validateAuthorizationUrl(value: unknown, input: GoogleAuthorizationInput): string {
  // The URL produced by a dependency is checked as data before redirecting the
  // browser. Exact origin, path, singleton parameters, scopes, state, nonce, and
  // PKCE rules prevent a changed dependency result becoming an open redirect.
  if (typeof value !== 'string' || value.length === 0 || value.length > 8_192) {
    throw new AuthenticationFailed();
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AuthenticationFailed();
  }

  if (
    url.protocol !== 'https:' ||
    url.origin !== GOOGLE_AUTHORIZATION_ORIGIN ||
    url.pathname !== '/o/oauth2/v2/auth' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    throw new AuthenticationFailed();
  }

  requireUniqueParameter(url, 'access_type', 'online');
  requireUniqueParameter(url, 'client_id', input.config.clientId);
  requireUniqueParameter(url, 'redirect_uri', input.config.redirectUri);
  requireUniqueParameter(url, 'response_type', 'code');
  requireUniqueParameter(url, 'state', input.state);
  requireUniqueParameter(url, 'nonce', input.nonce);
  requireUniqueParameter(url, 'code_challenge', input.codeChallenge);
  requireUniqueParameter(url, 'code_challenge_method', 'S256');

  const scopes = url.searchParams.getAll('scope');
  if (scopes.length !== 1 || scopes[0] !== 'openid email') {
    throw new AuthenticationFailed();
  }

  return value;
}

function validateExchangeInput(input: GoogleExchangeInput): void {
  if (
    !isFiniteDate(input.now) ||
    typeof input.code !== 'string' ||
    input.code.length === 0 ||
    input.code.length > 2_048 ||
    !isPrintableAscii(input.code) ||
    typeof input.codeVerifier !== 'string' ||
    input.codeVerifier.length < 43 ||
    input.codeVerifier.length > 128 ||
    !/^[A-Za-z0-9._~-]+$/u.test(input.codeVerifier) ||
    !/^[0-9a-f]{64}$/u.test(input.nonceHash)
  ) {
    throw new AuthenticationFailed();
  }
}

function validateTokenPayload(
  payload: TokenPayload | undefined,
  input: GoogleExchangeInput,
): GoogleIdentity {
  // Library signature verification is necessary but not the complete policy.
  // KendoMenu rechecks who issued the token, which client it targets, its usable
  // time window, the original nonce, and the exact claims allowed downstream.
  if (payload === undefined || typeof payload !== 'object') {
    throw new AuthenticationFailed();
  }

  const issuer = payload.iss;
  const audience = payload.aud;
  const issuedAt = payload.iat;
  const expiresAt = payload.exp;
  const subject = payload.sub;
  const nowSeconds = input.now.getTime() / 1_000;

  if (
    (issuer !== 'accounts.google.com' && issuer !== 'https://accounts.google.com') ||
    typeof audience !== 'string' ||
    audience !== input.config.clientId ||
    typeof issuedAt !== 'number' ||
    !Number.isSafeInteger(issuedAt) ||
    typeof expiresAt !== 'number' ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt >= expiresAt ||
    nowSeconds >= expiresAt ||
    issuedAt > nowSeconds + GOOGLE_CLOCK_SKEW_SECONDS ||
    typeof subject !== 'string' ||
    subject.length === 0 ||
    subject.length > GOOGLE_SUB_MAX_LENGTH ||
    !isPrintableAscii(subject) ||
    hasControlCharacters(subject)
  ) {
    throw new AuthenticationFailed();
  }

  const nonce = payload.nonce;
  if (
    typeof nonce !== 'string' ||
    nonce.length === 0 ||
    nonce.length > MAX_NONCE_LENGTH ||
    !isPrintableAscii(nonce) ||
    !hashesEqual(sha256(nonce), input.nonceHash)
  ) {
    throw new AuthenticationFailed();
  }

  let verifiedGoogleEmail: string | null = null;
  if (payload.email_verified === true) {
    const email = payload.email;
    if (
      typeof email !== 'string' ||
      email.length === 0 ||
      email.length > VERIFIED_EMAIL_MAX_LENGTH ||
      hasControlCharacters(email) ||
      email.trim() !== email
    ) {
      throw new AuthenticationFailed();
    }

    try {
      verifiedGoogleEmail = validateVerifiedGoogleEmail(email);
    } catch {
      throw new AuthenticationFailed();
    }
  }

  try {
    validateGoogleSub(subject);
  } catch {
    throw new AuthenticationFailed();
  }

  return { googleSub: subject, verifiedGoogleEmail };
}

async function retrieveIdToken(
  client: GoogleOAuthClient,
  config: GoogleConfiguration,
  code: string,
  codeVerifier: string,
): Promise<string> {
  // The authorization code and PKCE verifier are sent directly to Google. Only
  // the bounded ID token is retained long enough for verification; the complete
  // token response is never exposed to authentication callers.
  try {
    const tokenResponse = await client.getToken({
      client_id: config.clientId,
      code,
      codeVerifier,
      redirect_uri: config.redirectUri,
    });
    const idToken = tokenResponse.tokens.id_token;
    if (
      typeof idToken !== 'string' ||
      idToken.length === 0 ||
      idToken.length > MAX_ID_TOKEN_LENGTH
    ) {
      throw new AuthenticationFailed();
    }
    return idToken;
  } catch (error) {
    if (error instanceof AuthenticationFailed) {
      throw error;
    }
    throw new AuthenticationFailed();
  }
}

/**
 * Google-only OIDC adapter. Provider tokens and responses stay inside this
 * function boundary and are reduced to the two identity fields the app needs.
 */
export function createGoogleAuthenticationAdapter(
  options: GoogleAuthenticationAdapterOptions = {},
): GoogleAuthenticationAdapter {
  const clientFactory = options.clientFactory ?? defaultClientFactory;
  const clock = options.clock ?? defaultClock;

  return {
    createAuthorizationUrl: (input: GoogleAuthorizationInput): string => {
      let client: GoogleOAuthClient;
      try {
        client = clientFactory(input.config);
        const authOptions: GenerateAuthUrlOpts = {
          access_type: 'online',
          client_id: input.config.clientId,
          redirect_uri: input.config.redirectUri,
          response_type: 'code',
          scope: ['openid', 'email'],
          state: input.state,
          nonce: input.nonce,
          code_challenge: input.codeChallenge,
          code_challenge_method: CodeChallengeMethod.S256,
        };
        return validateAuthorizationUrl(client.generateAuthUrl(authOptions), input);
      } catch (error) {
        if (error instanceof AuthenticationFailed) {
          throw error;
        }
        throw new AuthenticationFailed();
      }
    },
    exchangeCode: async (input: GoogleExchangeInput): Promise<GoogleIdentity> => {
      validateExchangeInput(input);

      let client: GoogleOAuthClient;
      try {
        client = clientFactory(input.config);
      } catch {
        throw new AuthenticationFailed();
      }

      // Keep the provider response local to this helper. Only the ID-token
      // string is passed to the established library verifier.
      const idToken = await retrieveIdToken(client, input.config, input.code, input.codeVerifier);

      let ticket: GoogleLoginTicket;
      try {
        ticket = await client.verifyIdToken({
          idToken,
          audience: input.config.clientId,
        });
      } catch {
        throw new AuthenticationFailed();
      }

      try {
        const verificationNow = clock();
        if (!isFiniteDate(verificationNow)) {
          throw new AuthenticationFailed();
        }
        return validateTokenPayload(ticket.getPayload(), {
          ...input,
          now: verificationNow,
        });
      } catch (error) {
        if (error instanceof AuthenticationFailed) {
          throw error;
        }
        throw new AuthenticationFailed();
      }
    },
  };
}
