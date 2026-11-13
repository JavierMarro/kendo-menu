import assert from 'node:assert/strict';
import console from 'node:console';
import { once } from 'node:events';
import { URL } from 'node:url';

import { chromium, expect } from '../../apps/web/node_modules/@playwright/test/index.mjs';
import { preview } from '../../apps/web/node_modules/vite/dist/node/index.js';
import { CUSTOM_EDIT_DASHBOARD } from '../../apps/web/e2e/custom-menu-edit-fixture.ts';
import {
  ACCOUNT_ID,
  SyntheticManagedHarness,
} from '../../apps/web/e2e/synthetic-managed-harness.ts';

const origin = 'http://127.0.0.1:4188';
const shareToken = 's'.repeat(43);
const recipientPath = `/app/account/shared/${shareToken}`;
const publicPath = `/app/shared/${shareToken}`;
const server = await preview({
  root: new URL('../../apps/web', import.meta.url).pathname,
  preview: { host: '127.0.0.1', port: 4188, strictPort: true },
});
const browser = await chromium.launch();
try {
  for (const newAccount of [false, true]) {
    for (const trailingSlash of [false, true]) {
      const context = await browser.newContext({ baseURL: origin, serviceWorkers: 'block' });
      try {
        await context.route('**/*', (route) =>
          route.request().url().startsWith(`${origin}/`) ? route.fallback() : route.abort(),
        );
        const page = await context.newPage();
        page.setDefaultTimeout(8_000);
        const harness = await SyntheticManagedHarness.install(page, {
          initiallySignedIn: newAccount,
          initiallyUninitialized: newAccount,
        });
        if (newAccount) {
          await page.addInitScript((value) => {
            globalThis.localStorage.setItem('kendo-menu', value);
          }, JSON.stringify(CUSTOM_EDIT_DASHBOARD));
        }
        await page.route(`**/api/shares/${shareToken}**`, (route) => {
          const snapshot = {
            version: 1,
            name: 'Synthetic audit menu',
            sections: [{ name: 'Warm up', exercises: [{ name: 'Suburi' }] }],
          };
          return route.fulfill({
            json: route.request().url().endsWith('/recipient')
              ? { snapshot, isSender: false, accountWorkspaceId: ACCOUNT_ID }
              : { snapshot },
          });
        });
        await page.goto(recipientPath + (trailingSlash ? '/' : ''));
        if (newAccount) {
          await expect(
            page.getByRole('heading', { name: 'Copy your guest menus to your account?' }),
          ).toBeVisible();
          const notice = page.getByRole('complementary', { name: 'Cookie notice' });
          if (await notice.isVisible())
            await notice.getByRole('button', { name: 'Got it' }).click();
          await page.getByRole('button', { name: 'No, thanks', exact: true }).click();
          await page.getByRole('button', { name: 'Continue to account', exact: true }).click();
        }
        const destinations = newAccount
          ? [recipientPath, '/app/account/dashboard']
          : [publicPath, '/app/sign-in'];
        if (newAccount) {
          await expect(
            page.getByRole('heading', {
              name: trailingSlash ? 'Your dashboard' : 'Synthetic audit menu',
              exact: true,
            }),
          ).toBeVisible();
        }
        await expect.poll(() => destinations.includes(new URL(page.url()).pathname)).toBe(true);
        const pathname = new URL(page.url()).pathname;
        assert.equal(pathname, destinations[trailingSlash ? 1 : 0]);
        assert.equal(harness.apiCalls.filter(({ method }) => method === 'PUT').length, 0);
        console.log({
          newAccount,
          trailingSlash,
          destination: pathname.replace(shareToken, ':token'),
        });
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  const closed = once(server.httpServer, 'close');
  server.httpServer.close();
  await closed;
}
