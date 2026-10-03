import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const accountId = '01234567-89ab-4cde-8fab-0123456789ab';
const catalogueVersion = 'a'.repeat(64);
const timestamp = '2026-09-30T10:00:00.000Z';
const csrfCookie = '__Host-kendomenu-csrf=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

type AdoptionCompletion =
  | {
      readonly decision: 'yes';
      readonly requestId: string;
      readonly acknowledgedRevision: '1';
      readonly timestamp: string;
    }
  | { readonly decision: 'no'; readonly requestId: string };

interface PeerAdoptionServer {
  readonly requests: unknown[];
  readonly dashboardRequests: unknown[];
  getAdoptionPosts(): number;
  getDashboardPuts(): number;
  hasAdoptionCapability(): boolean;
  allowDashboardWrites(): void;
  advanceCloudRevision(): void;
}

async function installPeerAdoptionServer(
  context: BrowserContext,
  {
    allowOrdinaryBeforeAdoption = false,
    pauseOrdinaryWrites = false,
  }: {
    readonly allowOrdinaryBeforeAdoption?: boolean;
    readonly pauseOrdinaryWrites?: boolean;
  } = {},
): Promise<PeerAdoptionServer> {
  let signedIn = false;
  let created = false;
  let completion: AdoptionCompletion | null = null;
  let cloudDashboard: unknown = null;
  let cloudRevision = '0';
  let adoptionPosts = 0;
  let dashboardPuts = 0;
  let ordinaryWritesAllowed = !pauseOrdinaryWrites;
  const requests: unknown[] = [];
  const dashboardRequests: unknown[] = [];

  await context.addInitScript((cookie) => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => cookie,
    });
  }, csrfCookie);
  await context.route('**/api/auth/google/start', (route) => {
    signedIn = true;
    created = true;
    return route.fulfill({ status: 302, headers: { location: '/app/dashboard' } });
  });
  await context.route('**/api/session', (route) => {
    if (route.request().method() === 'DELETE') {
      signedIn = false;
      return route.fulfill({ status: 204 });
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
        throw new Error('Invalid peer adoption fixture request');
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
      throw new Error('Unexpected peer adoption fixture decision');
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
      dashboardPuts += 1;
      if (completion === null && !allowOrdinaryBeforeAdoption)
        throw new Error('Ordinary upload preceded adoption completion');
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
      dashboardRequests.push(input);
      if (!ordinaryWritesAllowed) return route.abort('failed');
      cloudDashboard = input.dashboard;
      cloudRevision = String(BigInt(cloudRevision) + 1n);
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
    throw new Error(`Unexpected peer dashboard fixture request: ${method} ${pathname}`);
  });

  return {
    requests,
    dashboardRequests,
    getAdoptionPosts: () => adoptionPosts,
    getDashboardPuts: () => dashboardPuts,
    hasAdoptionCapability: () => completion === null && created,
    allowDashboardWrites: () => {
      ordinaryWritesAllowed = true;
    },
    advanceCloudRevision: () => {
      if (cloudDashboard === null || cloudRevision !== '1') {
        throw new Error('Expected an accepted cloud dashboard before advancement');
      }
      cloudRevision = '2';
    },
  };
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

async function ensureAdoptionOffer(page: Page): Promise<void> {
  const offer = page.getByRole('dialog', { name: 'Copy your guest menus to your account' });
  const retry = page.getByRole('button', { name: 'Retry' });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expect(offer.or(retry)).toBeVisible();
    const result = await offer.or(retry).evaluateAll((elements) => {
      if (elements.some((element) => element.getAttribute('role') === 'dialog')) return 'offered';
      const retryButton = elements.find(
        (element): element is HTMLButtonElement => element instanceof HTMLButtonElement,
      );
      retryButton?.click();
      return retryButton === undefined ? 'waiting' : 'retried';
    });
    if (result === 'offered') return;
  }
  await expect(offer).toBeVisible();
}

async function clickHiddenTabButton(page: Page, name: 'Yes' | 'No'): Promise<void> {
  const button = page
    .getByRole('dialog', { name: 'Copy your guest menus to your account' })
    .getByRole('button', { name });
  await button.evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) throw new Error('Adoption choice is missing');
    element.click();
  });
}

