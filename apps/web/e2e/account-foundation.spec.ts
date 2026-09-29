import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const accountA = '01234567-89ab-4cde-8fab-0123456789ab';
const accountB = '01234567-89ab-4cde-8fab-0123456789ac';
const catalogueVersion = 'a'.repeat(64);
const signedOutResponse = {
  status: 401,
  contentType: 'application/json',
  body: JSON.stringify({ error: 'UNAUTHENTICATED' }),
};

function session(accountId: string, email: string) {
  return {
    userId: accountId,
    verifiedGoogleEmail: email,
    adoption: { status: 'unavailable', capability: false },
  };
}

function dashboard(accountId: string) {
  return {
    transportVersion: 1,
    accountWorkspaceId: accountId,
    catalogueVersion,
    revision: '0',
    dashboard: null,
    updatedAt: null,
  };
}

async function routeAccount(
  context: BrowserContext,
  current: () => { id: string; email: string } | null,
  onLogout?: () => void | Promise<void>,
) {
  await context.route('**/api/session', async (route) => {
    if (route.request().method() === 'DELETE') {
      await onLogout?.();
      return route.fulfill({ status: 204 });
    }
    const account = current();
    return route.fulfill(
      account === null
        ? signedOutResponse
        : {
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(session(account.id, account.email)),
          },
    );
  });
  await context.route('**/api/dashboard**', (route) => {
    const account = current();
    return route.fulfill(
      account === null
        ? signedOutResponse
        : {
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(dashboard(account.id)),
          },
    );
  });
}

async function divergeAccountCache(page: Page, accountId: string): Promise<void> {
  await page.evaluate(async (verifiedAccountId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kendo-menu-account-storage', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    try {
      const transaction = database.transaction('records', 'readwrite');
      const store = transaction.objectStore('records');
      const record = await new Promise<unknown>((resolve, reject) => {
        const request = store.get(`${verifiedAccountId}:cache`);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Cache read failed'));
      });
      if (
        typeof record !== 'object' ||
        record === null ||
        !('generation' in record) ||
        typeof record.generation !== 'number' ||
        !('cacheValue' in record) ||
        typeof record.cacheValue !== 'string'
      )
        throw new Error('Expected an account cache generation');
      store.put({
        ...record,
        generation: record.generation + 1,
        cacheValue: `${record.cacheValue} `,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Cache write failed'));
      });
    } finally {
      database.close();
    }
  }, accountId);
}

async function readAccountCacheValue(page: Page, accountId: string): Promise<string> {
  return page.evaluate(async (verifiedAccountId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kendo-menu-account-storage', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    try {
      const transaction = database.transaction('records', 'readonly');
      const value = await new Promise<unknown>((resolve, reject) => {
        const request = transaction.objectStore('records').get(`${verifiedAccountId}:cache`);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Cache read failed'));
      });
      if (
        typeof value !== 'object' ||
        value === null ||
        !('cacheValue' in value) ||
        typeof value.cacheValue !== 'string'
      )
        throw new Error('Expected a confirmed account cache');
      return value.cacheValue;
    } finally {
      database.close();
    }
  }, accountId);
}

test('one signed-out pageview uses only a static path and never loads count.js', async ({
  page,
  context,
}) => {
  const pageviewRequests: string[] = [];
  const scriptRequests: string[] = [];
  await routeAccount(context, () => null);
  await page.route('https://javiermarro.goatcounter.com/count**', async (route) => {
    pageviewRequests.push(route.request().url());
    expect(route.request().headers()['referer']).toBeUndefined();
    await route.abort();
  });
  page.on('request', (request) => {
    if (request.url().includes('count.js')) scriptRequests.push(request.url());
  });

  await page.goto('/app/dashboard?email=private%40example.test&note=private');
  await expect.poll(() => pageviewRequests.length).toBe(1);
  const pixel = new URL(pageviewRequests[0] ?? 'https://invalid.test');
  expect(pixel.pathname).toBe('/count');
  expect([...pixel.searchParams.entries()]).toEqual([['p', '/app/dashboard']]);
  expect(pageviewRequests[0]).not.toContain('private');
  expect(scriptRequests).toEqual([]);
});

