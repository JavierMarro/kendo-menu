import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const accountId = '01234567-89ab-4cde-8fab-0123456789ab';
interface IndexedDbTestControl {
  holdNextCacheWrite: boolean;
  failNextCacheWrite: boolean;
  held: boolean;
  release: boolean;
}

type TestWindow = Window & { __kendoIndexedDbControl?: IndexedDbTestControl };

async function configureAccount(context: BrowserContext, isSignedIn: () => boolean = () => true) {
  await context.route('**/api/session', (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 204 })
      : route.fulfill(
          isSignedIn()
            ? {
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                  userId: accountId,
                  verifiedGoogleEmail: 'account@example.test',
                  adoption: { status: 'unavailable', capability: false },
                }),
              }
            : {
                status: 401,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'UNAUTHENTICATED' }),
              },
        ),
  );
  await context.route('**/api/dashboard**', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            transportVersion: 1,
            accountWorkspaceId: accountId,
            catalogueVersion: 'a'.repeat(64),
            revision: '0',
            dashboard: null,
            updatedAt: null,
          }),
        })
      : route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
}

test('guest recovery cannot replace an account with a held save', async ({ page, context }) => {
  let signedIn = false;
  await configureAccount(context, () => signedIn);
  await installIndexedDbControls(page);
  await page.addInitScript(() => {
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    Object.defineProperty(window.localStorage, 'setItem', {
      configurable: true,
      value: (key: string, value: string) => {
        if (key === 'kendo-menu') {
          throw new DOMException('Guest storage failed', 'QuotaExceededError');
        }
        return originalSetItem(key, value);
      },
    });
  });

  await page.goto('/app/library?drill=junior-high-kendo-club');
  const menu = page.getByRole('dialog', { name: 'Junior-high school dojo menu' });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Add to dashboard' }).click();
  await menu.getByRole('button', { name: 'Close Junior-high school dojo menu details.' }).click();
  await expect(page.getByRole('heading', { name: 'Changes are not saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Open recovery options' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your recent changes are not saved.' }),
  ).toBeVisible();

  signedIn = true;
  const peer = await context.newPage();
  await peer.goto('/app/dashboard');
  await expect(peer.getByText('Signed in as account@example.test')).toBeVisible();
  await expect(page.getByText('Signed in as account@example.test')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Changes are not saved' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open recovery options' })).toHaveCount(0);

  await page
    .locator('.library-card')
    .filter({ hasText: 'Junior-high school dojo menu' })
    .getByRole('link', { name: 'View session' })
    .click();
  await expect(menu).toBeVisible();
  await setControl(page, { holdNextCacheWrite: true });
  await menu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__kendoIndexedDbControl?.held))
    .toBe(true);
  await expect(page.locator('.inline-confirmation')).toHaveCount(0);
  await expect(page.getByText('Signed in as account@example.test')).toBeVisible();
  await setControl(page, { release: true });
  await expect(page.locator('.inline-confirmation')).toContainText('added to your dashboard.');
  await page.reload();
  await expect(page.getByText('Signed in as account@example.test')).toBeVisible();
  await page.goto('/app/dashboard');
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);
  await peer.close();
});

async function installIndexedDbControls(page: Page) {
  await page.addInitScript(() => {
    const control: IndexedDbTestControl = {
      holdNextCacheWrite: false,
      failNextCacheWrite: false,
      held: false,
      release: false,
    };
    (window as TestWindow).__kendoIndexedDbControl = control;
    const originalPut = Reflect.get(IDBObjectStore.prototype, 'put');
    const issuePut = (
      store: IDBObjectStore,
      value: unknown,
      key: IDBValidKey | undefined,
    ): IDBRequest<IDBValidKey> =>
      Reflect.apply(originalPut, store, key === undefined ? [value] : [value, key]);
    const isCacheRecord = (value: unknown): boolean =>
      typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'cache';
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (!isCacheRecord(value) || (!control.holdNextCacheWrite && !control.failNextCacheWrite)) {
        return issuePut(this, value, key);
      }

      const shouldHold = control.holdNextCacheWrite;
      control.holdNextCacheWrite = false;
      control.failNextCacheWrite = false;
      const request = issuePut(this, value, key);
      if (shouldHold) {
        control.held = true;
        const keepTransactionAlive = () => {
          if (control.release) return;
          try {
            const keepAlive = this.get('__kendo_account_write_gate__');
            keepAlive.onsuccess = keepTransactionAlive;
            keepAlive.onerror = keepTransactionAlive;
          } catch {
            // The gate is best effort during the transaction completion edge.
          }
        };
        queueMicrotask(keepTransactionAlive);
      } else {
        queueMicrotask(() => {
          try {
            this.transaction.abort();
          } catch {
            // The transaction may already have failed, which is the expected test result.
          }
        });
      }
      return request;
    };
  });
}

