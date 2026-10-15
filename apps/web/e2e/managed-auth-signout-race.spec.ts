import { expect, test, type Page } from '@playwright/test';

import { SYNTHETIC_AUTH_URL, SyntheticManagedHarness } from './synthetic-managed-harness';
import { clickWorkspaceSignOut } from './workspace-test-helpers';

type ProbeWindow = Window & { __identityChecksStarted?: number };

async function enterAccount(page: Page): Promise<void> {
  await page.goto('/app/account/dashboard');
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
}

async function observeIdentityCheckStarts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const testWindow = window as ProbeWindow;
    testWindow.__identityChecksStarted = 0;
    window.addEventListener('kendomenu:session-verification-started', () => {
      testWindow.__identityChecksStarted = (testWindow.__identityChecksStarted ?? 0) + 1;
    });
  });
}

async function identityCheckStarts(page: Page): Promise<number> {
  return page.evaluate(() => (window as ProbeWindow).__identityChecksStarted ?? 0);
}

function isSignedOutTransition(message: unknown): message is Record<string, unknown> {
  return (
    typeof message === 'object' &&
    message !== null &&
    !Array.isArray(message) &&
    'signal' in message &&
    message.signal === 'signed-out' &&
    'sender' in message &&
    typeof message.sender === 'string'
  );
}

test('confirmed sign-out fences focus verification, notifies a peer, and keeps guest routing', async ({
  page,
  context,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  let releaseSignOut: (() => void) | undefined;
  let observeSignOut: (() => void) | undefined;
  const signOutRelease = new Promise<void>((resolve) => {
    releaseSignOut = resolve;
  });
  const signOutSeen = new Promise<void>((resolve) => {
    observeSignOut = resolve;
  });
  await page.route(`${SYNTHETIC_AUTH_URL}/**`, async (route) => {
    if (route.request().url().includes('/sign-out')) {
      observeSignOut?.();
      await signOutRelease;
      harness.setSignedIn(false);
      await route.fulfill({
        json: { success: true },
        headers: {
          'set-cookie':
            'synthetic-managed-session=; Path=/neon/auth; HttpOnly; Secure; SameSite=None; Max-Age=0',
        },
      });
      return;
    }
    await route.fallback();
  });

  const peer = await context.newPage();
  await peer.addInitScript(() => {
    const testWindow = window as ProbeWindow & { __accountTransitions?: unknown[] };
    testWindow.__accountTransitions = [];
    const channel = new BroadcastChannel('kendomenu-account-transition-v1');
    channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      testWindow.__accountTransitions?.push(event.data);
    });
  });
  await SyntheticManagedHarness.install(peer, { initiallySignedIn: true });
  await peer.goto('/app');
  await enterAccount(page);
  await observeIdentityCheckStarts(page);

  await clickWorkspaceSignOut(page);
  await expect(page.getByRole('alertdialog', { name: /Leave this account/i })).toHaveCount(0);
  await signOutSeen;
  await expect(
    page.getByRole('heading', { name: /hidden until it can be verified/i }),
  ).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => identityCheckStarts(page)).toBe(0);
  releaseSignOut?.();
  await expect(page).toHaveURL(/\/app$/u);
  await expect
    .poll(async () => {
      const messages = await peer.evaluate(
        () =>
          (window as ProbeWindow & { __accountTransitions?: unknown[] }).__accountTransitions ?? [],
      );
      return messages.some(isSignedOutTransition);
    })
    .toBe(true);

  await page.getByRole('link', { name: 'Try without an account' }).click();
  await expect(page).toHaveURL(/\/app\/guest\/dashboard$/u);
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  expect(harness.apiCalls.some((call) => call.method === 'PUT')).toBe(false);
  const peerMessages = await peer.evaluate(
    () => (window as ProbeWindow & { __accountTransitions?: unknown[] }).__accountTransitions ?? [],
  );
  const signedOutMessage = peerMessages.find(isSignedOutTransition);
  expect(signedOutMessage).toBeDefined();
  expect(typeof signedOutMessage?.['sender']).toBe('string');
  expect(Object.keys(signedOutMessage ?? {}).sort()).toEqual(['sender', 'signal']);
});

test('failed sign-out keeps account hidden through lifecycle checks until retry succeeds', async ({
  page,
}) => {
  const harness = await SyntheticManagedHarness.install(page, { initiallySignedIn: true });
  let signOutAttempt = 0;
  let releaseFailure: (() => void) | undefined;
  let observeFailure: (() => void) | undefined;
  const failureRelease = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  const failureSeen = new Promise<void>((resolve) => {
    observeFailure = resolve;
  });
  await page.route(`${SYNTHETIC_AUTH_URL}/**`, async (route) => {
    if (route.request().url().includes('/sign-out') && signOutAttempt === 0) {
      signOutAttempt += 1;
      observeFailure?.();
      await failureRelease;
      await route.fulfill({ status: 503, json: { message: 'synthetic provider unavailable' } });
      return;
    }
    await route.fallback();
  });
  await enterAccount(page);
  await observeIdentityCheckStarts(page);
  const accountChecks = harness.apiCalls.filter(
    (call) =>
      call.method === 'GET' && new URL(call.path, 'http://localhost').pathname === '/api/account',
  ).length;

  await clickWorkspaceSignOut(page);
  await expect(page.getByRole('alertdialog', { name: /Leave this account/i })).toHaveCount(0);
  await failureSeen;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => identityCheckStarts(page)).toBe(0);
  releaseFailure?.();
  await expect(page.getByRole('button', { name: 'Retry sign-out' })).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  });
  await expect.poll(() => identityCheckStarts(page)).toBe(0);
  expect(
    harness.apiCalls.filter(
      (call) =>
        call.method === 'GET' && new URL(call.path, 'http://localhost').pathname === '/api/account',
    ),
  ).toHaveLength(accountChecks);
  await expect(
    page.getByRole('heading', { name: /hidden until it can be verified/i }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Retry sign-out' }).click();
  await expect(page).toHaveURL(/\/app$/u);
  await page.getByRole('link', { name: 'Try without an account' }).click();
  await expect(page).toHaveURL(/\/app\/guest\/dashboard$/u);
  await expect(page.getByRole('heading', { name: 'Your dashboard', exact: true })).toBeVisible();
  expect(signOutAttempt).toBe(1);
  expect(harness.apiCalls.some((call) => call.method === 'PUT')).toBe(false);
});
