import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAINING_SETS,
  asTrainingSetId,
  getTrainingSetLeafExerciseCount,
} from '@kendo-menu/domain';

import {
  CURATED_EXERCISE_COUNT,
  CURATED_TRAINING_SET_COUNT,
  formatTrainingQuantity,
} from '../lib/training-data';
import { renderApp, createTestStore } from './test-utils';

const SENIOR_HIGH_SCHOOL_DRILL_ID = asTrainingSetId('senior-high-school-kendo-club');
const SENIOR_HIGH_SCHOOL_STRETCH_ID = 'senior-high-school-kendo-club-warm-up-stretch';
const JUNIOR_HIGH_DRILL_ID = asTrainingSetId('junior-high-kendo-club');
const JUNIOR_HIGH_HAYA_ID = 'junior-high-kendo-club-suburi-haya';
const JAPANESE_SCHOOL_DRILL_ID = asTrainingSetId('japanese-school-club');
const JAPANESE_SCHOOL_JOGE_ID = 'japanese-school-club-suburi-joge';
const INTERNATIONAL_DOJO_ID = asTrainingSetId('international-dojo-2-hour-session');
const INTERNATIONAL_WARM_UP_ID = 'international-dojo-2-hour-session-warm-up-warm-up';
const INTERNATIONAL_SUBURI_ID = 'international-dojo-2-hour-session-suburi-suburi';
const INTERNATIONAL_KAKARIGEIKO_ID = 'international-dojo-2-hour-session-kakarigeiko-kakarigeiko';
const UNIVERSITY_DRILL_ID = asTrainingSetId('university-version-2');
const UNIVERSITY_SUBURI_ID = 'university-version-2-suburi-suburi';
const OFFICIAL_ZNKR_ID = asTrainingSetId('official-znkr-ajkf');
const OFFICIAL_ZNKR_MEN_ID = 'official-znkr-ajkf-kihon-waza-men';
const TOP_UNIVERSITY_ID = asTrainingSetId('top-university');
const TOP_UNIVERSITY_KAKARIGEIKO_ID = 'top-university-kakarigeiko-kakarigeiko';
const IN_SCOPE_SESSION_SMOKE_CASES = [
  {
    id: 'international-dojo-2-hour-session',
    name: 'International dojo menu',
    activityCount: 25,
  },
  { id: 'japanese-school-club', name: 'Japanese school dojo menu', activityCount: 27 },
  { id: 'junior-high-kendo-club', name: 'Junior-high school dojo menu', activityCount: 21 },
  { id: 'official-znkr-ajkf', name: 'Official ZNKR/AJKF menu', activityCount: 18 },
  { id: 'police-dojo-asageiko', name: 'Police dojo asageiko menu', activityCount: 10 },
  {
    id: 'police-dojo-asageiko-version-2',
    name: 'Police dojo asageiko type 2 menu',
    activityCount: 18,
  },
  {
    id: 'senior-high-school-kendo-club',
    name: 'Senior High School dojo menu',
    activityCount: 45,
  },
  {
    id: 'junior-high-school-version-2',
    name: 'Junior High School dojo type 2 menu',
    activityCount: 16,
  },
  { id: 'university-version-2', name: 'University dojo menu', activityCount: 29 },
] as const;

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
        name: /Keiko library/,
      }),
    );

    expect(screen.getByRole('heading', { name: 'Keiko library' })).toBeInTheDocument();
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

  it('renders a named footer with shared navigation and information links', () => {
    renderApp(createTestStore(), { initialEntries: ['/app'] });

    const footer = screen.getByRole('contentinfo', { name: 'Site footer' });
    expect(within(footer).getByText('KendoMenu')).toBeVisible();
    expect(within(footer).getByRole('link', { name: 'KendoMenu home' })).toHaveAttribute(
      'href',
      '/app',
    );
    expect(within(footer).getByRole('heading', { name: 'Navigation', level: 2 })).toBeVisible();

    const footerNavigation = within(footer).getByRole('navigation', { name: 'Navigation' });
    expect(within(footerNavigation).getByRole('link', { name: /Keiko library/ })).toBeVisible();
    expect(
      within(footerNavigation)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/app#how-it-works-title', '/app/library', '/app/dashboard', '/app#faq-title']);

    const informationNavigation = within(footer).getByRole('navigation', { name: 'Information' });
    expect(within(informationNavigation).getByRole('link', { name: 'Sources' })).toHaveAttribute(
      'href',
      '/app/sources',
    );
    expect(within(informationNavigation).getByRole('link', { name: 'Cookies' })).toHaveAttribute(
      'href',
      '/cookies',
    );
  });

  it('renders the landing page at /app and links into the Keiko library', async () => {
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
        'Choose from 11 curated menus, shape the workload for your training and keep polishing mind, spirit and character through varied kendo practice.',
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
        /These figures reflect the training sessions currently available in KendoMenu/,
      ),
    ).toBeInTheDocument();

    const introductionHeading = screen.getByRole('heading', {
      name: 'A keiko menu for the day in front of you.',
      level: 2,
    });
    const introductionLayout = introductionHeading.closest('.landing-introduction-grid');
    expect(introductionLayout?.firstElementChild).toContainElement(introductionHeading);
    expect(introductionLayout?.querySelector('.landing-section-copy')).toHaveAttribute(
      'data-landing-reveal',
      'left',
    );

    const steps = screen.getByRole('heading', { name: 'Choose a starting point' }).closest('ol');
    if (steps === null) {
      throw new Error('The three-step journey is missing its ordered-list container.');
    }
    expect(steps).toHaveClass('landing-steps');
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
    expect(steps).toHaveAttribute('data-landing-reveal', 'steps');

    const canonicalExerciseCount = DEFAULT_TRAINING_SETS.reduce(
      (trainingSetTotal, trainingSet) =>
        trainingSetTotal + getTrainingSetLeafExerciseCount(trainingSet),
      0,
    );
    expect(CURATED_TRAINING_SET_COUNT).toBe(DEFAULT_TRAINING_SETS.length);
    expect(CURATED_EXERCISE_COUNT).toBe(canonicalExerciseCount);
    const exerciseCount = screen.getByText(String(canonicalExerciseCount), {
      selector: '.landing-stat-value',
    });
    expect(exerciseCount.closest('dd')).toHaveAttribute(
      'aria-label',
      `${canonicalExerciseCount} leaf activities across all training sessions`,
    );
    expect(screen.queryByText('~150')).not.toBeInTheDocument();

    const faqButton = screen.getByRole('button', { name: 'What is KendoMenu?' });
    const faqButtons = screen.getAllByRole('button', { name: /\?$/ });
    expect(faqButtons).toHaveLength(6);
    for (const button of faqButtons) {
      expect(button).toHaveAttribute('aria-expanded', 'false');
    }
    expect(faqButton).toHaveAttribute('aria-controls', 'what-is-kendomenu-answer');
    expect(document.getElementById('what-is-kendomenu-answer')).toHaveAttribute('hidden');

    await user.click(faqButton);
    expect(faqButton).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('what-is-kendomenu-answer')).not.toHaveAttribute('hidden');

    const browseLink = screen.getByRole('link', { name: 'Browse Keiko library' });
    expect(browseLink).toHaveClass('landing-primary-action');
    expect(browseLink).toHaveTextContent('BROWSE KEIKO LIBRARY HERE →');
    expect(
      screen.getByText('exercises across all training sessions', { exact: true }),
    ).toBeVisible();
    expect(
      screen.getByText(
        /Choose a keiko menu, add it to your dashboard, then adjust its repetitions or duration/,
      ),
    ).toBeVisible();

    const recordLink = screen.getByRole('link', { name: 'Record your first keiko' });
    expect(recordLink).toHaveAttribute('href', '/app/library');
    expect(recordLink).toHaveClass('landing-primary-action');

    await user.click(browseLink);
    expect(screen.getByRole('heading', { name: 'Keiko library' })).toBeInTheDocument();

    await user.click(within(header).getByRole('link', { name: 'KendoMenu home' }));
    expect(
      screen.getByRole('heading', { name: 'Plan the keiko you need today.' }),
    ).toBeInTheDocument();
  });

  it('links the menu-sources FAQ to the complete Sources page', async () => {
    const user = userEvent.setup();
    renderApp(createTestStore(), { initialEntries: ['/app'] });

    const sourcesQuestion = screen.getByRole('button', {
      name: 'Where do the keiko menus come from?',
    });
    expect(sourcesQuestion).toHaveAttribute('aria-expanded', 'false');

    await user.click(sourcesQuestion);

    const sourceLink = screen.getByRole('link', { name: 'here' });
    expect(sourceLink).toHaveTextContent(/^here$/);
    expect(sourceLink).toHaveAttribute('href', '/app/sources');
    expect(sourceLink).toHaveClass('landing-faq-source-link');
    expect(sourceLink.parentElement?.tagName).toBe('STRONG');

    await user.click(sourceLink);
    expect(screen.getByRole('heading', { name: 'Sources', level: 1 })).toBeInTheDocument();
  });

  it('renders every verified source with safe external-link behaviour', () => {
    renderApp(createTestStore(), { initialEntries: ['/app/sources'] });

    const sourcesPage = screen.getByRole('article', { name: 'Sources' });
    expect(
      within(sourcesPage).getByRole('heading', { name: 'Kanoya University YouTube series' }),
    ).toBeInTheDocument();
    expect(
      within(sourcesPage).getByText('Useful reference — not currently used by KendoMenu.'),
    ).toBeVisible();

    const externalLinks = within(sourcesPage).getAllByRole('link');
    expect(externalLinks.map((link) => link.getAttribute('href'))).toEqual([
      'https://minaken3.com/kendo-practice/training-menu-introduction/',
      'https://www.kendoubu.com/category22/entry71.html',
      'https://kenshi247.net/blog/2023/01/22/asageiko/',
      'https://sportsjoutatsu.com/kendou-joutatsu-kyoukadvd/shiodachuugaku-renshuuhou.html',
      'https://www.letskendo.com/posts/1693/',
      'https://www.ritsumei.ac.jp/nkc/student/club/kendo/rensyunaiyou2016new.html/',
      'https://www.kaminarikan.org/en/articles/bokuto_ni_waza',
      'https://kenshi247.net/blog/2010/06/28/bokuto-ni-yoru-kendo-kihon-waza-keikoho/',
      'https://www.youtube.com/watch?v=wVFUgb4PBhE',
      'https://www.youtube.com/watch?v=C5_rVSlroyQ',
      'https://www.youtube.com/watch?v=PUKn48yiFGg',
      'https://www.youtube.com/watch?v=zAW4i2ThTLo',
      'https://www.youtube.com/watch?v=egkw-tg_Twk',
      'https://www.kendo.or.jp/wp/wp-content/uploads/2022/06/kendojugyonotenkai_digest_04_all.pdf',
    ]);
    for (const link of externalLinks) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link).toHaveAccessibleName(/opens in a new tab/);
    }
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
    expect(
      within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', {
        name: /Keiko library/,
      }),
    ).toBeVisible();
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
    expect(screen.getByRole('link', { name: /^Create session$/ })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Browse Keiko library' })).toBeVisible();
    expect(screen.getByText(/Add a session from the Keiko library/)).toBeVisible();
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

  it('keeps an unavailable persisted dashboard entry recoverable and removable', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    store.getState().addToDashboard(asTrainingSetId('unavailable-local-training-set'));

    renderApp(store, { initialEntries: ['/app/dashboard'] });

    const missingHeading = screen.getByRole('heading', { name: 'Training session unavailable' });
    const missingEntry = missingHeading.closest('article');
    if (missingEntry === null) {
      throw new Error('Expected the unavailable dashboard entry fallback.');
    }
    expect(within(missingEntry).getByText(/no longer available in local data/)).toBeVisible();

    await user.click(within(missingEntry).getByRole('button', { name: 'Remove' }));

    expect(
      screen.queryByRole('heading', { name: 'Training session unavailable' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeVisible();
  });

  it('navigates between the dashboard, library, and direct builder route', async () => {
    const user = userEvent.setup();
    const store = createTestStore();

    const view = renderApp(store);
    expect(screen.getByRole('heading', { name: 'Your dashboard' })).toBeInTheDocument();

    await user.click(
      within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', {
        name: /Keiko library/,
      }),
    );
    expect(screen.getByRole('heading', { name: 'Keiko library' })).toBeInTheDocument();
    expect(document.title).toBe('Keiko library · KendoMenu');

    view.unmount();
    const builderView = renderApp(createTestStore(), { initialEntries: ['/app/drills/new'] });
    expect(screen.getByRole('heading', { name: 'Create a training session' })).toBeInTheDocument();
    expect(document.title).toBe('Create session · KendoMenu');
    expect(screen.getByLabelText('Session name')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save session to dashboard' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to Keiko library' })).toBeVisible();
    expect(
      screen.getByText(
        'Build a repeatable keiko session containing the sections and exercises you want to practise.',
      ),
    ).toBeVisible();

    builderView.unmount();
    renderApp(createTestStore(), { initialEntries: ['/app/library'] });
    expect(screen.getByRole('heading', { name: 'Keiko library' })).toBeInTheDocument();
  });

  it('renders exactly 11 compact drill cards with semantic badge variants and query links', () => {
    renderApp(createTestStore(), { initialEntries: ['/app/library'] });

    const library = screen.getByRole('region', { name: 'Available training sessions' });
    const cards = within(library).getAllByRole('article');
    expect(cards).toHaveLength(11);
    expect(within(library).getAllByText('High intensity session')).toHaveLength(4);
    expect(within(library).getAllByText('Intense session')).toHaveLength(7);
    expect(within(library).queryByText('Category not specified')).not.toBeInTheDocument();
    for (const badge of within(library).getAllByText('Intense session')) {
      expect(badge).toHaveAttribute('data-category-variant', 'intense');
    }
    for (const badge of within(library).getAllByText('High intensity session')) {
      expect(badge).toHaveAttribute('data-category-variant', 'high-intensity');
    }

    const heading = within(library).getByRole('heading', {
      name: 'International dojo menu',
    });
    const card = heading.closest('article');
    if (card === null) {
      throw new Error('Expected the international-dojo heading inside a drill card.');
    }

    expect(within(card).getByText('Intense session')).toBeVisible();
    expect(within(card).getByText('Set for a 2 hours long session.')).toBeVisible();
    expect(within(card).getByText('25 activities')).toBeVisible();
    expect(within(card).getByRole('link', { name: 'View session' })).toHaveAttribute(
      'href',
      '/app/library?drill=international-dojo-2-hour-session',
    );
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it.each(IN_SCOPE_SESSION_SMOKE_CASES)(
    'renders the synchronized $name activity tree from a direct library URL',
    ({ id, name, activityCount }) => {
      renderApp(createTestStore(), { initialEntries: [`/app/library?drill=${id}`] });

      const dialog = screen.getByRole('dialog', { name });
      expect(
        within(dialog).getByText(`${String(activityCount)} activities in this session.`),
      ).toBeVisible();
      expect(dialog.querySelectorAll('[data-activity-id]')).toHaveLength(activityCount);
    },
  );

  it('renders the corrected standalone activities and police descriptions without seasonal data', () => {
    const policeView = renderApp(createTestStore(), {
      initialEntries: ['/app/library?drill=police-dojo-asageiko-version-2'],
    });
    const policeDialog = screen.getByRole('dialog', {
      name: 'Police dojo asageiko type 2 menu',
    });
    expect(
      within(policeDialog).getByText(
        'Normally run for small groups, and the menu tends to change depending on practitioners. 45 minutes long.',
        { exact: true },
      ),
    ).toBeVisible();
    const mawarigeiko = within(policeDialog).getByRole('heading', {
      name: 'Mawarigeiko',
      level: 2,
    });
    const mawarigeikoActivity = mawarigeiko.closest<HTMLElement>('[data-activity-id]');
    if (mawarigeikoActivity === null) {
      throw new Error('Expected the standalone Mawarigeiko activity.');
    }
    expect(mawarigeikoActivity).toHaveAttribute(
      'data-activity-id',
      'police-dojo-asageiko-version-2-mawari-geiko-mawari-geiko',
    );
    expect(within(mawarigeikoActivity).getByText('Time not set')).toBeVisible();
    expect(within(mawarigeikoActivity).queryByRole('list', { name: /Quantities/ })).toBeNull();
    policeView.unmount();

    const juniorView = renderApp(createTestStore(), {
      initialEntries: ['/app/library?drill=junior-high-school-version-2'],
    });
    const juniorDialog = screen.getByRole('dialog', {
      name: 'Junior High School dojo type 2 menu',
    });
    expect(
      juniorDialog.querySelector(
        '[data-activity-id="junior-high-school-version-2-kihon-waza-kihon-waza"]',
      ),
    ).toHaveTextContent('Kihon-waza');
    juniorView.unmount();

    const seniorView = renderApp(createTestStore(), {
      initialEntries: ['/app/library?drill=senior-high-school-kendo-club'],
    });
    const seniorDialog = screen.getByRole('dialog', { name: 'Senior High School dojo menu' });
    expect(within(seniorDialog).queryByText(/Core\/strength training/i)).toBeNull();
    seniorView.unmount();

    renderApp(createTestStore(), {
      initialEntries: ['/app/library?drill=university-version-2'],
    });
    const universityDialog = screen.getByRole('dialog', { name: 'University dojo menu' });
    expect(
      universityDialog.querySelector(
        '[data-activity-id="university-version-2-kakarigeijo-kakarigeijo"]',
      ),
    ).toHaveTextContent('Kakarigeiko');
  });

  it('omits missing and blank descriptions in the library, detail page, and dashboard', () => {
    const store = createTestStore();
    const trainingSetId = store.getState().addCustomTrainingSet({
      name: 'Blank description drill',
      description: '   ',
      category: 'custom',
      sections: [
        { name: 'Practice', exercises: [{ name: 'Men', quantities: { repetitions: 5 } }] },
      ],
    });
    store.getState().addToDashboard(trainingSetId);

    const libraryView = renderApp(store, { initialEntries: ['/app/library'] });
    const libraryHeading = screen.getByRole('heading', { name: 'Blank description drill' });
    const libraryCard = libraryHeading.closest('article');
    if (libraryCard === null) {
      throw new Error('Expected the blank-description drill inside a library card.');
    }
    expect(libraryCard.querySelector('.library-card-description')).toBeNull();
    expect(within(libraryCard).queryByText('Description not provided.')).not.toBeInTheDocument();
    libraryView.unmount();

    const detailView = renderApp(store, {
      initialEntries: [`/app/library?drill=${trainingSetId}`],
    });
    const detailDialog = screen.getByRole('dialog', { name: 'Blank description drill' });
    const detailHeading = within(detailDialog).getByRole('heading', {
      name: 'Blank description drill',
      level: 1,
    });
    const detailHeader = detailHeading.closest('header');
    if (detailHeader === null) {
      throw new Error('Expected the blank-description drill inside the detail header.');
    }
    expect(detailHeader.querySelector('.page-intro')).toBeNull();
    expect(within(detailHeader).queryByText('Description not provided.')).not.toBeInTheDocument();
    detailView.unmount();

    renderApp(store);
    const dashboardHeading = screen.getByRole('heading', { name: 'Blank description drill' });
    const dashboardCard = dashboardHeading.closest('article');
    if (dashboardCard === null) {
      throw new Error('Expected the blank-description drill inside a dashboard card.');
    }
    expect(dashboardCard.querySelector('.card-content > p:not(.card-kicker)')).toBeNull();
    expect(within(dashboardCard).queryByText('Description not provided.')).not.toBeInTheDocument();
  });

  it('shows the complete University High School description on its detail page', async () => {
    const user = userEvent.setup();
    const description =
      "Weekly rotation: Monday self-directed practice; Tuesday 'Ken-tore' circuits; Wednesday is a running/stair sprints plus suburi and suri-ashi; Thursday is kihon and waza-geiko; Friday is kihon plus shiaigeiko; weekends are tournaments or shiaigeiko.";
    renderApp(createTestStore(), { initialEntries: ['/app/library'] });

    const heading = screen.getByRole('heading', { name: 'University High School dojo menu' });
    const card = heading.closest('article');
    if (card === null) {
      throw new Error('Expected the University High School drill inside a library card.');
    }
    const preview = card.querySelector('.library-card-description');
    expect(preview).not.toBeNull();
    expect(preview?.textContent).toBe(description);

    await user.click(within(card).getByRole('link', { name: 'View session' }));

    const dialog = screen.getByRole('dialog', { name: 'University High School dojo menu' });
    expect(within(dialog).getByText(description, { exact: true })).toHaveClass('page-intro');
  });

  it('opens direct query URLs, redirects legacy detail paths, and ignores invalid drill IDs', async () => {
    const directView = renderApp(createTestStore(), {
      initialEntries: ['/app/library?source=shared&drill=official-znkr-ajkf'],
    });
    const directDialog = screen.getByRole('dialog', { name: 'Official ZNKR/AJKF menu' });
    expect(
      within(directDialog).getByRole('button', {
        name: 'Close Official ZNKR/AJKF menu details.',
      }),
    ).toHaveFocus();
    directView.unmount();

    const legacyView = renderApp(createTestStore(), {
      initialEntries: ['/app/library/official-znkr-ajkf?source=legacy'],
    });
    expect(await screen.findByRole('dialog', { name: 'Official ZNKR/AJKF menu' })).toBeVisible();
    legacyView.unmount();

    renderApp(createTestStore(), {
      initialEntries: ['/app/library?source=shared&drill=unavailable-drill'],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Keiko library' })).toBeVisible();
  });

  it('keeps the modal focused, inert, open after adding, and restores the originating link', async () => {
    const user = userEvent.setup();
    const view = renderApp(createTestStore(), { initialEntries: ['/app/library'] });
    const card = screen
      .getByRole('heading', { name: 'International dojo menu' })
      .closest('article');
    if (card === null) {
      throw new Error('Expected the International dojo menu card.');
    }
    const viewDrill = within(card).getByRole('link', { name: 'View session' });

    await user.click(viewDrill);
    let dialog = screen.getByRole('dialog', { name: 'International dojo menu' });
    const closeButton = within(dialog).getByRole('button', {
      name: 'Close International dojo menu details.',
    });
    expect(closeButton).toHaveFocus();
    expect(view.container).toHaveAttribute('inert');
    expect(view.container).toHaveAttribute('aria-hidden', 'true');

    await user.click(within(dialog).getByRole('button', { name: 'Add to dashboard' }));
    expect(screen.getByRole('dialog', { name: 'International dojo menu' })).toBeVisible();
    expect(dialog.querySelector('.inline-confirmation')).toHaveTextContent(
      'International dojo menu added to your dashboard.',
    );
    expect(within(dialog).getByRole('link', { name: 'View dashboard' })).toBeVisible();

    closeButton.focus();
    await user.tab({ shift: true });
    const summaries = dialog.querySelectorAll('summary');
    const lastSummary = summaries.item(summaries.length - 1);
    if (lastSummary === null) {
      throw new Error('Expected a final drill-section summary for focus trapping.');
    }
    expect(lastSummary).toHaveFocus();
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.click(closeButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(viewDrill).toHaveFocus();
    expect(view.container).not.toHaveAttribute('inert');
    expect(view.container).not.toHaveAttribute('aria-hidden');

    await user.click(viewDrill);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(viewDrill).toHaveFocus();

    await user.click(viewDrill);
    dialog = screen.getByRole('dialog', { name: 'International dojo menu' });
    const backdrop = document.querySelector<HTMLButtonElement>('.drill-dialog-backdrop');
    if (backdrop === null) {
      throw new Error('Expected the drill-dialog backdrop.');
    }
    await user.click(within(dialog).getByRole('heading', { name: 'International dojo menu' }));
    expect(screen.getByRole('dialog', { name: 'International dojo menu' })).toBeVisible();
    await user.click(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(viewDrill).toHaveFocus();
  });

  it('opens full session details with standalone activities and native child disclosures', async () => {
    const user = userEvent.setup();
    renderApp(createTestStore(), { initialEntries: ['/app/library'] });
    const cardHeading = screen.getByRole('heading', {
      name: 'International dojo menu',
    });
    const card = cardHeading.closest('article');
    if (card === null) {
      throw new Error('Expected the international-dojo heading inside a drill card.');
    }

    await user.click(within(card).getByRole('link', { name: 'View session' }));
    const dialog = screen.getByRole('dialog', { name: 'International dojo menu' });
    expect(
      within(dialog).getByRole('heading', { name: 'International dojo menu', level: 1 }),
    ).toBeVisible();
    const detailBadge = within(dialog).getByText('Intense session');
    const detailTitle = within(dialog).getByRole('heading', {
      name: 'International dojo menu',
      level: 1,
    });
    expect(detailBadge).toHaveClass('category-pill', 'drill-detail-category');
    expect(detailBadge).toHaveAttribute('data-category-variant', 'intense');
    expect(detailBadge.nextElementSibling).toBe(detailTitle);
    const sections = dialog.querySelectorAll<HTMLDetailsElement>('details.detail-section');
    const standaloneActivities = dialog.querySelectorAll<HTMLElement>(
      '.detail-standalone-activity',
    );
    expect(sections).toHaveLength(5);
    expect(standaloneActivities).toHaveLength(7);
    expect([...sections].every((section) => !section.open)).toBe(true);

    const warmUpHeading = within(dialog).getByRole('heading', { name: 'Warm-up', level: 2 });
    const warmUpActivity = warmUpHeading.closest<HTMLElement>('.detail-standalone-activity');
    if (warmUpActivity === null) {
      throw new Error('Expected Warm-up to render as a standalone activity.');
    }
    expect(warmUpActivity.closest('details')).toBeNull();
    expect(within(warmUpActivity).getByText('10 minutes')).toBeVisible();
    expect(within(warmUpActivity).queryByText('1 activity')).not.toBeInTheDocument();
    expect(warmUpActivity.children.item(0)).toHaveClass('section-number');
    expect(warmUpActivity.children.item(1)).toHaveClass('detail-standalone-copy');
    expect(warmUpActivity.children.item(2)).toHaveClass('quantity-list');

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
    expect(uchikomiSummary.querySelector('button')).toBeNull();
    const disclosureIndicator = uchikomiSummary.querySelector('.detail-section-indicator');
    if (disclosureIndicator === null) {
      throw new Error('Expected a decorative disclosure-state indicator.');
    }
    expect(disclosureIndicator).toHaveAttribute('aria-hidden', 'true');
    await user.click(disclosureIndicator);
    expect(uchikomiSection).toHaveAttribute('open');
    expect(within(uchikomiSection).getAllByText('Men → Kote → Kote-men → Men')).toHaveLength(1);
    expect(within(uchikomiSection).getByText('5 repetitions')).toBeVisible();
    await user.click(disclosureIndicator);
    expect(uchikomiSection).not.toHaveAttribute('open');
  });

  it('renders simultaneous units, missing quantities, and explicit zero distinctly', async () => {
    const user = userEvent.setup();
    const juniorView = renderApp(createTestStore(), {
      initialEntries: ['/app/library?drill=junior-high-kendo-club'],
    });
    const juniorDialog = screen.getByRole('dialog', { name: 'Junior-high school dojo menu' });
    const suburiSection = juniorDialog.querySelector<HTMLDetailsElement>('details');
    const suburiSummary = suburiSection?.querySelector('summary');
    if (suburiSection === null || suburiSummary === null || suburiSummary === undefined) {
      throw new Error('Expected the junior-high Suburi disclosure.');
    }
    await user.click(suburiSummary);
    const hayaQuantities = within(suburiSection).getByRole('list', { name: 'Quantities for Haya' });
    expect(within(hayaQuantities).getByText('100 repetitions')).toBeVisible();
    expect(within(hayaQuantities).getByText('2 sets')).toBeVisible();
    juniorView.unmount();

    const missingView = renderApp(createTestStore(), {
      initialEntries: ['/app/library?drill=japanese-school-club'],
    });
    const missingDialog = screen.getByRole('dialog', { name: 'Japanese school dojo menu' });
    const standaloneWarmUp = within(missingDialog).getByRole('heading', {
      name: 'Warm-up',
      level: 2,
    });
    const standaloneWarmUpActivity = standaloneWarmUp.closest<HTMLElement>(
      '.detail-standalone-activity',
    );
    if (standaloneWarmUpActivity === null) {
      throw new Error('Expected the Japanese school Warm-up standalone activity.');
    }
    expect(within(standaloneWarmUpActivity).getByText('Time not set')).toBeVisible();
    expect(standaloneWarmUpActivity.closest('details')).toBeNull();

    for (const [activityName, missingLabel] of [
      ['Kakarigeiko', 'Time not set'],
      ['Kirikaeshi', 'Reps not set'],
      ['Kihon-waza', 'Reps not set'],
    ] as const) {
      const activityHeadings = within(missingDialog).getAllByRole('heading', {
        name: activityName,
        level: 2,
      });
      for (const activityHeading of activityHeadings) {
        const standaloneActivity = activityHeading.closest<HTMLElement>(
          '.detail-standalone-activity',
        );
        if (standaloneActivity === null) {
          throw new Error(`Expected ${activityName} to render as a standalone activity.`);
        }
        expect(within(standaloneActivity).getByText(missingLabel)).toBeVisible();
      }
    }

    const missingSection = missingDialog.querySelector<HTMLDetailsElement>('details');
    const missingSummary = missingSection?.querySelector('summary');
    if (missingSection === null || missingSummary === null || missingSummary === undefined) {
      throw new Error('Expected the Japanese school dojo Warm-up disclosure.');
    }
    await user.click(missingSummary);
    expect(within(missingSection).getAllByText('Reps not set')).not.toHaveLength(0);
    expect(within(missingSection).queryByText('Quantity not specified')).not.toBeInTheDocument();
    missingView.unmount();

    const standaloneSuburiView = renderApp(createTestStore(), {
      initialEntries: ['/app/library?drill=university-version-2'],
    });
    const universityDialog = screen.getByRole('dialog', { name: 'University dojo menu' });
    const standaloneSuburiHeading = within(universityDialog).getByRole('heading', {
      name: 'Suburi',
      level: 2,
    });
    const standaloneSuburiActivity = standaloneSuburiHeading.closest<HTMLElement>(
      '.detail-standalone-activity',
    );
    if (standaloneSuburiActivity === null) {
      throw new Error('Expected University Suburi to render as a standalone activity.');
    }
    expect(within(standaloneSuburiActivity).getByText('Time not set')).toBeVisible();
    standaloneSuburiView.unmount();

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
    renderApp(zeroStore, {
      initialEntries: [`/app/library?drill=${zeroSetId}`],
    });
    const zeroDialog = screen.getByRole('dialog', { name: 'Zero quantity example' });
    const zeroSection = zeroDialog.querySelector<HTMLDetailsElement>('details');
    const zeroSummary = zeroSection?.querySelector('summary');
    if (zeroSection === null || zeroSummary === null || zeroSummary === undefined) {
      throw new Error('Expected the custom zero-quantity disclosure.');
    }
    await user.click(zeroSummary);
    expect(within(zeroSection).getByText('0 repetitions')).toBeVisible();
    expect(within(zeroSection).queryByText('Quantity not specified')).not.toBeInTheDocument();
  });

  it('shows standalone and section-owned notes with every read-only quantity unit', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    const trainingSetId = store.getState().addCustomTrainingSet({
      name: 'Read-only activity examples',
      description: 'A detail rendering fixture.',
      category: 'custom',
      sections: [
        {
          name: 'Solo circuit',
          notes: 'Keep a steady rhythm.',
          quantities: {
            repetitions: 8,
            sets: 2,
            duration: { unit: 'minutes', value: 3 },
          },
          exercises: [],
        },
        {
          name: 'Layered practice',
          notes: 'Parent section guidance.',
          quantities: { rounds: 2 },
          exercises: [{ name: 'Unmetered child', notes: 'Child exercise guidance.' }],
        },
      ],
    });

    renderApp(store, { initialEntries: [`/app/library?drill=${trainingSetId}`] });
    const dialog = screen.getByRole('dialog', { name: 'Read-only activity examples' });
    const standaloneHeading = within(dialog).getByRole('heading', {
      name: 'Solo circuit',
      level: 2,
    });
    const standaloneActivity = standaloneHeading.closest<HTMLElement>(
      '.detail-standalone-activity',
    );
    if (standaloneActivity === null) {
      throw new Error('Expected the Solo circuit standalone activity.');
    }
    expect(standaloneActivity.closest('details')).toBeNull();
    expect(within(standaloneActivity).getByText('Keep a steady rhythm.')).toBeVisible();
    expect(within(standaloneActivity).getByText('8 repetitions')).toBeVisible();
    expect(within(standaloneActivity).getByText('2 sets')).toBeVisible();
    expect(within(standaloneActivity).getByText('3 minutes')).toBeVisible();

    const layeredSection = dialog.querySelector<HTMLDetailsElement>('details.detail-section');
    const layeredSummary = layeredSection?.querySelector('summary');
    if (layeredSection === null || layeredSummary === null || layeredSummary === undefined) {
      throw new Error('Expected the Layered practice disclosure.');
    }
    expect(layeredSummary).toHaveTextContent('1 exercise');
    await user.click(layeredSummary);
    expect(within(layeredSection).getByText('Parent section guidance.')).toBeVisible();
    expect(within(layeredSection).getByText('2 rounds')).toBeVisible();
    expect(within(layeredSection).getByText('Child exercise guidance.')).toBeVisible();
    expect(within(layeredSection).getByText('Reps not set')).toBeVisible();
  });

  it('uses the minute convention for missing Warm-up quantities and preserves explicit zero', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    store.getState().addToDashboard(SENIOR_HIGH_SCHOOL_DRILL_ID);
    renderApp(store);

    const dashboardHeading = screen.getByRole('heading', {
      name: 'Senior High School dojo menu',
    });
    const dashboardCard = dashboardHeading.closest('article');
    if (dashboardCard === null) {
      throw new Error('Expected the Senior High School drill inside a dashboard card.');
    }
    expect(within(dashboardCard).getByText('High intensity session')).toBeVisible();

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

  it('uses structural Suburi fallbacks while preserving existing override units', async () => {
    const user = userEvent.setup();
    const japaneseStore = createTestStore();
    const japaneseEntryId = japaneseStore.getState().addToDashboard(JAPANESE_SCHOOL_DRILL_ID);
    japaneseStore
      .getState()
      .setQuantityOverride(japaneseEntryId, JAPANESE_SCHOOL_JOGE_ID, 'minutes', 2);
    const japaneseView = renderApp(japaneseStore);

    const repetitions = screen.getByLabelText('Repetitions for Joge');
    const existingMinutes = screen.getByLabelText('Minutes for Joge');
    expect(repetitions).toHaveValue(null);
    expect(existingMinutes).toHaveValue(2);
    expect(screen.queryByLabelText('Seconds for Joge')).not.toBeInTheDocument();

    await user.type(repetitions, '24');
    await user.tab();
    expect(japaneseStore.getState().dashboardEntries[0]?.quantityOverrides).toEqual({
      [JAPANESE_SCHOOL_JOGE_ID]: { repetitions: 24, minutes: 2 },
    });
    japaneseView.unmount();

    const universityStore = createTestStore();
    universityStore.getState().addToDashboard(UNIVERSITY_DRILL_ID);
    renderApp(universityStore);
    const suburiHeading = screen.getByRole('heading', { name: 'Suburi', level: 3 });
    const suburiSection = suburiHeading.closest('section');
    if (suburiSection === null) {
      throw new Error('Expected the standalone University Suburi section.');
    }
    expect(within(suburiSection).getByLabelText('Minutes for Suburi')).toHaveValue(null);
    expect(
      within(suburiSection).queryByLabelText('Repetitions for Suburi'),
    ).not.toBeInTheDocument();
    expect(universityStore.getState().dashboardEntries[0]?.quantityOverrides).toEqual({});
    expect(
      universityStore.getState().dashboardEntries[0]?.quantityOverrides[UNIVERSITY_SUBURI_ID],
    ).toBeUndefined();
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

    const repetitions = screen.getByLabelText('Repetitions for Haya');
    const sets = screen.getByLabelText('Sets for Haya');
    expect(repetitions).toHaveValue(100);
    expect(sets).toHaveValue(2);
    expect(screen.queryByLabelText('Minutes for Haya')).not.toBeInTheDocument();

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
    const suburiHeading = screen.getByRole('heading', { name: 'Suburi', level: 3 });
    const suburiSection = suburiHeading.closest('section');
    if (suburiSection === null) {
      throw new Error('Expected the standalone International Suburi section.');
    }
    const suburiMinutes = within(suburiSection).getByLabelText('Minutes for Suburi');
    const seconds = screen.getByLabelText('Seconds for Kakarigeiko');
    expect(minutes).toHaveValue(10);
    expect(suburiMinutes).toHaveValue(15);
    expect(
      within(suburiSection).queryByLabelText('Repetitions for Suburi'),
    ).not.toBeInTheDocument();
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
    expect(store.getState().dashboardEntries[0]?.quantityOverrides[INTERNATIONAL_SUBURI_ID]).toBe(
      undefined,
    );
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
      screen.queryByRole('heading', { name: 'Senior High School dojo menu' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(
      screen.getByRole('heading', { name: 'Senior High School dojo menu' }),
    ).toBeInTheDocument();
    expect(store.getState().dashboardEntries[0]?.notes).toBe('Keep the shoulders relaxed.');
  });

  it('creates a custom drill and links it to the dashboard in one save flow', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    renderApp(store, { initialEntries: ['/app/drills/new'] });

    await user.type(screen.getByLabelText('Session name'), 'Monday footwork');
    await user.type(screen.getByLabelText('Description (optional)'), 'A short solo session.');
    await user.type(screen.getByLabelText('Exercise name', { exact: true }), 'Footwork');
    await user.type(
      screen.getByLabelText('Subexercise name', { exact: true }),
      'Big step forward and back',
    );
    await user.type(screen.getByLabelText('Repetitions', { exact: true }), '24');
    await user.click(screen.getByRole('button', { name: 'Save session to dashboard' }));

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
    expect(customSet?.activities[0]?.children[0]?.quantities?.repetitions).toBe(24);
  });

  it('does not partially create a custom drill when a repetition is outside the allowed range', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    renderApp(store, { initialEntries: ['/app/drills/new'] });

    await user.type(screen.getByLabelText('Session name'), 'Invalid repetitions');
    await user.type(screen.getByLabelText('Exercise name', { exact: true }), 'Footwork');
    await user.type(screen.getByLabelText('Subexercise name', { exact: true }), 'Too many steps');
    await user.type(screen.getByLabelText('Repetitions', { exact: true }), '501');
    await user.click(screen.getByRole('button', { name: 'Save session to dashboard' }));

    expect(
      screen.getByRole('alert', { name: 'Check the highlighted fields.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create a training session' })).toBeInTheDocument();
    expect(store.getState().customTrainingSets).toEqual([]);
    expect(store.getState().dashboardEntries).toEqual([]);
  });

  it('focuses the validation summary once per invalid submit while keeping field editing stable', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    renderApp(store, { initialEntries: ['/app/drills/new'] });

    await user.click(screen.getByRole('button', { name: 'Save session to dashboard' }));
    const summary = screen.getByRole('alert', { name: 'Check the highlighted fields.' });
    await waitFor(() => expect(summary).toHaveFocus());

    const name = screen.getByLabelText('Session name');
    await user.click(name);
    await user.type(name, 'Correctable');
    expect(name).toHaveValue('Correctable');
    expect(name).toHaveFocus();
    expect(summary).not.toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Save session to dashboard' }));
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
