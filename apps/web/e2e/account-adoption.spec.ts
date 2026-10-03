import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const accountId = '01234567-89ab-4cde-8fab-0123456789ab';
const catalogueVersion = 'a'.repeat(64);
const timestamp = '2026-09-30T10:00:00.000Z';
const csrfCookie = '__Host-kendomenu-csrf=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

type Completion =
  | {
      readonly decision: 'yes';
      readonly requestId: string;
      readonly acknowledgedRevision: '1';
      readonly timestamp: string;
    }
  | { readonly decision: 'no'; readonly requestId: string };

async function installAdoptionServer(
  context: BrowserContext,
  { allowOrdinaryBeforeAdoption = false }: { readonly allowOrdinaryBeforeAdoption?: boolean } = {},
) {
  let signedIn = false;
  let created = false;
  let completion: Completion | null = null;
  let cloudDashboard: unknown = null;
  let cloudRevision = '0';
  let adoptionPosts = 0;
  let dashboardPuts = 0;
  let failNextAdoptionPost = false;
  let authStarts = 0;
  let sessionChecks = 0;
  let redirectToCancellableAuth = false;
  let authenticateCancellableAuth = false;
  let heldSessionResponse: { readonly wait: Promise<void>; readonly release: () => void } | null =
    null;
  const requests: unknown[] = [];

  await context.addInitScript((cookie) => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => cookie,
    });
  }, csrfCookie);
  await context.route('**/api/auth/google/start', (route) => {
    authStarts += 1;
    if (redirectToCancellableAuth) {
      if (authenticateCancellableAuth) {
        signedIn = true;
        created = true;
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<main><h1>Google sign-in</h1><button onclick="history.back()">Cancel sign-in</button></main>',
      });
    }
    signedIn = true;
    created = true;
    return route.fulfill({ status: 302, headers: { location: '/app/dashboard' } });
  });
  await context.route('**/api/session', async (route) => {
    if (route.request().method() === 'DELETE') {
      signedIn = false;
      return route.fulfill({ status: 204 });
    }
    sessionChecks += 1;
    if (heldSessionResponse !== null) {
      const held = heldSessionResponse;
      heldSessionResponse = null;
      await held.wait;
    }
    if (!signedIn) {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'UNAUTHENTICATED' }),
      });
    }
    const adoption =
      completion === null
        ? created
          ? { status: 'pending', capability: true }
          : { status: 'unavailable', capability: false }
        : completion.decision === 'yes'
          ? { status: 'accepted', capability: false, completion }
          : { status: 'declined', capability: false, completion };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        userId: accountId,
        verifiedGoogleEmail: 'kendoka@example.test',
        adoption,
      }),
    });
  });
  await context.route('**/api/dashboard**', (route) => {
    const method = route.request().method();
    const pathname = new URL(route.request().url()).pathname;
    if (!signedIn) {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'UNAUTHENTICATED' }),
      });
    }
    if (pathname === '/api/dashboard/adoption' && method === 'POST') {
      adoptionPosts += 1;
      const input: unknown = JSON.parse(route.request().postData() ?? 'null');
      requests.push(input);
      if (
        typeof input !== 'object' ||
        input === null ||
        !('requestId' in input) ||
        typeof input.requestId !== 'string' ||
        !('decision' in input)
      ) {
        throw new Error('Invalid adoption fixture request');
      }
      if (failNextAdoptionPost) {
        failNextAdoptionPost = false;
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'UNAVAILABLE' }),
        });
      }
      if (completion !== null) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'replayed',
            completion,
            ...(completion.decision === 'yes'
              ? {
                  acknowledgement: {
                    transportVersion: 1,
                    accountWorkspaceId: accountId,
                    requestId: completion.requestId,
                    revision: '1',
                    updatedAt: timestamp,
                  },
                }
              : {}),
          }),
        });
      }
      if (input.decision === 'yes' && 'dashboard' in input) {
        cloudDashboard = input.dashboard;
        cloudRevision = '1';
        completion = {
          decision: 'yes',
          requestId: input.requestId,
          acknowledgedRevision: '1',
          timestamp,
        };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'accepted',
            completion,
            acknowledgement: {
              transportVersion: 1,
              accountWorkspaceId: accountId,
              requestId: input.requestId,
              revision: '1',
              updatedAt: timestamp,
            },
          }),
        });
      }
      if (input.decision === 'no') {
        completion = { decision: 'no', requestId: input.requestId };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'declined', completion }),
        });
      }
      throw new Error('Unexpected adoption fixture decision');
    }
    if (method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          transportVersion: 1,
          accountWorkspaceId: accountId,
          catalogueVersion,
          revision: cloudRevision,
          dashboard: cloudDashboard,
          updatedAt: cloudDashboard === null ? null : timestamp,
        }),
      });
    }
    if (method === 'PUT') {
      if (completion === null && !allowOrdinaryBeforeAdoption)
        throw new Error('Ordinary upload preceded the adoption decision');
      const input: unknown = JSON.parse(route.request().postData() ?? 'null');
      if (
        typeof input !== 'object' ||
        input === null ||
        !('requestId' in input) ||
        typeof input.requestId !== 'string' ||
        !('dashboard' in input) ||
        !('expectedRevision' in input) ||
        input.expectedRevision !== cloudRevision
      ) {
        throw new Error('Invalid ordinary dashboard fixture request');
      }
      cloudDashboard = input.dashboard;
      cloudRevision = String(BigInt(cloudRevision) + 1n);
      dashboardPuts += 1;
      if (completion === null) created = false;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          transportVersion: 1,
          accountWorkspaceId: accountId,
          requestId: input.requestId,
          revision: cloudRevision,
          updatedAt: timestamp,
        }),
      });
    }
    throw new Error(`Unexpected dashboard fixture request: ${method} ${pathname}`);
  });

  return {
    requests,
    getAdoptionPosts: () => adoptionPosts,
    getDashboardPuts: () => dashboardPuts,
    getAuthStarts: () => authStarts,
    getSessionChecks: () => sessionChecks,
    failNextAdoptionPost: () => {
      failNextAdoptionPost = true;
    },
    cancelGoogleSignIn: (authenticated: boolean) => {
      redirectToCancellableAuth = true;
      authenticateCancellableAuth = authenticated;
    },
    holdNextSession: () => {
      let release = () => {};
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      heldSessionResponse = { wait, release };
      return release;
    },
  };
}

