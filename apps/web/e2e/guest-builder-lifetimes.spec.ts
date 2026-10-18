import { expect, type Dialog, type Page } from '@playwright/test';

import { test } from './guest-test';
import { SyntheticManagedHarness } from './synthetic-managed-harness';
import { clickGuestSignUp, startGuestGoogleSignUp, workspaceLink } from './workspace-test-helpers';

async function addGuestMenu(page: Page): Promise<void> {
  await page.goto('/app/guest/library');
  const card = page
    .getByRole('heading', { name: 'Senior High School dojo menu' })
    .locator('xpath=ancestor::article');
  await card.getByRole('link', { name: 'View session' }).click();
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'View dashboard' }).click();
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(1);
}

async function addPendingPracticeNote(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'View more' }).first().click();
  const notes = page.getByLabel('Practice notes');
  await notes.fill('Pending write for the guest transition fence.');
  await notes.press('Tab');
  await page.getByRole('button', { name: /Close .* details/i }).click();
}

async function openBuilder(page: Page): Promise<void> {
  await page
    .getByRole('main')
    .getByRole('link', { name: /Create (new menu|a training session)/i })
    .click();
  await expect(page.getByRole('heading', { name: 'Create a training session' })).toBeVisible();
}

async function openDashboardNavigation(page: Page): Promise<void> {
  await workspaceLink(page, 'Dashboard').click();
}

for (const completion of ['Try again', 'Continue without saving', 'Reset local data'] as const) {
  test(`quota recovery retains unfinished guest input after ${completion} and confirms departure`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const storage = window.localStorage;
      const setItem = storage.setItem.bind(storage);
      Object.defineProperty(storage, 'setItem', {
        configurable: true,
        value: (name: string, value: string) => {
          if (name === 'kendo-menu') throw new DOMException('quota fault', 'QuotaExceededError');
          setItem(name, value);
        },
      });
    });
    await addGuestMenu(page);
    await expect(page.getByRole('heading', { name: 'Changes are not saved' })).toBeVisible();
    await openBuilder(page);
    await page.getByLabel('Session name').fill('Recovery keeps this input');

    await page.getByRole('button', { name: 'Open recovery options' }).click();
    await expect(
      page.getByRole('heading', { name: /recent changes are not saved/i }),
    ).toBeVisible();
    await expect(page.locator('form.builder-form')).not.toBeVisible();
    await expect(
      page.locator('form.builder-form').locator('xpath=ancestor::div[@inert]').first(),
    ).toHaveAttribute('inert', '');
    if (completion === 'Reset local data') {
      await page
        .getByRole('complementary', { name: 'Cookie notice' })
        .getByRole('button', { name: 'Got it', exact: true })
        .click();
      await page.getByRole('button', { name: completion, exact: true }).click();
      const resetDialog = page.getByRole('alertdialog');
      await resetDialog.getByRole('button', { name: 'Keep my data' }).click();
      await expect(page.locator('#drill-name')).toHaveValue('Recovery keeps this input');
      await page.getByRole('button', { name: completion, exact: true }).click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: completion, exact: true })
        .click();
    } else {
      await page.getByRole('button', { name: completion, exact: true }).click();
    }
    const sessionName = page.getByLabel('Session name');
    await expect(sessionName).toHaveValue('Recovery keeps this input');
    expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBeNull();

    const confirmations: string[] = [];
    const dismiss = async (dialog: Dialog) => {
      confirmations.push(dialog.message());
      await dialog.dismiss();
    };
    page.on('dialog', dismiss);
    await openDashboardNavigation(page);
    await expect.poll(() => confirmations.length).toBe(1);
    await expect(page).toHaveURL(/\/app\/guest\/drills\/new$/);
    await expect(sessionName).toHaveValue('Recovery keeps this input');

    page.off('dialog', dismiss);
    page.once('dialog', (dialog) => void dialog.accept());
    await openDashboardNavigation(page);
    await expect(page).toHaveURL(/\/app\/guest\/dashboard$/);
    await expect(page.locator('.dashboard-card--compact')).toHaveCount(
      completion === 'Reset local data' ? 0 : 1,
    );
    await openBuilder(page);
    await expect(page.getByLabel('Session name')).toHaveValue('');
  });
}

