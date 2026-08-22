import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'kendo-menu';

async function startFresh(page: Page): Promise<void> {
  await page.goto('/app/dashboard');
  await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
}

async function openNavigationIfNeeded(page: Page): Promise<void> {
  const menuToggle = page.getByRole('button', { name: 'Open navigation' });
  if (await menuToggle.isVisible()) {
    await menuToggle.click();
  }
}

test.describe('routed training flows', () => {
  test.beforeEach(async ({ page }) => {
    await startFresh(page);
  });

  test('opens the landing page, starts with the drill library, and returns home from the logo', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByRole('heading', { name: 'Plan the keiko you need today.', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.landing-page')).toBeVisible();
    const viewport = page.viewportSize();
    if (viewport !== null && viewport.width <= 760) {
      await expect(page.locator('.brand-name')).toBeHidden();

      const menuToggle = page.getByRole('button', { name: 'Open navigation' });
      const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
      await expect(menuToggle).toBeVisible();
      await expect(primaryNavigation).toBeHidden();
      await expect(page.locator('.session-status-label')).toBeHidden();

      await menuToggle.click();
      await expect(page.getByRole('button', { name: 'Close navigation' })).toBeVisible();
      await expect(primaryNavigation).toBeVisible();

      const openMenuScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(openMenuScrollWidth).toBeLessThanOrEqual(viewport.width);

      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
      await expect(primaryNavigation).toBeHidden();

      await menuToggle.click();
      await primaryNavigation.getByRole('link', { name: 'Dashboard', exact: true }).click();
      await expect(page).toHaveURL(/\/app\/dashboard$/);
      await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
      await page.goto('/app');
    } else {
      await expect(page.locator('.brand-name')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden();
      await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
      await expect(page.locator('.session-status-label')).toBeVisible();
    }

    const backgroundImage = await page
      .locator('.landing-page')
      .evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(backgroundImage).toContain('kendo-menu-hero.jpeg');

    await page.getByRole('link', { name: 'Browse drill library' }).click();
    await expect(page).toHaveURL(/\/app\/library$/);
    await page.locator('.top-bar').getByRole('link', { name: 'KendoMenu home' }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('shows the session-only cookie notice, links to its policy, and returns after reload', async ({
    page,
  }) => {
    const notice = page.getByRole('complementary', { name: 'Cookie notice' });
    await expect(notice).toContainText(
      'KendoMenu currently uses no cookies or third-party tracking. We may add privacy-friendly analytics in the future.',
    );
    await expect(notice.getByRole('link', { name: 'More information' })).toHaveAttribute(
      'href',
      '/cookies',
    );

    await notice.getByRole('link', { name: 'More information' }).click();
    await expect(page).toHaveURL(/\/cookies$/);
    await expect(page.getByRole('heading', { name: 'Cookie Policy', exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Cookie notice' })).toBeVisible();

    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByRole('complementary', { name: 'Cookie notice' })).toHaveCount(0);

    await openNavigationIfNeeded(page);
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Dashboard', exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await expect(page.getByRole('complementary', { name: 'Cookie notice' })).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(window.localStorage))).toEqual([]);

    await page.reload();
    await expect(page.getByRole('complementary', { name: 'Cookie notice' })).toBeVisible();
  });

  test('supports direct URLs, navigation, browser history, and reload', async ({ page }) => {
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();

    await openNavigationIfNeeded(page);
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: /Drill library/ })
      .click();
    await expect(page).toHaveURL(/\/app\/library$/);
    await expect(page.getByRole('heading', { name: 'Drill library' })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/app\/library$/);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Drill library' })).toBeVisible();

    await page.goto('/app/drills/new');
    await expect(page.getByRole('heading', { name: 'Create a drill' })).toBeVisible();
  });

  test('persists repetitions, notes, and an Undo restoration across reload', async ({ page }) => {
    await page.goto('/app/library');
    await page.getByRole('button', { name: 'Add to dashboard' }).click();
    await openNavigationIfNeeded(page);
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Dashboard', exact: true })
      .click();

    const repetitions = page.getByLabel(/repetitions for stretch/i);
    await expect(repetitions).toHaveValue('');
    await repetitions.fill('0');
    await repetitions.blur();
    await expect(repetitions).toHaveValue('0');

    const notes = page.getByLabel('Practice notes');
    await notes.fill('Keep the shoulders relaxed.');
    await notes.blur();

    await page.reload();
    await expect(page.getByLabel(/repetitions for stretch/i)).toHaveValue('0');
    await expect(page.getByLabel('Practice notes')).toHaveValue('Keep the shoulders relaxed.');

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('heading', { name: 'High School Kendo Club Drill' })).toHaveCount(
      0,
    );
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('heading', { name: 'High School Kendo Club Drill' })).toBeVisible();
  });

  test('prompts before browser Back discards a dirty draft, but dismiss keeps the draft', async ({
    page,
  }) => {
    await openNavigationIfNeeded(page);
    await page.getByRole('link', { name: 'Create a drill', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/drills\/new$/);
    const name = page.getByLabel('Drill name');
    await name.fill('Unfinished draft');

    const dismissedMessages: string[] = [];
    const dismissedDialogPromise = page.waitForEvent('dialog');
    const dismissedNavigationPromise = page
      .goBack({ waitUntil: 'commit', timeout: 5_000 })
      .catch(() => undefined);
    const dismissedDialog = await dismissedDialogPromise;
    dismissedMessages.push(dismissedDialog.message());
    expect(dismissedMessages).toEqual([
      'You have an unsaved drill draft. Leave this page and discard it?',
    ]);
    await dismissedDialog.dismiss();
    await dismissedNavigationPromise;
    await expect(page).toHaveURL(/\/app\/drills\/new$/);
    await expect(page.getByLabel('Drill name')).toHaveValue('Unfinished draft');

    const acceptedMessages: string[] = [];
    const acceptedDialogPromise = page.waitForEvent('dialog');
    const acceptedNavigationPromise = page.goBack({ waitUntil: 'commit', timeout: 5_000 });
    const acceptedDialog = await acceptedDialogPromise;
    acceptedMessages.push(acceptedDialog.message());
    expect(acceptedMessages).toEqual([
      'You have an unsaved drill draft. Leave this page and discard it?',
    ]);
    await acceptedDialog.accept();
    await acceptedNavigationPromise;
    await expect(page).toHaveURL(/\/app\/dashboard$/);
  });

  test('creates a custom drill atomically and keeps it on the dashboard after reload', async ({
    page,
  }) => {
    let unexpectedDialogMessage: string | null = null;
    page.on('dialog', async (dialog) => {
      unexpectedDialogMessage = dialog.message();
      await dialog.dismiss();
    });
    await page.goto('/app/drills/new');
    await page.getByLabel('Drill name').fill('Monday footwork');
    await page.getByLabel('Description (optional)').fill('A short solo session.');
    await page.getByLabel('Exercise name', { exact: true }).fill('Footwork');
    await page.getByLabel('Subexercise name', { exact: true }).fill('Big step forward and back');
    await page.getByLabel('Repetitions', { exact: true }).fill('24');
    await page.getByRole('button', { name: 'Save drill to dashboard' }).click();

    await expect(page).toHaveURL(/\/app\/dashboard\?created=Monday%20footwork$/);
    expect(unexpectedDialogMessage).toBeNull();
    await expect(page.getByRole('heading', { name: 'Monday footwork' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Monday footwork' })).toBeVisible();
    await expect(page.getByLabel('Repetitions for Big step forward and back')).toHaveValue('24');

    const persisted = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    expect(persisted).not.toBeNull();
  });
});