test('ordinary account save consumes an unused offer without opening adoption recovery', async ({
  page,
  context,
}) => {
  const server = await installAdoptionServer(context, { allowOrdinaryBeforeAdoption: true });
  await page.goto('/app/dashboard');
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBeNull();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByText('Signed in as kendoka@example.test')).toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Copy your guest menus to your account' }),
  ).toHaveCount(0);

  await page.goto('/app/library?drill=international-dojo-2-hour-session');
  await expect(page.getByText('Signed in as kendoka@example.test')).toBeVisible();
  const menu = page.getByRole('dialog', { name: 'International dojo menu' });
  await menu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(menu.locator('.inline-confirmation')).toContainText('added to your dashboard');
  await expect.poll(server.getDashboardPuts).toBe(1);
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'International dojo menu' })).toBeVisible();

  for (let check = 0; check < 2; check += 1) {
    const previousChecks = server.getSessionChecks();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(server.getSessionChecks).toBeGreaterThan(previousChecks);
    await expect(page.getByText('Signed in as kendoka@example.test')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'International dojo menu' })).toBeVisible();
    await expect(
      page.getByRole('dialog', { name: 'Copy your guest menus to your account' }),
    ).toHaveCount(0);
    await expect(page.getByText('decision confirmed')).toHaveCount(0);
  }
  expect(server.getAdoptionPosts()).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBeNull();
});

function useCancellableAuthRoute(
  server: Awaited<ReturnType<typeof installAdoptionServer>>,
  authenticated = false,
): void {
  server.cancelGoogleSignIn(authenticated);
}

async function dispatchPersistedPageShow(page: Page): Promise<void> {
  // Chromium can decline BFCache for a routed OAuth fixture. Exercise the persisted
  // event on the returned document after its ordinary navigation has settled.
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
}

async function addGuestMenu(page: Page): Promise<string> {
  await page.goto('/app/library?drill=junior-high-kendo-club');
  await expect(page.locator('.account-google-entry')).toHaveCount(1);
  const menu = page.getByRole('dialog', { name: 'Junior-high school dojo menu' });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(menu.locator('.inline-confirmation')).toContainText('added to your dashboard');
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();
  const raw = await page.evaluate(() => localStorage.getItem('kendo-menu'));
  expect(raw).not.toBeNull();
  return raw ?? '';
}

