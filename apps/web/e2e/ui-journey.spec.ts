import { expect, type Page } from '@playwright/test';

import { test } from './guest-test';
import { SyntheticManagedHarness } from './synthetic-managed-harness';
import {
  clickWorkspaceSignOut,
  openUserOptions,
  workspaceLink,
  workspaceNavigation,
} from './workspace-test-helpers';

const ALTERNATIVE_SIGN_IN_MESSAGE =
  'Option to sign in with a different email provider and your own password to be implemented soon';

async function openLandingNavigation(page: Page) {
  const openButton = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await openButton.isVisible()) await openButton.click();
  return page.getByRole('navigation', { name: 'Landing navigation' });
}

test('landing navigation stays informational and the sign-in page is Google-only', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app');

  const landingNavigation = await openLandingNavigation(page);
  const links = landingNavigation.getByRole('link');
  await expect(links).toHaveCount(3);
  await expect(links.nth(0)).toHaveText('How it works');
  await expect(links.nth(0)).toHaveAttribute('href', '/app#how-it-works-title');
  await expect(links.nth(1)).toHaveText('Keiko menus');
  await expect(links.nth(1)).toHaveAttribute('href', '/app#library-story-title');
  await expect(links.nth(2)).toHaveText('FAQ');
  await expect(links.nth(2)).toHaveAttribute('href', '/app#faq-title');
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toHaveCount(0);

  await links.nth(1).click();
  await expect(page).toHaveURL(/\/app#library-story-title$/);
  await expect(page.locator('#library-story-title')).toBeInViewport();

  await page.getByRole('link', { name: 'Sign up here', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Enter the dojo', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'KendoMenu', exact: true })).toBeVisible();
  await expect(page.getByText(ALTERNATIVE_SIGN_IN_MESSAGE, { exact: true })).toBeVisible();
  await expect(page.getByLabel(/email|password/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /email|password|github/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue as a guest' })).toHaveAttribute(
    'href',
    '/app/guest/dashboard',
  );

  await page.getByRole('link', { name: 'Continue as a guest' }).click();
  await expect(page).toHaveURL(/\/app\/guest\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/app/sign-in');
  await expect(page.getByRole('heading', { name: 'Enter the dojo', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('the established Google redirect from the public sign-in page reaches the verified account', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page);
  await page.goto('/app/sign-in');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();

  await expect(page).toHaveURL(/\/app\/account\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  expect(harness.authCalls.some((url) => url.includes('/sign-in/social'))).toBe(true);
  expect(harness.authCalls.some((url) => url.includes('/get-session'))).toBe(true);
  expect(harness.apiCalls.some((call) => call.path === '/api/account')).toBe(true);
  expect(harness.apiCalls.some((call) => call.path === '/api/dashboard')).toBe(true);
});

for (const cancellationEvent of ['pageshow', 'kendomenu:sign-in-cancelled'] as const) {
  test(`public sign-in resets its pending button after ${cancellationEvent}`, async ({ page }) => {
    await SyntheticManagedHarness.install(page);
    let releaseSignIn: (() => void) | undefined;
    let signInObserved: (() => void) | undefined;
    const heldSignIn = new Promise<void>((resolve) => {
      releaseSignIn = resolve;
    });
    const observed = new Promise<void>((resolve) => {
      signInObserved = resolve;
    });
    let attempts = 0;
    await page.route('**/sign-in/social', async (route) => {
      attempts += 1;
      signInObserved?.();
      await heldSignIn;
      await route.fulfill({ status: 503, json: { message: 'Synthetic provider failure' } });
    });
    await page.goto('/app/sign-in');
    const continueButton = page
      .getByRole('region', { name: 'KendoMenu', exact: true })
      .getByRole('button');
    await continueButton.click();
    await observed;
    await expect(continueButton).toBeDisabled();
    await expect(continueButton).toHaveText('Opening Google…');

    await page.evaluate(
      (eventName) => window.dispatchEvent(new Event(eventName)),
      cancellationEvent,
    );
    await expect(continueButton).toBeEnabled();
    await expect(continueButton).toHaveText('Continue with Google');

    releaseSignIn?.();
    await expect(continueButton).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await continueButton.click();
    await expect.poll(() => attempts).toBe(2);
    await expect(page.getByRole('alert')).toContainText('Google sign-in could not be started');
    await expect(continueButton).toBeEnabled();
  });
}

test('guest workspace navigation works on desktop and mobile and preserves content clearance', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/guest/dashboard');
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  const cookieNotice = page.getByRole('complementary', { name: 'Cookie notice' });
  if (await cookieNotice.isVisible()) {
    await cookieNotice.getByRole('button', { name: 'Got it' }).click();
  }

  const navigation = workspaceNavigation(page);
  await expect(navigation).toBeVisible();
  await expect(workspaceLink(page, 'Dashboard')).toHaveAttribute('aria-current', 'page');
  await expect(workspaceLink(page, 'Library')).not.toHaveAttribute('aria-current', 'page');
  await expect(navigation.getByRole('button', { name: 'User', exact: true })).toBeVisible();
  await expect(navigation).toHaveCSS('position', 'fixed');

  const homeLink = page
    .locator('.workspace-desktop-brand')
    .getByRole('link', { name: 'KendoMenu home', exact: true });
  await expect(homeLink).toHaveAttribute('href', '/app');

  const userButton = navigation.getByRole('button', { name: 'User', exact: true });
  await userButton.focus();
  await page.keyboard.press('Enter');
  const userOptions = page.getByRole('region', { name: 'User options' });
  await expect(userOptions).toBeVisible();
  await expect(userOptions).toContainText('Guest mode');
  await expect(userOptions.getByRole('link', { name: 'Sign up', exact: true })).toHaveAttribute(
    'href',
    '/app/sign-in',
  );
  await page.keyboard.press('Escape');
  await expect(userOptions).toBeHidden();
  await expect(userButton).toBeFocused();

  await userButton.click();
  await expect(userOptions).toBeVisible();
  await workspaceLink(page, 'Library').click();
  await expect(userOptions).toBeHidden();
  await expect(page).toHaveURL(/\/app\/guest\/library$/);
  await expect(page.getByRole('heading', { name: 'Keiko library', exact: true })).toBeVisible();
  await expect(workspaceLink(page, 'Library')).toHaveAttribute('aria-current', 'page');
  await expect(workspaceLink(page, 'Dashboard')).not.toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/guest\/dashboard$/);
  await expect(userOptions).toBeHidden();
  await expect(workspaceLink(page, 'Dashboard')).toHaveAttribute('aria-current', 'page');
  await page.goForward();
  await expect(page).toHaveURL(/\/app\/guest\/library$/);
  await expect(workspaceLink(page, 'Library')).toHaveAttribute('aria-current', 'page');

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/app/guest/library');
  const mobileNavigation = workspaceNavigation(page);
  await expect(mobileNavigation).toBeVisible();
  const mobileMetrics = await mobileNavigation.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const labels = [...element.querySelectorAll<HTMLElement>('li')].map((item) => {
      const bounds = item.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
    });
    return {
      position: getComputedStyle(element).position,
      top: rect.top,
      bottom: rect.bottom,
      labels,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(mobileMetrics.position).toBe('fixed');
  expect(mobileMetrics.bottom).toBeLessThanOrEqual(812);
  expect(mobileMetrics.top).toBeGreaterThan(812 - 140);
  expect(mobileMetrics.scrollWidth).toBeLessThanOrEqual(375);
  expect(mobileMetrics.labels).toHaveLength(3);
  expect(mobileMetrics.labels[0]?.left).toBeLessThan(mobileMetrics.labels[1]?.left ?? 0);
  expect(mobileMetrics.labels[1]?.left).toBeLessThan(mobileMetrics.labels[2]?.left ?? 0);

  const mobileUserButton = mobileNavigation.getByRole('button', { name: 'User', exact: true });
  await mobileUserButton.click();
  const mobileUserOptions = page.getByRole('region', { name: 'User options' });
  await expect(mobileUserOptions).toBeVisible();
  await expect(mobileUserOptions).toContainText('Guest mode');
  await page.keyboard.press('Escape');
  await expect(mobileUserOptions).toBeHidden();
  await expect(mobileUserButton).toBeFocused();

  const card = page.locator('.library-card').first();
  await card.getByRole('link', { name: 'View session' }).click();
  await page.getByRole('button', { name: 'Add to dashboard', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'View dashboard' }).click();
  const finalDashboardCard = page.locator('.dashboard-card--compact').last();
  await finalDashboardCard.scrollIntoViewIfNeeded();
  const [cardBox, navBox] = await Promise.all([
    finalDashboardCard.boundingBox(),
    mobileNavigation.boundingBox(),
  ]);
  if (cardBox === null || navBox === null) throw new Error('Expected the mobile card and nav.');
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(navBox.y);
});

test('verified User options show identity and safe account actions only', async ({ page }) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await page.goto('/app/account/dashboard');
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();

  const callsBefore = harness.apiCalls.length;
  const userOptions = await openUserOptions(page);
  await expect(userOptions).toContainText('practitioner@example.test');
  await expect(userOptions.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  const deleteButton = userOptions.getByRole('button', { name: 'Delete account', exact: true });
  await expect(deleteButton).toBeDisabled();
  await expect(userOptions).toContainText('Coming soon');
  expect(harness.apiCalls).toHaveLength(callsBefore);
  expect(harness.apiCalls.some((call) => call.method === 'DELETE')).toBe(false);

  await clickWorkspaceSignOut(page);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Plan the keiko you need today' })).toBeVisible();
});
