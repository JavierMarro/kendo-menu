import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

import { AccountApiError, createAccountApiClient } from '../../lib/account-api';
import { ManagedAuthContext, type ManagedAuthContextValue } from '../../lib/managed-auth-context';
import { readShareReturnMarker } from '../../lib/share-return';
import { SharedMenuPage } from './SharedMenuPage';

it('a cancelled sign-in attempt cannot clear a newer sharing continuation', async () => {
  window.sessionStorage.clear();
  let finishFirst: ((result: boolean) => void) | undefined;
  const first = new Promise<boolean>((resolve) => {
    finishFirst = resolve;
  });
  const startGoogleSignIn = vi
    .fn<() => Promise<boolean>>()
    .mockReturnValueOnce(first)
    .mockResolvedValueOnce(true);
  const api = createAccountApiClient({
    getToken: () => Promise.resolve({ status: 'unavailable' as const }),
  });
  vi.spyOn(api, 'getSharedMenu').mockResolvedValue({
    snapshot: { version: 1, name: 'Keiko', sections: [{ name: 'Main', exercises: [] }] },
  });
  const value: ManagedAuthContextValue = {
    client: undefined,
    api,
    identity: { status: 'signed-out' },
    verifyIdentity: () => Promise.resolve({ status: 'signed-out' as const }),
    setVerifiedAccount: () => undefined,
    invalidateIdentity: () => undefined,
    startGoogleSignIn,
    signOutProvider: () => Promise.resolve(false),
  };
  const token = 's'.repeat(43);
  render(
    <ManagedAuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[`/app/shared/${token}`]}>
        <Routes>
          <Route path="/app/shared/:token" element={<SharedMenuPage />} />
        </Routes>
      </MemoryRouter>
    </ManagedAuthContext.Provider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in to add' }));
  act(() => {
    window.dispatchEvent(new Event('kendomenu:sign-in-cancelled'));
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in to add' }));
  await act(async () => {
    finishFirst?.(false);
    await first;
  });
  expect(startGoogleSignIn).toHaveBeenCalledTimes(2);
  expect(readShareReturnMarker()?.token).toBe(token);
  expect(screen.getByRole('button', { name: 'Opening Google…' })).toBeDisabled();
  expect(screen.queryByText('Google sign-in could not be started. Please try again.')).toBeNull();
});

it('starts only the live recipient request during StrictMode effect replay', async () => {
  const accountId = '01234567-89ab-4cde-8fab-0123456789ab';
  const api = createAccountApiClient({
    getToken: () => Promise.resolve({ status: 'unavailable' as const }),
  });
  const load = vi.spyOn(api, 'getSharedMenuForRecipient').mockResolvedValue({
    snapshot: { version: 1, name: 'Recipient keiko', sections: [{ name: 'Main', exercises: [] }] },
    isSender: false,
    accountWorkspaceId: accountId,
  });
  const identity = { status: 'verified' as const, account: { accountId, email: null } };
  const value: ManagedAuthContextValue = {
    client: undefined,
    api,
    identity,
    verifyIdentity: () => Promise.resolve(identity),
    setVerifiedAccount: () => undefined,
    invalidateIdentity: () => undefined,
    startGoogleSignIn: () => Promise.resolve(false),
    signOutProvider: () => Promise.resolve(false),
  };
  render(
    <StrictMode>
      <ManagedAuthContext.Provider value={value}>
        <MemoryRouter initialEntries={[`/app/account/shared/${'s'.repeat(43)}`]}>
          <Routes>
            <Route path="/app/account/shared/:token" element={<SharedMenuPage recipient />} />
          </Routes>
        </MemoryRouter>
      </ManagedAuthContext.Provider>
    </StrictMode>,
  );
  expect(await screen.findByRole('heading', { name: 'Recipient keiko' })).toBeVisible();
  expect(load).toHaveBeenCalledOnce();
});

it('ignores a denied recipient read after the verified account changes', async () => {
  const firstAccount = '01234567-89ab-4cde-8fab-0123456789ab';
  const secondAccount = '01234567-89ab-4cde-8fab-0123456789ac';
  let rejectRead: ((error: Error) => void) | undefined;
  const pending = new Promise<never>((_resolve, reject) => {
    rejectRead = reject;
  });
  const api = createAccountApiClient({
    getToken: () => Promise.resolve({ status: 'unavailable' as const }),
  });
  const load = vi
    .spyOn(api, 'getSharedMenuForRecipient')
    .mockReturnValueOnce(pending)
    .mockResolvedValue({
      snapshot: {
        version: 1,
        name: 'Current account keiko',
        sections: [{ name: 'Main', exercises: [] }],
      },
      isSender: false,
      accountWorkspaceId: secondAccount,
    });
  const invalidateIdentity = vi.fn();
  const view = (accountId: string) => {
    const identity = { status: 'verified' as const, account: { accountId, email: null } };
    const value: ManagedAuthContextValue = {
      client: undefined,
      api,
      identity,
      verifyIdentity: () => Promise.resolve(identity),
      setVerifiedAccount: () => undefined,
      invalidateIdentity,
      startGoogleSignIn: () => Promise.resolve(false),
      signOutProvider: () => Promise.resolve(false),
    };
    return (
      <ManagedAuthContext.Provider value={value}>
        <MemoryRouter initialEntries={[`/app/account/shared/${'s'.repeat(43)}`]}>
          <Routes>
            <Route path="/app/account/shared/:token" element={<SharedMenuPage recipient />} />
          </Routes>
        </MemoryRouter>
      </ManagedAuthContext.Provider>
    );
  };
  const { rerender } = render(view(firstAccount));
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  rerender(view(secondAccount));
  const heading = await screen.findByRole('heading', { name: 'Current account keiko' });
  await act(async () => {
    rejectRead?.(new AccountApiError('http', 'Unauthenticated', { status: 401 }));
    await pending.catch(() => undefined);
  });
  expect(invalidateIdentity).not.toHaveBeenCalled();
  expect(heading).toBeVisible();
});
