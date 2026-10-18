import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createTrainingStore } from '@kendo-menu/store';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { DialogShell } from '../../components/DialogShell';
import { createAccountApiClient } from '../../lib/account-api';
import {
  ManagedAuthContext,
  type ManagedAuthContextValue,
  type ManagedIdentityState,
} from '../../lib/managed-auth-context';
import { TrainingStoreProvider } from '../../lib/training-store-context';
import { WorkspaceContextProvider } from '../../lib/workspace-context';
import { GuestWorkspaceRoute } from './GuestWorkspaceRoute';
import { PersistenceContext, type PersistenceContextValue } from './persistence-context';

function deferred<T>() {
  let resolveValue: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return {
    promise,
    resolve: (value: T) => resolveValue?.(value),
  };
}

function authValue(identity: ManagedIdentityState): ManagedAuthContextValue {
  const api = createAccountApiClient({
    getToken: () => Promise.resolve({ status: 'unavailable' as const }),
  });
  return {
    client: undefined,
    api,
    identity,
    verifyIdentity: () => Promise.resolve(identity),
    setVerifiedAccount: () => undefined,
    invalidateIdentity: () => undefined,
    startGoogleSignIn: () => Promise.resolve(false),
    signOutProvider: () => Promise.resolve(false),
  };
}

function guestStore() {
  return createTrainingStore({
    storage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  });
}

function app(
  value: ManagedAuthContextValue,
  persistence: PersistenceContextValue,
  onDialogClose?: () => void,
) {
  return (
    <ManagedAuthContext.Provider value={value}>
      <PersistenceContext.Provider value={persistence}>
        <WorkspaceContextProvider
          value={{ kind: 'guest', basePath: '/app/guest', canEdit: true, accountEmail: null }}
        >
          <TrainingStoreProvider store={guestStore()}>
            <MemoryRouter initialEntries={['/app/guest/dashboard']}>
              <Routes>
                <Route path="/app/guest/dashboard" element={<GuestWorkspaceRoute />}>
                  <Route
                    index
                    element={
                      <>
                        <p>Guest dashboard</p>
                        <Link to="/app/guest/library">Open guest library</Link>
                        {onDialogClose === undefined ? null : (
                          <DialogShell
                            titleId="guest-dialog-title"
                            closeLabel="Close guest dialog"
                            onClose={onDialogClose}
                          >
                            <h2 id="guest-dialog-title">Guest library dialog</h2>
                          </DialogShell>
                        )}
                      </>
                    }
                  />
                </Route>
                <Route path="/app/guest/library" element={<p>Guest library opened</p>} />
                <Route
                  path="/app/sign-in"
                  element={
                    <button type="button" onClick={() => void value.startGoogleSignIn()}>
                      Continue with Google
                    </button>
                  }
                />
                <Route path="/app/account/dashboard" element={<p>Account dashboard opened</p>} />
              </Routes>
            </MemoryRouter>
          </TrainingStoreProvider>
        </WorkspaceContextProvider>
      </PersistenceContext.Provider>
    </ManagedAuthContext.Provider>
  );
}

