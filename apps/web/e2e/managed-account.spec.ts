import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import {
  ACCOUNT_ID,
  OTHER_ACCOUNT_ID,
  SYNTHETIC_AUTH_URL,
  SYNTHETIC_SESSION_TOKEN,
  SYNTHETIC_TOKEN,
  SyntheticManagedHarness,
  type SyntheticApiCall,
} from './synthetic-managed-harness';

const GUEST_KEY = 'kendo-menu';
const LEGACY_ACCOUNT_KEY = `kendo-menu:account:${ACCOUNT_ID}`;
const LEGACY_ACCOUNT_VALUE = JSON.stringify({ state: { dashboardEntries: [] }, version: 10 });
const GUEST_VALUE = JSON.stringify({ state: { dashboardEntries: [] }, version: 10 });

async function enterAccount(page: Page, harness: SyntheticManagedHarness): Promise<void> {
  await page.goto('/app/account/dashboard');
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  expect(harness.apiCalls.some((call) => call.path === '/api/dashboard')).toBe(true);
}

function apiCallsFor(harness: SyntheticManagedHarness, method: string): SyntheticApiCall[] {
  return harness.apiCalls.filter((call) => call.method === method);
}

function parseJson(value: string | undefined): unknown {
  if (value === undefined) throw new Error('Expected a request body.');
  return JSON.parse(value) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectCredentialFreeAccountTransport(harness: SyntheticManagedHarness): void {
  expect(harness.apiCalls.length).toBeGreaterThan(0);
  for (const call of harness.apiCalls) {
    expect(call.authorization).toBe(`Bearer ${SYNTHETIC_TOKEN}`);
    expect(call.cookie).toBeUndefined();
    expect(call.path).not.toMatch(/session|csrf|adopt|copy/iu);
    expect(['/api/account', '/api/dashboard']).toContain(
      new URL(call.path, 'http://localhost').pathname,
    );
  }
}

async function openPrimaryNavigation(page: Page): Promise<void> {
  const openButton = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await openButton.isVisible()) await openButton.click();
}

async function seedGuestAndLegacyStorage(page: Page): Promise<void> {
  await page.addInitScript(
    ({ guestKey, guestValue, legacyKey, legacyValue }) => {
      localStorage.setItem(guestKey, guestValue);
      localStorage.setItem(legacyKey, legacyValue);
    },
    {
      guestKey: GUEST_KEY,
      guestValue: GUEST_VALUE,
      legacyKey: LEGACY_ACCOUNT_KEY,
      legacyValue: LEGACY_ACCOUNT_VALUE,
    },
  );
  await page.goto('/app');
  await page.evaluate(async (legacyValue) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kendo-menu-account-storage', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('records', { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB setup failed.'));
    });
    try {
      const transaction = database.transaction('records', 'readwrite');
      transaction.objectStore('records').put({
        key: `${'0'.repeat(8)}-${'0'.repeat(4)}-${'0'.repeat(4)}-${'0'.repeat(4)}-${'0'.repeat(12)}:cache`,
        kind: 'cache',
        version: 10,
        accountId: '00000000-0000-0000-0000-000000000000',
        cacheValue: legacyValue,
        identity: 'legacy-cache-sentinel',
        generation: 1,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('IndexedDB setup failed.'));
      });
    } finally {
      database.close();
    }
  }, LEGACY_ACCOUNT_VALUE);
}

async function readLegacyDatabaseRecords(page: Page): Promise<unknown[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kendo-menu-account-storage', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed.'));
    });
    try {
      const transaction = database.transaction('records', 'readonly');
      const values = await new Promise<unknown[]>((resolve, reject) => {
        const request = transaction.objectStore('records').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed.'));
      });
      return values;
    } finally {
      database.close();
    }
  });
}

async function expectNoCredentialOrIdentityPersistence(page: Page): Promise<void> {
  const persisted = await page.evaluate(() => {
    const local = Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index);
      return key === null ? '' : `${key}=${localStorage.getItem(key) ?? ''}`;
    });
    const session = Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index);
      return key === null ? '' : `${key}=${sessionStorage.getItem(key) ?? ''}`;
    });
    return { local, session };
  });
  const newLocalValues = persisted.local.filter(
    (value) => !value.startsWith(`${LEGACY_ACCOUNT_KEY}=`),
  );
  const serialised = JSON.stringify({ local: newLocalValues, session: persisted.session });
  expect(serialised).not.toContain(SYNTHETIC_TOKEN);
  expect(serialised).not.toContain(SYNTHETIC_SESSION_TOKEN);
  expect(serialised).not.toContain(ACCOUNT_ID);
  expect(serialised).not.toContain('practitioner@example.test');
  expect(serialised).not.toContain('copyOpportunityId');
  expect(serialised).not.toContain('Account builder draft');
  expect(newLocalValues.filter((value) => value.startsWith('kendo-menu:account:'))).toEqual([]);
}

