import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { asTrainingSetId } from '@kendo-menu/domain';

import { renderApp, createTestStore } from './test-utils';

const HIGH_SCHOOL_DRILL_ID = asTrainingSetId('high-school-kendo-club-drill');

describe('KendoMenu application flows', () => {
  it('renders the landing page at /app and links into the drill library', async () => {
    const user = userEvent.setup();
    const store = createTestStore();

    renderApp(store, { initialEntries: ['/app'] });

    expect(
      screen.getByRole('heading', { name: 'Plan the keiko you need today.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'KendoMenu home' })).toHaveAttribute('href', '/app');
    expect(
      screen
        .getByRole('link', { name: 'KendoMenu home' })
        .querySelector('img')
        ?.getAttribute('src'),
    ).toBe('/assets/kendo-menu-logo.jpeg');
    expect(
      screen.getByText(
        'Build a focused kendo session, adjust it to your day, and keep your practice moving.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Browse drill library' }));
    expect(screen.getByRole('heading', { name: 'Drill library' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'KendoMenu home' }));
    expect(
      screen.getByRole('heading', { name: 'Plan the keiko you need today.' }),
    ).toBeInTheDocument();
  });

  it('keeps the primary navigation in library, dashboard, and builder order', () => {
    renderApp(createTestStore(), { initialEntries: ['/app'] });

    const navigationLinks = within(
      screen.getByRole('navigation', { name: 'Primary navigation' }),
    ).getAllByRole('link');
    expect(navigationLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/app/library',
      '/app/dashboard',
      '/app/drills/new',
    ]);
  });

  it('opens and closes the responsive navigation accessibly', async () => {
    const user = userEvent.setup();

    renderApp(createTestStore(), { initialEntries: ['/app'] });

    const menuToggle = screen.getByRole('button', { name: 'Open navigation' });
    expect(menuToggle).toHaveAttribute('aria-controls', 'primary-navigation');
    expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('status', { name: 'Saved on this device' })).toBeInTheDocument();

    await user.click(menuToggle);
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    await user.click(
      within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', {
        name: 'Dashboard',
      }),
    );

    expect(screen.getByRole('heading', { name: 'Your dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('redirects the bare route to the landing page', () => {
    const store = createTestStore();

    renderApp(store, { initialEntries: ['/'] });

    expect(
      screen.getByRole('heading', { name: 'Plan the keiko you need today.' }),
    ).toBeInTheDocument();
  });

  it('navigates between the dashboard, library, and direct builder route', async () => {
    const user = userEvent.setup();
    const store = createTestStore();

    const view = renderApp(store);
    expect(screen.getByRole('heading', { name: 'Your dashboard' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /Drill library/ }));
    expect(screen.getByRole('heading', { name: 'Drill library' })).toBeInTheDocument();

    await user.click(
      within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', {
        name: 'Create drill',
      }),
    );
    expect(screen.getByRole('heading', { name: 'Create a drill' })).toBeInTheDocument();

    view.unmount();
    const directStore = createTestStore();
    renderApp(directStore, { initialEntries: ['/app/library'] });
    expect(screen.getByRole('heading', { name: 'Drill library' })).toBeInTheDocument();
  });

  it('keeps a blank repetition distinct from an explicit zero and enforces 0–500', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    store.getState().addToDashboard(HIGH_SCHOOL_DRILL_ID);
    renderApp(store);

    const repetitions = screen.getByLabelText(/repetitions for stretch/i);
    expect(repetitions).toHaveValue(null);

    await user.type(repetitions, '0');
    await user.tab();
    expect(repetitions).toHaveValue(0);
    expect(store.getState().dashboardEntries[0]?.repOverrides).toEqual({ 'warm-up-stretch': 0 });

    await user.clear(repetitions);
    await user.tab();
    expect(repetitions).toHaveValue(null);
    expect(store.getState().dashboardEntries[0]?.repOverrides).toEqual({});

    await user.type(repetitions, '501');
    await user.tab();
    expect(screen.getByText('Enter a whole number from 0 to 500.')).toBeInTheDocument();
    expect(store.getState().dashboardEntries[0]?.repOverrides).toEqual({});

    await user.clear(repetitions);
    await user.type(repetitions, '500');
    await user.tab();
    expect(repetitions).toHaveValue(500);
    expect(store.getState().dashboardEntries[0]?.repOverrides).toEqual({ 'warm-up-stretch': 500 });
  });

  it('persists notes and restores a removed dashboard entry with Undo', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    store.getState().addToDashboard(HIGH_SCHOOL_DRILL_ID);
    renderApp(store);

    const notes = screen.getByLabelText('Practice notes');
    await user.type(notes, 'Keep the shoulders relaxed.');
    await user.tab();
    await waitFor(() => {
      expect(store.getState().dashboardEntries[0]?.notes).toBe('Keep the shoulders relaxed.');
    });

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(
      screen.queryByRole('heading', { name: 'High School Kendo Club Drill' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(
      screen.getByRole('heading', { name: 'High School Kendo Club Drill' }),
    ).toBeInTheDocument();
    expect(store.getState().dashboardEntries[0]?.notes).toBe('Keep the shoulders relaxed.');
  });

  it('creates a custom drill and links it to the dashboard in one save flow', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    renderApp(store, { initialEntries: ['/app/drills/new'] });

    await user.type(screen.getByLabelText('Drill name'), 'Monday footwork');
    await user.type(screen.getByLabelText('Description (optional)'), 'A short solo session.');
    await user.type(screen.getAllByLabelText('Exercise name')[0]!, 'Footwork');
    await user.type(screen.getAllByLabelText('Subexercise name')[0]!, 'Big step forward and back');
    await user.type(screen.getAllByLabelText('Repetitions')[0]!, '24');
    await user.click(screen.getByRole('button', { name: 'Save drill to dashboard' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Your dashboard' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Monday footwork' })).toBeInTheDocument();
    });

    expect(store.getState().customTrainingSets).toHaveLength(1);
    expect(store.getState().dashboardEntries).toHaveLength(1);
    const customSet = store.getState().customTrainingSets[0];
    const entry = store.getState().dashboardEntries[0];
    expect(customSet?.id).toBe(entry?.trainingSetId);
    expect(customSet?.isBuiltIn).toBe(false);
    expect(customSet?.sections[0]?.steps[0]?.defaultReps).toBe(24);
  });

  it('does not partially create a custom drill when a repetition is outside the allowed range', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    renderApp(store, { initialEntries: ['/app/drills/new'] });

    await user.type(screen.getByLabelText('Drill name'), 'Invalid repetitions');
    await user.type(screen.getAllByLabelText('Exercise name')[0]!, 'Footwork');
    await user.type(screen.getAllByLabelText('Subexercise name')[0]!, 'Too many steps');
    await user.type(screen.getAllByLabelText('Repetitions')[0]!, '501');
    await user.click(screen.getByRole('button', { name: 'Save drill to dashboard' }));

    expect(
      screen.getByRole('alert', { name: 'Check the highlighted fields.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create a drill' })).toBeInTheDocument();
    expect(store.getState().customTrainingSets).toEqual([]);
    expect(store.getState().dashboardEntries).toEqual([]);
  });

  it('focuses the validation summary once per invalid submit while keeping field editing stable', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    renderApp(store, { initialEntries: ['/app/drills/new'] });

    await user.click(screen.getByRole('button', { name: 'Save drill to dashboard' }));
    const summary = screen.getByRole('alert', { name: 'Check the highlighted fields.' });
    await waitFor(() => expect(summary).toHaveFocus());

    const name = screen.getByLabelText('Drill name');
    await user.click(name);
    await user.type(name, 'Correctable');
    expect(name).toHaveValue('Correctable');
    expect(name).toHaveFocus();
    expect(summary).not.toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Save drill to dashboard' }));
    await waitFor(() => expect(summary).toHaveFocus());
  });

  it('renders an outer 404 inside a focusable main landmark', async () => {
    const store = createTestStore();
    renderApp(store, { initialEntries: ['/outside'] });

    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(
      screen.getByRole('heading', { name: 'That route is not part of KendoMenu.' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(main).toHaveFocus());
  });
});
