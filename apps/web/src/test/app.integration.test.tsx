import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { asTrainingSetId } from '@kendo-menu/domain';

import { formatTrainingQuantity } from '../lib/training-data';
import { renderApp, createTestStore } from './test-utils';

const SENIOR_HIGH_SCHOOL_DRILL_ID = asTrainingSetId('senior-high-school-kendo-club');
const SENIOR_HIGH_SCHOOL_STRETCH_ID = 'senior-high-school-kendo-club-warm-up-stretch';
const JUNIOR_HIGH_DRILL_ID = asTrainingSetId('junior-high-kendo-club');
const JUNIOR_HIGH_HAYA_ID = 'junior-high-kendo-club-suburi-haya';
const INTERNATIONAL_DOJO_ID = asTrainingSetId('international-dojo-2-hour-session');
const INTERNATIONAL_WARM_UP_ID = 'international-dojo-2-hour-session-warm-up-warm-up';
const INTERNATIONAL_KAKARIGEIKO_ID = 'international-dojo-2-hour-session-kakarigeiko-kakarigeiko';
const OFFICIAL_ZNKR_ID = asTrainingSetId('official-znkr-ajkf');
const OFFICIAL_ZNKR_MEN_ID = 'official-znkr-ajkf-kihon-waza-men';
const TOP_UNIVERSITY_ID = asTrainingSetId('top-university');
const TOP_UNIVERSITY_KAKARIGEIKO_ID = 'top-university-kakarigeiko-kakarigeiko';

