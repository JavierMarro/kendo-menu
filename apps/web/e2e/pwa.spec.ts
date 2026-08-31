import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'kendo-menu';
const OFFLINE_PATHS = ['/app', '/app/dashboard', '/app/library'] as const;
const OFFLINE_STORAGE_RAW = JSON.stringify({
  state: {
    dashboardEntries: [
      {
        id: 'offline-international-dojo-entry',
        trainingSetId: 'international-dojo-2-hour-session',
        quantityOverrides: {},
        activityNotes: {},
        notes: '',
        createdAt: '2026-08-31T00:00:00.000Z',
      },
    ],
  },
  version: 10,
});

async function establishServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

test.describe('production PWA shell', () => {
  test('serves the required manifest fields and PNG icon sizes', async ({ page, request }) => {
    const manifestResponse = await request.get('/manifest.webmanifest');
    expect(manifestResponse.ok()).toBe(true);
    expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json');

    const manifest: unknown = await manifestResponse.json();
    expect(manifest).toMatchObject({
      id: '/',
      name: 'KendoMenu',
      short_name: 'KendoMenu',
      description: 'KendoMenu helps you assemble focused kendo training sessions.',
      start_url: '/app',
      scope: '/',
      display: 'standalone',
      lang: 'en',
      theme_color: '#0B1B33',
      background_color: '#0B1B33',
      prefer_related_applications: false,
    });
    expect(manifest).toHaveProperty('icons', [
      {
        src: '/icons/kendo-menu-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/kendo-menu-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/kendo-menu-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ]);

    for (const icon of [
      { path: '/icons/kendo-menu-favicon.png', size: 32 },
      { path: '/icons/kendo-menu-192.png', size: 192 },
      { path: '/icons/kendo-menu-512.png', size: 512 },
      { path: '/icons/kendo-menu-512-maskable.png', size: 512 },
      { path: '/icons/kendo-menu-apple-touch-icon.png', size: 180 },
    ]) {
      const iconResponse = await request.get(icon.path);
      expect(iconResponse.ok()).toBe(true);
      expect(iconResponse.headers()['content-type']).toContain('image/png');
      const body = await iconResponse.body();
      expect(body.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(body.readUInt32BE(16)).toBe(icon.size);
      expect(body.readUInt32BE(20)).toBe(icon.size);
    }

    await page.goto('/app');
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    await expect(page.locator('link[rel="icon"]')).toHaveCount(1);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
      'href',
      '/icons/kendo-menu-favicon.png',
    );
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('sizes', '32x32');
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('type', 'image/png');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/icons/kendo-menu-apple-touch-icon.png',
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('sizes', '180x180');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('meta[name="viewport"]')).toHaveCount(1);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      'content',
      'width=device-width, initial-scale=1.0',
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0B1B33');
    await expect(page.locator('meta[name="description"]')).toHaveCount(1);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      'KendoMenu helps you assemble focused kendo training sessions.',
    );
    await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveCount(1);
    await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
      'content',
      'yes',
    );
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveCount(1);
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
      'content',
      'yes',
    );
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveCount(1);
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
      'content',
      'KendoMenu',
    );
    await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveCount(1);
    await expect(
      page.locator('meta[name="apple-mobile-web-app-status-bar-style"]'),
    ).toHaveAttribute('content', 'black');
  });

  test('registers and controls the production service worker', async ({ page, request }) => {
    await page.goto('/app');
    await establishServiceWorkerControl(page);

    const serviceWorker = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      return {
        controlled: navigator.serviceWorker.controller !== null,
        scope: registration?.scope ?? null,
        scriptUrl: registration?.active?.scriptURL ?? null,
      };
    });

    expect(serviceWorker.controlled).toBe(true);
    expect(serviceWorker.scope).toBe(`${new URL('/', page.url()).href}`);
    expect(serviceWorker.scriptUrl).toBe(`${new URL('/sw.js', page.url()).href}`);

    const serviceWorkerResponse = await request.get('/sw.js');
    expect(serviceWorkerResponse.ok()).toBe(true);
    const serviceWorkerSource = await serviceWorkerResponse.text();
    expect(serviceWorkerSource).not.toContain('gc.zgo.at');
    expect(serviceWorkerSource).not.toContain('javiermarro.goatcounter.com');
  });

  test('serves a primed shell and localStorage-backed session after offline reloads', async ({
    page,
    context,
  }) => {
    const blockedGoatCounterRequests: string[] = [];
    await page.route('**://gc.zgo.at/**', async (route) => {
      blockedGoatCounterRequests.push(route.request().url());
      await route.abort();
    });
    await page.route('**://javiermarro.goatcounter.com/**', async (route) => {
      blockedGoatCounterRequests.push(route.request().url());
      await route.abort();
    });

    await page.goto('/app');
    await establishServiceWorkerControl(page);
    await page.evaluate(({ key, value }) => window.localStorage.setItem(key, value), {
      key: STORAGE_KEY,
      value: OFFLINE_STORAGE_RAW,
    });
    await expect(
      page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY),
    ).resolves.toBe(OFFLINE_STORAGE_RAW);
    await expect.poll(() => blockedGoatCounterRequests.length).toBeGreaterThan(0);

    await context.setOffline(true);
    try {
      for (const path of OFFLINE_PATHS) {
        await page.goto(path);
        await page.reload();

        if (path === '/app') {
          await expect(
            page.getByRole('heading', { name: 'Plan the keiko you need today.', exact: true }),
          ).toBeVisible();
        } else if (path === '/app/dashboard') {
          await expect(
            page.getByRole('heading', { name: 'Your dashboard', exact: true }),
          ).toBeVisible();
          await expect(
            page.locator('.dashboard-card--compact').filter({ hasText: 'International dojo menu' }),
          ).toBeVisible();
        } else {
          await expect(
            page.getByRole('heading', { name: 'Keiko library', exact: true }),
          ).toBeVisible();
          await expect(page.locator('.library-card')).toHaveCount(11);
        }

        await expect(
          page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY),
        ).resolves.toBe(OFFLINE_STORAGE_RAW);
      }
    } finally {
      await context.setOffline(false);
    }
  });
});