test('going offline after signed-out verification cancels the pending pageview', async ({
  page,
  context,
}) => {
  const pageviewRequests: string[] = [];
  await routeAccount(context, () => null);
  await page.route('https://javiermarro.goatcounter.com/**', async (route) => {
    pageviewRequests.push(route.request().url());
    await route.abort();
  });

  const sessionResponse = page.waitForResponse('**/api/session');
  await page.goto('/app');
  await sessionResponse;
  await expect(page.getByRole('status').filter({ hasText: 'Checking account status' })).toHaveCount(
    0,
  );
  await page.waitForTimeout(100);
  await context.setOffline(true);
  await page.waitForTimeout(1_100);
  expect(pageviewRequests).toEqual([]);
});

test('verified session opens only its account dashboard and sends no pageview', async ({
  page,
  context,
}) => {
  const analyticsRequests: string[] = [];
  await routeAccount(context, () => ({ id: accountA, email: 'first@example.test' }));
  await page.route('https://javiermarro.goatcounter.com/**', async (route) => {
    analyticsRequests.push(route.request().url());
    await route.abort();
  });

  await page.goto('/app/dashboard');
  await expect(page.getByText('Signed in as first@example.test')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await page.waitForTimeout(1_100);
  expect(analyticsRequests).toEqual([]);
  await expect(page.locator('script[src*="count.js"]')).toHaveCount(0);
});

test('an older superseded session check cannot overwrite a newer signed-out result', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let sessionCalls = 0;
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/session') && init?.method === 'GET') {
        sessionCalls += 1;
        document.documentElement.dataset['sessionCalls'] = String(sessionCalls);
        const response = () =>
          new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          });
        if (sessionCalls === 1) {
          return new Promise<Response>((resolve) => {
            window.addEventListener('release-first-session', () => resolve(response()), {
              once: true,
            });
          });
        }
        return Promise.resolve(response());
      }
      return originalFetch(input, init);
    };
  });

  await page.goto('/app');
  await expect
    .poll(() => page.evaluate(() => Number(document.documentElement.dataset['sessionCalls'] ?? 0)))
    .toBeGreaterThanOrEqual(1);
  // Development StrictMode may start a second mount-time check. Record the settled
  // baseline so this peer hint must cause a new request in either browser mode.
  await page.waitForTimeout(100);
  const beforePeerHint = await page.evaluate(() =>
    Number(document.documentElement.dataset['sessionCalls'] ?? 0),
  );
  await page.evaluate(() => {
    // A peer transition starts a second authoritative check while the first is held.
    const channel = new BroadcastChannel('kendomenu-account-transition-v1');
    channel.postMessage({ signal: 'verified-account-active', sender: 'test-peer' });
    channel.close();
  });
  await expect
    .poll(() => page.evaluate(() => Number(document.documentElement.dataset['sessionCalls'] ?? 0)))
    .toBeGreaterThan(beforePeerHint);
  await expect(page.getByRole('status').filter({ hasText: 'Checking account status' })).toHaveCount(
    0,
  );
  await page.evaluate(() => window.dispatchEvent(new Event('release-first-session')));
  await page.waitForTimeout(100);
  await expect(page.getByRole('status').filter({ hasText: 'Checking account status' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('status').filter({ hasText: 'Account unavailable' })).toHaveCount(0);
});

test('callback error is shown after root navigation and removed from the address', async ({
  page,
  context,
}) => {
  let sessionChecks = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/session' && request.method() === 'GET') {
      sessionChecks += 1;
    }
  });
  await routeAccount(context, () => null);
  await page.goto('/?authError=cancelled');
  await expect.poll(() => new URL(page.url()).searchParams.has('authError')).toBe(false);
  await expect(page.getByRole('alert')).toContainText('Google sign-in was cancelled.');
  await expect(page.getByRole('status').filter({ hasText: 'Checking account status' })).toHaveCount(
    0,
  );
  await page.waitForTimeout(100);
  expect(sessionChecks).toBe(1);
});

