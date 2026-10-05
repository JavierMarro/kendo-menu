import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('callback-only bootstrap, cookie-backed token verification and sign-out preserve guest storage', async ({
  page,
}) => {
  let signedOut = false;
  let tokens = 0;
  let bootstraps = 0;
  await page.route('https://synthetic-auth.example.invalid/**', async (route) => {
    if (route.request().url().includes('/sign-in/social')) {
      const body: unknown = route.request().postDataJSON();
      const callbackURL = new URL('/managed-auth-proof.html', page.url());
      expect(
        typeof body === 'object' &&
          body !== null &&
          'callbackURL' in body &&
          body.callbackURL === callbackURL.href,
      ).toBe(true);
      signedOut = false;
      await route.fulfill({
        json: {
          redirect: true,
          url: new URL(
            `${bootstraps === 0 ? '/managed-auth-proof.html' : '/'}?neon_auth_session_verifier=synthetic-verifier`,
            page.url(),
          ).href,
        },
        headers: {
          'set-cookie':
            'synthetic-challenge=synthetic-challenge-cookie; Path=/neon/auth; HttpOnly; Secure; SameSite=None',
        },
      });
    } else if (route.request().url().includes('/sign-out')) {
      signedOut = true;
      await route.fulfill({
        json: { success: true },
        headers: {
          'set-cookie':
            'synthetic-managed-session=; Path=/neon/auth; HttpOnly; Secure; SameSite=None; Max-Age=0',
        },
      });
    } else if (route.request().url().includes('/get-session')) {
      bootstraps++;
      expect(
        new URL(route.request().url()).searchParams.get('neon_auth_session_verifier') ===
          'synthetic-verifier',
      ).toBe(true);
      expect(
        route
          .request()
          .headers()
          ['cookie']?.includes('synthetic-challenge=synthetic-challenge-cookie') ?? false,
      ).toBe(true);
      await route.fulfill({
        json: {
          session: { token: 'synthetic-session-credential' },
          user: { id: 'synthetic-subject' },
        },
        headers: {
          'set-cookie':
            'synthetic-managed-session=synthetic-cookie; Path=/neon/auth; HttpOnly; Secure; SameSite=None',
          'set-auth-jwt': 'synthetic-browser-token',
        },
      });
    } else {
      tokens += 1;
      const hasCookie =
        route
          .request()
          .headers()
          ['cookie']?.includes('synthetic-managed-session=synthetic-cookie') ?? false;
      await route.fulfill({
        json:
          signedOut || !hasCookie
            ? { message: 'Unauthorized' }
            : { token: 'synthetic-browser-token' },
        status: signedOut || !hasCookie ? 401 : 200,
      });
    }
  });
  await page.route('**/api/dev/managed-identity', async (route) => {
    expect(route.request().headers()['authorization'] === 'Bearer synthetic-browser-token').toBe(
      true,
    );
    await route.fulfill({
      json: {
        identity: {
          provider: 'neon',
          issuer: 'https://synthetic-auth.example.invalid',
          subject: 'synthetic-browser-subject',
          verifiedEmail: null,
          expiresAt: Math.floor(Date.now() / 1000) + 900,
        },
      },
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('kendo-menu', 'synthetic-guest-bytes');
  });
  await page.goto('/managed-auth-proof.html');
  await expect(page.getByRole('status')).toContainText('No managed session');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Verified identity', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/managed-auth-proof.html$/);
  expect(await page.evaluate(() => localStorage.getItem('better-auth.message'))).toBeNull();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Verified identity', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('better-auth.message'))).toBeNull();
  await page.getByRole('button', { name: 'Verify identity' }).click();
  await expect(page.getByRole('status')).toContainText('Managed identity verified');
  expect(tokens).toBe(4);
  expect(bootstraps).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('better-auth.message'))).toBeNull();
  // This dedicated configuration forces synthetic auth transport; never use for live login.
  await page.screenshot({
    path: `/private/tmp/kendo-managed-proof-${test.info().project.name}.png`,
  });
  const violations = (await new AxeBuilder({ page }).analyze()).violations;
  expect(
    violations.filter((item) => item.impact === 'critical' || item.impact === 'serious'),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('status')).toContainText('Signed out');
  await expect(page.getByRole('heading', { name: 'Verified identity', exact: true })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() => {
      const message = localStorage.getItem('better-auth.message');
      return (
        localStorage.getItem('kendo-menu') === 'synthetic-guest-bytes' &&
        !(message?.includes('synthetic-browser-token') ?? false) &&
        !(message?.includes('synthetic-session-credential') ?? false) &&
        sessionStorage.length === 0
      );
    }),
  ).toBe(true);
  await page.getByRole('button', { name: 'Verify identity' }).click();
  await expect(page.getByRole('status')).toContainText('No managed session');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Verified identity', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/managed-auth-proof.html$/);
  expect(
    await page.evaluate(
      () =>
        localStorage.getItem('better-auth.message')?.includes('synthetic-browser-token') ?? false,
    ),
  ).toBe(false);
  expect(bootstraps).toBe(2);
});

test('failed callback exchange is sanitized, retryable and never attempts token or API verification', async ({
  page,
}) => {
  let tokenRequests = 0;
  let apiRequests = 0;
  await page.route('https://synthetic-auth.example.invalid/**', async (route) => {
    if (!route.request().url().includes('/get-session')) tokenRequests++;
    await route.fulfill({ status: 401, json: { message: 'synthetic-private-provider-error' } });
  });
  await page.route('**/api/dev/managed-identity', async (route) => {
    apiRequests++;
    await route.fulfill({ status: 503, json: {} });
  });
  await page.addInitScript(() => {
    localStorage.setItem('kendo-menu', 'synthetic-guest-bytes');
  });
  await page.goto('/?neon_auth_session_verifier=synthetic-verifier');
  await expect(page.getByRole('status')).toContainText(
    'callback could not establish a managed session',
  );
  await expect(page).toHaveURL(/neon_auth_session_verifier=synthetic-verifier/);
  await page.getByRole('button', { name: 'Verify identity' }).click();
  await expect(page.getByRole('status')).toContainText(
    'callback could not establish a managed session',
  );
  expect(tokenRequests).toBe(0);
  expect(apiRequests).toBe(0);
  await expect(page.getByText('synthetic-private-provider-error')).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        localStorage.getItem('kendo-menu') === 'synthetic-guest-bytes' &&
        localStorage.getItem('better-auth.message') === null &&
        sessionStorage.length === 0,
    ),
  ).toBe(true);
});
