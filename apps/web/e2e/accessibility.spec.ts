import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const STORAGE_KEY = 'kendo-menu';

async function getElementBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`Could not measure ${await locator.evaluate((element) => element.outerHTML)}.`);
  }

  return box;
}

async function expectNoBlockingAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([]);
}

async function getLandingRevealOpacities(page: Page): Promise<readonly string[]> {
  return page
    .locator(
      '[data-landing-reveal], [data-landing-reveal] > .landing-reveal-left, [data-landing-reveal] > .landing-reveal-right, .landing-step, .landing-stat',
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.textContent?.trim() !== '')
        .map((element) => getComputedStyle(element).opacity),
    );
}

async function getLandingRevealTransforms(page: Page): Promise<readonly string[]> {
  return page
    .locator(
      '[data-landing-reveal], [data-landing-reveal] > .landing-reveal-left, [data-landing-reveal] > .landing-reveal-right, .landing-step, .landing-stat',
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.textContent?.trim() !== '')
        .map((element) => getComputedStyle(element).transform),
    );
}

async function getLandingRevealTransitionProperties(page: Page): Promise<readonly string[]> {
  return page
    .locator(
      '.landing-motion-ready [data-landing-reveal]:not([data-landing-reveal="split"]), .landing-motion-ready [data-landing-reveal="split"] > .landing-reveal-left, .landing-motion-ready [data-landing-reveal="split"] > .landing-reveal-right, .landing-motion-ready .landing-step, .landing-motion-ready .landing-stat',
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.textContent?.trim() !== '')
        .map((element) => getComputedStyle(element).transitionProperty),
    );
}