async function openTwoOffers(
  pageA: Page,
  context: BrowserContext,
  {
    disablePeerBroadcast = false,
    allowOrdinaryBeforeAdoption = false,
    pauseOrdinaryWrites = false,
  }: {
    readonly disablePeerBroadcast?: boolean;
    readonly allowOrdinaryBeforeAdoption?: boolean;
    readonly pauseOrdinaryWrites?: boolean;
  } = {},
): Promise<{
  readonly pageB: Page;
  readonly guestRaw: string;
  readonly server: PeerAdoptionServer;
}> {
  const server = await installPeerAdoptionServer(context, {
    allowOrdinaryBeforeAdoption,
    pauseOrdinaryWrites,
  });
  const guestRaw = await addGuestMenu(pageA);
  await pageA.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(pageA.getByText('Signed in as kendoka@example.test')).toBeVisible();
  await expect(
    pageA.getByRole('dialog', { name: 'Copy your guest menus to your account' }),
  ).toBeVisible();
  const pageB = await context.newPage();
  if (disablePeerBroadcast) {
    await pageB.addInitScript(() => {
      Object.defineProperty(window, 'BroadcastChannel', { configurable: true, value: undefined });
    });
  }
  await pageB.goto('/app/dashboard');
  await expect(pageB.getByText('Signed in as kendoka@example.test')).toBeVisible();
  await ensureAdoptionOffer(pageB);
  // Rechecking the first tab can contend for the account sync lock while the other tab
  // initializes. Retry it without activating the hidden tab so B keeps its stale offer.
  await ensureAdoptionOffer(pageA);
  return { pageB, guestRaw, server };
}

interface PeerDatabaseState {
  readonly acknowledgement: unknown;
  readonly cacheGeneration: number | null;
  readonly cacheIdentity: string | null;
  readonly cacheValue: string | null;
  readonly hasPendingRequest: boolean;
  readonly pendingRequest: unknown;
}

async function readPeerDatabaseState(page: Page): Promise<PeerDatabaseState> {
  return page.evaluate(async (targetAccountId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kendo-menu-account-storage', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    try {
      const transaction = database.transaction('records', 'readonly');
      const store = transaction.objectStore('records');
      const read = (key: string): Promise<unknown> =>
        new Promise((resolve, reject) => {
          const request = store.get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
        });
      const [cache, acknowledgement, pending] = await Promise.all([
        read(`${targetAccountId}:cache`),
        read(`${targetAccountId}:ack`),
        read(`${targetAccountId}:pending-request`),
      ]);
      const property = (value: unknown, key: string): unknown =>
        typeof value === 'object' && value !== null
          ? Object.entries(value).find(([candidate]) => candidate === key)?.[1]
          : undefined;
      const generation = property(cache, 'generation');
      const identity = property(cache, 'identity');
      const cacheValue = property(cache, 'cacheValue');
      const pendingPayload = property(pending, 'payload');
      return {
        acknowledgement: property(acknowledgement, 'value') ?? null,
        cacheGeneration: typeof generation === 'number' ? generation : null,
        cacheIdentity: typeof identity === 'string' ? identity : null,
        cacheValue: typeof cacheValue === 'string' ? cacheValue : null,
        hasPendingRequest: pending !== undefined,
        pendingRequest:
          typeof pendingPayload === 'string' ? (JSON.parse(pendingPayload) as unknown) : null,
      };
    } finally {
      database.close();
    }
  }, accountId);
}

