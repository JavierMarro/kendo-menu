import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import {
  ACCOUNT_ID,
  COPY_OPPORTUNITY_ID,
  SyntheticManagedHarness,
  type SyntheticApiCall,
} from './synthetic-managed-harness';

const GUEST_KEY = 'kendo-menu';

async function createGuestAndStartAccount(
  page: Page,
  harness: SyntheticManagedHarness,
): Promise<string> {
  await page.goto('/app/guest/dashboard');
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await page
    .getByRole('main')
    .getByRole('link', { name: /Create (new menu|a training session)/i })
    .click();
  await page.getByLabel('Session name').fill('Guest copy source');
  await page.getByLabel('Activity name').fill('Kamae');
  await page.getByLabel('Exercise name').fill('Suburi');
  await page.getByLabel('Repetitions').fill('12');
  await page.getByRole('button', { name: 'Save session to dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Guest copy source', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View more', exact: true }).click();
  await page.getByLabel('Practice notes').fill('Guest original note');
  await page.getByLabel('Practice notes').blur();
  await page.getByRole('button', { name: /Close .* details/i }).click();
  const guestBytes = await page.evaluate((key) => localStorage.getItem(key) ?? '', GUEST_KEY);
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/account\/setup$/);
  await expect(
    page.getByRole('heading', { name: 'Copy your guest menus to your account?', exact: true }),
  ).toBeVisible();
  expect(harness.apiCalls.some((call) => call.path === '/api/account')).toBe(true);
  return guestBytes;
}

function adoptionCalls(harness: SyntheticManagedHarness): SyntheticApiCall[] {
  return harness.apiCalls.filter((call) => call.path === '/api/dashboard/adoption');
}

function bodyOf(call: SyntheticApiCall | undefined): Record<string, unknown> {
  if (call === undefined) throw new Error('Expected an adoption request.');
  if (call.body === undefined) throw new Error('Expected an adoption request body.');
  const body: unknown = JSON.parse(call.body);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Expected an adoption request object.');
  }
  return body as Record<string, unknown>;
}

async function expectGuestBytesUnchanged(page: Page, before: string): Promise<void> {
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key) ?? '', GUEST_KEY))
    .toBe(before);
}

async function continueToAccount(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Continue to account' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to account' }).click();
  await expect(page).toHaveURL(/\/app\/account\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
}

test('a new account confirms one complete guest copy and keeps later edits separate', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallyUninitialized: true });
  const guestBytes = await createGuestAndStartAccount(page, harness);

  await expect(page.getByText('1 menu', { exact: false })).toBeVisible();
  const yes = page.getByRole('button', { name: 'Copy menus', exact: true });
  await yes.focus();
  await expect(yes).toBeFocused();
  await yes.press('Enter');
  await expect(page.getByRole('button', { name: 'Continue to account' })).toBeVisible();
  await expect(page.getByText('Your guest menus were copied to your account.')).toBeVisible();
  const requests = adoptionCalls(harness);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.method).toBe('POST');
  const request = bodyOf(requests[0]);
  expect(Object.keys(request).sort()).toEqual([
    'catalogueVersion',
    'copyOpportunityId',
    'dashboard',
    'decision',
    'expectedAccountWorkspaceId',
    'expectedRevision',
    'requestId',
    'transportVersion',
  ]);
  expect(request).toMatchObject({
    decision: 'yes',
    transportVersion: 1,
    expectedAccountWorkspaceId: ACCOUNT_ID,
    copyOpportunityId: COPY_OPPORTUNITY_ID,
    expectedRevision: '0',
    catalogueVersion: 'a'.repeat(64),
    dashboard: { version: 10 },
  });
  expect(typeof request['requestId']).toBe('string');
  const guest = JSON.parse(guestBytes) as { readonly state: unknown };
  expect(request['dashboard']).toEqual({ version: 10, state: guest.state });
  await continueToAccount(page);
  await expect(page.getByRole('heading', { name: 'Guest copy source', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View more', exact: true }).click();
  await expect(page.getByLabel('Practice notes')).toHaveValue('Guest original note');
  await page.getByLabel('Practice notes').fill('Account only edit');
  await page.getByLabel('Practice notes').blur();
  await page.getByRole('button', { name: /Close .* details/i }).click();
  await page.getByRole('button', { name: 'Save to account', exact: true }).click();
  await expect.poll(() => harness.apiCalls.filter((call) => call.method === 'PUT').length).toBe(1);
  await expect(page.getByText('Saved to account', { exact: true })).toBeVisible();
  await expectGuestBytesUnchanged(page, guestBytes);

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: /Leave this account/i })).toBeVisible();
  await page.getByRole('button', { name: /Discard and sign out/i }).click();
  await page.getByRole('link', { name: 'Continue as a guest' }).click();
  await expect(page).toHaveURL(/\/app\/guest\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Guest copy source', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View more', exact: true }).click();
  await expect(page.getByLabel('Practice notes')).toHaveValue('Guest original note');
  await expectGuestBytesUnchanged(page, guestBytes);
});

