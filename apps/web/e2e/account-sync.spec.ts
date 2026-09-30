import { expect, test, type Page } from '@playwright/test';

async function readSynchronizationRecords(page: Page): Promise<{
  acknowledgement: unknown;
  pending: unknown;
  conflict: unknown;
  generation: number | null;
  cacheValue: string | null;
  recoveryValues: string[];
}> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kendo-menu-account-storage', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    try {
      const transaction = database.transaction('records', 'readonly');
      const read = (key: string): Promise<unknown> =>
        new Promise((resolve, reject) => {
          const request = transaction.objectStore('records').get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
        });
      const [ack, pending, conflict, cache, records] = await Promise.all([
        read('11111111-1111-4111-8111-111111111111:ack'),
        read('11111111-1111-4111-8111-111111111111:pending-request'),
        read('11111111-1111-4111-8111-111111111111:active-conflict'),
        read('11111111-1111-4111-8111-111111111111:cache'),
        new Promise<unknown[]>((resolve, reject) => {
          const request = transaction.objectStore('records').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error('IndexedDB scan failed'));
        }),
      ]);
      return {
        acknowledgement:
          typeof ack === 'object' && ack !== null && 'value' in ack ? ack.value : null,
        pending: pending ?? null,
        conflict: conflict ?? null,
        generation:
          typeof cache === 'object' &&
          cache !== null &&
          'generation' in cache &&
          typeof cache.generation === 'number'
            ? cache.generation
            : null,
        cacheValue:
          typeof cache === 'object' &&
          cache !== null &&
          'cacheValue' in cache &&
          typeof cache.cacheValue === 'string'
            ? cache.cacheValue
            : null,
        recoveryValues: records.flatMap((value) =>
          typeof value === 'object' &&
          value !== null &&
          'kind' in value &&
          value.kind === 'recovery' &&
          'rawValue' in value &&
          typeof value.rawValue === 'string'
            ? [value.rawValue]
            : [],
        ),
      };
    } finally {
      database.close();
    }
  });
}

test('an internal verified account uploads one durable edit and reload does not duplicate it', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => readSynchronizationRecords(page))
    .toMatchObject({ acknowledgement: { status: 'acknowledged', revision: '0' } });
  const baseline = await readSynchronizationRecords(page);
  expect(baseline.pending).toBeNull();

  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-edit')));
  await expect
    .poll(async () => readSynchronizationRecords(page))
    .toMatchObject({ acknowledgement: { status: 'acknowledged', revision: '1' }, pending: null });
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBe('1');
  const uploaded = await readSynchronizationRecords(page);
  expect(uploaded.generation).toBe((baseline.generation ?? -1) + 1);

  await page.reload();
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => readSynchronizationRecords(page))
    .toMatchObject({ acknowledgement: { status: 'acknowledged', revision: '1' }, pending: null });
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBe('1');
  expect((await readSynchronizationRecords(page)).generation).toBe(uploaded.generation);
});

test('a dashboard 401 hides the account and retry waits for fresh session verification', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html?sessionSignedOutAfter401=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });

  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-reject-next-dashboard')));
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-edit')));
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
      return page.locator('#operation').textContent();
    })
    .toBe('guest');
  await expect(page.locator('#operation')).toHaveText('guest');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:account-session-count')))
    .toBe('1');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-dashboard-get-count'))).toBe(
    '2',
  );

  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-retry')));
  await expect(page.locator('#operation')).toHaveText('paused');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-session-count'))).toBe('2');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-dashboard-get-count'))).toBe(
    '2',
  );
});

test('a 401 during use-local conflict resolution also hides the account', async ({ page }) => {
  await page.goto('/e2e/account-sync-fixture.html?sessionSignedOutAfter401=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-conflict')));
  await expect(page.locator('#operation')).toHaveText('conflict');
  const before = await readSynchronizationRecords(page);
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-reject-next-dashboard')));
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-use-local')));
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
      return page.locator('#operation').textContent();
    })
    .toBe('guest');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:account-session-count')))
    .toBe('1');
  expect((await readSynchronizationRecords(page)).cacheValue).toBe(before.cacheValue);
  expect((await readSynchronizationRecords(page)).conflict).toEqual(before.conflict);
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-retry')));
  await expect(page.locator('#operation')).toHaveText('paused');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-session-count'))).toBe('2');
});

