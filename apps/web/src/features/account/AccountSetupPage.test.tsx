import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  createRequest: vi.fn(),
  fits: vi.fn(),
  read: vi.fn(),
}));

vi.mock('../../lib/account-adoption', () => ({
  createGuestCopyRequest: mocks.createRequest,
  guestCopyFitsRequestLimit: mocks.fits,
  readGuestCopySnapshot: mocks.read,
}));

import type { AdoptionDecisionRequest } from '../../lib/account-api';
import {
  AccountSetupContext,
  AccountSetupPage,
  type AccountSetupContextValue,
} from './AccountSetupPage';

const ACCOUNT = '01234567-89ab-4cde-8fab-0123456789ab';
const OPPORTUNITY = '01234567-89ab-4cde-8fab-0123456789ae';
const REQUEST = '01234567-89ab-4cde-8fab-0123456789ad';
const HANDOFF = {
  accountId: ACCOUNT,
  email: 'practitioner@example.test',
  created: true,
  copyOpportunityId: OPPORTUNITY,
} as const;
const SNAPSHOT = {
  raw: '{"version":10,"state":{"dashboardEntries":[]}}',
  dashboard: { version: 10 as const, state: { dashboardEntries: [] } },
  entryCount: 2,
};
const YES_REQUEST: AdoptionDecisionRequest = {
  transportVersion: 1,
  decision: 'yes',
  expectedAccountWorkspaceId: ACCOUNT,
  copyOpportunityId: OPPORTUNITY,
  requestId: REQUEST,
  expectedRevision: '0',
  catalogueVersion: 'a'.repeat(64),
  dashboard: { version: 10, state: { dashboardEntries: [] } },
};

function renderSetup(overrides: Partial<AccountSetupContextValue> = {}) {
  const value: AccountSetupContextValue = {
    accountId: ACCOUNT,
    handoff: HANDOFF,
    revision: '0',
    catalogueVersion: 'a'.repeat(64),
    ready: true,
    identityVerified: true,
    dashboardStatus: 'ready',
    dashboardLoaded: true,
    submit: vi.fn().mockResolvedValue('accepted'),
    release: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter initialEntries={['/app/account/setup']}>
      <AccountSetupContext.Provider value={value}>
        <Routes>
          <Route path="/app/account/setup" element={<AccountSetupPage />} />
          <Route path="/app/account/dashboard" element={<p>Account dashboard</p>} />
        </Routes>
      </AccountSetupContext.Provider>
    </MemoryRouter>,
  );
  return value;
}

beforeEach(() => {
  mocks.createRequest.mockReturnValue(YES_REQUEST);
  mocks.fits.mockReturnValue(true);
  mocks.read.mockResolvedValue(SNAPSHOT);
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(REQUEST);
});

afterEach(() => vi.restoreAllMocks());