async function setControl(page: Page, update: Partial<IndexedDbTestControl>): Promise<void> {
  await page.evaluate((next) => {
    const control = (window as TestWindow).__kendoIndexedDbControl;
    if (control === undefined) throw new Error('IndexedDB test controls are missing.');
    Object.assign(control, next);
  }, update);
}

async function advanceAccountCache(page: Page, userId: string): Promise<string> {
  return page.evaluate(async (accountId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kendo-menu-account-storage', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    try {
      const transaction = database.transaction('records', 'readwrite');
      const store = transaction.objectStore('records');
      const record = await new Promise<unknown>((resolve, reject) => {
        const request = store.get(`${accountId}:cache`);
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
      const newerValue = `${record.cacheValue} `;
      store.put({
        ...record,
        generation: record.generation + 1,
        cacheValue: newerValue,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Cache write failed'));
      });
      return newerValue;
    } finally {
      database.close();
    }
  }, userId);
}

async function readAccountCache(page: Page, userId: string): Promise<string> {
  return page.evaluate(async (accountId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kendo-menu-account-storage', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    try {
      const transaction = database.transaction('records', 'readonly');
      const record = await new Promise<unknown>((resolve, reject) => {
        const request = transaction.objectStore('records').get(`${accountId}:cache`);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Cache read failed'));
      });
      if (
        typeof record !== 'object' ||
        record === null ||
        !('cacheValue' in record) ||
        typeof record.cacheValue !== 'string'
      )
        throw new Error('Expected an account cache');
      return record.cacheValue;
    } finally {
      database.close();
    }
  }, userId);
}

test('account save waits for a held IndexedDB write and survives reload', async ({
  page,
  context,
}) => {
  await configureAccount(context);
  await installIndexedDbControls(page);
  await page.goto('/app/dashboard');
  await expect(page.getByText('Signed in as account@example.test')).toBeVisible();
  await page.goto('/app/library?drill=junior-high-kendo-club');
  await setControl(page, { holdNextCacheWrite: true });
  const addButton = page.getByRole('button', { name: 'Add to dashboard' });
  await addButton.click();
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__kendoIndexedDbControl?.held))
    .toBe(true);
  await expect(page.locator('.inline-confirmation')).toHaveCount(0);
  await expect(addButton).toBeDisabled();

  await setControl(page, { release: true });
  await expect(page.locator('.inline-confirmation')).toContainText('added to your dashboard.');
  await page.reload();
  await expect(page.getByText('Signed in as account@example.test')).toBeVisible();
  await page.goto('/app/dashboard');
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);
});

test('a pending account note edit requests a leave warning until IndexedDB confirms it', async ({
  page,
  context,
}) => {
  await configureAccount(context);
  await installIndexedDbControls(page);
  await page.goto('/app/library?drill=junior-high-kendo-club');
  const menu = page.getByRole('dialog', { name: 'Junior-high school dojo menu' });
  await menu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(menu.locator('.inline-confirmation')).toContainText('added to your dashboard.');
  await menu.getByRole('link', { name: 'View dashboard' }).click();
  await page
    .locator('.dashboard-card--compact')
    .filter({ hasText: 'Junior-high school dojo menu' })
    .getByRole('button', { name: 'View more' })
    .click();
  const accountMenu = page.getByRole('dialog', { name: 'Junior-high school dojo menu' });
  const notes = accountMenu.getByLabel('Practice notes');
  await setControl(page, { holdNextCacheWrite: true });
  await notes.fill('Keep the shoulders relaxed.');
  await notes.blur();
  await expect
    .poll(() => page.evaluate(() => (window as TestWindow).__kendoIndexedDbControl?.held))
    .toBe(true);

  const warnsBeforeLeaving = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  await expect.poll(warnsBeforeLeaving).toBe(true);
  await setControl(page, { release: true });
  await expect.poll(warnsBeforeLeaving).toBe(false);
  await page.reload();
  await expect(page.getByText('Signed in as account@example.test')).toBeVisible();
  await page
    .locator('.dashboard-card--compact')
    .filter({ hasText: 'Junior-high school dojo menu' })
    .getByRole('button', { name: 'View more' })
    .click();
  await expect(page.getByRole('dialog').getByLabel('Practice notes')).toHaveValue(
    'Keep the shoulders relaxed.',
  );
});

