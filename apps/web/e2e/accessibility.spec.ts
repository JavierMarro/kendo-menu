import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator } from '@playwright/test';

async function getElementBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`Could not measure ${await locator.evaluate((element) => element.outerHTML)}.`);
  }

  return box;
}

test.describe('accessibility and responsive layout', () => {
  test('has no blocking axe violations with the library dialog closed or open', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/app/library');

    const closedResults = await new AxeBuilder({ page }).analyze();
    expect(
      closedResults.violations.filter(
        ({ impact }) => impact === 'critical' || impact === 'serious',
      ),
    ).toEqual([]);

    const card = page
      .getByRole('heading', { name: 'International dojo menu' })
      .locator('xpath=ancestor::article');
    await card.getByRole('link', { name: 'View drill' }).click();
    const dialog = page.getByRole('dialog', { name: 'International dojo menu' });
    await expect(dialog).toBeVisible();
    await dialog.locator('details.detail-section').first().locator('summary').click();

    const openResults = await new AxeBuilder({ page }).analyze();
    expect(
      openResults.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
    ).toEqual([]);
  });

  test('has no critical or serious axe violations on the main routes', async ({ page }) => {
    await page.goto('/app');
    const viewport = page.viewportSize();
    if (viewport !== null && viewport.width <= 760) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    }
    const landingResults = await new AxeBuilder({ page }).analyze();
    const landingBlockingViolations = landingResults.violations.filter(
      ({ impact }) => impact === 'critical' || impact === 'serious',
    );
    expect(landingBlockingViolations).toEqual([]);

    await page.goto('/app/dashboard');
    const dashboardResults = await new AxeBuilder({ page }).analyze();
    const dashboardBlockingViolations = dashboardResults.violations.filter(
      ({ impact }) => impact === 'critical' || impact === 'serious',
    );
    expect(dashboardBlockingViolations).toEqual([]);

    await page.goto('/app/library');
    const libraryResults = await new AxeBuilder({ page }).analyze();
    const libraryBlockingViolations = libraryResults.violations.filter(
      ({ impact }) => impact === 'critical' || impact === 'serious',
    );
    expect(libraryBlockingViolations).toEqual([]);

    await page.goto('/app/library?drill=international-dojo-2-hour-session');
    await expect(page.getByRole('dialog', { name: 'International dojo menu' })).toBeVisible();
    const firstSection = page.locator('details.detail-section').first();
    await expect(firstSection).not.toHaveAttribute('open', '');
    await firstSection.locator('summary').click();
    const detailResults = await new AxeBuilder({ page }).analyze();
    const detailBlockingViolations = detailResults.violations.filter(
      ({ impact }) => impact === 'critical' || impact === 'serious',
    );
    expect(detailBlockingViolations).toEqual([]);

    await page.goto('/app/drills/new');
    const builderResults = await new AxeBuilder({ page }).analyze();
    const builderBlockingViolations = builderResults.violations.filter(
      ({ impact }) => impact === 'critical' || impact === 'serious',
    );
    expect(builderBlockingViolations).toEqual([]);

    await page.goto('/app/sources');
    await expect(page.getByRole('heading', { name: 'Sources', level: 1 })).toBeVisible();
    const sourcesResults = await new AxeBuilder({ page }).analyze();
    const sourcesBlockingViolations = sourcesResults.violations.filter(
      ({ impact }) => impact === 'critical' || impact === 'serious',
    );
    expect(sourcesBlockingViolations).toEqual([]);

    await page.goto('/cookies');
    await expect(page.getByRole('complementary', { name: 'Cookie notice' })).toBeVisible();
    const cookiePolicyResults = await new AxeBuilder({ page }).analyze();
    const cookiePolicyBlockingViolations = cookiePolicyResults.violations.filter(
      ({ impact }) => impact === 'critical' || impact === 'serious',
    );
    expect(cookiePolicyBlockingViolations).toEqual([]);
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

  test('progressively reveals landing groups and honours reduced motion', async ({ page }) => {
    await page.goto('/app');

    const sections = page.locator('.landing-sections');
    const introductionHeading = page.getByRole('heading', {
      name: 'A keiko menu for the day in front of you.',
    });
    const steps = page.locator('.landing-steps');

    await expect(sections).toHaveClass(/landing-motion-ready/);
    await expect(introductionHeading).toHaveCSS('opacity', '1');
    await expect(steps).not.toHaveClass(/is-revealed/);

    await steps.scrollIntoViewIfNeeded();
    await expect(steps).toHaveClass(/is-revealed/);
    await expect(steps).toHaveCSS('opacity', '1');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();

    await expect(sections).not.toHaveClass(/landing-motion-ready/);
    const revealOpacities = await page
      .locator('[data-landing-reveal]')
      .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).opacity));
    expect(revealOpacities.every((opacity) => opacity === '1')).toBe(true);
  });

  test('alternates the desktop rhythm and restores heading-first mobile flow', async ({ page }) => {
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