test('Google entry stays in the account header row at tablet width', async ({ page, context }) => {
  await installAdoptionServer(context);
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/app');
  const entry = page.getByRole('button', { name: 'Continue with Google' });
  await expect(entry).toBeVisible();
  await expect(entry).toHaveCSS('grid-area', 'account');
  const brand = await page.locator('.top-bar .brand-lockup').boundingBox();
  const button = await entry.boundingBox();
  expect(brand).not.toBeNull();
  expect(button).not.toBeNull();
  if (brand === null || button === null) return;
  expect(button.y).toBeGreaterThan(brand.y + brand.height);
  expect(button.x + button.width).toBeLessThanOrEqual(800);
});

test('Google entry offers a non-dismissable Yes copy and later guest edits remain separate', async ({
  page,
  context,
}) => {
  const server = await installAdoptionServer(context);
  await page.goto('/app');
  await expect(page.locator('.account-google-entry')).toHaveCount(1);
  const guestBefore = await addGuestMenu(page);

  await page.getByRole('button', { name: 'Continue with Google' }).click();
  const offer = page.getByRole('dialog', { name: 'Copy your guest menus to your account' });
  await expect(offer).toBeVisible();
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true');
  await expect(offer).toContainText('1');
  await page.keyboard.press('Escape');
  await expect(offer).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(offer).toBeVisible();
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press('Tab');
    expect(await offer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await offer.getByRole('button', { name: 'Yes' }).click();
  await expect(offer).toHaveCount(0);
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden');
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.getByText('Signed in as kendoka@example.test')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestBefore);
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0]).toMatchObject({
    decision: 'yes',
    transportVersion: 1,
    expectedAccountWorkspaceId: accountId,
    expectedRevision: '0',
    catalogueVersion,
    dashboard: { version: 10, state: { dashboardEntries: [expect.any(Object)] } },
  });

  await page.reload();
  await expect(page.getByText('Signed in as kendoka@example.test')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();
  await expect(offer).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestBefore);
  await page.goto('/app/library?drill=senior-high-school-kendo-club');
  await expect(page.locator('.account-google-entry')).toHaveCount(1);
  const guestMenu = page.getByRole('dialog', { name: 'Senior High School dojo menu' });
  await guestMenu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(guestMenu.locator('.inline-confirmation')).toContainText('added to your dashboard');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('kendo-menu')))
    .not.toBe(guestBefore);
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'Senior High School dojo menu' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByText('Signed in as kendoka@example.test')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Senior High School dojo menu' })).toHaveCount(0);
  await expect(offer).toHaveCount(0);
  expect(server.getAdoptionPosts()).toBe(1);

  const guestAfterGuestEdit = await page.evaluate(() => localStorage.getItem('kendo-menu'));
  await page.goto('/app/library?drill=international-dojo-2-hour-session');
  await expect(page.getByText('Signed in as kendoka@example.test')).toBeVisible();
  const accountMenu = page.getByRole('dialog', { name: 'International dojo menu' });
  await accountMenu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(accountMenu.locator('.inline-confirmation')).toContainText(
    'added to your dashboard',
  );
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'International dojo menu' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestAfterGuestEdit);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'Senior High School dojo menu' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'International dojo menu' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestAfterGuestEdit);
});

test('adoption retry stays modal and restores main focus after accepted completion', async ({
  page,
  context,
}) => {
  const server = await installAdoptionServer(context);
  const guestBefore = await addGuestMenu(page);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  const offer = page.getByRole('dialog', { name: 'Copy your guest menus to your account' });
  await expect(offer).toBeVisible();
  server.failNextAdoptionPost();
  await offer.getByRole('button', { name: 'Yes, copy menus' }).click();

  await expect(offer.getByRole('alert')).toContainText('Your choice is saved for recovery');
  const retry = offer.getByRole('button', { name: 'Retry saved choice' });
  await expect(retry).toBeFocused();
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true');

  await retry.click();
  await expect(offer).toHaveCount(0);
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden');
  await expect(page.locator('#main-content')).toBeFocused();
  expect(server.requests).toHaveLength(2);
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestBefore);
});