test('retry re-verifies the same account before resuming a rejected dashboard write', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-reject-next-dashboard')));
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-edit')));
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
      return page.locator('#operation').textContent();
    })
    .toBe('guest');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-session-count'))).toBe('1');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBeNull();

  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-retry')));
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '1' });
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-session-count'))).toBe('2');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBe('1');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
  await expect(page.locator('#operation')).toHaveText('account');
});

test('a persistent dashboard 401 stays hidden without an automatic verification loop', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html?persistentDashboard401=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
      return page.locator('#operation').textContent();
    })
    .toBe('guest');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-session-count'))).toBe('1');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-dashboard-get-count'))).toBe(
    '1',
  );
  await page.waitForTimeout(1_200);
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-session-count'))).toBe('1');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-dashboard-get-count'))).toBe(
    '1',
  );
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-retry')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:account-dashboard-get-count')))
    .toBe('2');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-session-count'))).toBe('2');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
  await expect(page.locator('#operation')).toHaveText('guest');
});

test('logout cancels a held 401 retry verification and revokes the session', async ({ page }) => {
  await page.goto('/e2e/account-sync-fixture.html?holdRetrySession=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-reject-next-dashboard')));
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-edit')));
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
      return page.locator('#operation').textContent();
    })
    .toBe('guest');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-retry')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:retry-session-held')))
    .toBe('1');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-logout')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:logout-result')))
    .toBe('signed-out');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-logout-count'))).toBe('1');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-release-retry-session')));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
  await expect(page.locator('#operation')).toHaveText('guest');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-dashboard-get-count'))).toBe(
    '2',
  );
});

test('a malformed dashboard 401 hides the workspace before its error body is parsed', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() =>
    window.dispatchEvent(new Event('e2e-sync-reject-next-dashboard-malformed')),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-edit')));
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
      return page.locator('#operation').textContent();
    })
    .toBe('guest');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBeNull();
});

test('a dashboard PUT 401 hides the workspace and leaves the pending request durable', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-reject-next-put')));
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-edit')));
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
      return page.locator('#operation').textContent();
    })
    .toBe('guest');
  expect((await readSynchronizationRecords(page)).pending).toMatchObject({
    kind: 'pending-request',
  });
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBeNull();
});

test('a 401 in the GET after PUT conflict hides the workspace', async ({ page }) => {
  await page.goto('/e2e/account-sync-fixture.html');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-conflict-then-reject-get')));
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-edit')));
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
      return page.locator('#operation').textContent();
    })
    .toBe('guest');
  expect((await readSynchronizationRecords(page)).pending).toMatchObject({
    kind: 'pending-request',
  });
  expect((await readSynchronizationRecords(page)).conflict).toBeNull();
});

test('a newly synthesized empty cache loads an existing cloud dashboard', async ({ page }) => {
  await page.goto('/e2e/account-sync-fixture.html?cloud=existing');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '1' });
  const cacheValue = (await readSynchronizationRecords(page)).cacheValue;
  expect(cacheValue).not.toBeNull();
  const parsed: unknown = JSON.parse(cacheValue ?? 'null');
  expect(parsed).toMatchObject({
    state: { dashboardEntries: [{ trainingSetId: 'japanese-school-club' }] },
  });
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBeNull();
});

test('a migrated empty legacy cache conflicts with nonempty cloud without replacing local data', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html?cloud=existing&legacyEmpty=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).conflict)
    .toMatchObject({ kind: 'active-conflict' });
  const state = await readSynchronizationRecords(page);
  expect(state.acknowledgement).toMatchObject({ status: 'unknown' });
  expect(JSON.parse(state.cacheValue ?? 'null')).toMatchObject({ state: { dashboardEntries: [] } });
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBeNull();
});

