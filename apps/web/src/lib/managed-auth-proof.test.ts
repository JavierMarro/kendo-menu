import { createAuthClient } from '@neondatabase/auth';
import { afterEach, expect, it, vi } from 'vitest';
import { createManagedProofClient } from './managed-auth-proof';

afterEach(async () => {
  // Reset SDK module-memory fixtures through its public sign-out API. All storage
  // assertions run before this cleanup; fresh-document cookies are tested in Playwright.
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ success: true }))),
  );
  await createAuthClient('https://synthetic-auth.example.invalid/neon/auth').signOut();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

it('sends Google sign-in back to the isolated proof document through the published SDK', async () => {
  let proofCallback = false;
  let googleProvider = false;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((_input, init) => {
      const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
      if (typeof body === 'object' && body !== null) {
        proofCallback =
          'callbackURL' in body &&
          body.callbackURL === new URL('/managed-auth-proof.html', window.location.origin).href;
        googleProvider = 'provider' in body && body.provider === 'google';
      }
      return Promise.resolve(Response.json({ redirect: false, url: null }));
    }),
  );
  const client = createManagedProofClient('https://synthetic-auth.example.invalid/neon/auth');
  expect(await client?.signIn()).toBe(true);
  expect(proofCallback && googleProvider).toBe(true);
});

it('recognizes a missing managed session without exposing a provider error', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ message: 'synthetic-private-error' }, { status: 401 })),
    ),
  );
  const client = createManagedProofClient('https://synthetic-auth.example.invalid/neon/auth');
  expect(await client?.verify(new AbortController().signal)).toEqual({ status: 'signed-out' });
});

it('uses token-only verification and sends only the bearer to the API after session establishment', async () => {
  const credential = 'synthetic-token-credential';
  let authCookiesIncluded = false;
  let bearerSent = false;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https:')) {
        authCookiesIncluded = init?.credentials === 'include';
        return Promise.resolve(Response.json({ token: credential }));
      }
      bearerSent =
        new Headers(init?.headers).get('authorization') === `Bearer ${credential}` &&
        init?.credentials === 'omit';
      return Promise.resolve(
        Response.json({
          identity: {
            provider: 'neon',
            issuer: 'https://synthetic-auth.example.invalid',
            subject: 'synthetic-subject',
            verifiedEmail: null,
            expiresAt: Math.floor(Date.now() / 1000) + 900,
          },
        }),
      );
    }),
  );
  const client = createManagedProofClient('https://synthetic-auth.example.invalid/neon/auth');
  expect((await client?.verify(new AbortController().signal))?.status).toBe('verified');
  expect(authCookiesIncluded).toBe(true);
  expect(bearerSent).toBe(true);
  expect(window.location.search).toBe('');
  expect(localStorage.length).toBe(0);
});

it.each([401, 503])(
  'keeps a failed callback retryable without exposing a raw %s provider error',
  async (status) => {
    window.history.replaceState(
      null,
      '',
      '/managed-auth-proof.html?neon_auth_session_verifier=synthetic-verifier',
    );
    const transport = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ message: 'synthetic-private-error' }, { status })),
    );
    vi.stubGlobal('fetch', transport);
    const reloadProof = vi.fn();
    const client = createManagedProofClient(
      'https://synthetic-auth.example.invalid/neon/auth',
      reloadProof,
    );
    expect(await client?.verify(new AbortController().signal)).toEqual({
      status: 'callback-failed',
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(reloadProof).not.toHaveBeenCalled();
    expect(window.location.search.includes('synthetic-verifier')).toBe(true);
    expect(createManagedProofClient('')).toBeUndefined();
    expect(createManagedProofClient('https://username:password@example.invalid')).toBeUndefined();
  },
);

