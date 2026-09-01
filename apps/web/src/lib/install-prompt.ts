export const INSTALL_DISMISSAL_STORAGE_KEY = 'kendo-menu-install-dismissed';

export const INSTALL_LANDING_VISIT_STORAGE_KEY = 'kendo-menu-install-landing-visits';

export const INSTALL_LANDING_VISIT_REQUIRED_COUNT = 2;

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

export interface InstallLandingVisitResult {
  readonly visitCount: number;
  readonly isAutomaticPromptEligible: boolean;
}

export function isPhoneClassDevice(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): boolean {
  if (maxTouchPoints < 1) {
    return false;
  }

  const normalizedUserAgent = userAgent.toLowerCase();
  const normalizedPlatform = platform.toLowerCase();
  const isApplePhone =
    /iphone|ipod/.test(normalizedUserAgent) || /iphone|ipod/.test(normalizedPlatform);
  const isAndroidPhone =
    normalizedUserAgent.includes('android') && normalizedUserAgent.includes('mobile');

  return isApplePhone || isAndroidPhone;
}

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

export function readInstallLandingVisitCount(storage: Pick<Storage, 'getItem'>): number {
  try {
    const rawCount = storage.getItem(INSTALL_LANDING_VISIT_STORAGE_KEY);
    if (rawCount === null) {
      return 0;
    }

    const count = Number(rawCount);
    return Number.isSafeInteger(count) &&
      count >= 0 &&
      count <= INSTALL_LANDING_VISIT_REQUIRED_COUNT
      ? count
      : 0;
  } catch {
    return 0;
  }
}

export function recordInstallLandingVisit(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): InstallLandingVisitResult {
  const visitCount = Math.min(
    readInstallLandingVisitCount(storage) + 1,
    INSTALL_LANDING_VISIT_REQUIRED_COUNT,
  );

  try {
    storage.setItem(INSTALL_LANDING_VISIT_STORAGE_KEY, String(visitCount));
  } catch {
    // A failed first write keeps the automatic prompt ineligible on the next page load.
  }

  return {
    visitCount,
    isAutomaticPromptEligible: visitCount >= INSTALL_LANDING_VISIT_REQUIRED_COUNT,
  };
}
