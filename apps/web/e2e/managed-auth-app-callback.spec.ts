import { expect, test } from '@playwright/test';

const AUTH_ORIGIN = 'https://synthetic-auth.example.invalid';

test('framed sign-in stops before initiating the SDK popup flow', async ({ page }) => {
  let signInRequests = 0;
  await page.route(`${AUTH_ORIGIN}/**`, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/sign-in/social')) signInRequests += 1;
    await route.fulfill({ status: 401, json: { message: 'synthetic signed-out session' } });
  });
  await page.route('**/synthetic-auth-frame', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><iframe title="Embedded KendoMenu" src="/app/sign-in"></iframe>',
    }),
  );
  await page.goto('/synthetic-auth-frame');

  const embedded = page.frameLocator('iframe');
  await embedded.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(embedded.getByRole('alert')).toContainText('Google sign-in could not be started');
  expect(signInRequests).toBe(0);
});

test('an ordinary verifier never reaches token calls, including after same-document navigation', async ({
  page,
}) => {
  const tokenUrls: string[] = [];
  await page.route(`${AUTH_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/token')) tokenUrls.push(url.href);
    await route.fulfill({ status: 401, json: { message: 'synthetic private provider error' } });
  });

  await page.goto(
    '/app/guest/dashboard?campaign=summer%20camp&neon_auth_session_verifier=synthetic-ordinary#dashboard',
  );
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  await expect.poll(() => tokenUrls.length).toBeGreaterThan(0);
  const firstRequestCount = tokenUrls.length;
  expect(
    tokenUrls.every((value) => !new URL(value).searchParams.has('neon_auth_session_verifier')),
  ).toBe(true);
  expect(new URL(page.url()).searchParams.get('campaign')).toBe('summer camp');
  expect(new URL(page.url()).hash).toBe('#dashboard');
  expect(new URL(page.url()).searchParams.has('neon_auth_session_verifier')).toBe(false);

  await page.evaluate(() => {
    window.history.pushState(
      window.history.state,
      '',
      '/app/guest/dashboard?campaign=summer%20camp#dashboard',
    );
    window.dispatchEvent(new Event('focus'));
    window.history.pushState(
      window.history.state,
      '',
      '/app/guest/dashboard?campaign=summer%20camp&neon_auth_session_verifier=synthetic-late#dashboard',
    );
  });
  await expect.poll(() => tokenUrls.length).toBeGreaterThan(firstRequestCount);
  expect(
    tokenUrls.every((value) => !new URL(value).searchParams.has('neon_auth_session_verifier')),
  ).toBe(true);

  const requestCountAfterLateInjection = tokenUrls.length;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => tokenUrls.length).toBeGreaterThan(requestCountAfterLateInjection);
  expect(
    tokenUrls.every((value) => !new URL(value).searchParams.has('neon_auth_session_verifier')),
  ).toBe(true);
  expect(new URL(page.url()).searchParams.has('neon_auth_session_verifier')).toBe(false);
});

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
  await page.addInitScript(() => {
    if (window.location.search.includes('error=access_denied'))
      sessionStorage.setItem(
        'kendomenu:share-return-v1',
        JSON.stringify({
          version: 1,
          token: 's'.repeat(43),
          expiresAt: Date.now() + 60_000,
        }),
      );
  });
  await page.goto(
    '/app/auth/callback?error=access_denied&error_description=synthetic-private-error',
  );
  await expect(page.getByRole('heading', { name: 'Sign-in could not be completed' })).toBeVisible();
  await expect(page.getByText('synthetic-private-error')).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/auth\/callback$/);
  expect(await page.evaluate(() => sessionStorage.getItem('kendomenu:share-return-v1'))).toBeNull();
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
