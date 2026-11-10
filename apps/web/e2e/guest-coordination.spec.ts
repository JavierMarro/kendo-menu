import { readFile } from 'node:fs/promises';

import { expect } from '@playwright/test';
import { test } from './guest-test';
import { workspaceLink } from './workspace-test-helpers';

const STORAGE_KEY = 'kendo-menu';

test('ordinary guest persistence shares the guest Web Lock across tabs', async ({
  page,
  context,
}) => {
  const owner = await context.newPage();
  await owner.goto('/app/guest/dashboard');
  await owner.evaluate(
    () =>
      new Promise<void>((acquired) => {
        void navigator.locks.request(
          'kendo-menu:guest',
          () =>
            new Promise<void>((release) => {
              window.addEventListener('release-test-guest-lock', () => release(), { once: true });
              acquired();
            }),
        );
      }),
  );
  await page.goto('/app/guest/library?drill=junior-high-kendo-club');
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBeNull();
  await owner.evaluate(() => window.dispatchEvent(new Event('release-test-guest-lock')));
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kendo-menu'))).not.toBeNull();
  await expect(page.locator('.inline-confirmation')).toContainText('added to your dashboard.');
  await page.goto('/app/guest/dashboard');
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);
  await owner.close();
});

test('a stale guest tab preserves a peer dashboard during retry and keeps its own draft recoverable', async ({
  page,
  context,
}) => {
  await page.goto('/app/guest/dashboard');
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();

  const peer = await context.newPage();
  await peer.goto('/app/guest/library?drill=junior-high-kendo-club');
  await peer.getByRole('button', { name: 'Add to dashboard' }).click();
  await peer.getByRole('dialog').getByRole('link', { name: 'View dashboard' }).click();
  await expect(peer.locator('.dashboard-card--compact')).toHaveCount(1);
  await expect
    .poll(() => peer.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .not.toBeNull();
  const peerRaw = await peer.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  if (peerRaw === null) {
    throw new Error('Expected the peer tab to confirm its guest dashboard.');
  }
  expect(peerRaw).toContain('junior-high-kendo-club');

  // Keep this document alive from its empty hydration so its writer retains the stale baseline.
  await workspaceLink(page, 'Library').click();
  const staleMenu = page
    .getByRole('heading', { name: 'Senior High School dojo menu' })
    .locator('xpath=ancestor::article');
  await staleMenu.getByRole('link', { name: 'View session' }).click();
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'View dashboard' }).click();
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Changes are not saved' })).toBeVisible();

  await page.getByRole('button', { name: 'Open recovery options' }).click();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The saved dashboard changed');
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(peerRaw);

  const backupPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download current backup' }).click();
  const backupDownload = await backupPromise;
  const backupPath = await backupDownload.path();
  if (backupPath === null) {
    throw new Error('The browser did not provide a current guest backup path.');
  }
  const backup = JSON.parse(await readFile(backupPath, 'utf8')) as unknown;
  expect(backup).toMatchObject({
    version: 11,
    state: {
      dashboardEntries: expect.arrayContaining([
        expect.objectContaining({ trainingSetId: 'senior-high-school-kendo-club' }),
      ]),
    },
  });

  await page.getByRole('button', { name: 'Continue without saving' }).click();
  await expect(page.getByRole('heading', { name: 'Senior High School dojo menu' })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(peerRaw);
  await peer.close();
});
