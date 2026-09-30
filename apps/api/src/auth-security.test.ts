import { describe, expect, it } from 'vitest';

import { readAppOrigin, readGoogleConfiguration } from './auth/configuration.js';
import { createGoogleAuthenticationAdapter } from './auth/google.js';
import { CSRF_COOKIE_NAME, LOGIN_COOKIE_NAME, SESSION_COOKIE_NAME } from './auth/contracts.js';
import {
  AuthenticationUnavailable,
  InvalidAuthenticationInput,
  MAX_CALLBACK_CODE_LENGTH,
  MAX_COOKIE_HEADER_LENGTH,
  MAX_PROVIDER_ERROR_LENGTH,
  TOKEN_ENTROPY_BYTES,
  clearLoginCookie,
  clearSessionCookies,
  defaultSecureRandomBytes,
  generateOpaqueValue,
  parseCookies,
  parseRequestUrl,
  pkceChallenge,
  setLoginCookie,
  setSessionCookies,
  sha256,
  validateBase64UrlToken,
  validateCallbackCode,
  validateProviderError,
  validateReturnPathParameter,
  validateStoredReturnPath,
} from './auth/security.js';

const ORIGIN = 'https://app.example.test';
const VALID_ENV = {
  GOOGLE_CLIENT_ID: 'fixture-client',
  GOOGLE_CLIENT_SECRET: 'fixture-secret',
  GOOGLE_REDIRECT_URI: `${ORIGIN}/api/auth/google/callback`,
  APP_ORIGIN: ORIGIN,
};
const VALUE = Buffer.alloc(32, 7).toString('base64url');

function returnPath(query: string): string {
  const request = new Request(`${ORIGIN}/api/auth/google/start${query}`);
  return validateReturnPathParameter(parseRequestUrl(request).searchParams);
}

describe('bounded authentication input', () => {
  it.each(['', '?returnPath=/', '?returnPath=%2F', '?returnPath=%2f', '?%72eturnPath=%2F'])(
    'defaults absence or accepts one decoded root: %s',
    (query) => expect(returnPath(query)).toBe('/'),
  );

  it.each([
    '?returnPath=',
    '?returnPath=/&returnPath=/',
    '?returnPath=%2F&%72eturnPath=/',
    '?returnPath=%252F',
    '?returnPath=%',
    '?returnPath=%2',
    '?returnPath=%GG',
    '?returnPath=%FF',
    '?returnPath=%C0%AF',
    '?returnPath=%ED%A0%80',
    '?returnPath=//evil.example.test',
    '?returnPath=https://evil.example.test',
    '?returnPath=/%5Cevil.example.test',
    '?returnPath=%5C%5Cevil.example.test',
    '?returnPath=/%00',
    '?returnPath=/%0A',
    '?returnPath=/app',
    '?returnPath=/.',
    '?returnPath=/%2e%2e',
    '?returnPath=/?x=1',
    '?returnPath=/%23fragment',
    '?returnPath=/+',
    '?returnPath=/&%FF=x',
    '?returnPath=/&extra=%FF',
    `?returnPath=${'a'.repeat(8_192)}`,
  ])('rejects redirect confusion without a second decode: %s', (query) => {
    expect(() => returnPath(query)).toThrow(InvalidAuthenticationInput);
  });

  it('revalidates stored decoded destinations rather than decoding them again', () => {
    expect(validateStoredReturnPath('/')).toBe('/');
    for (const value of ['%2F', '//evil.example.test', '/app', '', null]) {
      expect(() => validateStoredReturnPath(value)).toThrow();
    }
  });

  it('bounds callback code and provider errors', () => {
    expect(validateCallbackCode('x'.repeat(MAX_CALLBACK_CODE_LENGTH))).toHaveLength(
      MAX_CALLBACK_CODE_LENGTH,
    );
    expect(validateProviderError('x'.repeat(MAX_PROVIDER_ERROR_LENGTH))).toHaveLength(
      MAX_PROVIDER_ERROR_LENGTH,
    );
    for (const value of ['', 'with space', 'with\ncontrol', 'é']) {
      expect(() => validateCallbackCode(value)).toThrow(InvalidAuthenticationInput);
      expect(() => validateProviderError(value)).toThrow(InvalidAuthenticationInput);
    }
    expect(() => validateCallbackCode('x'.repeat(MAX_CALLBACK_CODE_LENGTH + 1))).toThrow();
    expect(() => validateProviderError('x'.repeat(MAX_PROVIDER_ERROR_LENGTH + 1))).toThrow();
  });

  it.each([LOGIN_COOKIE_NAME, SESSION_COOKIE_NAME, CSRF_COOKIE_NAME])(
    'rejects duplicate %s cookies',
    (name) => {
      const request = new Request(ORIGIN, {
        headers: { cookie: `${name}=${VALUE}; ${name}=${VALUE}` },
      });
      expect(() => parseCookies(request)).toThrow(InvalidAuthenticationInput);
    },
  );

  it('bounds the cookie header before processing its fields', () => {
    const request = new Request(ORIGIN, {
      headers: { cookie: `unrelated=${'x'.repeat(MAX_COOKIE_HEADER_LENGTH)}` },
    });
    expect(() => parseCookies(request)).toThrow(InvalidAuthenticationInput);
  });

  it('accepts only canonical 256-bit base64url tokens', () => {
    expect(validateBase64UrlToken(VALUE)).toBe(VALUE);
    const nonCanonical = `${VALUE.slice(0, -1)}${String.fromCharCode(VALUE.charCodeAt(VALUE.length - 1) + 1)}`;
    for (const invalid of [
      '',
      'a'.repeat(42),
      'a'.repeat(44),
      `${VALUE}=`,
      `${VALUE} `,
      '%2F',
      nonCanonical,
    ]) {
      expect(() => validateBase64UrlToken(invalid)).toThrow(InvalidAuthenticationInput);
    }
  });
});