test('a revision-zero account PUT keeps priority when another tab later creates guest menus', async ({
  page: pageA,
  context,
}) => {
  const server = await installPeerAdoptionServer(context, {
    allowOrdinaryBeforeAdoption: true,
    pauseOrdinaryWrites: true,
  });
  await pageA.goto('/app/dashboard');
  expect(await pageA.evaluate(() => localStorage.getItem('kendo-menu'))).toBeNull();

  const pageB = await context.newPage();
  await pageB.addInitScript(() => {
    Object.defineProperty(window, 'BroadcastChannel', { configurable: true, value: undefined });
  });
  await pageB.goto('/app/library?drill=junior-high-kendo-club');
  const guestMenu = pageB.getByRole('dialog', { name: 'Junior-high school dojo menu' });
  await expect(guestMenu).toBeVisible();
  await guestMenu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect.poll(() => pageB.evaluate(() => localStorage.getItem('kendo-menu'))).not.toBeNull();
  const guestRaw = await pageB.evaluate(() => localStorage.getItem('kendo-menu'));
  if (guestRaw === null) throw new Error('Expected the peer guest workspace to persist');
  await pageB.evaluate(() => localStorage.removeItem('kendo-menu'));

  await pageA.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(pageA.getByText('Signed in as kendoka@example.test')).toBeVisible();
  await expect(
    pageA.getByRole('dialog', { name: 'Copy your guest menus to your account' }),
  ).toHaveCount(0);
  await pageA.goto('/app/library?drill=international-dojo-2-hour-session');
  const accountMenu = pageA.getByRole('dialog', { name: 'International dojo menu' });
  await accountMenu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect.poll(() => server.getDashboardPuts()).toBeGreaterThan(0);

  const firstRequest = server.dashboardRequests[0];
  expect(firstRequest).toMatchObject({ expectedRevision: '0' });
  const preparedState = await readPeerDatabaseState(pageA);
  expect(preparedState.acknowledgement).toMatchObject({ status: 'acknowledged', revision: '0' });
  expect(preparedState.pendingRequest).toMatchObject({
    kind: 'dashboard-put',
    request: firstRequest,
  });
  expect(server.hasAdoptionCapability()).toBe(true);

  await pageB.evaluate((raw) => localStorage.setItem('kendo-menu', raw), guestRaw);
  await pageA.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    pageA.getByRole('dialog', { name: 'Copy your guest menus to your account' }),
  ).toHaveCount(0);
  expect(server.getAdoptionPosts()).toBe(0);

  // Reload replays the same durable request while the fixture still fails the network call.
  await pageA.reload();
  await expect(pageA.getByText('Signed in as kendoka@example.test')).toBeVisible();
  await expect(
    pageA.getByRole('dialog', { name: 'Copy your guest menus to your account' }),
  ).toHaveCount(0);
  expect((await readPeerDatabaseState(pageA)).pendingRequest).toMatchObject({
    kind: 'dashboard-put',
    request: firstRequest,
  });
  for (const request of server.dashboardRequests) expect(request).toEqual(firstRequest);
  expect(await pageB.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestRaw);

  server.allowDashboardWrites();
  await pageA.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect
    .poll(async () => (await readPeerDatabaseState(pageA)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '1' });
  expect((await readPeerDatabaseState(pageA)).hasPendingRequest).toBe(false);
  expect(server.hasAdoptionCapability()).toBe(false);
  expect(server.getAdoptionPosts()).toBe(0);
  for (const request of server.dashboardRequests) expect(request).toEqual(firstRequest);
  expect(await pageA.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestRaw);
  expect(await pageB.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestRaw);
  await pageB.close();
});

