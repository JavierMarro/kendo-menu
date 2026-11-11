import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';

const { Headers, Request } = globalThis;
const date = '2026-11-09T10:00:00.000Z';
const fakeToken = 's'.repeat(43);
const guestKey = 'kendo-menu';
const snapshot = {
  version: 1,
  name: 'Audit keiko',
  sections: [
    {
      name: 'Main practice',
      exercises: [{ name: 'Suburi', quantities: { repetitions: 0 } }],
    },
  ],
};

function source(large) {
  const trainingSetId = 'audit-custom-menu';
  const name = large ? '稽'.repeat(200) : 'Audit keiko';
  const quantities = {
    repetitions: large ? 500 : 24,
    sets: large ? 25 : 2,
    rounds: large ? 15 : 1,
    duration: { unit: 'minutes', min: 2, max: 12 },
  };
  const node = (id, nodeName) => ({ id, name: nodeName, quantities, notes: 'private node note' });
  const sections = Array.from({ length: large ? 4 : 1 }, (_, section) => ({
    ...node(`group-${section}`, large ? name : 'Main practice'),
    exercises: Array.from({ length: large ? 127 : 1 }, (_, exercise) =>
      node(`exercise-${section}-${exercise}`, large ? name : 'Suburi'),
    ),
  }));
  const quantityOverrides = Object.fromEntries(
    sections.flatMap((section) =>
      [section, ...section.exercises].map(({ id }) => [id, { repetitions: 0, seconds: 30 }]),
    ),
  );
  return {
    id: large ? '稽'.repeat(256) : 'audit-entry',
    trainingSetId,
    trainingSet: {
      id: trainingSetId,
      name,
      description: 'private description',
      category: 'custom',
      customIntensity: 'high-intensity-drill',
      sections,
      isBuiltIn: false,
    },
    quantityOverrides,
    activityNotes: {},
    notes: 'private entry note',
    createdAt: date,
  };
}

