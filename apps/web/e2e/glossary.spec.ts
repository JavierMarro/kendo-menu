import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { test } from './guest-test';
import {
  COOKIE_NOTICE_ACKNOWLEDGEMENT_DURATION_MS,
  COOKIE_NOTICE_ACKNOWLEDGEMENT_STORAGE_KEY,
} from '../src/lib/cookie-notice';

test('glossary supports direct entry, FAQ navigation, keyboard search, reload and accessible mobile layout', async ({
  page,
}, testInfo) => {
  await page.addInitScript(
    ({ key, duration }) => window.localStorage.setItem(key, String(Date.now() + duration)),
    {
      key: COOKIE_NOTICE_ACKNOWLEDGEMENT_STORAGE_KEY,
      duration: COOKIE_NOTICE_ACKNOWLEDGEMENT_DURATION_MS,
    },
  );
  await page.goto('/app/glossary');
  await expect(page.getByRole('heading', { name: 'Glossary', exact: true })).toBeVisible();
  const footer = page.getByRole('contentinfo');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page).toHaveTitle('Glossary · KendoMenu');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://www.kendomenu.com/app/glossary',
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    'content',
    'https://www.kendomenu.com/app/glossary',
  );
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await page.keyboard.press('Tab');
  const search = page.getByRole('searchbox', { name: 'Find a term' });
  await expect(search).toBeFocused();
  await expect(search).toHaveCSS('outline-style', 'solid');
  await search.fill('kote men');
  await expect(page.locator('dt').filter({ hasText: /^Kote-men$/ })).toBeVisible();
  await search.fill('zzzzzz');
  await expect(page.getByText(/No terms match/)).toBeVisible();
  await search.fill('');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Glossary', exact: true })).toBeVisible();
  await expect(search).toHaveValue('');
  await expect(page.locator('dt').filter({ hasText: /^Kirikaeshi$/ })).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath(`glossary-${testInfo.project.name}.png`) });
  await page
    .getByRole('navigation', { name: 'Glossary letters' })
    .getByRole('link', { name: 'K', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'K', exact: true })).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath(`glossary-entries-${testInfo.project.name}.png`),
  });
  await footer.getByRole('link', { name: 'FAQ', exact: true }).click();
  await page
    .getByRole('button', { name: 'Is KendoMenu useful for all experience levels?' })
    .click();
  const answer = page.getByRole('region', {
    name: 'Is KendoMenu useful for all experience levels?',
  });
  const faqLink = answer.getByRole('link', { name: 'Glossary', exact: true });
  await expect(faqLink).toHaveCSS('color', 'rgb(223, 182, 91)');
  await expect(faqLink).toHaveCSS('text-decoration-line', 'underline');
  await faqLink.click();
  await expect(page).toHaveURL('/app/glossary');
  await expect(page.getByRole('main')).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/app#faq-title$/);
});