async function addCuratedMenu(page: Page): Promise<void> {
  await openPrimaryNavigation(page);
  await page
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Keiko library' })
    .click();
  await expect(page.getByRole('heading', { name: 'Keiko library' })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'View session' }).first().click();
  await page.getByRole('button', { name: 'Add to dashboard', exact: true }).click();
  const dashboardShortcut = page
    .getByRole('dialog')
    .getByRole('link', { name: 'View dashboard', exact: true });
  await expect(dashboardShortcut).toBeVisible();
  await dashboardShortcut.click();
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);
}

async function createBuilderMenu(page: Page, name: string): Promise<void> {
  await page
    .getByRole('main')
    .getByRole('link', { name: /Create (new menu|a training session)/i })
    .click();
  await page.getByLabel('Session name').fill(name);
  await page.getByLabel('Activity name').fill('Footwork');
  await page.getByLabel('Exercise name').fill('Suburi');
  await page.getByLabel('Repetitions').fill('10');
  await expect(page.locator('form.builder-form')).not.toHaveAttribute('inert', '');
  await expect(page.locator('fieldset.builder-editable-fields')).toBeEnabled();
  await page.getByRole('button', { name: 'Save session to dashboard' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('Continue as a guest opens the guest dashboard while account routes stay separate', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page);
  await page.goto('/app');
  await page.getByRole('link', { name: 'Continue as a guest' }).click();
  await expect(page).toHaveURL(/\/app\/guest\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await page.goto('/app/guest/library');
  await expect(page.getByRole('heading', { name: 'Keiko library' })).toBeVisible();
  await page.goto('/app/guest/drills/new');
  await expect(page.getByRole('heading', { name: 'Create a training session' })).toBeVisible();
  await page.goto('/app/account/dashboard');
  await expect(page.getByRole('heading', { name: /Continue with Google/i })).toBeVisible();
  expect(harness.apiCalls).toEqual([]);
});

test('Continue with Google completes the application callback before loading an account', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page);
  await harness.authenticateFromLanding(page);
  await expect(page.getByText('Signed in as practitioner@example.test')).toBeVisible();
  expect(harness.authCalls.some((url) => url.includes('/get-session'))).toBe(true);
  expect(harness.authCalls.some((url) => url.includes('/token'))).toBe(true);
  expect(harness.apiCalls.some((call) => call.path === '/api/account')).toBe(true);
  expect(harness.apiCalls.some((call) => call.path.includes('managed-identity'))).toBe(false);
  expect(await page.evaluate(() => sessionStorage.getItem('kendomenu:auth-return-v1'))).toBeNull();
  expectCredentialFreeAccountTransport(harness);
});

test('a verified visitor is redirected from guest routes to the matching account route', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await page.goto('/app/guest/library?drill=international-dojo-2-hour-session#source-note');
  await expect(page).toHaveURL(
    /\/app\/account\/library\?drill=international-dojo-2-hour-session#source-note$/,
  );
  await expect(page.getByRole('button', { name: 'Add to dashboard', exact: true })).toBeVisible();
  await page.goto('/app/guest/drills/new');
  await expect(page).toHaveURL(/\/app\/account\/drills\/new$/);
  await expect(page.getByRole('heading', { name: 'Create a training session' })).toBeVisible();
  expectCredentialFreeAccountTransport(harness);
});

test('only a confirmed signed-out guest receives one static analytics pixel', async ({ page }) => {
  const harness = await SyntheticManagedHarness.install(page);
  const analyticsRequests: string[] = [];
  const scriptRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('count.js')) scriptRequests.push(request.url());
  });
  await page.route('https://javiermarro.goatcounter.com/count**', async (route) => {
    analyticsRequests.push(route.request().url());
    await route.fulfill({ status: 204, body: '' });
  });
  await page.goto('/app/guest/dashboard');
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect.poll(() => analyticsRequests.length).toBe(1);
  const pixel = new URL(analyticsRequests[0] ?? 'https://invalid.example');
  expect(pixel.searchParams.get('p')).toBe('/app/guest/dashboard');
  expect([...pixel.searchParams.keys()]).toEqual(['p']);
  expect(scriptRequests).toEqual([]);
  expect(harness.apiCalls).toEqual([]);
});

