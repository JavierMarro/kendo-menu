// Pass 4 uses synthetic browser transport and the guarded local DB harness in separate modes.
import assert from 'node:assert/strict';

const date = '2026-10-07T10:00:00.000Z';
const cap = 2_097_152;
const guestKey = 'kendo-menu';
const bodyBytes = (value) => Buffer.byteLength(JSON.stringify(value));
const requestId = '00000000-0000-4000-8000-000000000001';
const curatedEntry = {
  id: 'audit-guest-menu',
  trainingSetId: 'international-dojo-2-hour-session',
  quantityOverrides: {},
  activityNotes: {},
  notes: 'Synthetic guest practice note (稽古).',
  createdAt: date,
};
const guest = { version: 11, state: { dashboardEntries: [curatedEntry] } };
const guestRaw = JSON.stringify(guest);

async function browser() {
  const { chromium, expect } =
    await import('../../apps/web/node_modules/@playwright/test/index.mjs');
  const { createServer } = await import('../../apps/web/node_modules/vite/dist/node/index.js');
  const { SYNTHETIC_AUTH_URL, SyntheticManagedHarness } =
    await import('../../apps/web/e2e/synthetic-managed-harness.ts');
  const { workspaceLink } = await import('../../apps/web/e2e/workspace-test-helpers.ts');
  process.env.VITE_NEON_AUTH_URL = SYNTHETIC_AUTH_URL;
  const baseURL = 'http://127.0.0.1:4184';
  const server = await createServer({
    root: new URL('../../apps/web', import.meta.url).pathname,
    server: { host: '127.0.0.1', port: 4184, strictPort: true },
  });
  let chromiumBrowser;
  const offer = 'Copy your guest menus to your account?';
  const copy = (page) => page.getByRole('button', { name: 'Copy menus', exact: true });
  const decline = (page) => page.getByRole('button', { name: 'No, thanks', exact: true });
  const adoptionCount = (harness) =>
    harness.apiCalls.filter((call) => call.path === '/api/dashboard/adoption').length;
  async function setup(run, raw = guestRaw, shouldOffer = true) {
    const context = await chromiumBrowser.newContext({ baseURL });
    try {
      await context.route('https://javiermarro.goatcounter.com/**', (route) => route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const harness = await SyntheticManagedHarness.install(page, {
        initiallySignedIn: true,
        initiallyUninitialized: true,
      });
      await page.addInitScript(
        ({ key, value }) => {
          if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
        },
        { key: guestKey, value: raw },
      );
      await page.goto('/app/account/dashboard');
      if (shouldOffer) await expect(page.getByRole('heading', { name: offer })).toBeVisible();
      else {
        await expect(page.getByRole('heading', { name: 'Your dashboard is ready.' })).toBeVisible();
        await expect(page.getByRole('heading', { name: offer })).toHaveCount(0);
      }
      const notice = page.getByRole('complementary', { name: 'Cookie notice' });
      if (await notice.isVisible()) await notice.getByRole('button', { name: 'Got it' }).click();
      await run(page, harness);
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), guestKey), raw);
    } finally {
      await context.close();
    }
  }

  try {
    await server.listen();
    chromiumBrowser = await chromium.launch();
    const oversize = largeDashboard();
    for (const exercise of oversize.state.dashboardEntries[1].trainingSet.sections[0].exercises)
      exercise.notes = '稽'.repeat(8_000);
    const oversizeRaw = JSON.stringify(oversize);
    assert.ok(oversizeRaw.length < cap && Buffer.byteLength(oversizeRaw) > cap);
    for (const raw of ['{broken', oversizeRaw]) {
      await setup((_page, harness) => assert.equal(adoptionCount(harness), 0), raw, false);
    }
    console.log(
      'Corrupt and valid but UTF-8-oversized guest snapshots skipped setup without POST or source changes.',
    );
    const legacyRaw = JSON.stringify({
      version: 9,
      state: { dashboardEntries: [curatedEntry], customTrainingSets: [] },
    });
    await setup(async (page, harness) => {
      await copy(page).click();
      await expect(page.getByRole('heading', { name: 'Guest menus copied' })).toBeVisible();
      const calls = harness.apiCalls.filter((call) => call.path === '/api/dashboard/adoption');
      assert.equal(calls.length, 1);
      assert.deepEqual(JSON.parse(calls[0].body).dashboard, guest);
      console.log('v9 guest snapshot produced the same v11 dashboard without writing guest bytes.');
    }, legacyRaw);
    for (const decision of ['yes', 'no', 'lost']) {
      await setup(async (page, harness) => {
        const before = harness.apiCalls.length;
        const beforeTokens = harness.authCalls.length;
        const held = decision === 'lost' ? harness.holdNextAdoption() : null;
        await (decision === 'no' ? decline(page) : copy(page)).click();
        if (held !== null) {
          await held.observed;
          held.respond({ status: 0, body: null });
        }
        const outcome = {
          yes: 'Guest menus copied',
          no: 'Choice confirmed',
          lost: 'Choice not confirmed',
        };
        await expect(page.getByRole('heading', { name: outcome[decision] })).toBeVisible();
        assert.equal(adoptionCount(harness), 1);
        console.log(
          decision,
          JSON.stringify({
            calls: harness.apiCalls
              .slice(before)
              .map(({ method, path, body }) => [method, path, Buffer.byteLength(body ?? '')]),
            issuerCalls: harness.authCalls.length - beforeTokens,
          }),
        );
        await page.getByRole('button', { name: 'Continue to account' }).click();
        if (decision === 'no')
          await expect(
            page.getByRole('heading', { name: 'Your dashboard is ready.' }),
          ).toBeVisible();
        else
          await expect(
            page.getByRole('heading', { name: 'International dojo menu' }),
          ).toBeVisible();
      });
    }
    await setup(async (page, harness) => {
      harness.setDashboardUnavailable(true);
      await copy(page).click();
      await expect(
        page.getByRole('heading', { name: 'Your dashboard could not be loaded.' }),
      ).toBeVisible();
      await expect(
        page.getByText('The account service is unavailable. Your account was not changed.'),
      ).toBeVisible();
      assert.equal(adoptionCount(harness), 1);
      harness.setDashboardUnavailable(false);
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'International dojo menu' })).toBeVisible();
      assert.equal(adoptionCount(harness), 1);
      console.log(
        'KM-04-001 reproduced: failed refresh said account was unchanged after confirmed Yes; Retry revealed the copied dashboard.',
      );
    });
    for (const departure of ['pagehide', 'dashboard'])
      await setup(async (page, harness) => {
        let allowRead;
        const readGate = new Promise((resolve) => {
          allowRead = resolve;
        });
        let observeRead;
        const readSeen = new Promise((resolve) => {
          observeRead = resolve;
        });
        let held = false;
        await page.route('**/api/account', async (route) => {
          if (!held && route.request().method() === 'GET') {
            held = true;
            observeRead();
            await readGate;
          }
          await route.fallback();
        });
        await copy(page).click();
        await Promise.race([
          readSeen,
          new Promise((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error('Choice preflight was not observed.')),
              5_000,
            );
            timer.unref();
          }),
        ]);
        assert.equal(adoptionCount(harness), 0);
        if (departure === 'pagehide') {
          await page.evaluate(() =>
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
          );
        } else {
          await workspaceLink(page, 'Dashboard').click();
          await expect(page).toHaveURL(baseURL + '/app/account/dashboard');
        }
        assert.equal(adoptionCount(harness), 0);
        allowRead();
        await expect.poll(() => adoptionCount(harness)).toBe(1);
        const heading = departure === 'pagehide' ? 'Guest menus copied' : 'International dojo menu';
        await expect(page.getByRole('heading', { name: heading })).toBeVisible();
        console.log(
          `KM-04-002 reproduced after ${departure}: leaving setup released the handoff before POST, but the held identity preflight later dispatched Yes.`,
        );
      });
  } finally {
    await chromiumBrowser?.close();
    await server.close();
  }
}

