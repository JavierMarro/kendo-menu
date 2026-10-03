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

test('Yes and No completion commit atomically while divergent caches keep pending decisions', async ({
  page,
}) => {
  await page.goto('/e2e/account-database-fixture.html?observer=1');
  await expect(page.locator('#result')).toHaveText('observer');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-db-complete-adoption')));
  await expect(page.locator('#operation')).toContainText('"accepted"');
  const result: unknown = JSON.parse(await page.locator('#operation').innerText());
  expect(result).toMatchObject({
    accepted: {
      status: 'committed',
      acknowledgement: {
        status: 'acknowledged',
        revision: '1',
        requestId: '88888888-8888-4888-8888-888888888888',
        updatedAt: '2026-09-30T10:00:00.000Z',
      },
      pending: null,
    },
    divergent: { status: 'conflict', pending: { kind: 'adoption' } },
    declined: {
      status: 'committed',
      acknowledgement: {
        status: 'adoption-declined',
        requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
      pending: null,
    },
    divergentDecline: { status: 'conflict', pending: { kind: 'adoption' } },
  });
  if (
    typeof result !== 'object' ||
    result === null ||
    !('guestRaw' in result) ||
    typeof result.guestRaw !== 'string' ||
    !('emptyRaw' in result) ||
    typeof result.emptyRaw !== 'string' ||
    !('accepted' in result) ||
    typeof result.accepted !== 'object' ||
    result.accepted === null ||
    !('cacheValue' in result.accepted) ||
    !('divergent' in result) ||
    typeof result.divergent !== 'object' ||
    result.divergent === null ||
    !('cacheValue' in result.divergent) ||
    !('declined' in result) ||
    typeof result.declined !== 'object' ||
    result.declined === null ||
    !('cacheValue' in result.declined) ||
    !('divergentDecline' in result) ||
    typeof result.divergentDecline !== 'object' ||
    result.divergentDecline === null ||
    !('cacheValue' in result.divergentDecline)
  ) {
    throw new Error('Adoption completion fixture returned an invalid result');
  }
  expect(result.accepted.cacheValue).toBe(result.guestRaw);
  expect(result.divergent.cacheValue).toBe(result.guestRaw);
  expect(result.declined.cacheValue).toBe(result.emptyRaw);
  expect(result.divergentDecline.cacheValue).toBe(result.guestRaw);
  expect(await indexedDbState(page, '66666666-6666-4666-8666-666666666666')).toMatchObject({
    acknowledgement: { status: 'acknowledged', revision: '1' },
    pending: null,
  });
  expect(await indexedDbState(page, '77777777-7777-4777-8777-777777777777')).toMatchObject({
    pending: { kind: 'pending-request' },
  });
  expect(await indexedDbState(page, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toMatchObject({
    acknowledgement: { status: 'adoption-declined' },
    pending: null,
  });
  expect(await indexedDbState(page, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toMatchObject({
    pending: { kind: 'pending-request' },
  });
});

test('authoritative terminal reconciliation keeps pending requests after quota or readback failure', async ({
  page,
}) => {
  await page.goto('/e2e/account-database-fixture.html?observer=1');
  await expect(page.locator('#result')).toHaveText('observer');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-db-reconcile-adoption')));
  await expect(page.locator('#operation')).toContainText('"failure"');
  const result: unknown = JSON.parse(await page.locator('#operation').innerText());
  expect(result).toMatchObject({
    accepted: {
      status: 'committed',
      acknowledgement: {
        status: 'acknowledged',
        requestId: '14141414-1414-4414-8414-141414141414',
        revision: '1',
        updatedAt: '2026-09-30T10:00:00.000Z',
      },
      pending: null,
    },
    advanced: {
      status: 'committed',
      acknowledgement: {
        status: 'acknowledged',
        requestId: null,
        revision: '2',
        updatedAt: '2026-09-30T10:01:00.000Z',
      },
      pending: null,
    },
    declined: {
      status: 'committed',
      acknowledgement: {
        status: 'adoption-declined',
        requestId: '14141414-1414-4414-8414-141414141414',
      },
      pending: null,
    },
    failure: {
      name: 'QuotaExceededError',
      acknowledgement: { status: 'unknown' },
      pending: { kind: 'adoption' },
    },
    acceptedReadback: {
      errorName: 'UnknownError',
      acknowledgement: { status: 'unknown' },
      pending: { kind: 'adoption' },
    },
    declinedReadback: {
      errorName: 'UnknownError',
      acknowledgement: { status: 'unknown' },
      pending: { kind: 'adoption' },
    },
  });
  if (
    typeof result !== 'object' ||
    result === null ||
    !('accepted' in result) ||
    typeof result.accepted !== 'object' ||
    result.accepted === null ||
    !('cacheValue' in result.accepted) ||
    !('declined' in result) ||
    typeof result.declined !== 'object' ||
    result.declined === null ||
    !('cacheValue' in result.declined) ||
    !('failure' in result) ||
    typeof result.failure !== 'object' ||
    result.failure === null ||
    !('cacheValue' in result.failure) ||
    !('advanced' in result) ||
    typeof result.advanced !== 'object' ||
    result.advanced === null ||
    !('cacheValue' in result.advanced) ||
    !('acceptedReadback' in result) ||
    typeof result.acceptedReadback !== 'object' ||
    result.acceptedReadback === null ||
    !('cacheValue' in result.acceptedReadback) ||
    !('declinedReadback' in result) ||
    typeof result.declinedReadback !== 'object' ||
    result.declinedReadback === null ||
    !('cacheValue' in result.declinedReadback) ||
    !('winningRaw' in result) ||
    !('losingRaw' in result) ||
    !('emptyRaw' in result)
  ) {
    throw new Error('Authoritative reconciliation fixture returned an invalid result');
  }
  expect(result.accepted.cacheValue).toBe(result.winningRaw);
  expect(result.advanced.cacheValue).toBe(result.winningRaw);
  expect(result.accepted.cacheValue).not.toBe(result.losingRaw);
  expect(result.declined.cacheValue).toBe(result.emptyRaw);
  expect(result.failure.cacheValue).toBe(result.emptyRaw);
  expect(result.acceptedReadback.cacheValue).toBe(result.emptyRaw);
  expect(result.declinedReadback.cacheValue).toBe(result.emptyRaw);
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