describe('KendoMenu application flows', () => {
  it('formats count, fixed-duration, and range quantities without changing units', () => {
    expect(formatTrainingQuantity({ unit: 'repetitions', value: 5 })).toBe('5 repetitions');
    expect(formatTrainingQuantity({ unit: 'sets', value: 1 })).toBe('1 set');
    expect(formatTrainingQuantity({ unit: 'rounds', value: 3 })).toBe('3 rounds');
    expect(formatTrainingQuantity({ unit: 'seconds', value: 30 })).toBe('30 seconds');
    expect(formatTrainingQuantity({ unit: 'minutes', value: 2.5 })).toBe('2.5 minutes');
    expect(formatTrainingQuantity({ unit: 'seconds', value: { min: 30, max: 60 } })).toBe(
      '30–60 seconds',
    );
  });

  it('shows a session-only cookie notice with policy details and dismisses without storage', async () => {
    const user = userEvent.setup();

    renderApp(createTestStore(), { initialEntries: ['/app'] });

    const notice = screen.getByRole('complementary', { name: 'Cookie notice' });
    expect(notice).toHaveTextContent(
      'KendoMenu currently uses no cookies or third-party tracking. We may add privacy-friendly analytics in the future.',
    );
    expect(screen.getByRole('link', { name: 'More information' })).toHaveAttribute(
      'href',
      '/cookies',
    );

    await user.click(screen.getByRole('button', { name: 'Got it' }));

    expect(screen.queryByRole('complementary', { name: 'Cookie notice' })).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
  });

  it('keeps the cookie notice dismissal across navigation but resets it for a fresh render', async () => {
    const user = userEvent.setup();
    const view = renderApp(createTestStore(), { initialEntries: ['/app'] });

    await user.click(screen.getByRole('button', { name: 'Got it' }));
    await user.click(
      within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', {
        name: /Drill library/,
      }),
    );

    expect(screen.getByRole('heading', { name: 'Drill library' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Cookie notice' })).not.toBeInTheDocument();

    view.unmount();
    renderApp(createTestStore(), { initialEntries: ['/app/dashboard'] });

    expect(screen.getByRole('complementary', { name: 'Cookie notice' })).toBeInTheDocument();
  });

  it('renders the cookie policy at /cookies inside the existing application shell', () => {
    renderApp(createTestStore(), { initialEntries: ['/cookies'] });

    expect(screen.getByRole('heading', { name: 'Cookie Policy', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What are cookies?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How KendoMenu uses cookies' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Local storage' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Analytics' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How to disable cookies?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contact' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.getByText(/privacy-friendly Plausible Analytics/)).toBeInTheDocument();
  });

  it('renders a named footer with shared navigation and placeholder social destinations', () => {
    renderApp(createTestStore(), { initialEntries: ['/app'] });

    const footer = screen.getByRole('contentinfo', { name: 'Site footer' });
    expect(within(footer).getByText('KendoMenu')).toBeVisible();
    expect(within(footer).getByRole('link', { name: 'KendoMenu home' })).toHaveAttribute(
      'href',
      '/app',
    );
    expect(within(footer).getByRole('heading', { name: 'Navigation', level: 2 })).toBeVisible();

    const footerNavigation = within(footer).getByRole('navigation', { name: 'Navigation' });
    expect(
      within(footerNavigation)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/app#how-it-works-title', '/app/library', '/app/dashboard', '/app#faq-title']);

    const socialNavigation = within(footer).getByRole('navigation', { name: 'Social' });
    expect(
      within(socialNavigation).getByRole('link', { name: 'GitHub (placeholder)' }),
    ).toHaveAttribute('href', 'https://github.com/');
    expect(
      within(socialNavigation).getByRole('link', { name: 'LinkedIn (placeholder)' }),
    ).toHaveAttribute('href', 'https://www.linkedin.com/');
  });

  it('renders the landing page at /app and links into the drill library', async () => {
    const user = userEvent.setup();
    const store = createTestStore();

    renderApp(store, { initialEntries: ['/app'] });

    expect(
      screen.getByRole('heading', { name: 'Plan the keiko you need today.' }),
    ).toBeInTheDocument();
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'KendoMenu home' })).toHaveAttribute(
      'href',
      '/app',
    );
    expect(
      within(header)
        .getByRole('link', { name: 'KendoMenu home' })
        .querySelector('img')
        ?.getAttribute('src'),
    ).toBe('/assets/kendo-menu-logo.jpeg');
    expect(
      screen.getByText(
        'Build a focused kendo session, adjust it to your day, and keep your practice moving.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'A keiko menu for the day in front of you.',
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How it works', level: 2 })).toBeInTheDocument();
    expect(
      screen.getByText(
        /These figures are a working target for a compact, carefully sourced starting point/,
      ),
    ).toBeInTheDocument();

    const faqButton = screen.getByRole('button', { name: 'What is KendoMenu?' });
    expect(faqButton).toHaveAttribute('aria-expanded', 'true');
    expect(faqButton).toHaveAttribute('aria-controls', 'what-is-kendomenu-answer');
    expect(document.getElementById('what-is-kendomenu-answer')).not.toHaveAttribute('hidden');

    await user.click(faqButton);
    expect(faqButton).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('what-is-kendomenu-answer')).toHaveAttribute('hidden');

    await user.keyboard('{Enter}');
    expect(faqButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('button', { name: /\?$/ })).toHaveLength(6);

    expect(screen.getByRole('link', { name: 'Record your first keiko' })).toHaveAttribute(
      'href',
      '/app/library',
    );

    await user.click(screen.getByRole('link', { name: 'Browse drill library' }));
    expect(screen.getByRole('heading', { name: 'Drill library' })).toBeInTheDocument();

    await user.click(within(header).getByRole('link', { name: 'KendoMenu home' }));
    expect(
      screen.getByRole('heading', { name: 'Plan the keiko you need today.' }),
    ).toBeInTheDocument();
  });

  it('keeps the current primary navigation order', () => {
    renderApp(createTestStore(), { initialEntries: ['/app'] });

    const navigationLinks = within(
      screen.getByRole('navigation', { name: 'Primary navigation' }),
    ).getAllByRole('link');
    expect(navigationLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/app#how-it-works-title',
      '/app/library',
      '/app/dashboard',
      '/app#faq-title',
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

    await user.click(
      within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', {
        name: /Drill library/,
      }),
    );
    expect(screen.getByRole('heading', { name: 'Drill library' })).toBeInTheDocument();

    view.unmount();
    const builderView = renderApp(createTestStore(), { initialEntries: ['/app/drills/new'] });
    expect(screen.getByRole('heading', { name: 'Create a drill' })).toBeInTheDocument();

    builderView.unmount();
    renderApp(createTestStore(), { initialEntries: ['/app/library'] });
    expect(screen.getByRole('heading', { name: 'Drill library' })).toBeInTheDocument();
  });

  it('renders exactly 11 compact drill cards with stable detail links', () => {
    renderApp(createTestStore(), { initialEntries: ['/app/library'] });

    const library = screen.getByRole('region', { name: 'Available training sets' });
    const cards = within(library).getAllByRole('article');
    expect(cards).toHaveLength(11);

    const heading = within(library).getByRole('heading', {
      name: 'International dojo (2 hour session)',
    });
    const card = heading.closest('article');
    if (card === null) {
      throw new Error('Expected the international-dojo heading inside a drill card.');
    }

    expect(within(card).getByText('Category not specified')).toBeVisible();
    expect(within(card).getByText('Description not provided.')).toBeVisible();
    expect(within(card).getByText('20 activities')).toBeVisible();
    expect(within(card).getByRole('link', { name: 'View drill' })).toHaveAttribute(
      'href',
      '/app/library/international-dojo-2-hour-session',
    );
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('opens full drill details and toggles collapsed native section disclosures', async () => {
    const user = userEvent.setup();
    const view = renderApp(createTestStore(), { initialEntries: ['/app/library'] });
    const cardHeading = screen.getByRole('heading', {
      name: 'International dojo (2 hour session)',
    });
    const card = cardHeading.closest('article');
    if (card === null) {
      throw new Error('Expected the international-dojo heading inside a drill card.');
    }

    await user.click(within(card).getByRole('link', { name: 'View drill' }));
    expect(
      screen.getByRole('heading', { name: 'International dojo (2 hour session)', level: 1 }),
    ).toBeVisible();
    const sections = view.container.querySelectorAll<HTMLDetailsElement>('.detail-section');
    expect(sections).toHaveLength(12);
    expect([...sections].every((section) => !section.open)).toBe(true);

    const firstSection = sections[0];
    const firstSummary = firstSection?.querySelector('summary');
    if (firstSection === undefined || firstSummary === null || firstSummary === undefined) {
      throw new Error('Expected the first drill section to have a summary.');
    }
    expect(firstSummary).toHaveTextContent('Warm-up');
    expect(firstSummary).toHaveTextContent('1 activity');

    await user.click(firstSummary);
    expect(firstSection).toHaveAttribute('open');
    expect(within(firstSection).getByText('10 minutes')).toBeVisible();
    expect(firstSection.querySelector('.step-label')).toBeNull();
    expect(within(firstSection).getAllByText('Warm-up')).toHaveLength(1);

    await user.click(firstSummary);
    expect(firstSection).not.toHaveAttribute('open');

    const uchikomiSection = [...sections].find((section) =>
      section.querySelector('summary')?.textContent?.includes('Uchikomi'),
    );
    const uchikomiSummary = uchikomiSection?.querySelector('summary');
    if (
      uchikomiSection === undefined ||
      uchikomiSummary === null ||
      uchikomiSummary === undefined
    ) {
      throw new Error('Expected the corrected Uchikomi sequence disclosure.');
    }
    expect(uchikomiSummary).toHaveTextContent('1 exercise');
    await user.click(uchikomiSummary);
    expect(within(uchikomiSection).getAllByText('Men → Kote → Kote-men → Men')).toHaveLength(1);
    expect(within(uchikomiSection).getByText('5 repetitions')).toBeVisible();
  });

  it('renders simultaneous units, missing quantities, and explicit zero distinctly', async () => {
    const user = userEvent.setup();
    const juniorView = renderApp(createTestStore(), {
      initialEntries: ['/app/library/junior-high-kendo-club'],
    });
    const suburiSection = [
      ...juniorView.container.querySelectorAll<HTMLDetailsElement>('details'),
    ][0];
    const suburiSummary = suburiSection?.querySelector('summary');
    if (suburiSection === undefined || suburiSummary === null || suburiSummary === undefined) {
      throw new Error('Expected the junior-high Suburi disclosure.');
    }
    await user.click(suburiSummary);
    const hayaQuantities = within(suburiSection).getByRole('list', { name: 'Quantities for haya' });
    expect(within(hayaQuantities).getByText('100 repetitions')).toBeVisible();
    expect(within(hayaQuantities).getByText('2 sets')).toBeVisible();
    juniorView.unmount();

    const missingView = renderApp(createTestStore(), {
      initialEntries: ['/app/library/japanese-school-club'],
    });
    const missingSection = missingView.container.querySelector<HTMLDetailsElement>('details');
    const missingSummary = missingSection?.querySelector('summary');
    if (missingSection === null || missingSummary === null || missingSummary === undefined) {
      throw new Error('Expected the Japanese school club Warm-up disclosure.');
    }
    await user.click(missingSummary);
    expect(within(missingSection).getByText('Quantity not specified')).toBeVisible();
    missingView.unmount();

    const zeroStore = createTestStore();
    const zeroSetId = zeroStore.getState().addCustomTrainingSet({
      name: 'Zero quantity example',
      description: '',
      category: 'custom',
      sections: [
        {
          name: 'Example',
          exercises: [{ name: 'Still explicit', quantities: { repetitions: 0 } }],
        },
      ],
    });
    const zeroView = renderApp(zeroStore, {
      initialEntries: [`/app/library/${zeroSetId}`],
    });
    const zeroSection = zeroView.container.querySelector<HTMLDetailsElement>('details');
    const zeroSummary = zeroSection?.querySelector('summary');
    if (zeroSection === null || zeroSummary === null || zeroSummary === undefined) {
      throw new Error('Expected the custom zero-quantity disclosure.');
    }
    await user.click(zeroSummary);
    expect(within(zeroSection).getByText('0 repetitions')).toBeVisible();
    expect(within(zeroSection).queryByText('Quantity not specified')).not.toBeInTheDocument();
  });

  it('uses the minute convention for missing Warm-up quantities and preserves explicit zero', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    store.getState().addToDashboard(SENIOR_HIGH_SCHOOL_DRILL_ID);
    renderApp(store);

    const minutes = screen.getByLabelText(/minutes for stretch/i);
    expect(minutes).toHaveValue(null);

    await user.type(minutes, '0');
    await user.tab();
    expect(minutes).toHaveValue(0);
    expect(store.getState().dashboardEntries[0]?.quantityOverrides).toEqual({
      [SENIOR_HIGH_SCHOOL_STRETCH_ID]: { minutes: 0 },
    });

    await user.clear(minutes);
    await user.tab();
    expect(minutes).toHaveValue(null);
    expect(store.getState().dashboardEntries[0]?.quantityOverrides).toEqual({});
  });

  it('uses repetitions for untimed waza and enforces the existing 0–500 limit', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    store.getState().addToDashboard(OFFICIAL_ZNKR_ID);
    renderApp(store);

    const repetitions = screen.getByLabelText('Repetitions for Men');
    expect(repetitions).toHaveValue(null);

    await user.type(repetitions, '501');
    await user.tab();
    expect(screen.getByText('Enter a whole number from 0 to 500.')).toBeInTheDocument();
    expect(store.getState().dashboardEntries[0]?.quantityOverrides).toEqual({});

    await user.clear(repetitions);
    await user.type(repetitions, '500');
    await user.tab();
    expect(repetitions).toHaveValue(500);
    expect(store.getState().dashboardEntries[0]?.quantityOverrides).toEqual({
      [OFFICIAL_ZNKR_MEN_ID]: { repetitions: 500 },
    });
  });

  it('uses seconds when adding an override to Kakarigeiko without a default', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    store.getState().addToDashboard(TOP_UNIVERSITY_ID);
    renderApp(store);

    const seconds = screen.getByLabelText('Seconds for Kakarigeiko');
    expect(seconds).toHaveValue(null);
    await user.type(seconds, '30');
    await user.tab();

    expect(store.getState().dashboardEntries[0]?.quantityOverrides).toEqual({
      [TOP_UNIVERSITY_KAKARIGEIKO_ID]: { seconds: 30 },
    });
  });

  it('edits simultaneous repetitions and sets as independent dashboard overrides', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    store.getState().addToDashboard(JUNIOR_HIGH_DRILL_ID);
    renderApp(store);

    const repetitions = screen.getByLabelText('Repetitions for haya');
    const sets = screen.getByLabelText('Sets for haya');
    expect(repetitions).toHaveValue(100);
    expect(sets).toHaveValue(2);

    await user.clear(sets);
    await user.type(sets, '0');
    await user.tab();
    await user.clear(repetitions);
    await user.type(repetitions, '80');
    await user.tab();

    expect(store.getState().dashboardEntries[0]?.quantityOverrides).toEqual({
      [JUNIOR_HIGH_HAYA_ID]: { repetitions: 80, sets: 0 },
    });

    await user.clear(repetitions);
    await user.tab();
    expect(repetitions).toHaveValue(100);
    expect(store.getState().dashboardEntries[0]?.quantityOverrides).toEqual({
      [JUNIOR_HIGH_HAYA_ID]: { sets: 0 },
    });

    await user.clear(sets);
    await user.tab();
    expect(sets).toHaveValue(2);
    expect(store.getState().dashboardEntries[0]?.quantityOverrides).toEqual({});
  });

  it('edits standalone section quantities by stable IDs without duplicate labels', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    store.getState().addToDashboard(INTERNATIONAL_DOJO_ID);
    const view = renderApp(store);

    const warmUpHeading = screen.getByRole('heading', { name: 'Warm-up', level: 3 });
    const warmUpSection = warmUpHeading.closest('section');
    if (warmUpSection === null) {
      throw new Error('Expected the standalone Warm-up section.');
    }
    expect(warmUpSection.querySelector('.step-label')).toBeNull();
    expect(within(warmUpSection).getAllByText('Warm-up')).toHaveLength(1);

    const minutes = within(warmUpSection).getByLabelText('Minutes for Warm-up');
    const seconds = screen.getByLabelText('Seconds for Kakarigeiko');
    expect(minutes).toHaveValue(10);
    expect(seconds).toHaveValue(60);
    expect(screen.queryByLabelText('Rounds for Kakarigeiko')).not.toBeInTheDocument();

    await user.clear(minutes);
    await user.type(minutes, '12.5');
    await user.tab();
    await user.clear(seconds);
    await user.type(seconds, '45');
    await user.tab();

    expect(store.getState().dashboardEntries[0]?.quantityOverrides).toEqual({
      [INTERNATIONAL_WARM_UP_ID]: { minutes: 12.5 },
      [INTERNATIONAL_KAKARIGEIKO_ID]: { seconds: 45 },
    });
    view.unmount();
  });

  it('persists notes and restores a removed dashboard entry with Undo', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    store.getState().addToDashboard(SENIOR_HIGH_SCHOOL_DRILL_ID);
    renderApp(store);

    const notes = screen.getByLabelText('Practice notes');
    await user.type(notes, 'Keep the shoulders relaxed.');
    await user.tab();
    await waitFor(() => {
      expect(store.getState().dashboardEntries[0]?.notes).toBe('Keep the shoulders relaxed.');
    });

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(
      screen.queryByRole('heading', { name: 'Senior High School kendo club' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(
      screen.getByRole('heading', { name: 'Senior High School kendo club' }),
    ).toBeInTheDocument();
    expect(store.getState().dashboardEntries[0]?.notes).toBe('Keep the shoulders relaxed.');
  });

  it('creates a custom drill and links it to the dashboard in one save flow', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    renderApp(store, { initialEntries: ['/app/drills/new'] });

    await user.type(screen.getByLabelText('Drill name'), 'Monday footwork');
    await user.type(screen.getByLabelText('Description (optional)'), 'A short solo session.');
    await user.type(screen.getByLabelText('Exercise name', { exact: true }), 'Footwork');
    await user.type(
      screen.getByLabelText('Subexercise name', { exact: true }),
      'Big step forward and back',
    );
    await user.type(screen.getByLabelText('Repetitions', { exact: true }), '24');
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
    expect(customSet?.sections[0]?.exercises[0]?.quantities?.repetitions).toBe(24);
  });

  it('does not partially create a custom drill when a repetition is outside the allowed range', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    renderApp(store, { initialEntries: ['/app/drills/new'] });

    await user.type(screen.getByLabelText('Drill name'), 'Invalid repetitions');
    await user.type(screen.getByLabelText('Exercise name', { exact: true }), 'Footwork');
    await user.type(screen.getByLabelText('Subexercise name', { exact: true }), 'Too many steps');
    await user.type(screen.getByLabelText('Repetitions', { exact: true }), '501');
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
