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

test('sign-in artwork keeps the brand top-left and the heading middle-left', async ({
  page,
}, testInfo) => {
  await SyntheticManagedHarness.install(page);
  await page.goto('/app/sign-in');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  const notice = page.getByRole('complementary', { name: 'Cookie notice' });
  if (await notice.isVisible()) await notice.getByRole('button', { name: 'Got it' }).click();
  const story = page.locator('.auth-story');
  const layout = await story.evaluate((element) => {
    const title = element.querySelector('h1');
    const brand = element.querySelector('.brand-lockup');
    if (title === null || brand === null) throw new Error('Expected sign-in story content.');
    const box = element.getBoundingClientRect();
    const titleBox = title.getBoundingClientRect();
    const brandBox = brand.getBoundingClientRect();
    const panel = document.querySelector('.auth-panel');
    const panelRegion = document.querySelector('.auth-panel-region');
    if (panel === null || panelRegion === null)
      throw new Error('Expected the sign-in options panel.');
    return {
      titleCenter: titleBox.top + titleBox.height / 2,
      storyCenter: box.top + box.height / 2,
      titleTop: titleBox.top,
      brandBottom: brandBox.bottom,
      titleLeft: titleBox.left,
      brandLeft: brandBox.left,
      background: getComputedStyle(element).backgroundImage,
      fits: element.scrollWidth <= element.clientWidth,
      titleFontSize: Number.parseFloat(getComputedStyle(title).fontSize),
      storyProportion: box.height / (box.height + panelRegion.getBoundingClientRect().height),
      bottomSpace: document.documentElement.scrollHeight - panel.getBoundingClientRect().bottom,
    };
  });
  expect(Math.abs(layout.titleCenter - layout.storyCenter)).toBeLessThanOrEqual(1);
  expect(layout.brandBottom).toBeLessThan(layout.titleTop);
  expect(layout.titleLeft).toBe(layout.brandLeft);
  expect(layout.background).toContain('/assets/kendomenu-sign-in-1600.jpeg');
  expect(layout.fits).toBe(true);
  if (testInfo.project.name === 'mobile-chrome') {
    expect(layout.titleFontSize).toBeGreaterThanOrEqual(46);
    expect(layout.titleFontSize).toBeLessThanOrEqual(64);
    expect(layout.storyProportion).toBeCloseTo(0.5, 1);
    expect(layout.bottomSpace).toBeLessThanOrEqual(17);
  }
  await page.screenshot({ path: testInfo.outputPath('sign-in.png') });
});

test('landing previews have centered gold-gradient cards and the mobile hero has no image gap', async ({
  page,
}, testInfo) => {
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Plan the keiko you need today' })).toBeVisible();
  const heroCoverage = await page.locator('.landing-hero img').evaluate((image) => {
    const section = image.closest('.landing-page');
    if (section === null) throw new Error('Expected the hero section.');
    const imageBox = image.getBoundingClientRect();
    const sectionBox = section.getBoundingClientRect();
    return {
      topGap: imageBox.top - sectionBox.top,
      bottomGap: sectionBox.bottom - imageBox.bottom,
    };
  });
  expect(heroCoverage.topGap).toBeLessThanOrEqual(1);
  expect(heroCoverage.bottomGap).toBeLessThanOrEqual(1);

  const preview = page.locator('.landing-menu-preview');
  await expect(preview).toHaveCSS('text-align', 'center');
  const cards = preview.locator('.landing-menu-teaser');
  await expect(cards).toHaveCount(3);
  for (const card of await cards.all()) {
    await expect(card).toHaveCSS('align-items', 'center');
    await expect(card).toHaveCSS('text-align', 'center');
    await expect(card.locator('h4')).toHaveCSS('text-transform', 'uppercase');
    expect(await card.evaluate((element) => getComputedStyle(element).backgroundImage)).toContain(
      'linear-gradient',
    );
  }
  const notice = page.getByRole('complementary', { name: 'Cookie notice' });
  if (await notice.isVisible()) await notice.getByRole('button', { name: 'Got it' }).click();
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('menu-previews.png') });
});

async function openLandingNavigation(page: Page) {
  const openButton = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await openButton.isVisible()) await openButton.click();
  return page.getByRole('navigation', { name: 'Landing navigation' });
}

