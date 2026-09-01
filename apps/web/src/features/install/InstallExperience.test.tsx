import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  COOKIE_NOTICE_ACKNOWLEDGEMENT_DURATION_MS,
  COOKIE_NOTICE_ACKNOWLEDGEMENT_STORAGE_KEY,
} from '../../lib/cookie-notice';
import {
  APP_DISPLAY_MODE_QUERIES,
  INSTALL_DISMISSAL_STORAGE_KEY,
  INSTALL_LANDING_VISIT_STORAGE_KEY,
} from '../../lib/install-prompt';
import { createTestStore, renderApp } from '../../test/test-utils';

const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
const originalFullscreenElementDescriptor = Object.getOwnPropertyDescriptor(
  document,
  'fullscreenElement',
);
const originalStandaloneDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator,
  'standalone',
);
const originalUserAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'platform');
const originalMaxTouchPointsDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator,
  'maxTouchPoints',
);
const originalInnerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');

type PromptChoice = {
  readonly outcome: 'accepted' | 'dismissed';
  readonly platform: string;
};

function createBeforeInstallPromptEvent(
  prompt: () => Promise<void> = () => Promise.resolve(),
  userChoice: Promise<PromptChoice> = Promise.resolve({
    outcome: 'dismissed',
    platform: 'web',
  }),
): Event {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.defineProperties(event, {
    platforms: { configurable: true, value: ['web'] },
    prompt: { configurable: true, value: prompt },
    userChoice: { configurable: true, value: userChoice },
  });
  return event;
}

function configureDisplayMode(matchesFor: string | null): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query === matchesFor,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

function configurePhoneDevice(): void {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36',
  });
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: 'Linux armv8l',
  });
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    configurable: true,
    value: 5,
  });
}

function acknowledgeCookieNotice(): void {
  window.localStorage.setItem(
    COOKIE_NOTICE_ACKNOWLEDGEMENT_STORAGE_KEY,
    String(Date.now() + COOKIE_NOTICE_ACKNOWLEDGEMENT_DURATION_MS),
  );
}

function prepareAutomaticInstallPromo(): void {
  configurePhoneDevice();
  acknowledgeCookieNotice();
  window.localStorage.setItem(INSTALL_LANDING_VISIT_STORAGE_KEY, '1');
}

function restoreBrowserProperties(): void {
  if (originalMatchMediaDescriptor === undefined) {
    Reflect.deleteProperty(window, 'matchMedia');
  } else {
    Object.defineProperty(window, 'matchMedia', originalMatchMediaDescriptor);
  }

  if (originalFullscreenElementDescriptor === undefined) {
    Reflect.deleteProperty(document, 'fullscreenElement');
  } else {
    Object.defineProperty(document, 'fullscreenElement', originalFullscreenElementDescriptor);
  }

  if (originalStandaloneDescriptor === undefined) {
    Reflect.deleteProperty(window.navigator, 'standalone');
  } else {
    Object.defineProperty(window.navigator, 'standalone', originalStandaloneDescriptor);
  }

  if (originalUserAgentDescriptor === undefined) {
    Reflect.deleteProperty(window.navigator, 'userAgent');
  } else {
    Object.defineProperty(window.navigator, 'userAgent', originalUserAgentDescriptor);
  }

  if (originalPlatformDescriptor === undefined) {
    Reflect.deleteProperty(window.navigator, 'platform');
  } else {
    Object.defineProperty(window.navigator, 'platform', originalPlatformDescriptor);
  }

  if (originalMaxTouchPointsDescriptor === undefined) {
    Reflect.deleteProperty(window.navigator, 'maxTouchPoints');
  } else {
    Object.defineProperty(window.navigator, 'maxTouchPoints', originalMaxTouchPointsDescriptor);
  }

  if (originalInnerWidthDescriptor === undefined) {
    Reflect.deleteProperty(window, 'innerWidth');
  } else {
    Object.defineProperty(window, 'innerWidth', originalInnerWidthDescriptor);
  }
}

afterEach(() => {
  restoreBrowserProperties();
});

