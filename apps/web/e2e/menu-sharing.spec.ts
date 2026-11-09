import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { ACCOUNT_ID, SyntheticManagedHarness } from './synthetic-managed-harness';
import {
  CUSTOM_EDIT_DASHBOARD,
  CUSTOM_EDIT_ENTRY_ID,
  CUSTOM_EDIT_NAME,
} from './custom-menu-edit-fixture';

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

const TOKEN = 's'.repeat(43);
const SHARED = {
  version: 1,
  name: 'A friend’s keiko',
  customIntensity: 'high-intensity-drill',
  sections: [
    {
      name: 'Main practice',
      exercises: [
        {
          name: 'Men',
          quantities: { repetitions: 24, duration: { unit: 'seconds', value: 30 } },
          additionalDuration: { unit: 'minutes', value: 2 },
        },
      ],
    },
  ],
};

async function dismissNotice(page: Page) {
  const notice = page.getByRole('complementary', { name: 'Cookie notice' });
  if (await notice.isVisible()) await notice.getByRole('button', { name: 'Got it' }).click();
}

async function installShareRoutes(page: Page) {
  await page.route(`**/api/shares/${TOKEN}`, (route) =>
    route.fulfill({ json: { snapshot: SHARED } }),
  );
  await page.route(`**/api/shares/${TOKEN}/recipient`, (route) =>
    route.fulfill({ json: { snapshot: SHARED, isSender: false, accountWorkspaceId: ACCOUNT_ID } }),
  );
}

for (const setup of ['existing', 'decline', 'copy'] as const) {
  test(`shared preview returns through ${setup} sign-in and saves an editable independent copy`, async ({
    page,
  }, testInfo) => {
    const harness = await SyntheticManagedHarness.install(page, {
      initiallySignedIn: false,
      initiallyUninitialized: setup !== 'existing',
      createdAccount: setup !== 'existing',
    });
    await installShareRoutes(page);
    await page.goto('/app');
    const guestBytes = JSON.stringify(CUSTOM_EDIT_DASHBOARD);
    await page.evaluate((value) => localStorage.setItem('kendo-menu', value), guestBytes);
    await page.goto(`/app/shared/${TOKEN}`);
    await dismissNotice(page);
    await expect(page.getByRole('heading', { name: SHARED.name, exact: true })).toBeVisible();
    await expect(page.getByText('30 seconds · 2 minutes')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add to my dashboard', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign in to add', exact: true }).click();
    if (setup !== 'existing') {
      await expect(
        page.getByRole('heading', { name: 'Copy your guest menus to your account?' }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: setup === 'copy' ? 'Copy menus' : 'No, thanks', exact: true })
        .click();
      await page.getByRole('button', { name: 'Continue to account', exact: true }).click();
    }
    await expect(page).toHaveURL(`/app/account/shared/${TOKEN}`);
    await dismissNotice(page);
    await page.getByRole('button', { name: 'Add to my dashboard', exact: true }).click();
    await expect(
      page.getByText('Added to your dashboard. Save to account to keep this menu.'),
    ).toBeVisible();
    expect(harness.apiCalls.filter((call) => call.method === 'PUT')).toHaveLength(0);
    await dismissNotice(page);
    await page.getByRole('link', { name: 'View dashboard', exact: true }).click();
    await page.getByLabel('Filter sessions').selectOption('shared');
    const received = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: SHARED.name, exact: true }) });
    await expect(received.getByText('Shared', { exact: true })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(1);
    await page.getByRole('button', { name: 'Save to account', exact: true }).click();
    await expect(page.getByText('Saved to account', { exact: true }).first()).toBeVisible();
    await page.reload();
    await page.getByLabel('Filter sessions').selectOption('shared');
    await expect(received).toBeVisible();
    await received.getByRole('button', { name: 'View more' }).click();
    await page.getByRole('link', { name: 'Edit menu', exact: true }).click();
    await page.getByLabel('Session name').fill('My adapted keiko');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByLabel('Filter sessions').selectOption('shared');
    await expect(
      page.getByRole('heading', { name: 'My adapted keiko', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestBytes);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()?.width ?? 0,
    );
    const scan = await new AxeBuilder({ page }).analyze();
    expect(
      scan.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical'),
    ).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('received-menu.png'), fullPage: true });
  });
}

test('only account custom cards offer sharing and keyboard dismissal returns focus', async ({
  page,
}, testInfo) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  harness.setDashboard(CUSTOM_EDIT_DASHBOARD, '1');
  const creates: unknown[] = [];
  await page.route('**/api/shares', async (route) => {
    creates.push(route.request().postDataJSON());
    await route.fulfill({
      json: { token: TOKEN, sourceRevision: '1', accountWorkspaceId: ACCOUNT_ID },
    });
  });
  await page.goto('/app/account/dashboard');
  await dismissNotice(page);
  await expect(page.getByRole('button', { name: 'Share it!', exact: true })).toHaveCount(1);
  const trigger = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: CUSTOM_EDIT_NAME, exact: true }) })
    .getByRole('button', { name: 'Share it!' });
  await trigger.focus();
  await trigger.press('Enter');
  await expect(page.getByText(/This shares your last saved version/)).toBeVisible();
  await page.getByRole('button', { name: 'Create sharing link', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Sharing link' })).toHaveValue(
    new RegExp(`/app/shared/${TOKEN}$`),
  );
  await expect(page.getByRole('textbox', { name: 'Sharing link' })).toBeFocused();
  expect(creates).toEqual([
    {
      expectedAccountWorkspaceId: ACCOUNT_ID,
      expectedRevision: '1',
      entryId: CUSTOM_EDIT_ENTRY_ID,
    },
  ]);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(
    scan.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical'),
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('share-dialog.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.getByLabel('Filter sessions').selectOption('shared');
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('signed-in visitors can preview even when their dashboard is unavailable', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  harness.setDashboardUnavailable(true);
  await installShareRoutes(page);
  await page.goto(`/app/shared/${TOKEN}`);
  await expect(page.getByRole('heading', { name: SHARED.name, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue to add this menu' })).toBeVisible();
  expect(harness.apiCalls.filter((call) => call.path === '/api/dashboard')).toHaveLength(0);
});

test('signed-out recipient routes return to the public preview', async ({ page }) => {
  await SyntheticManagedHarness.install(page, { initiallySignedIn: false });
  await installShareRoutes(page);
  await page.goto(`/app/account/shared/${TOKEN}`);
  await expect(page).toHaveURL(`/app/shared/${TOKEN}`);
  await expect(page.getByRole('heading', { name: SHARED.name, exact: true })).toBeVisible();
});

test('sharing can be dismissed with Escape while link creation is pending', async ({ page }) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  harness.setDashboard(CUSTOM_EDIT_DASHBOARD, '1');
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/shares', async (route) => {
    await gate;
    await route.fulfill({
      json: { token: TOKEN, sourceRevision: '1', accountWorkspaceId: ACCOUNT_ID },
    });
  });
  try {
    await page.goto('/app/account/dashboard');
    await dismissNotice(page);
    const trigger = page.getByRole('button', { name: 'Share it!', exact: true });
    await trigger.click();
    await page.getByRole('button', { name: 'Create sharing link', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Creating link…' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Share your keiko menu' })).toBeHidden();
    await expect(trigger).toBeFocused();
  } finally {
    release?.();
  }
});
