import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'kendo-menu';

async function openNavigationIfNeeded(page: Page): Promise<void> {
  const menuToggle = page.getByRole('button', { name: 'Open navigation' });
  if (await menuToggle.isVisible()) {
    await menuToggle.click();
  }
}

test.describe('local persistence recovery', () => {
  test('downloads the exact corrupt payload, preserves it on cancel, and resets only KendoMenu data', async ({
    page,
  }) => {
    await page.goto('/app/dashboard');
    const raw = '{not valid json';
    await page.evaluate(
      ({ key, value }) => {
        window.localStorage.setItem(key, value);
        window.localStorage.setItem('other-application-sentinel', 'preserve-me');
      },
      { key: STORAGE_KEY, value: raw },
    );
    await page.reload();

    await expect(
      page.getByRole('heading', { name: 'We couldn’t read your local KendoMenu data.' }),
    ).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download raw backup' }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    if (downloadPath === null) {
      throw new Error('The browser did not provide a backup download path.');
    }
    expect(await readFile(downloadPath, 'utf8')).toBe(raw);

    const resetTrigger = page.getByRole('button', { name: 'Reset local data' });
    await resetTrigger.click();
    const alertDialog = page.getByRole('alertdialog', { name: 'Reset local data?' });
    await expect(alertDialog).toHaveJSProperty('open', true);
    await page.keyboard.press('Escape');
    await expect(alertDialog).toHaveCount(0);
    await expect(resetTrigger).toBeFocused();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBe(raw);

    await resetTrigger.click();
    const cancelledDialog = page.getByRole('alertdialog', { name: 'Reset local data?' });
    await cancelledDialog.getByRole('button', { name: 'Keep my data' }).click();
    await expect(cancelledDialog).toHaveCount(0);
    await expect(resetTrigger).toBeFocused();

    await resetTrigger.click();
    const confirmedDialog = page.getByRole('alertdialog', { name: 'Reset local data?' });
    await expect(confirmedDialog).toHaveJSProperty('open', true);
    await confirmedDialog.getByRole('button', { name: 'Reset local data' }).click();
    await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBeNull();
    expect(
      await page.evaluate(() => window.localStorage.getItem('other-application-sentinel')),
    ).toBe('preserve-me');
  });

  test('does not treat a future persistence version as corrupt or overwrite it', async ({
    page,
  }) => {
    await page.goto('/app/dashboard');
    const raw = JSON.stringify({ version: 999, state: { untouched: true } });
    await page.evaluate(({ key, value }) => window.localStorage.setItem(key, value), {
      key: STORAGE_KEY,
      value: raw,
    });
    await page.reload();

    await expect(
      page.getByRole('heading', { name: 'This local data needs a newer KendoMenu.' }),
    ).toBeVisible();
    await expect(page.getByText('Stored version: 999')).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBe(raw);
  });

  test('offers session-only mode when localStorage access is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      const storage = window.localStorage;
      const originalGetItem = storage.getItem.bind(storage);
      Object.defineProperty(storage, 'getItem', {
        configurable: true,
        value: (name: string): string | null => {
          if (name === 'kendo-menu') {
            throw new Error('storage blocked');
          }
          return originalGetItem(name);
        },
      });
    });
    await page.goto('/app/dashboard');

    await expect(
      page.getByRole('heading', { name: 'KendoMenu cannot access local data.' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Continue without saving' }).click();
    await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
    await expect(
      page.getByRole('banner').getByRole('status', { name: 'Session only' }),
    ).toBeVisible();
  });

  test('shows a warning when a local write fails', async ({ page }) => {
    await page.addInitScript(() => {
      const storage = window.localStorage;
      const originalSetItem = storage.setItem.bind(storage);
      Object.defineProperty(storage, 'setItem', {
        configurable: true,
        value: (name: string, value: string): void => {
          if (name === 'kendo-menu') {
            throw new Error('quota exceeded');
          }
          originalSetItem(name, value);
        },
      });
    });
    await page.goto('/app/library');
    await page.getByRole('button', { name: 'Add to dashboard' }).click();
    await expect(page.getByRole('status', { name: 'Changes are not being saved' })).toBeVisible();
    await openNavigationIfNeeded(page);
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Dashboard', exact: true })
      .click();

    const repetitions = page.getByLabel(/repetitions for stretch/i);
    await repetitions.fill('12');
    await repetitions.blur();
    await expect(page.getByText('Not saved to this device.')).toBeVisible();
    const appBanner = page.getByRole('banner');
    await expect(
      appBanner.getByRole('status', { name: 'Changes are not being saved' }),
    ).toBeVisible();
    const dashboardHeader = page
      .getByRole('heading', { name: 'Your dashboard', exact: true })
      .locator('xpath=ancestor::header');
    await expect(
      dashboardHeader.getByRole('status', { name: 'Changes are not being saved' }),
    ).toBeVisible();

    const notes = page.getByLabel('Practice notes');
    await notes.fill('Quota test note.');
    await notes.blur();
    await expect(page.getByText('Not saved to this device.')).toHaveCount(2);
    await expect(page.getByText('Saved locally.')).toHaveCount(0);
  });
});
