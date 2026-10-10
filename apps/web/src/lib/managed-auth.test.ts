import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({ social: vi.fn() }));

vi.mock('@neondatabase/auth', () => ({
  createAuthClient: vi.fn(() => ({ signIn: { social: authMocks.social } })),
  isAuthError: vi.fn(() => false),
}));

vi.mock('@neondatabase/auth/vanilla', () => ({
  BetterAuthVanillaAdapter: vi.fn(() => ({})),
}));

import { createManagedAuthClient } from './managed-auth';
import { AUTH_RETURN_KEY, readAuthReturnMarker } from './auth-return';

describe('managed Google sign-in initiation', () => {
  beforeEach(() => {
    vi.stubGlobal('navigation', new EventTarget());
    authMocks.social.mockReset().mockResolvedValue({ error: null });
    window.history.replaceState(null, '', '/app');
    window.sessionStorage.clear();
  });

  it('coalesces duplicate initiation attempts and permits a new attempt after BFCache return', async () => {
    let finishFirst: ((result: { error: null }) => void) | undefined;
    authMocks.social.mockReturnValueOnce(
      new Promise<{ error: null }>((resolve) => {
        finishFirst = resolve;
      }),
    );
    const client = createManagedAuthClient(
      'https://synthetic-auth.example.invalid/neon/auth',
      'application',
      { replaceDocument: vi.fn() },
    );
    expect(client).toBeDefined();
    if (client === undefined) throw new Error('Expected a configured synthetic auth client.');

    const firstAttempt = client.signIn();
    const duplicateAttempt = await client.signIn();
    expect(duplicateAttempt).toBe(true);
    expect(authMocks.social).toHaveBeenCalledOnce();
    finishFirst?.({ error: null });
    await expect(firstAttempt).resolves.toBe(true);

    expect(await client.signIn()).toBe(true);
    expect(authMocks.social).toHaveBeenCalledOnce();
    const pageShow = new Event('pageshow');
    Object.defineProperty(pageShow, 'persisted', { value: true });
    window.dispatchEvent(pageShow);
    expect(await client.signIn()).toBe(true);
    expect(authMocks.social).toHaveBeenCalledTimes(2);
  });

  it('clears the active attempt and marker after provider initiation fails', async () => {
    authMocks.social.mockResolvedValueOnce({ error: new Error('synthetic provider failure') });
    const client = createManagedAuthClient(
      'https://synthetic-auth.example.invalid/neon/auth',
      'application',
      { replaceDocument: vi.fn() },
    );
    expect(client).toBeDefined();
    if (client === undefined) throw new Error('Expected a configured synthetic auth client.');

    await expect(client.signIn()).resolves.toBe(false);
    expect(window.sessionStorage.length).toBe(0);
    await expect(client.signIn()).resolves.toBe(true);
    expect(authMocks.social).toHaveBeenCalledTimes(2);
  });

  it('releases an attempt after the browser reports canceled navigation', async () => {
    const client = createManagedAuthClient(
      'https://synthetic-auth.example.invalid/neon/auth',
      'application',
      { replaceDocument: vi.fn() },
    );
    if (client === undefined) throw new Error('Expected a configured synthetic auth client.');

    await expect(client.signIn()).resolves.toBe(true);
    window.navigation.dispatchEvent(new Event('navigateerror'));
    expect(readAuthReturnMarker()).toBeNull();

    await expect(client.signIn()).resolves.toBe(true);
    expect(authMocks.social).toHaveBeenCalledTimes(2);
  });

  it('keeps duplicate initiation coalesced while accepted navigation awaits pagehide', async () => {
    const client = createManagedAuthClient(
      'https://synthetic-auth.example.invalid/neon/auth',
      'application',
      { replaceDocument: vi.fn() },
    );
    if (client === undefined) throw new Error('Expected a configured synthetic auth client.');

    await expect(client.signIn()).resolves.toBe(true);
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    await expect(client.signIn()).resolves.toBe(true);
    expect(authMocks.social).toHaveBeenCalledOnce();
  });

  it('keeps the newer BFCache attempt marker and guard when the old attempt fails late', async () => {
    let failFirst: ((reason: Error) => void) | undefined;
    let finishSecond: ((result: { error: null }) => void) | undefined;
    authMocks.social
      .mockReturnValueOnce(
        new Promise<never>((_resolve, reject) => {
          failFirst = reject;
        }),
      )
      .mockReturnValueOnce(
        new Promise<{ error: null }>((resolve) => {
          finishSecond = resolve;
        }),
      );
    const client = createManagedAuthClient(
      'https://synthetic-auth.example.invalid/neon/auth',
      'application',
      { replaceDocument: vi.fn() },
    );
    if (client === undefined) throw new Error('Expected a configured synthetic auth client.');
    const firstAttempt = client.signIn();
    const pageShow = new Event('pageshow');
    Object.defineProperty(pageShow, 'persisted', { value: true });
    window.dispatchEvent(pageShow);
    const secondAttempt = client.signIn();
    const secondMarker = window.sessionStorage.getItem(AUTH_RETURN_KEY);
    expect(readAuthReturnMarker()?.flow).toBe('application');
    expect(authMocks.social).toHaveBeenCalledTimes(2);

    failFirst?.(new Error('Late synthetic initiation failure'));
    await expect(firstAttempt).resolves.toBe(false);
    expect(window.sessionStorage.getItem(AUTH_RETURN_KEY)).toBe(secondMarker);
    await expect(client.signIn()).resolves.toBe(true);
    expect(authMocks.social).toHaveBeenCalledTimes(2);

    finishSecond?.({ error: null });
    await expect(secondAttempt).resolves.toBe(true);
    window.dispatchEvent(pageShow);
  });
});
