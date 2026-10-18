import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { createAccountApiClient } from '../../lib/account-api';
import {
  ManagedAuthContext,
  type ManagedAuthContextValue,
  type ManagedIdentityState,
} from '../../lib/managed-auth-context';
import { LandingPage } from './LandingPage';

const api = createAccountApiClient({
  getToken: () => Promise.resolve({ status: 'unavailable' }),
});

function managedAuthValue(identity: ManagedIdentityState): ManagedAuthContextValue {
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

function landingPage(identity: ManagedIdentityState) {
  return (
    <MemoryRouter initialEntries={['/app']}>
      <ManagedAuthContext.Provider value={managedAuthValue(identity)}>
        <LandingPage />
      </ManagedAuthContext.Provider>
    </MemoryRouter>
  );
}

function heroActions() {
  const actions = document.querySelector('.landing-entry-actions');
  if (!(actions instanceof HTMLElement)) {
    throw new Error('Expected the landing hero actions.');
  }
  return within(actions);
}

describe('LandingPage account entry actions', () => {
  it('shows guest options until identity is verified, then links back to the account dashboard', () => {
    const view = render(landingPage({ status: 'checking' }));

    expect(heroActions().getAllByRole('link')).toHaveLength(2);
    expect(heroActions().getByRole('link', { name: 'Try without an account' })).toHaveAttribute(
      'href',
      '/app/guest/dashboard',
    );
    expect(heroActions().getByRole('link', { name: 'Sign up here' })).toHaveAttribute(
      'href',
      '/app/sign-in',
    );
    expect(screen.getByRole('link', { name: 'Record your first keiko' })).toHaveAttribute(
      'href',
      '/app/guest/dashboard',
    );

    view.rerender(landingPage({ status: 'signed-out' }));
    expect(heroActions().getAllByRole('link')).toHaveLength(2);
    expect(heroActions().queryByRole('link', { name: 'Back to your dashboard' })).toBeNull();

    view.rerender(
      landingPage({
        status: 'verified',
        account: { accountId: 'verified-account', email: 'kendo@example.com' },
      }),
    );

    expect(heroActions().getAllByRole('link')).toHaveLength(1);
    expect(heroActions().getByRole('link', { name: 'Back to your dashboard' })).toHaveAttribute(
      'href',
      '/app/account/dashboard',
    );
    expect(screen.getByRole('link', { name: 'Continue to your dashboard' })).toHaveAttribute(
      'href',
      '/app/account/dashboard',
    );
    expect(screen.queryByRole('link', { name: 'Try without an account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign up here' })).not.toBeInTheDocument();

    view.rerender(landingPage({ status: 'unavailable' }));
    expect(heroActions().getAllByRole('link')).toHaveLength(2);
    expect(heroActions().queryByRole('link', { name: 'Back to your dashboard' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Record your first keiko' })).toHaveAttribute(
      'href',
      '/app/guest/dashboard',
    );
  });
});