test('a stale offered peer reopens and replays the exact pending ordinary PUT', async ({
  page: pageA,
  context,
}) => {
  const { pageB, guestRaw, server } = await openTwoOffers(pageA, context, {
    disablePeerBroadcast: true,
    allowOrdinaryBeforeAdoption: true,
    pauseOrdinaryWrites: true,
  });
  const offerA = pageA.getByRole('dialog', { name: 'Copy your guest menus to your account' });
  const offerB = pageB.getByRole('dialog', { name: 'Copy your guest menus to your account' });

  await pageA.evaluate(() => localStorage.removeItem('kendo-menu'));
  await pageA.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(offerA).toHaveCount(0);
  await expect(offerB).toBeVisible();

  await pageA.goto('/app/library?drill=international-dojo-2-hour-session');
  const accountMenu = pageA.getByRole('dialog', { name: 'International dojo menu' });
  await expect(accountMenu).toBeVisible();
  await accountMenu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect.poll(() => server.getDashboardPuts()).toBeGreaterThan(0);
  const firstRequest = server.dashboardRequests[0];
  expect(firstRequest).toMatchObject({ expectedRevision: '0' });
  await expect
    .poll(async () => readPeerDatabaseState(pageA))
    .toMatchObject({ cacheGeneration: 1, hasPendingRequest: true });

  await pageA.evaluate((raw) => localStorage.setItem('kendo-menu', raw), guestRaw);
  await clickHiddenTabButton(pageB, 'Yes');
  await expect(offerB).toHaveCount(0);
  await expect(pageB.getByRole('heading', { name: 'International dojo menu' })).toBeVisible();
  expect((await readPeerDatabaseState(pageB)).pendingRequest).toMatchObject({
    kind: 'dashboard-put',
    request: firstRequest,
  });
  expect(server.getAdoptionPosts()).toBe(0);
  expect(await pageB.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestRaw);

  server.allowDashboardWrites();
  await pageB.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect
    .poll(async () => (await readPeerDatabaseState(pageB)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '1', generation: 1 });
  expect((await readPeerDatabaseState(pageB)).hasPendingRequest).toBe(false);
  expect(server.hasAdoptionCapability()).toBe(false);
  expect(server.getAdoptionPosts()).toBe(0);
  for (const request of server.dashboardRequests) expect(request).toEqual(firstRequest);
  expect(await pageA.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestRaw);
  expect(await pageB.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestRaw);
  await pageB.close();
});

test('a stale offer reopens two account edits acknowledged at generation two and revision one', async ({
  page: pageA,
  context,
}) => {
  const { pageB, guestRaw, server } = await openTwoOffers(pageA, context, {
    allowOrdinaryBeforeAdoption: true,
  });
  const offerA = pageA.getByRole('dialog', { name: 'Copy your guest menus to your account' });
  const offerB = pageB.getByRole('dialog', { name: 'Copy your guest menus to your account' });

  await pageA.evaluate(() => localStorage.removeItem('kendo-menu'));
  await pageA.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(offerA).toHaveCount(0);
  await expect(offerB).toBeVisible();

  await pageA.goto('/app/library?drill=international-dojo-2-hour-session');
  await expect(pageA.getByText('Signed in as kendoka@example.test')).toBeVisible();
  await expect(pageA.getByRole('heading', { name: 'Checking your guest menus' })).toHaveCount(0);
  const firstMenu = pageA.getByRole('dialog', { name: 'International dojo menu' });
  await expect(firstMenu).toBeVisible();
  await firstMenu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect.poll(async () => (await readPeerDatabaseState(pageA)).cacheGeneration).toBe(1);
  await firstMenu
    .getByRole('button', { name: 'Close International dojo menu details.' })
    .evaluate((element) => {
      if (!(element instanceof HTMLButtonElement)) throw new Error('Session close button missing');
      element.click();
    });
  await pageA
    .locator('article')
    .filter({ has: pageA.getByRole('heading', { name: 'Senior High School dojo menu' }) })
    .getByRole('link', { name: 'View session' })
    .evaluate((element) => {
      if (!(element instanceof HTMLAnchorElement)) throw new Error('Session detail link missing');
      element.click();
    });
  const secondMenu = pageA.getByRole('dialog', { name: 'Senior High School dojo menu' });
  await secondMenu.getByRole('button', { name: 'Add to dashboard' }).evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) throw new Error('Account add button missing');
    element.click();
  });
  await expect.poll(async () => (await readPeerDatabaseState(pageA)).cacheGeneration).toBe(2);
  await expect
    .poll(async () => readPeerDatabaseState(pageA))
    .toMatchObject({
      acknowledgement: { status: 'acknowledged', revision: '1', generation: 2 },
      cacheGeneration: 2,
      hasPendingRequest: false,
    });
  expect(server.getDashboardPuts()).toBe(1);
  const acknowledged = await readPeerDatabaseState(pageA);
  expect(acknowledged.cacheValue).toContain('international-dojo-2-hour-session');
  expect(acknowledged.cacheValue).toContain('senior-high-school-kendo-club');

  await pageA.evaluate((raw) => localStorage.setItem('kendo-menu', raw), guestRaw);
  if (await offerB.isVisible()) await clickHiddenTabButton(pageB, 'Yes');
  else await pageB.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(offerB).toHaveCount(0);
  await expect(pageB.getByRole('heading', { name: 'International dojo menu' })).toBeVisible();
  await expect(pageB.getByRole('heading', { name: 'Senior High School dojo menu' })).toBeVisible();
  const reopenedState = await readPeerDatabaseState(pageB);
  expect(reopenedState).toMatchObject({
    acknowledgement: { status: 'acknowledged', revision: '1', generation: 2 },
    cacheGeneration: 2,
    cacheValue: acknowledged.cacheValue,
    hasPendingRequest: false,
  });
  expect(server.getAdoptionPosts()).toBe(0);
  expect(server.getDashboardPuts()).toBe(1);
  expect(await pageA.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestRaw);
  expect(await pageB.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestRaw);
  await pageB.close();
});

