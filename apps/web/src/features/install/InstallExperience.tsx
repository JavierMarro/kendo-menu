import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';

import { DialogShell } from '../../components/DialogShell';
import {
  APP_DISPLAY_MODE_QUERIES,
  getInstallInstructionsKind,
  isPhoneClassDevice,
  isStandaloneDisplayMode,
  persistInstallDismissal,
  recordInstallLandingVisit,
  readInstallDismissal,
  type InstallInstructionsKind,
  type KendoBeforeInstallPromptEvent,
} from '../../lib/install-prompt';
import { InstallExperienceContext, type InstallExperienceContextValue } from './install-context';

const INSTALL_DIALOG_TITLE_ID = 'install-kendomenu-dialog-title';

interface InstallExperienceProviderProps {
  readonly children: ReactNode;
  readonly isAutomaticPromptBlocked: boolean;
}

function readBrowserInstallDismissal(): boolean {
  try {
    return readInstallDismissal(window.localStorage);
  } catch {
    return false;
  }
}

function persistBrowserInstallDismissal(): void {
  try {
    persistInstallDismissal(window.localStorage);
  } catch {
    // Installing remains available for this session if storage is unavailable.
  }
}

function isBrowserPhoneClassDevice(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return isPhoneClassDevice(
      window.navigator.userAgent,
      window.navigator.platform,
      window.navigator.maxTouchPoints,
    );
  } catch {
    return false;
  }
}

function recordBrowserInstallLandingVisit(): boolean {
  try {
    return recordInstallLandingVisit(window.localStorage).isAutomaticPromptEligible;
  } catch {
    return false;
  }
}

function getBrowserInstructionsKind(): InstallInstructionsKind {
  return getInstallInstructionsKind(
    window.navigator.userAgent,
    window.navigator.platform,
    window.navigator.maxTouchPoints,
  );
}

function isFullscreen(): boolean {
  return document.fullscreenElement !== null && document.fullscreenElement !== undefined;
}

function subscribeToDisplayMode(mediaQueryList: MediaQueryList, listener: () => void): () => void {
  if (typeof mediaQueryList.addEventListener === 'function') {
    mediaQueryList.addEventListener('change', listener);
    return () => mediaQueryList.removeEventListener('change', listener);
  }

  if (typeof mediaQueryList.addListener === 'function') {
    mediaQueryList.addListener(listener);
    return () => mediaQueryList.removeListener(listener);
  }

  return () => undefined;
}

