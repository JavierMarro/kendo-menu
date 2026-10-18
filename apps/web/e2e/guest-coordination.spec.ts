import { expect } from '@playwright/test';
import { test } from './guest-test';

test('ordinary guest persistence shares the guest Web Lock across tabs', async ({
  page,
  context,
}) => {
  const owner = await context.newPage();
  await owner.goto('/app/guest/dashboard');
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
  await page.goto('/app/guest/library?drill=junior-high-kendo-club');
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBeNull();
  await owner.evaluate(() => window.dispatchEvent(new Event('release-test-guest-lock')));
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kendo-menu'))).not.toBeNull();
  await expect(page.locator('.inline-confirmation')).toContainText('added to your dashboard.');
  await page.goto('/app/guest/dashboard');
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);
  await owner.close();
});
