import { expect, test, type Page } from '@playwright/test';

async function indexedDbState(
  page: Page,
  accountId = '11111111-1111-4111-8111-111111111111',
): Promise<{
  acknowledgement: unknown;
  cacheGeneration: number | null;
  conflict: unknown;
  pending: unknown;
  recoveryCount: number;
}> {
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
      const all = new Promise<unknown[]>((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
      });
      const [ack, cache, pending, conflict, records] = await Promise.all([
        read(`${targetAccountId}:ack`),
        read(`${targetAccountId}:cache`),
        read(`${targetAccountId}:pending-request`),
        read(`${targetAccountId}:active-conflict`),
        all,
      ]);
      const value = (record: unknown): unknown =>
        typeof record === 'object' && record !== null && 'value' in record ? record.value : record;
      return {
        acknowledgement: value(ack),
        cacheGeneration:
          typeof cache === 'object' &&
          cache !== null &&
          'generation' in cache &&
          typeof cache.generation === 'number'
            ? cache.generation
            : null,
        pending: pending ?? null,
        conflict: conflict ?? null,
        recoveryCount: records.filter(
          (record) =>
            typeof record === 'object' &&
            record !== null &&
            'kind' in record &&
            record.kind === 'recovery',
        ).length,
      };
    } finally {
      database.close();
    }
  }, accountId);
}

test('use-cloud transaction preserves the local copy and reload sees committed cache and acknowledgement', async ({
  page,
  context,
}) => {
  await page.goto('/e2e/account-database-fixture.html');
  await expect(page.locator('#result')).toHaveText('ready');
  const before = await indexedDbState(page);
  expect(before).toMatchObject({
    acknowledgement: { status: 'acknowledged', revision: '1' },
    pending: null,
  });
  expect(before.conflict).not.toBeNull();

  const otherTab = await context.newPage();
  await otherTab.goto('/');
  expect(await indexedDbState(otherTab)).toEqual(before);

  await page.evaluate(() => window.dispatchEvent(new Event('e2e-db-resolve-cloud')));
  await expect(page.locator('#operation')).toContainText('"status":"committed"');
  await expect
    .poll(() => indexedDbState(otherTab))
    .toMatchObject({
      acknowledgement: { status: 'acknowledged', revision: '2' },
      conflict: null,
      pending: null,
      recoveryCount: 1,
    });

  await otherTab.reload();
  await expect(otherTab.locator('#root')).toBeVisible();
  await expect
    .poll(() => indexedDbState(page))
    .toMatchObject({
      acknowledgement: { status: 'acknowledged', revision: '2' },
      recoveryCount: 1,
    });
});

test('quota failure aborts use-cloud transaction and leaves the conflict and source cache intact', async ({
  page,
}) => {
  await page.goto('/e2e/account-database-fixture.html');
  await expect(page.locator('#result')).toHaveText('ready');
  const before = await indexedDbState(page);

  await page.evaluate(() => window.dispatchEvent(new Event('e2e-db-abort-cloud')));
  await expect(page.locator('#operation')).toContainText('"errorName":"QuotaExceededError"');
  const after = await indexedDbState(page);
  expect(after).toEqual(before);
});

test('two tabs cannot replace one another’s pending request and acknowledgement survives reload', async ({
  page,
  context,
}) => {
  await page.goto('/e2e/account-database-fixture.html');
  await expect(page.locator('#result')).toHaveText('ready');
  const accountId = '33333333-3333-4333-8333-333333333333';
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-db-seed-race')));
  await expect(page.locator('#operation')).toContainText('"identity":');
  const seeded: unknown = JSON.parse(await page.locator('#operation').innerText());
  if (
    typeof seeded !== 'object' ||
    seeded === null ||
    !('identity' in seeded) ||
    typeof seeded.identity !== 'string' ||
    !('generation' in seeded) ||
    typeof seeded.generation !== 'number' ||
    !('dashboard' in seeded)
  )
    throw new Error('Race cache fixture is invalid');

  const otherTab = await context.newPage();
  await otherTab.goto('/e2e/account-database-fixture.html?observer=1');
  await expect(otherTab.locator('#result')).toHaveText('observer');
  const requestIds = [
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
  ] as const;
  const prepare = async (target: Page, requestId: string) => {
    await target.evaluate(
      (detail) => window.dispatchEvent(new CustomEvent('e2e-db-prepare-race', { detail })),
      {
        accountId,
        cacheVersion: { identity: seeded.identity, generation: seeded.generation },
        dashboard: seeded.dashboard,
        requestId,
      },
    );
    await expect(target.locator('#operation')).toContainText('"status":');
    const outcome: unknown = JSON.parse(await target.locator('#operation').innerText());
    if (
      typeof outcome !== 'object' ||
      outcome === null ||
      !('status' in outcome) ||
      typeof outcome.status !== 'string'
    )
      throw new Error('Race outcome is invalid');
    return outcome.status;
  };
  const outcomes = await Promise.all([
    prepare(page, requestIds[0]),
    prepare(otherTab, requestIds[1]),
  ]);
  expect(outcomes.sort()).toEqual(['committed', 'conflict']);
  const winner = await page.evaluate(async (targetAccountId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kendo-menu-account-storage', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    try {
      const transaction = database.transaction('records', 'readonly');
      const stored = await new Promise<unknown>((resolve, reject) => {
        const request = transaction
          .objectStore('records')
          .get(`${targetAccountId}:pending-request`);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
      });
      if (
        typeof stored !== 'object' ||
        stored === null ||
        !('payload' in stored) ||
        typeof stored.payload !== 'string'
      )
        return null;
      const pending: unknown = JSON.parse(stored.payload);
      if (
        typeof pending !== 'object' ||
        pending === null ||
        !('request' in pending) ||
        typeof pending.request !== 'object' ||
        pending.request === null ||
        !('requestId' in pending.request) ||
        typeof pending.request.requestId !== 'string'
      )
        return null;
      return pending.request.requestId;
    } finally {
      database.close();
    }
  }, accountId);
  expect(requestIds).toContain(winner);

  await otherTab.evaluate(
    (detail) => window.dispatchEvent(new CustomEvent('e2e-db-ack-race', { detail })),
    { accountId, requestId: winner },
  );
  await expect(otherTab.locator('#operation')).toContainText('"status":"committed"');
  await otherTab.reload();
  await expect(otherTab.locator('#result')).toHaveText('observer');
  const reloaded = await indexedDbState(otherTab, accountId);
  expect(reloaded).toMatchObject({
    acknowledgement: { status: 'acknowledged', revision: '1' },
    pending: null,
  });
  await otherTab.evaluate(
    (detail) => window.dispatchEvent(new CustomEvent('e2e-db-baseline-race', { detail })),
    {
      cacheVersion: { identity: seeded.identity, generation: seeded.generation },
    },
  );
  await expect(otherTab.locator('#operation')).toContainText('"status":"conflict"');
  expect((await indexedDbState(otherTab, accountId)).acknowledgement).toMatchObject({
    status: 'acknowledged',
    revision: '1',
  });
});
