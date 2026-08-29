import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const STORAGE_KEY = 'kendo-menu';
const INTERNATIONAL_DOJO_ID = 'international-dojo-2-hour-session';
const WARM_UP_ID = 'international-dojo-2-hour-session-warm-up-warm-up';
const SUBURI_ID = 'international-dojo-2-hour-session-suburi-suburi';
const ASHI_SABAKI_ID = 'international-dojo-2-hour-session-ashi-sabaki-ashi-sabaki';
const KIRIKAESHI_ID = 'international-dojo-2-hour-session-kirikaeshi-kirikaeshi';

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

    await toggle.press('Enter');
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveCSS('outline-width', '3px');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).not.toHaveAttribute('hidden');

    const textarea = warmUp.getByLabel('Extra notes for Warm-up');
    await expect(textarea).toBeVisible();
    await textarea.fill('  Keep the knees soft.\nBreathe.  ');
    await textarea.blur();
    await expect(warmUp.getByText('Updated.')).toBeVisible();

    const quantity = warmUp.getByLabel('Minutes for Warm-up');
    await quantity.fill('12');
    await quantity.blur();
    await expect(quantity).toHaveValue('12');

    const sessionNotes = dashboardDialog.getByLabel('Practice notes');
    await sessionNotes.fill('General session note.');
    await sessionNotes.blur();
    await expect(sessionNotes).toHaveValue('General session note.');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toHaveAttribute('hidden', '');

    const persisted = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    expect(persisted).toContain('Keep the knees soft.');
    expect(persisted).toContain('General session note.');
    expect(persisted).toContain('"minutes":12');

    await page.reload();
    const reloadedDialog = await openDashboardMenu(page);
    const reloadedWarmUp = activity(reloadedDialog, WARM_UP_ID);
    const reloadedToggle = reloadedWarmUp.getByRole('button', { name: 'Any extra details?' });
    await expect(reloadedToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(reloadedWarmUp.getByLabel('Extra notes for Warm-up')).toHaveValue(
      '  Keep the knees soft.\nBreathe.  ',
    );
    await expect(reloadedWarmUp.getByText('Note added')).toBeVisible();
    await expect(reloadedWarmUp.getByLabel('Minutes for Warm-up')).toHaveValue('12');
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
});