test('explicit use-cloud retains the losing local cache across reload', async ({ page }) => {
  await page.goto('/e2e/account-sync-fixture.html');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });

  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-conflict')));
  await expect(page.locator('#operation')).toHaveText('conflict');
  const before = await readSynchronizationRecords(page);
  expect(before.conflict).toMatchObject({ kind: 'active-conflict' });
  expect(before.cacheValue).not.toBeNull();

  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-use-cloud')));
  await expect(page.locator('#operation')).toHaveText('refreshed');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => readSynchronizationRecords(page))
    .toMatchObject({ conflict: null, acknowledgement: { status: 'acknowledged', revision: '1' } });
  const after = await readSynchronizationRecords(page);
  expect(after.cacheValue).not.toBe(before.cacheValue);
  expect(after.recoveryValues).toContain(before.cacheValue);
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBeNull();

  await page.reload();
  await expect(page.locator('#result')).toHaveText('ready');
  expect((await readSynchronizationRecords(page)).recoveryValues).toContain(before.cacheValue);
});

test('explicit use-cloud fetches and adopts the latest cloud revision after conflict detection', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-conflict')));
  await expect(page.locator('#operation')).toHaveText('conflict');
  await expect
    .poll(async () => readSynchronizationRecords(page))
    .toMatchObject({ conflict: { kind: 'active-conflict' } });

  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-advance-cloud')));
  await expect(page.locator('#operation')).toHaveText('advanced');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-use-cloud')));
  await expect(page.locator('#operation')).toHaveText('refreshed');
  await expect
    .poll(async () => readSynchronizationRecords(page))
    .toMatchObject({ conflict: null, acknowledgement: { status: 'acknowledged', revision: '2' } });
  const cacheValue = (await readSynchronizationRecords(page)).cacheValue;
  expect(cacheValue).toBe(await page.evaluate(() => localStorage.getItem('e2e:newer-cloud-raw')));
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBeNull();
});

test('replacement restores the already-open account for offline local editing', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html?offlineAfterReplacement=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-conflict')));
  await expect(page.locator('#operation')).toHaveText('conflict');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-use-cloud')));
  await expect(page.locator('#operation')).toHaveText('refreshed');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:offline-after-replacement')))
    .toBe('1');
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
      return page.locator('#operation').textContent();
    })
    .toBe('account');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-session-count'))).toBe('1');

  const before = await readSynchronizationRecords(page);
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-edit')));
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).generation)
    .toBe((before.generation ?? -1) + 1);
  const edited = await readSynchronizationRecords(page);
  expect(edited.cacheValue).not.toBe(before.cacheValue);
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-session-count'))).toBe('1');

  await page.goto('/e2e/account-sync-fixture.html?noSyncLock=1');
  await expect(page.locator('#result')).toHaveText('ready');
  expect((await readSynchronizationRecords(page)).cacheValue).toBe(edited.cacheValue);
});

test('an offline bootstrap cannot cancel postgate local rehydration', async ({ page }) => {
  await page.goto(
    '/e2e/account-sync-fixture.html?offlineAfterReplacement=1&holdLocalRehydration=1',
  );
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-conflict')));
  await expect(page.locator('#operation')).toHaveText('conflict');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-use-cloud')));
  await expect(page.locator('#operation')).toHaveText('refreshed');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:local-rehydration-held')))
    .toBe('1');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-bootstrap')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:bootstrap-result')))
    .toBe('superseded');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-release-local-rehydration')));
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
      return page.locator('#operation').textContent();
    })
    .toBe('account');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-session-count'))).toBe('1');
});

