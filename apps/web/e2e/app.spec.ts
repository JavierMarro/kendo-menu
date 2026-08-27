import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'kendo-menu';

function parseRgb(color: string): readonly [number, number, number] {
  const channels = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (channels === undefined || channels.length !== 3) {
    throw new Error(`Could not parse CSS colour ${color}.`);
  }

  const [red, green, blue] = channels;
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`CSS colour ${color} did not contain three channels.`);
  }

  return [red, green, blue];
}

function getRelativeLuminance(color: string): number {
  const channels = parseRgb(color).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const [red, green, blue] = channels;
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`CSS colour ${color} could not be converted to luminance.`);
  }

  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function getContrastRatio(first: string, second: string): number {
  const firstLuminance = getRelativeLuminance(first);
  const secondLuminance = getRelativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

async function startFresh(page: Page): Promise<void> {
  await page.goto('/app/dashboard');
  await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
}

async function openNavigationIfNeeded(page: Page): Promise<void> {
  const menuToggle = page.getByRole('button', { name: 'Open navigation' });
  if (await menuToggle.isVisible()) {
    await menuToggle.click();
  }
}

test.describe('routed training flows', () => {
  test.beforeEach(async ({ page }) => {
    await startFresh(page);
  });

  test('opens the landing page, starts with the drill library, and returns home from the logo', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByRole('heading', { name: 'Plan the keiko you need today.', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.landing-page')).toBeVisible();
    const viewport = page.viewportSize();
    if (viewport !== null && viewport.width <= 760) {
      await expect(page.locator('.brand-name')).toBeHidden();

      const menuToggle = page.getByRole('button', { name: 'Open navigation' });
      const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
      await expect(menuToggle).toBeVisible();
      await expect(primaryNavigation).toBeHidden();
      await expect(page.locator('.session-status-label')).toBeHidden();

      await menuToggle.click();
      await expect(page.getByRole('button', { name: 'Close navigation' })).toBeVisible();
      await expect(primaryNavigation).toBeVisible();

      const openMenuScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(openMenuScrollWidth).toBeLessThanOrEqual(viewport.width);

      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
      await expect(primaryNavigation).toBeHidden();

      await menuToggle.click();
      await primaryNavigation.getByRole('link', { name: 'Dashboard', exact: true }).click();
      await expect(page).toHaveURL(/\/app\/dashboard$/);
      await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
      await page.goto('/app');
    } else {
      await expect(page.locator('.brand-name')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden();
      await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
      await expect(page.locator('.session-status-label')).toBeVisible();
    }

    const backgroundImage = await page
      .locator('.landing-page')
      .evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(backgroundImage).toContain('kendo-menu-hero.jpeg');

    const browseLibrary = page.getByRole('link', { name: 'Browse Keiko library' });
    await expect(browseLibrary).toHaveText('BROWSE KEIKO LIBRARY HERE →');
    await expect(page.getByText('exercises across all training sessions')).toBeVisible();
    await browseLibrary.click();
    await expect(page).toHaveURL(/\/app\/library$/);
    await expect(page.getByRole('heading', { name: 'Keiko library' })).toBeVisible();
    await page.locator('.top-bar').getByRole('link', { name: 'KendoMenu home' }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('shows the session-only cookie notice, links to its policy, and returns after reload', async ({
    page,
  }) => {
    const notice = page.getByRole('complementary', { name: 'Cookie notice' });
    await expect(notice).toContainText(
      'KendoMenu currently uses no cookies or third-party tracking. We may add privacy-friendly analytics in the future.',
    );
    await expect(notice.getByRole('link', { name: 'More information' })).toHaveAttribute(
      'href',
      '/cookies',
    );

    await notice.getByRole('link', { name: 'More information' }).click();
    await expect(page).toHaveURL(/\/cookies$/);
    await expect(page.getByRole('heading', { name: 'Cookie Policy', exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Cookie notice' })).toBeVisible();

    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByRole('complementary', { name: 'Cookie notice' })).toHaveCount(0);

    await openNavigationIfNeeded(page);
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Dashboard', exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await expect(page.getByRole('complementary', { name: 'Cookie notice' })).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(window.localStorage))).toEqual([]);

    await page.reload();
    await expect(page.getByRole('complementary', { name: 'Cookie notice' })).toBeVisible();
  });

  test('supports direct URLs, navigation, browser history, and reload', async ({ page }) => {
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();

    await openNavigationIfNeeded(page);
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: /Keiko library/ })
      .click();
    await expect(page).toHaveURL(/\/app\/library$/);
    await expect(page.getByRole('heading', { name: 'Keiko library' })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/app\/library$/);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Keiko library' })).toBeVisible();

    await page.goto('/app/drills/new');
    await expect(page.getByRole('heading', { name: 'Create a training session' })).toBeVisible();
  });

  test('opens a compact drill card and operates collapsed sections by keyboard', async ({
    page,
  }) => {
    await page.goto('/app/library');
    const cards = page.locator('.library-card');
    await expect(cards).toHaveCount(11);
    await expect(page.locator('.category-pill', { hasText: 'High intensity session' })).toHaveCount(
      4,
    );
    await expect(page.locator('.category-pill', { hasText: 'Intense session' })).toHaveCount(7);
    await expect(
      page.locator('.category-pill[data-category-variant="high-intensity"]'),
    ).toHaveCount(4);
    await expect(page.locator('.category-pill[data-category-variant="intense"]')).toHaveCount(7);
    await expect(page.getByText('Category not specified')).toHaveCount(0);
    await expect(page.getByText('Description not provided.')).toHaveCount(0);
    await expect(page.locator('.library-card > p:empty')).toHaveCount(0);

    const cardLayout = await cards.evaluateAll((elements) =>
      elements.map((element) => {
        const cardBox = element.getBoundingClientRect();
        const actions = element.querySelector('.library-card-actions');
        const actionsBox = actions?.getBoundingClientRect();

        return {
          width: Math.round(cardBox.width * 100) / 100,
          height: Math.round(cardBox.height * 100) / 100,
          actionBottomInset:
            actionsBox === undefined
              ? null
              : Math.round((cardBox.bottom - actionsBox.bottom) * 100) / 100,
          actionTopPadding:
            actions === null ? null : Number.parseFloat(getComputedStyle(actions).paddingTop),
        };
      }),
    );
    expect(new Set(cardLayout.map(({ width }) => width)).size).toBe(1);
    expect(new Set(cardLayout.map(({ height }) => height)).size).toBe(1);
    expect(new Set(cardLayout.map(({ actionBottomInset }) => actionBottomInset)).size).toBe(1);
    expect(new Set(cardLayout.map(({ actionTopPadding }) => actionTopPadding))).toEqual(
      new Set([8]),
    );

    const viewport = page.viewportSize();
    if (viewport === null) {
      throw new Error('The drill-library viewport is unavailable.');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );

    const card = page
      .getByRole('heading', { name: 'International dojo menu' })
      .locator('xpath=ancestor::article');
    await expect(card).toContainText('Intense session');
    await expect(card).toContainText('Set for a 2 hours long session.');
    await expect(card).toContainText('20 activities');
    const viewDrill = card.getByRole('link', { name: 'View session' });
    await expect(viewDrill).toHaveAttribute(
      'href',
      '/app/library?drill=international-dojo-2-hour-session',
    );

    await viewDrill.focus();
    await expect(viewDrill).toBeFocused();
    await expect(viewDrill).toHaveCSS('outline-style', 'solid');
    await expect(viewDrill).toHaveCSS('outline-width', '3px');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app\/library\?drill=international-dojo-2-hour-session$/);

    const dialog = page.getByRole('dialog', { name: 'International dojo menu' });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Close International dojo menu details.' }),
    ).toBeFocused();
    const detailBadge = dialog.locator('.drill-detail-category');
    await expect(detailBadge).toHaveText('Intense session');
    await expect(detailBadge).toHaveAttribute('data-category-variant', 'intense');
    expect(
      await detailBadge.evaluate(
        (badge) => badge.nextElementSibling?.textContent === 'International dojo menu',
      ),
    ).toBe(true);

    const warmUpActivity = dialog
      .getByRole('heading', { name: 'Warm-up', level: 2 })
      .locator('xpath=ancestor::section');
    await expect(warmUpActivity).toHaveClass(/detail-standalone-activity/);
    await expect(warmUpActivity.locator('details')).toHaveCount(0);
    await expect(warmUpActivity).toContainText('10 minutes');
    await expect(warmUpActivity).not.toContainText('1 activity');
    const standaloneLayout = await warmUpActivity.evaluate((element) => {
      const name = element.querySelector('.detail-section-label');
      const quantity = element.querySelector('.quantity-list');
      if (name === null || quantity === null) {
        throw new Error('The standalone activity row is incomplete.');
      }

      const elementBox = element.getBoundingClientRect();
      const nameBox = name.getBoundingClientRect();
      const quantityBox = quantity.getBoundingClientRect();
      return {
        hasOverflow: element.scrollWidth > element.clientWidth,
        quantityRightInset: elementBox.right - quantityBox.right,
        rowsOverlap: nameBox.top < quantityBox.bottom && quantityBox.top < nameBox.bottom,
      };
    });
    expect(standaloneLayout.hasOverflow).toBe(false);
    expect(standaloneLayout.quantityRightInset).toBeGreaterThanOrEqual(12);
    expect(standaloneLayout.quantityRightInset).toBeLessThanOrEqual(20);
    expect(standaloneLayout.rowsOverlap).toBe(true);

    const sections = dialog.locator('details.detail-section');
    await expect(sections).toHaveCount(5);
    const uchikomiSection = sections.filter({ hasText: 'Uchikomi' });
    await expect(uchikomiSection).not.toHaveAttribute('open', '');
    const uchikomiSummary = uchikomiSection.locator('summary');
    await expect(uchikomiSummary).toContainText('1 exercise');
    await expect(uchikomiSummary).toHaveCSS('list-style-type', 'none');
    const disclosureIndicator = uchikomiSummary.locator('.detail-section-indicator');
    await expect(disclosureIndicator).toHaveAttribute('aria-hidden', 'true');
    expect(
      await disclosureIndicator.evaluate(
        (element) => getComputedStyle(element, '::before').content,
      ),
    ).toBe('"+"');

    await disclosureIndicator.click();
    await expect(uchikomiSection).toHaveAttribute('open', '');
    expect(
      await disclosureIndicator.evaluate(
        (element) => getComputedStyle(element, '::before').content,
      ),
    ).toBe('"−"');
    await expect(uchikomiSection.getByText('5 repetitions')).toBeVisible();
    await disclosureIndicator.click();
    await expect(uchikomiSection).not.toHaveAttribute('open', '');
    expect(
      await disclosureIndicator.evaluate(
        (element) => getComputedStyle(element, '::before').content,
      ),
    ).toBe('"+"');

    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(uchikomiSummary).toBeFocused();
    await expect(uchikomiSummary).toHaveCSS('outline-style', 'solid');
    await expect(uchikomiSummary).toHaveCSS('outline-width', '3px');
    await expect(uchikomiSummary).toHaveCSS('outline-offset', '-3px');
    await page.keyboard.press('Space');
    await expect(uchikomiSection).toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    await expect(uchikomiSection).not.toHaveAttribute('open', '');
  });

  test('uses distinct accessible intensity badge colours', async ({ page }) => {
    await page.goto('/app/library');
    const intenseBadge = page.locator('.category-pill[data-category-variant="intense"]').first();
    const highIntensityBadge = page
      .locator('.category-pill[data-category-variant="high-intensity"]')
      .first();

    for (const badge of [intenseBadge, highIntensityBadge]) {
      const colours = await badge.evaluate((element) => {
        const badgeStyles = getComputedStyle(element);
        const card = element.closest('.library-card');
        if (card === null) {
          throw new Error('The category badge is missing its library card.');
        }

        return {
          background: badgeStyles.backgroundColor,
          border: badgeStyles.borderTopColor,
          card: getComputedStyle(card).backgroundColor,
          foreground: badgeStyles.color,
        };
      });

      expect(getContrastRatio(colours.foreground, colours.background)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(colours.border, colours.card)).toBeGreaterThanOrEqual(3);
      expect(colours.foreground).not.toBe('rgb(155, 208, 170)');
      expect(colours.background).not.toContain('155, 208, 170');
    }

    await expect(intenseBadge).not.toHaveCSS(
      'background-color',
      await highIntensityBadge.evaluate((element) => getComputedStyle(element).backgroundColor),
    );

    const intenseCardColours = await intenseBadge.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      foreground: getComputedStyle(element).color,
    }));
    await page.goto('/app/library?drill=international-dojo-2-hour-session');
    const intenseDetailBadge = page.getByRole('dialog').locator('.drill-detail-category');
    await expect(intenseDetailBadge).toHaveAttribute('data-category-variant', 'intense');
    await expect(intenseDetailBadge).toHaveCSS('background-color', intenseCardColours.background);
    await expect(intenseDetailBadge).toHaveCSS('color', intenseCardColours.foreground);

    await page.goto('/app/library?drill=senior-high-school-kendo-club');
    const highDetailBadge = page.getByRole('dialog').locator('.drill-detail-category');
    await expect(highDetailBadge).toHaveText('High intensity session');
    await expect(highDetailBadge).toHaveAttribute('data-category-variant', 'high-intensity');
    const highDetailColours = await highDetailBadge.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      foreground: getComputedStyle(element).color,
    }));
    expect(
      getContrastRatio(highDetailColours.foreground, highDetailColours.background),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test('uses the drill query as history state and redirects legacy detail URLs with replace', async ({
    page,
  }) => {
    await page.goto('/app/library?source=curated');
    const card = page
      .getByRole('heading', { name: 'International dojo menu' })
      .locator('xpath=ancestor::article');
    const viewDrill = card.getByRole('link', { name: 'View session' });

    await viewDrill.click();
    await expect(page).toHaveURL(
      /\/app\/library\?source=curated&drill=international-dojo-2-hour-session$/,
    );
    await expect(page.getByRole('dialog', { name: 'International dojo menu' })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/app\/library\?source=curated$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(viewDrill).toBeFocused();

    await page.goForward();
    await expect(page.getByRole('dialog', { name: 'International dojo menu' })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(
      /\/app\/library\?source=curated&drill=international-dojo-2-hour-session$/,
    );
    await expect(page.getByRole('dialog', { name: 'International dojo menu' })).toBeVisible();

    await page.getByRole('button', { name: 'Close International dojo menu details.' }).click();
    await expect(page).toHaveURL(/\/app\/library\?source=curated$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/dashboard$/);

    await page.goto('/app/library/official-znkr-ajkf?source=legacy');
    await expect(page).toHaveURL(/\/app\/library\?source=legacy&drill=official-znkr-ajkf$/);
    const directDialog = page.getByRole('dialog', { name: 'Official ZNKR/AJKF menu' });
    await expect(directDialog).toBeVisible();
    await expect(
      directDialog.getByRole('button', { name: 'Close Official ZNKR/AJKF menu details.' }),
    ).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/dashboard$/);

    await page.goto('/app/library?source=curated&drill=not-a-real-drill');
    await expect(page).toHaveURL(/\/app\/library\?source=curated$/);
    await expect(page.getByRole('heading', { name: 'Keiko library' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('traps modal focus, blocks the background, and uses responsive internal scrolling', async ({
    page,
  }) => {
    await page.goto('/app/library');
    const card = page
      .getByRole('heading', { name: 'International dojo menu' })
      .locator('xpath=ancestor::article');
    const viewDrill = card.getByRole('link', { name: 'View session' });
    await viewDrill.click();

    let dialog = page.getByRole('dialog', { name: 'International dojo menu' });
    let closeButton = dialog.getByRole('button', {
      name: 'Close International dojo menu details.',
    });
    await expect(closeButton).toBeFocused();
    await expect(page.locator('.app-shell').locator('xpath=..')).toHaveAttribute('inert', '');
    await expect(page.locator('.app-shell').locator('xpath=..')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

    await page
      .locator('.top-bar a')
      .first()
      .evaluate((element) => element.focus());
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    await dialog.getByRole('button', { name: 'Add to dashboard' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.inline-confirmation')).toContainText(
      'International dojo menu added to your dashboard.',
    );
    await expect(dialog.getByRole('link', { name: 'View dashboard' })).toBeVisible();

    await closeButton.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.locator('summary').last()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(closeButton).toBeFocused();

    const viewport = page.viewportSize();
    const panelBox = await dialog.boundingBox();
    const closeBox = await closeButton.boundingBox();
    if (viewport === null || panelBox === null || closeBox === null) {
      throw new Error('The responsive drill-dialog geometry is unavailable.');
    }
    const scrollMetrics = await dialog.locator('.drill-dialog-scroll').evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );

    if (viewport.width <= 640) {
      expect(panelBox.x).toBe(0);
      expect(panelBox.y).toBe(0);
      expect(Math.abs(panelBox.width - viewport.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(panelBox.height - viewport.height)).toBeLessThanOrEqual(1);
      expect(closeBox.y).toBeGreaterThanOrEqual(0);
      expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(viewport.height);
    } else {
      expect(panelBox.width).toBeLessThan(viewport.width);
      expect(Math.abs(panelBox.x - (viewport.width - panelBox.width) / 2)).toBeLessThanOrEqual(1);
      await expect(page.locator('.drill-dialog-backdrop')).toHaveCSS(
        'backdrop-filter',
        'blur(3px)',
      );
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(viewDrill).toBeFocused();

    await viewDrill.click();
    dialog = page.getByRole('dialog', { name: 'International dojo menu' });
    closeButton = dialog.getByRole('button', {
      name: 'Close International dojo menu details.',
    });
    if (viewport.width > 640) {
      await page.locator('.drill-dialog-backdrop').click({ position: { x: 8, y: 8 } });
      await expect(dialog).toHaveCount(0);
      await expect(viewDrill).toBeFocused();
      await viewDrill.click();
      dialog = page.getByRole('dialog', { name: 'International dojo menu' });
      closeButton = dialog.getByRole('button', {
        name: 'Close International dojo menu details.',
      });
    }

    await closeButton.click();
    await expect(dialog).toHaveCount(0);
    await expect(viewDrill).toBeFocused();
  });

  test('removes non-essential drill-dialog motion when reduced motion is requested', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/app/library?drill=international-dojo-2-hour-session');

    await expect(page.getByRole('dialog', { name: 'International dojo menu' })).toBeVisible();
    await expect(page.locator('.drill-dialog-panel')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.drill-dialog-backdrop')).toHaveCSS('animation-name', 'none');
  });

  test('clamps the University High School card preview and shows its full detail description', async ({
    page,
  }) => {
    const description =
      "Weekly rotation: Monday self-directed practice; Tuesday 'Ken-tore' circuits; Wednesday is a running/stair sprints plus suburi and suri-ashi; Thursday is kihon and waza-geiko; Friday is kihon plus shiaigeiko; weekends are tournaments or shiaigeiko.";
    await page.goto('/app/library');

    const card = page
      .getByRole('heading', { name: 'University High School dojo menu' })
      .locator('xpath=ancestor::article');
    const preview = card.locator('.library-card-description');
    await expect(preview).toHaveText(description);
    expect(await preview.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );

    await card.getByRole('link', { name: 'View session' }).click();

    await expect(page.locator('.detail-header .page-intro')).toHaveText(description);
  });

  test('labels missing read-only quantities from the shared activity context', async ({ page }) => {
    await page.goto('/app/library?drill=japanese-school-club');
    const dialog = page.getByRole('dialog', { name: 'Japanese school dojo menu' });

    const getStandaloneActivity = (name: string) =>
      dialog
        .getByRole('heading', { name, level: 2, exact: true })
        .locator('xpath=ancestor::section');

    await expect(getStandaloneActivity('warm-up')).toContainText('Time not set');
    await expect(getStandaloneActivity('kakarigeiko')).toContainText('Time not set');
    await expect(getStandaloneActivity('Kirikaeshi')).toContainText('Reps not set');
    await expect(getStandaloneActivity('Kihon-waza')).toContainText('Reps not set');

    const suburiSection = dialog.locator('details.detail-section').filter({ hasText: 'suburi' });
    await suburiSection.locator('summary').click();
    await expect(suburiSection.getByText('Reps not set')).toHaveCount(4);
    await expect(dialog.getByText(/^Not set$/)).toHaveCount(0);

    await page.goto('/app/library?drill=university-version-2');
    const universityDialog = page.getByRole('dialog', { name: 'University dojo menu' });
    const standaloneSuburi = universityDialog
      .getByRole('heading', { name: 'Suburi', level: 2, exact: true })
      .locator('xpath=ancestor::section');
    await expect(standaloneSuburi).toContainText('Time not set');
    await expect(standaloneSuburi.locator('details')).toHaveCount(0);
  });

  test('persists multi-unit quantities, notes, and an Undo restoration across reload', async ({
    page,
  }) => {
    await page.goto('/app/library');
    const card = page
      .getByRole('heading', { name: 'Junior-high school dojo menu' })
      .locator('xpath=ancestor::article');
    await card.getByRole('link', { name: 'View session' }).click();
    await page.getByRole('button', { name: 'Add to dashboard' }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'View dashboard' }).click();

    const repetitions = page.getByLabel('Repetitions for haya');
    const sets = page.getByLabel('Sets for haya');
    await expect(repetitions).toHaveValue('100');
    await expect(sets).toHaveValue('2');
    await repetitions.fill('80');
    await repetitions.blur();
    await sets.fill('0');
    await sets.blur();
    await expect(repetitions).toHaveValue('80');
    await expect(sets).toHaveValue('0');

    const notes = page.getByLabel('Practice notes');
    await notes.fill('Keep the shoulders relaxed.');
    await notes.blur();

    await page.reload();
    await expect(page.getByLabel('Repetitions for haya')).toHaveValue('80');
    await expect(page.getByLabel('Sets for haya')).toHaveValue('0');
    await expect(page.getByLabel('Practice notes')).toHaveValue('Keep the shoulders relaxed.');

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toHaveCount(
      0,
    );
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();
  });

  test('persists standalone minute and second overrides without changing their units', async ({
    page,
  }) => {
    await page.goto('/app/library');
    const card = page
      .getByRole('heading', { name: 'International dojo menu' })
      .locator('xpath=ancestor::article');
    await card.getByRole('link', { name: 'View session' }).click();
    await page.getByRole('button', { name: 'Add to dashboard' }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'View dashboard' }).click();

    const minutes = page.getByLabel('Minutes for Warm-up');
    const seconds = page.getByLabel('Seconds for Kakarigeiko');
    await expect(minutes).toHaveValue('10');
    await expect(seconds).toHaveValue('60');
    await minutes.fill('12.5');
    await minutes.blur();
    await seconds.fill('45');
    await seconds.blur();

    await openNavigationIfNeeded(page);
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: /Keiko library/ })
      .click();
    await openNavigationIfNeeded(page);
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Dashboard', exact: true })
      .click();
    await expect(page.getByLabel('Minutes for Warm-up')).toHaveValue('12.5');
    await expect(page.getByLabel('Seconds for Kakarigeiko')).toHaveValue('45');

    await page.reload();
    await expect(page.getByLabel('Minutes for Warm-up')).toHaveValue('12.5');
    await expect(page.getByLabel('Seconds for Kakarigeiko')).toHaveValue('45');
  });

  test('prompts before browser Back discards a dirty draft, but dismiss keeps the draft', async ({
    page,
  }) => {
    const dashboardHeader = page
      .getByRole('heading', { name: 'Your dashboard', exact: true })
      .locator('xpath=ancestor::header');
    await dashboardHeader.getByRole('link', { name: 'Create session', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/drills\/new$/);
    const name = page.getByLabel('Session name');
    await name.fill('Unfinished draft');

    const dismissedMessages: string[] = [];
    const dismissedDialogPromise = page.waitForEvent('dialog');
    const dismissedNavigationPromise = page
      .goBack({ waitUntil: 'commit', timeout: 5_000 })
      .catch(() => undefined);
    const dismissedDialog = await dismissedDialogPromise;
    dismissedMessages.push(dismissedDialog.message());
    expect(dismissedMessages).toEqual([
      'You have an unsaved session draft. Leave this page and discard it?',
    ]);
    await dismissedDialog.dismiss();
    await dismissedNavigationPromise;
    await expect(page).toHaveURL(/\/app\/drills\/new$/);
    await expect(page.getByLabel('Session name')).toHaveValue('Unfinished draft');

    const acceptedMessages: string[] = [];
    const acceptedDialogPromise = page.waitForEvent('dialog');
    const acceptedNavigationPromise = page.goBack({ waitUntil: 'commit', timeout: 5_000 });
    const acceptedDialog = await acceptedDialogPromise;
    acceptedMessages.push(acceptedDialog.message());
    expect(acceptedMessages).toEqual([
      'You have an unsaved session draft. Leave this page and discard it?',
    ]);
    await acceptedDialog.accept();
    await acceptedNavigationPromise;
    await expect(page).toHaveURL(/\/app\/dashboard$/);
  });

  test('creates a custom drill atomically and keeps it on the dashboard after reload', async ({
    page,
  }) => {
    let unexpectedDialogMessage: string | null = null;
    page.on('dialog', async (dialog) => {
      unexpectedDialogMessage = dialog.message();
      await dialog.dismiss();
    });
    await page.goto('/app/drills/new');
    await page.getByLabel('Session name').fill('Monday footwork');
    await page.getByLabel('Description (optional)').fill('A short solo session.');
    await page.getByLabel('Exercise name', { exact: true }).fill('Footwork');
    await page.getByLabel('Subexercise name', { exact: true }).fill('Big step forward and back');
    await page.getByLabel('Repetitions', { exact: true }).fill('24');
    await page.getByRole('button', { name: 'Save session to dashboard' }).click();

    await expect(page).toHaveURL(/\/app\/dashboard\?created=Monday%20footwork$/);
    expect(unexpectedDialogMessage).toBeNull();
    await expect(page.getByRole('heading', { name: 'Monday footwork' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Monday footwork' })).toBeVisible();
    await expect(page.getByLabel('Repetitions for Big step forward and back')).toHaveValue('24');

    const persisted = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    expect(persisted).not.toBeNull();
  });
});
