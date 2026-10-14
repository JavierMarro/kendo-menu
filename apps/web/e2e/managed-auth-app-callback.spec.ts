import { expect, test } from '@playwright/test';

const AUTH_ORIGIN = 'https://synthetic-auth.example.invalid';

test('an unmarked root verifier fails closed with a clean URL and no ordinary account requests', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(AUTH_ORIGIN) || /\/api\/(account|dashboard)/u.test(request.url()))
      requests.push(request.url());
  });
  await page.goto('/?neon_auth_session_verifier=synthetic-unmarked-verifier');
  await expect(page.getByRole('heading', { name: 'Sign-in could not be completed' })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/auth\/callback$/);
  await expect(page.getByRole('button', { name: 'Retry sign-in' })).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('an explicit application cancellation is sanitized and cleans provider error parameters', async ({
  page,
}) => {
  await page.goto(
    '/app/auth/callback?error=access_denied&error_description=synthetic-private-error',
  );
  await expect(page.getByRole('heading', { name: 'Sign-in could not be completed' })).toBeVisible();
  await expect(page.getByText('synthetic-private-error')).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/auth\/callback$/);
});

for (const callback of ['root', 'explicit'] as const) {
  for (const result of ['success', 'failure'] as const) {
    test(`application ${callback} callback ${result} stays isolated until session bootstrap`, async ({
      page,
    }) => {
      let bootstraps = 0;
      let tokenRequests = 0;
      let proofRequests = 0;
      let accountRequests = 0;
      await page.route(`${AUTH_ORIGIN}/**`, async (route) => {
        if (route.request().url().includes('/get-session')) {
          bootstraps++;
          await route.fulfill(
            result === 'success'
              ? {
                  json: {
                    session: { token: 'synthetic-session-credential' },
                    user: { id: 'synthetic-account' },
                  },
                  headers: {
                    'set-cookie':
                      'synthetic-managed-session=session; Path=/neon/auth; HttpOnly; Secure; SameSite=None',
                  },
                }
              : { status: 503, json: { message: 'synthetic-private-provider-error' } },
          );
        } else {
          tokenRequests++;
          await route.fulfill({ json: { token: 'synthetic-browser-token' } });
        }
      });
      await page.route('**/api/dev/managed-identity', async (route) => {
        proofRequests++;
        await route.fulfill({ status: 503, json: {} });
      });
      await page.route(/\/api\/(?:account|dashboard)(?:\?.*)?$/, async (route) => {
        accountRequests++;
        await route.fulfill({ status: 503, json: {} });
      });

      if (callback === 'root') {
        await page.addInitScript(() => {
          if (window.location.pathname === '/') {
            sessionStorage.setItem(
              'kendomenu:auth-return-v1',
              JSON.stringify({ version: 1, flow: 'application', expiresAt: Date.now() + 60_000 }),
            );
          }
        });
      }

      if (result === 'success') {
        await page.route('**/app/account/dashboard', async (route) => {
          await route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html><body>account destination</body></html>',
          });
        });
      }

      const path =
        callback === 'root'
          ? '/?neon_auth_session_verifier=synthetic-verifier'
          : '/app/auth/callback?neon_auth_session_verifier=synthetic-verifier';
      await page.goto(path);

      if (result === 'failure') {
        await expect(page.getByRole('status')).toContainText('could not be verified');
        await expect(page.getByText('synthetic-private-provider-error')).toHaveCount(0);
        if (callback === 'root') await expect(page).toHaveURL(/\/app\/auth\/callback\?/);
        const retry = page.getByRole('button', { name: 'Retry sign-in' });
        await expect(retry).toBeVisible();
        await retry.click();
        await expect.poll(() => bootstraps).toBe(2);
        expect(tokenRequests).toBe(0);
      } else {
        await expect(page).toHaveURL(/\/app\/account\/dashboard$/);
        await expect(page.getByText('account destination')).toBeVisible();
        expect(bootstraps).toBe(1);
        expect(
          await page.evaluate(() => sessionStorage.getItem('kendomenu:auth-return-v1')),
        ).toBeNull();
      }
      expect(proofRequests).toBe(0);
      expect(accountRequests).toBe(0);
    });
  }
}