test('a stale offered tab reopens an ordinary peer save after its capability is consumed', async ({
  page: pageA,
  context,
}) => {
  const { pageB, guestRaw, server } = await openTwoOffers(pageA, context, {
    allowOrdinaryBeforeAdoption: true,
  });
  const offerA = pageA.getByRole('dialog', { name: 'Copy your guest menus to your account' });
  const offerB = pageB.getByRole('dialog', { name: 'Copy your guest menus to your account' });

  // A rechecks after the shared guest copy is temporarily removed. B retains its
  // already displayed offer while A makes the account's first ordinary edit.
  await pageA.evaluate(() => localStorage.removeItem('kendo-menu'));
  await pageA.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(offerA).toHaveCount(0);
  await expect(offerB).toBeVisible();
  await pageA.goto('/app/library?drill=international-dojo-2-hour-session');
  await expect(pageA.getByText('Signed in as kendoka@example.test')).toBeVisible();
  const menu = pageA.getByRole('dialog', { name: 'International dojo menu' });
  await menu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect.poll(() => server.getDashboardPuts()).toBe(1);
  await expect
    .poll(async () => (await readPeerDatabaseState(pageA)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '1' });
  await pageA.evaluate((raw) => localStorage.setItem('kendo-menu', raw), guestRaw);

  await pageB.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(offerB).toHaveCount(0);
  await expect(pageB.getByRole('heading', { name: 'International dojo menu' })).toBeVisible();
  expect(server.getAdoptionPosts()).toBe(0);
  expect(await pageB.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestRaw);
  await pageB.close();
});

