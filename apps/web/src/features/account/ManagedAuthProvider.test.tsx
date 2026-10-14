import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AccountApiModule from '../../lib/account-api';

import { ManagedAuthProvider } from './ManagedAuthProvider';
import { useManagedAuth } from '../../lib/managed-auth-context';

const authMocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../../lib/account-api', async (importOriginal) => {
  const actual = await importOriginal<typeof AccountApiModule>();
  return {
    ...actual,
    createAccountApiClient: vi.fn(() => ({
      getAccount: authMocks.getAccount,
      initializeAccount: vi.fn(),
      getDashboard: vi.fn(),
      putDashboard: vi.fn(),
    })),
  };
});

vi.mock('../../lib/managed-auth', () => ({
  createManagedAuthClient: vi.fn(() => ({
    signIn: authMocks.signIn,
    getToken: vi.fn(),
    bootstrapCallback: vi.fn(),
    signOut: authMocks.signOut,
  })),
}));

const account = { accountId: 'account-1', email: 'verified@example.invalid' };

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

class RecordedBroadcastChannel extends EventTarget {
  static readonly instances: RecordedBroadcastChannel[] = [];
  readonly messages: unknown[] = [];

  constructor() {
    super();
    RecordedBroadcastChannel.instances.push(this);
  }

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  close() {}
}

function IdentityProbe() {
  const { identity, verifyIdentity, signOutProvider } = useManagedAuth();
  return (
    <>
      <output aria-label="identity">{identity.status}</output>
      <button type="button" onClick={() => void verifyIdentity()}>
        Verify identity
      </button>
      <button type="button" onClick={() => void signOutProvider()}>
        Sign out
      </button>
    </>
  );
}

describe('ManagedAuthProvider sign-out races', () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    authMocks.getAccount.mockReset().mockResolvedValue(account);
    authMocks.signIn.mockReset().mockResolvedValue(true);
    authMocks.signOut.mockReset().mockResolvedValue(true);
    RecordedBroadcastChannel.instances.length = 0;
    vi.stubGlobal('BroadcastChannel', RecordedBroadcastChannel);
  });

  it('fences an earlier authenticated check and lets confirmed sign-out notify peers', async () => {
    const signOut = deferred<boolean>();
    const verification = deferred<typeof account>();
    authMocks.signOut.mockReturnValue(signOut.promise);
    authMocks.getAccount.mockResolvedValueOnce(account).mockReturnValueOnce(verification.promise);
    const signedOutEvent = vi.fn();
    window.addEventListener('kendomenu:signed-out', signedOutEvent);
    render(
      <ManagedAuthProvider>
        <IdentityProbe />
      </ManagedAuthProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText('identity')).toHaveTextContent('verified'));

    fireEvent.click(screen.getByRole('button', { name: 'Verify identity' }));
    await waitFor(() => expect(authMocks.getAccount).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(authMocks.signOut).toHaveBeenCalledOnce());
    fireEvent.focus(window);
    expect(authMocks.getAccount).toHaveBeenCalledTimes(2);

    await act(async () => {
      signOut.resolve(true);
      await signOut.promise;
    });
    await waitFor(() => expect(screen.getByLabelText('identity')).toHaveTextContent('signed-out'));
    await act(async () => {
      verification.resolve(account);
      await verification.promise;
    });

    expect(screen.getByLabelText('identity')).toHaveTextContent('signed-out');
    expect(signedOutEvent).toHaveBeenCalledOnce();
    const signedOutMessage = RecordedBroadcastChannel.instances
      .flatMap((channel) => channel.messages)
      .find(isSignedOutTransition);
    expect(signedOutMessage).toBeDefined();
    expect(typeof signedOutMessage?.['sender']).toBe('string');
  });

  it('keeps identity hidden from automatic checks after failure and confirms a sign-out retry', async () => {
    const signOut = deferred<boolean>();
    authMocks.signOut.mockReturnValueOnce(signOut.promise).mockResolvedValueOnce(true);
    authMocks.getAccount.mockResolvedValueOnce(account);
    const signedOutEvent = vi.fn();
    window.addEventListener('kendomenu:signed-out', signedOutEvent);
    render(
      <ManagedAuthProvider>
        <IdentityProbe />
      </ManagedAuthProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText('identity')).toHaveTextContent('verified'));

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(authMocks.signOut).toHaveBeenCalledOnce());
    fireEvent.focus(window);
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    const peerChannel = RecordedBroadcastChannel.instances[0];
    peerChannel?.dispatchEvent(
      new MessageEvent('message', {
        data: { signal: 'verified-account-active', sender: 'another-tab' },
      }),
    );
    expect(authMocks.getAccount).toHaveBeenCalledOnce();
    await act(async () => {
      signOut.resolve(false);
      await signOut.promise;
    });
    fireEvent.focus(window);
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    peerChannel?.dispatchEvent(
      new MessageEvent('message', {
        data: { signal: 'verified-account-active', sender: 'another-tab' },
      }),
    );
    expect(screen.getByLabelText('identity')).toHaveTextContent('unavailable');
    expect(authMocks.getAccount).toHaveBeenCalledOnce();
    expect(signedOutEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(authMocks.signOut).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText('identity')).toHaveTextContent('signed-out'));
    expect(authMocks.getAccount).toHaveBeenCalledOnce();
    expect(signedOutEvent).toHaveBeenCalledOnce();
  });
});

function isSignedOutTransition(message: unknown): message is Record<string, unknown> {
  return (
    typeof message === 'object' &&
    message !== null &&
    !Array.isArray(message) &&
    'signal' in message &&
    message.signal === 'signed-out' &&
    'sender' in message
  );
}
