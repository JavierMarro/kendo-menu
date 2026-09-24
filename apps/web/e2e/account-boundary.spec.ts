import { expect, test, type Page } from '@playwright/test';

async function readIndexedDbAccountRecord(
  page: Page,
): Promise<{ cacheValue: string; identity: string; generation: number } | null> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kendo-menu-account-storage', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
    try {
      const transaction = database.transaction('records', 'readonly');
      const record = await new Promise<unknown>((resolve, reject) => {
        const request = transaction
          .objectStore('records')
          .get('11111111-1111-4111-8111-111111111111:cache');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
      });
      return typeof record === 'object' &&
        record !== null &&
        'cacheValue' in record &&
        typeof record.cacheValue === 'string' &&
        'identity' in record &&
        typeof record.identity === 'string' &&
        'generation' in record &&
        typeof record.generation === 'number'
        ? {
            cacheValue: record.cacheValue,
            identity: record.identity,
            generation: record.generation,
          }
        : null;
    } finally {
      database.close();
    }
  });
}

async function readIndexedDbAccountCache(page: Page): Promise<string | null> {
  return (await readIndexedDbAccountRecord(page))?.cacheValue ?? null;
}

test('ordinary guest persistence shares the guest Web Lock across tabs', async ({
  page,
  context,
}) => {
  const owner = await context.newPage();
  await owner.goto('/app/dashboard');
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
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBeNull();
  await owner.evaluate(() => window.dispatchEvent(new Event('release-test-guest-lock')));
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kendo-menu'))).not.toBeNull();
  await expect(page.locator('.inline-confirmation')).toContainText('added to your dashboard.');
  await page.goto('/app/dashboard');
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);
  await owner.close();
});

test('internal fixture exercises real browser storage, Web Locks and account lifecycle', async ({
  page,
}) => {
  await page.goto('/e2e/account-fixture.html');
  await expect(page.locator('#result')).toHaveText(
    JSON.stringify({
      bootstrap: 'ready',
      hidden: 'hidden',
      oldReleased: true,
      reopened: true,
      migrated: true,
      legacyRemoved: true,
      ackUnknown: true,
      guestPreserved: true,
      coordination: 'available',
      calls: ['GET', 'GET'],
    }),
  );
});

test('a stale tab legacy write is retained separately after IndexedDB cutover', async ({
  page,
  context,
}) => {
  const accountKey = 'kendo-menu:account:11111111-1111-4111-8111-111111111111';
  const emptyCache = JSON.stringify({ state: { dashboardEntries: [] }, version: 10 });
  await page.goto('/e2e/account-fixture.html');
  await expect(page.locator('#result')).toContainText('"reopened":true');

  const stale = await context.newPage();
  await stale.goto('/');
  await stale.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: accountKey,
    value: emptyCache,
  });

  await expect
    .poll(() =>
      page.evaluate(async (expected) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('kendo-menu-account-storage', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
        });
        try {
          const transaction = database.transaction('records', 'readonly');
          const records = await new Promise<unknown[]>((resolve, reject) => {
            const request = transaction.objectStore('records').getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
          });
          return records.some(
            (value) =>
              typeof value === 'object' &&
              value !== null &&
              'kind' in value &&
              value.kind === 'recovery' &&
              'rawValue' in value &&
              value.rawValue === expected,
          );
        } finally {
          database.close();
        }
      }, emptyCache),
    )
    .toBe(true);
  expect(await page.evaluate((key) => localStorage.getItem(key), accountKey)).toBe(emptyCache);
  await expect(page.locator('#result')).toContainText('"calls":["GET","GET"]');
  await stale.close();
});

test('opening and reloading a second account tab without edits preserves the version and lets the first tab save', async ({
  page,
  context,
}) => {
  await page.goto('/e2e/account-fixture.html');
  await expect(page.locator('#result')).toContainText('"reopened":true');
  const initial = await readIndexedDbAccountRecord(page);
  expect(initial).not.toBeNull();

  const other = await context.newPage();
  await other.goto('/e2e/account-fixture.html?openOnly=1');
  await expect(other.locator('#result')).toContainText('"reopened":true');
  expect(await readIndexedDbAccountRecord(other)).toEqual(initial);

  await other.reload();
  await expect(other.locator('#result')).toContainText('"reopened":true');
  expect(await readIndexedDbAccountRecord(other)).toEqual(initial);

  await page.evaluate(() => window.dispatchEvent(new Event('e2e-account-edit')));
  await expect(page.locator('#operation')).toHaveText(
    JSON.stringify({ result: 'hidden', failure: null }),
  );
  const committed = await readIndexedDbAccountRecord(page);
  expect(committed?.identity).toBe(initial?.identity);
  expect(committed?.generation).toBe((initial?.generation ?? -1) + 1);
  expect(committed?.cacheValue).not.toBe(initial?.cacheValue);
  await other.close();
});

