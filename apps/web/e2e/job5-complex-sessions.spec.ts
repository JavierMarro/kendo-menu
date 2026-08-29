import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const UNIVERSITY_HIGH_SCHOOL = 'university-high-school';
const TOP_UNIVERSITY = 'top-university';
const UNIVERSITY_KEN_TORE = 'university-high-school-ken-tore-circuit';
const UNIVERSITY_STATION_A = 'university-high-school-ken-tore-circuit-station-a';
const UNIVERSITY_STATION_B = 'university-high-school-ken-tore-circuit-station-b';
const UNIVERSITY_STATION_A_KIRIKAESHI = 'university-high-school-ken-tore-circuit-kirikaeshi';
const TOP_SANDAN = 'top-university-sandan-geiko';
const TOP_YAKUSOKU = 'top-university-yakusoku-geiko';
const TOP_FREE = 'top-university-fee-version';
const TOP_FREE_UCHIKOMI = 'top-university-fee-version-uchikomi-geiko';
const TOP_FREE_KAKARIGEIKO = 'top-university-fee-version-kakari-geiko';
const TOP_FINAL_KAKARIGEIKO = 'top-university-kakarigeiko-kakarigeiko';

function activity(page: Page, id: string): Locator {
  return page.locator(`[data-activity-id="${id}"]`);
}

async function expectNoBlockingAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([]);
}

async function openNestedDetails(container: Locator): Promise<Locator> {
  const tagName = await container.evaluate((element) => element.tagName.toLowerCase());
  const details = tagName === 'details' ? container : container.locator(':scope > details');
  await details.locator(':scope > summary').click();
  await expect(details).toHaveJSProperty('open', true);
  return details;
}