test('No is permanent for an empty returning account and leaves guest bytes untouched', async ({
  page,
  context,
}) => {
  const server = await installAdoptionServer(context);
  await page.goto('/app');
  const guestBefore = await addGuestMenu(page);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  const offer = page.getByRole('dialog', { name: 'Copy your guest menus to your account' });
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'No' }).click();
  await expect(offer).toHaveCount(0);
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.getByText('Signed in as kendoka@example.test')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toHaveCount(0);
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0]).toMatchObject({
    decision: 'no',
    transportVersion: 1,
    expectedAccountWorkspaceId: accountId,
  });
  const noRequest = server.requests[0];
  if (typeof noRequest !== 'object' || noRequest === null) {
    throw new Error('Expected a No request object');
  }
  expect(Object.keys(noRequest).sort()).toEqual([
    'decision',
    'expectedAccountWorkspaceId',
    'requestId',
    'transportVersion',
  ]);
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestBefore);

  await page.reload();
  await expect(page.getByText('Signed in as kendoka@example.test')).toBeVisible();
  await expect(offer).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestBefore);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByText('Signed in as kendoka@example.test')).toBeVisible();
  await expect(offer).toHaveCount(0);
  expect(server.getAdoptionPosts()).toBe(1);
});

test('Google navigation waits for the held guest write and its final readback', async ({
  page,
  context,
}) => {
  const server = await installAdoptionServer(context);
  const owner = await context.newPage();
  await owner.goto('/app');
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
  await page.goto('/app/library?drill=junior-high-kendo-club');
  const menu = page.getByRole('dialog', { name: 'Junior-high school dojo menu' });
  await menu.getByRole('button', { name: 'Add to dashboard' }).click();
  await menu.getByRole('button', { name: 'Close Junior-high school dojo menu details.' }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Saving before sign-in' })).toBeVisible();
  expect(server.getAuthStarts()).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBeNull();
  await owner.evaluate(() => window.dispatchEvent(new Event('release-test-guest-lock')));
  await expect(
    page.getByRole('dialog', { name: 'Copy your guest menus to your account' }),
  ).toBeVisible();
  expect(server.getAuthStarts()).toBe(1);
  const raw = await page.evaluate(() => localStorage.getItem('kendo-menu'));
  expect(raw).toContain('junior-high-kendo-club');
  await owner.close();
});

test('failed guest write keeps the page and store available for retry', async ({
  page,
  context,
}) => {
  const server = await installAdoptionServer(context);
  await page.addInitScript(() => {
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    Object.defineProperty(window.localStorage, 'setItem', {
      configurable: true,
      value: (key: string, value: string) => {
        if (key === 'kendo-menu')
          throw new DOMException('Guest write failed', 'QuotaExceededError');
        return originalSetItem(key, value);
      },
    });
  });
  await page.goto('/app/library?drill=junior-high-kendo-club');
  const menu = page.getByRole('dialog', { name: 'Junior-high school dojo menu' });
  await menu.getByRole('button', { name: 'Add to dashboard' }).click();
  await menu.getByRole('button', { name: 'Close Junior-high school dojo menu details.' }).click();
  await expect(page.getByRole('heading', { name: 'Changes are not saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Guest changes could not be saved' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry sign-in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry sign-in' })).toBeFocused();
  expect(server.getAuthStarts()).toBe(0);
  await expect(page).toHaveURL(/\/app\/library/);
  await page
    .locator('a[href="/app/dashboard"]')
    .first()
    .evaluate((element) => {
      if (!(element instanceof HTMLAnchorElement)) throw new Error('Dashboard link missing');
      element.click();
    });
  await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();
});

test('storage recovery takes focus when it replaces the adoption dialog', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    let failAccountReads = false;
    window.addEventListener('e2e-fail-account-storage-read', () => {
      failAccountReads = true;
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (
      this: IDBObjectStore,
      query: IDBValidKey | IDBKeyRange,
    ): IDBRequest {
      if (failAccountReads) throw new DOMException('Injected storage failure', 'UnknownError');
      return originalGet.call(this, query);
    };
  });
  await installAdoptionServer(context);
  await addGuestMenu(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  const offer = page.getByRole('dialog', { name: 'Copy your guest menus to your account' });
  await expect(offer).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-fail-account-storage-read')));
  await offer.getByRole('button', { name: 'Yes, copy menus' }).click();
  await expect(page.getByRole('heading', { name: 'Recovering account storage' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry' })).toBeFocused();
});

test('confirmed adoption storage failure focuses account recovery without changing guest data', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    // The pending choice still commits. Fail only the acknowledgement written after
    // the server accepts it, so the modal is replaced by generic account recovery.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ): IDBRequest<IDBValidKey> {
      if (
        typeof value === 'object' &&
        value !== null &&
        'kind' in value &&
        value.kind === 'ack' &&
        'value' in value &&
        typeof value.value === 'object' &&
        value.value !== null &&
        'status' in value.value &&
        value.value.status === 'acknowledged' &&
        'revision' in value.value &&
        value.value.revision === '1'
      ) {
        throw new DOMException('Injected account acknowledgement failure', 'UnknownError');
      }
      return originalPut.call(this, value, key);
    };
  });
  const server = await installAdoptionServer(context);
  const guestBefore = await addGuestMenu(page);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  const offer = page.getByRole('dialog', { name: 'Copy your guest menus to your account' });
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'Yes, copy menus' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your account workspace could not be opened' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeFocused();
  await expect(offer).toHaveCount(0);
  expect(server.getAdoptionPosts()).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestBefore);
});

test('guest sign-in timeout keeps the workspace available when its lock never releases', async ({
  page,
  context,
}) => {
  const server = await installAdoptionServer(context);
  const owner = await context.newPage();
  await owner.goto('/app');
  await owner.evaluate(
    () =>
      new Promise<void>((acquired) => {
        void navigator.locks.request(
          'kendo-menu:guest',
          () =>
            new Promise<void>(() => {
              acquired();
            }),
        );
      }),
  );
  await page.goto('/app/library?drill=junior-high-kendo-club');
  const menu = page.getByRole('dialog', { name: 'Junior-high school dojo menu' });
  await menu.getByRole('button', { name: 'Add to dashboard' }).click();
  await menu.getByRole('button', { name: 'Close Junior-high school dojo menu details.' }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Saving before sign-in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry sign-in' })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole('button', { name: 'Retry sign-in' })).toBeFocused();
  expect(server.getAuthStarts()).toBe(0);
  await page
    .locator('a[href="/app/dashboard"]')
    .first()
    .evaluate((element) => {
      if (!(element instanceof HTMLAnchorElement)) throw new Error('Dashboard link missing');
      element.click();
    });
  await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();
  await owner.close();
});

test('a guest lock released after the sign-in timeout cannot navigate to Google', async ({
  page,
  context,
}) => {
  const server = await installAdoptionServer(context);
  const owner = await context.newPage();
  await owner.goto('/app');
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
  await page.goto('/app/library?drill=junior-high-kendo-club');
  const menu = page.getByRole('dialog', { name: 'Junior-high school dojo menu' });
  await menu.getByRole('button', { name: 'Add to dashboard' }).click();
  await menu.getByRole('button', { name: 'Close Junior-high school dojo menu details.' }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('button', { name: 'Retry sign-in' })).toBeVisible({ timeout: 8_000 });
  expect(server.getAuthStarts()).toBe(0);

  await owner.evaluate(() => window.dispatchEvent(new Event('release-test-guest-lock')));
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kendo-menu'))).not.toBeNull();
  await expect(page.getByRole('button', { name: 'Retry sign-in' })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/library/);
  expect(server.getAuthStarts()).toBe(0);
  await page.getByRole('button', { name: 'Retry sign-in' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Copy your guest menus to your account' }),
  ).toBeVisible();
  expect(server.getAuthStarts()).toBe(1);
  await owner.close();
});

test('BFCache return after cancelled Google sign-in verifies before reopening the guest workspace', async ({
  page,
  context,
}) => {
  const server = await installAdoptionServer(context);
  await addGuestMenu(page);
  useCancellableAuthRoute(server);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('button', { name: 'Cancel sign-in' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel sign-in' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  const previousChecks = server.getSessionChecks();
  const releaseSession = server.holdNextSession();
  await dispatchPersistedPageShow(page);
  await expect(page.getByRole('heading', { name: 'Checking account status' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toHaveCount(0);
  await expect.poll(() => server.getSessionChecks()).toBeGreaterThan(previousChecks);
  releaseSession();
  await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});

test('BFCache return with an authenticated session stays gated until fresh verification', async ({
  page,
  context,
}) => {
  const server = await installAdoptionServer(context);
  const guestBefore = await addGuestMenu(page);
  useCancellableAuthRoute(server, true);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('button', { name: 'Cancel sign-in' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel sign-in' }).click();
  await expect(page.getByText('Signed in as kendoka@example.test')).toBeVisible();
  const previousChecks = server.getSessionChecks();
  const releaseSession = server.holdNextSession();
  await dispatchPersistedPageShow(page);
  // A focus event during the held pageshow request must not supersede it and
  // strand the restored-session gate behind a false Retry state.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Checking account status' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toHaveCount(0);
  await expect.poll(() => server.getSessionChecks()).toBeGreaterThan(previousChecks);
  releaseSession();
  await expect(page.getByText('Signed in as kendoka@example.test')).toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Copy your guest menus to your account' }),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestBefore);
});