test('landing navigation offers Get started and the sign-in page is Google-only', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app');

  const landingNavigation = await openLandingNavigation(page);
  const links = landingNavigation.getByRole('link');
  await expect(links).toHaveCount(4);
  await expect(links.nth(0)).toHaveText('How it works');
  await expect(links.nth(0)).toHaveAttribute('href', '/app#how-it-works-title');
  await expect(links.nth(1)).toHaveText('Library info');
  await expect(links.nth(1)).toHaveAttribute('href', '/app#library-story-title');
  await expect(links.nth(2)).toHaveText('FAQ');
  await expect(links.nth(2)).toHaveAttribute('href', '/app#faq-title');
  await expect(links.nth(3)).toHaveText('Get started');
  await expect(links.nth(3)).toHaveAttribute('href', '/app/sign-in');
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toHaveCount(0);
  await expect(page.getByRole('contentinfo', { name: 'Site footer' })).toBeVisible();

  await links.nth(1).click();
  await expect(page).toHaveURL(/\/app#library-story-title$/);
  await expect(page.locator('#library-story-title')).toBeInViewport();

  await links.nth(3).click();
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Prepare for keiko', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'KendoMenu', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Sign-in options', exact: true })).toBeVisible();
  await expect(page.getByText(ALTERNATIVE_SIGN_IN_MESSAGE, { exact: true })).toBeVisible();
  await expect(page.getByLabel(/email|password/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /email|password|github/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.locator('.auth-google-icon')).toBeVisible();
  await expect(page.locator('.auth-google-button')).toHaveCSS('background-color', 'rgb(5, 9, 15)');
  await expect(page.getByRole('contentinfo', { name: 'Site footer' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Continue as a guest' })).toHaveAttribute(
    'href',
    '/app/guest/dashboard',
  );

  await page.getByRole('link', { name: 'Continue as a guest' }).click();
  await expect(page).toHaveURL(/\/app\/guest\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('contentinfo', { name: 'Site footer' })).toHaveCount(0);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/app/sign-in');
  await expect(page.getByRole('heading', { name: 'Prepare for keiko', exact: true })).toBeVisible();
  await expect(page.locator('.auth-story .brand-name')).toHaveText('KendoMenu');
  await expect(page.locator('.auth-story .brand-name')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('landing mobile header shows the full brand', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/app');
  await expect(page.locator('.top-bar .brand-name')).toBeVisible();
  await expect(page.locator('.top-bar .brand-name')).toHaveText('KendoMenu');
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
      .getByRole('region', { name: 'Sign-in options', exact: true })
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
  await expect(userOptions).toHaveCSS('background-color', 'rgb(3, 13, 28)');
  await expect(userOptions).toContainText('Guest mode');
  await expect(userOptions.getByRole('status', { name: 'Saved on this device' })).toBeVisible();
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
  expect(mobileMetrics.labels).toHaveLength(4);
  expect(mobileMetrics.labels[0]?.left).toBeLessThan(mobileMetrics.labels[1]?.left ?? 0);
  expect(mobileMetrics.labels[1]?.left).toBeLessThan(mobileMetrics.labels[2]?.left ?? 0);

  const mobileUserButton = mobileNavigation.getByRole('button', { name: 'User', exact: true });
  await mobileUserButton.click();
  const mobileUserOptions = page.getByRole('region', { name: 'User options' });
  await expect(mobileUserOptions).toBeVisible();
  await expect
    .poll(() =>
      mobileUserOptions.evaluate((element) => ({
        backgroundColor: getComputedStyle(element).backgroundColor,
        borderColor: getComputedStyle(element).borderTopColor,
      })),
    )
    .toEqual({
      backgroundColor: 'rgb(3, 13, 28)',
      borderColor: 'rgba(200, 155, 60, 0.48)',
    });
  await expect(mobileUserOptions).toContainText('Guest mode');
  await expect(
    mobileUserOptions.getByRole('status', { name: 'Saved on this device' }),
  ).toBeVisible();
  await expect(mobileUserOptions.locator('.session-status-label')).toBeVisible();
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

test('verified User options show identity, cloud save status, and sign-out', async ({ page }) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await page.goto('/app/account/dashboard');
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();

  const callsBefore = harness.apiCalls.length;
  const userOptions = await openUserOptions(page);
  await expect(userOptions).toContainText('practitioner@example.test');
  const signOut = userOptions.getByRole('button', { name: 'Sign out', exact: true });
  await expect(signOut).toBeVisible();
  await expect(signOut).toHaveClass(/primary-button/u);
  await expect(
    userOptions.getByRole('status', { name: 'Cloud save status: Saved on the cloud' }),
  ).toBeVisible();
  await expect(userOptions.getByRole('button', { name: 'Delete account' })).toHaveCount(0);
  await expect(userOptions).not.toContainText('Coming soon');
  expect(harness.apiCalls).toHaveLength(callsBefore);
  expect(harness.apiCalls.some((call) => call.method === 'DELETE')).toBe(false);

  await clickWorkspaceSignOut(page);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Plan the keiko you need today' })).toBeVisible();
});

test('verified landing shows the account dashboard actions', async ({ page }) => {
  await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await page.goto('/app');

  const heroActions = page.locator('.landing-entry-actions');
  await expect(heroActions.getByRole('link')).toHaveCount(1);
  await expect(
    heroActions.getByRole('link', { name: 'Back to your dashboard', exact: true }),
  ).toHaveAttribute('href', '/app/account/dashboard');
  await expect(
    page.getByRole('link', { name: 'Continue to your dashboard', exact: true }),
  ).toHaveAttribute('href', '/app/account/dashboard');
  await expect(page.getByRole('link', { name: 'Try without an account' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign up here' })).toHaveCount(0);
});

test('unsaved account warning sits below dashboard controls and above the menu cards', async ({
  page,
}) => {
  await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await page.goto('/app/account/dashboard');
  await workspaceLink(page, 'Library').click();
  await page.locator('.library-card').first().getByRole('link', { name: 'View session' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add to dashboard' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'View dashboard' }).click();

  const warning = page.locator('.dashboard-draft-warning');
  await expect(warning).toBeVisible();
  await expect(warning.getByRole('button', { name: 'Download draft' })).toBeVisible();
  const [header, banner, card] = await Promise.all([
    page.locator('.dashboard-page-header').boundingBox(),
    warning.boundingBox(),
    page.locator('.dashboard-card--compact').first().boundingBox(),
  ]);
  if (header === null || banner === null || card === null)
    throw new Error('Expected dashboard layout.');
  expect(banner.y).toBeGreaterThanOrEqual(header.y + header.height);
  expect(card.y).toBeGreaterThanOrEqual(banner.y + banner.height);
});
