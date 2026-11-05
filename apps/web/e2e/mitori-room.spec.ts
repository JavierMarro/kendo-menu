import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';

import { MITORI_VIDEOS } from '../src/features/mitori/mitori-videos';
import { test } from './guest-test';
import { SyntheticManagedHarness } from './synthetic-managed-harness';
import { workspaceLink } from './workspace-test-helpers';

test('Mitori room supports keyboard video selection, URL history and lazy private embeds', async ({
  page,
}) => {
  const youtubeRequests: string[] = [];
  await page.route(
    /https:\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com|i\.ytimg\.com)\//,
    async (route) => {
      youtubeRequests.push(route.request().url());
      await route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Synthetic video</title>',
      });
    },
  );
  await page.goto('/app/guest/dashboard');
  await workspaceLink(page, 'Mitori room').click();
  await expect(page.getByRole('heading', { name: 'Mitori room', exact: true })).toBeVisible();
  await expect(workspaceLink(page, 'Mitori room')).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle('Mitori room · KendoMenu');
  expect(youtubeRequests).toEqual([]);
  const first = page.getByRole('button', { name: /Oikomi/ });
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/ZyJiUitoZZE',
  );
  await expect.poll(() => youtubeRequests.length).toBe(1);
  await page.getByRole('button', { name: /Naoki Eiga Sensei/ }).click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  const sections = page.getByRole('navigation', { name: 'Mitori room sections' });
  await sections.getByRole('link', { name: 'Documentaries' }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await sections.getByRole('link', { name: 'Kata', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: /Nippon Kendo Kata/ })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: /Path of No Regret/ })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await sections.getByRole('link', { name: 'Glossary' }).click();
  await page.getByRole('searchbox', { name: 'Find a term' }).fill('kirikaeshi');
  await expect(page.getByRole('term').filter({ hasText: /^Kirikaeshi$/ })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Find a term' }).fill('not-a-kendo-term');
  await expect(page.getByText(/No terms match/)).toBeVisible();
  await sections.getByRole('link', { name: 'Resources' }).click();
  await expect(page.getByRole('heading', { name: 'Resources', exact: true })).toBeVisible();
  await expect(page.getByRole('contentinfo', { name: 'Site footer' })).toHaveCount(0);
});

test('Equipment categories animate accessibly, restore focus and support direct links', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/https:\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com|i\.ytimg\.com)\//, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Video</title>' }),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/app/guest/mitori-room?tab=equipment');
  const notice = page.getByRole('complementary', { name: 'Cookie notice' });
  await notice.getByRole('button', { name: 'Got it' }).click();

  const categories = page.getByRole('navigation', { name: 'Equipment categories' });
  await expect(categories.getByRole('link')).toHaveText([
    'Wear & fold',
    'Care & cleaning',
    'Craft & manufacture',
  ]);
  await page.screenshot({
    path: testInfo.outputPath('equipment-chooser-1440.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  const careBox = await categories.getByRole('link', { name: 'Care & cleaning' }).boundingBox();
  const craftBox = await categories
    .getByRole('link', { name: 'Craft & manufacture' })
    .boundingBox();
  if (careBox === null || craftBox === null)
    throw new Error('Expected the lower equipment bubbles.');
  expect(careBox.x + careBox.width).toBeLessThanOrEqual(craftBox.x);

  const craft = categories.getByRole('link', { name: 'Craft & manufacture' });
  await craft.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/tab=equipment&category=craft-manufacture$/);
  await expect(
    page.getByRole('heading', { name: 'Craft & manufacture', exact: true }),
  ).toBeVisible();
  const back = page.getByRole('button', { name: 'Back to Equipment' });
  await expect(back).toBeFocused();
  await expect(page.locator('.mitori-equipment-detail')).toHaveCSS('animation-name', 'none');
  const mitsuboshi = page.getByRole('checkbox', {
    name: 'Seen: Inside the Kuji Factory — Mitsuboshi',
  });
  await mitsuboshi.check();
  const mitsuboshiVideo = page.getByRole('button', {
    name: /Inside the Kuji Factory — Mitsuboshi/,
  });
  await page.screenshot({ path: testInfo.outputPath('equipment-craft-1440.png'), fullPage: true });
  await mitsuboshiVideo.click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/3MuXjrp6xhc',
  );
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([]);

  await back.click();
  await expect(page.locator('iframe')).toHaveCount(0);
  const restoredCategories = page.getByRole('navigation', { name: 'Equipment categories' });
  const restoredCraft = restoredCategories.getByRole('link', { name: 'Craft & manufacture' });
  await expect(restoredCraft).toBeFocused();
  await restoredCraft.click();
  await expect(mitsuboshi).toBeChecked();
  await page.getByRole('button', { name: 'Back to Equipment' }).click();
  const afterSeenCheck = page.getByRole('navigation', { name: 'Equipment categories' });
  await afterSeenCheck.getByRole('link', { name: 'Care & cleaning' }).click();
  await expect(page).toHaveURL(/tab=equipment&category=care-cleaning$/);
  await page.goBack();
  await expect(page).toHaveURL(/tab=equipment$/);
  await expect(page.getByRole('navigation', { name: 'Equipment categories' })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('equipment-chooser-320.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const mobileCategories = page.getByRole('navigation', { name: 'Equipment categories' });
  const mobileCareBox = await mobileCategories
    .getByRole('link', { name: 'Care & cleaning' })
    .boundingBox();
  const mobileCraftBox = await mobileCategories
    .getByRole('link', { name: 'Craft & manufacture' })
    .boundingBox();
  if (mobileCareBox === null || mobileCraftBox === null) {
    throw new Error('Expected the lower equipment bubbles at mobile width.');
  }
  expect(mobileCareBox.x + mobileCareBox.width).toBeLessThanOrEqual(mobileCraftBox.x);
  await mobileCategories.getByRole('link', { name: 'Wear & fold' }).click();
  await expect(page.getByRole('heading', { name: 'Wear & fold', exact: true })).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Seen: How to Wear a Kendo Uniform (Kendogi & Hakama)' }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('equipment-wear-320.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await page.goto('/app/guest/mitori-room?tab=equipment&category=care-cleaning');
  await expect(page.getByRole('heading', { name: 'Care & cleaning', exact: true })).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Seen: How to Take Care of Your Kendo Bogu' }),
  ).toBeVisible();
  await page.goto('/app/guest/mitori-room?tab=equipment&category=unknown');
  await expect(page.getByRole('navigation', { name: 'Equipment categories' })).toBeVisible();
});

