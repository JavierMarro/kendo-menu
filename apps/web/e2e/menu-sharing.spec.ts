import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { ACCOUNT_ID, OTHER_ACCOUNT_ID, SyntheticManagedHarness } from './synthetic-managed-harness';
import {
  CUSTOM_EDIT_DASHBOARD,
  CUSTOM_EDIT_ENTRY_ID,
  CUSTOM_EDIT_NAME,
} from './custom-menu-edit-fixture';
import { workspaceLink } from './workspace-test-helpers';

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
  // Mirror the hosting rewrite while keeping the real shared URL in the browser.
  await page.route(`**/app/shared/${TOKEN}`, async (route) => {
    const url = new URL('/shared-menu.html', route.request().url()).href;
    await route.fulfill({ response: await route.fetch({ url }) });
  });
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
    const preview = page.getByRole('article', { name: SHARED.name });
    await preview.getByText('Main practice', { exact: true }).click();
    const quantities = preview.getByRole('list', { name: 'Quantities for Men' });
    await expect(quantities.getByRole('listitem')).toHaveText([
      '24 repetitions',
      '30 seconds',
      '2 minutes',
    ]);
    if (setup === 'existing') {
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        page.viewportSize()?.width ?? 0,
      );
      const scan = await new AxeBuilder({ page }).analyze();
      expect(
        scan.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical'),
      ).toEqual([]);
      await preview.screenshot({ path: testInfo.outputPath('shared-preview.png') });
    }
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

for (const failure of ['unauthenticated', 'different workspace'] as const) {
  test(`recipient response for ${failure} hides the current dashboard until verification`, async ({
    page,
  }) => {
    const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
    harness.setDashboard(CUSTOM_EDIT_DASHBOARD, '1');
    await page.route(`**/api/shares/${TOKEN}/recipient`, (route) =>
      route.fulfill(
        failure === 'unauthenticated'
          ? { status: 401, json: { error: 'UNAUTHENTICATED' } }
          : { json: { snapshot: SHARED, isSender: false, accountWorkspaceId: OTHER_ACCOUNT_ID } },
      ),
    );
    await page.goto(`/app/account/shared/${TOKEN}`);
    await dismissNotice(page);
    const hidden = page.getByRole('heading', {
      name: 'Your account is hidden until it can be verified.',
    });
    await expect(hidden).toBeVisible();
    await workspaceLink(page, 'Dashboard').click();
    await expect(hidden).toBeVisible();
    const savedMenu = page.getByRole('heading', { name: CUSTOM_EDIT_NAME, exact: true });
    await expect(savedMenu).toBeHidden();
    await expect(page.getByRole('button', { name: 'Save to account', exact: true })).toBeHidden();
    const checks = harness.apiCalls.filter((call) => call.path === '/api/account').length;
    await page.getByRole('button', { name: 'Retry verification' }).click();
    await expect(savedMenu).toBeVisible();
    expect(harness.apiCalls.filter((call) => call.path === '/api/account')).toHaveLength(
      checks + 1,
    );
    expect(harness.apiCalls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });
}

test('a public preview retries a temporary failure in place and distinguishes a missing link', async ({
  page,
}) => {
  await SyntheticManagedHarness.install(page, { initiallySignedIn: false });
  await installShareRoutes(page);
  let status = 404;
  const reads: number[] = [];
  await page.route(`**/api/shares/${TOKEN}`, async (route) => {
    reads.push(status);
    await route.fulfill({
      status,
      json:
        status === 200
          ? { snapshot: SHARED }
          : { error: status === 404 ? 'SHARE_NOT_FOUND' : 'SHARE_UNAVAILABLE' },
    });
  });
  await page.goto(`/app/shared/${TOKEN}`);
  await dismissNotice(page);
  const retry = page.getByRole('button', { name: 'Retry loading menu' });
  await expect(page.getByText(/link may be invalid/i)).toBeVisible();
  await expect(retry).toHaveCount(0);
  status = 503;
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('The shared menu could not be loaded.');
  status = 200;
  await retry.click();
  await expect(page.getByRole('heading', { name: SHARED.name, exact: true })).toBeVisible();
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    'content',
    'https://www.kendomenu.com/app',
  );
  expect(reads).toEqual([404, 503, 200]);
});

test('retrying a recipient read preserves unrelated unsaved dashboard edits', async ({ page }) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  harness.setDashboard(CUSTOM_EDIT_DASHBOARD, '1');
  let reads = 0;
  let unavailable = true;
  await page.route(`**/api/shares/${TOKEN}/recipient`, async (route) => {
    reads += 1;
    await route.fulfill(
      unavailable
        ? { status: 503, json: { error: 'SHARE_UNAVAILABLE' } }
        : { json: { snapshot: SHARED, isSender: false, accountWorkspaceId: ACCOUNT_ID } },
    );
  });
  const recipientPath = `/app/account/shared/${TOKEN}`;
  await page.goto(recipientPath);
  await dismissNotice(page);
  const retry = page.getByRole('button', { name: 'Retry loading menu' });
  await expect(retry).toBeVisible();
  await workspaceLink(page, 'Dashboard').click();
  const savedCard = page.getByRole('article').filter({
    has: page.getByRole('heading', { name: CUSTOM_EDIT_NAME, exact: true }),
  });
  await savedCard.getByRole('button', { name: 'View more' }).click();
  const notes = page.getByLabel('Practice notes');
  await notes.fill('An unrelated draft note');
  await notes.blur();
  await page.getByRole('button', { name: /Close .* details/i }).click();
  await page.goBack();
  await expect(page).toHaveURL(recipientPath);
  await expect(retry).toBeVisible();
  const calls = harness.apiCalls.length;
  unavailable = false;
  await retry.click();
  await expect(
    page.getByRole('button', { name: 'Add to my dashboard', exact: true }),
  ).toBeEnabled();
  expect(reads).toBe(3);
  expect(harness.apiCalls).toHaveLength(calls);
  await workspaceLink(page, 'Dashboard').click();
  await expect(page.getByRole('heading', { name: SHARED.name, exact: true })).toHaveCount(0);
  await savedCard.getByRole('button', { name: 'View more' }).click();
  await expect(notes).toHaveValue('An unrelated draft note');
  expect(harness.apiCalls.filter((call) => call.method === 'PUT')).toHaveLength(0);
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
