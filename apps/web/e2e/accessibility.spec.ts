import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('accessibility and responsive layout', () => {
  test('has no critical or serious axe violations on the main routes', async ({ page }) => {
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
  });

  test('does not overflow horizontally at 320px or desktop width', async ({ page }) => {
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/app/dashboard');
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(width);
    }
  });
});