test('Use this device gates a failed account preservation and offers retry and backup', async ({
  page,
  context,
}) => {
  await routeAccount(context, () => ({ id: accountA, email: 'first@example.test' }));
  await page.goto('/app/dashboard');
  await expect(page.getByText('Signed in as first@example.test')).toBeVisible();
  await divergeAccountCache(page, accountA);

  await page.getByRole('button', { name: 'Use this device' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Recent account changes could not be saved' }),
  ).toContainText('Keep this tab open and retry or download an account backup.');
  await expect(page.getByRole('button', { name: 'Retry saving' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download account backup' })).toBeVisible();
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);
});

test('a completed sign-out in another tab hides the old account', async ({ page, context }) => {
  let current: { id: string; email: string } | null = {
    id: accountA,
    email: 'first@example.test',
  };
  await context.addInitScript(() => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '__Host-kendomenu-csrf=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
  });
  await routeAccount(
    context,
    () => current,
    () => {
      current = null;
    },
  );
  const peer = await context.newPage();
  await page.goto('/app/dashboard');
  await peer.goto('/app/dashboard');
  await expect(page.getByText('Signed in as first@example.test')).toBeVisible();
  await expect(peer.getByText('Signed in as first@example.test')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(peer.getByText('Signed in as first@example.test')).toHaveCount(0);
  await expect(peer.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await peer.close();
});

test('cross-tab sign-out preserves a failing account writer behind backup recovery', async ({
  page,
  context,
}) => {
  let current: { id: string; email: string } | null = {
    id: accountA,
    email: 'first@example.test',
  };
  await context.addInitScript(() => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '__Host-kendomenu-csrf=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
  });
  let finishLogout: (() => void) | undefined;
  const logoutGate = new Promise<void>((resolve) => {
    finishLogout = resolve;
  });
  let logoutRequested = false;
  await routeAccount(
    context,
    () => current,
    async () => {
      logoutRequested = true;
      await logoutGate;
      current = null;
    },
  );
  const peer = await context.newPage();
  await page.goto('/app/dashboard');
  await peer.goto('/app/dashboard');
  await expect(peer.getByText('Signed in as first@example.test')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect.poll(() => logoutRequested).toBe(true);
  await divergeAccountCache(peer, accountA);
  finishLogout?.();
  await expect(peer.getByRole('heading', { name: 'Saving recent account changes' })).toBeVisible();
  await expect(
    peer.getByRole('status').filter({ hasText: 'Keep this tab open and retry' }),
  ).toBeVisible();
  await expect(peer.getByText('Signed in as first@example.test')).toHaveCount(0);
  const downloadPromise = peer.waitForEvent('download');
  await peer.getByRole('button', { name: 'Download account backup' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('kendo-menu-account-recovery.json');
  const path = await download.path();
  if (path === null) throw new Error('Expected a browser account backup');
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
    version: 10,
    state: { dashboardEntries: [] },
  });
  await peer.close();
});

test('a verified account switch in another tab rechecks and replaces the old account', async ({
  page,
  context,
}) => {
  let current = { id: accountA, email: 'first@example.test' };
  await routeAccount(context, () => current);
  await page.goto('/app/dashboard');
  await expect(page.getByText('Signed in as first@example.test')).toBeVisible();

  current = { id: accountB, email: 'second@example.test' };
  const switchTab = await context.newPage();
  await switchTab.goto('/app/dashboard');
  await expect(switchTab.getByText('Signed in as second@example.test')).toBeVisible();
  await expect(page.getByText('Signed in as second@example.test')).toBeVisible();
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);
  await switchTab.close();
});

test('sign-in started in another tab hides the old account through a held switch', async ({
  page,
  context,
}) => {
  let current = { id: accountA, email: 'first@example.test' };
  await routeAccount(context, () => current);
  await page.goto('/app/dashboard');
  await expect(page.getByText('Signed in as first@example.test')).toBeVisible();
  const peer = await context.newPage();
  await peer.goto('/app/dashboard');
  await expect(peer.getByText('Signed in as first@example.test')).toBeVisible();

  await peer.evaluate(() => {
    const channel = new BroadcastChannel('kendomenu-account-transition-v1');
    channel.postMessage({ signal: 'sign-in-started', sender: 'switch-start-fixture' });
    channel.close();
  });
  await expect(page.getByRole('heading', { name: 'Checking account status' })).toBeVisible();
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);

  let releaseCheck: (() => void) | undefined;
  const checkGate = new Promise<void>((resolve) => {
    releaseCheck = resolve;
  });
  let checkStarted = false;
  await page.route('**/api/session', async (route) => {
    checkStarted = true;
    await checkGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session(accountB, 'second@example.test')),
    });
  });
  current = { id: accountB, email: 'second@example.test' };
  await peer.evaluate(() => {
    const channel = new BroadcastChannel('kendomenu-account-transition-v1');
    channel.postMessage({ signal: 'verified-account-active', sender: 'switch-finish-fixture' });
    channel.close();
  });
  await expect.poll(() => checkStarted).toBe(true);
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Checking account status' })).toBeVisible();
  releaseCheck?.();
  await expect(page.getByText('Signed in as second@example.test')).toBeVisible();
  await peer.close();
});