test('No sends the strict decline and preserves the guest dashboard', async ({
  page,
}, testInfo) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallyUninitialized: true });
  const guestBytes = await createGuestAndStartAccount(page, harness);

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('migration-d-setup.png') });
  const noThanks = page.getByRole('button', { name: 'No, thanks', exact: true });
  await noThanks.focus();
  await expect(noThanks).toBeFocused();
  await noThanks.press('Space');
  await expect(page.getByRole('button', { name: 'Continue to account' })).toBeVisible();
  const requests = adoptionCalls(harness);
  expect(requests).toHaveLength(1);
  expect(bodyOf(requests[0])).toMatchObject({
    decision: 'no',
    transportVersion: 1,
    expectedAccountWorkspaceId: ACCOUNT_ID,
    copyOpportunityId: COPY_OPPORTUNITY_ID,
  });
  const request = bodyOf(requests[0]);
  expect(Object.keys(request).sort()).toEqual([
    'copyOpportunityId',
    'decision',
    'expectedAccountWorkspaceId',
    'requestId',
    'transportVersion',
  ]);
  await continueToAccount(page);
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(0);
  await expectGuestBytesUnchanged(page, guestBytes);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: /Leave this account/i })).toBeVisible();
  await page.getByRole('button', { name: /Discard and sign out/i }).click();
  await page.getByRole('link', { name: 'Continue as a guest' }).click();
  await expect(page).toHaveURL(/\/app\/guest\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Guest copy source', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View more', exact: true }).click();
  await expect(page.getByLabel('Practice notes')).toHaveValue('Guest original note');
  await expectGuestBytesUnchanged(page, guestBytes);
});

