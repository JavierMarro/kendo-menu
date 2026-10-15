import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { SyntheticManagedHarness } from './synthetic-managed-harness';
import { clickWorkspaceSignOut } from './workspace-test-helpers';

async function addAccountMenu(page: Page): Promise<void> {
  await page.goto('/app/account/dashboard');
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await page
    .getByRole('main')
    .getByRole('link', { name: /Browse Keiko library/i })
    .click();
  await page.getByRole('main').getByRole('link', { name: 'View session' }).first().click();
  await page.getByRole('button', { name: 'Add to dashboard', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'View dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Save to account' }).click();
  await expect(page.getByText('Saved to account', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View more' }).first().click();
}

async function hideAndRevealAccount(page: Page, context: BrowserContext): Promise<void> {
  await context.setOffline(true);
  await expect(page.getByRole('heading', { name: 'Account service unavailable' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'International dojo menu' })).toBeHidden();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Retry connection' }).click();
  const dialog = page.getByRole('dialog', { name: 'International dojo menu' });
  if (!(await dialog.isVisible())) {
    await page.getByRole('button', { name: 'View more' }).first().click();
  }
  await expect(dialog).toBeVisible();
}

test('unfinished quantity input warns on sign-out even with a saved account dashboard', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await addAccountMenu(page);
  await page.getByLabel('Repetitions for Kirikaeshi').fill('501');
  await page
    .getByRole('dialog', { name: 'International dojo menu' })
    .getByRole('button', { name: /^Close / })
    .click();
  await clickWorkspaceSignOut(page);
  const warning = page.getByRole('alertdialog', { name: /Leave this account/i });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await page.getByRole('button', { name: 'View more' }).first().click();
  await expect(page.getByLabel('Repetitions for Kirikaeshi')).toHaveValue('501');
  expect(harness.apiCalls.filter((call) => call.method === 'PUT')).toHaveLength(1);
});

test('unblurred account editor values survive offline hiding and same-tab reconnect', async ({
  page,
  context,
}) => {
  await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await addAccountMenu(page);

  const sessionNotes = page.getByLabel('Practice notes');
  await sessionNotes.fill('Keep the pace calm.');
  await hideAndRevealAccount(page, context);
  await expect(page.getByLabel('Practice notes')).toHaveValue('Keep the pace calm.');

  const activityToggle = page.getByRole('button', { name: 'Any extra details?' }).first();
  await activityToggle.click();
  const activityNotes = page.getByLabel('Extra notes for Warm-up');
  await activityNotes.fill('Relax the shoulders.');
  await hideAndRevealAccount(page, context);
  await page.getByRole('button', { name: 'Any extra details?' }).first().click();
  await expect(page.getByLabel('Extra notes for Warm-up')).toHaveValue('Relax the shoulders.');

  const quantity = page.getByLabel('Minutes for Warm-up');
  await quantity.fill('12');
  await hideAndRevealAccount(page, context);
  await expect(page.getByLabel('Minutes for Warm-up')).toHaveValue('12');
});

test('offline download stays unavailable until an unfinished quantity is completed', async ({
  page,
  context,
}) => {
  await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await addAccountMenu(page);

  const quantity = page.getByLabel('Repetitions for Kirikaeshi');
  await quantity.fill('501');
  await context.setOffline(true);
  await expect(page.getByRole('heading', { name: 'Account service unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download draft' })).toBeDisabled();
  await expect(
    page.getByText(/complete or clear the unfinished quantity field before downloading/i),
  ).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Retry connection' }).click();
  const dialog = page.getByRole('dialog', { name: 'International dojo menu' });
  if (!(await dialog.isVisible())) {
    await page.getByRole('button', { name: 'View more' }).first().click();
  }
  const restoredQuantity = page.getByLabel('Repetitions for Kirikaeshi');
  await expect(restoredQuantity).toHaveValue('501');
  await restoredQuantity.fill('400');
  await dialog.getByRole('button', { name: /^Close / }).click();
  await expect(page.getByRole('button', { name: 'Save to account' })).toBeEnabled();
});

test('an unblurred account editor survives held focus verification and same-account return', async ({
  page,
}) => {
  await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await addAccountMenu(page);

  const notes = page.getByLabel('Practice notes');
  await notes.fill('Keep this focused note through verification.');
  let releaseAccountCheck: (() => void) | undefined;
  let resolveAccountCheckSeen: (() => void) | undefined;
  const accountCheckSeen = new Promise<void>((resolve) => {
    resolveAccountCheckSeen = resolve;
  });
  const accountCheckRelease = new Promise<void>((resolve) => {
    releaseAccountCheck = resolve;
  });
  await page.route('**/api/account', async (route) => {
    if (route.request().method() === 'GET') {
      resolveAccountCheckSeen?.();
      await accountCheckRelease;
      await route.fallback();
      return;
    }
    await route.fallback();
  });

  try {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await accountCheckSeen;
    await expect(
      page.getByRole('heading', { name: /hidden until it can be verified/i }),
    ).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'International dojo menu' })).toBeHidden();
    releaseAccountCheck?.();
    await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
    const dialog = page.getByRole('dialog', { name: 'International dojo menu' });
    if (!(await dialog.isVisible())) {
      await page.getByRole('button', { name: 'View more' }).first().click();
    }
    await expect(page.getByLabel('Practice notes')).toHaveValue(
      'Keep this focused note through verification.',
    );
  } finally {
    releaseAccountCheck?.();
  }
});

test('an unblurred account editor change warns before navigating outside account routes', async ({
  page,
}) => {
  await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await page.goto('/app');
  await addAccountMenu(page);
  await page.getByLabel('Practice notes').fill('Unsaved focused note.');

  const dialogPromise = page.waitForEvent('dialog');
  const navigationPromise = page.evaluate(() => {
    const homeLink = document.querySelector<HTMLAnchorElement>('a[aria-label="KendoMenu home"]');
    homeLink?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const dialog = await dialogPromise;
  expect(dialog.message()).toMatch(/unsaved account changes|draft/i);
  await dialog.dismiss();
  await navigationPromise;
  await expect(page).toHaveURL(/\/app\/account\/dashboard$/);
});