test('failed account IndexedDB write is reported and does not survive reload', async ({
  page,
  context,
}) => {
  await configureAccount(context);
  await installIndexedDbControls(page);
  await page.goto('/app/dashboard');
  await expect(page.getByText('Signed in as account@example.test')).toBeVisible();
  await page.goto('/app/library?drill=junior-high-kendo-club');
  await setControl(page, { failNextCacheWrite: true });
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(page.locator('.inline-confirmation')).toContainText(
    'was added, but KendoMenu could not confirm it was saved',
  );
  await page.reload();
  await expect(page.getByText('Signed in as account@example.test')).toBeVisible();
  await page.goto('/app/dashboard');
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(0);
});

test('a failed account write stays private and warns after signed-out verification', async ({
  page,
  context,
}) => {
  let signedIn = true;
  await configureAccount(context, () => signedIn);
  await installIndexedDbControls(page);
  await page.goto('/app/library?drill=junior-high-kendo-club');
  await expect(page.getByText('Signed in as account@example.test')).toBeVisible();

  await setControl(page, { failNextCacheWrite: true });
  const menu = page.getByRole('dialog', { name: 'Junior-high school dojo menu' });
  await menu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(menu.locator('.inline-confirmation')).toContainText(
    'was added, but KendoMenu could not confirm it was saved',
  );
  await menu.getByRole('link', { name: 'View dashboard' }).click();
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);

  signedIn = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const hiddenNotice = page.getByRole('heading', {
    name: 'Unsaved account changes remain in this tab',
  });
  await expect(hiddenNotice).toBeVisible();
  await expect(page.getByText('Signed in as account@example.test')).toHaveCount(0);
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download account backup' })).toHaveCount(0);

  const warnsBeforeLeaving = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  await expect.poll(warnsBeforeLeaving).toBe(true);
  await page.getByRole('button', { name: 'Check account again' }).click();
  await expect(hiddenNotice).toBeVisible();
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(0);

  signedIn = true;
  await page.getByRole('button', { name: 'Check account again' }).click();
  await expect(page.getByText('Signed in as account@example.test')).toBeVisible();
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);
  await expect(hiddenNotice).toHaveCount(0);
  await expect.poll(warnsBeforeLeaving).toBe(false);
});

test('a failed edit remains downloadable after session rejection and newer peer cache', async ({
  page,
  context,
}) => {
  let signedIn = true;
  await configureAccount(context, () => signedIn);
  await installIndexedDbControls(page);
  await page.goto('/app/library?drill=junior-high-kendo-club');
  await expect(page.getByText('Signed in as account@example.test')).toBeVisible();

  const menu = page.getByRole('dialog', { name: 'Junior-high school dojo menu' });
  await setControl(page, { failNextCacheWrite: true });
  await menu.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(menu.locator('.inline-confirmation')).toContainText(
    'was added, but KendoMenu could not confirm it was saved',
  );
  await menu.getByRole('link', { name: 'View dashboard' }).click();
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);

  signedIn = false;
  const rejectedSession = page.waitForResponse(
    (response) => response.url().endsWith('/api/session') && response.status() === 401,
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await rejectedSession;
  const hiddenNotice = page.getByRole('heading', {
    name: 'Unsaved account changes remain in this tab',
  });
  await expect(hiddenNotice).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unsaved account copies' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download account copy 1' })).toHaveCount(0);

  const peer = await context.newPage();
  // A same-origin peer cache write must precede re-verification. A second app bootstrap would
  // broadcast account activity and could otherwise start that check before this write.
  await peer.route('**/peer-cache-fixture', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Peer cache</title>',
    }),
  );
  await peer.goto('/peer-cache-fixture');
  const peerValue = await advanceAccountCache(peer, accountId);

  signedIn = true;
  await page.getByRole('button', { name: 'Check account again' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your account workspace could not be opened' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unsaved account copies' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download account copy 1/ }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (downloadPath === null) throw new Error('Expected a retained account copy download');
  const retainedCopy = JSON.parse(await readFile(downloadPath, 'utf8')) as {
    readonly state?: { readonly dashboardEntries?: readonly { readonly trainingSetId?: string }[] };
  };
  expect(retainedCopy.state?.dashboardEntries?.[0]?.trainingSetId).toBe('junior-high-kendo-club');
  await expect.poll(() => readAccountCache(page, accountId)).toBe(peerValue);
  await peer.close();
});
