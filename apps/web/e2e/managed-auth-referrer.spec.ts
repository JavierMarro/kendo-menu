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

const openerCases = [
  {
    label: 'ordinary guest route',
    path: `/app/guest/dashboard?neon_popup=1&neon_popup_callback=https%3A%2F%2Fevil.invalid%2Fcallback&neon_auth_session_verifier=${VERIFIER}`,
    page: 'ordinary',
  },
  {
    label: 'explicit application callback',
    path: `/app/auth/callback?neon_popup=1&neon_popup_callback=https%3A%2F%2Fevil.invalid%2Fcallback&neon_auth_session_verifier=${VERIFIER}`,
    page: 'application',
  },
] as const;

for (const openerCase of openerCases) {
  test(`does not forward a verifier to a cross-origin opener from the ${openerCase.label}`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error('Expected the Playwright app base URL.');
    const appOrigin = new URL(baseURL).origin;
    const otherOriginUrl = new URL(appOrigin);
    otherOriginUrl.port = otherOriginUrl.port === '4176' ? '4175' : '4176';
    const otherOrigin = otherOriginUrl.origin;
    const targetUrl = `${appOrigin}${openerCase.path}`;

    await context.route(`${AUTH_ORIGIN}/**`, async (route) =>
      route.fulfill({ status: 503, json: { message: 'synthetic private provider error' } }),
    );

    await context.route(`${otherOrigin}/audit-opener`, async (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><button type="button">Open synthetic callback</button><script>
          document.body.dataset.authMessages = '[]';
          window.addEventListener('message', (event) => {
            const messages = JSON.parse(document.body.dataset.authMessages);
            messages.push(event.data);
            document.body.dataset.authMessages = JSON.stringify(messages);
          });
          document.querySelector('button').addEventListener('click', () => window.open(${JSON.stringify(targetUrl)}, '_blank'));
        </script>`,
      }),
    );
    await page.goto(`${otherOrigin}/audit-opener`);

    const popupPromise = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Open synthetic callback' }).click();
    const popup = await popupPromise;
    expect(await popup.evaluate(() => window.opener !== null)).toBe(true);

    if (openerCase.page === 'ordinary') {
      await expect(
        popup.getByRole('heading', { name: 'Your dashboard', exact: true }),
      ).toBeVisible();
    } else if (openerCase.page === 'application') {
      await expect(
        popup.getByRole('heading', { name: 'Sign-in could not be completed' }),
      ).toBeVisible();
    }

    await expect(page.locator('body')).toHaveAttribute('data-auth-messages', '[]');
    const popupUrl = new URL(popup.url());
    expect(popupUrl.searchParams.has('neon_popup')).toBe(false);
    expect(popupUrl.searchParams.has('neon_popup_callback')).toBe(false);
    expect(popupUrl.searchParams.get('neon_auth_session_verifier')).toBe(
      openerCase.page === 'ordinary' ? null : VERIFIER,
    );
    await popup.close();
  });
}