test('verified account and unresolved authentication never send analytics', async ({ page }) => {
  const analyticsRequests: string[] = [];
  await page.route('https://javiermarro.goatcounter.com/**', async (route) => {
    analyticsRequests.push(route.request().url());
    await route.fulfill({ status: 204, body: '' });
  });
  const signedInHarness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await enterAccount(page, signedInHarness);
  await page.waitForTimeout(1_100);
  expect(analyticsRequests).toEqual([]);

  let resolveTokenWait: (() => void) | undefined;
  let releaseTokenWait: (() => void) | undefined;
  const tokenSeen = new Promise<void>((resolve) => {
    resolveTokenWait = resolve;
  });
  const tokenRelease = new Promise<void>((resolve) => {
    releaseTokenWait = resolve;
  });
  await page.route(`${SYNTHETIC_AUTH_URL}/**`, async (route) => {
    if (route.request().url().includes('/token')) {
      resolveTokenWait?.();
      await tokenRelease;
      await route
        .fulfill({ status: 503, json: { message: 'Synthetic auth unavailable.' } })
        .catch(() => undefined);
      return;
    }
    await route.fallback();
  });
  await page.goto('/app/guest/dashboard');
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await tokenSeen;
  try {
    await page.waitForTimeout(1_100);
    expect(analyticsRequests).toEqual([]);
  } finally {
    releaseTokenWait?.();
  }
});

test('a pending guest pageview is canceled while focus verification remains unresolved', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page);
  const analyticsRequests: string[] = [];
  await page.route('https://javiermarro.goatcounter.com/**', async (route) => {
    analyticsRequests.push(route.request().url());
    await route.fulfill({ status: 204, body: '' });
  });
  await page.goto('/app/guest/dashboard');
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();

  let resolveTokenWait: (() => void) | undefined;
  let releaseTokenWait: (() => void) | undefined;
  const tokenSeen = new Promise<void>((resolve) => {
    resolveTokenWait = resolve;
  });
  const tokenRelease = new Promise<void>((resolve) => {
    releaseTokenWait = resolve;
  });
  await page.route(`${SYNTHETIC_AUTH_URL}/**`, async (route) => {
    if (route.request().url().includes('/token')) {
      resolveTokenWait?.();
      await tokenRelease;
      await route
        .fulfill({ status: 503, json: { message: 'Synthetic auth unavailable.' } })
        .catch(() => undefined);
      return;
    }
    await route.fallback();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await tokenSeen;
  try {
    await page.waitForTimeout(1_100);
    expect(analyticsRequests).toEqual([]);
    expect(harness.apiCalls).toEqual([]);
  } finally {
    releaseTokenWait?.();
  }
});

test('a canceled guest pageview is rescheduled after focus verification confirms signed out', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page);
  const analyticsRequests: string[] = [];
  await page.route('https://javiermarro.goatcounter.com/**', async (route) => {
    analyticsRequests.push(route.request().url());
    await route.fulfill({ status: 204, body: '' });
  });
  const initialTime = new Date('2025-01-01T00:00:00.000Z');
  await page.clock.install({ time: initialTime });
  await page.goto('/app/guest/dashboard', { waitUntil: 'commit' });
  await page.clock.pauseAt(new Date(initialTime.getTime() + 500));
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  const accountShortcut = page.locator('.guest-account-shortcut');
  await expect(accountShortcut).toHaveAttribute('aria-busy', 'false');

  let resolveTokenWait: (() => void) | undefined;
  let releaseTokenWait: (() => void) | undefined;
  const tokenSeen = new Promise<void>((resolve) => {
    resolveTokenWait = resolve;
  });
  const tokenRelease = new Promise<void>((resolve) => {
    releaseTokenWait = resolve;
  });
  const signedOutResponse = page.waitForResponse(
    (response) => response.url().includes('/token') && response.status() === 401,
  );
  await page.route(`${SYNTHETIC_AUTH_URL}/**`, async (route) => {
    if (route.request().url().includes('/token')) {
      resolveTokenWait?.();
      await tokenRelease;
      await route
        .fulfill({ status: 401, json: { message: 'Unauthenticated' } })
        .catch(() => undefined);
      return;
    }
    await route.fallback();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await tokenSeen;
  try {
    await expect(accountShortcut).toHaveAttribute('aria-busy', 'true');
    await page.clock.runFor(1_100);
    expect(analyticsRequests).toEqual([]);
  } finally {
    releaseTokenWait?.();
  }

  await signedOutResponse;
  // A completed HTTP response precedes React's identity commit and its pageview effect.
  await expect(accountShortcut).toHaveAttribute('aria-busy', 'false');
  await page.clock.runFor(1_100);
  await expect.poll(() => analyticsRequests.length).toBe(1);
  const pixel = new URL(analyticsRequests[0] ?? 'https://invalid.example');
  expect(pixel.searchParams.get('p')).toBe('/app/guest/dashboard');
  expect([...pixel.searchParams.keys()]).toEqual(['p']);
  expect(harness.apiCalls).toEqual([]);
});