for (const switchOutcome of ['different-account', 'offline'] as const) {
  test(`a held ${switchOutcome} verification takes precedence over postgate recovery`, async ({
    page,
  }) => {
    await page.goto(
      `/e2e/account-sync-fixture.html?holdReplacement=1&holdSwitchSession=${switchOutcome}`,
    );
    await expect(page.locator('#result')).toHaveText('ready');
    await expect
      .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
      .toMatchObject({ status: 'acknowledged', revision: '0' });
    await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-conflict')));
    await expect(page.locator('#operation')).toHaveText('conflict');
    await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-use-cloud')));
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('e2e:replacement-held')))
      .toBe('1');
    await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-bootstrap')));
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('e2e:switch-session-held')))
      .toBe('1');
    await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-release-replacement')));
    await expect
      .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
      .toMatchObject({ status: 'acknowledged', revision: '1' });
    await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
    await expect(page.locator('#operation')).toHaveText('guest');
    await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-release-switch-session')));
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('e2e:bootstrap-result')))
      .toBe(switchOutcome === 'offline' ? 'retryable' : 'ready');
    await expect
      .poll(async () => {
        await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-user')));
        return page.locator('#operation').textContent();
      })
      .toBe(
        switchOutcome === 'offline'
          ? '11111111-1111-4111-8111-111111111111'
          : '22222222-2222-4222-8222-222222222222',
      );
  });
}

test('use-cloud closes editing before commit, even when a later recovery write would hit quota', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html?raceUseCloud=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-conflict')));
  await expect(page.locator('#operation')).toHaveText('conflict');
  const before = await readSynchronizationRecords(page);
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-use-cloud')));
  await expect(page.locator('#operation')).toHaveText('refreshed');
  await expect
    .poll(async () => readSynchronizationRecords(page))
    .toMatchObject({ acknowledgement: { status: 'acknowledged', revision: '1' }, conflict: null });
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
      return page.locator('#operation').textContent();
    })
    .toBe('account');
  const after = await readSynchronizationRecords(page);
  expect(after.recoveryValues).toContain(before.cacheValue);
  expect(await page.evaluate(() => localStorage.getItem('e2e:late-edit'))).toBe('blocked');
  expect(await page.evaluate(() => localStorage.getItem('e2e:late-recovery-attempt'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBeNull();
  await page.reload();
  await expect(page.locator('#result')).toHaveText('ready');
  expect((await readSynchronizationRecords(page)).recoveryValues).toContain(before.cacheValue);
  expect(await page.evaluate(() => localStorage.getItem('e2e:late-edit'))).toBe('blocked');
});

test('automatic fast-forward closes editing before commit despite a post-commit quota fault', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html?raceFastForward=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-remote')));
  await expect(page.locator('#operation')).toHaveText('refreshed');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '1' });
  expect(await page.evaluate(() => localStorage.getItem('e2e:late-edit'))).toBe('blocked');
  expect(await page.evaluate(() => localStorage.getItem('e2e:late-recovery-attempt'))).toBeNull();
  await page.reload();
  await expect(page.locator('#result')).toHaveText('ready');
  expect((await readSynchronizationRecords(page)).cacheValue).toContain('japanese-school-club');
  expect(await page.evaluate(() => localStorage.getItem('e2e:late-edit'))).toBe('blocked');
});

test('a failed use-cloud replacement reopens the original confirmed cache', async ({ page }) => {
  await page.goto('/e2e/account-sync-fixture.html?failReplacement=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-conflict')));
  await expect(page.locator('#operation')).toHaveText('conflict');
  const before = await readSynchronizationRecords(page);
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-use-cloud')));
  await expect(page.locator('#operation')).toHaveText('retryable');
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
      return page.locator('#operation').textContent();
    })
    .toBe('account');
  expect((await readSynchronizationRecords(page)).cacheValue).toBe(before.cacheValue);
  expect((await readSynchronizationRecords(page)).conflict).toEqual(before.conflict);
  await page.reload();
  await expect(page.locator('#result')).toHaveText('ready');
  expect((await readSynchronizationRecords(page)).cacheValue).toBe(before.cacheValue);
});

test('bootstrap cannot reopen the editor while cloud replacement is held', async ({ page }) => {
  await page.goto('/e2e/account-sync-fixture.html?holdReplacement=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-conflict')));
  await expect(page.locator('#operation')).toHaveText('conflict');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-use-cloud')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:replacement-held')))
    .toBe('1');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-bootstrap')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:bootstrap-result')))
    .not.toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
  await expect(page.locator('#operation')).toHaveText('guest');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-release-replacement')));
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '1' });
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
      return page.locator('#operation').textContent();
    })
    .toBe('account');
});