test('signed-in navigation and guest deep links reach the account Mitori room without saving', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  await page.goto('/app/guest/mitori-room?tab=kata');
  await expect(page).toHaveURL(/\/app\/account\/mitori-room\?tab=kata$/);
  await expect(page.getByRole('button', { name: /Nippon Kendo Kata/ })).toBeVisible();
  await page.getByRole('checkbox', { name: /Nippon Kendo Kata/ }).check();
  await expect(page.getByRole('checkbox', { name: /Nippon Kendo Kata/ })).toBeChecked();
  await workspaceLink(page, 'Dashboard').click();
  await workspaceLink(page, 'Mitori room').click();
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Nippon Kendo Kata/ })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu-mitori-seen'))).toContain(
    'QIpPUdTCv-Y',
  );
  await page.goto('/app/guest/mitori-room?tab=competitions&collection=ajkc-finals');
  await expect(page).toHaveURL(
    /\/app\/account\/mitori-room\?tab=competitions&collection=ajkc-finals$/,
  );
  await expect(
    page.getByRole('heading', { name: 'AJKC finals (mens)', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.mitori-video-toggle')).toHaveCount(
    MITORI_VIDEOS['ajkc-finals'].length,
  );
  await page
    .getByRole('navigation', { name: 'Competition collections' })
    .getByRole('link', { name: 'AJKC finals (womens)', exact: true })
    .click();
  await expect(page).toHaveURL(
    /\/app\/account\/mitori-room\?tab=competitions&collection=ajkc-finals-womens$/,
  );
  await expect(
    page.getByRole('heading', { name: 'AJKC finals (womens)', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.mitori-video-toggle')).toHaveCount(
    MITORI_VIDEOS['ajkc-finals-womens'].length,
  );
  expect(harness.apiCalls.filter((call) => call.method !== 'GET')).toEqual([]);
});

test('competition collections support keyboard navigation, history, playlists and local Seen marks', async ({
  page,
}) => {
  const youtubeRequests: string[] = [];
  await page.route(
    /https:\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com|i\.ytimg\.com)\//,
    async (route) => {
      youtubeRequests.push(route.request().url());
      await route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Video</title>',
      });
    },
  );
  await page.goto('/app/guest/mitori-room');
  const notice = page.getByRole('complementary', { name: 'Cookie notice' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Got it' }).click();
  const sections = page.getByRole('navigation', { name: 'Mitori room sections' });
  await expect(sections.getByRole('link')).toHaveText([
    'General',
    'Competitions',
    'Documentaries',
    'Kata',
    'Equipment',
    'Resources',
    'Glossary',
  ]);
  await sections.getByRole('link', { name: 'Competitions', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '2026', exact: true })).toBeVisible();
  await expect(page.locator('.mitori-video-toggle')).toHaveCount(
    MITORI_VIDEOS['competition-2026'].length,
  );
  await expect(
    page.getByText('Seen marks stay in this browser and don’t sync across devices.'),
  ).toHaveCount(0);
  expect(youtubeRequests).toEqual([]);

  const collections = page.getByRole('navigation', { name: 'Competition collections' });
  const finals = collections.getByRole('link', { name: 'AJKC finals (mens)', exact: true });
  await finals.focus();
  await page.keyboard.press('Enter');
  await expect(finals).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/tab=competitions&collection=ajkc-finals$/);
  const mensSeen = page.getByRole('checkbox', { name: /73rd All Japan Kendo Championship/ });
  await mensSeen.check();
  await page.getByRole('button', { name: /73rd All Japan Kendo Championship/ }).click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/qYfR983_KwU',
  );
  await collections.getByRole('link', { name: '2026', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  const playlist = page
    .locator('.mitori-video-item')
    .filter({ hasText: '68th All Japan Corporate' });
  await playlist.getByRole('checkbox').check();
  await playlist.getByRole('button').click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/videoseries?list=PLTj3ptu6HjME',
  );
  await expect(playlist.getByRole('link', { name: 'Watch on YouTube' })).toHaveAttribute(
    'href',
    'https://www.youtube.com/playlist?list=PLTj3ptu6HjME',
  );
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'AJKC finals (mens)', exact: true }),
  ).toBeVisible();
  await expect(mensSeen).toBeChecked();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.reload();
  await expect(mensSeen).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu-mitori-seen'))).toContain(
    'PLTj3ptu6HjME',
  );
  const womens = collections.getByRole('link', { name: 'AJKC finals (womens)', exact: true });
  await womens.focus();
  await page.keyboard.press('Enter');
  await expect(womens).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/collection=ajkc-finals-womens$/);
  const womensSeen = page.getByRole('checkbox', { name: /64th All Japan Women’s/ });
  await womensSeen.check();
  await page.getByRole('button', { name: /64th All Japan Women’s/ }).click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/xWwnza7khAE',
  );
  await finals.click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(mensSeen).toBeChecked();
  await page.goBack();
  await expect(womensSeen).toBeChecked();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'AJKC finals (womens)', exact: true }),
  ).toBeVisible();
  await expect(womensSeen).toBeChecked();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('Seen marks persist locally, can be cleared, and fit mobile widths', async ({
  page,
}, testInfo) => {
  await page.route(/https:\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com|i\.ytimg\.com)\//, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Video</title>' }),
  );
  await page.goto('/app/guest/mitori-room');
  const notice = page.getByRole('complementary', { name: 'Cookie notice' });
  if (await notice.isVisible()) await notice.getByRole('button', { name: 'Got it' }).click();
  const firstSeen = page.getByRole('checkbox', {
    name: /Kendo Training Boot Camp — by Hidehisa Nishimura$/,
  });
  await firstSeen.focus();
  await page.keyboard.press('Space');
  await expect(firstSeen).toBeChecked();
  await expect(firstSeen).toHaveCSS('accent-color', 'rgb(242, 200, 102)');
  const firstRow = page.locator('.mitori-video-row').filter({ has: firstSeen });
  await expect(firstRow).toHaveCSS('background-color', 'rgba(200, 155, 60, 0.16)');
  const firstVideo = page.getByRole('button', {
    name: /Kendo Training Boot Camp — by Hidehisa Nishimura/,
  });
  await firstVideo.click();
  await expect(firstVideo).toHaveAttribute('aria-expanded', 'true');
  await expect(firstRow).toHaveCSS('background-color', 'rgba(200, 155, 60, 0.16)');
  await firstVideo.click();

  const sections = page.getByRole('navigation', { name: 'Mitori room sections' });
  const documentaries = sections.getByRole('link', { name: 'Documentaries' });
  await documentaries.click();
  const documentarySeen = page.getByRole('checkbox', {
    name: 'Seen: Naoki Eiga — A Single Blow',
    exact: true,
  });
  await documentarySeen.check();
  await sections.getByRole('link', { name: 'General' }).click();
  await expect(
    page.getByRole('checkbox', { name: /Kendo Training Boot Camp — by Hidehisa Nishimura$/ }),
  ).toBeChecked();
  await sections.getByRole('link', { name: 'Documentaries' }).click();
  await expect(documentarySeen).toBeChecked();

  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([]);

  if (await notice.isVisible()) await notice.getByRole('button', { name: 'Got it' }).click();
  for (const width of [320, 414, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await sections.getByRole('link', { name: 'General' }).click();
    await expect(
      page.getByRole('checkbox', { name: /Kendo Training Boot Camp — by Hidehisa Nishimura$/ }),
    ).toBeChecked();
    await expect(
      page.getByRole('button', { name: /Kendo Training Boot Camp — by Hidehisa Nishimura/ }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    if (width <= 600) {
      const title = await firstRow.locator('.mitori-video-title').boundingBox();
      const author = await firstRow.locator('.mitori-video-author').boundingBox();
      const seen = await firstRow.locator('.mitori-seen-control').boundingBox();
      const checkbox = await firstSeen.boundingBox();
      if (title === null || author === null || seen === null || checkbox === null) {
        throw new Error('Expected the video title, author, and Seen control to be visible.');
      }
      expect(seen.y).toBeGreaterThanOrEqual(title.y + title.height);
      expect(seen.y + seen.height / 2).toBeGreaterThanOrEqual(author.y);
      expect(seen.y + seen.height / 2).toBeLessThanOrEqual(author.y + author.height);
      expect(title.x + title.width).toBeGreaterThanOrEqual(checkbox.x + checkbox.width);
    }
    await page.screenshot({
      path: testInfo.outputPath(`mitori-seen-${width}.png`),
      fullPage: true,
    });
    await sections.getByRole('link', { name: 'Documentaries' }).click();
    await documentarySeen.uncheck();
    await expect(documentarySeen).not.toBeChecked();
  }

  await sections.getByRole('link', { name: 'General' }).click();
  await page.reload();
  await expect(
    page.getByRole('checkbox', { name: /Kendo Training Boot Camp — by Hidehisa Nishimura$/ }),
  ).toBeChecked();
  await page
    .getByRole('checkbox', { name: /Kendo Training Boot Camp — by Hidehisa Nishimura$/ })
    .uncheck();
  await expect(firstRow).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.reload();
  await expect(
    page.getByRole('checkbox', { name: /Kendo Training Boot Camp — by Hidehisa Nishimura$/ }),
  ).not.toBeChecked();
  await expect(firstRow).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('Mitori room stays accessible and within narrow and desktop viewports', async ({
  page,
}, testInfo) => {
  await page.goto('/app/guest/mitori-room');
  const notice = page.getByRole('complementary', { name: 'Cookie notice' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Got it' }).click();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('mitori-room.png'), fullPage: true });
  for (const width of [320, 414, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await expect(workspaceLink(page, 'Mitori room')).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Mitori room sections' })
      .getByRole('link', { name: 'Glossary' })
      .click();
    await expect(page.getByRole('searchbox', { name: 'Find a term' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page
      .getByRole('navigation', { name: 'Mitori room sections' })
      .getByRole('link', { name: 'Competitions', exact: true })
      .click();
    const collections = page.getByRole('navigation', { name: 'Competition collections' });
    await collections.getByRole('link', { name: '2026', exact: true }).click();
    await expect(page.getByRole('heading', { name: '2026', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    if (width === 320 || width === 1440) {
      const competitionAxe = await new AxeBuilder({ page }).analyze();
      expect(
        competitionAxe.violations.filter(
          ({ impact }) => impact === 'critical' || impact === 'serious',
        ),
      ).toEqual([]);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`competitions-${width}.png`),
        fullPage: true,
      });
    }
    await collections.getByRole('link', { name: 'AJKC finals (mens)', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'AJKC finals (mens)', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await collections.getByRole('link', { name: 'AJKC finals (womens)', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'AJKC finals (womens)', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    if (width === 320 || width === 1440) {
      const womensAxe = await new AxeBuilder({ page }).analyze();
      expect(
        womensAxe.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
      ).toEqual([]);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`womens-finals-${width}.png`),
        fullPage: true,
      });
    }
  }
});