describe('one-time account setup screen', () => {
  it('offers only after a complete guest snapshot and confirms Yes before account entry', async () => {
    const value = renderSetup();
    expect(
      await screen.findByRole('heading', { name: 'Copy your guest menus to your account?' }),
    ).toBeVisible();
    expect(screen.getByText('2 menu entries are ready to copy.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Copy menus' }));
    expect(await screen.findByText('Your guest menus were copied to your account.')).toBeVisible();
    expect(value.submit).toHaveBeenCalledWith(YES_REQUEST);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to account' }));
    expect(await screen.findByText('Account dashboard')).toBeVisible();
  });

  it('refreshes a byte-changed offer and does not submit the old snapshot', async () => {
    const changed = { ...SNAPSHOT, raw: '{"version":10,"state":{"dashboardEntries":[1]}}' };
    mocks.read
      .mockResolvedValueOnce(SNAPSHOT)
      .mockResolvedValueOnce(changed)
      .mockResolvedValueOnce(changed);
    const value = renderSetup();
    await screen.findByRole('heading', { name: 'Copy your guest menus to your account?' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy menus' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Guest menus changed. Review the updated offer before choosing.',
    );
    expect(value.submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy menus' }));
    await waitFor(() => expect(value.submit).toHaveBeenCalledTimes(1));
    expect(mocks.createRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ snapshot: changed }),
    );
  });

  it('abandons an in-flight preflight read after identity uncertainty and reloads before continuing', async () => {
    let resolvePreflight: ((snapshot: typeof SNAPSHOT) => void) | undefined;
    const preflight = new Promise<typeof SNAPSHOT>((resolve) => {
      resolvePreflight = resolve;
    });
    mocks.read.mockResolvedValueOnce(SNAPSHOT).mockReturnValueOnce(preflight);
    const submit = vi.fn().mockResolvedValue('accepted');
    const release = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);
    const initial: AccountSetupContextValue = {
      accountId: ACCOUNT,
      handoff: HANDOFF,
      revision: '0',
      catalogueVersion: 'a'.repeat(64),
      ready: true,
      identityVerified: true,
      dashboardStatus: 'ready',
      dashboardLoaded: true,
      submit,
      release,
      reload,
    };
    const view = (value: AccountSetupContextValue) => (
      <MemoryRouter initialEntries={['/app/account/setup']}>
        <AccountSetupContext.Provider value={value}>
          <Routes>
            <Route path="/app/account/setup" element={<AccountSetupPage />} />
            <Route path="/app/account/dashboard" element={<p>Account dashboard</p>} />
          </Routes>
        </AccountSetupContext.Provider>
      </MemoryRouter>
    );
    const rendered = render(view(initial));
    await screen.findByRole('heading', { name: 'Copy your guest menus to your account?' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy menus' }));
    expect(screen.getByRole('heading', { name: 'Sending your choice…' })).toBeVisible();

    const hidden: AccountSetupContextValue = {
      ...initial,
      ready: false,
      dashboardStatus: 'auth-hidden',
      dashboardLoaded: false,
    };
    rendered.rerender(view(hidden));
    resolvePreflight?.(SNAPSHOT);
    await waitFor(() => expect(release).toHaveBeenCalledOnce());

    const restored: AccountSetupContextValue = {
      ...hidden,
      handoff: null,
      ready: true,
      dashboardStatus: 'ready',
      dashboardLoaded: true,
    };
    rendered.rerender(view(restored));
    expect(await screen.findByRole('heading', { name: 'Setup interrupted' })).toBeVisible();
    expect(reload).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Copy menus' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to account' }));
    expect(await screen.findByText('Account dashboard')).toBeVisible();
  });

  it('declines only after the user chooses No and never offers the opposite after uncertainty', async () => {
    const value = renderSetup({ submit: vi.fn().mockResolvedValue('unconfirmed') });
    await screen.findByRole('heading', { name: 'Copy your guest menus to your account?' });
    fireEvent.click(screen.getByRole('button', { name: 'No, thanks' }));
    expect(
      await screen.findByText(/could not confirm whether your choice completed/u),
    ).toBeVisible();
    expect(value.submit).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'no', expectedAccountWorkspaceId: ACCOUNT }),
    );
    expect(screen.queryByRole('button', { name: 'Copy menus' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'No, thanks' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to account' })).toBeVisible();
  });

  it('skips the offer when guest data is unavailable without sending an implicit No', async () => {
    mocks.read.mockResolvedValue(null);
    const release = vi.fn();
    const value = renderSetup({ release });
    expect(await screen.findByText('Account dashboard')).toBeVisible();
    expect(release).toHaveBeenCalledOnce();
    expect(value.submit).not.toHaveBeenCalled();
  });

  it('releases an unused offer on persisted pagehide and does not restore it on pageshow', async () => {
    const release = vi.fn();
    const value = renderSetup({ release });
    await screen.findByRole('heading', { name: 'Copy your guest menus to your account?' });

    const pageHide = new Event('pagehide');
    Object.defineProperty(pageHide, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(pageHide);
    });
    expect(await screen.findByRole('heading', { name: 'Setup interrupted' })).toBeVisible();
    expect(release).toHaveBeenCalledOnce();

    const pageShow = new Event('pageshow');
    Object.defineProperty(pageShow, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(pageShow);
    });
    expect(screen.queryByRole('button', { name: 'Copy menus' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'No, thanks' })).not.toBeInTheDocument();
    expect(value.submit).not.toHaveBeenCalled();
  });

  it.each(['accepted', 'declined', 'unconfirmed'] as const)(
    'retries only dashboard loading after %s while authoritative data is missing',
    async (outcome) => {
      const reload = vi.fn().mockResolvedValue(undefined);
      const value = renderSetup({
        dashboardLoaded: false,
        reload,
        submit: vi.fn().mockResolvedValue(outcome),
      });
      await screen.findByRole('heading', { name: 'Copy your guest menus to your account?' });
      fireEvent.click(screen.getByRole('button', { name: 'Copy menus' }));
      expect(
        await screen.findByRole('heading', { name: 'Your account dashboard could not be loaded.' }),
      ).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Retry dashboard load' }));
      expect(reload).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole('button', { name: 'Retry dashboard load' }));
      expect(reload).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('button', { name: 'Continue to account' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Copy menus' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'No, thanks' })).not.toBeInTheDocument();
      expect(value.submit).toHaveBeenCalledOnce();
    },
  );
});
