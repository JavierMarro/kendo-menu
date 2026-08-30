import { render, screen, waitFor, within } from '@testing-library/react';
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
const DASHBOARD_EDITOR_TEST_TIMEOUT = 30_000;

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

async function openDashboardMenu(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<HTMLElement> {
  const card = getDashboardCard();
  await user.click(within(card).getByRole('button', { name: 'View more' }));
  return screen.getByRole('dialog', { name });
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
    expect(screen.queryByRole('button', { name: 'Any extra details?' })).not.toBeInTheDocument();
  });

  it(
    'renders controls only for eligible activities and commits notes independently of quantities',
    async () => {
      const user = userEvent.setup();
      const storage = new TestMemoryStorage();
      const store = createTestStore(storage);
      const entryId = store.getState().addToDashboard(INTERNATIONAL_DOJO_ID);

      renderApp(store);
      const dialog = await openDashboardMenu(user, 'International dojo menu');

      expect(within(dialog).getAllByRole('button', { name: 'Any extra details?' })).toHaveLength(3);
      expect(
        within(getActivity(WARM_UP_ID)).getByRole('button', { name: 'Any extra details?' }),
      ).toBeInTheDocument();
      expect(
        within(getActivity(SUBURI_ID)).getByRole('button', { name: 'Any extra details?' }),
      ).toBeInTheDocument();
      expect(
        within(getActivity(ASHI_SABAKI_ID)).getByRole('button', { name: 'Any extra details?' }),
      ).toBeInTheDocument();
      expect(
        within(getActivity(KIRIKAESHI_ID)).queryByRole('button', { name: 'Any extra details?' }),
      ).not.toBeInTheDocument();

      const warmUp = getActivity(WARM_UP_ID);
      const toggle = within(warmUp).getByRole('button', { name: 'Any extra details?' });
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
      expect(within(warmUp).getByLabelText('Extra notes for Warm-up')).not.toBeVisible();

      const suburi = getActivity(SUBURI_ID);
      const suburiToggle = within(suburi).getByRole('button', { name: 'Any extra details?' });
      expect(suburiToggle).toHaveAttribute('aria-expanded', 'false');

      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(suburiToggle).toHaveAttribute('aria-expanded', 'false');
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

      const sessionNotes = within(dialog).getByLabelText('Practice notes');
      await user.type(sessionNotes, 'General session note.');
      await user.tab();
      expect(store.getState().dashboardEntries[0]).toMatchObject({
        id: entryId,
        notes: 'General session note.',
        activityNotes: {
          [WARM_UP_ID]: '  Keep the knees soft.\nBreathe.  ',
        },
      });

      await user.click(suburiToggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(suburiToggle).toHaveAttribute('aria-expanded', 'true');

      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(suburiToggle).toHaveAttribute('aria-expanded', 'true');
      expect(panel).toHaveAttribute('hidden');

      await user.click(toggle);
      expect(textarea).toBeVisible();
      expect(textarea).toHaveValue('  Keep the knees soft.\nBreathe.  ');
    },
    DASHBOARD_EDITOR_TEST_TIMEOUT,
  );

  it(
    'explicitly saves focused quantity, activity-note, and session-note drafts',
    async () => {
      const user = userEvent.setup();
      const storage = new TestMemoryStorage();
      const store = createTestStore(storage);
      store.getState().addToDashboard(INTERNATIONAL_DOJO_ID);

      renderApp(store);
      const dialog = await openDashboardMenu(user, 'International dojo menu');
      const saveButton = within(dialog).getByRole('button', { name: 'Save your changes' });
      expect(saveButton).toHaveAttribute('type', 'submit');
      expect(saveButton).toHaveAccessibleDescription(
        'Changes also save automatically when you leave a field.',
      );

      const warmUp = getActivity(WARM_UP_ID);
      const quantity = within(warmUp).getByLabelText('Minutes for Warm-up');
      await user.clear(quantity);
      await user.type(quantity, '14');
      await user.click(saveButton);
      expect(store.getState().dashboardEntries[0]?.quantityOverrides).toEqual({
        [WARM_UP_ID]: { minutes: 14 },
      });
      expect(within(dialog).getByText('Changes saved on this device.')).toBeVisible();

      await user.click(
        within(warmUp).getByRole('button', {
          name: 'Any extra details?',
        }),
      );
      const activityNote = within(warmUp).getByLabelText('Extra notes for Warm-up');
      await user.type(activityNote, 'Relax the shoulders.');
      await user.click(saveButton);
      expect(store.getState().dashboardEntries[0]?.activityNotes).toEqual({
        [WARM_UP_ID]: 'Relax the shoulders.',
      });

      const sessionNotes = within(dialog).getByLabelText('Practice notes');
      await user.type(sessionNotes, 'Keep the pace calm.');
      await user.click(saveButton);
      expect(store.getState().dashboardEntries[0]).toMatchObject({
        notes: 'Keep the pace calm.',
        quantityOverrides: { [WARM_UP_ID]: { minutes: 14 } },
        activityNotes: { [WARM_UP_ID]: 'Relax the shoulders.' },
      });
      expect(storage.read()).toContain('Keep the pace calm.');
      expect(storage.read()).toContain('Relax the shoulders.');
      expect(storage.read()).toContain('"minutes":14');
    },
    DASHBOARD_EDITOR_TEST_TIMEOUT,
  );

  it(
    'reopens saved notes after a fresh store and restores independent duplicate entries after undo',
    async () => {
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

      const firstCard = cards()[0];
      if (firstCard === undefined) {
        throw new Error('Expected the first dashboard card.');
      }
      await user.click(within(firstCard).getByRole('button', { name: 'View more' }));
      const firstDialog = screen.getByRole('dialog', { name: 'International dojo menu' });
      const firstWarmUp = within(getActivity(WARM_UP_ID)).getByRole('button', {
        name: 'Any extra details?',
      });
      await user.click(firstWarmUp);
      const firstTextarea = within(firstDialog).getByLabelText('Extra notes for Warm-up');
      await user.type(firstTextarea, 'First dashboard entry.');
      await user.tab();
      await user.click(
        within(firstDialog).getByRole('button', {
          name: 'Close International dojo menu details.',
        }),
      );

      const secondCard = cards()[1];
      if (secondCard === undefined) {
        throw new Error('Expected the second dashboard card.');
      }
      await user.click(within(secondCard).getByRole('button', { name: 'View more' }));
      const secondDialog = screen.getByRole('dialog', { name: 'International dojo menu' });
      const secondWarmUp = within(getActivity(WARM_UP_ID)).getByRole('button', {
        name: 'Any extra details?',
      });
      await user.click(secondWarmUp);
      const secondTextarea = within(secondDialog).getByLabelText('Extra notes for Warm-up');
      await user.type(secondTextarea, 'Second dashboard entry.');
      await user.tab();
      await user.click(
        within(secondDialog).getByRole('button', {
          name: 'Close International dojo menu details.',
        }),
      );

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
      const restoredFirstCard = cards()[0];
      if (restoredFirstCard === undefined) {
        throw new Error('Expected the restored first dashboard card.');
      }
      await user.click(within(restoredFirstCard).getByRole('button', { name: 'View more' }));
      const restoredFirstDialog = screen.getByRole('dialog', { name: 'International dojo menu' });
      expect(within(restoredFirstDialog).getByLabelText('Extra notes for Warm-up')).toHaveValue(
        'First dashboard entry.',
      );
      await user.click(
        within(restoredFirstDialog).getByRole('button', {
          name: 'Close International dojo menu details.',
        }),
      );

      firstView.unmount();
      const secondStore = createTestStore(storage);
      renderApp(secondStore);
      const reloadedCards = cards();
      expect(reloadedCards).toHaveLength(2);
      expect(screen.getAllByText('No notes yet')).toHaveLength(2);
      for (const [index, expectedNote] of [
        'First dashboard entry.',
        'Second dashboard entry.',
      ].entries()) {
        const card = cards()[index];
        if (card === undefined) {
          throw new Error('Expected a reloaded dashboard card with notes.');
        }
        await user.click(within(card).getByRole('button', { name: 'View more' }));
        const reloadedDialog = screen.getByRole('dialog', { name: 'International dojo menu' });
        expect(within(reloadedDialog).getByLabelText('Extra notes for Warm-up')).toHaveValue(
          expectedNote,
        );
        await user.click(
          within(reloadedDialog).getByRole('button', {
            name: 'Close International dojo menu details.',
          }),
        );
      }
    },
    DASHBOARD_EDITOR_TEST_TIMEOUT,
  );

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

    const root = getActivity('nested-root');
    const rootSummary = root.querySelector('summary');
    if (rootSummary === null) {
      throw new Error('Expected the nested root disclosure.');
    }
    await user.click(rootSummary);

    const nested = getActivity('nested-eligible');
    const nestedSummary = nested.querySelector('summary');
    if (nestedSummary === null) {
      throw new Error('Expected the nested eligible disclosure.');
    }
    await user.click(nestedSummary);
    expect(within(nested).getByText('Canonical source note.')).toBeVisible();
    const toggle = within(nested).getByRole('button', { name: 'Any extra details?' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const textarea = within(nested).getByLabelText('Extra notes for Nested eligible activity');
    expect(textarea).toHaveValue('Existing practitioner note.');

    await user.clear(textarea);
    await user.type(textarea, 'Updated practitioner note.');
    await user.tab();
    expect(setActivityNote).toHaveBeenCalledWith('nested-eligible', 'Updated practitioner note.');
    expect(within(nested).getByText('Canonical source note.')).toBeVisible();
  });

  it(
    'shows the persistence failure status after an activity-note blur',
    async () => {
      const user = userEvent.setup();
      const store = createTestStore();
      store.getState().addToDashboard(INTERNATIONAL_DOJO_ID);
      renderApp(store, { persistence: { writeFailed: true } });
      const dialog = await openDashboardMenu(user, 'International dojo menu');

      const warmUp = getActivity(WARM_UP_ID);
      await user.click(within(warmUp).getByRole('button', { name: 'Any extra details?' }));
      const textarea = within(dialog).getByLabelText('Extra notes for Warm-up');
      await user.type(textarea, 'This write should be reported.');
      await user.tab();
      await waitFor(() =>
        expect(within(warmUp).getByText('Not saved to this device.')).toBeVisible(),
      );

      await user.click(within(dialog).getByRole('button', { name: 'Save your changes' }));
      expect(within(dialog).getByText('Changes are not being saved to this device.')).toBeVisible();
      expect(within(dialog).queryByText('Changes saved on this device.')).not.toBeInTheDocument();
    },
    DASHBOARD_EDITOR_TEST_TIMEOUT,
  );
});
