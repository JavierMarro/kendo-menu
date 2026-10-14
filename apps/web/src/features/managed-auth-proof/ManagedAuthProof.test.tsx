import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ManagedProofClient, ManagedProofResult } from '../../lib/managed-auth-proof';
import { ManagedAuthProof } from './ManagedAuthProof';

it('fences late verification after sign-out and leaves guest bytes unchanged', async () => {
  let complete: ((result: ManagedProofResult) => void) | undefined;
  const pending = new Promise<ManagedProofResult>((resolve) => {
    complete = resolve;
  });
  const client: ManagedProofClient = {
    verify: vi.fn(() => pending),
    signIn: vi.fn(() => Promise.resolve(false)),
    signOut: vi.fn(() => Promise.resolve(true)),
  };
  localStorage.setItem('kendo-menu', 'synthetic-guest-bytes');
  render(<ManagedAuthProof client={client} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByText('Signed out of the managed session.');
  await act(async () => {
    complete?.({
      status: 'verified',
      identity: {
        provider: 'neon',
        issuer: 'https://synthetic.example.invalid',
        subject: 'synthetic-subject',
        verifiedEmail: null,
        expiresAt: Math.floor(Date.now() / 1000) + 900,
      },
    });
    await pending;
  });
  expect(screen.queryByRole('heading', { name: 'Verified identity' })).not.toBeInTheDocument();
  expect(localStorage.getItem('kendo-menu') === 'synthetic-guest-bytes').toBe(true);
});

it('reports missing configuration and sanitized sign-in/sign-out failures', async () => {
  const view = render(<ManagedAuthProof client={undefined} />);
  expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  const client: ManagedProofClient = {
    verify: () => Promise.resolve({ status: 'signed-out' }),
    signIn: () => Promise.resolve(false),
    signOut: () => Promise.resolve(false),
  };
  view.rerender(<ManagedAuthProof client={client} />);
  await screen.findByText('No managed session. Continue with Google to sign in.');
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
  await screen.findByText(
    'Google sign-in is unavailable. Check managed provider settings and retry.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByText('Sign-out was not confirmed. Retry sign-out before changing accounts.');
});