test('empty account stays empty; library and builder changes require an explicit Save', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await seedGuestAndLegacyStorage(page);
  await enterAccount(page, harness);
  await expect(page.getByRole('heading', { name: 'Your dashboard is ready.' })).toBeVisible();
  await expect(page.locator('.dashboard-card')).toHaveCount(0);

  await addCuratedMenu(page);
  expect(apiCallsFor(harness, 'PUT')).toHaveLength(0);

  await page.getByRole('button', { name: 'View more' }).first().click();
  const accountNotes = page.getByLabel('Practice notes');
  await accountNotes.fill('An unsaved account note.');
  await accountNotes.press('Tab');
  const repetitions = page.getByLabel(/Repetitions for/i).first();
  await repetitions.fill('12');
  await repetitions.press('Tab');
  await expect(page.getByText('Updated').first()).toBeVisible();
  await page.getByRole('button', { name: /Close .* details/i }).click();
  await expect(page.getByText(/saved to your dashboard|saved to this account/i)).toHaveCount(0);

  await createBuilderMenu(page, 'Account builder draft');
  expect(apiCallsFor(harness, 'PUT')).toHaveLength(0);
  await expect(
    page.getByText(
      'Account builder draft added to your account draft. Save to account to keep this change.',
    ),
  ).toBeVisible();
  await expect(page.getByText(/saved to your dashboard|saved to this account/i)).toHaveCount(0);

  await page.getByRole('button', { name: 'Save to account' }).click();
  await expect.poll(() => apiCallsFor(harness, 'PUT').length).toBe(1);
  const put = apiCallsFor(harness, 'PUT')[0];
  expect(put).toBeDefined();
  expect(parseJson(put?.body)).toMatchObject({
    transportVersion: 1,
    expectedAccountWorkspaceId: ACCOUNT_ID,
    expectedRevision: '0',
  });
  expectCredentialFreeAccountTransport(harness);
  await expectNoCredentialOrIdentityPersistence(page);
  expect(await page.evaluate((key) => localStorage.getItem(key), GUEST_KEY)).toBe(GUEST_VALUE);
  expect(await page.evaluate((key) => localStorage.getItem(key), LEGACY_ACCOUNT_KEY)).toBe(
    LEGACY_ACCOUNT_VALUE,
  );
  const legacyRecords = await readLegacyDatabaseRecords(page);
  expect(legacyRecords).toHaveLength(1);
  expect(legacyRecords[0]).toMatchObject({
    cacheValue: LEGACY_ACCOUNT_VALUE,
    identity: 'legacy-cache-sentinel',
  });
});

test('account creation opens an empty dashboard and ordinary Save keeps the copy opportunity memory-only', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, {
    initiallySignedIn: true,
    initiallyUninitialized: true,
  });
  await page.addInitScript((value) => localStorage.setItem('kendo-menu', value), GUEST_VALUE);
  await enterAccount(page, harness);
  await expect(page.getByRole('heading', { name: 'Your dashboard is ready.' })).toBeVisible();
  expect(apiCallsFor(harness, 'POST')).toHaveLength(1);
  await expect(page).toHaveURL(/\/app\/account\/dashboard$/);

  await addCuratedMenu(page);
  await page.getByRole('button', { name: 'Save to account' }).click();
  await expect.poll(() => apiCallsFor(harness, 'PUT').length).toBe(1);
  expect(harness.apiCalls.some((call) => /adopt|copy/i.test(call.path))).toBe(false);
  await expectNoCredentialOrIdentityPersistence(page);
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(GUEST_VALUE);
});

test('edits made during Save remain dirty after only the submitted snapshot is acknowledged', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await enterAccount(page, harness);
  await addCuratedMenu(page);

  const heldSave = harness.holdNextSave();
  await page.getByRole('button', { name: 'Save to account' }).click();
  const submitted = await heldSave.observed;
  const submittedBody = parseJson(submitted.body);
  expect(isRecord(submittedBody)).toBe(true);

  await page.getByRole('button', { name: 'View more' }).first().click();
  const notes = page.getByLabel('Practice notes');
  await notes.fill('Keep this later edit in the draft.');
  await notes.press('Tab');
  heldSave.respond();
  await page.getByRole('button', { name: /Close .* details/i }).click();
  await expect(page.getByText(/changes are held in memory|not yet saved/i)).toBeVisible();

  await page.getByRole('button', { name: 'Save to account' }).click();
  await expect.poll(() => apiCallsFor(harness, 'PUT').length).toBe(2);
  const first = parseJson(apiCallsFor(harness, 'PUT')[0]?.body);
  const second = parseJson(apiCallsFor(harness, 'PUT')[1]?.body);
  expect(isRecord(first)).toBe(true);
  expect(isRecord(second)).toBe(true);
  if (isRecord(first) && isRecord(second)) {
    expect(first['requestId']).not.toBe(second['requestId']);
    expect(second['expectedRevision']).toBe('1');
    expect(JSON.stringify(second['dashboard'])).toContain('Keep this later edit in the draft.');
  }
  expectCredentialFreeAccountTransport(harness);
});

