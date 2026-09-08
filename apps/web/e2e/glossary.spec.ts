import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('glossary supports footer and FAQ navigation, keyboard search, reload and accessible mobile layout', async ({
  page,
}, testInfo) => {
  await page.goto('/app');
  const notice = page.getByRole('button', { name: 'Got it', exact: true });
  if (await notice.isVisible()) await notice.click();
  const footer = page.getByRole('contentinfo');
  await footer.getByRole('link', { name: 'Cookies', exact: true }).focus();
  await page.keyboard.press('Tab');
  const glossaryLink = footer.getByRole('link', { name: 'Glossary', exact: true });
  await expect(glossaryLink).toBeFocused();
  await expect(glossaryLink).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/app/glossary');
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
