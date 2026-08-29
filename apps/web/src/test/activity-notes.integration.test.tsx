import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { asTrainingSetId, type DashboardEntry, type TrainingSet } from '@kendo-menu/domain';

import { DashboardTrainingSet } from '../features/dashboard/DashboardPage';
import { PersistenceContext } from '../features/persistence/PersistenceGate';
import { renderApp, createTestStore, TestMemoryStorage } from './test-utils';

const INTERNATIONAL_DOJO_ID = asTrainingSetId('international-dojo-2-hour-session');
const WARM_UP_ID = 'international-dojo-2-hour-session-warm-up-warm-up';
const SUBURI_ID = 'international-dojo-2-hour-session-suburi-suburi';
const ASHI_SABAKI_ID = 'international-dojo-2-hour-session-ashi-sabaki-ashi-sabaki';
const KIRIKAESHI_ID = 'international-dojo-2-hour-session-kirikaeshi-kirikaeshi';

function getActivity(activityId: string): HTMLElement {
  const activity = document.querySelector<HTMLElement>(`[data-activity-id="${activityId}"]`);
  if (activity === null) {
    throw new Error(`Expected activity ${activityId}.`);
  }
  return activity;
}

function getDashboardCard(): HTMLElement {
  const heading = screen.getByRole('heading', { name: 'International dojo menu' });
  const card = heading.closest('.dashboard-card');
  if (!(card instanceof HTMLElement)) {
    throw new Error('Expected the International dojo dashboard card.');
  }
  return card;
}

const NESTED_NOTE_TRAINING_SET = {
  id: asTrainingSetId('nested-note-fixture'),
  name: 'Nested note fixture',
  category: 'intense-drill',
  isBuiltIn: true,
  activities: [
    {
      id: 'nested-root',
      name: 'Nested root',
      children: [
        {
          id: 'nested-eligible',
          name: 'Nested eligible activity',
          notes: 'Canonical source note.',
          allowsSessionNotes: true,
          children: [
            {
              id: 'nested-leaf',
              name: 'Nested leaf',
              children: [],
            },
          ],
        },
      ],
    },
  ],
} satisfies TrainingSet;

const NESTED_NOTE_ENTRY = {
  id: 'nested-note-entry',
  trainingSetId: NESTED_NOTE_TRAINING_SET.id,
  quantityOverrides: {},
  activityNotes: { 'nested-eligible': 'Existing practitioner note.' },
  notes: 'Keep whole-session notes independent.',
  createdAt: '2026-08-29T10:00:00.000Z',
} satisfies DashboardEntry;