test('an uncertain Save retries the identical request envelope', async ({ page }) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await enterAccount(page, harness);
  await addCuratedMenu(page);
  harness.failOneSave();
  await page.getByRole('button', { name: 'Save to account' }).click();
  await expect(page.locator('.dashboard-save-actions').getByRole('alert')).toContainText(
    'Save was not confirmed',
  );
  const first = apiCallsFor(harness, 'PUT')[0];
  expect(first).toBeDefined();

  await page.getByRole('button', { name: /Retry (the )?same Save|Retry save/i }).click();
  await expect.poll(() => apiCallsFor(harness, 'PUT').length).toBe(2);
  expect(apiCallsFor(harness, 'PUT')[1]?.body).toBe(first?.body);
  expect(apiCallsFor(harness, 'PUT')[1]?.authorization).toBe(first?.authorization);
  expectCredentialFreeAccountTransport(harness);
});

test('a revision conflict preserves the draft and only an explicit reload discards it', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await enterAccount(page, harness);
  await addCuratedMenu(page);
  harness.conflictOneSave();
  await page.getByRole('button', { name: 'Save to account' }).click();
  await expect(page.getByText(/account changed elsewhere|revision conflict/i)).toBeVisible();
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);
  await expect(
    page.locator('.account-save-recovery').getByRole('button', { name: 'Download draft' }),
  ).toBeVisible();
  expect(apiCallsFor(harness, 'PUT')).toHaveLength(1);

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: /Reload account/i }).click();
  await expect(page.getByRole('heading', { name: 'Your dashboard is ready.' })).toBeVisible();
  expect(apiCallsFor(harness, 'PUT')).toHaveLength(1);
});

