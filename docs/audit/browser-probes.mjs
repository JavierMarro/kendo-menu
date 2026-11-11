import assert from 'node:assert/strict';
import console from 'node:console';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { setTimeout } from 'node:timers/promises';
import { URL } from 'node:url';

import { chromium, expect } from '../../apps/web/node_modules/@playwright/test/index.mjs';
import { preview } from '../../apps/web/node_modules/vite/dist/node/index.js';
import {
  ACCOUNT_ID,
  SyntheticManagedHarness,
} from '../../apps/web/e2e/synthetic-managed-harness.ts';
import {
  CUSTOM_EDIT_DASHBOARD,
  CUSTOM_EDIT_NAME,
} from '../../apps/web/e2e/custom-menu-edit-fixture.ts';
import { workspaceLink } from '../../apps/web/e2e/workspace-test-helpers.ts';

const baseURL = 'http://127.0.0.1:4187';
const fakeShare = 's'.repeat(43);
const snapshot = {
  version: 1,
  name: 'Audit preview',
  sections: [{ name: 'Warm-up', exercises: [] }],
};
const updateRegion = (page) => page.getByRole('region', { name: 'Update available' });
const sessionName = (page) => page.getByLabel('Session name');
const heading = (page, name) => page.getByRole('heading', { name, exact: true });
let updatedWorker = false;

async function inContext(browser, serviceWorkers, run) {
  const context = await browser.newContext({ baseURL, serviceWorkers });
  try {
    await context.route('**/*', (route) =>
      route
        .request()
        .url()
        .startsWith(baseURL + '/')
        ? route.fallback()
        : route.abort(),
    );
    await run(context);
  } finally {
    await context.close();
  }
}

async function open(context, signedIn) {
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: signedIn });
  return { page, harness };
}

async function dismissNotice(page) {
  const notice = page.getByRole('complementary', { name: 'Cookie notice' });
  if (await notice.isVisible()) await notice.getByRole('button', { name: 'Got it' }).click();
}

async function navigation(browser) {
  for (const workspace of ['guest', 'account']) {
    await inContext(browser, 'block', async (context) => {
      const { page } = await open(context, workspace === 'account');
      const canonical = `/app/${workspace}/drills/new`;
      const dialogs = [];
      page.on('dialog', (dialog) => {
        dialogs.push(dialog.type());
        void dialog.dismiss();
      });
      await page.goto(canonical);
      await dismissNotice(page);
      await sessionName(page).fill('Canonical unsaved draft');
      await workspaceLink(page, 'Dashboard').click();
      await expect(page).toHaveURL(baseURL + canonical);
      await expect(sessionName(page)).toHaveValue('Canonical unsaved draft');
      assert.deepEqual(dialogs, ['confirm']);
      const { page: variant } = await open(context, workspace === 'account');
      const variantDialogs = [];
      variant.on('dialog', (dialog) => {
        variantDialogs.push(dialog.type());
        void dialog.dismiss();
      });
      await variant.goto(canonical + '/');
      await sessionName(variant).fill('Trailing slash unsaved draft');
      await workspaceLink(variant, 'Dashboard').click();
      await expect(heading(variant, 'Your dashboard')).toBeVisible();
      assert.deepEqual(variantDialogs, []);
      await variant.goBack();
      await expect(variant).toHaveURL(baseURL + canonical + '/');
      await expect(sessionName(variant)).toHaveValue('');
      console.log(
        `${workspace}: canonical leave was blocked, trailing-slash leave lost the draft without a prompt.`,
      );
    });
  }
  await inContext(browser, 'block', async (context) => {
    const { page } = await open(context, true);
    await page.goto('/app/guest/library');
    await expect(heading(page, 'Keiko library')).toBeVisible();
    await expect(page).toHaveURL(baseURL + '/app/account/library');
    await page.goto('/app/guest/library/');
    await expect(heading(page, 'Your dashboard')).toBeVisible();
    await expect(page).toHaveURL(baseURL + '/app/account/dashboard');
    console.log(
      'Verified entry preserved the canonical guest library destination but redirected its trailing-slash variant to Dashboard.',
    );
  });
}

