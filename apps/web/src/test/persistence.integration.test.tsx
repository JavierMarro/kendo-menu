import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { TRAINING_STORE_PERSISTENCE_VERSION } from '@kendo-menu/store';

import { App } from '../app/App';
import { PersistenceGate, usePersistenceStatus } from '../features/persistence/PersistenceGate';
import {
  inspectBrowserTrainingStorage,
  resetBrowserTrainingStorage,
  TRAINING_STORAGE_KEY,
} from '../lib/training-persistence';

function ReadyProbe() {
  const { mode } = usePersistenceStatus();
  return <p>Ready ({mode})</p>;
}

function openAllDetails(container: HTMLElement): void {
  const details = Array.from(container.querySelectorAll<HTMLDetailsElement>('details:not([open])'));
  for (const detail of details) {
    const outerDetails = detail.parentElement?.closest('details');
    if (outerDetails !== null && outerDetails !== undefined && !outerDetails.open) {
      continue;
    }
    detail.open = true;
  }
}

describe('browser persistence recovery', () => {
  it('keeps corrupt bytes untouched until reset and preserves unrelated localStorage keys', async () => {
    const user = userEvent.setup();
    const raw = '{not valid json';
    window.localStorage.setItem(TRAINING_STORAGE_KEY, raw);
    window.localStorage.setItem('other-application-sentinel', 'preserve-me');

    render(
      <PersistenceGate>
        <ReadyProbe />
      </PersistenceGate>,
    );

    expect(
      screen.getByRole('heading', { name: 'We couldn’t read your local KendoMenu data.' }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(TRAINING_STORAGE_KEY)).toBe(raw);

    await user.click(screen.getByRole('button', { name: 'Reset local data' }));
    const cancelledDialog = screen.getByRole('alertdialog', { name: 'Reset local data?' });
    expect((cancelledDialog as HTMLDialogElement).open).toBe(true);
    act(() => {
      cancelledDialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }));
    });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Reset local data' })).toHaveFocus();
    expect(window.localStorage.getItem(TRAINING_STORAGE_KEY)).toBe(raw);

    await user.click(screen.getByRole('button', { name: 'Reset local data' }));
    const alertDialog = screen.getByRole('alertdialog', { name: 'Reset local data?' });
    expect((alertDialog as HTMLDialogElement).open).toBe(true);
    await user.click(within(alertDialog).getByRole('button', { name: 'Keep my data' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Reset local data' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Reset local data' }));
    const confirmedDialog = screen.getByRole('alertdialog', { name: 'Reset local data?' });
    expect((confirmedDialog as HTMLDialogElement).open).toBe(true);
    await user.click(within(confirmedDialog).getByRole('button', { name: 'Reset local data' }));

    await waitFor(() => expect(screen.getByText('Ready (local)')).toBeInTheDocument());
    expect(window.localStorage.getItem(TRAINING_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem('other-application-sentinel')).toBe('preserve-me');
  });

  it('shows a separate future-version gate without changing the stored payload', () => {
    const raw = JSON.stringify({ version: 999, state: { untouched: true } });
    window.localStorage.setItem(TRAINING_STORAGE_KEY, raw);

    render(
      <PersistenceGate>
        <ReadyProbe />
      </PersistenceGate>,
    );

    expect(
      screen.getByRole('heading', { name: 'This local data needs a newer KendoMenu.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Stored version: 999')).toBeInTheDocument();
    expect(screen.queryByText(/Ready \(/)).not.toBeInTheDocument();
    expect(window.localStorage.getItem(TRAINING_STORAGE_KEY)).toBe(raw);
  });

  it('treats a valid JSON envelope with invalid domain data as corrupt without replacing it', () => {
    const raw = JSON.stringify({
      version: TRAINING_STORE_PERSISTENCE_VERSION,
      state: { dashboardEntries: 'not-an-array' },
    });
    window.localStorage.setItem(TRAINING_STORAGE_KEY, raw);

    render(
      <PersistenceGate>
        <ReadyProbe />
      </PersistenceGate>,
    );

    expect(
      screen.getByRole('heading', { name: 'We couldn’t read your local KendoMenu data.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Reason: invalid-domain')).toBeInTheDocument();
    expect(screen.queryByText(/Ready \(/)).not.toBeInTheDocument();
    expect(window.localStorage.getItem(TRAINING_STORAGE_KEY)).toBe(raw);
  });

  it('leaves the application for recovery when persisted data changes during hydration', async () => {
    const validRaw = JSON.stringify({
      version: TRAINING_STORE_PERSISTENCE_VERSION,
      state: { dashboardEntries: [] },
    });
    const invalidRaw = '{changed during hydration';
    window.localStorage.setItem(TRAINING_STORAGE_KEY, validRaw);
    const originalGetItem = window.localStorage.getItem.bind(window.localStorage);
    let trainingDataReads = 0;
    vi.spyOn(window.localStorage, 'getItem').mockImplementation((name) => {
      if (name !== TRAINING_STORAGE_KEY) {
        return originalGetItem(name);
      }

      trainingDataReads += 1;
      if (trainingDataReads === 3) {
        window.localStorage.setItem(TRAINING_STORAGE_KEY, invalidRaw);
        return invalidRaw;
      }
      return originalGetItem(name);
    });

    render(
      <PersistenceGate>
        <ReadyProbe />
      </PersistenceGate>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'We couldn’t read your local KendoMenu data.' }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText('Reason: malformed-json')).toBeInTheDocument();
    expect(screen.queryByText(/Ready \(/)).not.toBeInTheDocument();
    expect(window.localStorage.getItem(TRAINING_STORAGE_KEY)).toBe(invalidRaw);
  });

  it('offers a session-only mode when localStorage cannot be read', async () => {
    const user = userEvent.setup();
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    render(
      <PersistenceGate>
        <ReadyProbe />
      </PersistenceGate>,
    );

    expect(
      screen.getByRole('heading', { name: 'KendoMenu cannot access local data.' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue without saving' }));
    await waitFor(() => expect(screen.getByText('Ready (session)')).toBeInTheDocument());
  });

  it('announces a failed raw-backup download without changing local data', async () => {
    const user = userEvent.setup();
    const raw = '{not valid json';
    window.localStorage.setItem(TRAINING_STORAGE_KEY, raw);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('downloads blocked');
    });

    render(
      <PersistenceGate>
        <ReadyProbe />
      </PersistenceGate>,
    );

    await user.click(screen.getByRole('button', { name: 'Download raw backup' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'KendoMenu could not download the backup. Your local data has not been changed.',
    );
    expect(window.localStorage.getItem(TRAINING_STORAGE_KEY)).toBe(raw);
  });

  it('reports write failures in the application shell instead of claiming changes were saved', async () => {
    const user = userEvent.setup();
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    render(
      <PersistenceGate>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </PersistenceGate>,
    );
    const appBanner = screen
      .getByRole('navigation', { name: 'Primary navigation' })
      .closest('header');
    if (appBanner === null) {
      throw new Error('The primary navigation is not inside the application banner.');
    }

    await user.click(within(appBanner).getByRole('link', { name: /Keiko library/ }));
    const policeDojoCard = screen
      .getByRole('heading', { name: 'Police dojo asageiko menu' })
      .closest('article');
    if (policeDojoCard === null) {
      throw new Error('Expected the police dojo researched drill to render in a library card.');
    }
    await user.click(within(policeDojoCard).getByRole('link', { name: 'View session' }));
    await user.click(screen.getByRole('button', { name: 'Add to dashboard' }));
    const detailDialog = screen.getByRole('dialog', { name: 'Police dojo asageiko menu' });
    await user.click(within(detailDialog).getByRole('link', { name: 'View dashboard' }));
    await waitFor(() => {
      expect(
        within(appBanner).getByRole('status', { name: 'Changes are not being saved' }),
      ).toBeVisible();
    });

    const dashboardCard = screen
      .getByRole('heading', { name: 'Police dojo asageiko menu' })
      .closest('.dashboard-card');
    if (!(dashboardCard instanceof HTMLElement)) {
      throw new Error('Expected the police dojo dashboard card.');
    }
    await user.click(within(dashboardCard).getByRole('button', { name: 'View more' }));
    const dashboardDialog = screen.getByRole('dialog', {
      name: 'Police dojo asageiko menu',
    });
    openAllDetails(dashboardDialog);
    const minutes = within(dashboardDialog).getByLabelText(/minutes for warm-up/i);
    await user.type(minutes, '12');
    await user.tab();
    expect(screen.getByText('Not saved to this device.')).toBeInTheDocument();
    expect(screen.queryByText('Updated.')).not.toBeInTheDocument();
    expect(screen.queryByText('Saved locally.')).not.toBeInTheDocument();
    const bannerStatus = within(appBanner).getByRole('status', {
      name: 'Changes are not being saved',
      hidden: true,
    });
    expect(bannerStatus).toBeVisible();
    expect(bannerStatus).toHaveClass('is-error');
    const notes = within(dashboardDialog).getByLabelText('Practice notes');
    await user.type(notes, 'Quota test note.');
    await user.tab();
    expect(screen.getAllByText('Not saved to this device.').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Updated.')).not.toBeInTheDocument();
    expect(screen.queryByText('Saved locally.')).not.toBeInTheDocument();
  }, 30_000);

  it('classifies malformed browser values without attempting repair', () => {
    const raw = '{broken';
    window.localStorage.setItem(TRAINING_STORAGE_KEY, raw);

    expect(inspectBrowserTrainingStorage()).toEqual({
      status: 'corrupt',
      raw,
      reason: 'malformed-json',
    });

    resetBrowserTrainingStorage();
    expect(window.localStorage.getItem(TRAINING_STORAGE_KEY)).toBeNull();
  });

  it('surfaces the exact conflict when legacy Uchikomi overrides cannot be merged', () => {
    const raw = JSON.stringify({
      version: 5,
      state: {
        dashboardEntries: [
          {
            id: 'international-entry',
            trainingSetId: 'international-dojo-2-hour-session',
            quantityOverrides: {
              'international-dojo-2-hour-session-uchikomi-men-1': { repetitions: 4 },
              'international-dojo-2-hour-session-uchikomi-kote': { repetitions: 5 },
            },
            notes: '',
            createdAt: '2026-08-19T10:00:00.000Z',
          },
        ],
        customTrainingSets: [],
      },
    });
    window.localStorage.setItem(TRAINING_STORAGE_KEY, raw);

    expect(inspectBrowserTrainingStorage()).toEqual({
      status: 'corrupt',
      raw,
      reason:
        'Dashboard entry international-entry has conflicting repetitions overrides for the ' +
        'corrected International Uchikomi sequence: ' +
        'international-dojo-2-hour-session-uchikomi-men-1=4, ' +
        'international-dojo-2-hour-session-uchikomi-kote=5.',
    });
  });
});