describe('GuestWorkspaceRoute guest-exit confirmation', () => {
  it('does not open sign-in after a rejected guest save check and allows retry', async () => {
    const confirmExit = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('Synthetic failed flush'))
      .mockResolvedValue(undefined);
    const startGoogleSignIn = vi.fn().mockResolvedValue(true);
    render(
      app(
        { ...authValue({ status: 'signed-out' }), startGoogleSignIn },
        {
          mode: 'local',
          writeFailed: false,
          pending: false,
          builderDirty: true,
          flush: confirmExit,
          confirmExit,
        },
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'User' }));
    fireEvent.click(screen.getByRole('link', { name: 'Sign up' }));
    await screen.findByRole('alert');
    expect(startGoogleSignIn).not.toHaveBeenCalled();
    expect(screen.getByText('Guest dashboard')).toBeInTheDocument();
    expect(confirmExit).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('link', { name: 'Sign up' }));
    await screen.findByRole('button', { name: 'Continue with Google' });
    expect(confirmExit).toHaveBeenCalledTimes(2);
    expect(startGoogleSignIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(startGoogleSignIn).toHaveBeenCalledOnce());
  });

  it('does not navigate late when the guest route changes during a save check', async () => {
    const saveCheck = deferred<void>();
    const confirmExit = vi.fn<() => Promise<void>>(() => saveCheck.promise);
    const startGoogleSignIn = vi.fn().mockResolvedValue(true);
    render(
      app(
        { ...authValue({ status: 'signed-out' }), startGoogleSignIn },
        {
          mode: 'local',
          writeFailed: false,
          pending: false,
          flush: confirmExit,
          confirmExit,
        },
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'User' }));
    fireEvent.click(screen.getByRole('link', { name: 'Sign up' }));
    await waitFor(() => expect(confirmExit).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('link', { name: 'Open guest library' }));
    expect(screen.getByText('Guest library opened')).toBeInTheDocument();

    await act(async () => {
      saveCheck.resolve();
      await saveCheck.promise;
    });

    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
    expect(startGoogleSignIn).not.toHaveBeenCalled();
  });

  it('removes guest portals and restores root access while verified-account exit is blocked', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    const closeDialog = vi.fn();
    const persistence: PersistenceContextValue = {
      mode: 'local',
      writeFailed: false,
      pending: false,
      flush: () => Promise.resolve(),
      confirmExit: () => Promise.reject(new Error('Guest persistence is held.')),
      builderDirty: true,
    };
    const unavailable = authValue({ status: 'unavailable' });
    try {
      const view = render(app(unavailable, persistence, closeDialog), { container: root });

      expect(screen.getByRole('dialog', { name: 'Guest library dialog' })).toBeInTheDocument();
      expect(root).toHaveAttribute('inert');

      view.rerender(
        app(
          authValue({ status: 'verified', account: { accountId: 'account-a', email: null } }),
          persistence,
          closeDialog,
        ),
      );

      expect(
        screen.queryByRole('dialog', { name: 'Guest library dialog' }),
      ).not.toBeInTheDocument();
      await waitFor(() => expect(closeDialog).toHaveBeenCalledOnce());
      expect(root).not.toHaveAttribute('inert');
      expect(root).not.toHaveAttribute('aria-hidden');
      expect(screen.getByRole('button', { name: 'Continue to account' })).toBeEnabled();
      expect(screen.getByText('Your guest session draft is still open.')).toBeInTheDocument();
    } finally {
      root.remove();
    }
  });

  it('ignores an older flush that settles after the latest verified identity flush', async () => {
    const firstFlush = deferred<void>();
    const secondFlush = deferred<void>();
    const flush = vi.fn<() => Promise<void>>();
    flush.mockReturnValueOnce(firstFlush.promise).mockReturnValueOnce(secondFlush.promise);
    const persistence: PersistenceContextValue = {
      mode: 'local',
      writeFailed: false,
      pending: false,
      flush,
      confirmExit: flush,
    };
    const firstIdentity: ManagedIdentityState = {
      status: 'verified',
      account: { accountId: 'account-a', email: null },
    };
    const secondIdentity: ManagedIdentityState = {
      status: 'verified',
      account: { accountId: 'account-b', email: null },
    };
    const view = render(app(authValue(firstIdentity), persistence));

    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
    view.rerender(app(authValue(secondIdentity), persistence));
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondFlush.resolve();
      firstFlush.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByText('Account dashboard opened')).toBeInTheDocument();
  });

  it('fences a dirty guest transition whose flush settles after the verified identity changes', async () => {
    const staleFlush = deferred<void>();
    const currentFlush = deferred<void>();
    const flush = vi.fn<() => Promise<void>>();
    flush.mockReturnValueOnce(staleFlush.promise).mockReturnValueOnce(currentFlush.promise);
    const persistence: PersistenceContextValue = {
      mode: 'local',
      writeFailed: false,
      pending: false,
      flush,
      confirmExit: flush,
      builderDirty: true,
    };
    const firstIdentity: ManagedIdentityState = {
      status: 'verified',
      account: { accountId: 'account-a', email: null },
    };
    const secondIdentity: ManagedIdentityState = {
      status: 'verified',
      account: { accountId: 'account-b', email: null },
    };
    const view = render(app(authValue(firstIdentity), persistence));

    fireEvent.click(screen.getByRole('button', { name: 'Continue to account' }));
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
    view.rerender(app(authValue(secondIdentity), persistence));

    await act(async () => {
      staleFlush.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('Guest dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Account dashboard opened')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to account' }));
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(2));
    await act(async () => {
      currentFlush.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByText('Account dashboard opened')).toBeInTheDocument();
  });
});