test('a peer adopts once, the other tab reopens the accepted cache, and reload stays idempotent', async ({
  page: pageA,
  context,
}) => {
  const { pageB, guestRaw, server } = await openTwoOffers(pageA, context);
  const offerB = pageB.getByRole('dialog', { name: 'Copy your guest menus to your account' });

  await clickHiddenTabButton(pageA, 'Yes');
  await expect(
    pageA.getByRole('dialog', { name: 'Copy your guest menus to your account' }),
  ).toHaveCount(0);
  await expect(pageA.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();
  await expect(offerB).toBeVisible();
  const completedState = await readPeerDatabaseState(pageB);
  expect(completedState).toMatchObject({
    acknowledgement: {
      status: 'acknowledged',
      accountWorkspaceId: accountId,
      revision: '1',
      requestId: expect.any(String),
      cacheIdentity: completedState.cacheIdentity,
      generation: 1,
      updatedAt: timestamp,
    },
    cacheGeneration: 1,
    cacheValue: guestRaw,
    hasPendingRequest: false,
  });
  expect(completedState.cacheIdentity).not.toBeNull();
  expect(server.getDashboardPuts()).toBe(0);
  expect(await pageA.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestRaw);
  expect(await pageB.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestRaw);

  // The second tab still has the old offer open. Its choice must first observe the
  // shared terminal record and rehydrate it instead of submitting a second decision.
  // Close A so only B can perform the next cloud check, then simulate a later
  // authenticated cloud revision with the same dashboard bytes.
  await pageA.close();
  server.advanceCloudRevision();
  await offerB.getByRole('button', { name: 'Yes' }).click();
  await expect(offerB).toHaveCount(0);
  await expect(pageB.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();
  await expect
    .poll(async () => (await readPeerDatabaseState(pageB)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '2', requestId: null });
  expect(server.getAdoptionPosts()).toBe(1);
  expect(server.getDashboardPuts()).toBe(0);

  await pageB.reload();
  await expect(pageB.getByText('Signed in as kendoka@example.test')).toBeVisible();
  await expect(pageB.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();
  await expect(
    pageB.getByRole('dialog', { name: 'Copy your guest menus to your account' }),
  ).toHaveCount(0);
  expect(server.getAdoptionPosts()).toBe(1);
  expect(await pageB.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestRaw);
  await pageB.close();
});

test('a peer decline remains empty when a stale offer tries to choose Yes', async ({
  page: pageA,
  context,
}) => {
  const { pageB, guestRaw, server } = await openTwoOffers(pageA, context);
  const offerB = pageB.getByRole('dialog', { name: 'Copy your guest menus to your account' });

  await clickHiddenTabButton(pageA, 'No');
  await expect(
    pageA.getByRole('dialog', { name: 'Copy your guest menus to your account' }),
  ).toHaveCount(0);
  await expect(pageA.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect(offerB).toBeVisible();
  await expect
    .poll(() => readPeerDatabaseState(pageB))
    .toMatchObject({
      acknowledgement: { status: 'adoption-declined' },
      cacheGeneration: 0,
      hasPendingRequest: false,
    });

  // A stale Yes must not replace the completed empty cache or submit an opposite choice.
  await offerB.getByRole('button', { name: 'Yes' }).click();
  await expect(offerB).toHaveCount(0);
  await expect(pageB.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect(pageB.getByRole('heading', { name: 'Junior-high school dojo menu' })).toHaveCount(0);
  expect(server.getAdoptionPosts()).toBe(1);
  await pageB.reload();
  await expect(pageB.getByText('Signed in as kendoka@example.test')).toBeVisible();
  await expect(pageB.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect(
    pageB.getByRole('dialog', { name: 'Copy your guest menus to your account' }),
  ).toHaveCount(0);
  expect(await pageA.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestRaw);
  expect(await pageB.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestRaw);
  await pageB.close();
});

test('a newer peer cache is preserved and a stale generation-zero tab enters recovery', async ({
  page: pageA,
  context,
}) => {
  const { pageB, guestRaw, server } = await openTwoOffers(pageA, context, {
    disablePeerBroadcast: true,
  });
  const offerB = pageB.getByRole('dialog', { name: 'Copy your guest menus to your account' });

  await clickHiddenTabButton(pageA, 'Yes');
  await expect(pageA.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();
  await expect(offerB).toBeVisible();
  await pageA.goto('/app/library?drill=international-dojo-2-hour-session');
  await expect(pageA.getByText('Signed in as kendoka@example.test')).toBeVisible();
  const editedMenu = pageA.getByRole('dialog', { name: 'International dojo menu' });
  await editedMenu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(editedMenu.locator('.inline-confirmation')).toContainText('added to your dashboard');
  await expect
    .poll(async () => (await readPeerDatabaseState(pageA)).cacheGeneration)
    .toBeGreaterThan(1);
  const advancedState = await readPeerDatabaseState(pageA);
  expect(advancedState.cacheValue).toContain('international-dojo-2-hour-session');
  expect(advancedState.acknowledgement).toMatchObject({ status: 'acknowledged' });
  await expect(offerB).toBeVisible();

  // B acts on its still-open generation-zero offer after A has made a real edit.
  // The shared cache is now generation two, so B must enter recovery.
  await clickHiddenTabButton(pageB, 'No');
  await expect(
    pageB.getByRole('heading', { name: 'Your account workspace could not be opened' }),
  ).toBeVisible();
  await expect(pageB.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(offerB).toHaveCount(0);
  const protectedState = await readPeerDatabaseState(pageB);
  expect(protectedState.cacheGeneration).toBe(advancedState.cacheGeneration);
  expect(protectedState.cacheValue).toBe(advancedState.cacheValue);
  expect(protectedState.cacheValue).toContain('international-dojo-2-hour-session');
  expect(protectedState.acknowledgement).toEqual(advancedState.acknowledgement);
  expect(server.getAdoptionPosts()).toBe(1);
  expect(await pageA.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestRaw);
  expect(await pageB.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestRaw);
  await pageB.close();
});