test('hide during a held replacement prevents the scheduled account reopen', async ({ page }) => {
  await page.goto('/e2e/account-sync-fixture.html?holdReplacement=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-conflict')));
  await expect(page.locator('#operation')).toHaveText('conflict');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-use-cloud')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:replacement-held')))
    .toBe('1');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-hide')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:hide-result')))
    .toBe('hidden');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-release-replacement')));
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '1' });
  await page.waitForTimeout(200);
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
  await expect(page.locator('#operation')).toHaveText('guest');
});

test('logout during a held replacement revokes the session and prevents reopen', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html?holdReplacement=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-conflict')));
  await expect(page.locator('#operation')).toHaveText('conflict');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-use-cloud')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:replacement-held')))
    .toBe('1');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-logout')));
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-release-replacement')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:logout-result')))
    .toBe('signed-out');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-logout-count'))).toBe('1');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
  await expect(page.locator('#operation')).toHaveText('guest');
});

test('an in-flight logout prevents a replacement from canceling revocation', async ({ page }) => {
  await page.goto('/e2e/account-sync-fixture.html?holdLogout=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-conflict')));
  await expect(page.locator('#operation')).toHaveText('conflict');
  const before = await readSynchronizationRecords(page);
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-logout')));
  await expect.poll(() => page.evaluate(() => localStorage.getItem('e2e:logout-held'))).toBe('1');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-use-cloud')));
  await expect(page.locator('#operation')).toHaveText('retryable');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-release-logout')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:logout-result')))
    .toBe('signed-out');
  expect((await readSynchronizationRecords(page)).cacheValue).toBe(before.cacheValue);
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
  await expect(page.locator('#operation')).toHaveText('guest');
});

test('logout during postgate local rehydration prevents account reactivation', async ({ page }) => {
  await page.goto('/e2e/account-sync-fixture.html?holdReplacement=1&holdLocalRehydration=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-conflict')));
  await expect(page.locator('#operation')).toHaveText('conflict');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-use-cloud')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:replacement-held')))
    .toBe('1');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-release-replacement')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:local-rehydration-held')))
    .toBe('1');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-logout')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:logout-result')))
    .toBe('signed-out');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-logout-count'))).toBe('1');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-release-local-rehydration')));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
  await expect(page.locator('#operation')).toHaveText('guest');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-session-count'))).toBe('1');
});

test('failed logout while replacement is hidden keeps revocation retry available', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html?holdReplacement=1&failFirstLogout=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-conflict')));
  await expect(page.locator('#operation')).toHaveText('conflict');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-use-cloud')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:replacement-held')))
    .toBe('1');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-logout')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:logout-result')))
    .toBe('retryable');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-release-replacement')));
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '1' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-logout')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:logout-result')))
    .toBe('signed-out');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-logout-count'))).toBe('2');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
  await expect(page.locator('#operation')).toHaveText('guest');
});

test('hide after gate completion does not strand an in-flight logout intent', async ({ page }) => {
  await page.goto('/e2e/account-sync-fixture.html?holdReplacement=1&holdLogout=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-conflict')));
  await expect(page.locator('#operation')).toHaveText('conflict');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-use-cloud')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:replacement-held')))
    .toBe('1');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-logout')));
  await expect.poll(() => page.evaluate(() => localStorage.getItem('e2e:logout-held'))).toBe('1');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-release-replacement')));
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '1' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-hide')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:hide-result')))
    .toBe('hidden');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-release-logout')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('e2e:logout-result')))
    .toBe('signed-out');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-read-mode')));
  await expect(page.locator('#operation')).toHaveText('guest');
});

test('explicit use-local prepares a new conditional request and acknowledges it', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });

  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-stage-conflict')));
  await expect(page.locator('#operation')).toHaveText('conflict');
  const local = await readSynchronizationRecords(page);
  expect(local.cacheValue).not.toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-use-local')));
  await expect(page.locator('#operation')).toHaveText('uploaded');
  await expect
    .poll(async () => readSynchronizationRecords(page))
    .toMatchObject({
      conflict: null,
      pending: null,
      acknowledgement: { status: 'acknowledged', revision: '2' },
    });
  const after = await readSynchronizationRecords(page);
  expect(after.cacheValue).toBe(local.cacheValue);
  expect(after.recoveryValues).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBe('1');
});