describe('install experience', () => {
  it('never offers the automatic prompt to a narrow desktop browser', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Safari/537.36',
    });
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      configurable: true,
      value: 5,
    });
    acknowledgeCookieNotice();
    window.localStorage.setItem(INSTALL_LANDING_VISIT_STORAGE_KEY, '1');

    renderApp(createTestStore(), { initialEntries: ['/app'] });
    const event = createBeforeInstallPromptEvent();
    window.dispatchEvent(event);

    await waitFor(() => expect(event.defaultPrevented).toBe(true));
    expect(
      screen.queryByRole('dialog', { name: 'Keep KendoMenu close for practice.' }),
    ).not.toBeInTheDocument();
    expect(window.localStorage.getItem(INSTALL_LANDING_VISIT_STORAGE_KEY)).toBe('1');
  });

  it('records the first phone landing entry once and offers the prompt on the second', async () => {
    configurePhoneDevice();
    acknowledgeCookieNotice();

    const firstView = renderApp(createTestStore(), { initialEntries: ['/app'] });
    window.dispatchEvent(createBeforeInstallPromptEvent());

    await waitFor(() =>
      expect(window.localStorage.getItem(INSTALL_LANDING_VISIT_STORAGE_KEY)).toBe('1'),
    );
    expect(
      screen.queryByRole('dialog', { name: 'Keep KendoMenu close for practice.' }),
    ).not.toBeInTheDocument();

    firstView.unmount();
    renderApp(createTestStore(), { initialEntries: ['/app'] });
    window.dispatchEvent(createBeforeInstallPromptEvent());

    expect(
      await screen.findByRole('dialog', { name: 'Keep KendoMenu close for practice.' }),
    ).toBeVisible();
    expect(window.localStorage.getItem(INSTALL_LANDING_VISIT_STORAGE_KEY)).toBe('2');
  });

  it('does not count provider re-renders as additional landing entries', async () => {
    configurePhoneDevice();
    acknowledgeCookieNotice();
    renderApp(createTestStore(), { initialEntries: ['/app'], reactStrictMode: true });

    await waitFor(() =>
      expect(window.localStorage.getItem(INSTALL_LANDING_VISIT_STORAGE_KEY)).toBe('1'),
    );
    const event = createBeforeInstallPromptEvent();
    window.dispatchEvent(event);
    await waitFor(() => expect(event.defaultPrevented).toBe(true));

    expect(window.localStorage.getItem(INSTALL_LANDING_VISIT_STORAGE_KEY)).toBe('1');
    expect(
      screen.queryByRole('dialog', { name: 'Keep KendoMenu close for practice.' }),
    ).not.toBeInTheDocument();
  });

  it('gives the cookie notice priority and defers installation to a later landing entry', async () => {
    const user = userEvent.setup();
    configurePhoneDevice();
    window.localStorage.setItem(INSTALL_LANDING_VISIT_STORAGE_KEY, '1');
    renderApp(createTestStore(), { initialEntries: ['/app'] });
    window.dispatchEvent(createBeforeInstallPromptEvent());

    expect(screen.getByRole('complementary', { name: 'Cookie notice' })).toBeVisible();
    expect(
      screen.queryByRole('dialog', { name: 'Keep KendoMenu close for practice.' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(
      screen.queryByRole('dialog', { name: 'Keep KendoMenu close for practice.' }),
    ).not.toBeInTheDocument();

    await user.click(
      within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', {
        name: /Keiko library/,
      }),
    );
    expect(screen.getByRole('heading', { name: 'Keiko library' })).toBeVisible();
    const topBar = document.querySelector('.top-bar');
    if (!(topBar instanceof HTMLElement)) {
      throw new Error('Expected the application top bar.');
    }
    await user.click(within(topBar).getByRole('link', { name: 'KendoMenu home' }));

    expect(
      await screen.findByRole('dialog', { name: 'Keep KendoMenu close for practice.' }),
    ).toBeVisible();
  });

  it('dismisses the promo with Tab and Enter, restoring focus to the named footer action', async () => {
    const user = userEvent.setup();
    prepareAutomaticInstallPromo();
    renderApp(createTestStore(), { initialEntries: ['/app'] });
    window.dispatchEvent(createBeforeInstallPromptEvent());

    const promo = await screen.findByRole('dialog', {
      name: 'Keep KendoMenu close for practice.',
    });
    const installButton = within(promo).getByRole('button', { name: 'Install KendoMenu' });
    const notNowButton = within(promo).getByRole('button', { name: 'Not now' });
    const dismissButton = within(promo).getByRole('button', {
      name: 'Dismiss install suggestion',
    });
    expect(installButton).toBeVisible();
    expect(notNowButton).toBeVisible();
    expect(dismissButton).toBeVisible();

    installButton.focus();
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    focusSpy.mockClear();
    await user.tab();
    expect(notNowButton).toHaveFocus();
    await user.keyboard('{Enter}');

    const footerAction = within(screen.getByRole('contentinfo', { name: 'Site footer' })).getByRole(
      'button',
      { name: 'Install KendoMenu' },
    );
    await waitFor(() => expect(footerAction).toHaveFocus());
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('captures and prevents the browser event, then offers the one-use native prompt', async () => {
    const user = userEvent.setup();
    const prompt = vi.fn<() => Promise<void>>(() => Promise.resolve());
    prepareAutomaticInstallPromo();
    renderApp(createTestStore(), { initialEntries: ['/app'] });

    const event = createBeforeInstallPromptEvent(prompt);
    window.dispatchEvent(event);

    const promo = await screen.findByRole('dialog', {
      name: 'Keep KendoMenu close for practice.',
    });
    expect(event.defaultPrevented).toBe(true);
    expect(within(promo).getByRole('button', { name: 'Install KendoMenu' })).toBeVisible();
    expect(within(promo).getByRole('button', { name: 'Not now' })).toBeVisible();

    await user.click(within(promo).getByRole('button', { name: 'Install KendoMenu' }));

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole('dialog', { name: 'Keep KendoMenu close for practice.' }),
    ).not.toBeInTheDocument();
    expect(window.localStorage.getItem(INSTALL_DISMISSAL_STORAGE_KEY)).toBe('true');
  });

  it('persists Not now across navigation and a fresh render while keeping the footer action', async () => {
    const user = userEvent.setup();
    const prompt = vi.fn<() => Promise<void>>(() => Promise.resolve());
    prepareAutomaticInstallPromo();
    const view = renderApp(createTestStore(), { initialEntries: ['/app'] });
    window.dispatchEvent(createBeforeInstallPromptEvent(prompt));

    const promo = await screen.findByRole('dialog', {
      name: 'Keep KendoMenu close for practice.',
    });
    await user.click(within(promo).getByRole('button', { name: 'Not now' }));

    expect(
      screen.queryByRole('dialog', { name: 'Keep KendoMenu close for practice.' }),
    ).not.toBeInTheDocument();
    expect(window.localStorage.getItem(INSTALL_DISMISSAL_STORAGE_KEY)).toBe('true');
    const footerAction = within(screen.getByRole('contentinfo', { name: 'Site footer' })).getByRole(
      'button',
      { name: 'Install KendoMenu' },
    );
    expect(footerAction).toBeVisible();

    await user.click(footerAction);
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));

    await user.click(
      within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', {
        name: /Keiko library/,
      }),
    );
    expect(
      screen.queryByRole('dialog', { name: 'Keep KendoMenu close for practice.' }),
    ).not.toBeInTheDocument();

    view.unmount();
    renderApp(createTestStore(), { initialEntries: ['/app/dashboard'] });
    window.dispatchEvent(createBeforeInstallPromptEvent());

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Keep KendoMenu close for practice.' }),
      ).not.toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole('contentinfo', { name: 'Site footer' })).getByRole('button', {
        name: 'Install KendoMenu',
      }),
    ).toBeVisible();
  });

  it('falls back to instructions and restores focus when the native prompt fails', async () => {
    const user = userEvent.setup();
    const prompt = vi.fn<() => Promise<void>>(() =>
      Promise.reject(new Error('The browser prompt was unavailable.')),
    );
    prepareAutomaticInstallPromo();
    renderApp(createTestStore(), { initialEntries: ['/app'] });
    window.dispatchEvent(createBeforeInstallPromptEvent(prompt));

    const promo = await screen.findByRole('dialog', {
      name: 'Keep KendoMenu close for practice.',
    });
    await user.click(within(promo).getByRole('button', { name: 'Install KendoMenu' }));

    const dialog = await screen.findByRole('dialog', { name: 'Install KendoMenu' });
    const closeButton = within(dialog).getByRole('button', {
      name: 'Close install instructions',
    });
    await user.click(closeButton);

    await waitFor(() =>
      expect(
        within(screen.getByRole('contentinfo', { name: 'Site footer' })).getByRole('button', {
          name: 'Install KendoMenu',
        }),
      ).toHaveFocus(),
    );
  });

  it('opens browser-specific fallback instructions when no deferred event is available', async () => {
    const user = userEvent.setup();
    renderApp(createTestStore(), { initialEntries: ['/app'] });

    const footer = screen.getByRole('contentinfo', { name: 'Site footer' });
    await user.click(within(footer).getByRole('button', { name: 'Install KendoMenu' }));

    const dialog = await screen.findByRole('dialog', { name: 'Install KendoMenu' });
    expect(
      within(dialog).getByRole('heading', { name: 'Install from your browser' }),
    ).toBeVisible();
    expect(dialog).toHaveTextContent('Installation may not be offered by every browser.');

    const closeButton = within(dialog).getByRole('button', {
      name: 'Close install instructions',
    });
    expect(closeButton).toHaveFocus();
    await user.click(closeButton);
    await waitFor(() => expect(footer.querySelector('button')).toHaveFocus());
  });

  it('renders Chromium-specific fallback copy in the install dialog', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36',
    });
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Win32',
    });
    renderApp(createTestStore(), { initialEntries: ['/app'] });

    const footer = screen.getByRole('contentinfo', { name: 'Site footer' });
    await user.click(within(footer).getByRole('button', { name: 'Install KendoMenu' }));

    const dialog = await screen.findByRole('dialog', { name: 'Install KendoMenu' });
    expect(
      within(dialog).getByRole('heading', {
        name: 'Chrome, Edge, or another Chromium browser',
      }),
    ).toBeVisible();
    expect(dialog).toHaveTextContent('install icon in the address bar');
    expect(dialog).toHaveTextContent('Choose Install KendoMenu');
  });

  it('waits for userChoice before restoring focus after a native prompt', async () => {
    const user = userEvent.setup();
    const prompt = vi.fn<() => Promise<void>>(() => Promise.resolve());
    let resolveChoice: ((choice: PromptChoice) => void) | undefined;
    const userChoice = new Promise<PromptChoice>((resolve) => {
      resolveChoice = resolve;
    });
    prepareAutomaticInstallPromo();
    renderApp(createTestStore(), { initialEntries: ['/app'] });
    window.dispatchEvent(createBeforeInstallPromptEvent(prompt, userChoice));

    const promo = await screen.findByRole('dialog', {
      name: 'Keep KendoMenu close for practice.',
    });
    await user.click(within(promo).getByRole('button', { name: 'Install KendoMenu' }));
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));

    const footerAction = within(screen.getByRole('contentinfo', { name: 'Site footer' })).getByRole(
      'button',
      { name: 'Install KendoMenu' },
    );
    const menuToggle = screen.getByRole('button', { name: 'Open navigation' });
    await user.click(menuToggle);
    expect(menuToggle).toHaveFocus();

    if (resolveChoice === undefined) {
      throw new Error('The browser did not expose a userChoice resolver.');
    }
    resolveChoice({ outcome: 'dismissed', platform: 'web' });
    await waitFor(() => expect(footerAction).toHaveFocus());
  });

  it('uses iOS instructions and hides the install action in standalone or fullscreen display modes', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    });
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'iPhone',
    });
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      configurable: true,
      value: 5,
    });
    renderApp(createTestStore(), { initialEntries: ['/app'] });

    const footer = screen.getByRole('contentinfo', { name: 'Site footer' });
    await user.click(within(footer).getByRole('button', { name: 'Install KendoMenu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Install KendoMenu' });
    expect(within(dialog).getByRole('heading', { name: 'iPhone or iPad' })).toBeVisible();
    expect(dialog).toHaveTextContent("browser's Share menu");
    expect(dialog).toHaveTextContent('Add to Home Screen');
    expect(dialog).toHaveTextContent('Open as Web App');

    await user.click(within(dialog).getByRole('button', { name: 'Close install instructions' }));
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.body,
    });
    document.dispatchEvent(new Event('fullscreenchange'));
    await waitFor(() => expect(footer.querySelector('button')).not.toBeInTheDocument());
  });

  it('hides both install surfaces in manifest standalone mode', async () => {
    prepareAutomaticInstallPromo();
    configureDisplayMode(APP_DISPLAY_MODE_QUERIES[0]);
    renderApp(createTestStore(), { initialEntries: ['/app'] });
    const event = createBeforeInstallPromptEvent();
    window.dispatchEvent(event);

    await waitFor(() => expect(event.defaultPrevented).toBe(true));
    expect(
      screen.queryByRole('dialog', { name: 'Keep KendoMenu close for practice.' }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('contentinfo', { name: 'Site footer' })).queryByRole('button', {
        name: 'Install KendoMenu',
      }),
    ).not.toBeInTheDocument();
  });

  it('hides the footer action for a manifest fullscreen display mode', () => {
    configureDisplayMode(APP_DISPLAY_MODE_QUERIES[1]);
    renderApp(createTestStore(), { initialEntries: ['/app'] });
    expect(
      within(screen.getByRole('contentinfo', { name: 'Site footer' })).queryByRole('button', {
        name: 'Install KendoMenu',
      }),
    ).not.toBeInTheDocument();
  });

  it('cleans up the captured prompt and install UI after appinstalled', async () => {
    const prompt = vi.fn<() => Promise<void>>(() => Promise.resolve());
    prepareAutomaticInstallPromo();
    renderApp(createTestStore(), { initialEntries: ['/app'] });
    window.dispatchEvent(createBeforeInstallPromptEvent(prompt));
    const promo = await screen.findByRole('dialog', {
      name: 'Keep KendoMenu close for practice.',
    });
    expect(within(promo).getByRole('button', { name: 'Install KendoMenu' })).toBeVisible();
    expect(
      within(screen.getByRole('contentinfo', { name: 'Site footer' })).getByRole('button', {
        name: 'Install KendoMenu',
      }),
    ).toBeVisible();
    window.dispatchEvent(new Event('appinstalled'));

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Keep KendoMenu close for practice.' }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('contentinfo', { name: 'Site footer' })).queryByRole('button', {
          name: 'Install KendoMenu',
        }),
      ).not.toBeInTheDocument(),
    );
    expect(prompt).not.toHaveBeenCalled();
  });
});