async function clipboard(browser) {
  await inContext(browser, 'block', async (context) => {
    const { page, harness } = await open(context, true);
    harness.setDashboard(CUSTOM_EDIT_DASHBOARD, '1');
    await page.addInitScript(() => {
      const browser = globalThis.navigator;
      const actions = { copies: [], shares: [] };
      globalThis.auditShareActions = actions;
      Object.defineProperty(browser, 'clipboard', {
        value: {
          writeText(value) {
            actions.copies.push(value);
            return actions.copies.length === 1
              ? Promise.reject(new globalThis.DOMException('Denied', 'NotAllowedError'))
              : Promise.resolve();
          },
        },
      });
      Object.defineProperty(browser, 'share', {
        value(value) {
          actions.shares.push(value);
          return Promise.reject(new globalThis.DOMException('Cancelled', 'AbortError'));
        },
      });
    });
    let creates = 0;
    await page.route('**/api/shares', (route) => {
      creates += 1;
      return route.fulfill({
        json: { token: fakeShare, sourceRevision: '1', accountWorkspaceId: ACCOUNT_ID },
      });
    });
    await page.goto('/app/account/dashboard');
    await dismissNotice(page);
    const trigger = page.getByRole('button', { name: 'Share it!' });
    await trigger.press('Enter');
    await page.getByRole('button', { name: 'Create sharing link' }).press('Enter');
    const link = page.getByRole('textbox', { name: 'Sharing link' });
    const expected = baseURL + '/app/shared/' + fakeShare;
    await expect(link).toHaveValue(expected);
    await expect(link).toBeFocused();
    assert.deepEqual(await page.evaluate(() => globalThis.auditShareActions), {
      copies: [],
      shares: [],
    });
    const copy = page.getByRole('button', { name: 'Copy link' });
    await copy.press('Enter');
    await expect(page.getByText(/copy it manually/i)).toBeVisible();
    await copy.press('Enter');
    await expect(page.getByText('Link copied.')).toBeVisible();
    await page.getByRole('button', { name: 'Share link…' }).press('Enter');
    await expect(page.getByText(/sharing was cancelled or unavailable/i)).toBeVisible();
    assert.deepEqual(await page.evaluate(() => globalThis.auditShareActions), {
      copies: [expected, expected],
      shares: [{ url: expected, text: 'Check my custom menu out!' }],
    });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    assert.equal(creates, 1);
    console.log(
      'Keyboard create/copy/share, clipboard denial and Web Share cancellation exercised with injected browser APIs.',
    );
  });
}

async function control(page) {
  await page.waitForFunction(() => globalThis.navigator.serviceWorker.ready.then(() => true));
  if (!(await page.evaluate(() => Boolean(globalThis.navigator.serviceWorker.controller))))
    await page.reload();
  await page.waitForFunction(() => globalThis.navigator.serviceWorker.controller !== null);
}

async function cacheBoundary(browser) {
  await inContext(browser, 'allow', async (context) => {
    const { page, harness } = await open(context, false);
    harness.setDashboard(CUSTOM_EDIT_DASHBOARD, '1');
    await context.setOffline(true);
    await assert.rejects(() => page.goto('/app/guest/dashboard'));
    await context.setOffline(false);
    await page.goto('/app/sign-in');
    await control(page);
    await dismissNotice(page);
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await expect(heading(page, 'Your dashboard')).toBeVisible();
    await expect(heading(page, CUSTOM_EDIT_NAME)).toBeVisible();
    await page.route(`**/api/shares/${fakeShare}`, (route) =>
      route.fulfill({ headers: { 'cache-control': 'private, no-store' }, json: { snapshot } }),
    );
    await page.route(`**/api/shares/${fakeShare}/recipient`, (route) =>
      route.fulfill({
        headers: { 'cache-control': 'private, no-store' },
        json: { snapshot, isSender: false, accountWorkspaceId: ACCOUNT_ID },
      }),
    );
    await page.goto(`/app/shared/${fakeShare}`);
    await expect(heading(page, snapshot.name)).toBeVisible();
    await page.getByRole('link', { name: 'Continue to add this menu' }).click();
    await expect(page.getByRole('button', { name: 'Add to my dashboard' })).toBeEnabled();
    const cache = await page.evaluate(async () => {
      let entries = 0;
      const invalid = [];
      for (const name of await globalThis.caches.keys()) {
        const cache = await globalThis.caches.open(name);
        for (const request of await cache.keys()) {
          const url = new globalThis.URL(request.url);
          entries += 1;
          if (
            /^\/(?:api\/|app\/(?:auth|account|shared)(?:\/|$))/u.test(url.pathname) ||
            url.pathname === '/shared-menu.html' ||
            url.searchParams.has('neon_auth_session_verifier')
          )
            invalid.push(url.pathname.split('/').slice(0, 3).join('/'));
        }
      }
      return { entries, invalid };
    });
    assert.ok(cache.entries > 0);
    assert.deepEqual(cache.invalid, []);
    await page.unrouteAll({ behavior: 'wait' });
    await context.setOffline(true);
    await page.goto('/app/account/dashboard');
    await expect(heading(page, 'Your account could not be verified.')).toBeVisible();
    await expect(heading(page, CUSTOM_EDIT_NAME)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save to account', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Continue as a guest' }).click();
    await expect(heading(page, 'Your dashboard')).toBeVisible();
    await context.setOffline(false);
    console.log(
      'Cold offline failed, controlled offline account hid data and offered guest navigation.',
      cache,
    );
  });
}

