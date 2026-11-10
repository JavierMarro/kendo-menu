import AxeBuilder from '@axe-core/playwright';
import { TRAINING_DATA_LIMITS } from '@kendo-menu/domain';
import { TRAINING_STORE_RAW_JSON_LIMIT } from '@kendo-menu/store';
import { expect, type Locator, type Page } from '@playwright/test';

import { test } from './guest-test';
import { SyntheticManagedHarness } from './synthetic-managed-harness';
import {
  BUILT_IN_EDIT_ENTRY_ID,
  CUSTOM_EDIT_DASHBOARD,
  CUSTOM_EDIT_ENTRY_ID,
  CUSTOM_EDIT_NAME,
  CUSTOM_EDIT_NOTES,
} from './custom-menu-edit-fixture';

const STORAGE_KEY = 'kendo-menu';
const GUEST_SOURCE = JSON.stringify(CUSTOM_EDIT_DASHBOARD);

async function openMenu(page: Page, name = CUSTOM_EDIT_NAME): Promise<Locator> {
  await page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .getByRole('button', { name: 'View more' })
    .click();
  const dialog = page.getByRole('dialog', { name, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function enterWorkspace(
  page: Page,
  kind: 'guest' | 'account',
): Promise<SyntheticManagedHarness> {
  const harness = await SyntheticManagedHarness.install(page, {
    initiallySignedIn: kind === 'account',
  });
  if (kind === 'account') harness.setDashboard(CUSTOM_EDIT_DASHBOARD, '1');
  await page.goto('/app');
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: STORAGE_KEY,
    value: GUEST_SOURCE,
  });
  await page.goto(`/app/${kind}/dashboard`);
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  const notice = page.getByRole('complementary', { name: 'Cookie notice' });
  if (await notice.isVisible()) await notice.getByRole('button', { name: 'Got it' }).click();
  return harness;
}

for (const kind of ['guest', 'account'] as const) {
  test(`${kind} edits a custom menu without losing current quantities or practice notes`, async ({
    page,
  }, testInfo) => {
    const harness = await enterWorkspace(page, kind);
    const dialog = await openMenu(page);
    const edit = dialog.getByRole('link', { name: 'Edit menu', exact: true });
    await edit.focus();
    await expect(edit).toBeFocused();
    await edit.press('Enter');
    await expect(page).toHaveURL(`/app/${kind}/drills/${CUSTOM_EDIT_ENTRY_ID}/edit`);
    await expect(page.getByRole('heading', { name: 'Edit menu', exact: true })).toBeVisible();
    await expect(page.getByLabel('Session name')).toHaveValue(CUSTOM_EDIT_NAME);
    await expect(page.getByLabel('Description (optional)')).toHaveValue('A short solo session.');
    await expect(page.getByLabel('Intensity (optional)')).toHaveValue('intense-drill');
    const firstActivity = page.getByRole('group', { name: 'Activity 1', exact: true });
    await expect(firstActivity.getByLabel('Activity name')).toHaveValue('Footwork');
    await expect(firstActivity.getByLabel('Repetitions', { exact: true })).toHaveValue('24');
    await expect(firstActivity.getByLabel('Duration', { exact: true })).toHaveValue('45');
    await expect(firstActivity.getByLabel('Duration unit')).toHaveValue('seconds');
    if (kind === 'guest') {
      const scan = await new AxeBuilder({ page }).analyze();
      expect(
        scan.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical'),
      ).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('custom-menu-edit.png'), fullPage: true });
    }
    const viewport = page.viewportSize();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport?.width ?? 0,
    );

    await page.getByLabel('Session name').fill('Updated evening practice');
    await firstActivity.getByLabel('Exercise name').first().fill('Men suburi');
    await firstActivity.getByRole('button', { name: 'Remove exercise' }).nth(1).click();
    await firstActivity.getByRole('button', { name: 'Add exercise' }).click();
    await firstActivity.getByLabel('Exercise name').nth(1).fill('Kote');
    await firstActivity.getByLabel('Repetitions', { exact: true }).nth(1).fill('20');
    await page
      .getByRole('group', { name: 'Activity 2', exact: true })
      .getByRole('button', { name: 'Remove activity' })
      .click();
    await page.getByRole('button', { name: 'Add activity', exact: true }).click();
    const secondActivity = page.getByRole('group', { name: 'Activity 2', exact: true });
    await secondActivity.getByLabel('Activity name').fill('Keiko');
    await secondActivity.getByRole('button', { name: 'Add exercise' }).click();
    await secondActivity.getByLabel('Exercise name').fill('Kirikaeshi');
    await secondActivity.getByLabel('Measurement').selectOption('duration');
    await secondActivity.getByLabel('Duration', { exact: true }).fill('3.5');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page).toHaveURL(`/app/${kind}/dashboard`);
    await expect(
      page.getByRole('heading', { name: 'Updated evening practice', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'View more' })).toHaveCount(2);

    expect(harness.apiCalls.filter((call) => call.method === 'PUT')).toHaveLength(0);
    if (kind === 'account') {
      await expect(page.getByText('Unsaved account draft', { exact: true })).toBeVisible();
      expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(
        GUEST_SOURCE,
      );
      await page.getByRole('button', { name: 'Save to account', exact: true }).click();
      await expect(page.getByText('Saved to account', { exact: true })).toBeVisible();
      expect(harness.apiCalls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    }
    await page.reload();
    const updated = await openMenu(page, 'Updated evening practice');
    await expect(updated.getByLabel('Practice notes')).toHaveValue(CUSTOM_EDIT_NOTES);
    for (const section of await updated.locator('details.detail-section').all()) {
      await section.locator(':scope > summary').click();
    }
    await expect(updated.getByLabel('Repetitions for Men suburi')).toHaveValue('24');
    await expect(updated.getByLabel('Repetitions for Kote')).toHaveValue('20');
    await expect(updated.getByLabel('Minutes for Kirikaeshi')).toHaveValue('3.5');
    await expect(updated.getByText('Keep wrists soft.', { exact: true })).toBeVisible();
    await expect(updated.getByText('Jigeiko', { exact: true })).toHaveCount(0);
    await expect(updated.getByText('Cool-down', { exact: true })).toHaveCount(0);
  });

  test(`${kind} cancels structural edits and protects library menus from the editor`, async ({
    page,
  }) => {
    const harness = await enterWorkspace(page, kind);
    const before = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    const dialog = await openMenu(page);
    await dialog.getByRole('link', { name: 'Edit menu', exact: true }).click();
    await page.getByLabel('Session name').fill('Discard this name');
    await page.getByRole('button', { name: 'Add activity', exact: true }).click();
    const dismissWarning = page.waitForEvent('dialog');
    const firstCancel = page.getByRole('link', { name: 'Cancel', exact: true }).click();
    const dismissed = await dismissWarning;
    expect(dismissed.message()).toMatch(/draft/i);
    await dismissed.dismiss();
    await firstCancel;
    await expect(page.getByLabel('Session name')).toHaveValue('Discard this name');
    const acceptWarning = page.waitForEvent('dialog');
    const secondCancel = page.getByRole('link', { name: 'Cancel', exact: true }).click();
    const accepted = await acceptWarning;
    expect(accepted.message()).toMatch(/draft/i);
    await accepted.accept();
    await secondCancel;
    await expect(page).toHaveURL(`/app/${kind}/dashboard`);
    await expect(page.getByRole('heading', { name: CUSTOM_EDIT_NAME, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Discard this name', exact: true })).toHaveCount(
      0,
    );
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(before);
    expect(harness.apiCalls.filter((call) => call.method === 'PUT')).toHaveLength(0);

    const builtIn = await openMenu(page, 'International dojo menu');
    await expect(builtIn.getByRole('link', { name: 'Edit menu', exact: true })).toHaveCount(0);
    await page.goto(`/app/${kind}/drills/${BUILT_IN_EDIT_ENTRY_ID}/edit`);
    await expect(page.getByLabel('Session name')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0);
    await page.goto(`/app/${kind}/drills/missing-entry/edit`);
    await expect(page.getByLabel('Session name')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(before);
  });
}

test('guest detail Save reports rejected edits until they fit the dashboard limit', async ({
  page,
}) => {
  const sections = Array.from({ length: 3 }, (_, group) => ({
    id: `group-${group}`,
    name: `Group ${group}`,
    exercises: Array.from({ length: 88 }, (_, exercise) => ({
      id: `exercise-${group}-${exercise}`,
      name: `Exercise ${exercise}`,
      notes: '',
    })),
  }));
  const envelope = {
    version: 11,
    state: {
      dashboardEntries: [
        {
          id: 'editable',
          trainingSetId: 'international-dojo-2-hour-session',
          notes: '',
          quantityOverrides: {},
          activityNotes: {},
          createdAt: '2026-10-22T12:00:00.000Z',
        },
        {
          id: 'filler',
          trainingSetId: 'custom-filler',
          trainingSet: {
            id: 'custom-filler',
            name: 'Audit 稽古',
            category: 'custom',
            isBuiltIn: false,
            sections,
          },
          notes: '',
          quantityOverrides: {},
          activityNotes: {},
          createdAt: '2026-10-22T12:00:00.000Z',
        },
      ],
    },
  };
  const targetLength = TRAINING_STORE_RAW_JSON_LIMIT - 8;
  let remaining = targetLength - JSON.stringify(envelope).length;
  for (const exercise of sections.flatMap((section) => section.exercises)) {
    const length = Math.min(remaining, TRAINING_DATA_LIMITS.noteCharacters);
    exercise.notes = 'x'.repeat(length);
    remaining -= length;
  }
  const raw = JSON.stringify(envelope);
  expect(raw.length).toBe(targetLength);
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.goto('/app/guest/dashboard');
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: STORAGE_KEY, raw });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  const notice = page.getByRole('complementary', { name: 'Cookie notice' });
  if (await notice.isVisible()) await notice.getByRole('button', { name: 'Got it' }).click();

  const dialog = await openMenu(page, 'International dojo menu');
  const notes = dialog.getByLabel('Practice notes');
  const save = dialog.getByRole('button', { name: 'Save your changes' });
  const error = dialog.getByRole('alert').filter({ hasText: 'A change could not be saved.' });
  const saved = dialog.getByText('Changes saved on this device.', { exact: true });
  await notes.fill('A note that does not fit.');
  await save.click();
  await expect(error).toBeVisible();
  await expect(saved).toHaveCount(0);
  await expect(notes).toHaveValue('A note that does not fit.');
  expect(
    await page.evaluate(({ key, raw }) => localStorage.getItem(key) === raw, {
      key: STORAGE_KEY,
      raw,
    }),
  ).toBe(true);

  const minutes = dialog.getByLabel('Minutes for Warm-up', { exact: true });
  await minutes.fill('12');
  const warmUp = dialog.getByRole('region', { name: 'Warm-up', exact: true });
  await warmUp.getByRole('button', { name: 'Any extra details?' }).click();
  const activityNotes = warmUp.getByLabel('Extra notes for Warm-up');
  await activityNotes.fill('This activity note does not fit either.');
  await notes.fill('OK');
  await save.click();
  await expect(error).toBeVisible();
  await expect(saved).toHaveCount(0);
  await minutes.fill('10');
  await save.click();
  await expect(error).toBeVisible();
  await expect(saved).toHaveCount(0);
  await activityNotes.fill('');
  await save.click();
  await expect(error).toHaveCount(0);
  await expect(saved).toBeVisible();

  await page.reload();
  const reloaded = await openMenu(page, 'International dojo menu');
  await expect(reloaded.getByLabel('Practice notes')).toHaveValue('OK');
  await expect(reloaded.getByLabel('Minutes for Warm-up', { exact: true })).toHaveValue('10');
  expect(pageErrors).toEqual([]);
});

