import assert from 'node:assert/strict';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import process from 'node:process';
import { extname, join, resolve, sep } from 'node:path';
import { URL } from 'node:url';

import { chromium, expect } from '../../apps/web/node_modules/@playwright/test/index.mjs';
import {
  ACCOUNT_ID,
  SyntheticManagedHarness,
} from '../../apps/web/e2e/synthetic-managed-harness.ts';
import { CUSTOM_EDIT_DASHBOARD } from '../../apps/web/e2e/custom-menu-edit-fixture.ts';

const origin = 'http://127.0.0.1:4189';
const legacy = resolve(process.argv[2] ?? '');
const current = new URL('../../apps/web/dist/', import.meta.url).pathname;
const token = 's'.repeat(43);
const snapshot = {
  version: 1,
  name: 'Legacy worker share test',
  sections: [{ name: 'Warm up', exercises: [{ name: 'Suburi' }] }],
};
const types = new Map([
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.css', 'text/css'],
]);
let serving = legacy;
const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', origin).pathname;
  const document = request.headers['sec-fetch-mode'] === 'navigate';
  const asset = document
    ? /^\/(?:share|app\/shared)\/[A-Za-z0-9_-]{43}\/?$/u.test(path) && serving !== legacy
      ? 'shared-menu.html'
      : 'index.html'
    : path.slice(1);
  const file = resolve(serving, asset);
  if (!file.startsWith(resolve(serving) + sep)) {
    response.writeHead(404).end();
    return;
  }
  void readFile(file).then(
    (body) => {
      response.writeHead(200, {
        'content-type': types.get(extname(asset)) ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(body);
    },
    () => response.writeHead(404).end(),
  );
});
assert.notEqual(legacy, process.cwd(), 'Supply the pre-sharing Vite build directory.');
await readFile(join(legacy, 'sw.js'));
await new Promise((ready) => server.listen(4189, '127.0.0.1', ready));
const browser = await chromium.launch({
  args: ['--host-resolver-rules=MAP gc.zgo.at ~NOTFOUND,MAP javiermarro.goatcounter.com ~NOTFOUND'],
});
try {
  const page = await browser.newPage({ baseURL: origin });
  page.setDefaultTimeout(8_000);
  const harness = await SyntheticManagedHarness.install(page);
  const navigation = [];
  page.on('response', (response) => {
    if (response.request().isNavigationRequest()) {
      navigation.push({
        path: new URL(response.url()).pathname.replace(token, ':token'),
        worker: response.fromServiceWorker(),
      });
    }
  });
  for (const suffix of ['', '/recipient']) {
    await page.route(`**/api/shares/${token}${suffix}`, (route) =>
      route.fulfill({
        json: suffix ? { snapshot, isSender: false, accountWorkspaceId: ACCOUNT_ID } : { snapshot },
      }),
    );
  }
  await page.goto('/app');
  await page.evaluate(async () => {
    await globalThis.navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => globalThis.navigator.serviceWorker.controller !== null);
  const guest = JSON.stringify(CUSTOM_EDIT_DASHBOARD);
  await page.evaluate((value) => globalThis.localStorage.setItem('kendo-menu', value), guest);
  serving = current;
  const oldLink = await page.goto(`/app/shared/${token}`);
  assert.equal(oldLink?.fromServiceWorker(), true);
  await expect(
    page.getByRole('heading', { name: 'That route is not part of KendoMenu.' }),
  ).toBeVisible();
  const newLink = await page.goto(`/share/${token}`);
  assert.equal(newLink?.fromServiceWorker(), false);
  await expect(page.getByRole('heading', { name: snapshot.name, exact: true })).toBeVisible();
  const notice = page.getByRole('complementary', { name: 'Cookie notice' });
  if (await notice.isVisible()) await notice.getByRole('button', { name: 'Got it' }).click();
  await page.getByRole('button', { name: 'Sign in to add', exact: true }).click();
  try {
    await expect(page.getByRole('button', { name: 'Add to my dashboard' })).toBeEnabled();
  } finally {
    console.log(navigation);
  }
  await page.getByRole('button', { name: 'Add to my dashboard' }).click();
  await expect(
    page.getByText('Added to your dashboard. Save to account to keep this menu.'),
  ).toBeVisible();
  assert.equal(
    harness.apiCalls.some(({ method }) => method === 'PUT'),
    false,
  );
  await page.getByRole('link', { name: 'View dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Save to account', exact: true }).click();
  await expect(page.getByText('Saved to account', { exact: true }).first()).toBeVisible();
  const saves = harness.apiCalls.filter(({ method }) => method === 'PUT');
  assert.equal(saves.length, 1);
  const saved = JSON.parse(saves[0]?.body ?? 'null');
  assert.equal(saved.dashboard.version, 11);
  assert.equal(saved.dashboard.state.dashboardEntries[0].receivedViaShare, true);
  assert.equal(await page.evaluate(() => globalThis.localStorage.getItem('kendo-menu')), guest);
  const update = page.getByRole('region', { name: 'Update available' });
  await expect(update).toBeVisible();
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    update.getByRole('button', { name: 'Update', exact: true }).click(),
  ]);
  await page.goto(`/app/shared/${token}`);
  await expect(page.getByRole('heading', { name: snapshot.name, exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => globalThis.localStorage.getItem('kendo-menu')), guest);
  console.log(
    'New link, sign-in, Add and v11 Save worked with the pre-sharing worker. The old link worked after Update. Guest bytes stayed intact.',
  );
} finally {
  await browser.close();
  await new Promise((closed) => server.close(closed));
}