it('requires callback session establishment and replaces the document before token retrieval', async () => {
  window.history.replaceState(
    null,
    '',
    '/managed-auth-proof.html?neon_auth_session_verifier=synthetic-verifier',
  );
  let sessionEstablished = false;
  let verifierForwarded = false;
  let tokenRequests = 0;
  const transport = vi.fn<typeof fetch>((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/get-session')) {
      verifierForwarded =
        new URL(url).searchParams.get('neon_auth_session_verifier') === 'synthetic-verifier';
      sessionEstablished = verifierForwarded && init?.credentials === 'include';
      return Promise.resolve(
        Response.json({
          session: { token: 'synthetic-session-credential' },
          user: { id: 'synthetic-subject' },
        }),
      );
    }
    if (url.includes('/token')) {
      tokenRequests++;
      return Promise.resolve(
        sessionEstablished && init?.credentials === 'include'
          ? Response.json({ token: 'synthetic-bearer' })
          : Response.json({ message: 'synthetic-private-error' }, { status: 401 }),
      );
    }
    return Promise.resolve(
      Response.json({
        identity: {
          provider: 'neon',
          issuer: 'https://synthetic-auth.example.invalid',
          subject: 'synthetic-subject',
          verifiedEmail: null,
          expiresAt: Math.floor(Date.now() / 1000) + 900,
        },
      }),
    );
  });
  vi.stubGlobal('fetch', transport);
  const authUrl = 'https://synthetic-auth.example.invalid/neon/auth';
  // A token without a managed cookie must fail, even with the verifier present.
  await expect(createAuthClient(authUrl).token()).rejects.toMatchObject({ status: 401 });
  const reloadProof = vi.fn();
  const callbackClient = createManagedProofClient(authUrl, reloadProof);
  expect(await callbackClient?.verify(new AbortController().signal)).toEqual({
    status: 'reloading',
  });
  expect(verifierForwarded).toBe(true);
  expect(tokenRequests).toBe(1);
  expect(reloadProof).toHaveBeenCalledTimes(1);
  expect(window.location.search).toBe('');
  expect(localStorage.getItem('better-auth.message')).toBeNull();
  // Characterize the actual SDK cache collision, which necessitates that replacement.
  expect((await createAuthClient(authUrl).token()).data?.token).toBeUndefined();
  expect(tokenRequests).toBe(1);
  expect(localStorage.getItem('better-auth.message')).toBeNull();
});

it('does not send a late token to the API after cancellation', async () => {
  let complete: ((response: Response) => void) | undefined;
  const transport = vi.fn<typeof fetch>(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  vi.stubGlobal('fetch', transport);
  const client = createManagedProofClient('https://synthetic-auth.example.invalid/neon/auth');
  const request = new AbortController();
  const result = client?.verify(request.signal);
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  request.abort();
  complete?.(Response.json({ token: 'synthetic-late-token' }));
  expect(await result).toEqual({ status: 'unavailable' });
  expect(transport).toHaveBeenCalledTimes(1);
});

it('waits for a late callback exchange before sign-out without reloading or changing guest bytes', async () => {
  window.history.replaceState(
    null,
    '',
    '/managed-auth-proof.html?neon_auth_session_verifier=synthetic-verifier',
  );
  localStorage.setItem('kendo-menu', 'synthetic-guest-bytes');
  let complete: ((response: Response) => void) | undefined;
  let signOutRequested = false;
  const transport = vi.fn<typeof fetch>((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/sign-out')) {
      signOutRequested = true;
      return Promise.resolve(Response.json({ success: true }));
    }
    return new Promise<Response>((resolve) => {
      complete = resolve;
    });
  });
  vi.stubGlobal('fetch', transport);
  const reloadProof = vi.fn();
  const client = createManagedProofClient(
    'https://synthetic-auth.example.invalid/neon/auth',
    reloadProof,
  );
  const request = new AbortController();
  const verification = client?.verify(request.signal);
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  request.abort();
  const signOut = client?.signOut();
  expect(signOutRequested).toBe(false);
  complete?.(
    Response.json({
      session: { token: 'synthetic-late-session-credential' },
      user: { id: 'synthetic-subject' },
    }),
  );
  expect(await verification).toEqual({ status: 'unavailable' });
  expect(await signOut).toBe(true);
  expect(signOutRequested).toBe(true);
  expect(reloadProof).not.toHaveBeenCalled();
  expect(localStorage.getItem('kendo-menu') === 'synthetic-guest-bytes').toBe(true);
  expect(
    localStorage.getItem('better-auth.message')?.includes('synthetic-late-session-credential'),
  ).toBe(false);
});
