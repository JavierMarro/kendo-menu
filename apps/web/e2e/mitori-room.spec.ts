import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';

import { test } from './guest-test';
import { SyntheticManagedHarness } from './synthetic-managed-harness';
import { workspaceLink } from './workspace-test-helpers';

test('Mitori room supports keyboard video selection, URL history and lazy private embeds', async ({
  page,
}) => {
  const youtubeRequests: string[] = [];
  await page.route(
    /https:\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com|i\.ytimg\.com)\//,
    async (route) => {
      youtubeRequests.push(route.request().url());
      await route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Synthetic video</title>',
      });
    },
  );
  await page.goto('/app/guest/dashboard');
  await workspaceLink(page, 'Mitori room').click();
  await expect(page.getByRole('heading', { name: 'Mitori room', exact: true })).toBeVisible();
  await expect(workspaceLink(page, 'Mitori room')).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle('Mitori room · KendoMenu');
  expect(youtubeRequests).toEqual([]);
  const first = page.getByRole('button', { name: /Oikomi/ });
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/ZyJiUitoZZE',
  );
  await expect.poll(() => youtubeRequests.length).toBe(1);
  await page.getByRole('button', { name: /Naoki Eiga Sensei/ }).click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  const sections = page.getByRole('navigation', { name: 'Mitori room sections' });
  await sections.getByRole('link', { name: 'Documentaries' }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await sections.getByRole('link', { name: 'Kata', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: /Nippon Kendo Kata/ })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: /Path of No Regret/ })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await sections.getByRole('link', { name: 'Glossary' }).click();
  await page.getByRole('searchbox', { name: 'Find a term' }).fill('kirikaeshi');
  await expect(page.getByRole('term').filter({ hasText: /^Kirikaeshi$/ })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Find a term' }).fill('not-a-kendo-term');
  await expect(page.getByText(/No terms match/)).toBeVisible();
  await sections.getByRole('link', { name: 'Resources' }).click();
  await expect(page.getByRole('heading', { name: 'Resources', exact: true })).toBeVisible();
  await expect(page.getByRole('contentinfo', { name: 'Site footer' })).toHaveCount(0);
});

test('signed-in navigation and guest deep links reach the account Mitori room without saving', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await page.goto('/app/guest/mitori-room?tab=kata');
  await expect(page).toHaveURL(/\/app\/account\/mitori-room\?tab=kata$/);
  await expect(page.getByRole('button', { name: /Nippon Kendo Kata/ })).toBeVisible();
  await workspaceLink(page, 'Dashboard').click();
  await workspaceLink(page, 'Mitori room').click();
  await expect(page.getByRole('heading', { name: 'Mitori', exact: true })).toBeVisible();
  expect(harness.apiCalls.filter((call) => call.method !== 'GET')).toEqual([]);
});

test('Mitori room stays accessible and within narrow and desktop viewports', async ({
  page,
}, testInfo) => {
  await page.goto('/app/guest/mitori-room');
  const notice = page.getByRole('complementary', { name: 'Cookie notice' });
  if (await notice.isVisible()) await notice.getByRole('button', { name: 'Got it' }).click();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('mitori-room.png'), fullPage: true });
  for (const width of [320, 414, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await expect(workspaceLink(page, 'Mitori room')).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Mitori room sections' })
      .getByRole('link', { name: 'Glossary' })
      .click();
    await expect(page.getByRole('searchbox', { name: 'Find a term' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
});
