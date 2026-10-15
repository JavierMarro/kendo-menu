import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { createAccountApiClient } from '../../lib/account-api';
import { ManagedAuthContext, type ManagedAuthContextValue } from '../../lib/managed-auth-context';
import { SignInPage } from './SignInPage';

function deferred<T>() {
  let resolveValue: ((value: T) => void) | undefined;
  let rejectValue: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return {
    promise,
    resolve: (value: T) => resolveValue?.(value),
    reject: (reason?: unknown) => rejectValue?.(reason),
  };
}

function signInApp(startGoogleSignIn: () => Promise<boolean>) {
  const identity = { status: 'signed-out' } as const;
  const value: ManagedAuthContextValue = {
    client: undefined,
    api: createAccountApiClient({
      getToken: () => Promise.resolve({ status: 'unavailable' as const }),
    }),
    identity,
    verifyIdentity: () => Promise.resolve(identity),
    setVerifiedAccount: () => undefined,
    invalidateIdentity: () => undefined,
    startGoogleSignIn,
    signOutProvider: () => Promise.resolve(false),
  };

  return render(
    <ManagedAuthContext.Provider value={value}>
      <MemoryRouter initialEntries={['/app/sign-in']}>
        <Routes>
          <Route path="/app/sign-in" element={<SignInPage />} />
          <Route path="/app/guest/dashboard" element={<p>Guest dashboard opened</p>} />
        </Routes>
      </MemoryRouter>
    </ManagedAuthContext.Provider>,
  );
}

describe('SignInPage', () => {
  it('reports a failed Google start and permits retry', async () => {
    const startGoogleSignIn = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    signInApp(startGoogleSignIn);
    const button = screen.getByRole('button', { name: 'Continue with Google' });

    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Google sign-in could not be started. Guest use remains available.',
    );
    expect(button).toBeEnabled();

    fireEvent.click(button);
    await waitFor(() => expect(startGoogleSignIn).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  for (const cancellationEvent of ['pageshow', 'kendomenu:sign-in-cancelled'] as const) {
    for (const staleResult of ['false', 'rejected'] as const) {
      it(`keeps a newer attempt pending when an older ${staleResult} result follows ${cancellationEvent}`, async () => {
        const firstAttempt = deferred<boolean>();
        const retryAttempt = deferred<boolean>();
        const startGoogleSignIn = vi
          .fn<() => Promise<boolean>>()
          .mockReturnValueOnce(firstAttempt.promise)
          .mockReturnValueOnce(retryAttempt.promise);
        signInApp(startGoogleSignIn);
        const button = screen.getByRole('button', { name: 'Continue with Google' });

        fireEvent.click(button);
        await waitFor(() => expect(startGoogleSignIn).toHaveBeenCalledOnce());
        expect(button).toBeDisabled();

        act(() => {
          window.dispatchEvent(new Event(cancellationEvent));
        });
        expect(button).toBeEnabled();

        fireEvent.click(button);
        await waitFor(() => expect(startGoogleSignIn).toHaveBeenCalledTimes(2));
        expect(button).toBeDisabled();

        await act(async () => {
          if (staleResult === 'false') firstAttempt.resolve(false);
          else firstAttempt.reject(new Error('Synthetic stale provider failure'));
          await firstAttempt.promise.catch(() => undefined);
        });

        expect(button).toBeDisabled();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        await act(async () => {
          retryAttempt.reject(new Error('Synthetic current provider failure'));
          await retryAttempt.promise.catch(() => undefined);
        });
        expect(await screen.findByRole('alert')).toHaveTextContent(
          'Google sign-in could not be started. Guest use remains available.',
        );
        expect(button).toBeEnabled();
      });
    }
  }
});
