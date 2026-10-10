import { readFile } from 'node:fs/promises';
import { expect, type Dialog, type Page } from '@playwright/test';

import { test } from './guest-test';

async function addGuestMenu(page: Page) {
  await page.goto('/app/guest/library');
  const card = page
    .getByRole('heading', { name: 'Senior High School dojo menu' })
    .locator('xpath=ancestor::article');
  await card.getByRole('link', { name: 'View session' }).click();
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'View dashboard' }).click();
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);
}

test('quota recovery protects guest dashboard Home and public-page departure until explicit discard', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const storage = window.localStorage;
    const setItem = storage.setItem.bind(storage);
    Object.defineProperty(storage, 'setItem', {
      configurable: true,
      value: (name: string, value: string) => {
        if (name === 'kendo-menu') throw new DOMException('quota fault', 'QuotaExceededError');
        setItem(name, value);
      },
    });
  });
  await addGuestMenu(page);
  await expect(page.getByRole('heading', { name: 'Changes are not saved' })).toBeVisible();
  const confirmations: string[] = [];
  const dismiss = async (dialog: Dialog) => {
    confirmations.push(dialog.message());
    await dialog.dismiss();
  };
  page.on('dialog', dismiss);
  await page.getByRole('banner').getByRole('link', { name: 'KendoMenu home' }).click();
  await expect.poll(() => confirmations.length).toBe(1);
  await expect(page).toHaveURL(/\/app\/guest\/dashboard$/);
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);
  await page.getByRole('contentinfo').getByRole('link', { name: 'Cookies', exact: true }).click();
  await expect.poll(() => confirmations.length).toBe(2);
  await expect(page).toHaveURL(/\/app\/guest\/dashboard$/);
  await page.getByRole('button', { name: 'Open recovery options' }).click();
  await page.getByRole('contentinfo').getByRole('link', { name: 'Cookies', exact: true }).click();
  await expect.poll(() => confirmations.length).toBe(3);
  await expect(page).toHaveURL(/\/app\/guest\/dashboard$/);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download current backup' }).click();
  const downloadPath = await (await downloadPromise).path();
  expect(downloadPath).not.toBeNull();
  if (downloadPath !== null) {
    expect(await readFile(downloadPath, 'utf8')).toContain('senior-high-school-kendo-club');
  }
  page.off('dialog', dismiss);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('banner').getByRole('link', { name: 'KendoMenu home' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole('link', { name: 'Continue as a guest' }).click();
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBeNull();
});

test('session-only guest recovery requires explicit discard before a public-page exit', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const storage = window.localStorage;
    const getItem = storage.getItem.bind(storage);
    Object.defineProperty(storage, 'getItem', {
      configurable: true,
      value: (name: string) => {
        if (name === 'kendo-menu') throw new DOMException('storage unavailable', 'SecurityError');
        return getItem(name);
      },
    });
  });
  await page.goto('/app/guest/library');
  await page.getByRole('button', { name: 'Continue without saving' }).click();
  const card = page
    .getByRole('heading', { name: 'Senior High School dojo menu' })
    .locator('xpath=ancestor::article');
  await card.getByRole('link', { name: 'View session' }).click();
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'View dashboard' }).click();
  const confirmations: string[] = [];
  const dismiss = async (dialog: Dialog) => {
    confirmations.push(dialog.message());
    await dialog.dismiss();
  };
  page.on('dialog', dismiss);
  await page.getByRole('contentinfo').getByRole('link', { name: 'Cookies', exact: true }).click();
  await expect.poll(() => confirmations.length).toBe(1);
  await expect(page).toHaveURL(/\/app\/guest\/dashboard$/);
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);
  page.off('dialog', dismiss);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('contentinfo').getByRole('link', { name: 'Cookies', exact: true }).click();
  await expect(page).toHaveURL(/\/cookies$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('session-only guest recovery still protects public exit from a clean builder', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const storage = window.localStorage;
    const getItem = storage.getItem.bind(storage);
    Object.defineProperty(storage, 'getItem', {
      configurable: true,
      value: (name: string) => {
        if (name === 'kendo-menu') throw new DOMException('storage unavailable', 'SecurityError');
        return getItem(name);
      },
    });
  });
  await page.goto('/app/guest/library');
  await page.getByRole('button', { name: 'Continue without saving' }).click();
  const card = page
    .getByRole('heading', { name: 'Senior High School dojo menu' })
    .locator('xpath=ancestor::article');
  await card.getByRole('link', { name: 'View session' }).click();
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'View dashboard' }).click();
  await page.getByRole('link', { name: 'Create new menu' }).click();
  await expect(page.getByRole('heading', { name: 'Create a training session' })).toBeVisible();

  const confirmations: string[] = [];
  const dismiss = async (dialog: Dialog) => {
    confirmations.push(dialog.message());
    await dialog.dismiss();
  };
  page.on('dialog', dismiss);
  await page.getByRole('contentinfo').getByRole('link', { name: 'Cookies', exact: true }).click();
  await expect.poll(() => confirmations.length).toBe(1);
  expect(confirmations[0]).toMatch(/guest changes/i);
  await expect(page).toHaveURL(/\/app\/guest\/drills\/new$/);

  const nameField = page.getByLabel('Session name');
  await nameField.fill('Unfinished session draft');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Cookies', exact: true }).click();
  await expect.poll(() => confirmations.length).toBe(2);
  expect(confirmations[1]).toMatch(/unsaved session draft/i);
  expect(confirmations[1]).toMatch(/guest changes/i);
  await expect(page).toHaveURL(/\/app\/guest\/drills\/new$/);
  page.off('dialog', dismiss);

  page.once('dialog', (dialog) => dialog.accept());
  const dashboardLink = page
    .getByRole('banner')
    .getByRole('link', { name: 'Dashboard', exact: true });
  if (!(await dashboardLink.isVisible())) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
  }
  await dashboardLink.click();
  await expect(page).toHaveURL(/\/app\/guest\/dashboard$/);
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);
});
