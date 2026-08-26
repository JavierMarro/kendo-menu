import { expect, test, type Locator, type Page } from '@playwright/test';

async function dismissCookieNotice(page: Page): Promise<void> {
  const notice = page.getByRole('complementary', { name: 'Cookie notice' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Got it' }).click();
}

async function verifyFooterLinksAndKeyboardFocus(page: Page, footer: Locator): Promise<void> {
  await expect(footer.getByRole('link', { name: 'KendoMenu home' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'How it works' })).toBeVisible();
  await expect(footer.getByRole('link', { name: /Drill library/ })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'FAQ' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'GitHub (placeholder)' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'LinkedIn (placeholder)' })).toBeVisible();

  const githubLink = footer.getByRole('link', { name: 'GitHub (placeholder)' });
  const linkedInLink = footer.getByRole('link', { name: 'LinkedIn (placeholder)' });
  await githubLink.focus();
  await page.keyboard.press('Tab');
  await expect(linkedInLink).toBeFocused();

  const focusStyle = await linkedInLink.evaluate((element) => {
    const computedStyle = getComputedStyle(element);
    return {
      outlineStyle: computedStyle.outlineStyle,
      outlineWidth: computedStyle.outlineWidth,
    };
  });
  expect(focusStyle.outlineStyle).not.toBe('none');
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(3);
}

test.describe('responsive site footer', () => {
  test('uses a three-column layout at 1440px without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app/dashboard');
    await dismissCookieNotice(page);

    const footer = page.getByRole('contentinfo', { name: 'Site footer' });
    await footer.scrollIntoViewIfNeeded();
    const grid = footer.locator('.site-footer-grid');
    const desktopLayout = await grid.evaluate((element) => {
      const columns = Array.from(element.querySelectorAll<HTMLElement>('.site-footer-column'));
      const rects = columns.map((column) => column.getBoundingClientRect());
      const firstRect = rects[0];

      return {
        columnCount: columns.length,
        gridColumnCount: getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean)
          .length,
        isSingleRow:
          firstRect !== undefined && rects.every((rect) => Math.abs(rect.top - firstRect.top) <= 1),
      };
    });

    expect(desktopLayout).toEqual({ columnCount: 3, gridColumnCount: 3, isSingleRow: true });
    await verifyFooterLinksAndKeyboardFocus(page, footer);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(1440);
  });

  test('places the brand above two link columns at 375px without horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/app/dashboard');
    await dismissCookieNotice(page);

    const footer = page.getByRole('contentinfo', { name: 'Site footer' });
    await footer.scrollIntoViewIfNeeded();
    const grid = footer.locator('.site-footer-grid');
    const mobileLayout = await grid.evaluate((element) => {
      const columns = Array.from(element.querySelectorAll<HTMLElement>('.site-footer-column'));
      const rects = columns.map((column) => column.getBoundingClientRect());
      const firstRect = rects[0];

      return {
        columnOrder: columns.map((column) => {
          if (column.querySelector('.footer-brand-lockup') !== null) {
            return 'brand';
          }
          if (column.querySelector('.footer-nav') !== null) {
            return 'navigation';
          }
          return 'social';
        }),
        gridColumnCount: getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean)
          .length,
        isBrandAboveLinks:
          firstRect !== undefined && rects.slice(1).every((rect) => rect.top >= firstRect.bottom),
        areLinkColumnsAligned:
          rects[1] !== undefined &&
          rects[2] !== undefined &&
          Math.abs(rects[1].top - rects[2].top) <= 1,
      };
    });

    expect(mobileLayout).toEqual({
      columnOrder: ['brand', 'navigation', 'social'],
      gridColumnCount: 2,
      isBrandAboveLinks: true,
      areLinkColumnsAligned: true,
    });
    await verifyFooterLinksAndKeyboardFocus(page, footer);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
  });
});
