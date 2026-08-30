import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const STORAGE_KEY = 'kendo-menu-recursive-e2e';

function fixtureUrl(view: 'library' | 'dashboard'): string {
  return `/e2e/recursive-fixture.html?view=${view}`;
}

async function expectNoBlockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([]);
}

async function expectDisclosureIndicator(details: Locator, content: '+' | '−') {
  const indicator = details.locator(':scope > summary .detail-section-indicator');
  await expect
    .poll(() => indicator.evaluate((element) => getComputedStyle(element, '::before').content))
    .toBe(`"${content}"`);
}

async function openNestedDetails(container: Locator): Promise<Locator> {
  const tagName = await container.evaluate((element) => element.tagName.toLowerCase());
  const details = tagName === 'details' ? container : container.locator(':scope > details');
  await details.locator(':scope > summary').click();
  await expect(details).toHaveJSProperty('open', true);
  return details;
}

test.describe('recursive activity consumers', () => {
  test('opens nested library disclosures by mouse and keyboard with stable hierarchy', async ({
    page,
  }) => {
    await page.goto(fixtureUrl('library'));
    await expect(page.getByText('8 activities in this session.')).toBeVisible();

    const root = page.locator('[data-activity-id="synthetic-root"]');
    const stationA = page.locator('[data-activity-id="synthetic-station-a"] > details');
    const sandan = page.locator('[data-activity-id="synthetic-sandan-geiko"] > details');
    const yakusoku = page.locator('[data-activity-id="synthetic-yakusoku-geiko"] > details');
    const free = page.locator('[data-activity-id="synthetic-free-version"] > details');

    await expect(root.locator(':scope > summary')).toBeVisible();
    await expect(stationA.locator(':scope > summary')).toHaveCount(1);
    await expect(root.locator(':scope > summary')).toHaveAccessibleName(
      'Recursive keiko 2 activities',
    );
    await expect(
      page.locator('[data-activity-id="synthetic-station-a-exercise"] summary'),
    ).toHaveCount(0);
    await expect(page.locator('[data-activity-id="synthetic-yakusoku-men"] summary')).toHaveCount(
      0,
    );

    await expectDisclosureIndicator(root, '+');
    await root.locator(':scope > summary').click();
    await expect(root).toHaveJSProperty('open', true);
    await expectDisclosureIndicator(root, '−');
    await expect(root.getByText('30 minutes')).toBeVisible();
    await expect(root.getByText('Start with posture and intent.')).toBeVisible();
    await expect(stationA.locator(':scope > summary')).toHaveAccessibleName('Station A 1 exercise');
    await expect(sandan.locator(':scope > summary')).toHaveAccessibleName(
      'Sandan-geiko 2 activities',
    );

    await expectDisclosureIndicator(stationA, '+');
    await stationA.locator(':scope > summary').click();
    await expect(stationA).toHaveJSProperty('open', true);
    await expectDisclosureIndicator(stationA, '−');
    await expect(page.getByText('Station A exercise')).toBeVisible();

    await sandan.locator(':scope > summary').press('Enter');
    await expect(sandan).toHaveJSProperty('open', true);
    await expectDisclosureIndicator(sandan, '−');
    await expect(sandan.getByText('2 rounds')).toBeVisible();
    await expect(sandan.getByText('Move through each variation deliberately.')).toBeVisible();
    await expect(yakusoku.locator(':scope > summary')).toHaveAccessibleName(
      'Yakusoku-geiko 1 exercise',
    );
    await expect(free.locator(':scope > summary')).toHaveAccessibleName('Free version 1 exercise');

    await yakusoku.locator(':scope > summary').press('Space');
    await expect(yakusoku).toHaveJSProperty('open', true);
    await expect(yakusoku.getByText('6 repetitions')).toBeVisible();
    await expect(free.locator(':scope > summary')).toBeVisible();

    await free.locator(':scope > summary').click();
    await expect(free).toHaveJSProperty('open', true);
    await expect(free.getByText('Time not set')).toBeVisible();
    await expect(page.locator('[data-activity-id="synthetic-station-a"]')).not.toContainText(
      'Reps not set',
    );

    await expectNoBlockingAxeViolations(page);
  });

  test('keeps keyboard focus visible and avoids mobile horizontal overflow', async ({ page }) => {
    await page.goto(fixtureUrl('library'));
    const root = page.locator('[data-activity-id="synthetic-root"]');
    const stationA = page.locator('[data-activity-id="synthetic-station-a"] > details');
    const sandan = page.locator('[data-activity-id="synthetic-sandan-geiko"] > details');
    const yakusoku = page.locator('[data-activity-id="synthetic-yakusoku-geiko"] > details');
    const free = page.locator('[data-activity-id="synthetic-free-version"] > details');
    await root.locator(':scope > summary').click();
    await stationA.locator(':scope > summary').click();
    await sandan.locator(':scope > summary').click();
    await yakusoku.locator(':scope > summary').click();
    await free.locator(':scope > summary').click();

    const stationSummary = stationA.locator(':scope > summary');
    await page.getByRole('button', { name: 'Add to dashboard' }).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(stationSummary).toBeFocused();
    expect(await stationSummary.evaluate((element) => element.matches(':focus-visible'))).toBe(
      true,
    );
    expect(
      await stationSummary.evaluate((element) => getComputedStyle(element).outlineWidth),
    ).not.toBe('0px');

    const viewportWidth = await page.evaluate(() => window.innerWidth);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `fixture overflow at ${viewportWidth}px`).toBeLessThanOrEqual(
      viewportWidth,
    );
    await expectNoBlockingAxeViolations(page);
  });

  test('edits a deeply nested dashboard leaf and restores its override after reload', async ({
    page,
  }) => {
    await page.goto(fixtureUrl('dashboard'));

    await openNestedDetails(page.locator('[data-activity-id="synthetic-root"]'));
    await openNestedDetails(page.locator('[data-activity-id="synthetic-station-a"]'));
    await openNestedDetails(page.locator('[data-activity-id="synthetic-sandan-geiko"]'));
    await openNestedDetails(page.locator('[data-activity-id="synthetic-yakusoku-geiko"]'));
    await openNestedDetails(page.locator('[data-activity-id="synthetic-free-version"]'));

    await expect(page.getByLabel('Minutes for Recursive keiko')).toHaveValue('30');
    await expect(page.getByLabel('Rounds for Sandan-geiko')).toHaveValue('2');
    await expect(page.getByLabel('Repetitions for Station A exercise')).toHaveValue('12');
    await expect(page.getByLabel('Repetitions for Yakusoku men')).toHaveValue('6');
    await expect(page.getByLabel('Seconds for Free version footwork')).toHaveValue('');
    await expect(page.getByLabel(/for Station A$/i)).toHaveCount(0);
    await expect(page.getByLabel(/for Free version$/i)).toHaveCount(0);
    const quantityUnitStyles = await page
      .locator('.quantity-input-wrap > span')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const styles = getComputedStyle(element);
          return { flexShrink: styles.flexShrink, whiteSpace: styles.whiteSpace };
        }),
      );
    expect(quantityUnitStyles.length).toBe(5);
    expect(
      quantityUnitStyles.every(
        ({ flexShrink, whiteSpace }) => flexShrink === '0' && whiteSpace === 'nowrap',
      ),
    ).toBe(true);

    const deepInput = page.getByLabel('Repetitions for Yakusoku men');
    await deepInput.fill('18');
    await deepInput.blur();
    await expect(deepInput).toHaveValue('18');

    const raw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    expect(raw).toContain('synthetic-yakusoku-men');
    expect(raw).toContain('"repetitions":18');

    await page.reload();
    await openNestedDetails(page.locator('[data-activity-id="synthetic-root"]'));
    await openNestedDetails(page.locator('[data-activity-id="synthetic-sandan-geiko"]'));
    await openNestedDetails(page.locator('[data-activity-id="synthetic-yakusoku-geiko"]'));
    await openNestedDetails(page.locator('[data-activity-id="synthetic-free-version"]'));
    await expect(page.getByLabel('Repetitions for Yakusoku men')).toHaveValue('18');
    await expect(page.getByLabel('Seconds for Free version footwork')).toHaveValue('');

    const viewportWidth = await page.evaluate(() => window.innerWidth);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `dashboard fixture overflow at ${viewportWidth}px`).toBeLessThanOrEqual(
      viewportWidth,
    );
    await expectNoBlockingAxeViolations(page);
  });
});
