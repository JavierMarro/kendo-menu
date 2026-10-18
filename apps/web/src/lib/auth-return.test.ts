import { afterEach, expect, it, vi } from 'vitest';

import {
  APPLICATION_CALLBACK_PATH,
  AUTH_RETURN_KEY,
  AUTH_RETURN_TTL_MS,
  PROOF_CALLBACK_PATH,
  clearAuthReturnMarker,
  readAuthReturnMarker,
  resolveAuthReturn,
  writeAuthReturnMarker,
} from './auth-return';

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

it('stores only the finite flow marker in per-tab session storage', () => {
  const now = 1_800_000_000_000;
  expect(writeAuthReturnMarker('application', sessionStorage, now)).toBe(true);
  expect(sessionStorage.length).toBe(1);
  expect(JSON.parse(sessionStorage.getItem(AUTH_RETURN_KEY) ?? 'null')).toEqual({
    version: 1,
    flow: 'application',
    expiresAt: now + AUTH_RETURN_TTL_MS,
  });
  expect(readAuthReturnMarker(sessionStorage, now)?.flow).toBe('application');
  expect(readAuthReturnMarker(sessionStorage, now + AUTH_RETURN_TTL_MS)).toBeNull();
});

it.each([
  ['malformed JSON', '{'],
  [
    'extra fields',
    JSON.stringify({
      version: 1,
      flow: 'proof',
      expiresAt: 1_800_000_000_500,
      url: 'https://evil.invalid',
    }),
  ],
  ['overlong expiry', JSON.stringify({ version: 1, flow: 'proof', expiresAt: 1_800_001_000_000 })],
])('rejects %s markers for root returns', (_name, value) => {
  sessionStorage.setItem(AUTH_RETURN_KEY, value);
  expect(
    resolveAuthReturn(
      '/',
      '?neon_auth_session_verifier=synthetic-verifier',
      sessionStorage,
      1_800_000_000_000,
    ),
  ).toEqual({ kind: 'invalid', reason: 'missing-marker' });
});

it('routes root callbacks only through the valid tab marker and fixed destination', () => {
  const now = Date.now();
  expect(writeAuthReturnMarker('proof', sessionStorage, now)).toBe(true);
  expect(
    resolveAuthReturn(
      '/',
      '?neon_auth_session_verifier=opaque&return=https%3A%2F%2Fevil.invalid',
      sessionStorage,
      now,
    ),
  ).toEqual({ kind: 'callback', flow: 'proof', verifier: 'opaque' });
  expect(PROOF_CALLBACK_PATH).toBe('/managed-auth-proof.html');
  clearAuthReturnMarker(sessionStorage);
  expect(resolveAuthReturn('/', '?neon_auth_session_verifier=opaque', sessionStorage, now)).toEqual(
    { kind: 'invalid', reason: 'missing-marker' },
  );
});

it('accepts explicit callback destinations without a marker and rejects a contradictory marker', () => {
  expect(
    resolveAuthReturn(
      APPLICATION_CALLBACK_PATH,
      '?neon_auth_session_verifier=opaque',
      sessionStorage,
    ),
  ).toEqual({ kind: 'callback', flow: 'application', verifier: 'opaque' });
  expect(
    resolveAuthReturn(PROOF_CALLBACK_PATH, '?neon_auth_session_verifier=opaque', sessionStorage),
  ).toEqual({ kind: 'callback', flow: 'proof', verifier: 'opaque' });
  expect(writeAuthReturnMarker('application')).toBe(true);
  expect(
    resolveAuthReturn(PROOF_CALLBACK_PATH, '?neon_auth_session_verifier=opaque', sessionStorage),
  ).toEqual({ kind: 'invalid', reason: 'flow-mismatch' });
});

it('routes provider cancellation only through its finite marker and discards the marker on cleanup', () => {
  expect(writeAuthReturnMarker('proof')).toBe(true);
  expect(resolveAuthReturn('/', '?error=access_denied', sessionStorage)).toEqual({
    kind: 'cancelled',
    flow: 'proof',
  });
  clearAuthReturnMarker(sessionStorage);
  expect(
    resolveAuthReturn(
      APPLICATION_CALLBACK_PATH,
      '?error=access_denied&error_description=private-provider-detail',
      sessionStorage,
    ),
  ).toEqual({ kind: 'cancelled', flow: 'application' });
});

it('fails closed when marker storage cannot be written or read', () => {
  const blocked = {
    getItem: () => null,
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => undefined,
  };
  expect(writeAuthReturnMarker('proof', blocked)).toBe(false);
  expect(resolveAuthReturn('/', '?neon_auth_session_verifier=opaque', blocked)).toEqual({
    kind: 'invalid',
    reason: 'missing-marker',
  });
});