test('network loss leaves a verified account draft visible and read-only', async ({
  page,
  context,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await enterAccount(page, harness);
  await addCuratedMenu(page);
  await context.setOffline(true);
  await expect(page.getByRole('heading', { name: /Account service unavailable/i })).toBeVisible();
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);
  const unavailableNotice = page
    .getByRole('heading', { name: 'Account service unavailable' })
    .locator('..');
  await expect(unavailableNotice.getByRole('button', { name: 'Download draft' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save to account' })).toBeDisabled();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByRole('button', { name: 'Save to account' })).toBeEnabled();
  expect(apiCallsFor(harness, 'PUT')).toHaveLength(0);
});

test('an offline account builder stays read-only until Retry connection confirms service', async ({
  page,
  context,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await enterAccount(page, harness);
  await page
    .getByRole('main')
    .getByRole('link', { name: /Create (new menu|a training session)/i })
    .click();
  const sessionName = page.getByLabel('Session name');
  await sessionName.fill('Offline account builder draft');
  await page.getByLabel('Activity name').fill('Offline activity');
  await page.getByLabel('Exercise name').fill('Offline exercise');
  const initialDashboardReads = harness.apiCalls.filter(
    (call) =>
      call.method === 'GET' && new URL(call.path, 'http://localhost').pathname === '/api/dashboard',
  ).length;
  const builderForm = page.locator('form.builder-form');
  const editableFields = builderForm.locator('fieldset.builder-editable-fields');

  await context.setOffline(true);
  await expect(page.getByRole('heading', { name: 'Account service unavailable' })).toBeVisible();
  await expect(builderForm).toHaveAttribute('inert', '');
  await expect(editableFields).toHaveAttribute('disabled', '');
  await expect(sessionName).toBeDisabled();
  await expect(page.getByLabel('Activity name')).toBeDisabled();
  await expect(page.getByLabel('Exercise name')).toBeDisabled();
  await sessionName.focus();
  await expect(sessionName).not.toBeFocused();
  await page.keyboard.type('blocked');
  await expect(sessionName).toHaveValue('Offline account builder draft');

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(builderForm).toHaveAttribute('inert', '');
  await expect(editableFields).toHaveAttribute('disabled', '');
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(builderForm).not.toHaveAttribute('inert', '');
  await expect(editableFields).not.toHaveAttribute('disabled', '');
  await expect(sessionName).toBeEnabled();
  await expect(sessionName).toHaveValue('Offline account builder draft');
  await expect(page.getByLabel('Activity name')).toHaveValue('Offline activity');
  await expect(page.getByLabel('Exercise name')).toHaveValue('Offline exercise');
  await expect
    .poll(
      () =>
        harness.apiCalls.filter(
          (call) =>
            call.method === 'GET' &&
            new URL(call.path, 'http://localhost').pathname === '/api/dashboard',
        ).length,
    )
    .toBeGreaterThan(initialDashboardReads);
  expect(apiCallsFor(harness, 'PUT')).toHaveLength(0);
});

test('same-account verification restarts a held initial dashboard load before revealing it', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  let resolveDashboardSeen: (() => void) | undefined;
  let releaseDashboard: (() => void) | undefined;
  let resolveDashboardHandled: (() => void) | undefined;
  const firstDashboardSeen = new Promise<void>((resolve) => {
    resolveDashboardSeen = resolve;
  });
  const dashboardRelease = new Promise<void>((resolve) => {
    releaseDashboard = resolve;
  });
  const firstDashboardHandled = new Promise<void>((resolve) => {
    resolveDashboardHandled = resolve;
  });
  let holdFirstDashboard = true;
  await page.route('**/api/dashboard', async (route) => {
    if (holdFirstDashboard && route.request().method() === 'GET') {
      holdFirstDashboard = false;
      resolveDashboardSeen?.();
      await dashboardRelease;
      await route
        .fulfill({ status: 503, json: { error: 'SERVICE_UNAVAILABLE' } })
        .catch(() => undefined);
      resolveDashboardHandled?.();
      return;
    }
    await route.fallback();
  });

  let releaseAccount: (() => void) | undefined;
  try {
    await page.goto('/app/account/dashboard');
    await firstDashboardSeen;

    let resolveAccountSeen: (() => void) | undefined;
    const verificationSeen = new Promise<void>((resolve) => {
      resolveAccountSeen = resolve;
    });
    const accountRelease = new Promise<void>((resolve) => {
      releaseAccount = resolve;
    });
    await page.route('**/api/account', async (route) => {
      if (route.request().method() === 'GET') {
        resolveAccountSeen?.();
        await accountRelease;
        await route.fallback();
        return;
      }
      await route.fallback();
    });

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await verificationSeen;
    await expect(
      page.getByRole('heading', { name: /hidden until it can be verified/i }),
    ).toBeVisible();
    releaseAccount?.();

    await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your dashboard is ready.' })).toBeVisible();
    await expect
      .poll(
        () =>
          harness.apiCalls.filter(
            (call) =>
              call.method === 'GET' &&
              new URL(call.path, 'http://localhost').pathname === '/api/dashboard',
          ).length,
      )
      .toBe(1);

    releaseDashboard?.();
    await firstDashboardHandled;
    await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your dashboard is ready.' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Your dashboard could not be loaded.' }),
    ).toHaveCount(0);
  } finally {
    releaseAccount?.();
    releaseDashboard?.();
  }
});

