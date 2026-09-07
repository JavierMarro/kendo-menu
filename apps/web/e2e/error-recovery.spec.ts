import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('render fallback supports keyboard recovery, diagnostics failure, and reload without storage', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('private clipboard error')) },
    });
  });
  await page.goto('/e2e/error-fixture.html');
  await page.getByRole('button', { name: 'Continue without saving' }).click();
  await page.getByRole('button', { name: 'Throw render error' }).click();
  const heading = page.getByRole('heading', { name: 'KendoMenu couldn’t continue.' });
  await expect(heading).toBeFocused();
  await expect(page.getByText('Private notes', { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('error-recovery.png'), fullPage: true });
  await page.getByRole('button', { name: 'Copy diagnostics' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Diagnostics could not be copied. You can try again.',
  );
  await page.getByRole('button', { name: 'Open data recovery' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'KendoMenu cannot access local data.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue without saving' }).click();
  await page.getByRole('button', { name: 'Throw render error' }).click();
  await page.getByRole('button', { name: 'Reload KendoMenu' }).click();
  await expect(
    page.getByRole('heading', { name: 'KendoMenu cannot access local data.' }),
  ).toBeVisible();
});

test('copies the exact safe diagnostics without exposing the thrown values', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          document.documentElement.dataset['copiedDiagnostics'] = text;
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto('/e2e/error-fixture.html?share=secret#token');
  await page.getByRole('button', { name: 'Throw render error' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-copied-diagnostics');
  await page.getByRole('button', { name: 'Copy diagnostics' }).click();
  await expect(page.locator('html')).toHaveAttribute(
    'data-copied-diagnostics',
    '{"errorCode":"KENDOMENU_UNEXPECTED_UI_ERROR","recoveryAvailable":true}',
  );
  await expect(page.getByRole('status')).toHaveText('Diagnostics copied.');
});