test('verified account transition retains a hidden guest builder draft until explicit discard and leaves guest data untouched', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page);
  await addGuestMenu(page);
  await openBuilder(page);
  const sessionName = page.getByLabel('Session name');
  await sessionName.fill('Keep this guest-only draft');
  const guestDataBeforeIdentityCheck = await page.evaluate(() =>
    localStorage.getItem('kendo-menu'),
  );

  harness.setSignedIn(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const accountTransition = page.getByRole('button', { name: 'Continue to account' });
  await expect(accountTransition).toBeVisible();
  const builder = page.locator('form.builder-form');
  await expect(builder).toHaveAttribute('inert', '');
  await expect(builder).not.toBeVisible();
  await expect(sessionName).toBeDisabled();

  const confirmations: string[] = [];
  const dismiss = async (dialog: Dialog) => {
    confirmations.push(dialog.message());
    await dialog.dismiss();
  };
  page.on('dialog', dismiss);
  await accountTransition.focus();
  await expect(accountTransition).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => confirmations.length).toBe(1);
  await expect(page).toHaveURL(/\/app\/guest\/drills\/new$/);
  await expect(sessionName).toHaveValue('Keep this guest-only draft');

  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(
    guestDataBeforeIdentityCheck,
  );
  page.off('dialog', dismiss);
  page.on('dialog', async (dialog) => {
    confirmations.push(dialog.message());
    await dialog.accept();
  });
  await accountTransition.click();
  await expect(page).toHaveURL(/\/app\/account\/drills\/new$/);
  expect(confirmations).toHaveLength(2);
  await expect(page.getByLabel('Session name')).toHaveValue('');
  const dashboardCall = harness.apiCalls.find(
    (call) => call.method === 'GET' && call.path === '/api/dashboard',
  );
  expect(dashboardCall).toBeDefined();
  expect(harness.apiCalls.some((call) => call.method === 'POST')).toBe(false);
  await openDashboardNavigation(page);
  await expect(page.getByRole('heading', { name: 'Your dashboard is ready.' })).toBeVisible();
  await expect(page.locator('.dashboard-card--compact')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(
    guestDataBeforeIdentityCheck,
  );
  expect(harness.apiCalls.some((call) => call.method === 'PUT')).toBe(false);
});

test('canceling Google entry keeps the guest builder and does not start authentication', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page);
  await addGuestMenu(page);
  await openBuilder(page);
  await page.getByLabel('Session name').fill('Guest draft before Google');
  const guestData = await page.evaluate(() => localStorage.getItem('kendo-menu'));
  const confirmations: string[] = [];
  page.on('dialog', async (dialog) => {
    confirmations.push(dialog.message());
    await dialog.dismiss();
  });
  await clickGuestSignUp(page);
  await expect.poll(() => confirmations.length).toBe(1);
  await expect(page.getByLabel('Session name')).toHaveValue('Guest draft before Google');
  await expect(page).toHaveURL(/\/app\/guest\/drills\/new$/);
  expect(harness.authCalls.some((url) => url.includes('/sign-in/social'))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestData);
});

test('confirmed Google departure does not ask again at beforeunload', async ({ page }) => {
  const harness = await SyntheticManagedHarness.install(page);
  await addGuestMenu(page);
  await openBuilder(page);
  await page.getByLabel('Session name').fill('Explicitly discarded on departure');
  const guestData = await page.evaluate(() => localStorage.getItem('kendo-menu'));
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.type());
    if (dialog.type() === 'confirm') await dialog.accept();
    else await dialog.dismiss();
  });
  await startGuestGoogleSignUp(page);
  await expect(page).toHaveURL(/\/app\/account\/dashboard$/);
  expect(dialogs).toEqual(['confirm']);
  expect(harness.authCalls.filter((url) => url.includes('/sign-in/social'))).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestData);
});