test.describe('Job 5 complex curated sessions', () => {
  test('exposes the ordered University stations and Top University branches', async ({ page }) => {
    await page.goto(`/app/library?drill=${UNIVERSITY_HIGH_SCHOOL}`);
    const universityDialog = page.getByRole('dialog', {
      name: 'University High School dojo menu',
    });
    const kenTore = activity(page, UNIVERSITY_KEN_TORE);
    await openNestedDetails(kenTore);

    const stationA = activity(page, UNIVERSITY_STATION_A);
    const stationB = activity(page, UNIVERSITY_STATION_B);
    const stationADetails = stationA.locator(':scope > details');
    const stationBDetails = stationB.locator(':scope > details');
    await expect(stationADetails.locator(':scope > summary')).toHaveAccessibleName(
      'Station A 4 exercises',
    );
    await expect(stationBDetails.locator(':scope > summary')).toHaveAccessibleName(
      'Station B 4 exercises',
    );
    await expect(stationA.locator('input')).toHaveCount(0);
    await expect(stationB.locator('input')).toHaveCount(0);
    await openNestedDetails(stationA);
    await openNestedDetails(stationB);
    await expect(stationA).toContainText('Left-right Dō-kirikaeshi');
    await expect(stationB).toContainText('Dō');
    await expect(stationA.locator('summary')).toHaveCount(1);
    await expect(stationB.locator('summary')).toHaveCount(1);
    await expect(universityDialog.locator('[data-activity-id]')).toHaveCount(31);
    await expectNoBlockingAxeViolations(page);

    await page.goto(`/app/library?drill=${TOP_UNIVERSITY}`);
    const topDialog = page.getByRole('dialog', { name: 'Top university dojo menu' });
    const sandan = activity(page, TOP_SANDAN);
    const sandanDetails = await openNestedDetails(sandan);
    await expect(sandanDetails.locator(':scope > summary')).toHaveAccessibleName(
      'Sandan-geiko 3 activities',
    );
    const yakusoku = activity(page, TOP_YAKUSOKU);
    const free = activity(page, TOP_FREE);
    const yakusokuDetails = yakusoku.locator(':scope > details');
    const freeDetails = free.locator(':scope > details');
    await expect(yakusokuDetails.locator(':scope > summary')).toHaveAccessibleName(
      'Yakusoku-geiko 4 exercises',
    );
    await expect(freeDetails.locator(':scope > summary')).toHaveAccessibleName(
      'Free version 2 exercises',
    );
    await openNestedDetails(yakusoku);
    await openNestedDetails(free);
    await expect(topDialog).toContainText('Hiki-dō → Men → 100 Kirikaeshi strikes');
    await expect(topDialog).toContainText('Uchikomi');
    await expect(topDialog).toContainText('Kakarigeiko');
    await expect(topDialog.locator('[data-activity-id]')).toHaveCount(17);
    await expectNoBlockingAxeViolations(page);
  });

  test('edits Station, Free-version, and final Kakarigeiko leaves on the dashboard', async ({
    page,
  }) => {
    await page.goto(`/app/library?drill=${UNIVERSITY_HIGH_SCHOOL}`);
    await page.getByRole('button', { name: 'Add to dashboard' }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'View dashboard' }).click();

    const stationA = activity(page, UNIVERSITY_STATION_A);
    const stationB = activity(page, UNIVERSITY_STATION_B);
    await expect(
      stationA.locator(':scope > .training-step--standalone .quantity-editor-group'),
    ).toHaveCount(0);
    await expect(
      stationB.locator(':scope > .training-step--standalone .quantity-editor-group'),
    ).toHaveCount(0);
    const stationLeaf = activity(page, UNIVERSITY_STATION_A_KIRIKAESHI);
    const stationSeconds = stationLeaf.getByLabel('Seconds for Kirikaeshi');
    await expect(stationSeconds).toHaveValue('30');
    await stationSeconds.fill('45');
    await stationSeconds.blur();
    await expect(stationSeconds).toHaveValue('45');

    await page.goto(`/app/library?drill=${TOP_UNIVERSITY}`);
    await page.getByRole('button', { name: 'Add to dashboard' }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'View dashboard' }).click();

    const freeUchikomi = activity(page, TOP_FREE_UCHIKOMI);
    const freeKakarigeiko = activity(page, TOP_FREE_KAKARIGEIKO);
    const finalKakarigeiko = activity(page, TOP_FINAL_KAKARIGEIKO);
    const uchikomiSeconds = freeUchikomi.getByLabel('Seconds for Uchikomi');
    const freeKakarigeikoSeconds = freeKakarigeiko.getByLabel('Seconds for Kakarigeiko');
    const finalKakarigeikoSeconds = finalKakarigeiko.getByLabel('Seconds for Kakarigeiko');

    await expect(uchikomiSeconds).toHaveValue('');
    await expect(freeKakarigeikoSeconds).toHaveValue('');
    await expect(finalKakarigeikoSeconds).toHaveValue('');
    await uchikomiSeconds.fill('20');
    await uchikomiSeconds.blur();
    await freeKakarigeikoSeconds.fill('30');
    await freeKakarigeikoSeconds.blur();
    await finalKakarigeikoSeconds.fill('60');
    await finalKakarigeikoSeconds.blur();
    await expect(uchikomiSeconds).toHaveValue('20');
    await expect(freeKakarigeikoSeconds).toHaveValue('30');
    await expect(finalKakarigeikoSeconds).toHaveValue('60');

    await page.reload();
    await expect(
      page.locator(`[data-activity-id="${TOP_FREE_UCHIKOMI}"]`).getByLabel('Seconds for Uchikomi'),
    ).toHaveValue('20');
    await expect(
      page
        .locator(`[data-activity-id="${TOP_FREE_KAKARIGEIKO}"]`)
        .getByLabel('Seconds for Kakarigeiko'),
    ).toHaveValue('30');
    await expect(
      page
        .locator(`[data-activity-id="${TOP_FINAL_KAKARIGEIKO}"]`)
        .getByLabel('Seconds for Kakarigeiko'),
    ).toHaveValue('60');
    await expectNoBlockingAxeViolations(page);
  });
});