async function workerUpdate(browser) {
  for (const mode of ['same tab', 'other tab']) {
    updatedWorker = false;
    await inContext(browser, 'allow', async (context) => {
      const { page } = await open(context, true);
      await page.goto('/app/account/drills/new');
      await control(page);
      await dismissNotice(page);
      await sessionName(page).click();
      await sessionName(page).fill('Unsaved update probe');
      const initiator = mode === 'same tab' ? page : (await open(context, true)).page;
      if (initiator !== page) {
        await initiator.goto('/app/account/dashboard');
        await control(initiator);
        await dismissNotice(initiator);
      }
      updatedWorker = true;
      await initiator.evaluate(async () =>
        (await globalThis.navigator.serviceWorker.ready).update(),
      );
      await expect(updateRegion(page)).toBeVisible({ timeout: 10_000 });
      await expect(updateRegion(initiator)).toBeVisible({ timeout: 10_000 });
      if (initiator !== page)
        await updateRegion(page).getByRole('button', { name: 'Later' }).click();
      let unloadDialogs = 0;
      let reloads = 0;
      page.on('dialog', (dialog) => {
        if (dialog.type() === 'beforeunload') unloadDialogs += 1;
        void dialog.dismiss();
      });
      page.on('domcontentloaded', () => {
        reloads += 1;
      });
      await updateRegion(initiator).getByRole('button', { name: 'Update', exact: true }).click();
      await page.waitForFunction(
        async () => (await globalThis.navigator.serviceWorker.ready).waiting === null,
      );
      await setTimeout(1500);
      const remainingDraft = await sessionName(page).inputValue();
      const noticeVisible = await updateRegion(page).isVisible();
      console.log('Update after a dirty builder', {
        mode,
        unloadDialogs,
        reloads,
        draftRetained: remainingDraft === 'Unsaved update probe',
        noticeVisible,
      });
      if (initiator === page && noticeVisible && unloadDialogs > 0) {
        const before = { unloadDialogs, reloads };
        await updateRegion(page).getByRole('button', { name: 'Update', exact: true }).click();
        await setTimeout(1200);
        console.log('Second Update after native cancellation', {
          unloadDialogs: unloadDialogs - before.unloadDialogs,
          reloads: reloads - before.reloads,
          noticeVisible: await updateRegion(page).isVisible(),
        });
      }
    });
  }
}

const mode = process.argv[2];
const worker = await readFile(new URL('../../apps/web/dist/sw.js', import.meta.url), 'utf8');
const server = await preview({
  root: new URL('../../apps/web', import.meta.url).pathname,
  preview: { host: '127.0.0.1', port: 4187, strictPort: true },
  plugins: [
    {
      name: 'audit-local-worker-update',
      configurePreviewServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url !== '/sw.js' || !updatedWorker) return next();
          response.setHeader('content-type', 'text/javascript');
          response.setHeader('cache-control', 'no-store');
          response.end(worker + '\n// Synthetic local audit update\n');
        });
      },
    },
  ],
});
const browser = await chromium.launch();
try {
  if (mode === 'routes') {
    await navigation(browser);
    await clipboard(browser);
  } else if (mode === 'pwa') {
    await cacheBoundary(browser);
    await workerUpdate(browser);
  } else {
    throw new Error('Select routes or pwa.');
  }
} finally {
  await browser.close();
  const closed = once(server.httpServer, 'close');
  server.httpServer.close();
  await closed;
}