test('a held cross-tab account switch hides the old account until verification finishes', async ({
  page,
  context,
}) => {
  let current = { id: accountA, email: 'first@example.test' };
  await routeAccount(context, () => current);
  await page.goto('/app/dashboard');
  await expect(page.getByText('Signed in as first@example.test')).toBeVisible();

  await page.goto('/app/library?drill=junior-high-kendo-club');
  const menu = page.getByRole('dialog', { name: 'Junior-high school dojo menu' });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(menu.locator('.inline-confirmation')).toContainText('added to your dashboard');
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();

  let releaseCheck: (() => void) | undefined;
  const checkGate = new Promise<void>((resolve) => {
    releaseCheck = resolve;
  });
  let checkStarted = false;
  await page.route('**/api/session', async (route) => {
    checkStarted = true;
    await checkGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session(accountB, 'second@example.test')),
    });
  });

  current = { id: accountB, email: 'second@example.test' };
  const switchTab = await context.newPage();
  await switchTab.goto('/app/dashboard');
  await expect(switchTab.getByText('Signed in as second@example.test')).toBeVisible();
  await expect.poll(() => checkStarted).toBe(true);
  await expect(page.getByRole('heading', { name: 'Checking account status' })).toBeVisible();
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);

  releaseCheck?.();
  await expect(page.getByText('Signed in as second@example.test')).toBeVisible();
  expect(await readAccountCacheValue(page, accountA)).toContain(
    '"trainingSetId":"junior-high-kendo-club"',
  );
  await switchTab.close();
});

test('a failed cross-tab account check keeps the old editor gated and retryable', async ({
  page,
  context,
}) => {
  let current = { id: accountA, email: 'first@example.test' };
  await routeAccount(context, () => current);
  await page.goto('/app/dashboard');
  await expect(page.getByText('Signed in as first@example.test')).toBeVisible();
  await page.route('**/api/session', (route) => route.abort());

  current = { id: accountB, email: 'second@example.test' };
  const switchTab = await context.newPage();
  await switchTab.goto('/app/dashboard');
  await expect(switchTab.getByText('Signed in as second@example.test')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry account check' })).toBeVisible();
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: 'previous account is hidden' }),
  ).toBeVisible();

  await page.unroute('**/api/session');
  await page.getByRole('button', { name: 'Retry account check' }).click();
  await expect(page.getByText('Signed in as second@example.test')).toBeVisible();
  await switchTab.close();
});