describe('dashboard activity notes', () => {
  it('does not render practitioner-note controls in the Keiko library', () => {
    renderApp(createTestStore(), {
      initialEntries: ['/app/library?drill=international-dojo-2-hour-session'],
    });

    expect(screen.getByRole('dialog', { name: 'International dojo menu' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Any extra notes?' })).not.toBeInTheDocument();
  });

  it('renders controls only for eligible activities and commits notes independently of quantities', async () => {
    const user = userEvent.setup();
    const storage = new TestMemoryStorage();
    const store = createTestStore(storage);
    const entryId = store.getState().addToDashboard(INTERNATIONAL_DOJO_ID);

    renderApp(store);

    const card = getDashboardCard();
    expect(within(card).getAllByRole('button', { name: 'Any extra notes?' })).toHaveLength(3);
    expect(
      within(getActivity(WARM_UP_ID)).getByRole('button', { name: 'Any extra notes?' }),
    ).toBeInTheDocument();
    expect(
      within(getActivity(SUBURI_ID)).getByRole('button', { name: 'Any extra notes?' }),
    ).toBeInTheDocument();
    expect(
      within(getActivity(ASHI_SABAKI_ID)).getByRole('button', { name: 'Any extra notes?' }),
    ).toBeInTheDocument();
    expect(
      within(getActivity(KIRIKAESHI_ID)).queryByRole('button', { name: 'Any extra notes?' }),
    ).not.toBeInTheDocument();

    const warmUp = getActivity(WARM_UP_ID);
    const toggle = within(warmUp).getByRole('button', { name: 'Any extra notes?' });
    const panelId = toggle.getAttribute('aria-controls');
    expect(panelId).not.toBeNull();
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const panel = panelId === null ? null : document.getElementById(panelId);
    expect(panel).not.toBeNull();
    if (panel === null) {
      throw new Error('Expected the activity-note panel.');
    }
    expect(panel).toHaveAttribute('hidden');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveAttribute('hidden');
    const textarea = within(warmUp).getByLabelText('Extra notes for Warm-up');
    expect(textarea).toBeVisible();

    await user.type(textarea, '  Keep the knees soft.\nBreathe.  ');
    await user.tab();
    expect(store.getState().dashboardEntries[0]?.activityNotes).toEqual({
      [WARM_UP_ID]: '  Keep the knees soft.\nBreathe.  ',
    });
    expect(within(warmUp).getByText('Updated.')).toBeVisible();

    const warmUpQuantity = within(warmUp).getByLabelText('Minutes for Warm-up');
    await user.clear(warmUpQuantity);
    await user.type(warmUpQuantity, '12');
    await user.tab();
    expect(store.getState().dashboardEntries[0]?.quantityOverrides).toEqual({
      [WARM_UP_ID]: { minutes: 12 },
    });

    const sessionNotes = within(card).getByLabelText('Practice notes');
    await user.type(sessionNotes, 'General session note.');
    await user.tab();
    expect(store.getState().dashboardEntries[0]).toMatchObject({
      id: entryId,
      notes: 'General session note.',
      activityNotes: {
        [WARM_UP_ID]: '  Keep the knees soft.\nBreathe.  ',
      },
    });

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(panel).toHaveAttribute('hidden');
  });

  it('reopens saved notes after a fresh store and restores independent duplicate entries after undo', async () => {
    const user = userEvent.setup();
    const storage = new TestMemoryStorage();
    const firstStore = createTestStore(storage);
    const firstId = firstStore.getState().addToDashboard(INTERNATIONAL_DOJO_ID);
    const secondId = firstStore.getState().addToDashboard(INTERNATIONAL_DOJO_ID);
    const firstView = renderApp(firstStore);

    const cards = () =>
      screen.getAllByRole('heading', { name: 'International dojo menu' }).map((heading) => {
        const card = heading.closest('.dashboard-card');
        if (!(card instanceof HTMLElement)) {
          throw new Error('Expected a dashboard card.');
        }
        return card;
      });
    expect(cards()).toHaveLength(2);

    const firstWarmUp = within(getActivity(WARM_UP_ID)).getByRole('button', {
      name: 'Any extra notes?',
    });
    await user.click(firstWarmUp);
    const firstCard = cards()[0];
    if (firstCard === undefined) {
      throw new Error('Expected the first dashboard card.');
    }
    const firstTextarea = within(firstCard).getByLabelText('Extra notes for Warm-up');
    await user.type(firstTextarea, 'First dashboard entry.');
    await user.tab();

    const secondCard = cards()[1];
    if (secondCard === undefined) {
      throw new Error('Expected the second dashboard card.');
    }
    const secondWarmActivity = secondCard.querySelector<HTMLElement>(
      `[data-activity-id="${WARM_UP_ID}"]`,
    );
    if (secondWarmActivity === null) {
      throw new Error('Expected the second Warm-up activity.');
    }
    const secondWarmUp = within(secondWarmActivity).getByRole('button', {
      name: 'Any extra notes?',
    });
    await user.click(secondWarmUp);
    const secondTextarea = within(secondCard).getByLabelText('Extra notes for Warm-up');
    await user.type(secondTextarea, 'Second dashboard entry.');
    await user.tab();

    expect(firstStore.getState().dashboardEntries).toEqual([
      expect.objectContaining({
        id: firstId,
        activityNotes: { [WARM_UP_ID]: 'First dashboard entry.' },
      }),
      expect.objectContaining({
        id: secondId,
        activityNotes: { [WARM_UP_ID]: 'Second dashboard entry.' },
      }),
    ]);

    const firstRemove = within(firstCard).getByRole('button', { name: 'Remove' });
    await user.click(firstRemove);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(cards()).toHaveLength(2);
    expect(
      within(cards()[0] ?? document.body).getByLabelText('Extra notes for Warm-up'),
    ).toHaveValue('First dashboard entry.');

    firstView.unmount();
    const secondStore = createTestStore(storage);
    const view = renderApp(secondStore);
    expect(view.getAllByText('Note added')).toHaveLength(2);
    const reloadedCards = cards();
    expect(reloadedCards).toHaveLength(2);
    expect(
      within(reloadedCards[0] ?? document.body).getByLabelText('Extra notes for Warm-up'),
    ).toHaveValue('First dashboard entry.');
    expect(
      within(reloadedCards[1] ?? document.body).getByLabelText('Extra notes for Warm-up'),
    ).toHaveValue('Second dashboard entry.');
  });

  it('keeps canonical source notes separate and renders the control at nested depth', async () => {
    const user = userEvent.setup();
    const setActivityNote = vi.fn();

    render(
      <PersistenceContext.Provider value={{ mode: 'local', writeFailed: false }}>
        <DashboardTrainingSet
          entry={NESTED_NOTE_ENTRY}
          index={0}
          trainingSet={NESTED_NOTE_TRAINING_SET}
          onRemove={() => undefined}
          onUpdate={() => undefined}
          onSetQuantity={() => undefined}
          onClearQuantity={() => undefined}
          onSetActivityNote={setActivityNote}
        />
      </PersistenceContext.Provider>,
    );

    const nested = getActivity('nested-eligible');
    expect(within(nested).getByText('Canonical source note.')).toBeVisible();
    const toggle = within(nested).getByRole('button', { name: 'Any extra notes?' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const textarea = within(nested).getByLabelText('Extra notes for Nested eligible activity');
    expect(textarea).toHaveValue('Existing practitioner note.');

    await user.clear(textarea);
    await user.type(textarea, 'Updated practitioner note.');
    await user.tab();
    expect(setActivityNote).toHaveBeenCalledWith('nested-eligible', 'Updated practitioner note.');
    expect(within(nested).getByText('Canonical source note.')).toBeVisible();
  });

  it('shows the persistence failure status after an activity-note blur', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    store.getState().addToDashboard(INTERNATIONAL_DOJO_ID);
    renderApp(store, { persistence: { writeFailed: true } });

    const warmUp = getActivity(WARM_UP_ID);
    await user.click(within(warmUp).getByRole('button', { name: 'Any extra notes?' }));
    const textarea = within(warmUp).getByLabelText('Extra notes for Warm-up');
    await user.type(textarea, 'This write should be reported.');
    await user.tab();
    expect(within(warmUp).getByText('Not saved to this device.')).toBeVisible();
  });
});
