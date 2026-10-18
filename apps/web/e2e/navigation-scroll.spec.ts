import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './guest-test';
import { visibleWorkspaceBrandLink, workspaceLink } from './workspace-test-helpers';

const SCROLL_TOLERANCE = 4;

async function dismissCookieNotice(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const notice = page.getByRole('complementary', { name: 'Cookie notice' });
  if (await notice.isVisible()) {
    await notice.getByRole('button', { name: 'Got it' }).click();
  }
}

async function scrollDown(page: Page, requestedTop = 900): Promise<void> {
  await page.evaluate((top) => window.scrollTo({ top, left: 0 }), requestedTop);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
}

async function recordScrollY(page: Page, requestedTop: number): Promise<number> {
  await page.evaluate((top) => window.scrollTo({ top, left: 0 }), requestedTop);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const actualTop = await page.evaluate(() => window.scrollY);
  expect(Math.abs(actualTop - requestedTop)).toBeLessThanOrEqual(SCROLL_TOLERANCE);
  return actualTop;
}

async function expectScrollY(page: Page, expectedTop: number): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThanOrEqual(expectedTop - SCROLL_TOLERANCE);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeLessThanOrEqual(expectedTop + SCROLL_TOLERANCE);
}

async function expectTop(page: Page, message = 'Route should start at the top'): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { message })
    .toBeLessThanOrEqual(SCROLL_TOLERANCE);
}

async function getPrimaryNavigationLink(page: Page, name: string | RegExp): Promise<Locator> {
  const menuToggle = page.getByRole('button', { name: 'Open navigation' });
  if (await menuToggle.isVisible()) {
    await menuToggle.click();
  }

  return page.getByRole('navigation', { name: 'Landing navigation' }).getByRole('link', { name });
}

async function expectHashTarget(page: Page, id: string): Promise<void> {
  const target = page.locator(`#${id}`);
  await expect(target).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await expect(target).toBeInViewport();
}

