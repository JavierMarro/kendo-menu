import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('accessibility and responsive layout', () => {
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

    await page.goto('/app/drills/new');
    const builderResults = await new AxeBuilder({ page }).analyze();
    const builderBlockingViolations = builderResults.violations.filter(
      ({ impact }) => impact === 'critical' || impact === 'serious',
    );
    expect(builderBlockingViolations).toEqual([]);

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
      if (width <= 760) {
        await page.getByRole('button', { name: 'Open navigation' }).click();
        await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
      } else if (width <= 840) {
        await expect(page.locator('.brand-name')).toBeHidden();
        await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden();
        await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
        const navWhiteSpaces = await page
          .locator('.nav-item')
          .evaluateAll((elements) =>
            elements.map((element) => getComputedStyle(element).whiteSpace),
          );
        expect(navWhiteSpaces.every((whiteSpace) => whiteSpace === 'nowrap')).toBe(true);
      } else {
        await expect(page.locator('.brand-name')).toBeVisible();
      }
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(width);
    }
  });
});