test('a held account check cannot restore failed recovery after cross-tab sign-out', async ({
  page,
  context,
}) => {
  let current: { id: string; email: string } | null = {
    id: accountA,
    email: 'first@example.test',
  };
  await routeAccount(context, () => current);
  await page.goto('/app/dashboard');
  await expect(page.getByText('Signed in as first@example.test')).toBeVisible();

  let releaseCheck: (() => void) | undefined;
  const heldCheck = new Promise<void>((resolve) => {
    releaseCheck = resolve;
  });
  let checkStarted = false;
  let checkReleased = false;
  await page.route('**/api/session', async (route) => {
    if (route.request().method() !== 'GET' || checkStarted) return route.fallback();
    checkStarted = true;
    await heldCheck;
    await route.abort().catch(() => undefined);
    checkReleased = true;
  });
  const hintTab = await context.newPage();
  await hintTab.goto('/app/dashboard');
  await expect.poll(() => checkStarted).toBe(true);
  await expect(page.getByRole('heading', { name: 'Checking account status' })).toBeVisible();

  // Hold the account readback while a confirmed sign-out hint arrives. The old session
  // check must finish during preservation, while the hidden workspace is still active.
  await page.evaluate((verifiedAccountId) => {
    // The native method is always called with its original object-store receiver below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalGet = IDBObjectStore.prototype.get;
    let held = false;
    let released = false;
    window.addEventListener('release-held-account-read', () => (released = true), { once: true });
    IDBObjectStore.prototype.get = function (key) {
      const request = originalGet.call(this, key);
      if (held || key !== `${verifiedAccountId}:cache`) return request;
      held = true;
      document.documentElement.dataset['accountReadHeld'] = 'true';
      const keepAlive = () => {
        if (released) return;
        try {
          const next = originalGet.call(this, '__held_account_read__');
          next.onsuccess = keepAlive;
          next.onerror = keepAlive;
        } catch {
          // The transaction settled after release.
        }
      };
      queueMicrotask(keepAlive);
      return request;
    };
  }, accountA);
  current = null;
  await hintTab.evaluate(() => {
    const channel = new BroadcastChannel('kendomenu-account-transition-v1');
    channel.postMessage({ signal: 'signed-out', sender: 'confirmed-sign-out-fixture' });
    channel.close();
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['accountReadHeld']))
    .toBe('true');
  await expect(page.getByRole('heading', { name: 'Saving recent account changes' })).toBeVisible();
  releaseCheck?.();
  await expect.poll(() => checkReleased).toBe(true);
  await page.waitForTimeout(100);
  await page.evaluate(() => window.dispatchEvent(new Event('release-held-account-read')));
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry account check' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Checking account status' })).toHaveCount(0);
  await hintTab.close();
});

test('a signed-out hint clears a held check after dashboard rejection already hid the account', async ({
  page,
  context,
}) => {
  let current: { id: string; email: string } | null = {
    id: accountA,
    email: 'first@example.test',
  };
  await routeAccount(context, () => current);
  await page.goto('/app/dashboard');
  await expect(page.getByText('Signed in as first@example.test')).toBeVisible();

  let releaseCheck: (() => void) | undefined;
  const heldCheck = new Promise<void>((resolve) => {
    releaseCheck = resolve;
  });
  let checkStarted = false;
  let checkReleased = false;
  await page.route('**/api/session', async (route) => {
    if (route.request().method() !== 'GET' || checkStarted) return route.fallback();
    checkStarted = true;
    await heldCheck;
    await route
      .fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(session(accountA, 'first@example.test')),
      })
      .catch(() => undefined);
    checkReleased = true;
  });
  const hintTab = await context.newPage();
  await hintTab.goto('/app/dashboard');
  await expect.poll(() => checkStarted).toBe(true);
  await expect(page.getByRole('heading', { name: 'Checking account status' })).toBeVisible();

  await page.route('**/api/dashboard**', (route) => route.fulfill(signedOutResponse));
  const rejectedDashboard = page.waitForResponse(
    (response) => response.url().includes('/api/dashboard') && response.status() === 401,
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await rejectedDashboard;
  current = null;
  await hintTab.evaluate(() => {
    const channel = new BroadcastChannel('kendomenu-account-transition-v1');
    channel.postMessage({ signal: 'signed-out', sender: 'confirmed-sign-out-fixture' });
    channel.close();
  });
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry account check' })).toHaveCount(0);
  releaseCheck?.();
  await expect.poll(() => checkReleased).toBe(true);
  await page.waitForTimeout(100);
  await expect(page.getByRole('heading', { name: 'Checking account status' })).toHaveCount(0);
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await hintTab.close();
});

