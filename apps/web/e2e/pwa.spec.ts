import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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

test('precaches responsive fallbacks without source originals or the social card', async ({
  page,
  request,
}) => {
  const worker = await request.get('/sw.js');
  const workerSource = await worker.text();
  expect(workerSource).not.toContain('kendo-menu-logo.jpeg');
  expect(workerSource).not.toContain('kendo-menu-hero.jpeg');
  expect(workerSource).not.toContain('kendo-menu-social.jpg');
  await page.goto('/app');
  await establishServiceWorkerControl(page);
  await page.context().setOffline(true);
  for (const format of ['avif', 'webp', 'jpeg']) {
    for (const [name, widths] of [
      ['logo', [44, 88, 176, 264]],
      ['hero', [768, 1280, 1920, 2752]],
    ] as const) {
      for (const width of widths) {
        const result = await page.evaluate(async (path) => {
          const response = await fetch(path);
          return { ok: response.ok, type: response.headers.get('content-type') };
        }, `/assets/kendo-menu-${name}-${width}.${format}`);
        expect(result).toEqual({ ok: true, type: `image/${format}` });
      }
    }
  }
});

// Exercise real Workbox installation/activation against the production build. A byte change
// represents a second deployment without replacing browser service-worker APIs with mocks.
const workerPath = new URL('../dist/sw.js', import.meta.url);

for (const standalone of [false, true]) {
  test(`defers and confirms a real update in ${standalone ? 'standalone' : 'browser'} mode`, async ({
    page,
    context,
  }) => {
    const { readFile, writeFile } = await import('node:fs/promises');
    const originalWorker = await readFile(workerPath, 'utf8');
    if (standalone) {
      await context.addInitScript(() => {
        const originalMatchMedia = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
          const result = originalMatchMedia(query);
          if (query === '(display-mode: standalone)') {
            Object.defineProperty(result, 'matches', { value: true });
          }
          return result;
        };
      });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await page.goto('/app/drills/new');
    await establishServiceWorkerControl(page);
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: STORAGE_KEY,
      value: OFFLINE_STORAGE_RAW,
    });
    await page.getByLabel('Session name').fill('Unfinished keiko');
    const initialTime = await page.evaluate(() => performance.timeOrigin);
    const otherTab = await context.newPage();
    await otherTab.goto('/app/drills/new');
    await otherTab.getByLabel('Session name').fill('Other unfinished keiko');
    const otherTime = await otherTab.evaluate(() => performance.timeOrigin);
    try {
      await writeFile(workerPath, `${originalWorker}\n// Update lifecycle test ${standalone}\n`);
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.ready).update();
      });
      const update = page.getByRole('button', { name: 'Update now', exact: true });
      await expect(update).toBeVisible();
      await expect(
        page
          .getByLabel('Application update', { exact: true })
          .getByText('A new version of KendoMenu is available.', { exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel('Session name')).toHaveValue('Unfinished keiko');
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(initialTime);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      const noticeBox = await page.getByLabel('Application update', { exact: true }).boundingBox();
      const cookieBox = await page.locator('.cookie-notice').boundingBox();
      if (noticeBox !== null && cookieBox !== null) {
        expect(
          noticeBox.y + noticeBox.height <= cookieBox.y ||
            cookieBox.y + cookieBox.height <= noticeBox.y ||
            noticeBox.x + noticeBox.width <= cookieBox.x ||
            cookieBox.x + cookieBox.width <= noticeBox.x,
        ).toBe(true);
      }
      await update.focus();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Later', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(update).toBeHidden();
      await expect(page.getByLabel('Session name')).toHaveValue('Unfinished keiko');
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(initialTime);
      expect(
        await page.evaluate(async () => (await navigator.serviceWorker.ready).waiting !== null),
      ).toBe(true);

      // Returning to a page with a waiting worker must offer the notice again.
      await page.reload();
      await expect(update).toBeVisible();
      const beforeConfirmation = await page.evaluate(() => performance.timeOrigin);
      await update.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(
        (previous) => performance.timeOrigin !== previous,
        beforeConfirmation,
      );
      await expect(update).toBeHidden();
      await expect(page.getByLabel('Session name')).toBeVisible();
      expect(
        await page.evaluate(async () => (await navigator.serviceWorker.ready).waiting),
      ).toBeNull();
      expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(
        OFFLINE_STORAGE_RAW,
      );
      await expect(otherTab.getByLabel('Session name')).toHaveValue('Other unfinished keiko');
      expect(await otherTab.evaluate(() => performance.timeOrigin)).toBe(otherTime);
      await otherTab.getByRole('button', { name: 'Update now', exact: true }).click();
      await otherTab.waitForFunction((previous) => performance.timeOrigin !== previous, otherTime);
      await expect(otherTab.getByRole('button', { name: 'Update now', exact: true })).toBeHidden();
      expect(
        await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
      ).toBe(1);
      await expect(page.locator('script[src*="registerSW"]')).toHaveCount(0);
    } finally {
      await writeFile(workerPath, originalWorker);
      await otherTab.close();
    }
  });
}

test('shows no update notice when the installed worker is current', async ({ page }) => {
  await page.addInitScript(() => {
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    let calls = 0;
    navigator.serviceWorker.register = (...args) => {
      document.documentElement.dataset['registrationCalls'] = String(++calls);
      return register(...args);
    };
  });
  await page.goto('/app');
  await establishServiceWorkerControl(page);
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.ready).update();
  });
  await expect(page.locator('html')).toHaveAttribute('data-registration-calls', '1');
  await expect(page.getByRole('button', { name: 'Update now', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Later', exact: true })).toHaveCount(0);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).waiting)).toBeNull();
});
