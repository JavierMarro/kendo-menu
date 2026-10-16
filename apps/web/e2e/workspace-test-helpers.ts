import { type Locator, type Page } from '@playwright/test';

export function workspaceNavigation(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Workspace navigation' });
}

export function workspaceLink(page: Page, name: string): Locator {
  return workspaceNavigation(page).getByRole('link', { name, exact: true });
}

export async function visibleWorkspaceBrandLink(page: Page): Promise<Locator> {
  const isMobile = await page.evaluate(() => matchMedia('(max-width: 960px)').matches);
  return page
    .locator(isMobile ? '.workspace-mobile-brand' : '.workspace-desktop-brand')
    .getByRole('link', { name: 'KendoMenu home', exact: true });
}

export async function openUserOptions(page: Page): Promise<Locator> {
  const options = page.getByRole('region', { name: 'User options' });
  if (!(await options.isVisible())) {
    await workspaceNavigation(page).getByRole('button', { name: 'User', exact: true }).click();
  }
  return options;
}

export async function clickGuestSignUp(page: Page): Promise<void> {
  const options = await openUserOptions(page);
  await options.getByRole('link', { name: 'Sign up', exact: true }).click();
}

export async function startGuestGoogleSignUp(page: Page): Promise<void> {
  if (!/\/app\/sign-in$/.test(new URL(page.url()).pathname)) {
    await clickGuestSignUp(page);
    await page.waitForURL(/\/app\/sign-in$/);
  }
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
}

export async function clickWorkspaceSignOut(page: Page): Promise<void> {
  const options = await openUserOptions(page);
  await options.getByRole('button', { name: 'Sign out', exact: true }).click();
}