test('a lost adoption acknowledgement stays unconfirmed after duplicate click and Back', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallyUninitialized: true });
  const guestBytes = await createGuestAndStartAccount(page, harness);
  const held = harness.holdNextAdoption();
  await page.getByRole('button', { name: 'Copy menus', exact: true }).click();
  await held.observed;
  await expect(
    page.getByRole('heading', { name: 'Loading your dashboard…', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy menus', exact: true })).toHaveCount(0);
  expect(adoptionCalls(harness)).toHaveLength(1);
  held.respond({ status: 0, body: null });
  await expect(
    page.getByRole('heading', { name: 'Choice not confirmed', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy menus', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'No, thanks', exact: true })).toHaveCount(0);
  const openNavigation = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await openNavigation.isVisible()) await openNavigation.click();
  await page
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Dashboard', exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/account\/dashboard$/);
  await page.getByRole('button', { name: 'View more', exact: true }).click();
  await page.getByLabel('Practice notes').fill('Unsaved account draft survives stale setup');
  await page.getByRole('button', { name: /Close .* details/i }).click();
  const readsBeforeBack = harness.apiCalls.filter(
    (call) => call.path === '/api/dashboard' && call.method === 'GET',
  ).length;
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/account\/dashboard$/);
  await expect(page.getByRole('button', { name: 'Copy menus', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'No, thanks', exact: true })).toHaveCount(0);
  expect(adoptionCalls(harness)).toHaveLength(1);
  expect(
    harness.apiCalls.filter((call) => call.path === '/api/dashboard' && call.method === 'GET'),
  ).toHaveLength(readsBeforeBack);
  await page.getByRole('button', { name: 'View more', exact: true }).click();
  await expect(page.getByLabel('Practice notes')).toHaveValue(
    'Unsaved account draft survives stale setup',
  );
  await expectGuestBytesUnchanged(page, guestBytes);
});

test('sign-out fences a late adoption acknowledgement and restores the guest source', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallyUninitialized: true });
  const guestBytes = await createGuestAndStartAccount(page, harness);
  const held = harness.holdNextAdoption();
  await page.getByRole('button', { name: 'Copy menus', exact: true }).click();
  const call = await held.observed;
  const requestId = bodyOf(call)['requestId'];
  if (typeof requestId !== 'string') throw new Error('Expected a request id.');

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: /Leave this account/i })).toBeVisible();
  await page.getByRole('button', { name: /Discard and sign out/i }).click();
  await expect(page).toHaveURL(/\/app$/);
  held.respond({
    status: 200,
    body: {
      status: 'accepted',
      completion: {
        decision: 'yes',
        requestId,
        acknowledgedRevision: '1',
        timestamp: '2026-10-07T10:00:00.000Z',
      },
      acknowledgement: {
        transportVersion: 1,
        accountWorkspaceId: ACCOUNT_ID,
        requestId,
        revision: '1',
        updatedAt: '2026-10-07T10:00:00.000Z',
      },
    },
  });
  await expect(page.getByText('Your guest menus were copied to your account.')).toHaveCount(0);
  await page.getByRole('link', { name: 'Continue as a guest' }).click();
  await expect(page).toHaveURL(/\/app\/guest\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Guest copy source', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View more', exact: true }).click();
  await expect(page.getByLabel('Practice notes')).toHaveValue('Guest original note');
  await expectGuestBytesUnchanged(page, guestBytes);
});

test('a same-count guest change refreshes the offer before the Yes request', async ({ page }) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallyUninitialized: true });
  const guestBytes = await createGuestAndStartAccount(page, harness);
  const changed = JSON.parse(guestBytes) as {
    state: { dashboardEntries: Array<Record<string, unknown>> };
    version: number;
  };
  const entry = changed.state.dashboardEntries[0];
  if (entry === undefined) throw new Error('Expected a complete guest entry.');
  entry['notes'] = 'Changed after offer';
  const changedBytes = JSON.stringify(changed);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: GUEST_KEY,
    value: changedBytes,
  });

  await page.getByRole('button', { name: 'Copy menus', exact: true }).click();
  await expect(
    page.getByText('Guest menus changed. Review the updated offer before choosing.'),
  ).toBeVisible();
  expect(adoptionCalls(harness)).toHaveLength(0);
  await page.getByRole('button', { name: 'Copy menus', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue to account' })).toBeVisible();
  const yes = bodyOf(adoptionCalls(harness)[0]);
  const dashboard = yes['dashboard'];
  expect(dashboard).toMatchObject({
    state: { dashboardEntries: [{ notes: 'Changed after offer' }] },
  });
  await expectGuestBytesUnchanged(page, changedBytes);
});

test('an unavailable opportunity is not converted into an implicit decline', async ({ page }) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallyUninitialized: true });
  const guestBytes = await createGuestAndStartAccount(page, harness);
  harness.setCopyOpportunityAvailable(false);

  await page.getByRole('button', { name: 'Copy menus', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Choice not confirmed', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/one-time opportunity may be lost/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'No, thanks', exact: true })).toHaveCount(0);
  expect(adoptionCalls(harness)).toHaveLength(1);
  expect(bodyOf(adoptionCalls(harness)[0])['decision']).toBe('yes');
  await continueToAccount(page);
  expect(adoptionCalls(harness)).toHaveLength(1);
  await expectGuestBytesUnchanged(page, guestBytes);
});

