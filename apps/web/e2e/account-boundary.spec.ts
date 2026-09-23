import { expect, test } from '@playwright/test';

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
      guestPreserved: true,
      coordination: 'available',
      calls: ['GET', 'GET'],
    }),
  );
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
