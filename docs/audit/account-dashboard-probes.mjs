// Deterministic Pass 3 probes. Browser uses intercepted synthetic services. DB uses createTestDatabase.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const timestamp = '2026-10-07T10:00:00.000Z';
const curated = 'international-dojo-2-hour-session';
const limit = 2_097_152;
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
let databaseStage = 'load harness and application modules';
const baseEntry = (entryId, trainingSetId, notes = '') => ({
  id: entryId,
  trainingSetId,
  notes,
  activityNotes: {},
  quantityOverrides: {},
  createdAt: timestamp,
});

function fixture(accountId, catalogueVersion, { target, unicode = false } = {}) {
  const sections = Array.from({ length: target === undefined ? 2 : 3 }, (_, group) => ({
    id: `audit-group-${group}`,
    name: `Audit group ${group}`,
    exercises: Array.from({ length: target === undefined ? 3 : 88 }, (_, exercise) => ({
      id: `audit-exercise-${group}-${exercise}`,
      name: `Exercise ${exercise}`,
      notes: target === undefined ? 'Start slowly, then focus on maai (間合い).' : '',
    })),
  }));
  const editable = baseEntry('audit-editable', curated);
  const custom = {
    ...baseEntry('audit-custom-entry', 'audit-custom', 'Synthetic practice plan.'),
    trainingSet: {
      id: 'audit-custom',
      name: 'Audit keiko',
      category: 'custom',
      isBuiltIn: false,
      sections,
    },
  };
  const request = {
    transportVersion: 1,
    expectedAccountWorkspaceId: accountId,
    expectedRevision: '1',
    requestId: id(1),
    catalogueVersion,
    dashboard: { version: 11, state: { dashboardEntries: [editable, custom] } },
  };
  if (target !== undefined) {
    let remaining = target - bytes(request);
    for (const { exercises } of sections) {
      for (const exercise of exercises) {
        const width = unicode ? 3 : 1;
        const length = Math.min(Math.floor(remaining / width), 8_000);
        exercise.notes = (unicode ? '稽' : 'x').repeat(length);
        remaining -= length * width;
      }
    }
    editable.notes = 'a'.repeat(remaining);
    assert.equal(bytes(request), target);
  }
  return request;
}