test('returning empty accounts receive no copy offer or adoption request', async ({ page }) => {
  const harness = await SyntheticManagedHarness.install(page, {
    initiallySignedIn: true,
    initiallyUninitialized: true,
    createdAccount: false,
  });
  await page.goto('/app/account/dashboard');
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Copy your guest menus to your account?' }),
  ).toHaveCount(0);
  expect(adoptionCalls(harness)).toEqual([]);
});

test('reload loses an unused creation handoff without sending an implicit No', async ({ page }) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallyUninitialized: true });
  const guestBytes = await createGuestAndStartAccount(page, harness);
  await page.reload();
  await expect(page).toHaveURL(/\/app\/account\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  expect(adoptionCalls(harness)).toEqual([]);
  await expectGuestBytesUnchanged(page, guestBytes);
});

test('a BFCache departure abandons an unused offer without an adoption request', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallyUninitialized: true });
  const guestBytes = await createGuestAndStartAccount(page, harness);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.getByRole('heading', { name: 'Setup interrupted', exact: true })).toBeVisible();
  await continueToAccount(page);
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy menus', exact: true })).toHaveCount(0);
  expect(adoptionCalls(harness)).toEqual([]);
  await expectGuestBytesUnchanged(page, guestBytes);
});

for (const outcome of ['confirmed', 'unconfirmed'] as const) {
  test(`a ${outcome} decision requires a fresh dashboard after failed load and same-account verification`, async ({
    page,
  }) => {
    const harness = await SyntheticManagedHarness.install(page, { initiallyUninitialized: true });
    const guestBytes = await createGuestAndStartAccount(page, harness);
    harness.setDashboardUnavailable(true);
    const held = outcome === 'unconfirmed' ? harness.holdNextAdoption() : null;
    await page.getByRole('button', { name: 'Copy menus', exact: true }).click();
    if (held !== null) {
      await held.observed;
      held.respond({ status: 0, body: null });
    }
    const loadError = page.getByRole('heading', {
      name: 'Your dashboard could not be loaded.',
      exact: true,
    });
    await expect(loadError).toBeVisible();
    harness.setAccountUnavailable(true);
    await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/account' && response.status() === 503,
      ),
      page.evaluate(() => window.dispatchEvent(new Event('focus'))),
    ]);
    await expect(
      page.getByRole('heading', { name: /hidden until it can be verified/i }),
    ).toBeVisible();
    harness.setAccountUnavailable(false);
    await page.getByRole('button', { name: 'Retry verification', exact: true }).click();
    await expect(loadError).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to account' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Copy menus', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(loadError).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to account' })).toBeHidden();
    expect(adoptionCalls(harness)).toHaveLength(1);
    await expectGuestBytesUnchanged(page, guestBytes);

    // A later server save wins over the submitted guest snapshot.
    const guest = JSON.parse(guestBytes) as {
      state: { dashboardEntries: Array<Record<string, unknown>> };
    };
    const entry = guest.state.dashboardEntries[0];
    if (entry === undefined) throw new Error('Expected a guest entry.');
    entry['notes'] = 'Current server note';
    harness.setDashboard({ version: 10, state: guest.state }, '7');
    harness.setDashboardUnavailable(false);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/account\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View more', exact: true }).click();
    await expect(page.getByLabel('Practice notes')).toHaveValue('Current server note');
    await page.getByLabel('Practice notes').fill('New ordinary account edit');
    await page.getByLabel('Practice notes').blur();
    await page.getByRole('button', { name: /Close .* details/i }).click();
    await page.getByRole('button', { name: 'Save to account', exact: true }).click();
    await expect
      .poll(() => harness.apiCalls.filter((call) => call.method === 'PUT').length)
      .toBe(1);
    expect(bodyOf(harness.apiCalls.find((call) => call.method === 'PUT'))['expectedRevision']).toBe(
      '7',
    );
    await expect(page.getByText('Saved to account', { exact: true })).toBeVisible();
    expect(adoptionCalls(harness)).toHaveLength(1);
    await expectGuestBytesUnchanged(page, guestBytes);
  });
}