test('an open account library dialog stays hidden through identity uncertainty and 401', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await enterAccount(page, harness);
  await page.goto('/app/account/library?drill=international-dojo-2-hour-session');
  const dialog = page.getByRole('dialog', { name: 'International dojo menu' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add to dashboard' })).toBeVisible();

  let resolveAccountWait: (() => void) | undefined;
  let releaseAccountWait: (() => void) | undefined;
  const accountRequestSeen = new Promise<void>((resolve) => {
    resolveAccountWait = resolve;
  });
  const accountRequestRelease = new Promise<void>((resolve) => {
    releaseAccountWait = resolve;
  });
  await page.route('**/api/account', async (route) => {
    if (route.request().method() === 'GET') {
      resolveAccountWait?.();
      await accountRequestRelease;
      await route
        .fulfill({ status: 401, json: { error: 'UNAUTHENTICATED' } })
        .catch(() => undefined);
      return;
    }
    await route.fallback();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await accountRequestSeen;
  try {
    await expect(
      page.getByRole('heading', { name: /hidden until it can be verified/i }),
    ).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Signed in as practitioner@example.test')).toHaveCount(0);
  } finally {
    releaseAccountWait?.();
  }

  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole('heading', { name: 'Plan the keiko you need today.', exact: true }),
  ).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Signed in as practitioner@example.test')).toHaveCount(0);
  expect(apiCallsFor(harness, 'PUT')).toHaveLength(0);
});

test('an account library portal dialog closes offline and exposes no mutation controls', async ({
  page,
  context,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await enterAccount(page, harness);
  await page.goto('/app/account/library?drill=international-dojo-2-hour-session');
  const dialog = page.getByRole('dialog', { name: 'International dojo menu' });
  await expect(dialog).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByRole('heading', { name: 'Account service unavailable' })).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add to dashboard' })).toHaveCount(0);
  await expect(page.getByText('Signed in as practitioner@example.test')).toBeVisible();
  expect(apiCallsFor(harness, 'PUT')).toHaveLength(0);
});

test('the guest builder remains usable and locally saved while offline', async ({
  page,
  context,
}) => {
  const harness = await SyntheticManagedHarness.install(page);
  await page.goto('/app/guest/drills/new');
  await expect(page.getByRole('heading', { name: 'Create a training session' })).toBeVisible();
  await context.setOffline(true);
  await page.getByLabel('Session name').fill('Offline guest session');
  await page.getByLabel('Activity name').fill('Guest footwork');
  await page.getByLabel('Exercise name').fill('Suburi');
  await page.getByLabel('Repetitions').fill('10');
  await page.getByRole('button', { name: 'Save session to dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Offline guest session' })).toBeVisible();
  await expect(page.getByText('Offline guest session saved to your dashboard.')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toContain(
    'Offline guest session',
  );
  expect(harness.apiCalls).toEqual([]);
});

test('401 hides account content and same-account verification reveals the original draft revision', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await enterAccount(page, harness);
  await addCuratedMenu(page);
  harness.unauthorizeOneSave();
  await page.getByRole('button', { name: 'Save to account' }).click();
  await expect(
    page.getByRole('heading', { name: /hidden until it can be verified/i }),
  ).toBeVisible();
  await expect(page.locator('.dashboard-card--compact')).toBeHidden();
  await expect(page.getByText('Signed in as practitioner@example.test')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download draft' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Retry verification' }).click();
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Download draft' })).toBeVisible();
  const retry = page.getByRole('button', { name: 'Retry same save' });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect.poll(() => apiCallsFor(harness, 'PUT').length).toBe(2);
  expect(apiCallsFor(harness, 'PUT')[1]?.body).toBe(apiCallsFor(harness, 'PUT')[0]?.body);
  expect(parseJson(apiCallsFor(harness, 'PUT')[0]?.body)).toMatchObject({
    expectedAccountWorkspaceId: ACCOUNT_ID,
    expectedRevision: '0',
  });
});

test('sign-out fences a late Save response and returns home', async ({ page }) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await enterAccount(page, harness);
  await addCuratedMenu(page);
  const heldSave = harness.holdNextSave();
  await page.getByRole('button', { name: 'Save to account' }).click();
  await heldSave.observed;
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('alertdialog', { name: /Leave this account/i })).toBeVisible();
  await page.getByRole('button', { name: /Discard and sign out/i }).click();
  heldSave.respond();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/app/account/dashboard');
  await expect(page.getByRole('heading', { name: /Continue with Google/i })).toBeVisible();
  expectCredentialFreeAccountTransport(harness);
});

test('a different verified account receives a fresh draft and cannot see the prior account draft', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'BroadcastChannel', { value: undefined });
  });
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await enterAccount(page, harness);
  await addCuratedMenu(page);
  harness.setAccountId(OTHER_ACCOUNT_ID);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Your dashboard is ready.' })).toBeVisible();
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(0);
  expectCredentialFreeAccountTransport(harness);
});

test('cross-tab signed-out hints trigger verification and hide the other tab account', async ({
  page,
  context,
}) => {
  const secondPage = await context.newPage();
  const firstHarness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  const secondHarness = await SyntheticManagedHarness.install(secondPage, {
    initiallySignedIn: true,
  });
  await enterAccount(page, firstHarness);
  await enterAccount(secondPage, secondHarness);
  await expect(secondPage.getByText('Signed in as practitioner@example.test')).toBeVisible();

  secondHarness.setSignedIn(false);
  let resolveTokenWait: (() => void) | undefined;
  let releaseTokenWait: (() => void) | undefined;
  const tokenSeen = new Promise<void>((resolve) => {
    resolveTokenWait = resolve;
  });
  const tokenRelease = new Promise<void>((resolve) => {
    releaseTokenWait = resolve;
  });
  await secondPage.route(`${SYNTHETIC_AUTH_URL}/**`, async (route) => {
    if (route.request().url().includes('/token')) {
      resolveTokenWait?.();
      await tokenRelease;
      await route
        .fulfill({ status: 401, json: { message: 'Unauthenticated' } })
        .catch(() => undefined);
      return;
    }
    await route.fallback();
  });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('alertdialog', { name: /Leave this account/i })).toBeVisible();
  await page.getByRole('button', { name: /Discard and sign out/i }).click();
  await tokenSeen;
  try {
    await expect(
      secondPage.getByRole('heading', { name: /hidden until it can be verified/i }),
    ).toBeVisible();
    await expect(secondPage.getByText('Signed in as practitioner@example.test')).toHaveCount(0);
    await expect(secondPage.locator('.dashboard-card--compact')).toHaveCount(0);
  } finally {
    releaseTokenWait?.();
  }

  await expect(secondPage).toHaveURL(/\/app$/);
  await expect(
    secondPage.getByRole('heading', { name: 'Plan the keiko you need today.' }),
  ).toBeVisible();
  expect(secondHarness.apiCalls.some((call) => call.method === 'PUT')).toBe(false);
  expectCredentialFreeAccountTransport(firstHarness);
});