for (const failure of ['provider', 'readback'] as const) {
  test(`failed Google ${failure} handling preserves the guest source and permits retry`, async ({
    page,
  }) => {
    const harness = await SyntheticManagedHarness.install(page);
    await addGuestMenu(page);
    await openBuilder(page);
    await page.getByLabel('Session name').fill('Retry keeps this draft');
    const guestData = await page.evaluate(() => localStorage.getItem('kendo-menu'));
    if (failure === 'provider') {
      await page.route('**/sign-in/social', (route) =>
        route.fulfill({ status: 503, json: { message: 'Synthetic provider failure' } }),
      );
    } else {
      await page.evaluate(() => {
        const original = window.localStorage.getItem.bind(window.localStorage);
        window.localStorage.getItem = function (key: string) {
          if (key === 'kendo-menu') throw new Error('Synthetic readback failure');
          return original(key);
        };
        window.addEventListener(
          'restore-test-readback',
          () => {
            window.localStorage.getItem = original;
          },
          { once: true },
        );
      });
    }
    page.on('dialog', (dialog) => void dialog.accept());
    await clickGuestSignUp(page);
    if (failure === 'provider') {
      await expect(page).toHaveURL(/\/app\/sign-in$/);
      await page.getByRole('button', { name: 'Continue with Google' }).click();
      await expect(page.getByRole('alert')).toContainText('Google sign-in could not be started');
      expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestData);
      await page.unroute('**/sign-in/social');
      await startGuestGoogleSignUp(page);
    } else {
      await expect(page.getByRole('alert')).toContainText('could not confirm your guest dashboard');
      await expect(page.getByLabel('Session name')).toHaveValue('Retry keeps this draft');
      expect(
        await page.evaluate(() => {
          const event = new Event('beforeunload', { cancelable: true });
          window.dispatchEvent(event);
          return event.defaultPrevented;
        }),
      ).toBe(true);
      await page.evaluate(() => window.dispatchEvent(new Event('restore-test-readback')));
      await startGuestGoogleSignUp(page);
    }
    await expect(page).toHaveURL(/\/app\/account\/dashboard$/);
    expect(harness.authCalls.some((url) => url.includes('/sign-in/social'))).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestData);
  });
}