test.describe('accessibility and responsive layout', () => {
  test('has no blocking axe violations with the library dialog closed or open', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/app/library');

    await expectNoBlockingAxeViolations(page);

    const card = page
      .getByRole('heading', { name: 'International dojo menu' })
      .locator('xpath=ancestor::article');
    await card.getByRole('link', { name: 'View session' }).click();
    const dialog = page.getByRole('dialog', { name: 'International dojo menu' });
    await expect(dialog).toBeVisible();
    await dialog.locator('details.detail-section').first().locator('summary').click();

    await expectNoBlockingAxeViolations(page);
  });

  test('has no critical or serious axe violations on the landing route', async ({ page }) => {
    await page.goto('/app');
    const viewport = page.viewportSize();
    if (viewport !== null && viewport.width <= 760) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    }
    await expect(
      page.getByRole('heading', { name: 'Plan the keiko you need today.' }),
    ).toBeVisible();
    await expectNoBlockingAxeViolations(page);
  });

  test('has no critical or serious axe violations on the dashboard route', async ({ page }) => {
    await page.goto('/app/dashboard');
    await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
    await expectNoBlockingAxeViolations(page);
  });

  test('has no critical or serious axe violations on the library route', async ({ page }) => {
    await page.goto('/app/library');
    await expect(page.getByRole('heading', { name: 'Keiko library', exact: true })).toBeVisible();
    await expectNoBlockingAxeViolations(page);
  });

  test('has no critical or serious axe violations on the library detail route', async ({
    page,
  }) => {
    await page.goto('/app/library?drill=international-dojo-2-hour-session');
    const dialog = page.getByRole('dialog', { name: 'International dojo menu' });
    await expect(dialog).toBeVisible();
    const firstSection = page.locator('details.detail-section').first();
    await expect(firstSection).not.toHaveAttribute('open', '');
    await firstSection.locator('summary').click();
    await expectNoBlockingAxeViolations(page);
  });

  test('has no critical or serious axe violations on the drill builder route', async ({ page }) => {
    await page.goto('/app/drills/new');
    await expect(
      page.getByRole('heading', { name: 'Create a training session', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Session details' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Activities' })).toBeVisible();

    const backLink = page.getByRole('link', { name: 'Back to keiko library' });
    await expect(backLink).toHaveText('← Back to keiko library');
    await expect(backLink).toHaveAttribute('href', '/app/library');
    await expect(backLink).toHaveCSS('text-decoration-line', 'underline');
    await backLink.focus();
    await expect(backLink).toBeFocused();
    await expect(backLink).toHaveCSS('outline-style', 'solid');
    await expectNoBlockingAxeViolations(page);

    await page.getByLabel('Session name').fill('Accessible mixed session');
    const firstActivity = page.getByRole('group', { name: 'Activity 1' });
    await firstActivity.getByLabel('Activity name').fill('Main practice');
    const firstExercises = firstActivity.getByRole('group', { name: 'Exercises' });
    await firstExercises.getByLabel('Exercise name').fill('Suburi');
    await firstExercises.getByLabel('Repetitions', { exact: true }).fill('30');
    await firstExercises.getByRole('button', { name: 'Add exercise' }).click();
    await firstExercises.getByLabel('Exercise name').nth(1).fill('Jigeiko');
    await firstExercises.getByLabel('Measurement').nth(1).selectOption('duration');
    await firstExercises.getByLabel('Duration unit').selectOption('seconds');
    await firstExercises.getByLabel('Duration', { exact: true }).fill('45');

    await page.getByRole('button', { name: 'Add activity' }).click();
    const secondActivity = page.getByRole('group', { name: 'Activity 2' });
    await secondActivity.getByLabel('Activity name').fill('Finish');
    await secondActivity.getByLabel('Exercise name').fill('Kirikaeshi');
    await secondActivity.getByLabel('Repetitions', { exact: true }).fill('8');
    await expectNoBlockingAxeViolations(page);

    await secondActivity.getByLabel('Repetitions', { exact: true }).fill('501');
    await page.getByRole('button', { name: 'Save session to dashboard' }).click();
    const errorSummary = page.getByRole('alert', { name: 'Check the highlighted fields.' });
    await expect(errorSummary).toBeFocused();
    await expect(secondActivity.getByLabel('Repetitions', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expectNoBlockingAxeViolations(page);
  });

  test('keeps the builder keyboard order and layout usable at 200% text size', async ({ page }) => {
    await page.goto('/app/drills/new');
    const backLink = page.getByRole('link', { name: 'Back to keiko library' });
    await backLink.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Session name')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Description (optional)')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Add activity' })).toBeFocused();

    await page.getByLabel('Session name').fill('Long zoomed session name for keyboard practice');
    const activity = page.getByRole('group', { name: 'Activity 1' });
    await activity
      .getByLabel('Activity name')
      .fill('Warm-up and jigeiko preparation with a deliberately long name');
    await activity
      .getByLabel('Exercise name')
      .fill('Continuous jigeiko with rotating partners and deliberate recovery');
    await activity.getByLabel('Measurement').selectOption('duration');
    await activity.getByLabel('Duration', { exact: true }).fill('12.5');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });

    const viewport = page.viewportSize();
    if (viewport === null) {
      throw new Error('Expected a viewport for text-size verification.');
    }
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'builder overflow at 200% text size').toBeLessThanOrEqual(viewport.width);
    const activityBox = await getElementBox(activity);
    expect(activityBox.x).toBeGreaterThanOrEqual(0);
    expect(activityBox.x + activityBox.width).toBeLessThanOrEqual(viewport.width);
    await expectNoBlockingAxeViolations(page);
  });

  test('has no critical or serious axe violations on the sources route', async ({ page }) => {
    await page.goto('/app/sources');
    await expect(page.getByRole('heading', { name: 'Sources', level: 1 })).toBeVisible();
    await expectNoBlockingAxeViolations(page);
  });

  test('has no critical or serious axe violations on the cookie policy route', async ({ page }) => {
    await page.goto('/cookies');
    await expect(page.getByRole('complementary', { name: 'Cookie notice' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cookie Policy', exact: true })).toBeVisible();
    await expectNoBlockingAxeViolations(page);
  });

  test('does not overflow horizontally at 320px or desktop width', async ({ page }) => {
    for (const width of [320, 800, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/app');
      if (width <= 960) {
        await page.getByRole('button', { name: 'Open navigation' }).click();
        await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
      } else {
        await expect(page.locator('.brand-name')).toBeVisible();
      }
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(width);

      await page.goto('/app/sources');
      const sourcesScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(sourcesScrollWidth, `sources overflow at ${width}px`).toBeLessThanOrEqual(width);
    }
  });

  test('keeps the empty dashboard and session builder within target viewport widths', async ({
    page,
  }) => {
    test.setTimeout(75_000);

    for (const width of [320, 375, 393, 1440]) {
      const height = width <= 393 ? 812 : 900;
      await page.setViewportSize({ width, height });

      await page.goto('/app/dashboard');
      await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
      await page.reload();
      const dashboardScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(dashboardScrollWidth, `/app/dashboard overflow at ${width}px`).toBeLessThanOrEqual(
        width,
      );

      await page.goto('/app/drills/new');
      await page
        .getByLabel('Session name')
        .fill('A deliberately long session name for responsive builder verification');
      const firstActivity = page.getByRole('group', { name: 'Activity 1' });
      await firstActivity
        .getByLabel('Activity name')
        .fill('Warm-up, suburi, footwork, and partner preparation');
      const firstExercises = firstActivity.getByRole('group', { name: 'Exercises' });
      await firstExercises
        .getByLabel('Exercise name')
        .fill('A very long exercise name that must remain within the activity card');
      await firstExercises.getByLabel('Repetitions', { exact: true }).fill('501');
      await firstExercises.getByRole('button', { name: 'Add exercise' }).click();
      await firstExercises.getByLabel('Exercise name').nth(1).fill('Jigeiko rounds');
      await firstExercises.getByLabel('Measurement').nth(1).selectOption('duration');
      await firstExercises.getByLabel('Duration', { exact: true }).fill('12.5');
      await page.getByRole('button', { name: 'Add activity' }).click();
      const secondActivity = page.getByRole('group', { name: 'Activity 2' });
      await secondActivity.getByLabel('Activity name').fill('Closing practice');
      await secondActivity.getByLabel('Exercise name').fill('Kirikaeshi');
      await secondActivity.getByLabel('Repetitions', { exact: true }).fill('8');
      await page.getByRole('button', { name: 'Save session to dashboard' }).click();
      await expect(
        page.getByRole('alert', { name: 'Check the highlighted fields.' }),
      ).toBeFocused();

      const builderScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(builderScrollWidth, `/app/drills/new overflow at ${width}px`).toBeLessThanOrEqual(
        width,
      );

      await firstExercises.getByLabel('Repetitions', { exact: true }).fill('50');
      await page.getByRole('button', { name: 'Save session to dashboard' }).click();
      await expect(page).toHaveURL(/\/app\/dashboard/);
    }
  });

  test('keeps the cookie notice inside consistent responsive gutters', async ({ page }) => {
    for (const width of [320, 680, 840, 841, 900, 960, 961, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/app');

      const noticeMetrics = await page.locator('.cookie-notice').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const navigation = document.querySelector<HTMLElement>('.top-bar');
        if (navigation === null) {
          throw new Error('The top bar is missing.');
        }

        return {
          left: rect.left,
          right: window.innerWidth - rect.right,
          width: rect.width,
        };
      });

      expect(noticeMetrics.left).toBeGreaterThanOrEqual(16);
      expect(noticeMetrics.right).toBeGreaterThanOrEqual(16);
      expect(Math.abs(noticeMetrics.left - noticeMetrics.right)).toBeLessThanOrEqual(1);

      if (width > 960) {
        expect(Math.abs(noticeMetrics.width - width * 0.6)).toBeLessThanOrEqual(1);
      } else {
        expect(Math.abs(noticeMetrics.width - (width - 32))).toBeLessThanOrEqual(1);
      }

      await page.goto('/cookies');
      const policyMetrics = await page.locator('.policy-page').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: window.innerWidth - rect.right,
          width: rect.width,
        };
      });

      if (width > 840) {
        expect(Math.abs(policyMetrics.width - width * 0.5)).toBeLessThanOrEqual(1);
        expect(
          Math.abs(policyMetrics.left - (width - policyMetrics.width) / 2),
        ).toBeLessThanOrEqual(1);
      } else {
        expect(policyMetrics.left).toBeGreaterThanOrEqual(12);
        expect(policyMetrics.right).toBeGreaterThanOrEqual(12);
      }

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, `privacy layout overflow at ${width}px`).toBeLessThanOrEqual(width);
    }
  });

  test('does not overscale the landing hero background at tablet widths', async ({ page }) => {
    for (const width of [680, 800, 960]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/app');

      const backgroundSize = await page
        .locator('.landing-page')
        .evaluate((element) => getComputedStyle(element).backgroundSize);

      expect(backgroundSize, `hero background size at ${width}px`).toBe('cover, cover');
    }
  });

  test('keeps text-bearing landing reveals opaque before and after normal-motion reveal', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/app');

    const sections = page.locator('.landing-sections');
    const steps = page.locator('.landing-steps');

    await expect(sections).toHaveClass(/landing-motion-ready/);
    await expect(steps).not.toHaveClass(/is-revealed/);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const initialRevealOpacities = await getLandingRevealOpacities(page);
    expect(initialRevealOpacities).not.toEqual([]);
    expect(initialRevealOpacities.every((opacity) => opacity === '1')).toBe(true);
    const transitionProperties = await getLandingRevealTransitionProperties(page);
    expect(transitionProperties).not.toEqual([]);
    expect(transitionProperties.every((property) => property === 'transform')).toBe(true);
    await expectNoBlockingAxeViolations(page);

    await steps.scrollIntoViewIfNeeded();
    const duringRevealOpacities = await getLandingRevealOpacities(page);
    expect(duringRevealOpacities.every((opacity) => opacity === '1')).toBe(true);
    await expect(steps).toHaveClass(/is-revealed/);
    await expect(steps).toHaveCSS('opacity', '1');
    await expect(steps.locator('.landing-step').last()).toHaveCSS(
      'transform',
      'matrix(1, 0, 0, 1, 0, 0)',
    );
    const finalRevealOpacities = await getLandingRevealOpacities(page);
    expect(finalRevealOpacities.every((opacity) => opacity === '1')).toBe(true);
    await expectNoBlockingAxeViolations(page);
  });

  test('reveals a landing group when keyboard focus enters it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => {
      class NonIntersectingObserver {
        disconnect() {}

        observe() {}

        takeRecords() {
          return [];
        }

        unobserve() {}
      }

      Object.defineProperty(window, 'IntersectionObserver', {
        configurable: true,
        value: NonIntersectingObserver,
      });
    });
    await page.goto('/app');

    const faqGrid = page.locator('.landing-faq-grid[data-landing-reveal]');
    const firstQuestion = faqGrid.getByRole('button', { name: 'What is KendoMenu?' });
    await expect(faqGrid).not.toHaveClass(/is-revealed/);

    const heroCta = page.getByRole('link', { name: 'Browse Keiko library' });
    await heroCta.focus();
    await expect(heroCta).toBeFocused();
    await page.keyboard.press('Tab');

    await expect(firstQuestion).toBeFocused();
    await expect(faqGrid).toHaveClass(/is-revealed/);
    expect(await faqGrid.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  });

  test('honours reduced motion without hiding landing content', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/app');

    const sections = page.locator('.landing-sections');
    await expect(sections).not.toHaveClass(/landing-motion-ready/);
    const revealOpacities = await getLandingRevealOpacities(page);
    expect(revealOpacities).not.toEqual([]);
    expect(revealOpacities.every((opacity) => opacity === '1')).toBe(true);
    const revealTransforms = await getLandingRevealTransforms(page);
    expect(revealTransforms).not.toEqual([]);
    expect(revealTransforms.every((transform) => transform === 'none')).toBe(true);
  });

  test('alternates the desktop rhythm and restores heading-first mobile flow', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/app');

    const viewport = page.viewportSize();
    if (viewport === null) {
      throw new Error('The landing-page viewport is unavailable.');
    }

    const introductionHeading = await getElementBox(page.locator('#intro-title'));
    const introductionCopy = await getElementBox(page.locator('.landing-section-copy'));
    const libraryHeading = await getElementBox(page.locator('#library-story-title'));
    const libraryCopy = await getElementBox(page.locator('.landing-library-heading > p'));
    const finalHeading = await getElementBox(page.locator('#final-cta-title'));
    const finalAction = await getElementBox(
      page.getByRole('link', { name: 'Record your first keiko' }),
    );
    const stepBoxes = await Promise.all(
      (await page.locator('.landing-step').all()).map((step) => getElementBox(step)),
    );
    const firstStep = stepBoxes[0];
    const secondStep = stepBoxes[1];
    const thirdStep = stepBoxes[2];
    if (firstStep === undefined || secondStep === undefined || thirdStep === undefined) {
      throw new Error('The complete three-step journey is unavailable.');
    }

    if (viewport.width > 900) {
      expect(introductionCopy.x).toBeLessThan(introductionHeading.x);
      expect(libraryCopy.x).toBeLessThan(libraryHeading.x);
      expect(finalAction.x).toBeLessThan(finalHeading.x);
      expect(firstStep.y).toBe(secondStep.y);
      expect(secondStep.y).toBe(thirdStep.y);
      return;
    }

    expect(introductionHeading.y).toBeLessThan(introductionCopy.y);
    expect(libraryHeading.y).toBeLessThan(libraryCopy.y);
    expect(finalHeading.y).toBeLessThan(finalAction.y);
    expect(firstStep.y).toBeLessThan(secondStep.y);
    expect(secondStep.y).toBeLessThan(thirdStep.y);
  });
});