test('Use this device stays on the guest workspace while the account session remains active', async ({
  page,
  context,
}) => {
  await routeAccount(context, () => ({ id: accountA, email: 'first@example.test' }));
  await page.goto('/app/dashboard');
  await expect(page.getByText('Signed in as first@example.test')).toBeVisible();
  await page.route('**/api/session', (route) => route.abort());
  const hintTab = await context.newPage();
  await hintTab.goto('/app/dashboard');
  await expect(page.getByRole('button', { name: 'Retry account check' })).toBeVisible();
  await page.unroute('**/api/session');

  let laterSessionChecks = 0;
  await page.route('**/api/session', (route) => {
    laterSessionChecks += 1;
    return route.fallback();
  });
  await page.evaluate(() => {
    void navigator.locks.request('kendo-menu:guest', async () => {
      document.documentElement.dataset['guestLockHeld'] = 'true';
      await new Promise<void>((resolve) => {
        window.addEventListener('release-guest-lock', () => resolve(), { once: true });
      });
    });
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['guestLockHeld']))
    .toBe('true');
  await page.getByRole('button', { name: 'Use this device' }).click();
  await expect(page.getByRole('heading', { name: 'Opening this device workspace' })).toBeVisible();
  await page.evaluate(() => {
    const channel = new BroadcastChannel('kendomenu-account-transition-v1');
    channel.addEventListener('message', () => {
      document.documentElement.dataset['duringGuestRefreshHint'] = 'received';
      channel.close();
    });
  });
  await hintTab.evaluate(() => {
    const channel = new BroadcastChannel('kendomenu-account-transition-v1');
    channel.postMessage({ signal: 'verified-account-active', sender: 'during-refresh-fixture' });
    channel.close();
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['duringGuestRefreshHint']))
    .toBe('received');
  expect(laterSessionChecks).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event('release-guest-lock')));
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  expect(laterSessionChecks).toBe(0);

  await page.evaluate(() => {
    const channel = new BroadcastChannel('kendomenu-account-transition-v1');
    channel.addEventListener('message', () => {
      document.documentElement.dataset['laterAccountHint'] = 'received';
      channel.close();
    });
  });
  await hintTab.evaluate(() => {
    const channel = new BroadcastChannel('kendomenu-account-transition-v1');
    channel.postMessage({
      signal: 'verified-account-active',
      sender: 'later-account-hint-fixture',
    });
    channel.close();
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['laterAccountHint']))
    .toBe('received');
  expect(laterSessionChecks).toBe(0);
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);
  await hintTab.close();
});

test('Use this device refreshes guest data after account storage fails to open', async ({
  page,
  context,
}) => {
  let current: { id: string; email: string } | null = null;
  await routeAccount(context, () => current);
  await page.goto('/app/library?drill=junior-high-kendo-club');
  const menu = page.getByRole('dialog', { name: 'Junior-high school dojo menu' });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(menu.locator('.inline-confirmation')).toContainText('added to your dashboard');
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();

  await page.addInitScript(() => {
    Object.defineProperty(indexedDB, 'open', {
      configurable: true,
      value: () => {
        throw new Error('Account IndexedDB is unavailable in this test.');
      },
    });
  });
  current = { id: accountA, email: 'first@example.test' };
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Your account workspace could not be opened' }),
  ).toBeVisible();
  await page.evaluate(() => window.localStorage.removeItem('kendo-menu'));

  await page.getByRole('button', { name: 'Use this device' }).click();
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(0);
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);
});

test('Use this device cancels a held Retry from account-storage recovery', async ({
  page,
  context,
}) => {
  await routeAccount(context, () => ({ id: accountA, email: 'first@example.test' }));
  await page.addInitScript(() => {
    Object.defineProperty(indexedDB, 'open', {
      configurable: true,
      value: () => {
        throw new Error('Account IndexedDB is unavailable in this test.');
      },
    });
    const originalFetch = window.fetch.bind(window);
    let holdRetry = false;
    window.addEventListener('hold-account-retry', () => {
      holdRetry = true;
    });
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/session') && init?.method === 'GET' && holdRetry) {
        document.documentElement.dataset['retryHeld'] = 'true';
        return new Promise<Response>((resolve) => {
          window.addEventListener(
            'release-account-retry',
            () =>
              resolve(
                new Response(
                  JSON.stringify({
                    userId: '01234567-89ab-4cde-8fab-0123456789ab',
                    verifiedGoogleEmail: 'first@example.test',
                    adoption: { status: 'unavailable', capability: false },
                  }),
                  { status: 200, headers: { 'content-type': 'application/json' } },
                ),
              ),
            { once: true },
          );
        });
      }
      return originalFetch(input, init);
    };
  });
  await page.goto('/app/dashboard');
  await expect(
    page.getByRole('heading', { name: 'Your account workspace could not be opened' }),
  ).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event('hold-account-retry')));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['retryHeld']))
    .toBe('true');
  await page.getByRole('button', { name: 'Use this device' }).click();
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('release-account-retry')));
  await page.waitForTimeout(100);
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);
});

