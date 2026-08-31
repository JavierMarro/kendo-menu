export const INSTALL_DISMISSAL_STORAGE_KEY = 'kendo-menu-install-dismissed';

export const STANDALONE_DISPLAY_MODE_QUERY = '(display-mode: standalone)';

export const FULLSCREEN_DISPLAY_MODE_QUERY = '(display-mode: fullscreen)';

export const APP_DISPLAY_MODE_QUERIES = [
  STANDALONE_DISPLAY_MODE_QUERY,
  FULLSCREEN_DISPLAY_MODE_QUERY,
] as const;

export interface KendoBeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  readonly userChoice: Promise<{
    readonly outcome: 'accepted' | 'dismissed';
    readonly platform: string;
  }>;
  prompt(): Promise<void>;
}

declare global {
  interface Navigator {
    readonly standalone?: boolean;
  }

  interface WindowEventMap {
    beforeinstallprompt: KendoBeforeInstallPromptEvent;
  }
}

export type InstallInstructionsKind = 'chromium' | 'ios' | 'generic';

export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  const normalizedUserAgent = userAgent.toLowerCase();
  const normalizedPlatform = platform.toLowerCase();

  return (
    /iphone|ipad|ipod/.test(normalizedUserAgent) ||
    (normalizedPlatform === 'macintel' && maxTouchPoints > 1)
  );
}

export function isChromiumBrowser(userAgent: string): boolean {
  const normalizedUserAgent = userAgent.toLowerCase();

  return /(?:chrome|chromium|crios|edg|opr|brave)\//.test(normalizedUserAgent);
}

export function getInstallInstructionsKind(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): InstallInstructionsKind {
  if (isIosDevice(userAgent, platform, maxTouchPoints)) {
    return 'ios';
  }

  if (isChromiumBrowser(userAgent)) {
    return 'chromium';
  }

  return 'generic';
}

export function isStandaloneDisplayMode(environment: Window): boolean {
  if (typeof environment.matchMedia === 'function') {
    try {
      if (APP_DISPLAY_MODE_QUERIES.some((query) => environment.matchMedia(query).matches)) {
        return true;
      }
    } catch {
      // Some embedded browsers expose matchMedia but reject display-mode queries.
    }
  }

  return environment.navigator.standalone === true;
}

export function readInstallDismissal(storage: Storage): boolean {
  try {
    return storage.getItem(INSTALL_DISMISSAL_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function persistInstallDismissal(storage: Storage): void {
  try {
    storage.setItem(INSTALL_DISMISSAL_STORAGE_KEY, 'true');
  } catch {
    // Installing remains available for this session if storage is unavailable.
  }
}
