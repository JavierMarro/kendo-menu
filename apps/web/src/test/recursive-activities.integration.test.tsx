import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import {
  TrainingStoreProvider,
  useTrainingStore,
  useTrainingStoreApi,
} from '../lib/training-store-context';
import { PersistenceContext } from '../features/persistence/PersistenceGate';
import { DashboardTrainingSet } from '../features/dashboard/DashboardPage';
import { DrillDetailContent } from '../features/library/DrillDetailContent';
import { DrillDetailDialog } from '../features/library/DrillDetailDialog';
import { createTestStore, TestMemoryStorage } from './test-utils';
import { RECURSIVE_TRAINING_SET } from './recursive-activity.fixture';

function getRequiredSummary(container: ParentNode): HTMLElement {
  const summary = container.querySelector<HTMLElement>('summary');
  if (summary === null) {
    throw new Error('Expected a disclosure summary.');
  }
  return summary;
}

function renderLibraryFixture() {
  const store = createTestStore();
  const view = render(
    <PersistenceContext.Provider value={{ mode: 'local', writeFailed: false }}>
      <TrainingStoreProvider store={store}>
        <MemoryRouter>
          <DrillDetailContent titleId="synthetic-title" trainingSet={RECURSIVE_TRAINING_SET} />
        </MemoryRouter>
      </TrainingStoreProvider>
    </PersistenceContext.Provider>,
  );
  return { store, view };
}

function RecursiveDashboardFixture() {
  const entry = useTrainingStore((state) => state.dashboardEntries[0]);
  const store = useTrainingStoreApi();

  if (entry === undefined) {
    return null;
  }

  return (
    <DashboardTrainingSet
      entry={entry}
      index={0}
      trainingSet={RECURSIVE_TRAINING_SET}
      onRemove={() => undefined}
      onUpdate={(patch) => store.getState().updateDashboardEntry(entry.id, patch)}
      onSetQuantity={(activityId, unit, value) =>
        store.getState().setQuantityOverride(entry.id, activityId, unit, value)
      }
      onClearQuantity={(activityId, unit) =>
        store.getState().clearQuantityOverride(entry.id, activityId, unit)
      }
      onSetActivityNote={(activityId, note) =>
        store.getState().setActivityNote(entry.id, activityId, note)
      }
    />
  );
}

function renderDashboardFixture(storage?: TestMemoryStorage) {
  const store = createTestStore(storage);
  store.getState().addToDashboard(RECURSIVE_TRAINING_SET.id);
  const view = render(
    <PersistenceContext.Provider value={{ mode: 'local', writeFailed: false }}>
      <TrainingStoreProvider store={store}>
        <RecursiveDashboardFixture />
      </TrainingStoreProvider>
    </PersistenceContext.Provider>,
  );
  return { store, view };
}