test('a hidden dirty account draft still warns before intentional navigation', async ({ page }) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await enterAccount(page, harness);
  await addCuratedMenu(page);
  await page.getByRole('button', { name: 'View more' }).first().click();
  await page.getByLabel('Practice notes').fill('Keep this note while account identity is unclear.');
  await page.getByLabel('Practice notes').press('Tab');
  await page.getByRole('button', { name: /Close .* details/i }).click();

  let resolveTokenWait: (() => void) | undefined;
  let releaseTokenWait: (() => void) | undefined;
  const tokenSeen = new Promise<void>((resolve) => {
    resolveTokenWait = resolve;
  });
  const tokenRelease = new Promise<void>((resolve) => {
    releaseTokenWait = resolve;
  });
  const unavailableTokenResponse = page.waitForResponse(
    (response) => response.url().includes('/token') && response.status() === 503,
  );
  await page.route(`${SYNTHETIC_AUTH_URL}/**`, async (route) => {
    if (route.request().url().includes('/token')) {
      resolveTokenWait?.();
      await tokenRelease;
      await route
        .fulfill({ status: 503, json: { message: 'Synthetic auth unavailable.' } })
        .catch(() => undefined);
      return;
    }
    await route.fallback();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await tokenSeen;
  await expect(
    page.getByRole('heading', { name: /hidden until it can be verified/i }),
  ).toBeVisible();
  releaseTokenWait?.();
  await unavailableTokenResponse;
  await expect(page.getByText(/your current-tab draft is retained in memory/i)).toBeVisible();

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toMatch(/unsaved account changes.*Leave the account/i);
    void dialog.accept();
  });
  await page.getByRole('banner').getByRole('link', { name: 'KendoMenu home' }).click();
  await expect(page).toHaveURL(/\/app$/);
  expect(apiCallsFor(harness, 'PUT')).toHaveLength(0);
});

test('account dashboard and sign-out dialog are accessible with keyboard focus restoration', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await enterAccount(page, harness);
  let violations = (await new AxeBuilder({ page }).analyze()).violations;
  expect(violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual(
    [],
  );

  const signOut = page.getByRole('button', { name: 'Sign out' });
  await signOut.focus();
  await expect(signOut).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog', { name: /Leave this account/i });
  await expect(dialog).toBeVisible();
  const keepEditing = dialog.getByRole('button', { name: 'Keep editing' });
  await expect(keepEditing).toBeFocused();
  violations = (await new AxeBuilder({ page }).analyze()).violations;
  expect(violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual(
    [],
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(signOut).toBeFocused();
  expectCredentialFreeAccountTransport(harness);
});

test('unsaved dashboard edits warn before leaving the account workspace', async ({ page }) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await enterAccount(page, harness);
  await addCuratedMenu(page);
  await page.getByRole('button', { name: 'View more' }).first().click();
  const notes = page.getByLabel('Practice notes');
  await notes.fill('A note held only in this account draft.');
  await notes.press('Tab');
  await page.getByRole('button', { name: /Close .* details/i }).click();

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toMatch(/unsaved account changes.*Leave the account/i);
    void dialog.dismiss();
  });
  await page.getByRole('banner').getByRole('link', { name: 'KendoMenu home' }).click();
  await expect(page).toHaveURL(/\/app\/account\/dashboard$/);
  await expect(page.getByRole('button', { name: 'Save to account' })).toBeVisible();
  expect(apiCallsFor(harness, 'PUT')).toHaveLength(0);
});

test('an unfinished account builder draft warns before navigation and stays in memory', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await enterAccount(page, harness);
  await page
    .getByRole('main')
    .getByRole('link', { name: /Create (new menu|a training session)/i })
    .click();
  await page.getByLabel('Session name').fill('Unsubmitted account menu');
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toMatch(/draft/i);
    void dialog.dismiss();
  });
  await page.getByRole('link', { name: 'Back to keiko library' }).click();
  await expect(page).toHaveURL(/\/app\/account\/drills\/new$/);
  expect(apiCallsFor(harness, 'PUT')).toHaveLength(0);
});
