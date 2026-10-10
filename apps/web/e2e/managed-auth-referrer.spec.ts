import { expect, test } from '@playwright/test';

const VERIFIER = 'synthetic-private-verifier';
const AUTH_ORIGIN = 'https://synthetic-auth.example.invalid';

for (const callback of ['root', 'explicit'] as const) {
  test(`${callback} application callback does not send its verifier in module Referer headers`, async ({
    page,
  }) => {
    const refererHeaders: Array<Promise<string | undefined>> = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') {
        refererHeaders.push(request.allHeaders().then((headers) => headers['referer']));
      }
    });
    await page.route(`${AUTH_ORIGIN}/**`, async (route) => {
      await route.fulfill({ status: 503, json: { message: 'synthetic private provider error' } });
    });

    if (callback === 'root') {
      await page.addInitScript(() => {
        sessionStorage.setItem(
          'kendomenu:auth-return-v1',
          JSON.stringify({ version: 1, flow: 'application', expiresAt: Date.now() + 60_000 }),
        );
      });
    }
    const path =
      callback === 'root'
        ? `/?neon_auth_session_verifier=${VERIFIER}`
        : `/app/auth/callback?neon_auth_session_verifier=${VERIFIER}`;
    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: 'Sign-in could not be completed' }),
    ).toBeVisible();

    const values = await Promise.all(refererHeaders);
    expect(values.some((value) => value?.includes(VERIFIER))).toBe(false);
  });
}