async function database() {
  const { createTestDatabase } = await import('../../apps/api/src/database/test-database.ts');
  const { createApp } = await import('../../apps/api/src/app.ts');
  const { createAccount } = await import('../../apps/api/src/account/account.ts');
  const { createDashboard } = await import('../../apps/api/src/dashboard/dashboard.ts');
  const { createAdoption } = await import('../../apps/api/src/adoption/adoption.ts');
  const { createShares } = await import('../../apps/api/src/shares/shares.ts');
  const { createAccountAuthorization } =
    await import('../../apps/api/src/auth/account-authorization.ts');
  const { createDashboardCatalogue } = await import('../../apps/api/src/dashboard/validation.ts');
  const { createAccountApiClient } = await import('../../apps/web/src/lib/account-api.ts');
  const { createAccountDraftController } = await import('../../apps/web/src/lib/account-draft.ts');
  const db = await createTestDatabase({ clock: () => new Date(date) });
  try {
    const origin = 'https://app.example.test';
    const now = Date.parse(date) / 1_000;
    const catalogueVersion = createDashboardCatalogue().version;
    const authorization = createAccountAuthorization({
      verify: async (token) =>
        ['audit-owner', 'audit-recipient'].includes(token)
          ? {
              status: 'verified',
              identity: {
                provider: 'neon',
                issuer: 'https://issuer.example.test',
                subject: token,
                verifiedEmail: null,
                expiresAt: now + 3600,
              },
            }
          : { status: 'invalid' },
      lookup: db.persistence.managedAccounts,
      now: () => now,
      getAppOrigin: () => origin,
    });
    const app = createApp({
      account: createAccount({ authorization, persistence: db.persistence.managedAccounts }),
      dashboard: createDashboard({ authorization, persistence: db.persistence.dashboards }),
      adoption: createAdoption({ authorization, persistence: db.persistence.managedCopy }),
      shares: createShares({ authorization, persistence: db.persistence.shares }),
    });
    const log = [];
    async function request(path, init = {}) {
      const headers = new Headers(init.headers);
      if (['POST', 'PUT'].includes(init.method) && !headers.has('origin'))
        headers.set('origin', origin);
      const response = await app.handle(new Request(new URL(path, origin), { ...init, headers }));
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      log.push([
        init.method ?? 'GET',
        path.replace(/\/shares\/[A-Za-z0-9_-]{43}/u, '/shares/:token'),
        response.status,
        Buffer.byteLength(init.body ?? ''),
        Buffer.byteLength(await response.clone().text()),
        headers.has('authorization'),
      ]);
      return response;
    }
    const client = (token) =>
      createAccountApiClient({
        origin,
        getToken: async () => ({ status: 'token', token }),
        fetch: request,
      });
    const owner = client('audit-owner');
    const visitor = client('audit-recipient');
    const { accountId: ownerId } = await owner.initializeAccount();
    const recipient = await visitor.initializeAccount();
    const createBody = (entryId, expectedRevision = '1') => ({
      expectedAccountWorkspaceId: ownerId,
      expectedRevision,
      entryId,
    });
    const createRaw = (body, requestOrigin = origin) =>
      request('/api/shares', {
        method: 'POST',
        headers: {
          origin: requestOrigin,
          'content-type': 'application/json',
          authorization: 'Bearer audit-owner',
        },
        body,
      });
    assert.equal(
      (await createRaw(JSON.stringify(createBody('audit-entry')), 'https://other.example.test'))
        .status,
      403,
    );
    assert.equal((await createRaw('{')).status, 400);
    assert.equal((await createRaw(' '.repeat(2_097_153))).status, 413);
    assert.equal((await request(`/api/shares/${fakeToken}/recipient`)).status, 401);
    assert.equal((await request('/api/shares/short')).status, 404);
    assert.deepEqual(await (await request(`/api/shares/${fakeToken}`)).json(), {
      error: 'SHARE_NOT_FOUND',
    });
    const head = await request(`/api/shares/${fakeToken}`, { method: 'HEAD' });
    assert.equal(head.status, 405);
    assert.equal(head.headers.get('allow'), 'GET');
    assert.equal(await head.text(), '');
    console.log('negative HTTP measurements', JSON.stringify(log.splice(0)));

    const samples = [];
    const entries = [source(false), source(true)];
    const firstSave = {
      transportVersion: 1,
      expectedAccountWorkspaceId: ownerId,
      expectedRevision: '0',
      requestId: randomUUID(),
      catalogueVersion,
      dashboard: { version: 11, state: { dashboardEntries: entries } },
    };
    const saved = await owner.putDashboard(ownerId, firstSave);
    assert.equal(saved.revision, '1');
    const sourceTokens = [];
    let recipientToken;
    for (const [index, entry] of entries.entries()) {
      log.length = 0;
      const share = await owner.createMenuShare(ownerId, '1', entry.id);
      sourceTokens.push(share.token);
      const publicRead = await owner.getSharedMenu(share.token);
      const recipientRead = await visitor.getSharedMenuForRecipient(
        recipient.accountId,
        share.token,
      );
      assert.deepEqual(recipientRead.snapshot, publicRead.snapshot);
      assert.equal(recipientRead.isSender, false);
      assert.equal((await owner.getSharedMenuForRecipient(ownerId, share.token)).isSender, true);
      const json = JSON.stringify(publicRead);
      for (const forbidden of [
        'private',
        'description',
        'quantityOverrides',
        'trainingSetId',
        'exercise-0-0',
        ownerId,
      ])
        assert.ok(!json.includes(forbidden));
      assert.deepEqual(publicRead.snapshot.sections[0].exercises[0].additionalDuration, {
        unit: 'seconds',
        value: 30,
      });
      assert.equal(publicRead.snapshot.sections[0].exercises[0].quantities.repetitions, 0);
      assert.deepEqual(publicRead.snapshot.sections[0].exercises[0].quantities.duration, {
        unit: 'minutes',
        min: 2,
        max: 12,
      });
      const reused = await owner.createMenuShare(ownerId, '1', entry.id);
      assert.equal(reused.token, share.token);
      samples.push({
        label: index === 0 ? 'representative' : 'near-domain-limit',
        calls: log.splice(0),
      });
      if (index === 0) {
        const controller = createAccountDraftController({ account: recipient, api: visitor });
        try {
          controller.setOnline(true);
          await controller.load();
          const id = controller.importSharedMenu(recipientRead.snapshot, false);
          assert.notEqual(id, entry.id);
          assert.equal(controller.getSnapshot().dirty, true);
          const draft = controller.getSnapshot().store;
          assert.ok(draft);
          draft.getState().updateDashboardEntry(id, { notes: 'private recipient note' });
          assert.equal((await visitor.getDashboard(recipient.accountId)).revision, '0');
          await controller.save();
          const loaded = await visitor.getDashboard(recipient.accountId);
          assert.equal(loaded.revision, '1');
          assert.equal(loaded.dashboard.state.dashboardEntries[0].receivedViaShare, true);
          assert.equal(loaded.dashboard.state.dashboardEntries[0].notes, 'private recipient note');
          const reshared = await visitor.createMenuShare(recipient.accountId, '1', id);
          recipientToken = reshared.token;
          assert.notEqual(reshared.token, share.token);
          assert.deepEqual(await visitor.getSharedMenu(reshared.token), publicRead);
          assert.equal(
            (await visitor.getSharedMenuForRecipient(recipient.accountId, reshared.token)).isSender,
            true,
          );
        } finally {
          controller.dispose();
        }
      }
    }
    const after = await owner.getDashboard(ownerId);
    assert.equal(after.revision, '1');
    assert.equal(
      (await db.client.query('SELECT count(*)::int AS n FROM menu_shares')).rows[0].n,
      3,
    );
    console.log('successful HTTP measurements', JSON.stringify(samples));
    await owner.putDashboard(ownerId, {
      ...firstSave,
      expectedRevision: '1',
      requestId: randomUUID(),
      dashboard: { version: 11, state: { dashboardEntries: [] } },
    });
    for (const token of sourceTokens) await owner.getSharedMenu(token);
    // The test harness owns this schema and both synthetic users.
    await db.client.query('DELETE FROM dashboard_write_receipts WHERE user_id = $1', [ownerId]);
    await db.client.query('DELETE FROM cloud_dashboards WHERE user_id = $1', [ownerId]);
    await db.client.query('DELETE FROM account_copy_opportunities WHERE user_id = $1', [ownerId]);
    await db.client.query('DELETE FROM users WHERE id = $1', [ownerId]);
    for (const token of sourceTokens) {
      await assert.rejects(
        () => owner.getSharedMenu(token),
        (error) => error.code === 'SHARE_NOT_FOUND',
      );
      await assert.rejects(
        () => visitor.getSharedMenuForRecipient(recipient.accountId, token),
        (error) => error.code === 'SHARE_NOT_FOUND',
      );
    }
    assert.ok(recipientToken);
    await visitor.getSharedMenu(recipientToken);
    const independent = await visitor.getDashboard(recipient.accountId);
    assert.equal(independent.dashboard.state.dashboardEntries[0].receivedViaShare, true);
    console.log(
      'Source removal preserved links. Local owner deletion removed only the original shares and kept the actual imported v11 copy and its re-share.',
    );
  } finally {
    await db.close();
  }
}