test('removing the final account entry uploads the empty dashboard', async ({ page }) => {
  await page.goto('/e2e/account-sync-fixture.html');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-edit')));
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '1' });

  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-clear')));
  await expect(page.locator('#operation')).toHaveText('uploaded');
  await expect
    .poll(async () => readSynchronizationRecords(page))
    .toMatchObject({ acknowledgement: { status: 'acknowledged', revision: '2' }, pending: null });
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBe('2');
});

test('an unavailable synchronization lock pauses uploads while account edits persist locally', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html?noSyncLock=1');
  await expect(page.locator('#result')).toHaveText('ready');
  const baseline = await readSynchronizationRecords(page);
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-edit')));
  await expect(page.locator('#operation')).toHaveText('paused');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).generation)
    .toBe((baseline.generation ?? -1) + 1);
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBeNull();
});

test('only an eligible guest awaiting Yes or No pauses ordinary account uploads', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html?guest=eligible');
  await expect(page.locator('#result')).toHaveText('ready');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-edit')));
  await expect
    .poll(async () => {
      const status = await page.locator('#operation').textContent();
      if (status === 'retryable') {
        await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-retry')));
      }
      return status;
    })
    .toBe('awaiting-adoption');
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).not.toBeNull();

  await page.evaluate(() => localStorage.removeItem('kendo-menu'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '1' });
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBe('1');
});

test('an eligible guest appearing after request preparation pauses its first send', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html?guest=appears');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-edit')));
  await expect(page.locator('#operation')).toHaveText('awaiting-adoption');
  expect((await readSynchronizationRecords(page)).pending).toMatchObject({
    kind: 'pending-request',
  });
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBeNull();

  await page.evaluate(() => localStorage.removeItem('kendo-menu'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect
    .poll(async () => readSynchronizationRecords(page))
    .toMatchObject({ acknowledgement: { status: 'acknowledged', revision: '1' }, pending: null });
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBe('1');
});

test('invalid guest data does not invent a No decision or block ordinary uploads', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html?guest=invalid');
  await expect(page.locator('#result')).toHaveText('ready');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-edit')));
  await expect
    .poll(async () => readSynchronizationRecords(page))
    .toMatchObject({ acknowledgement: { status: 'acknowledged', revision: '1' } });
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe('{broken');
});

test('a lost response replays the same pending request after reload without a second cloud write', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html?loseAck=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });

  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-edit')));
  await expect
    .poll(async () => ({
      puts: await page.evaluate(() => localStorage.getItem('e2e:account-put-count')),
      pending: (await readSynchronizationRecords(page)).pending,
    }))
    .toMatchObject({ puts: '1', pending: { kind: 'pending-request' } });

  await page.reload();
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => readSynchronizationRecords(page))
    .toMatchObject({ acknowledgement: { status: 'acknowledged', revision: '1' }, pending: null });
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBe('1');
});

test('an edit after a lost acknowledgement remains dirty and uploads after replay', async ({
  page,
}) => {
  await page.goto('/e2e/account-sync-fixture.html?loseAck=1');
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).acknowledgement)
    .toMatchObject({ status: 'acknowledged', revision: '0' });

  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-edit')));
  await expect
    .poll(async () => readSynchronizationRecords(page))
    .toMatchObject({ pending: { kind: 'pending-request' } });
  const first = await readSynchronizationRecords(page);
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-sync-edit-second')));
  await expect
    .poll(async () => (await readSynchronizationRecords(page)).generation)
    .toBe((first.generation ?? -1) + 1);

  await page.reload();
  await expect(page.locator('#result')).toHaveText('ready');
  await expect
    .poll(async () => readSynchronizationRecords(page))
    .toMatchObject({ acknowledgement: { status: 'acknowledged', revision: '2' }, pending: null });
  expect(await page.evaluate(() => localStorage.getItem('e2e:account-put-count'))).toBe('2');
});
