import { expect, test, type Page, type TestInfo } from '@playwright/test';

import {
  COOKIE_NOTICE_ACKNOWLEDGEMENT_DURATION_MS,
  COOKIE_NOTICE_ACKNOWLEDGEMENT_STORAGE_KEY,
} from '../src/lib/cookie-notice';
import {
  INSTALL_DISMISSAL_STORAGE_KEY,
  INSTALL_LANDING_VISIT_STORAGE_KEY,
} from '../src/lib/install-prompt';

const INSTALL_PROMO_NAME = 'Keep KendoMenu close for practice.';

function isProject(testInfo: TestInfo, projectName: string): boolean {
  return testInfo.project.name === projectName;
}

async function dispatchBeforeInstallPrompt(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperties(event, {
      platforms: { configurable: true, value: ['web'] },
      prompt: { configurable: true, value: () => Promise.resolve() },
      userChoice: {
        configurable: true,
        value: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
      },
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

async function prepareStorage(
  page: Page,
  options: { readonly visitCount?: string; readonly acknowledgeCookie: boolean },
): Promise<void> {
  await page.goto('/app/dashboard');
  await page.evaluate(
    ({ cookieDuration, cookieKey, dismissalKey, visitCount, visitKey, acknowledgeCookie }) => {
      window.localStorage.removeItem(dismissalKey);
      if (visitCount === undefined) {
        window.localStorage.removeItem(visitKey);
      } else {
        window.localStorage.setItem(visitKey, visitCount);
      }

      if (acknowledgeCookie) {
        window.localStorage.setItem(cookieKey, String(Date.now() + cookieDuration));
      } else {
        window.localStorage.removeItem(cookieKey);
      }
    },
    {
      cookieDuration: COOKIE_NOTICE_ACKNOWLEDGEMENT_DURATION_MS,
      cookieKey: COOKIE_NOTICE_ACKNOWLEDGEMENT_STORAGE_KEY,
      dismissalKey: INSTALL_DISMISSAL_STORAGE_KEY,
      visitCount: options.visitCount,
      visitKey: INSTALL_LANDING_VISIT_STORAGE_KEY,
      acknowledgeCookie: options.acknowledgeCookie,
    },
  );
}

test.describe('installation and cookie notice coordination', () => {
  test('does not offer installation to a narrow desktop browser', async ({ page }, testInfo) => {
    test.skip(!isProject(testInfo, 'chromium'), 'Desktop capability coverage.');
    await page.setViewportSize({ width: 375, height: 812 });
    await prepareStorage(page, { visitCount: '1', acknowledgeCookie: true });
    await page.goto('/app');

    expect(await dispatchBeforeInstallPrompt(page)).toBe(true);
    await expect(page.getByRole('dialog', { name: INSTALL_PROMO_NAME })).toHaveCount(0);
    expect(
      await page.evaluate(
        (key) => window.localStorage.getItem(key),
        INSTALL_LANDING_VISIT_STORAGE_KEY,
      ),
    ).toBe('1');
  });

  test('offers installation on the second phone landing visit', async ({ page }, testInfo) => {
    test.skip(!isProject(testInfo, 'mobile-chrome'), 'Phone capability coverage.');
    await prepareStorage(page, { acknowledgeCookie: true });
    await page.goto('/app');

    expect(await dispatchBeforeInstallPrompt(page)).toBe(true);
    await expect(page.getByRole('dialog', { name: INSTALL_PROMO_NAME })).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate((key) => window.localStorage.getItem(key), INSTALL_LANDING_VISIT_STORAGE_KEY),
      )
      .toBe('1');

    await page.reload();
    expect(await dispatchBeforeInstallPrompt(page)).toBe(true);
    await expect(page.getByRole('dialog', { name: INSTALL_PROMO_NAME })).toBeVisible();
    expect(
      await page.evaluate(
        (key) => window.localStorage.getItem(key),
        INSTALL_LANDING_VISIT_STORAGE_KEY,
      ),
    ).toBe('2');
  });

  test('defers installation when the cookie notice has priority', async ({ page }, testInfo) => {
    test.skip(!isProject(testInfo, 'mobile-chrome'), 'Phone notice coordination coverage.');
    await prepareStorage(page, { visitCount: '1', acknowledgeCookie: false });
    await page.goto('/app');

    expect(await dispatchBeforeInstallPrompt(page)).toBe(true);
    const cookieNotice = page.getByRole('complementary', { name: 'Cookie notice' });
    await expect(cookieNotice).toBeVisible();
    await expect(page.getByRole('dialog', { name: INSTALL_PROMO_NAME })).toHaveCount(0);

    await cookieNotice.getByRole('button', { name: 'Got it' }).click();
    await expect(cookieNotice).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: INSTALL_PROMO_NAME })).toHaveCount(0);

    const menuToggle = page.getByRole('button', { name: 'Open navigation' });
    await menuToggle.click();
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: /Keiko library/ })
      .click();
    await expect(page).toHaveURL(/\/app\/library$/);
    await page.locator('.top-bar').getByRole('link', { name: 'KendoMenu home' }).click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('dialog', { name: INSTALL_PROMO_NAME })).toBeVisible();
    await expect(cookieNotice).toHaveCount(0);
  });
});