describe('authentication cryptography and cookies', () => {
  it('uses the actual Google library to build the minimum-scope authorization URL offline', () => {
    const config = readGoogleConfiguration(VALID_ENV);
    const challenge = pkceChallenge(VALUE);
    const location = new URL(
      createGoogleAuthenticationAdapter().createAuthorizationUrl({
        config,
        state: VALUE,
        nonce: VALUE,
        codeChallenge: challenge,
      }),
    );
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.pathname).toBe('/o/oauth2/v2/auth');
    expect(Object.fromEntries(location.searchParams)).toEqual({
      access_type: 'online',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'openid email',
      state: VALUE,
      nonce: VALUE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
  });
  it('requests exactly 32 secure bytes and rejects broken randomness adapters', () => {
    const sizes: number[] = [];
    expect(
      generateOpaqueValue((size) => {
        sizes.push(size);
        return new Uint8Array(size).fill(7);
      }),
    ).toBe(VALUE);
    expect(sizes).toEqual([TOKEN_ENTROPY_BYTES]);
    for (const size of [0, 31, 33, 512]) {
      expect(() => generateOpaqueValue(() => new Uint8Array(size))).toThrow(
        AuthenticationUnavailable,
      );
    }
    expect(() =>
      generateOpaqueValue(() => {
        throw new Error('unavailable');
      }),
    ).toThrow(AuthenticationUnavailable);
    expect(validateBase64UrlToken(generateOpaqueValue(defaultSecureRandomBytes))).toHaveLength(43);
  });

  it('derives the RFC 7636 S256 challenge and SHA-256 persistence encoding', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('sets exact host-only attributes and clears all cookies consistently', () => {
    const now = new Date('2026-09-11T00:00:00Z');
    const loginExpiry = new Date(now.getTime() + 600_000);
    const sessionExpiry = new Date(now.getTime() + 30 * 86_400_000);
    const issued = new Headers();
    setLoginCookie(issued, VALUE, now, loginExpiry);
    setSessionCookies(issued, VALUE, VALUE, now, sessionExpiry);
    const cookies = issued.getSetCookie();
    expect(cookies).toHaveLength(3);
    for (const cookie of cookies) {
      expect(cookie).toContain('; Path=/;');
      expect(cookie).toContain('; SameSite=Lax; Secure');
      expect(cookie).not.toMatch(/Domain=/iu);
      expect(cookie).not.toContain('Max-Age=');
      expect(cookie.includes('HttpOnly')).toBe(!cookie.startsWith(CSRF_COOKIE_NAME));
      expect(cookie).toContain(
        `Expires=${cookie.startsWith(LOGIN_COOKIE_NAME) ? loginExpiry.toUTCString() : sessionExpiry.toUTCString()}`,
      );
    }
    const cleared = new Headers();
    clearLoginCookie(cleared);
    clearSessionCookies(cleared);
    expect(cleared.getSetCookie()).toHaveLength(3);
    for (const cookie of cleared.getSetCookie()) {
      expect(cookie).toContain(
        '=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure',
      );
      expect(cookie).not.toMatch(/Domain=/iu);
      expect(cookie.includes('HttpOnly')).toBe(!cookie.startsWith(CSRF_COOKIE_NAME));
    }
  });
});

describe('lazy server configuration', () => {
  it('reads exact same-origin HTTPS Google configuration', () => {
    expect(readGoogleConfiguration(VALID_ENV)).toEqual({
      clientId: VALID_ENV.GOOGLE_CLIENT_ID,
      clientSecret: VALID_ENV.GOOGLE_CLIENT_SECRET,
      redirectUri: VALID_ENV.GOOGLE_REDIRECT_URI,
      appOrigin: VALID_ENV.APP_ORIGIN,
    });
    expect(readAppOrigin({ APP_ORIGIN: ORIGIN })).toBe(ORIGIN);
    expect(
      readGoogleConfiguration({
        GOOGLE_CLIENT_ID: VALID_ENV.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: VALID_ENV.GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI: VALID_ENV.GOOGLE_REDIRECT_URI,
        APP_ORIGIN: VALID_ENV.APP_ORIGIN,
      }),
    ).toEqual(readGoogleConfiguration(VALID_ENV));
    expect(() => readGoogleConfiguration({ APP_ORIGIN: ORIGIN })).toThrow(
      AuthenticationUnavailable,
    );
  });

  it.each([
    'http://app.example.test',
    'https://app.example.test/',
    'https://app.example.test/path',
    'https://app.example.test?x=1',
    'https://app.example.test#fragment',
    'https://user:password@app.example.test',
    'https://APP.example.test',
    'https://app.example.test:443',
    ' https://app.example.test',
    'https://app.example.test\\evil',
    'https://app.example.test\n',
  ])('rejects non-exact Origin configuration: %s', (origin) => {
    expect(() => readAppOrigin({ APP_ORIGIN: origin })).toThrow(AuthenticationUnavailable);
  });

  it.each([
    'http://app.example.test/api/auth/google/callback',
    'https://app.example.test/other',
    'https://app.example.test/api/auth/google/callback?x=1',
    'https://app.example.test/api/auth/google/callback#fragment',
    'https://user:password@app.example.test/api/auth/google/callback',
    'https://app.example.test/api/auth/google/%63allback',
  ])('rejects callback URL confusion: %s', (redirectUri) => {
    expect(() =>
      readGoogleConfiguration({ ...VALID_ENV, GOOGLE_REDIRECT_URI: redirectUri }),
    ).toThrow(AuthenticationUnavailable);
  });

  it('rejects a callback hosted on a different origin from the application', () => {
    expect(() =>
      readGoogleConfiguration({
        ...VALID_ENV,
        GOOGLE_REDIRECT_URI: 'https://other.example.test/api/auth/google/callback',
      }),
    ).toThrow(AuthenticationUnavailable);
  });
});
