import { expect, test } from '@playwright/test';

test('selects responsive brand images without changing layout', async ({ page }) => {
  await page.goto('/app');
  const logo = page.locator('.top-bar .brand-logo');
  const hero = page.locator('.landing-hero img');
  await expect(logo).toHaveAttribute('width', '88');
  await expect(logo).toHaveAttribute('height', '44');
  await expect(logo).not.toHaveAttribute('fetchpriority', 'high');
  await expect(hero).toHaveAttribute('width', '2752');
  await expect(hero).toHaveAttribute('height', '1536');
  await expect(hero).toHaveAttribute('fetchpriority', 'high');
  await expect(hero).toHaveAttribute('loading', 'eager');
  await expect(hero).toHaveAttribute('alt', '');
  await expect(page.locator('.site-footer .brand-logo')).toHaveAttribute('loading', 'lazy');
  for (const image of [logo, hero]) {
    await expect(image).toHaveJSProperty('complete', true);
    expect(await image.evaluate((element: HTMLImageElement) => element.currentSrc)).toMatch(
      /-\d+\.avif$/,
    );
    const picture = image.locator('..');
    await expect(picture.locator('source').nth(0)).toHaveAttribute('type', 'image/avif');
    await expect(picture.locator('source').nth(1)).toHaveAttribute('type', 'image/webp');
  }
  expect(await logo.boundingBox()).toMatchObject({ width: 88, height: 44 });
  const footerLogo = page.locator('.site-footer .brand-logo');
  await footerLogo.scrollIntoViewIfNeeded();
  await footerLogo.evaluate(async (element: HTMLImageElement) => element.decode());
  expect(await footerLogo.boundingBox()).toMatchObject({ width: 44, height: 22 });
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('This test requires a viewport');
  expect((await page.locator('.landing-page').boundingBox())?.width).toBe(viewport.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
});

for (const format of ['webp', 'jpeg']) {
  test(`decodes the ${format} fallback when preferred sources are unavailable`, async ({
    page,
  }) => {
    await page.goto('/app');
    for (const selector of ['.top-bar picture', '.landing-hero']) {
      const picture = page.locator(selector);
      // Emulate a browser without support for the preceding source types.
      await picture.locator('source').evaluateAll((sources, target) => {
        for (const source of sources) {
          if (source.getAttribute('type') !== `image/${target}`) source.remove();
        }
      }, format);
      const img = picture.locator('img');
      await expect
        .poll(() => img.evaluate((element: HTMLImageElement) => element.currentSrc))
        .toMatch(new RegExp(`\\.${format}$`));
      await img.evaluate(async (element: HTMLImageElement) => element.decode());
      expect(
        await img.evaluate((element: HTMLImageElement) => element.naturalWidth),
      ).toBeGreaterThan(0);
    }
  });
}

test('preserves the tablet cover crop', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/app');
  expect(await page.locator('.landing-page').boundingBox()).toMatchObject({
    width: 768,
    height: 525,
  });
  expect(await page.locator('.landing-hero img').boundingBox()).toMatchObject({
    width: 768,
    height: 525,
  });
  await expect(page.locator('.landing-hero img')).toHaveCSS('object-position', '68% 50%');
});
