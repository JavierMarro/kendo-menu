import { expect, test, type Locator, type Page } from '@playwright/test';

async function dismissCookieNotice(page: Page): Promise<void> {
  const notice = page.getByRole('complementary', { name: 'Cookie notice' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Got it' }).click();
}

function parseRgb(color: string): readonly [number, number, number] {
  const channels = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (channels === undefined || channels.length !== 3) {
    throw new Error(`Could not parse CSS colour ${color}.`);
  }

  const [red, green, blue] = channels;
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`CSS colour ${color} did not contain three channels.`);
  }

  return [red, green, blue];
}

function getRelativeLuminance(color: string): number {
  const channels = parseRgb(color).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const [red, green, blue] = channels;
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`CSS colour ${color} could not be converted to luminance.`);
  }

  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function getContrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = getRelativeLuminance(foreground);
  const backgroundLuminance = getRelativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

async function getInstallActionVisualState(action: Locator) {
  return action.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      fontSize: Number.parseFloat(style.fontSize),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      textDecorationLine: style.textDecorationLine,
    };
  });
}

function expectAaTextContrast(state: Awaited<ReturnType<typeof getInstallActionVisualState>>) {
  expect(getContrastRatio(state.color, state.backgroundColor)).toBeGreaterThanOrEqual(4.5);
}

async function verifyFooterLinksAndKeyboardFocus(page: Page, footer: Locator): Promise<void> {
  await expect(footer.getByRole('link', { name: 'KendoMenu home' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'How it works' })).toBeVisible();
  await expect(footer.getByRole('link', { name: /Keiko library/ })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'FAQ' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Sources' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Cookies' })).toBeVisible();

  const sourcesLink = footer.getByRole('link', { name: 'Sources' });
  const cookiesLink = footer.getByRole('link', { name: 'Cookies' });
  await sourcesLink.focus();
  await page.keyboard.press('Tab');
  await expect(cookiesLink).toBeFocused();

  const focusStyle = await cookiesLink.evaluate((element) => {
    const computedStyle = getComputedStyle(element);
    return {
      outlineStyle: computedStyle.outlineStyle,
      outlineWidth: computedStyle.outlineWidth,
    };
  });
  expect(focusStyle.outlineStyle).not.toBe('none');
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(3);

  const installAction = footer.getByRole('button', { name: 'Install KendoMenu' });
  const sourceFontSize = await sourcesLink.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
  const normalState = await getInstallActionVisualState(installAction);
  expect(normalState.fontSize).toBeGreaterThan(sourceFontSize);
  expect(normalState.textDecorationLine).toContain('underline');
  expectAaTextContrast(normalState);

  await installAction.focus();
  const focusState = await getInstallActionVisualState(installAction);
  expect(focusState.outlineStyle).not.toBe('none');
  expect(focusState.outlineWidth).toBeGreaterThanOrEqual(3);
  expect(focusState.textDecorationLine).toContain('underline');
  expectAaTextContrast(focusState);

  await installAction.hover();
  const hoverState = await getInstallActionVisualState(installAction);
  expect(hoverState.textDecorationLine).toContain('underline');
  expectAaTextContrast(hoverState);

  await page.mouse.down();
  try {
    const activeState = await getInstallActionVisualState(installAction);
    expect(activeState.textDecorationLine).toContain('underline');
    expectAaTextContrast(activeState);
  } finally {
    await page.mouse.up();
  }
}

test.describe('responsive site footer', () => {
  test('uses a three-column layout at 1440px without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app/dashboard');
    await dismissCookieNotice(page);

    const footer = page.getByRole('contentinfo', { name: 'Site footer' });
    await footer.scrollIntoViewIfNeeded();
    const surfaces = await footer.evaluate((element) => ({
      footer: getComputedStyle(element).backgroundColor,
      canvas: getComputedStyle(document.documentElement).backgroundColor,
    }));
    const footerLuminance = getRelativeLuminance(surfaces.footer);
    const canvasLuminance = getRelativeLuminance(surfaces.canvas);
    expect(footerLuminance).toBeLessThan(canvasLuminance);
    expect(canvasLuminance - footerLuminance).toBeLessThan(0.03);

    const grid = footer.locator('.site-footer-grid');
    const desktopLayout = await grid.evaluate((element) => {
      const columns = Array.from(element.querySelectorAll<HTMLElement>('.site-footer-column'));
      const rects = columns.map((column) => column.getBoundingClientRect());
      const firstRect = rects[0];

      return {
        columnCount: columns.length,
        gridColumnCount: getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean)
          .length,
        isSingleRow:
          firstRect !== undefined && rects.every((rect) => Math.abs(rect.top - firstRect.top) <= 1),
      };
    });

    expect(desktopLayout).toEqual({ columnCount: 3, gridColumnCount: 3, isSingleRow: true });
    await verifyFooterLinksAndKeyboardFocus(page, footer);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(1440);
  });

  test('places the brand above two link columns at 375px without horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/app/dashboard');
    await dismissCookieNotice(page);

    const footer = page.getByRole('contentinfo', { name: 'Site footer' });
    await footer.scrollIntoViewIfNeeded();
    const grid = footer.locator('.site-footer-grid');
    const mobileLayout = await grid.evaluate((element) => {
      const columns = Array.from(element.querySelectorAll<HTMLElement>('.site-footer-column'));
      const rects = columns.map((column) => column.getBoundingClientRect());
      const firstRect = rects[0];

      return {
        columnOrder: columns.map((column) => {
          if (column.querySelector('.footer-brand-lockup') !== null) {
            return 'brand';
          }
          if (column.querySelector('.footer-nav') !== null) {
            return 'navigation';
          }
          return 'social';
        }),
        gridColumnCount: getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean)
          .length,
        isBrandAboveLinks:
          firstRect !== undefined && rects.slice(1).every((rect) => rect.top >= firstRect.bottom),
        areLinkColumnsAligned:
          rects[1] !== undefined &&
          rects[2] !== undefined &&
          Math.abs(rects[1].top - rects[2].top) <= 1,
      };
    });

    expect(mobileLayout).toEqual({
      columnOrder: ['brand', 'navigation', 'social'],
      gridColumnCount: 2,
      isBrandAboveLinks: true,
      areLinkColumnsAligned: true,
    });
    await verifyFooterLinksAndKeyboardFocus(page, footer);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
  });
});
