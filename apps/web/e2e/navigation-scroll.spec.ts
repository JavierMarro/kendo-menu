import { expect, test, type Locator, type Page } from '@playwright/test';

const SCROLL_TOLERANCE = 4;

async function dismissCookieNotice(page: Page): Promise<void> {
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

async function expectTop(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeLessThanOrEqual(SCROLL_TOLERANCE);
}

async function getPrimaryNavigationLink(page: Page, name: string | RegExp): Promise<Locator> {
  const menuToggle = page.getByRole('button', { name: 'Open navigation' });
  if (await menuToggle.isVisible()) {
    await menuToggle.click();
  }

  return page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name });
}

async function clickVisibleLinkWithPointer(page: Page, link: Locator): Promise<void> {
  const box = await link.boundingBox();
  if (box === null) {
    throw new Error('Expected the navigation link to be visible before pointer activation.');
  }

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
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
    await page.goto('/app/library');
    await dismissCookieNotice(page);
    await scrollDown(page);

    await page.locator('.top-bar').getByRole('link', { name: 'KendoMenu home' }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByRole('heading', { name: 'Plan the keiko you need today.' }),
    ).toBeVisible();
    await expectTop(page);
  });

  test('returns a scrolled landing page to the top when the library nav link is activated', async ({
    page,
  }) => {
    await page.goto('/app');
    await dismissCookieNotice(page);
    await scrollDown(page);

    const libraryLink = await getPrimaryNavigationLink(page, /Keiko library/);
    await libraryLink.click();
    await expect(page).toHaveURL(/\/app\/library$/);
    await expect(page.getByRole('heading', { name: 'Keiko library' })).toBeVisible();
    await expectTop(page);

    await page.goto('/app');
    await dismissCookieNotice(page);
    await scrollDown(page);
    const keyboardLibraryLink = await getPrimaryNavigationLink(page, /Keiko library/);
    await keyboardLibraryLink.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app\/library$/);
    await expectTop(page);
  });

  test('restores recorded positions across browser Back and Forward', async ({ page }) => {
    await page.goto('/app');
    await dismissCookieNotice(page);
    const landingTop = await recordScrollY(page, 640);

    const menuToggle = page.getByRole('button', { name: 'Open navigation' });
    if (await menuToggle.isVisible()) {
      await clickVisibleLinkWithPointer(page, menuToggle);
    }
    const libraryLink = page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: /Keiko library/ });
    await clickVisibleLinkWithPointer(page, libraryLink);
    await expect(page).toHaveURL(/\/app\/library$/);
    await expectTop(page);

    const libraryTop = await recordScrollY(page, 800);
    await page.goBack();
    await expect(page).toHaveURL(/\/app$/);
    await expectScrollY(page, landingTop);

    await page.goForward();
    await expect(page).toHaveURL(/\/app\/library$/);
    await expectScrollY(page, libraryTop);
  });

  test('preserves a scrolled library position while opening and closing a drill dialog', async ({
    page,
  }) => {
    await page.goto('/app/library');
    await dismissCookieNotice(page);
    const libraryTop = await recordScrollY(page, 320);

    const card = page
      .getByRole('heading', { name: 'International dojo menu' })
      .locator('xpath=ancestor::article');
    await card.getByRole('link', { name: 'View session' }).click();
    await expect(page).toHaveURL(/\/app\/library\?drill=international-dojo-2-hour-session$/);
    await expect(page.getByRole('dialog', { name: 'International dojo menu' })).toBeVisible();
    await expectScrollY(page, libraryTop);

    await page
      .getByRole('dialog', { name: 'International dojo menu' })
      .getByRole('button', { name: 'Close International dojo menu details.' })
      .click();
    await expect(page).toHaveURL(/\/app\/library$/);
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
});
