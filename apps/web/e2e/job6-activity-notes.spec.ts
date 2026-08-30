import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const STORAGE_KEY = 'kendo-menu';
const INTERNATIONAL_DOJO_ID = 'international-dojo-2-hour-session';
const WARM_UP_ID = 'international-dojo-2-hour-session-warm-up-warm-up';
const SUBURI_ID = 'international-dojo-2-hour-session-suburi-suburi';
const ASHI_SABAKI_ID = 'international-dojo-2-hour-session-ashi-sabaki-ashi-sabaki';
const KIRIKAESHI_ID = 'international-dojo-2-hour-session-kirikaeshi-kirikaeshi';
const KIHON_WAZA_ID = 'international-dojo-2-hour-session-kihon-waza';
const KIHON_WAZA_MEN_ID = 'international-dojo-2-hour-session-kihon-waza-men';

function activity(container: Locator, activityId: string): Locator {
  return container.locator(`[data-activity-id="${activityId}"]`);
}

async function expectNoBlockingAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([]);
}

async function startFresh(page: Page): Promise<void> {
  await page.goto('/app/dashboard');
  await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
}

async function addInternationalDojoToDashboard(page: Page): Promise<void> {
  await page.goto(`/app/library?drill=${INTERNATIONAL_DOJO_ID}`);
  const dialog = page.getByRole('dialog', { name: 'International dojo menu' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Add to dashboard' }).click();
  await dialog.getByRole('link', { name: 'View dashboard' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
}

function firstDashboardCard(page: Page): Locator {
  return page.locator('.dashboard-card--compact').first();
}

async function openDashboardMenu(page: Page): Promise<Locator> {
  const card = firstDashboardCard(page);
  await card.getByRole('button', { name: 'View more' }).click();
  const dialog = page.getByRole('dialog', { name: 'International dojo menu' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('Job 6 dashboard activity notes', () => {
  test.beforeEach(async ({ page }) => {
    await startFresh(page);
  });

  test('keeps controls out of the library and persists an eligible activity note beside quantity and session notes', async ({
    page,
  }) => {
    await page.goto(`/app/library?drill=${INTERNATIONAL_DOJO_ID}`);
    await expect(page.getByRole('button', { name: 'Any extra details?' })).toHaveCount(0);
    const dialog = page.getByRole('dialog', { name: 'International dojo menu' });
    await expect(dialog.getByRole('button', { name: 'Any extra details?' })).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Add to dashboard' }).click();
    await dialog.getByRole('link', { name: 'View dashboard' }).click();
    await expect(page).toHaveURL(/\/app\/dashboard$/);

    const card = firstDashboardCard(page);
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('button', { name: 'Any extra details?' })).toHaveCount(0);
    const removeButton = card.getByRole('button', { name: 'Remove' });
    await expect(removeButton).toHaveClass(/destructive-button/);
    await expect(removeButton).toHaveCSS('color', 'rgb(255, 170, 163)');
    await removeButton.focus();
    await expect(removeButton).toHaveCSS('outline-width', '3px');
    if (await page.evaluate(() => window.matchMedia('(hover: hover)').matches)) {
      await removeButton.hover();
      await expect(removeButton).toHaveCSS('background-color', 'rgba(240, 120, 111, 0.14)');
      await expect(removeButton).toHaveCSS('color', 'rgb(255, 208, 204)');
    }

    const dashboardDialog = await openDashboardMenu(page);
    await expect(dashboardDialog.getByRole('button', { name: 'Any extra details?' })).toHaveCount(
      3,
    );
    for (const activityId of [WARM_UP_ID, SUBURI_ID, ASHI_SABAKI_ID]) {
      await expect(
        activity(dashboardDialog, activityId).getByRole('button', { name: 'Any extra details?' }),
      ).toHaveCount(1);
    }
    await expect(
      activity(dashboardDialog, KIRIKAESHI_ID).getByRole('button', { name: 'Any extra details?' }),
    ).toHaveCount(0);

    const warmUp = activity(dashboardDialog, WARM_UP_ID);
    const toggle = warmUp.getByRole('button', { name: 'Any extra details?' });
    await expect(toggle).toHaveAttribute('type', 'button');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const panelId = await toggle.getAttribute('aria-controls');
    if (panelId === null) {
      throw new Error('The activity-note disclosure has no controlled panel.');
    }
    const panel = page.locator(`#${panelId}`);
    await expect(panel).toHaveAttribute('hidden', '');
    await expect(panel).toBeHidden();

    await toggle.press('Enter');
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveCSS('outline-width', '3px');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).not.toHaveAttribute('hidden');

    const textarea = warmUp.getByLabel('Extra notes for Warm-up');
    await expect(textarea).toBeVisible();
    const suburiToggle = activity(dashboardDialog, SUBURI_ID).getByRole('button', {
      name: 'Any extra details?',
    });
    await expect(suburiToggle).toHaveAttribute('aria-expanded', 'false');
    await textarea.fill('  Keep the knees soft.\nBreathe.  ');
    await textarea.blur();
    await expect(warmUp.getByText('Updated.')).toBeVisible();

    await suburiToggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(suburiToggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(suburiToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeHidden();
    await toggle.click();
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue('  Keep the knees soft.\nBreathe.  ');

    const quantity = warmUp.getByLabel('Minutes for Warm-up');
    await quantity.fill('12');
    await quantity.blur();
    await expect(quantity).toHaveValue('12');

    const sessionNotes = dashboardDialog.getByLabel('Practice notes');
    await sessionNotes.fill('General session note.');
    await sessionNotes.blur();
    await expect(sessionNotes).toHaveValue('General session note.');

    await textarea.fill('Saved with the explicit action.');
    const explicitSave = dashboardDialog.getByRole('button', { name: 'Save your changes' });
    await explicitSave.click();
    await expect(dashboardDialog.getByText('Changes saved on this device.')).toBeVisible();

    await quantity.fill('14');
    await explicitSave.click();
    await expect(quantity).toHaveValue('14');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toHaveAttribute('hidden', '');
    await expect(panel).toBeHidden();

    await toggle.click();
    await expect(textarea).toHaveValue('Saved with the explicit action.');

    const persisted = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    expect(persisted).toContain('Saved with the explicit action.');
    expect(persisted).toContain('General session note.');
    expect(persisted).toContain('"minutes":14');

    await page.reload();
    const reloadedDialog = await openDashboardMenu(page);
    const reloadedWarmUp = activity(reloadedDialog, WARM_UP_ID);
    const reloadedToggle = reloadedWarmUp.getByRole('button', { name: 'Any extra details?' });
    await expect(reloadedToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(reloadedWarmUp.getByLabel('Extra notes for Warm-up')).toHaveValue(
      'Saved with the explicit action.',
    );
    await expect(reloadedWarmUp.getByText('Note added')).toBeVisible();
    await expect(reloadedWarmUp.getByLabel('Minutes for Warm-up')).toHaveValue('14');
    await expect(reloadedDialog.getByLabel('Practice notes')).toHaveValue('General session note.');
    await expectNoBlockingAxeViolations(page);
  });

  test('keeps activity notes independent across duplicate entries and undo restoration', async ({
    page,
  }) => {
    await addInternationalDojoToDashboard(page);
    await addInternationalDojoToDashboard(page);

    const cards = page.locator('.dashboard-card--compact');
    await expect(cards).toHaveCount(2);
    const firstCard = cards.nth(0);
    const secondCard = cards.nth(1);

    await firstCard.getByRole('button', { name: 'View more' }).click();
    const firstDialog = page.getByRole('dialog', { name: 'International dojo menu' });
    const firstWarmUp = activity(firstDialog, WARM_UP_ID);
    await firstWarmUp.getByRole('button', { name: 'Any extra details?' }).click();
    const firstTextarea = firstWarmUp.getByLabel('Extra notes for Warm-up');
    await firstTextarea.fill('First dashboard entry.');
    await firstTextarea.blur();
    await expect(firstTextarea).toHaveValue('First dashboard entry.');
    await firstDialog
      .getByRole('button', {
        name: 'Close International dojo menu details.',
      })
      .click();

    await secondCard.getByRole('button', { name: 'View more' }).click();
    const secondDialog = page.getByRole('dialog', { name: 'International dojo menu' });
    const secondWarmUp = activity(secondDialog, WARM_UP_ID);
    await secondWarmUp.getByRole('button', { name: 'Any extra details?' }).click();
    const secondTextarea = secondWarmUp.getByLabel('Extra notes for Warm-up');
    await secondTextarea.fill('Second dashboard entry.');
    await secondTextarea.blur();
    await expect(secondTextarea).toHaveValue('Second dashboard entry.');
    await secondDialog
      .getByRole('button', {
        name: 'Close International dojo menu details.',
      })
      .click();

    await firstCard.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(cards).toHaveCount(2);
    await cards.nth(0).getByRole('button', { name: 'View more' }).click();
    const restoredFirstDialog = page.getByRole('dialog', { name: 'International dojo menu' });
    await expect(
      activity(restoredFirstDialog, WARM_UP_ID).getByLabel('Extra notes for Warm-up'),
    ).toHaveValue('First dashboard entry.');
    await restoredFirstDialog
      .getByRole('button', {
        name: 'Close International dojo menu details.',
      })
      .click();
    await cards.nth(1).getByRole('button', { name: 'View more' }).click();
    const restoredSecondDialog = page.getByRole('dialog', { name: 'International dojo menu' });
    await expect(
      activity(restoredSecondDialog, WARM_UP_ID).getByLabel('Extra notes for Warm-up'),
    ).toHaveValue('Second dashboard entry.');
  });

  test('remains keyboard usable and avoids mobile horizontal overflow with a note panel open', async ({
    page,
  }) => {
    await addInternationalDojoToDashboard(page);
    const dialog = await openDashboardMenu(page);
    const warmUp = activity(dialog, WARM_UP_ID);
    const toggle = warmUp.getByRole('button', { name: 'Any extra details?' });

    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const textarea = warmUp.getByLabel('Extra notes for Warm-up');
    await textarea.focus();
    await expect(textarea).toBeFocused();
    await page.keyboard.type('Keyboard note.');
    await page.keyboard.press('Tab');
    await expect(warmUp.getByText('Updated.')).toBeVisible();

    const viewport = page.viewportSize();
    if (viewport === null) {
      throw new Error('The browser viewport is unavailable.');
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `dashboard overflow at ${viewport.width}px`,
    ).toBeLessThanOrEqual(viewport.width);
    await expectNoBlockingAxeViolations(page);
  });

  test('keeps dashboard titles and compact quantity controls aligned across target widths', async ({
    page,
  }) => {
    await addInternationalDojoToDashboard(page);
    const dialog = await openDashboardMenu(page);
    const kihonWaza = activity(dialog, KIHON_WAZA_ID);
    await kihonWaza.locator(':scope > summary').click();
    await expect(kihonWaza).toHaveJSProperty('open', true);

    const warmUp = activity(dialog, WARM_UP_ID);
    const men = activity(dialog, KIHON_WAZA_MEN_ID);

    for (const width of [320, 375, 393, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await warmUp.scrollIntoViewIfNeeded();

      const standaloneMetrics = await warmUp.evaluate((element) => {
        const number = element.querySelector<HTMLElement>(':scope > .section-number');
        const title = element.querySelector<HTMLElement>(':scope > .detail-standalone-copy');
        const quantity = element.querySelector<HTMLElement>(':scope > .quantity-editor-group');
        const input = element.querySelector<HTMLInputElement>(
          ':scope > .quantity-editor-group input',
        );
        const unit = element.querySelector<HTMLElement>(
          ':scope > .quantity-editor-group .quantity-input-wrap > span',
        );
        const notesToggle = element.querySelector<HTMLElement>(
          ':scope > .activity-notes-editor .activity-notes-toggle',
        );
        if (
          number === null ||
          title === null ||
          quantity === null ||
          input === null ||
          unit === null ||
          notesToggle === null
        ) {
          throw new Error('The standalone dashboard activity layout is incomplete.');
        }

        const rowRect = element.getBoundingClientRect();
        const numberRect = number.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const quantityRect = quantity.getBoundingClientRect();
        const inputRect = input.getBoundingClientRect();
        const notesToggleRect = notesToggle.getBoundingClientRect();
        const overlapsVertically = (first: DOMRect, second: DOMRect) =>
          Math.min(first.bottom, second.bottom) > Math.max(first.top, second.top);

        return {
          numberSharesTitleRow: overlapsVertically(numberRect, titleRect),
          quantitySharesTitleRow: overlapsVertically(quantityRect, titleRect),
          titleClearsQuantity: titleRect.right <= quantityRect.left + 1,
          quantityRightInset: rowRect.right - quantityRect.right,
          notesBelowTitleRow:
            notesToggleRect.top >=
            Math.max(numberRect.bottom, titleRect.bottom, quantityRect.bottom) - 1,
          notesAlignedWithTitle: Math.abs(notesToggleRect.left - titleRect.left) <= 1,
          inputWidth: inputRect.width,
          unitWhiteSpace: getComputedStyle(unit).whiteSpace,
        };
      });

      expect(standaloneMetrics.numberSharesTitleRow, `standalone index at ${width}px`).toBe(true);
      expect(standaloneMetrics.quantitySharesTitleRow, `standalone quantity at ${width}px`).toBe(
        true,
      );
      expect(standaloneMetrics.titleClearsQuantity, `standalone overlap at ${width}px`).toBe(true);
      expect(
        standaloneMetrics.quantityRightInset,
        `standalone right edge at ${width}px`,
      ).toBeLessThanOrEqual(20);
      expect(standaloneMetrics.notesBelowTitleRow, `standalone notes row at ${width}px`).toBe(true);
      expect(standaloneMetrics.notesAlignedWithTitle, `standalone notes left at ${width}px`).toBe(
        true,
      );
      expect(
        standaloneMetrics.inputWidth,
        `standalone input width at ${width}px`,
      ).toBeLessThanOrEqual(40);
      expect(standaloneMetrics.unitWhiteSpace).toBe('nowrap');

      await men.scrollIntoViewIfNeeded();
      const childMetrics = await men.evaluate((element) => {
        const title = element.querySelector<HTMLElement>(':scope > .step-copy');
        const quantity = element.querySelector<HTMLElement>(':scope > .quantity-editor-group');
        const input = element.querySelector<HTMLInputElement>(
          ':scope > .quantity-editor-group input',
        );
        if (title === null || quantity === null || input === null) {
          throw new Error('The child dashboard exercise layout is incomplete.');
        }

        const rowRect = element.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const quantityRect = quantity.getBoundingClientRect();
        return {
          sharesRow:
            Math.min(titleRect.bottom, quantityRect.bottom) >
            Math.max(titleRect.top, quantityRect.top),
          titleClearsQuantity: titleRect.right <= quantityRect.left + 1,
          quantityRightInset: rowRect.right - quantityRect.right,
          inputWidth: input.getBoundingClientRect().width,
        };
      });

      expect(childMetrics.sharesRow, `child quantity at ${width}px`).toBe(true);
      expect(childMetrics.titleClearsQuantity, `child overlap at ${width}px`).toBe(true);
      expect(childMetrics.quantityRightInset, `child right edge at ${width}px`).toBeLessThanOrEqual(
        20,
      );
      expect(childMetrics.inputWidth, `child input width at ${width}px`).toBeLessThanOrEqual(40);

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, `dashboard overflow at ${width}px`).toBeLessThanOrEqual(width);
    }

    await page.setViewportSize({ width: 320, height: 900 });
    const minutes = warmUp.getByLabel('Minutes for Warm-up');
    await minutes.fill('');
    await minutes.pressSequentially('1234');
    await expect(minutes).toHaveValue('123');
    await expect(minutes).toHaveAccessibleDescription('Enter no more than three digits.');
  });
});
