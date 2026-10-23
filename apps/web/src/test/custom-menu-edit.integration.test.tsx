import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';

import { createTestStore, renderApp } from './test-utils';

function requireItem<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Expected item ${index + 1}.`);
  return item;
}

const CUSTOM_INPUT = {
  name: 'Personal keiko',
  description: 'A session for focused practice.',
  category: 'custom',
  sections: [
    {
      name: 'Warm up',
      notes: 'Retain the authored activity notes.',
      exercises: [
        {
          name: 'Suburi',
          quantities: { repetitions: 12 },
          notes: 'Keep this authored exercise note.',
        },
        { name: 'Kakarigeiko', quantities: { duration: { unit: 'seconds', value: 45 } } },
      ],
    },
    {
      name: 'Finish',
      exercises: [{ name: 'Jigeiko', quantities: { duration: { unit: 'minutes', value: 12.5 } } }],
    },
  ],
} as const;

function createCustomMenu() {
  const store = createTestStore();
  const created = store.getState().createCustomTrainingSetAndAddToDashboard(CUSTOM_INPUT);
  const firstSection = created.trainingSet.activities[0];
  const retainedExercise = firstSection?.children[0];
  const removedExercise = firstSection?.children[1];
  if (
    firstSection === undefined ||
    retainedExercise === undefined ||
    removedExercise === undefined
  ) {
    throw new Error('Expected the custom menu fixture.');
  }
  store
    .getState()
    .setQuantityOverride(created.dashboardEntryId, retainedExercise.id, 'repetitions', 24);
  store.getState().setQuantityOverride(created.dashboardEntryId, removedExercise.id, 'seconds', 60);
  const finalSection = created.trainingSet.activities[1];
  const finalExercise = finalSection?.children[0];
  if (finalSection === undefined || finalExercise === undefined) {
    throw new Error('Expected the second custom activity fixture.');
  }
  store.getState().setQuantityOverride(created.dashboardEntryId, finalExercise.id, 'minutes', 15);
  store.getState().updateDashboardEntry(created.dashboardEntryId, { notes: 'Practice notes.' });
  return { store, created };
}

describe('custom menu editing', () => {
  it('updates a custom snapshot in place while retaining effective values and hidden metadata', async () => {
    const user = userEvent.setup();
    const flush = vi.fn(() => Promise.resolve());
    const { store, created } = createCustomMenu();
    const originalEntry = store.getState().dashboardEntries[0];
    const originalSet = originalEntry?.trainingSet;
    if (originalEntry === undefined || originalSet === undefined) {
      throw new Error('Expected the custom dashboard snapshot.');
    }
    const warmUpSection = requireItem(originalSet.activities, 0);
    const originalFinishSection = requireItem(originalSet.activities, 1);
    const retainedExercise = requireItem(warmUpSection.children, 0);
    const removedExercise = requireItem(warmUpSection.children, 1);
    const removedActivityExercise = requireItem(originalFinishSection.children, 0);

    renderApp(store, {
      initialEntries: [`/app/guest/drills/${created.dashboardEntryId}/edit`],
      persistence: { flush },
    });

    expect(await screen.findByRole('heading', { name: 'Edit menu' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Session name' })).toHaveValue('Personal keiko');
    expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(24);

    await user.clear(screen.getByRole('textbox', { name: 'Session name' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Session name' }),
      'Updated personal keiko',
    );
    await user.click(requireItem(screen.getAllByRole('button', { name: 'Remove exercise' }), 1));
    await user.click(requireItem(screen.getAllByRole('button', { name: 'Remove activity' }), 1));
    await user.click(screen.getByRole('button', { name: 'Add activity' }));

    const activityNames = screen.getAllByRole('textbox', { name: 'Activity name' });
    const addedActivityName = requireItem(activityNames, 1);
    await user.clear(addedActivityName);
    await user.type(addedActivityName, 'Footwork');
    const exerciseNames = screen.getAllByRole('textbox', { name: 'Exercise name' });
    const addedExerciseName = requireItem(exerciseNames, 1);
    await user.clear(addedExerciseName);
    await user.type(addedExerciseName, 'Okuri-ashi');
    const quantities = screen.getAllByRole('spinbutton');
    await user.type(requireItem(quantities, 1), '8');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('heading', { name: 'Your dashboard' })).toBeVisible();
    expect(flush).toHaveBeenCalledOnce();
    const updatedEntry = store.getState().dashboardEntries[0];
    const updatedSet = updatedEntry?.trainingSet;
    if (updatedEntry === undefined || updatedSet === undefined) {
      throw new Error('Expected the updated custom dashboard snapshot.');
    }
    expect(updatedEntry.id).toBe(originalEntry.id);
    expect(updatedEntry.trainingSetId).toBe(originalEntry.trainingSetId);
    expect(updatedEntry.createdAt).toBe(originalEntry.createdAt);
    expect(updatedEntry.notes).toBe('Practice notes.');
    expect(updatedEntry.quantityOverrides[retainedExercise.id]).toEqual({ repetitions: 24 });
    expect(updatedEntry.quantityOverrides[removedExercise.id]).toBeUndefined();
    expect(updatedEntry.quantityOverrides[removedActivityExercise.id]).toBeUndefined();
    expect(updatedSet.name).toBe('Updated personal keiko');
    const updatedWarmUp = requireItem(updatedSet.activities, 0);
    const addedActivity = requireItem(updatedSet.activities, 1);
    const updatedRetainedExercise = requireItem(updatedWarmUp.children, 0);
    const addedExercise = requireItem(addedActivity.children, 0);
    expect(updatedWarmUp.id).toBe(warmUpSection.id);
    expect(updatedWarmUp.notes).toBe('Retain the authored activity notes.');
    expect(updatedWarmUp.children).toHaveLength(1);
    expect(updatedRetainedExercise).toMatchObject({
      id: retainedExercise.id,
      name: 'Suburi',
      notes: 'Keep this authored exercise note.',
      quantities: { repetitions: 12 },
    });
    expect(addedActivity.name).toBe('Footwork');
    expect(addedExercise).toMatchObject({
      name: 'Okuri-ashi',
      quantities: { repetitions: 8 },
    });
    expect(originalSet.activities.map(({ id }) => id)).not.toContain(addedActivity.id);
    expect(
      originalSet.activities.flatMap((section) => section.children.map(({ id }) => id)),
    ).not.toContain(addedExercise.id);
  });

  it('cancels without applying the draft and rejects built-in or unknown direct edit routes', async () => {
    const user = userEvent.setup();
    const { store, created } = createCustomMenu();
    const originalEntry = store.getState().dashboardEntries[0];
    if (originalEntry === undefined) throw new Error('Expected the custom menu fixture.');

    const view = renderApp(store, {
      initialEntries: [`/app/guest/drills/${created.dashboardEntryId}/edit`],
    });
    await screen.findByRole('heading', { name: 'Edit menu' });
    await user.clear(screen.getByRole('textbox', { name: 'Session name' }));
    await user.type(screen.getByRole('textbox', { name: 'Session name' }), 'Discard this draft');
    await user.click(screen.getByRole('link', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Your dashboard' })).toBeVisible();
    expect(store.getState().dashboardEntries[0]?.trainingSet?.name).toBe('Personal keiko');

    view.unmount();
    const builtInSet = requireItem(DEFAULT_TRAINING_SETS, 0);
    const builtInId = store.getState().addToDashboard(builtInSet.id);
    const builtInView = renderApp(store, {
      initialEntries: [`/app/guest/drills/${builtInId}/edit`],
    });
    expect(await screen.findByRole('heading', { name: 'Menu editing unavailable' })).toBeVisible();
    expect(screen.getByText('Only custom menus can be edited here.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Session name' })).not.toBeInTheDocument();
    expect(originalEntry.trainingSet?.isBuiltIn).toBe(false);

    builtInView.unmount();
    renderApp(store, { initialEntries: ['/app/guest/drills/missing-entry/edit'] });
    expect(await screen.findByText('This menu is not available on this dashboard.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });
});
