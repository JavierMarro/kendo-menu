import { expect, test } from '@playwright/test';

const CANONICAL_ORIGIN = 'https://www.kendomenu.com';
const SOCIAL_IMAGE_URL = `${CANONICAL_ORIGIN}/assets/kendo-menu-social.jpg`;

test.describe('production metadata and crawl boundaries', () => {
  test('publishes canonical social metadata and noindexes local or unknown routes', async ({
    page,
  }) => {
    await page.goto('/app');

    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${CANONICAL_ORIGIN}/app`,
    );
    await expect(page.locator('meta[name="description"]')).toHaveCount(1);
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
      'content',
      'KendoMenu',
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      'content',
      `${CANONICAL_ORIGIN}/app`,
    );
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      SOCIAL_IMAGE_URL,
    );
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
      'content',
      '1200',
    );
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute(
      'content',
      '630',
    );
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute(
      'content',
      'Gold KM logo and KendoMenu wordmark with a kendo illustration and ‘Plan the keiko you need today.’',
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary_large_image',
    );
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
      'content',
      SOCIAL_IMAGE_URL,
    );

    await page.goto('/app/library');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${CANONICAL_ORIGIN}/app/library`,
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      'content',
      `${CANONICAL_ORIGIN}/app/library`,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

    await page.goto('/app/dashboard');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${CANONICAL_ORIGIN}/app`,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );

    await page.goto('/app/library?drill=international-dojo-2-hour-session');
    await expect(page).toHaveURL(/\/app\/library\?drill=/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${CANONICAL_ORIGIN}/app`,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );

    await page.goto('/app#faq-title');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );

    const unknownResponse = await page.goto('/outside');
    expect(unknownResponse?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: 'That route is not part of KendoMenu.' }),
    ).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${CANONICAL_ORIGIN}/app`,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
  });

  test('serves a canonical robots policy and conservative sitemap', async ({ request }) => {
    const robotsResponse = await request.get('/robots.txt');
    expect(robotsResponse.ok()).toBe(true);
    expect(robotsResponse.headers()['content-type']).toContain('text/plain');
    const robots = await robotsResponse.text();
    expect(robots).toContain('Allow: /');
    expect(robots).not.toContain('Disallow:');
    expect(robots).toContain(`Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml`);
    expect(robots).not.toContain('.git');

    const sitemapResponse = await request.get('/sitemap.xml');
    expect(sitemapResponse.ok()).toBe(true);
    expect(sitemapResponse.headers()['content-type']).toMatch(/(?:application|text)\/xml/);
    const sitemap = await sitemapResponse.text();
    const locations: string[] = [];
    for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const location = match[1];
      if (location !== undefined) {
        locations.push(location);
      }
    }
    expect(locations).toEqual([`${CANONICAL_ORIGIN}/app`]);
    expect(locations.every((location) => !location.includes('?'))).toBe(true);
    expect(locations.every((location) => !location.includes('#'))).toBe(true);
  });

  test('noindexes persistence recovery and restores landing metadata after recovery', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('kendo-menu', '{invalid'));
    await page.goto('/app');
    await expect(
      page.getByRole('heading', { name: 'We couldn’t read your local KendoMenu data.' }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
    await page.evaluate(() => localStorage.removeItem('kendo-menu'));
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Plan the keiko you need today.' }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  });

  test('serves metadata and the social image without client rendering', async ({
    page,
    request,
  }) => {
    const response = await request.get('/app');
    const html = await response.text();
    expect(html).toContain(`href="${CANONICAL_ORIGIN}/app"`);
    expect(html).toContain(`content="${SOCIAL_IMAGE_URL}"`);
    expect(html).toContain('property="og:title"');
    expect(html).toContain('name="twitter:description"');
    const imageResponse = await request.get('/assets/kendo-menu-social.jpg');
    expect(imageResponse.ok()).toBe(true);
    expect(imageResponse.headers()['content-type']).toContain('image/jpeg');
    await page.goto('/assets/kendo-menu-social.jpg');
    const dimensions = await page.locator('img').evaluate(async (element: HTMLImageElement) => {
      await element.decode();
      return { width: element.naturalWidth, height: element.naturalHeight };
    });
    expect(dimensions).toEqual({ width: 1200, height: 630 });
  });

  test('noindexes the client recovery state', async ({ page }) => {
    await page.goto('/e2e/error-fixture.html');
    await page.getByRole('button', { name: 'Throw render error' }).click();

    await expect(page.getByRole('heading', { name: 'KendoMenu couldn’t continue.' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
  });
});