test('a peer sign-in does not offer a no-op backup for account-storage failure', async ({
  page,
  context,
}) => {
  await routeAccount(context, () => ({ id: accountA, email: 'first@example.test' }));
  await context.addInitScript(() => {
    Object.defineProperty(indexedDB, 'open', {
      configurable: true,
      value: () => {
        throw new Error('Account IndexedDB is unavailable in this test.');
      },
    });
  });
  await page.goto('/app/dashboard');
  await expect(
    page.getByRole('heading', { name: 'Your account workspace could not be opened' }),
  ).toBeVisible();
  const peer = await context.newPage();
  await peer.goto('/app/dashboard');
  await peer.evaluate(() => {
    const channel = new BroadcastChannel('kendomenu-account-transition-v1');
    channel.postMessage({ signal: 'sign-in-started', sender: 'account-error-fixture' });
    channel.close();
  });
  await expect(page.getByRole('heading', { name: 'Checking account status' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download account backup' })).toHaveCount(0);
  await peer.close();
});

test('Use this device opens a fresh guest snapshot in session-only mode without Web Locks', async ({
  page,
  context,
}) => {
  let current: { id: string; email: string } | null = null;
  await routeAccount(context, () => current);
  await page.goto('/app/library?drill=junior-high-kendo-club');
  const menu = page.getByRole('dialog', { name: 'Junior-high school dojo menu' });
  await menu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(menu.locator('.inline-confirmation')).toContainText('added to your dashboard');
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  });
  current = { id: accountA, email: 'first@example.test' };
  await page.reload();
  await expect(page.getByText('Signed in as first@example.test')).toBeVisible();
  await page.getByRole('button', { name: 'Use this device' }).click();
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Junior-high school dojo menu' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Session only' })).toBeVisible();
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);
});

test('focus re-verifies after cross-tab sign-out when BroadcastChannel is unavailable', async ({
  page,
  context,
}) => {
  let current: { id: string; email: string } | null = {
    id: accountA,
    email: 'first@example.test',
  };
  await context.addInitScript(() => {
    Object.defineProperty(window, 'BroadcastChannel', { configurable: true, value: undefined });
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '__Host-kendomenu-csrf=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
  });
  await routeAccount(
    context,
    () => current,
    () => {
      current = null;
    },
  );
  const peer = await context.newPage();
  await page.goto('/app/dashboard');
  await peer.goto('/app/dashboard');
  await expect(peer.getByText('Signed in as first@example.test')).toBeVisible();
  await page.bringToFront();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);

  await peer.bringToFront();
  // Headless browsers do not reliably dispatch focus when Playwright changes tabs.
  await peer.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(peer.getByText('Signed in as first@example.test')).toHaveCount(0);
  await expect(peer.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await peer.close();
});

test('a superseded first sign-out still broadcasts its confirmed server revocation', async ({
  page,
  context,
}) => {
  let current: { id: string; email: string } | null = {
    id: accountA,
    email: 'first@example.test',
  };
  await context.addInitScript(() => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '__Host-kendomenu-csrf=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
  });
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let deleteCalls = 0;
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/session') && init?.method === 'DELETE') {
        deleteCalls += 1;
        document.documentElement.dataset['deleteCalls'] = String(deleteCalls);
        if (deleteCalls === 1) {
          return new Promise<Response>((resolve) => {
            window.addEventListener(
              'release-first-logout',
              () => resolve(new Response(null, { status: 204 })),
              { once: true },
            );
          });
        }
        return Promise.reject(new Error('Second logout request failed'));
      }
      return originalFetch(input, init);
    };
  });
  await routeAccount(context, () => current);
  const peer = await context.newPage();
  await page.goto('/app/dashboard');
  await peer.goto('/app/dashboard');
  await expect(peer.getByText('Signed in as first@example.test')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect
    .poll(() => page.evaluate(() => Number(document.documentElement.dataset['deleteCalls'] ?? 0)))
    .toBe(1);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect
    .poll(() => page.evaluate(() => Number(document.documentElement.dataset['deleteCalls'] ?? 0)))
    .toBe(2);
  current = null;
  await page.evaluate(() => window.dispatchEvent(new Event('release-first-logout')));
  await expect(peer.getByText('Signed in as first@example.test')).toHaveCount(0);
  await expect(page.getByText('Signed in as first@example.test')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await peer.close();
});