test('a genuine edit in a second account tab rejects the first tab stale write', async ({
  page,
  context,
}) => {
  await page.goto('/e2e/account-fixture.html');
  await expect(page.locator('#result')).toContainText('"reopened":true');
  const newer = await context.newPage();
  await newer.goto('/e2e/account-fixture.html');
  await expect(newer.locator('#result')).toContainText('"reopened":false');
  const committed = await readIndexedDbAccountCache(newer);
  expect(typeof committed).toBe('string');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-account-edit')));
  await expect(page.locator('#operation')).toHaveText(
    JSON.stringify({ result: 'retryable', failure: 'interrupted' }),
  );
  const after = await readIndexedDbAccountCache(newer);
  expect(after).toBe(committed);
  await newer.close();
});

test('future IndexedDB cache data stops activation and preserves both sources', async ({
  page,
}) => {
  const accountKey = 'kendo-menu:account:11111111-1111-4111-8111-111111111111';
  await page.goto('/');
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kendo-menu-account-storage', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('records', { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
    try {
      const transaction = database.transaction('records', 'readwrite');
      transaction.objectStore('records').put({
        key: '11111111-1111-4111-8111-111111111111:cache',
        kind: 'cache',
        version: 99,
        accountId: '11111111-1111-4111-8111-111111111111',
        cacheValue: JSON.stringify({ state: { dashboardEntries: [] }, version: 10 }),
        identity: 'future',
        generation: 1,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      });
    } finally {
      database.close();
    }
  });
  await page.goto('/e2e/account-fixture.html');
  await expect(page.locator('#result')).toHaveText('failed');
  expect(await page.evaluate((key) => localStorage.getItem(key), accountKey)).toBe(
    JSON.stringify({ state: { dashboardEntries: [] }, version: 10 }),
  );
});

test('exhausted cache generation permits an identical write but rejects an edit', async ({
  page,
}) => {
  const emptyCache = JSON.stringify({ state: { dashboardEntries: [] }, version: 10 });
  await page.goto('/');
  await page.evaluate(async (cacheValue) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kendo-menu-account-storage', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('records', { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    try {
      const transaction = database.transaction('records', 'readwrite');
      transaction.objectStore('records').put({
        key: '11111111-1111-4111-8111-111111111111:cache',
        kind: 'cache',
        version: 1,
        accountId: '11111111-1111-4111-8111-111111111111',
        cacheValue,
        identity: 'maximum-generation',
        generation: Number.MAX_SAFE_INTEGER,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('IndexedDB seed transaction failed'));
      });
    } finally {
      database.close();
    }
  }, emptyCache);
  await page.goto('/e2e/account-fixture.html');
  await expect(page.locator('#result')).toContainText('"bootstrap":"ready"');
  await expect(page.locator('#result')).toContainText('"hidden":"retryable"');
  expect(await readIndexedDbAccountRecord(page)).toEqual({
    cacheValue: emptyCache,
    identity: 'maximum-generation',
    generation: Number.MAX_SAFE_INTEGER,
  });
});

test('ordinary routes neither bootstrap accounts nor expose account entry points', async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.method());
  });
  const accountKey = 'kendo-menu:account:11111111-1111-4111-8111-111111111111';
  await page.addInitScript((key) => {
    localStorage.setItem(key, 'untrusted remembered account sentinel');
    localStorage.setItem(`${key}:sync`, 'untrusted metadata sentinel');
  }, accountKey);
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /google|sign in|log in|account/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /google|sign in|log in|account/i })).toHaveCount(0);
  await page.goto('/app/account');
  await expect(
    page.getByRole('heading', { name: 'That route is not part of KendoMenu.' }),
  ).toBeVisible();
  expect(apiRequests).toEqual([]);
  expect(await page.evaluate((key) => localStorage.getItem(key), accountKey)).toBe(
    'untrusted remembered account sentinel',
  );
});