async function databaseProbe() {
  const { createTestDatabase } = await import('../../apps/api/src/database/test-database.ts');
  const { createApp } = await import('../../apps/api/src/app.ts');
  const { createAccount } = await import('../../apps/api/src/account/account.ts');
  const { createAccountAuthorization } =
    await import('../../apps/api/src/auth/account-authorization.ts');
  const { createDashboard } = await import('../../apps/api/src/dashboard/dashboard.ts');
  const { createDashboardCatalogue } = await import('../../apps/api/src/dashboard/validation.ts');
  const { createAccountApiClient, serializeDashboardWriteRequest } =
    await import('../../apps/web/src/lib/account-api.ts');
  const { createAccountDraftController } = await import('../../apps/web/src/lib/account-draft.ts');
  databaseStage = 'create guarded test schema';
  const db = await createTestDatabase({ clock: () => new Date(timestamp) });
  let controller;
  try {
    const origin = 'http://127.0.0.1:4173';
    const identity = {
      provider: 'neon',
      issuer: 'https://synthetic-issuer.example.test',
      subject: 'audit-dashboard',
      verifiedEmail: 'audit@example.test',
      expiresAt: Date.parse(timestamp) / 1_000 + 3_600,
    };
    const authorization = createAccountAuthorization({
      verify: async (token) =>
        token === 'synthetic-audit-token'
          ? { status: 'verified', identity }
          : { status: 'invalid' },
      lookup: db.persistence.managedAccounts,
      now: () => Date.parse(timestamp) / 1_000,
      getAppOrigin: () => origin,
    });
    const catalogue = createDashboardCatalogue();
    const account = createAccount({ authorization, persistence: db.persistence.managedAccounts });
    const dashboard = createDashboard({ authorization, persistence: db.persistence.dashboards });
    const unused = { handle: async () => new Response(null, { status: 501 }) };
    const app = createApp({ account, dashboard, adoption: unused, shares: unused });
    databaseStage = 'initialize synthetic account';
    const initialized = await db.persistence.managedAccounts.initializeManagedAccount(identity);
    assert.equal(initialized.status, 'initialized');
    const accountId = initialized.account.accountId;
    const log = [];
    let dropAck = false;
    let replayBody;
    const api = createAccountApiClient({
      origin,
      getToken: async () => ({ status: 'token', token: 'synthetic-audit-token' }),
      fetch: async (path, init) => {
        const headers = new Headers(init.headers);
        if (init.method === 'PUT') headers.set('origin', origin);
        const response = await app.handle(new Request(new URL(path, origin), { ...init, headers }));
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        const responseText = await response.clone().text();
        log.push({
          path,
          method: init.method,
          status: response.status,
          request: Buffer.byteLength(init.body ?? ''),
          response: Buffer.byteLength(responseText),
        });
        if (dropAck && init.method === 'PUT' && response.status === 200) {
          dropAck = false;
          replayBody = init.body;
          throw new Error('Synthetic response loss after handler commit');
        }
        if (replayBody !== undefined && init.method === 'PUT') {
          assert.equal(init.body, replayBody);
          replayBody = undefined;
        }
        return response;
      },
    });
    const rows = async () => {
      const result = await db.client.query(
        `SELECT d.revision::text, d.dashboard_json, count(r.request_id)::int AS receipts
         FROM cloud_dashboards d LEFT JOIN dashboard_write_receipts r ON r.user_id = d.user_id
         WHERE d.user_id = $1 GROUP BY d.user_id`,
        [accountId],
      );
      return result.rows[0];
    };
    databaseStage = 'read empty account';
    const readEmpty = await api.getDashboard(accountId);
    assert.equal(readEmpty.revision, '0');
    assert.equal(readEmpty.dashboard, null);
    const representative = fixture(accountId, catalogue.version);
    const seed = {
      ...representative,
      expectedRevision: '0',
      dashboard: { ...representative.dashboard, version: 10 },
    };
    databaseStage = 'seed and load v10 dashboard';
    assert.equal((await api.putDashboard(accountId, seed)).revision, '1');
    controller = createAccountDraftController({
      account: initialized.account,
      api,
      createRequestId: () => id(2),
    });
    controller.setOnline(true);
    await controller.load();
    assert.equal(controller.getSnapshot().status, 'ready');
    assert.equal(controller.getSnapshot().store.getState().dashboardEntries.length, 2);
    assert.equal(controller.getSnapshot().dirty, false);
    controller.getSnapshot().store.getState().updateDashboardEntry('audit-editable', {
      notes: 'Synthetic edit.',
    });
    databaseStage = 'drop and recover committed v11 acknowledgement';
    dropAck = true;
    await controller.save();
    assert.equal(controller.getSnapshot().saveState, 'uncertain');
    assert.equal(controller.getSnapshot().revision, '1');
    const committed = await rows();
    assert.equal(committed.revision, '2');
    assert.equal(committed.receipts, 2);
    assert.equal(JSON.parse(committed.dashboard_json).version, 11);
    await controller.retrySave();
    assert.equal(controller.getSnapshot().revision, '2');
    assert.equal(controller.getSnapshot().dirty, false);
    assert.deepEqual(await rows(), committed);
    databaseStage = 'test v10 replay, downgrade and stale revision';
    assert.equal((await api.putDashboard(accountId, seed)).revision, '1');
    await assert.rejects(
      () => api.putDashboard(accountId, { ...seed, expectedRevision: '2', requestId: id(3) }),
      (error) => error.code === 'DASHBOARD_VERSION_UPGRADE_REQUIRED',
    );
    await assert.rejects(
      () => api.putDashboard(accountId, { ...representative, requestId: id(4) }),
      (error) => error.code === 'REVISION_CONFLICT',
    );
    databaseStage = 'write and reload exact-limit Unicode dashboard';
    const near = fixture(accountId, catalogue.version, { target: limit, unicode: true });
    near.requestId = id(5);
    near.expectedRevision = '2';
    assert.equal(Buffer.byteLength(serializeDashboardWriteRequest(accountId, near)), limit);
    assert.equal((await api.putDashboard(accountId, near)).revision, '3');
    const loaded = await api.getDashboard(accountId);
    assert.equal(loaded.revision, '3');
    assert.deepEqual(loaded.dashboard, near.dashboard);
    await controller.reload();
    assert.equal(controller.getSnapshot().revision, '3');
    databaseStage = 'reject a one-byte overflow';
    const oversized = structuredClone(near);
    oversized.dashboard.state.dashboardEntries[0].notes += 'x';
    assert.throws(
      () => serializeDashboardWriteRequest(accountId, oversized),
      (error) => error.kind === 'oversized',
    );
    const lengthRejected = await app.handle(
      new Request(origin + '/api/dashboard', {
        method: 'PUT',
        headers: {
          origin,
          authorization: 'Bearer synthetic-audit-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify(oversized),
      }),
    );
    assert.equal(lengthRejected.status, 413);
    assert.equal((await rows()).receipts, 3);
    console.table(log);
    console.log(
      'Guarded SQL and real handler confirmed revisions 0 → 1 (v10) → 2 (v11) → 3; lost ACK left revision 2 and two receipts, replay left both unchanged, and over-limit request left three receipts.',
    );

    databaseStage = 'stream one oversized request through the Node listener';
    const { createNodeApp } = await import('../../apps/api/src/node-app.ts');
    const { withNodeListener } = await import('../../apps/api/src/test-node-listener.ts');
    await withNodeListener(
      createNodeApp({ account, dashboard, adoption: unused, shares: unused }),
      async (base) => {
        const body = new TextEncoder().encode(JSON.stringify(oversized));
        const stream = new ReadableStream({
          start(streamController) {
            streamController.enqueue(body.subarray(0, limit - 2));
            streamController.enqueue(body.subarray(limit - 2));
            streamController.close();
          },
        });
        const response = await fetch(base + '/api/dashboard', {
          method: 'PUT',
          headers: {
            origin,
            authorization: 'Bearer synthetic-audit-token',
            'content-type': 'application/json',
          },
          body: stream,
          duplex: 'half',
          signal: AbortSignal.timeout(10_000),
        });
        assert.equal(response.status, 413);
        assert.deepEqual(await response.json(), { error: 'REQUEST_TOO_LARGE' });
      },
    );
    assert.equal((await rows()).receipts, 3);
    console.log(
      'Real loopback Node listener returned 413 for a chunked limit+1 request, with unchanged receipt count.',
    );
  } finally {
    controller?.dispose();
    await db.close();
  }
}

async function browserProbe() {
  const { chromium, expect } =
    await import('../../apps/web/node_modules/@playwright/test/index.mjs');
  const { createServer } = await import('../../apps/web/node_modules/vite/dist/node/index.js');
  const {
    ACCOUNT_ID,
    OTHER_ACCOUNT_ID,
    CATALOGUE_VERSION,
    SYNTHETIC_AUTH_URL,
    SyntheticManagedHarness,
  } = await import('../../apps/web/e2e/synthetic-managed-harness.ts');
  process.env.VITE_NEON_AUTH_URL = SYNTHETIC_AUTH_URL;
  const baseURL = 'http://127.0.0.1:4182';
  const server = await createServer({
    root: new URL('../../apps/web', import.meta.url).pathname,
    server: { host: '127.0.0.1', port: 4182, strictPort: true },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage({ baseURL, acceptDownloads: true });
    page.setDefaultTimeout(10_000);
    const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
    await page.route('https://javiermarro.goatcounter.com/**', (route) => route.abort());
    const requests = () =>
      harness.apiCalls.map(({ method, path, body }) => [
        method,
        path,
        Buffer.byteLength(body ?? ''),
      ]);
    const writes = () => harness.apiCalls.filter(({ method }) => method === 'PUT');
    const note = 'Rejected synthetic note '.repeat(20);
    const near = fixture(ACCOUNT_ID, CATALOGUE_VERSION, { target: limit - 4 });
    harness.setDashboard(near.dashboard, '1');
    await page.goto('/app/account/dashboard');
    await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
    const loadCalls = requests();
    const loadAuthCalls = harness.authCalls.length;
    const notice = page.getByRole('complementary', { name: 'Cookie notice' });
    if (await notice.isVisible()) await notice.getByRole('button', { name: 'Got it' }).click();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const openDetails = () => page.getByRole('button', { name: 'View more' }).first().click();
    await openDetails();
    const dialog = page.getByRole('dialog');
    const notes = dialog.getByLabel('Practice notes');
    await notes.fill('OK');
    await notes.fill(note);
    await expect(notes).toHaveValue(note);
    assert.equal(writes().length, 0);
    await dialog.getByRole('button', { name: 'Save your changes' }).click();
    await expect(dialog.getByText('Changes saved to your account.', { exact: true })).toBeVisible();
    assert.ok(errors.some((message) => /exceeds/i.test(message)));
    assert.equal(JSON.parse(writes()[0].body).dashboard.state.dashboardEntries[0].notes, 'OK');
    await page.reload();
    await openDetails();
    await expect(notes).toHaveValue('OK');
    console.log('Initial browser API/SDK calls', JSON.stringify({ loadCalls, loadAuthCalls }));
    console.log(
      'KM-03-001 reproduced: overflow raised a page error; Save acknowledged the earlier note, and reload lost the text shown at Save.',
    );
    harness.setDashboard(fixture(ACCOUNT_ID, CATALOGUE_VERSION).dashboard, '2');
    await page.reload();
    await openDetails();
    await notes.fill('One');
    harness.failOneSave();
    await dialog.getByRole('button', { name: 'Save your changes' }).click();
    await expect(page.getByRole('button', { name: 'Retry same save' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload account' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry connection' }).click();
    await expect(page.getByRole('heading', { name: 'Account service unavailable' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry same save' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download draft' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload account' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry same save' }).click();
    await expect(page.getByText('Saved to account', { exact: true })).toBeVisible();
    assert.equal(writes()[1].body, writes()[2].body);
    console.log(
      'KM-03-002 reproduced: uncertainty has no in-app Reload before or after the connection probe; Download and exact retry are available.',
    );
    console.log('Browser synthetic API requests', JSON.stringify(requests()));
    console.log('Browser synthetic issuer calls', harness.authCalls.length);

    await openDetails();
    await notes.fill('Account A private draft');
    harness.failOneSave();
    await dialog.getByRole('button', { name: 'Save your changes' }).click();
    await expect(page.getByRole('button', { name: 'Retry same save' })).toBeVisible();
    let switched = false;
    await page.route('**/api/dashboard', async (route) => {
      if (route.request().method() === 'GET') {
        switched = true;
        harness.setAccountId(OTHER_ACCOUNT_ID);
      }
      await route.fallback();
    });
    const accountCheck = page.waitForResponse((response) =>
      response.url().endsWith('/api/account'),
    );
    const dashboardCheck = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/dashboard') && response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Retry connection' }).click();
    assert.equal((await (await accountCheck).json()).accountId, ACCOUNT_ID);
    assert.equal((await (await dashboardCheck).json()).accountWorkspaceId, OTHER_ACCOUNT_ID);
    await expect(page.getByText(/dashboard service is still unavailable/).first()).toBeVisible();
    assert.equal(switched, true);
    await expect(
      page.locator('.dashboard-card--compact').filter({ hasText: 'Audit keiko' }),
    ).toBeVisible();
    const downloadEvent = page.waitForEvent('download');
    await page
      .locator('.dashboard-draft-warning')
      .getByRole('button', { name: 'Download draft' })
      .click();
    const download = await downloadEvent;
    const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(backup.state.dashboardEntries[0].notes, 'Account A private draft');
    console.log(
      'KM-03-003 reproduced: a valid account-B dashboard response after account-A verification leaves account-A menus visible and private notes downloadable.',
    );
  } finally {
    await browser?.close();
    await server.close();
  }
}

try {
  if (process.argv[2] === 'db') await databaseProbe();
  else if (process.argv[2] === 'browser') await browserProbe();
  else throw new Error('Select the db or browser probe.');
} catch (error) {
  if (process.argv[2] === 'db') {
    console.error(
      'Guarded dashboard probe failed.',
      databaseStage,
      error.name,
      error.kind ?? '',
      error.code ?? '',
    );
  } else {
    console.error(error);
  }
  process.exitCode = 1;
}