for (const workspace of ['dashboard', 'library'] as const) {
  test(`verified identity closes the guest ${workspace} portal when durability fails`, async ({
    page,
  }) => {
    const harness = await SyntheticManagedHarness.install(page);
    await addGuestMenu(page);
    const guestData = await page.evaluate(() => localStorage.getItem('kendo-menu'));
    if (workspace === 'dashboard') {
      await page.getByRole('button', { name: 'View more' }).first().click();
    } else {
      await page.goto('/app/guest/library?drill=junior-high-kendo-club');
    }
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('#root')).toHaveAttribute('inert', '');
    await page.evaluate(() => {
      const original = window.localStorage.getItem.bind(window.localStorage);
      window.localStorage.getItem = function (key: string) {
        if (key === 'kendo-menu') throw new Error('Synthetic readback failure');
        return original(key);
      };
      window.addEventListener(
        'restore-test-readback',
        () => {
          window.localStorage.getItem = original;
        },
        { once: true },
      );
    });
    harness.setSignedIn(true);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.drill-dialog-layer')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Guest changes could not be confirmed.' }),
    ).toBeVisible();
    await expect(page.locator('#root')).not.toHaveAttribute('inert');
    await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('body')).not.toHaveClass(/drill-dialog-open/);
    await expect(
      page.locator(workspace === 'dashboard' ? '.dashboard-card--compact' : '.library-grid'),
    ).not.toBeVisible();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/app/guest/${workspace}`);
    await page.evaluate(() => window.dispatchEvent(new Event('restore-test-readback')));
    expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestData);
    expect(harness.apiCalls.some((call) => call.method === 'POST' || call.method === 'PUT')).toBe(
      false,
    );
  });
}

test('a dismissed remaining browser warning permits another Google attempt', async ({ page }) => {
  const harness = await SyntheticManagedHarness.install(page);
  await addGuestMenu(page);
  await openBuilder(page);
  await page.getByLabel('Session name').fill('Canceled navigation retains me');
  await page.evaluate(() => {
    window.addEventListener('beforeunload', (event) => {
      event.preventDefault();
      event.returnValue = '';
    });
  });
  let warnings = 0;
  page.on('dialog', async (dialog) => {
    if (dialog.type() === 'beforeunload' && ++warnings === 1) await dialog.dismiss();
    else await dialog.accept();
  });
  await clickGuestSignUp(page);
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect.poll(() => warnings).toBe(1);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(/\/app\/account\/dashboard$/);
  expect(harness.authCalls.filter((url) => url.includes('/sign-in/social'))).toHaveLength(2);
});

test('an accepted Google navigation keeps duplicate initiation coalesced while its destination is slow', async ({
  page,
}) => {
  await SyntheticManagedHarness.install(page);
  await page.goto('/app/guest/drills/new');
  await page.getByLabel('Session name').fill('Accepted departure');
  page.on('dialog', (dialog) => void dialog.accept());
  await clickGuestSignUp(page);
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  let calls = 0;
  await page.route('**/sign-in/social', async (route) => {
    calls += 1;
    await route.fulfill({
      json: { redirect: true, url: new URL('/synthetic-slow-oauth', page.url()).href },
    });
  });
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/synthetic-slow-oauth', async (route) => {
    await held;
    await route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic provider</h1>' });
  });
  let checked: (() => void) | undefined;
  const duplicateChecked = new Promise<void>((resolve) => {
    checked = resolve;
  });
  await page.route('**/synthetic-duplicate-check', async (route) => {
    await route.fulfill({ body: 'checked' });
    checked?.();
  });
  await page.evaluate(() => {
    window.addEventListener(
      'beforeunload',
      (event) => {
        event.preventDefault();
        event.returnValue = '';
        // Exercise the live source document without Playwright waiting for the pending navigation.
        window.setTimeout(() => {
          const button = [...document.querySelectorAll('button')].find(
            (element) => element.textContent?.trim() === 'Continue with Google',
          );
          button?.click();
          void fetch('/synthetic-duplicate-check');
        }, 0);
      },
      { once: true },
    );
  });
  const departing = page.waitForRequest('**/synthetic-slow-oauth');
  await page.getByRole('button', { name: 'Continue with Google' }).click({ noWaitAfter: true });
  await departing;
  await duplicateChecked;
  expect(calls).toBe(1);
  release?.();
  await expect(page.getByRole('heading', { name: 'Synthetic provider' })).toBeVisible();
  expect(calls).toBe(1);
});

test('a guest library portal closes while a verified transition waits for the guest lock', async ({
  page,
  context,
}) => {
  const harness = await SyntheticManagedHarness.install(page);
  const lockOwner = await context.newPage();
  await lockOwner.goto('/app/guest/dashboard');
  await lockOwner.evaluate(
    () =>
      new Promise<void>((acquired) => {
        void navigator.locks.request(
          'kendo-menu:guest',
          () =>
            new Promise<void>((release) => {
              window.addEventListener('release-test-guest-lock', () => release(), { once: true });
              acquired();
            }),
        );
      }),
  );
  await page.goto('/app/guest/library?drill=junior-high-kendo-club');
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  harness.setSignedIn(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.drill-dialog-layer')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Confirming your guest dashboard…' }),
  ).toBeVisible();
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden', 'true');
  const continueButton = page.getByRole('button', { name: 'Continue to account' });
  await continueButton.press('Enter');
  await expect(page.locator('.library-grid')).not.toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBeNull();
  await lockOwner.evaluate(() => window.dispatchEvent(new Event('release-test-guest-lock')));
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kendo-menu'))).not.toBeNull();
  await continueButton.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/app/account/library');
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).not.toBeNull();
  expect(harness.apiCalls.some((call) => call.method === 'POST' || call.method === 'PUT')).toBe(
    false,
  );
  await lockOwner.close();
});

test('duplicate Google entry stays coalesced and restores protection when the pending provider fails', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page);
  await page.goto('/app/guest/drills/new');
  await page.getByLabel('Session name').fill('Keep after pending failure');
  const guestData = await page.evaluate(() => localStorage.getItem('kendo-menu'));
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route('**/sign-in/social', async (route) => {
    calls += 1;
    await held;
    await route.fulfill({ status: 503, json: { message: 'Synthetic provider failure' } });
  });
  let confirmations = 0;
  page.on('dialog', async (dialog) => {
    confirmations += 1;
    await dialog.accept();
  });
  await clickGuestSignUp(page);
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  const googleButton = page
    .getByRole('region', { name: 'Sign-in options', exact: true })
    .getByRole('button');
  await googleButton.click();
  await expect.poll(() => calls).toBe(1);
  await expect(googleButton).toBeDisabled();
  expect(confirmations).toBe(1);
  release?.();
  await expect(page.getByRole('alert')).toContainText('Google sign-in could not be started');
  expect(calls).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('kendo-menu'))).toBe(guestData);
  await page.unroute('**/sign-in/social');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(/\/app\/account\/dashboard$/);
  expect(calls).toBe(1);
  expect(harness.authCalls.filter((url) => url.includes('/sign-in/social'))).toHaveLength(1);
});

test('edits during the Google guest flush retain protection and require a fresh confirmation', async ({
  page,
  context,
}) => {
  const harness = await SyntheticManagedHarness.install(page);
  await addGuestMenu(page);
  const lockOwner = await context.newPage();
  await lockOwner.goto('/app/guest/dashboard');
  await lockOwner.evaluate(
    () =>
      new Promise<void>((acquired) => {
        void navigator.locks.request(
          'kendo-menu:guest',
          () =>
            new Promise<void>((release) => {
              window.addEventListener('release-test-guest-lock', () => release(), { once: true });
              acquired();
            }),
        );
      }),
  );
  await page.getByRole('button', { name: 'View more' }).first().click();
  await page.getByLabel('Practice notes').fill('Pending guest write');
  await page.getByLabel('Practice notes').press('Tab');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Close/ })
    .click();
  await openBuilder(page);
  await page.getByLabel('Session name').fill('Confirmed input');
  page.on('dialog', (dialog) => void dialog.accept());
  await clickGuestSignUp(page);
  const signUpLink = page.getByRole('region', { name: 'User options' }).getByRole('link');
  await expect(signUpLink).toHaveText('Checking guest save…');
  await page.getByLabel('Session name').fill('New input after confirmation');
  await lockOwner.evaluate(() => window.dispatchEvent(new Event('release-test-guest-lock')));
  await expect(page.getByRole('alert')).toContainText('could not confirm your guest dashboard');
  await expect(page.getByLabel('Session name')).toHaveValue('New input after confirmation');
  expect(harness.authCalls.some((url) => url.includes('/sign-in/social'))).toBe(false);
  expect(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await startGuestGoogleSignUp(page);
  await expect(page).toHaveURL(/\/app\/account\/dashboard$/);
  await lockOwner.close();
});

for (const invalidation of ['route', 'identity'] as const) {
  test(`a pending guest sign-up cannot navigate late after its ${invalidation} changes`, async ({
    page,
    context,
  }) => {
    const harness = await SyntheticManagedHarness.install(page);
    await addGuestMenu(page);
    const lockOwner = await context.newPage();
    await lockOwner.goto('/app/guest/dashboard');
    await lockOwner.evaluate(
      () =>
        new Promise<void>((acquired) => {
          void navigator.locks.request(
            'kendo-menu:guest',
            () =>
              new Promise<void>((release) => {
                window.addEventListener('release-test-guest-lock', () => release(), {
                  once: true,
                });
                acquired();
              }),
          );
        }),
    );

    await page.goto('/app/guest/dashboard');
    await addPendingPracticeNote(page);
    await clickGuestSignUp(page);
    const signUpLink = page.getByRole('region', { name: 'User options' }).getByRole('link');
    await expect(signUpLink).toHaveText('Checking guest save…');
    if (invalidation === 'route') {
      await workspaceLink(page, 'Library').click();
      await expect(page).toHaveURL(/\/app\/guest\/library$/);
    } else {
      harness.setSignedIn(true);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(
        page.getByRole('heading', { name: 'Confirming your guest dashboard…' }),
      ).toBeVisible();
    }

    await lockOwner.evaluate(() => window.dispatchEvent(new Event('release-test-guest-lock')));
    if (invalidation === 'route') {
      await expect(page).toHaveURL(/\/app\/guest\/library$/);
    } else {
      await expect(page).toHaveURL(/\/app\/guest\/dashboard$/);
      await expect(page.getByRole('button', { name: 'Continue to account' })).toBeVisible();
      expect(harness.authCalls.some((url) => url.includes('/sign-in/social'))).toBe(false);
      await page.getByRole('button', { name: 'Continue to account' }).click();
      await expect(page).toHaveURL(/\/app\/account\/dashboard$/);
    }
    expect(harness.authCalls.some((url) => url.includes('/sign-in/social'))).toBe(false);
    await lockOwner.close();
  });
}