async function metadata() {
  const { default: adapter } = await import('../../api/[...path].ts');
  const url = `http://preview.example.test/app/shared/${fakeToken}?synthetic=discarded`;
  const document = await adapter.fetch(new Request(url));
  assert.equal(document.status, 200);
  assert.equal(document.headers.get('cache-control'), 'private, no-store');
  const html = await document.text();
  assert.ok(html.includes('name="referrer" content="no-referrer"'));
  assert.ok(html.includes('name="robots" content="noindex, nofollow"'));
  assert.ok(
    html.includes(
      `property="og:url" content="https://preview.example.test/app/shared/${fakeToken}"`,
    ),
  );
  assert.ok(!html.includes('synthetic=discarded') && !html.includes('rel="canonical"'));
  const head = await adapter.fetch(new Request(url, { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  console.log('Hosted fake-share document', {
    bodyBytes: Buffer.byteLength(html),
    status: document.status,
    headBytes: 0,
  });
}

async function browser() {
  const { chromium, expect } =
    await import('../../apps/web/node_modules/@playwright/test/index.mjs');
  const { createServer } = await import('../../apps/web/node_modules/vite/dist/node/index.js');
  const { ACCOUNT_ID, SYNTHETIC_AUTH_URL, SyntheticManagedHarness } =
    await import('../../apps/web/e2e/synthetic-managed-harness.ts');
  const { workspaceLink } = await import('../../apps/web/e2e/workspace-test-helpers.ts');
  process.env.VITE_NEON_AUTH_URL = SYNTHETIC_AUTH_URL;
  const baseURL = 'http://127.0.0.1:4186';
  const publicPath = `/app/shared/${fakeToken}`;
  const recipientPath = `/app/account/shared/${fakeToken}`;
  const endpoint = `/api/shares/${fakeToken}`;
  const server = await createServer({
    root: new URL('../../apps/web', import.meta.url).pathname,
    server: { host: '127.0.0.1', port: 4186, strictPort: true },
  });
  let instance;

  async function withPage(options, run) {
    const context = await instance.newContext({ baseURL, serviceWorkers: 'block' });
    try {
      await context.route('**/*', (route) =>
        route
          .request()
          .url()
          .startsWith(baseURL + '/')
          ? route.fallback()
          : route.abort(),
      );
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const harness = await SyntheticManagedHarness.install(page, options);
      const calls = [];
      page.on('request', (request) => {
        const { pathname } = new URL(request.url());
        if (pathname.startsWith('/api/') || request.url().startsWith(SYNTHETIC_AUTH_URL + '/')) {
          calls.push([
            request.method(),
            pathname.replace(fakeToken, ':token'),
            Boolean(request.headers().authorization),
          ]);
        }
      });
      await page.route(`**${publicPath}`, async (route) =>
        route.fulfill({ response: await route.fetch({ url: `${baseURL}/shared-menu.html` }) }),
      );
      await run(page, harness, calls);
      assert.equal(
        await page.evaluate((key) => globalThis.localStorage.getItem(key), guestKey),
        null,
      );
    } finally {
      await context.close();
    }
  }
  const heading = (page) => page.getByRole('heading', { name: snapshot.name, exact: true });
  const unavailable = (page) => page.getByRole('heading', { name: 'Shared menu unavailable' });
  const dismiss = async (page) => {
    const notice = page.getByRole('complementary', { name: 'Cookie notice' });
    if (await notice.isVisible()) await notice.getByRole('button', { name: 'Got it' }).click();
  };
  try {
    await server.listen();
    instance = await chromium.launch();
    for (const signedIn of [true, false]) {
      await withPage(
        { initiallySignedIn: signedIn, initiallyUninitialized: !signedIn },
        async (page, harness, calls) => {
          await page.route(`**${endpoint}`, (route) => route.fulfill({ json: { snapshot } }));
          await page.route(`**${endpoint}/recipient`, (route) =>
            route.fulfill({
              json: { snapshot, isSender: signedIn, accountWorkspaceId: ACCOUNT_ID },
            }),
          );
          await page.goto(publicPath);
          await expect(heading(page)).toBeVisible();
          await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
            'href',
            'https://www.kendomenu.com/app',
          );
          await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
            'content',
            'https://www.kendomenu.com/app',
          );
          await dismiss(page);
          if (signedIn) await page.getByRole('link', { name: 'Continue to add this menu' }).click();
          else await page.getByRole('button', { name: 'Sign in to add' }).click();
          await expect(page).toHaveURL(baseURL + recipientPath);
          const add = page.getByRole('button', {
            name: signedIn ? 'Add a copy to my dashboard' : 'Add to my dashboard',
            exact: true,
          });
          await expect(add).toBeEnabled();
          assert.equal(harness.apiCalls.filter(({ method }) => method === 'PUT').length, 0);
          assert.equal(
            harness.apiCalls.filter(({ path }) => path === '/api/dashboard/adoption').length,
            0,
          );
          assert.deepEqual(
            calls.filter(([, path]) => path.startsWith('/api/shares/')),
            [
              ['GET', '/api/shares/:token', false],
              ['GET', '/api/shares/:token/recipient', true],
            ],
          );
          console.log(
            signedIn
              ? 'signed-in self preview to recipient'
              : 'signed-out new account with empty guest source',
            JSON.stringify(calls),
          );
          await dismiss(page);
          const callsBeforeAdd = calls.length;
          await add.dblclick();
          await expect(
            page.getByRole('button', { name: 'Added to dashboard', exact: true }),
          ).toBeDisabled();
          await page.getByRole('link', { name: 'View dashboard' }).click();
          await expect(heading(page)).toHaveCount(1);
          const card = page.getByRole('article').filter({ has: heading(page) });
          await expect(card.getByText('Shared', { exact: true })).toHaveCount(signedIn ? 0 : 1);
          assert.equal(harness.apiCalls.filter(({ method }) => method === 'PUT').length, 0);
          assert.equal(calls.length, callsBeforeAdd);
        },
      );
    }

    await withPage({ initiallySignedIn: false }, async (page) => {
      let status = 503;
      await page.route(`**${endpoint}`, (route) =>
        route.fulfill({
          status,
          json: status === 503 ? { error: 'SHARE_UNAVAILABLE' } : { snapshot },
        }),
      );
      await page.goto(publicPath);
      await expect(unavailable(page)).toBeVisible();
      await expect(
        page.getByText(/link may be invalid or the owner’s account may have been removed/),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: /retry/i })).toHaveCount(0);
      status = 200;
      await page.reload();
      await expect(heading(page)).toBeVisible();
      console.log(
        'Temporary 503 is presented as a possibly invalid or removed link. Browser reload recovered.',
      );
    });

    await withPage({ initiallySignedIn: true }, async (page, harness, calls) => {
      harness.setDashboard({ version: 11, state: { dashboardEntries: [source(false)] } }, '1');
      await page.route(`**${endpoint}/recipient`, (route) =>
        route.fulfill({ status: 401, json: { error: 'UNAUTHENTICATED' } }),
      );
      await page.goto(recipientPath);
      await expect(unavailable(page)).toBeVisible();
      await dismiss(page);
      const checks = calls.filter(([, path]) => path === '/api/account').length;
      await workspaceLink(page, 'Dashboard').click();
      await expect(heading(page)).toBeVisible();
      assert.equal(calls.filter(([, path]) => path === '/api/account').length, checks);
      console.log(
        'A synthetic protected 401 at the recipient endpoint did not hide the loaded account dashboard.',
      );
    });

    for (const exit of ['dashboard', 'sign-out']) {
      await withPage({ initiallySignedIn: true }, async (page, harness) => {
        let release;
        const held = new Promise((resolve) => {
          release = resolve;
        });
        await page.route(`**${endpoint}/recipient`, async (route) => {
          await held;
          await route
            .fulfill({ json: { snapshot, isSender: false, accountWorkspaceId: ACCOUNT_ID } })
            .catch(() => undefined);
        });
        try {
          const [pending] = await Promise.all([
            page.waitForRequest(
              (request) => new URL(request.url()).pathname === `${endpoint}/recipient`,
            ),
            page.goto(recipientPath),
          ]);
          await dismiss(page);
          const cancelled = page.waitForEvent('requestfailed', (request) => request === pending);
          if (exit === 'dashboard') {
            await workspaceLink(page, 'Dashboard').click();
            await expect(page).toHaveURL(baseURL + '/app/account/dashboard');
          } else {
            await page.getByRole('button', { name: 'User', exact: true }).click();
            await page.getByRole('button', { name: 'Sign out', exact: true }).click();
            await expect(page).toHaveURL(baseURL + '/app');
          }
          await cancelled;
          await expect(heading(page)).toHaveCount(0);
          assert.equal(harness.apiCalls.filter(({ method }) => method === 'PUT').length, 0);
        } finally {
          release();
        }
        console.log(`${exit} aborted the pending recipient read before any import or Save.`);
      });
    }
  } finally {
    await instance?.close();
    await server.close();
  }
}

const mode = process.argv[2];
try {
  if (mode === 'db') await database();
  else if (mode === 'metadata') await metadata();
  else if (mode === 'browser') await browser();
  else throw new Error('Select db, metadata or browser.');
} catch (error) {
  if (mode === 'db')
    console.error('Guarded sharing probe failed.', error.name, error.kind ?? '', error.code ?? '');
  else console.error(error);
  process.exitCode = 1;
}