export function InstallExperienceProvider({
  children,
  isAutomaticPromptBlocked,
}: InstallExperienceProviderProps): ReactElement {
  const location = useLocation();
  const [deferredPrompt, setDeferredPrompt] = useState<KendoBeforeInstallPromptEvent | null>(null);
  const [isDismissed, setIsDismissed] = useState(readBrowserInstallDismissal);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isPhoneEligible] = useState(isBrowserPhoneClassDevice);
  const [isAutomaticPromptEligibleForEntry, setIsAutomaticPromptEligibleForEntry] = useState(false);
  const [isEnvironmentHidden, setIsEnvironmentHidden] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return isStandaloneDisplayMode(window) || isFullscreen();
  });
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const installActionRef = useRef<HTMLButtonElement | null>(null);
  const hadOpenDialog = useRef(false);

  const recordLandingEntry = useCallback((): void => {
    const isEligible = isPhoneEligible && recordBrowserInstallLandingVisit();
    setIsAutomaticPromptEligibleForEntry(isEligible && !isAutomaticPromptBlocked);
  }, [isAutomaticPromptBlocked, isPhoneEligible]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: KendoBeforeInstallPromptEvent): void => {
      if (typeof event.prompt !== 'function') {
        return;
      }

      event.preventDefault();
      setDeferredPrompt((currentPrompt) => currentPrompt ?? event);
    };
    const handleAppInstalled = (): void => {
      setDeferredPrompt(null);
      setIsInstalled(true);
      setIsDialogOpen(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const updateEnvironmentVisibility = useCallback((): void => {
    const isHidden = isStandaloneDisplayMode(window) || isFullscreen();
    setIsEnvironmentHidden(isHidden);
    if (isHidden) {
      setIsDialogOpen(false);
    }
  }, []);

  useEffect(() => {
    const mediaQueryLists =
      typeof window.matchMedia === 'function'
        ? APP_DISPLAY_MODE_QUERIES.map((query) => window.matchMedia(query))
        : [];

    const unsubscribeFromDisplayModes = mediaQueryLists.map((mediaQueryList) =>
      subscribeToDisplayMode(mediaQueryList, updateEnvironmentVisibility),
    );
    document.addEventListener('fullscreenchange', updateEnvironmentVisibility);

    return () => {
      for (const unsubscribe of unsubscribeFromDisplayModes) {
        unsubscribe();
      }
      document.removeEventListener('fullscreenchange', updateEnvironmentVisibility);
    };
  }, [updateEnvironmentVisibility]);

  useEffect(() => {
    if (isDialogOpen) {
      hadOpenDialog.current = true;
      return;
    }

    if (!hadOpenDialog.current) {
      return;
    }

    hadOpenDialog.current = false;
    dialogTriggerRef.current?.focus({ preventScroll: true });
  }, [isDialogOpen]);

  const registerInstallAction = useCallback((element: HTMLButtonElement | null): void => {
    installActionRef.current = element;
  }, []);

  const restoreInstallActionFocus = useCallback((): void => {
    const installAction = installActionRef.current;
    if (installAction?.isConnected) {
      installAction.focus({ preventScroll: true });
    }
  }, []);

  const dismissPromo = useCallback((): void => {
    persistBrowserInstallDismissal();
    setIsDismissed(true);
    restoreInstallActionFocus();
  }, [restoreInstallActionFocus]);

  const showInstructions = useCallback((trigger: HTMLElement): void => {
    dialogTriggerRef.current = trigger;
    setIsDialogOpen(true);
  }, []);

  const getDialogTrigger = useCallback((preferredTrigger: HTMLElement): HTMLElement => {
    if (preferredTrigger.isConnected) {
      return preferredTrigger;
    }

    return installActionRef.current ?? preferredTrigger;
  }, []);

  const invokeDeferredPrompt = useCallback(
    async (promptEvent: KendoBeforeInstallPromptEvent, trigger: HTMLElement): Promise<void> => {
      try {
        await promptEvent.prompt();
      } catch {
        showInstructions(getDialogTrigger(trigger));
        return;
      }

      try {
        await promptEvent.userChoice;
      } catch {
        // A prompt outcome is optional in some embedded browsers; focus still returns to the action.
      }

      restoreInstallActionFocus();
    },
    [getDialogTrigger, restoreInstallActionFocus, showInstructions],
  );

  const openInstallExperience = useCallback(
    (trigger: HTMLElement): void => {
      dialogTriggerRef.current = trigger;

      if (deferredPrompt === null) {
        showInstructions(trigger);
        return;
      }

      const promptEvent = deferredPrompt;
      setDeferredPrompt(null);
      persistBrowserInstallDismissal();
      setIsDismissed(true);
      void invokeDeferredPrompt(promptEvent, trigger);
    },
    [deferredPrompt, invokeDeferredPrompt, showInstructions],
  );

  const closeInstructions = useCallback((): void => {
    setIsDialogOpen(false);
  }, []);

  const contextValue = useMemo<InstallExperienceContextValue>(
    () => ({
      isInstallActionAvailable: !isEnvironmentHidden && !isInstalled,
      recordLandingEntry,
      registerInstallAction,
      openInstallExperience,
    }),
    [
      isEnvironmentHidden,
      isInstalled,
      openInstallExperience,
      recordLandingEntry,
      registerInstallAction,
    ],
  );

  const isPromoVisible =
    location.pathname === '/app' &&
    isPhoneEligible &&
    isAutomaticPromptEligibleForEntry &&
    !isAutomaticPromptBlocked &&
    !isEnvironmentHidden &&
    !isInstalled &&
    !isDismissed &&
    deferredPrompt !== null;

  return (
    <InstallExperienceContext.Provider value={contextValue}>
      {children}
      {isPromoVisible ? (
        <InstallPromo onDismiss={dismissPromo} onInstall={openInstallExperience} />
      ) : null}
      {isDialogOpen && !isEnvironmentHidden ? (
        <InstallInstructionsDialog onClose={closeInstructions} />
      ) : null}
    </InstallExperienceContext.Provider>
  );
}

interface InstallPromoProps {
  readonly onDismiss: () => void;
  readonly onInstall: (trigger: HTMLElement) => void;
}

function InstallPromo({ onDismiss, onInstall }: InstallPromoProps): ReactElement {
  const installButtonRef = useRef<HTMLButtonElement>(null);

  const handleInstall = (): void => {
    const trigger = installButtonRef.current;
    if (trigger === null) {
      return;
    }

    onInstall(trigger);
  };

  return (
    <aside
      className="install-promo"
      role="dialog"
      aria-modal="false"
      aria-labelledby="install-promo-title"
      aria-describedby="install-promo-description"
    >
      <div className="install-promo-copy">
        <p className="eyebrow">A focused home for your keiko</p>
        <h2 id="install-promo-title">Keep KendoMenu close for practice.</h2>
        <p id="install-promo-description">
          Install it on this device for a quick, app-like way to plan your next session.
        </p>
      </div>
      <div className="install-promo-actions">
        <button
          ref={installButtonRef}
          className="primary-button"
          type="button"
          onClick={handleInstall}
        >
          Install KendoMenu
        </button>
        <button className="text-button" type="button" onClick={onDismiss}>
          Not now
        </button>
        <button
          className="install-promo-dismiss"
          type="button"
          aria-label="Dismiss install suggestion"
          onClick={onDismiss}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </aside>
  );
}

interface InstallInstructionsDialogProps {
  readonly onClose: () => void;
}

function InstallInstructionsDialog({ onClose }: InstallInstructionsDialogProps): ReactElement {
  const instructionsKind = getBrowserInstructionsKind();

  return (
    <DialogShell
      closeLabel="Close install instructions"
      onClose={onClose}
      titleId={INSTALL_DIALOG_TITLE_ID}
    >
      <article className="install-dialog-content">
        <p className="eyebrow">Install KendoMenu</p>
        <h2 id={INSTALL_DIALOG_TITLE_ID}>Install KendoMenu</h2>
        <p className="install-dialog-intro">
          Keep your training planner one tap away. Follow the steps for your browser.
        </p>
        <InstallInstructions kind={instructionsKind} />
      </article>
    </DialogShell>
  );
}

function InstallInstructions({ kind }: { readonly kind: InstallInstructionsKind }): ReactElement {
  if (kind === 'ios') {
    return (
      <section className="install-instructions" aria-labelledby="install-ios-title">
        <h3 id="install-ios-title">iPhone or iPad</h3>
        <ol>
          <li>Open your browser&apos;s Share menu.</li>
          <li>Choose Add to Home Screen.</li>
          <li>Enable Open as Web App, then choose Add.</li>
        </ol>
      </section>
    );
  }

  if (kind === 'chromium') {
    return (
      <section className="install-instructions" aria-labelledby="install-chromium-title">
        <h3 id="install-chromium-title">Chrome, Edge, or another Chromium browser</h3>
        <ol>
          <li>Look for the install icon in the address bar, or open your browser menu.</li>
          <li>Choose Install KendoMenu, then confirm the installation.</li>
        </ol>
      </section>
    );
  }

  return (
    <section className="install-instructions" aria-labelledby="install-generic-title">
      <h3 id="install-generic-title">Install from your browser</h3>
      <p className="install-instructions-note">Installation may not be offered by every browser.</p>
      <ol>
        <li>Open your browser menu and look for Install app or Add to Home Screen.</li>
        <li>Follow the prompts to add KendoMenu to this device.</li>
      </ol>
    </section>
  );
}