test('an unfinished account menu edit survives offline and reconnect without saving', async ({
  page,
  context,
}) => {
  const harness = await enterWorkspace(page, 'account');
  const dialog = await openMenu(page);
  await dialog.getByRole('link', { name: 'Edit menu', exact: true }).click();
  await page.getByLabel('Session name').fill('Retained account form');
  const activity = page.getByRole('group', { name: 'Activity 1', exact: true });
  await activity.getByRole('button', { name: 'Add exercise' }).click();
  await activity.getByLabel('Exercise name').nth(2).fill('Retained kirikaeshi');
  await activity.getByLabel('Repetitions', { exact: true }).nth(1).fill('15');
  await context.setOffline(true);
  try {
    await expect(page.getByRole('heading', { name: 'Account service unavailable' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Session name')).toHaveValue('Retained account form');
  } finally {
    await context.setOffline(false);
  }
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Session name')).toHaveValue('Retained account form');
  await expect(activity.getByLabel('Exercise name').nth(2)).toHaveValue('Retained kirikaeshi');
  expect(harness.apiCalls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page).toHaveURL('/app/account/dashboard');
  await page.getByRole('button', { name: 'Save to account', exact: true }).click();
  await expect(page.getByText('Saved to account', { exact: true })).toBeVisible();
  await page.reload();
  const saved = await openMenu(page, 'Retained account form');
  await saved.locator('details.detail-section').first().locator(':scope > summary').click();
  await expect(saved.getByLabel('Repetitions for Retained kirikaeshi')).toHaveValue('15');
});

test('a pending account save cannot replace a newer structural custom-menu edit', async ({
  page,
}) => {
  const harness = await enterWorkspace(page, 'account');
  const dialog = await openMenu(page);
  await dialog.getByLabel('Practice notes').fill('A note submitted before the structural edit.');
  await dialog.getByRole('button', { name: /^Close / }).click();
  const held = harness.holdNextSave();
  await page.getByRole('button', { name: 'Save to account', exact: true }).click();
  await held.observed;
  try {
    const menu = await openMenu(page);
    await menu.getByRole('link', { name: 'Edit menu', exact: true }).click();
    await page.getByLabel('Session name').fill('Edited during save');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page).toHaveURL('/app/account/dashboard');
  } finally {
    held.respond();
  }
  await expect(page.getByText('Unsaved account draft', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Edited during save', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save to account', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save to account', exact: true }).click();
  await expect(page.getByText('Saved to account', { exact: true })).toBeVisible();
  await page.reload();
  const saved = await openMenu(page, 'Edited during save');
  await expect(saved.getByLabel('Practice notes')).toHaveValue(
    'A note submitted before the structural edit.',
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(GUEST_SOURCE);
});