describe('recursive activity web consumers', () => {
  it('renders three- and four-level library branches in tree order', async () => {
    const user = userEvent.setup();
    renderLibraryFixture();

    expect(screen.getByText('8 activities in this session.')).toBeVisible();
    const detailSections = document.querySelectorAll<HTMLDetailsElement>('details.detail-section');
    expect(detailSections).toHaveLength(5);
    expect([...detailSections].every((section) => !section.open)).toBe(true);

    const root = document.querySelector<HTMLElement>('[data-activity-id="synthetic-root"]');
    const stationA = document.querySelector<HTMLElement>(
      '[data-activity-id="synthetic-station-a"]',
    );
    const sandan = document.querySelector<HTMLElement>(
      '[data-activity-id="synthetic-sandan-geiko"]',
    );
    const yakusoku = document.querySelector<HTMLElement>(
      '[data-activity-id="synthetic-yakusoku-geiko"]',
    );
    if (root === null || stationA === null || sandan === null || yakusoku === null) {
      throw new Error('Expected every synthetic container in the library.');
    }

    expect(root.querySelector('summary')).toBeInTheDocument();
    expect(stationA.querySelector('summary')).toBeInTheDocument();
    expect(sandan.querySelector('summary')).toBeInTheDocument();
    expect(yakusoku.querySelector('summary')).toBeInTheDocument();
    expect(
      document.querySelector('[data-activity-id="synthetic-station-a-exercise"] summary'),
    ).toBeNull();
    expect(
      document.querySelector('[data-activity-id="synthetic-yakusoku-men"] summary'),
    ).toBeNull();
    expect(document.querySelector('[data-activity-id="synthetic-free-timed"] summary')).toBeNull();

    expect(
      [...document.querySelectorAll<HTMLElement>('[data-activity-id]')].map(
        (element) => element.dataset['activityId'],
      ),
    ).toEqual([
      'synthetic-root',
      'synthetic-station-a',
      'synthetic-station-a-exercise',
      'synthetic-sandan-geiko',
      'synthetic-yakusoku-geiko',
      'synthetic-yakusoku-men',
      'synthetic-free-version',
      'synthetic-free-timed',
    ]);
    expect(getRequiredSummary(stationA)).toHaveAccessibleName('Station A 1 exercise');
    expect(getRequiredSummary(sandan)).toHaveAccessibleName('Sandan-geiko 2 activities');

    expect(within(root).getByText('30 minutes')).toBeInTheDocument();
    expect(within(root).getByText('Start with posture and intent.')).toBeInTheDocument();

    await user.click(getRequiredSummary(root));
    await user.click(getRequiredSummary(stationA));
    expect(within(stationA).getByText('12 repetitions')).toBeVisible();

    await user.click(getRequiredSummary(sandan));
    expect(within(sandan).getByText('2 rounds')).toBeVisible();
    await user.click(getRequiredSummary(yakusoku));
    expect(within(yakusoku).getByText('6 repetitions')).toBeVisible();

    const free = document.querySelector<HTMLElement>('[data-activity-id="synthetic-free-version"]');
    if (free === null) {
      throw new Error('Expected the synthetic Free version container.');
    }
    await user.click(getRequiredSummary(free));
    expect(within(free).getByText('Time not set')).toBeVisible();
    expect(within(stationA).queryByText('Reps not set')).not.toBeInTheDocument();
  });

  it('keeps nested disclosure keyboard state and custom plus/minus affordances', async () => {
    const user = userEvent.setup();
    renderLibraryFixture();

    const root = document.querySelector<HTMLElement>('[data-activity-id="synthetic-root"]');
    const stationA = document.querySelector<HTMLElement>(
      '[data-activity-id="synthetic-station-a"]',
    );
    if (root === null || stationA === null) {
      throw new Error('Expected the synthetic root and Station A.');
    }
    const rootSummary = root.querySelector('summary');
    const stationSummary = stationA.querySelector('summary');
    const stationDetails = stationA.querySelector<HTMLDetailsElement>('details');
    if (rootSummary === null || stationSummary === null) {
      throw new Error('Expected nested summaries.');
    }
    if (stationDetails === null) {
      throw new Error('Expected the Station A disclosure details.');
    }

    rootSummary.focus();
    expect(rootSummary).toHaveFocus();
    await user.keyboard(' ');
    expect(root).toHaveAttribute('open');
    expect(root.querySelector('.detail-section-indicator')).toBeInTheDocument();

    stationSummary.focus();
    await user.click(stationSummary);
    expect(stationDetails).toHaveAttribute('open');
    expect(stationA.querySelector('.detail-section-indicator')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(stationDetails).not.toHaveAttribute('open');
    expect(stationA.querySelector('.detail-section-indicator')).toBeInTheDocument();
  });

  it('renders dashboard editors at nested depths and omits pure-container fallbacks', async () => {
    const user = userEvent.setup();
    const { store } = renderDashboardFixture();

    for (const activityId of [
      'synthetic-root',
      'synthetic-station-a',
      'synthetic-sandan-geiko',
      'synthetic-yakusoku-geiko',
      'synthetic-free-version',
    ]) {
      const activity = document.querySelector<HTMLElement>(`[data-activity-id="${activityId}"]`);
      if (activity === null) {
        throw new Error(`Expected the synthetic ${activityId} container.`);
      }
      await user.click(getRequiredSummary(activity));
    }

    expect(screen.getByLabelText('Minutes for Recursive keiko')).toBeInTheDocument();
    expect(screen.getByLabelText('Rounds for Sandan-geiko')).toBeInTheDocument();
    expect(screen.getByLabelText('Repetitions for Station A exercise')).toBeInTheDocument();
    expect(screen.getByLabelText('Repetitions for Yakusoku men')).toBeInTheDocument();
    expect(screen.getByLabelText('Seconds for Free version footwork')).toBeInTheDocument();
    expect(screen.queryByLabelText(/for Station A$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/for Free version$/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Not specified')).not.toBeInTheDocument();

    const root = document.querySelector<HTMLElement>('[data-activity-id="synthetic-root"]');
    const sandan = document.querySelector<HTMLElement>(
      '[data-activity-id="synthetic-sandan-geiko"]',
    );
    if (root === null || sandan === null) {
      throw new Error('Expected synthetic dashboard containers.');
    }
    expect(within(root).getByText('Start with posture and intent.')).toBeVisible();
    expect(within(sandan).getByText('Move through each variation deliberately.')).toBeVisible();

    const deepInput = screen.getByLabelText('Repetitions for Yakusoku men');
    await user.clear(deepInput);
    await user.type(deepInput, '18');
    await user.tab();
    const entry = store.getState().dashboardEntries[0];
    if (entry === undefined) {
      throw new Error('Expected a synthetic dashboard entry.');
    }
    expect(entry.quantityOverrides['synthetic-yakusoku-men']).toEqual({ repetitions: 18 });
    expect(deepInput).toHaveValue(18);
  });

  it('does not create an editor from an override on a pure container', () => {
    const store = createTestStore();
    const entryId = store.getState().addToDashboard(RECURSIVE_TRAINING_SET.id);
    store.getState().setQuantityOverride(entryId, 'synthetic-station-a', 'repetitions', 9);
    render(
      <PersistenceContext.Provider value={{ mode: 'local', writeFailed: false }}>
        <TrainingStoreProvider store={store}>
          <RecursiveDashboardFixture />
        </TrainingStoreProvider>
      </PersistenceContext.Provider>,
    );
    const entry = store.getState().dashboardEntries[0];
    if (entry === undefined) {
      throw new Error('Expected a synthetic dashboard entry.');
    }

    expect(entry.quantityOverrides['synthetic-station-a']).toEqual({ repetitions: 9 });
    expect(screen.queryByLabelText('Repetitions for Station A')).not.toBeInTheDocument();
    expect(screen.queryByText('Reps not set')).not.toBeInTheDocument();
  });

  it('traps focus around only visible dialog controls as nested disclosures open', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const store = createTestStore();

    render(
      <PersistenceContext.Provider value={{ mode: 'local', writeFailed: false }}>
        <TrainingStoreProvider store={store}>
          <MemoryRouter>
            <DrillDetailDialog trainingSet={RECURSIVE_TRAINING_SET} onClose={onClose} />
          </MemoryRouter>
        </TrainingStoreProvider>
      </PersistenceContext.Provider>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Synthetic recursive keiko' });
    const closeButton = within(dialog).getByRole('button', {
      name: 'Close Synthetic recursive keiko details.',
    });
    const rootSummary = getRequiredSummary(
      dialog.querySelector<HTMLElement>('[data-activity-id="synthetic-root"]') ?? dialog,
    );
    await waitFor(() => expect(closeButton).toHaveFocus());

    await user.tab({ shift: true });
    expect(rootSummary).toHaveFocus();
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.click(rootSummary);
    const sandanDetails = dialog.querySelector<HTMLDetailsElement>(
      '[data-activity-id="synthetic-sandan-geiko"] > details',
    );
    if (sandanDetails === null) {
      throw new Error('Expected the nested Sandan-geiko disclosure.');
    }
    const sandanSummary = getRequiredSummary(sandanDetails);
    closeButton.focus();
    await user.tab({ shift: true });
    expect(sandanSummary).toHaveFocus();
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.click(sandanSummary);
    const freeDetails = dialog.querySelector<HTMLDetailsElement>(
      '[data-activity-id="synthetic-free-version"] > details',
    );
    if (freeDetails === null) {
      throw new Error('Expected the nested Free version disclosure.');
    }
    const freeSummary = getRequiredSummary(freeDetails);
    closeButton.focus();
    await user.tab({ shift: true });
    expect(freeSummary).toHaveFocus();
    await user.tab();
    expect(closeButton).toHaveFocus();
  });

  it('hydrates a deep nested override from the unchanged version-seven storage shape', () => {
    const storage = new TestMemoryStorage();
    const first = renderDashboardFixture(storage);
    const firstEntry = first.store.getState().dashboardEntries[0];
    if (firstEntry === undefined) {
      throw new Error('Expected the first synthetic dashboard entry.');
    }
    first.store
      .getState()
      .setQuantityOverride(firstEntry.id, 'synthetic-free-timed', 'seconds', 45);
    first.view.unmount();

    const rehydrated = renderDashboardFixture(storage);
    expect(screen.getByLabelText('Seconds for Free version footwork')).toHaveValue(45);
    const rehydratedEntry = rehydrated.store.getState().dashboardEntries[0];
    expect(rehydratedEntry?.quantityOverrides['synthetic-free-timed']).toEqual({ seconds: 45 });
  });
});