test.describe('navigation scroll behavior', () => {
  test('returns a scrolled landing page to the top from the header logo by pointer and keyboard', async ({
    page,
  }) => {
    await page.goto('/app');
    await dismissCookieNotice(page);

    const logo = page.locator('.top-bar').getByRole('link', { name: 'KendoMenu home' });
    await scrollDown(page);
    await logo.click();
    await expectTop(page);

    await scrollDown(page);
    await logo.focus();
    await page.keyboard.press('Enter');
    await expectTop(page);
  });

  test('returns a scrolled internal route to the top when the header logo goes home', async ({
    page,
  }) => {
    await page.goto('/app/guest/library');
    await dismissCookieNotice(page);
    await scrollDown(page);

    await (await visibleWorkspaceBrandLink(page)).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByRole('heading', { name: 'Plan the keiko you need today' }),
    ).toBeVisible();
    await expectTop(page);
  });

  test('landing library navigation scrolls to the informational section', async ({ page }) => {
    await page.goto('/app');
    await dismissCookieNotice(page);
    await scrollDown(page);

    const libraryLink = await getPrimaryNavigationLink(page, 'Library info');
    await libraryLink.click();
    await expect(page).toHaveURL(/\/app#library-story-title$/);
    await expectHashTarget(page, 'library-story-title');

    await page.goto('/app');
    await dismissCookieNotice(page);
    await scrollDown(page);
    const keyboardLibraryLink = await getPrimaryNavigationLink(page, 'Library info');
    await keyboardLibraryLink.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app#library-story-title$/);
    await expectHashTarget(page, 'library-story-title');
  });

  test('workspace navigation keeps library routes separate and restores Back/Forward positions', async ({
    page,
  }) => {
    await page.goto('/app');
    await dismissCookieNotice(page);
    await expect(await getPrimaryNavigationLink(page, 'Library info')).toHaveAttribute(
      'href',
      '/app#library-story-title',
    );
    await page.getByRole('link', { name: 'Try without an account' }).click();
    await expect(page).toHaveURL(/\/app\/guest\/dashboard$/);
    await workspaceLink(page, 'Library').click();
    const card = page
      .getByRole('heading', { name: 'Senior High School dojo menu' })
      .locator('xpath=ancestor::article');
    await card.getByRole('link', { name: 'View session' }).click();
    await page.getByRole('button', { name: 'Add to dashboard' }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'View dashboard' }).click();
    await expect(page.locator('body')).not.toHaveClass(/drill-dialog-open/);
    const dashboardTop = await page.evaluate(() => window.scrollY);

    const libraryLink = workspaceLink(page, 'Library');
    await libraryLink.click();
    await expect(page).toHaveURL(/\/app\/guest\/library$/);
    await expect(page.getByRole('heading', { name: 'Keiko library', exact: true })).toBeVisible();
    await expectTop(page, 'Navigating from Dashboard to Library should reset scroll to the top');

    const libraryTop = await recordScrollY(page, 200);
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/guest\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
    await expectScrollY(page, dashboardTop);

    await page.goForward();
    await expect(page).toHaveURL(/\/app\/guest\/library$/);
    await expect(page.getByRole('heading', { name: 'Keiko library', exact: true })).toBeVisible();
    await expectScrollY(page, libraryTop);
  });

  test('preserves a scrolled library position while opening and closing a drill dialog', async ({
    page,
  }) => {
    await page.goto('/app/guest/library');
    await dismissCookieNotice(page);
    const libraryTop = await recordScrollY(page, 200);

    const card = page
      .getByRole('heading', { name: 'International dojo menu' })
      .locator('xpath=ancestor::article');
    await card.getByRole('link', { name: 'View session' }).click();
    await expect(page).toHaveURL(/\/app\/guest\/library\?drill=international-dojo-2-hour-session$/);
    await expect(page.getByRole('dialog', { name: 'International dojo menu' })).toBeVisible();
    await expectScrollY(page, libraryTop);

    await page
      .getByRole('dialog', { name: 'International dojo menu' })
      .getByRole('button', { name: 'Close International dojo menu details.' })
      .click();
    await expect(page).toHaveURL(/\/app\/guest\/library$/);
    await expectScrollY(page, libraryTop);
  });

  test('returns FAQ and footer information links to the top of their destination', async ({
    page,
  }) => {
    await page.goto('/app');
    await dismissCookieNotice(page);

    await page.getByRole('button', { name: 'Where do the keiko menus come from?' }).click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await page.getByRole('link', { name: 'here', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/sources$/);
    await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
    await expectTop(page);

    await page.goto('/app');
    await dismissCookieNotice(page);
    const footer = page.getByRole('contentinfo', { name: 'Site footer' });
    await footer.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await footer.getByRole('link', { name: 'Sources' }).click();
    await expect(page).toHaveURL(/\/app\/sources$/);
    await expectTop(page);

    await page.goto('/app');
    await dismissCookieNotice(page);
    await footer.scrollIntoViewIfNeeded();
    const cookiesLink = footer.getByRole('link', { name: 'Cookies' });
    await cookiesLink.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/cookies$/);
    await expect(page.getByRole('heading', { name: 'Cookie Policy', exact: true })).toBeVisible();
    await expectTop(page);
  });

  test('keeps intentional How it works and FAQ hashes on their targets', async ({ page }) => {
    await page.goto('/app');
    await dismissCookieNotice(page);

    const howItWorksLink = await getPrimaryNavigationLink(page, 'How it works');
    await howItWorksLink.click();
    await expect(page).toHaveURL(/\/app#how-it-works-title$/);
    await expectHashTarget(page, 'how-it-works-title');

    await page.goto('/app');
    await dismissCookieNotice(page);
    const faqLink = await getPrimaryNavigationLink(page, 'FAQ');
    await faqLink.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app#faq-title$/);
    await expectHashTarget(page, 'faq-title');
  });

  test('returns home to the top when the logo clears an FAQ hash', async ({ page }) => {
    await page.goto('/app');
    await dismissCookieNotice(page);

    const faqLink = await getPrimaryNavigationLink(page, 'FAQ');
    await faqLink.click();
    await expect(page).toHaveURL(/\/app#faq-title$/);
    await expectHashTarget(page, 'faq-title');

    await page.locator('.top-bar').getByRole('link', { name: 'KendoMenu home' }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expectTop(page);
  });

  test('keeps the mobile landing menu open outside it and closes through its controls', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/app');
    await dismissCookieNotice(page);

    const menuToggle = page.locator('.menu-toggle');
    const navigation = page.getByRole('navigation', { name: 'Landing navigation' });
    await menuToggle.click();
    await expect(navigation).toBeVisible();

    const menuSurface = await navigation.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderTopColor,
        backdropFilter: style.getPropertyValue('backdrop-filter'),
        webkitBackdropFilter: style.getPropertyValue('-webkit-backdrop-filter'),
        supportsBackdropFilter:
          CSS.supports('backdrop-filter', 'blur(4px)') ||
          CSS.supports('-webkit-backdrop-filter', 'blur(4px)'),
      };
    });
    expect(menuSurface.borderColor).toBe('rgba(200, 155, 60, 0.48)');
    if (menuSurface.supportsBackdropFilter) {
      expect(menuSurface.backgroundColor).toBe('rgba(3, 13, 28, 0.98)');
      expect(
        [menuSurface.backdropFilter, menuSurface.webkitBackdropFilter].some((filter) =>
          filter.includes('blur(4px)'),
        ),
      ).toBe(true);
    } else {
      expect(menuSurface.backgroundColor).toBe('rgb(3, 13, 28)');
    }

    await page.mouse.click(370, 500);
    await expect(navigation).toBeVisible();
    await page.getByRole('link', { name: 'Try without an account' }).focus();
    await expect(navigation).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 600, left: 0 }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await expect(navigation).toBeInViewport();

    await menuToggle.click();
    await expect(navigation).toBeHidden();
    await menuToggle.click();
    await page.keyboard.press('Escape');
    await expect(menuToggle).toBeFocused();
    await expect(navigation).toBeHidden();

    await menuToggle.click();
    await navigation.getByRole('link', { name: 'FAQ', exact: true }).click();
    await expect(page).toHaveURL(/\/app#faq-title$/);
    await expect(navigation).toBeHidden();
  });
});
