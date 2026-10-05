import { createAuthClient } from '@neondatabase/auth';
import { BetterAuthVanillaAdapter } from '@neondatabase/auth/vanilla';
import { afterEach, expect, it, vi } from 'vitest';

// Characterization of the pinned SDK, not an approved credential-storage policy.
// All credentials and transport responses are synthetic; the SDK itself is real.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('characterizes the token-only API without session retrieval', async () => {
  const token = 'synthetic-token-only-credential';
  const transport = vi.fn<typeof fetch>((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(
      Response.json(url.endsWith('/sign-out') ? { success: true } : { token }),
    );
  });
  vi.stubGlobal('fetch', transport);
  const client = createAuthClient('https://synthetic-auth.example.invalid/neon/auth', {
    adapter: BetterAuthVanillaAdapter({
      sessionOptions: {
        refetchOnWindowFocus: false,
        refetchInterval: 0,
        refetchWhenOffline: false,
      },
    }),
    allowAnonymous: false,
  });
  expect((await client.token()).data?.token === token).toBe(true);
  expect((await client.token()).data?.token === token).toBe(true);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem('better-auth.message')).toBeNull();
  expect((await client.signOut()).error).toBeNull();
  expect(localStorage.getItem('better-auth.message')?.includes(token)).toBe(false);
});

it('reproduces credential persistence on refresh despite disabled automatic refetch', async () => {
  const startedAt = Date.now();
  let now = startedAt;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const makeToken = (marker: string) => {
    const encode = (value: object) =>
      btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    return `${encode({ alg: 'EdDSA' })}.${encode({
      sub: 'synthetic-managed-subject',
      exp: Math.floor(now / 1000) + 900,
      marker,
    })}.synthetic-signature`;
  };
  let token = makeToken('initial');
  const transport = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      Response.json({
        session: {
          id: 'synthetic-session',
          token,
          userId: 'synthetic-managed-subject',
          expiresAt: new Date(now + 86_400_000).toISOString(),
          createdAt: new Date(startedAt).toISOString(),
          updatedAt: new Date(now).toISOString(),
        },
        user: {
          id: 'synthetic-managed-subject',
          email: 'synthetic@example.invalid',
          emailVerified: true,
          name: 'Synthetic user',
          createdAt: new Date(startedAt).toISOString(),
          updatedAt: new Date(now).toISOString(),
        },
      }),
    ),
  );
  vi.stubGlobal('fetch', transport);
  const guestBytes = '{"synthetic":"guest-source"}';
  localStorage.setItem('kendo-menu', guestBytes);
  const client = createAuthClient('https://synthetic-auth.example.invalid/neon/auth', {
    adapter: BetterAuthVanillaAdapter({
      sessionOptions: {
        refetchOnWindowFocus: false,
        refetchInterval: 0,
        refetchWhenOffline: false,
      },
    }),
    allowAnonymous: false,
  });

  // Bootstrap and a cache hit establish the SDK's previous-session comparison.
  expect((await client.getSession()).error).toBeNull();
  expect((await client.getSession()).error).toBeNull();
  expect(transport).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('better-auth.message')).toBeNull();

  now += 901_000;
  token = makeToken('refreshed');
  expect((await client.getSession()).error).toBeNull();
  expect(transport).toHaveBeenCalledTimes(2);
  // Assert booleans so a failure cannot print even synthetic credential values.
  const broadcast = localStorage.getItem('better-auth.message');
  expect(broadcast?.includes('TOKEN_REFRESHED')).toBe(true);
  expect(broadcast?.includes(token)).toBe(true);
  expect(broadcast?.includes('synthetic-session')).toBe(true);
  expect(localStorage.getItem('kendo-menu') === guestBytes).toBe(true);
});