function largeDashboard() {
  const sections = Array.from({ length: 3 }, (_, group) => ({
    id: `group-${group}`,
    name: `Group ${group}`,
    exercises: Array.from({ length: 88 }, (_, exercise) => ({
      id: `exercise-${group}-${exercise}`,
      name: `Exercise ${exercise}`,
      notes: '',
    })),
  }));
  return {
    version: 11,
    state: {
      dashboardEntries: [
        structuredClone(curatedEntry),
        {
          ...curatedEntry,
          id: 'audit-large',
          trainingSetId: 'audit-custom',
          trainingSet: {
            id: 'audit-custom',
            name: 'Audit menu',
            category: 'custom',
            isBuiltIn: false,
            sections,
          },
        },
      ],
    },
  };
}

async function database() {
  const { createTestDatabase } = await import('../../apps/api/src/database/test-database.ts');
  const { createApp } = await import('../../apps/api/src/app.ts');
  const { createDashboard } = await import('../../apps/api/src/dashboard/dashboard.ts');
  const { createAdoption } = await import('../../apps/api/src/adoption/adoption.ts');
  const { createAccount } = await import('../../apps/api/src/account/account.ts');
  const { createAccountAuthorization } =
    await import('../../apps/api/src/auth/account-authorization.ts');
  const { createDashboardCatalogue } = await import('../../apps/api/src/dashboard/validation.ts');
  const { createAccountApiClient, serializeAdoptionRequest } =
    await import('../../apps/web/src/lib/account-api.ts');
  const db = await createTestDatabase({ clock: () => new Date(date) });
  try {
    const origin = 'http://127.0.0.1:4173';
    const catalogue = createDashboardCatalogue();
    for (const mode of ['yes', 'no', 'near']) {
      const identity = {
        provider: 'neon',
        issuer: 'https://synthetic-issuer.example.test',
        subject: `audit-copy-${mode}`,
        verifiedEmail: 'audit@example.test',
        expiresAt: Date.parse(date) / 1_000 + 3_600,
      };
      const authorization = createAccountAuthorization({
        verify: async (token) =>
          token === 'synthetic-audit-token'
            ? { status: 'verified', identity }
            : { status: 'invalid' },
        lookup: db.persistence.managedAccounts,
        now: () => Date.parse(date) / 1_000,
        getAppOrigin: () => origin,
      });
      const account = createAccount({ authorization, persistence: db.persistence.managedAccounts });
      const dashboard = createDashboard({ authorization, persistence: db.persistence.dashboards });
      const adoption = createAdoption({ authorization, persistence: db.persistence.managedCopy });
      const unused = { handle: async () => new Response(null, { status: 501 }) };
      const app = createApp({ account, dashboard, adoption, shares: unused });
      const log = [];
      const request = async (path, init) => {
        const headers = new Headers(init.headers);
        if (init.method === 'POST') headers.set('origin', origin);
        const response = await app.handle(new Request(new URL(path, origin), { ...init, headers }));
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        log.push([
          init.method,
          path,
          response.status,
          Buffer.byteLength(init.body ?? ''),
          Buffer.byteLength(await response.clone().text()),
        ]);
        return response;
      };
      const api = createAccountApiClient({
        origin,
        getToken: async () => ({ status: 'token', token: 'synthetic-audit-token' }),
        fetch: request,
      });
      const initialized = await api.initializeAccount();
      const accountId = initialized.accountId;
      assert.ok(initialized.copyOpportunityId);
      const base = {
        transportVersion: 1,
        decision: mode === 'no' ? 'no' : 'yes',
        expectedAccountWorkspaceId: accountId,
        copyOpportunityId: initialized.copyOpportunityId,
        requestId,
      };
      const submitted =
        mode === 'no'
          ? base
          : {
              ...base,
              expectedRevision: '0',
              catalogueVersion: catalogue.version,
              dashboard: mode === 'near' ? largeDashboard() : guest,
            };
      if (mode === 'near') {
        const entries = submitted.dashboard.state.dashboardEntries;
        let space = cap - bodyBytes(submitted);
        for (const section of entries[1].trainingSet.sections) {
          for (const exercise of section.exercises) {
            const count = Math.min(8_000, Math.floor(space / 3));
            exercise.notes = '稽'.repeat(count);
            space -= count * 3;
          }
        }
        entries[0].notes += 'x'.repeat(space);
        assert.equal(Buffer.byteLength(serializeAdoptionRequest(accountId, submitted)), cap);
        const oversize = structuredClone(submitted);
        oversize.dashboard.state.dashboardEntries[0].notes += 'x';
        assert.throws(
          () => serializeAdoptionRequest(accountId, oversize),
          (error) => error.kind === 'oversized',
        );
        const response = await request('/api/dashboard/adoption', {
          method: 'POST',
          headers: {
            authorization: 'Bearer synthetic-audit-token',
            'content-type': 'application/json',
          },
          body: JSON.stringify(oversize),
        });
        assert.equal(response.status, 413);
      }
      const result = await api.postAdoption(accountId, submitted);
      assert.equal(result.status, mode === 'no' ? 'declined' : 'accepted');
      await api.getAccount();
      const refreshed = await api.getDashboard(accountId);
      assert.equal(refreshed.revision, mode === 'no' ? '0' : '1');
      assert.deepEqual(refreshed.dashboard, mode === 'no' ? null : submitted.dashboard);
      await assert.rejects(
        () =>
          api.postAdoption(
            accountId,
            base.decision === 'no'
              ? base
              : {
                  ...base,
                  decision: 'no',
                },
          ),
        (error) => error.code === 'COPY_OPPORTUNITY_UNAVAILABLE',
      );
      const row = await db.client.query(
        `SELECT o.outcome, (SELECT count(*)::int FROM dashboard_write_receipts r WHERE r.user_id = o.user_id) AS receipts
         FROM account_copy_opportunities o WHERE o.user_id = $1`,
        [accountId],
      );
      assert.deepEqual(row.rows, [
        { outcome: mode === 'no' ? 'declined' : 'accepted', receipts: 0 },
      ]);
      console.log(mode, JSON.stringify(log));
    }
  } finally {
    await db.close();
  }
}

try {
  if (process.argv[2] === 'db') await database();
  else if (process.argv[2] === 'browser') await browser();
  else throw new Error('Select db or browser.');
} catch (error) {
  if (process.argv[2] === 'db')
    console.error('Guarded copy probe failed.', error.name, error.kind ?? '', error.code ?? '');
  else console.error(error);
  process.exitCode = 1;
}
