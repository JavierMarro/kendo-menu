import { Component, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  NavigationType,
  useNavigate,
  Outlet,
  useLocation,
  useNavigationType,
  type Location,
} from 'react-router-dom';

import { AppShell } from '../components/AppShell';
import { CookieNotice } from '../components/CookieNotice';
import { InstallExperienceProvider } from '../features/install/InstallExperience';
import { NotFoundPage } from '../features/not-found/NotFoundPage';
import {
  persistCookieNoticeAcknowledgement,
  readCookieNoticeAcknowledgement,
} from '../lib/cookie-notice';
import { updateRouteMetadata } from '../lib/route-metadata';
import { scheduleGuestPageview, subscribeToAccountTransitions } from '../lib/guest-pageview';
import { useOptionalAccountWorkspace } from '../features/account/AccountWorkspaceProvider';

const routeTitles: Readonly<Record<string, string>> = {
  '/app': 'Plan your keiko',
  '/app/dashboard': 'Dashboard',
  '/app/library': 'Keiko library',
  '/app/drills/new': 'Create session',
  '/app/sources': 'Sources',
  '/app/glossary': 'Glossary',
  '/cookies': 'Cookie Policy',
};

const authErrorMessages = new Map([
  ['cancelled', 'Google sign-in was cancelled. You can continue using KendoMenu as a guest.'],
  ['failed', 'Google sign-in could not be completed. Please try again.'],
  ['unavailable', 'Account sign-in is temporarily unavailable. Guest use remains available.'],
]);

function authNoticeFromSearch(search: string): string | null {
  const authError = new URLSearchParams(search).get('authError');
  return authError === null ? null : (authErrorMessages.get(authError) ?? null);
}

function authErrorFromNavigationState(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('authError' in state)) return null;
  const code = state.authError;
  return typeof code === 'string' && authErrorMessages.has(code) ? code : null;
}

interface ScrollPosition {
  readonly top: number;
  readonly left: number;
}

interface ScrollManagerProps {
  readonly location: Location;
  readonly navigationType: NavigationType;
}

interface ScrollTransitionSnapshot {
  readonly previousPosition: ScrollPosition;
}

const TOP_POSITION: ScrollPosition = { top: 0, left: 0 };

function shouldShowBrowserCookieNotice(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    return !readCookieNoticeAcknowledgement(window.localStorage);
  } catch {
    return true;
  }
}

function persistBrowserCookieNoticeAcknowledgement(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    persistCookieNoticeAcknowledgement(window.localStorage);
  } catch {
    // The notice still dismisses for the current page session when storage is unavailable.
  }
}

function readScrollPosition(): ScrollPosition {
  return {
    top: window.scrollY,
    left: window.scrollX,
  };
}

function captureScrollPosition(
  scrollPositions: Map<string, ScrollPosition>,
  locationKey: string,
): ScrollPosition {
  const position = readScrollPosition();
  scrollPositions.set(locationKey, position);
  return position;
}

function hasLocationChanged(previous: Location, next: Location): boolean {
  return (
    previous.key !== next.key ||
    previous.pathname !== next.pathname ||
    previous.search !== next.search ||
    previous.hash !== next.hash
  );
}

export function AppLayout() {
  return <AppShell />;
}

class ScrollManager extends Component<ScrollManagerProps> {
  private readonly scrollPositions = new Map<string, ScrollPosition>();

  private readonly frozenLocationKeys = new Set<string>();

  private activeLocationKey = this.props.location.key;

  private previousScrollRestoration: History['scrollRestoration'] | null = null;

  private readonly captureActiveScroll = (): void => {
    if (this.frozenLocationKeys.has(this.activeLocationKey)) {
      return;
    }

    captureScrollPosition(this.scrollPositions, this.activeLocationKey);
  };

  override componentDidMount(): void {
    this.previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    window.addEventListener('scroll', this.captureActiveScroll, { passive: true });

    if (this.props.location.hash.length > 0) {
      document
        .getElementById(this.props.location.hash.slice(1))
        ?.scrollIntoView({ block: 'start' });
      this.scrollPositions.set(this.activeLocationKey, readScrollPosition());
    } else {
      captureScrollPosition(this.scrollPositions, this.activeLocationKey);
    }
  }

  override componentWillUnmount(): void {
    window.removeEventListener('scroll', this.captureActiveScroll);
    if (this.previousScrollRestoration !== null) {
      window.history.scrollRestoration = this.previousScrollRestoration;
    }
  }

  override getSnapshotBeforeUpdate(prevProps: ScrollManagerProps): ScrollTransitionSnapshot | null {
    if (!hasLocationChanged(prevProps.location, this.props.location)) {
      return null;
    }

    const previousPosition = captureScrollPosition(this.scrollPositions, prevProps.location.key);
    this.frozenLocationKeys.add(prevProps.location.key);
    this.frozenLocationKeys.add(this.props.location.key);
    return { previousPosition };
  }

  override componentDidUpdate(
    prevProps: ScrollManagerProps,
    _prevState: Readonly<Record<string, never>>,
    snapshot: ScrollTransitionSnapshot | null,
  ): void {
    if (snapshot === null) {
      return;
    }

    const { location, navigationType } = this.props;
    const previousLocation = prevProps.location;
    const locationKey = location.key;
    this.activeLocationKey = locationKey;

    let position: ScrollPosition;
    if (location.hash.length > 0) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
      position = readScrollPosition();
    } else if (navigationType === NavigationType.Pop) {
      position = this.scrollPositions.get(locationKey) ?? TOP_POSITION;
      window.scrollTo(position);
    } else if (location.pathname !== previousLocation.pathname) {
      position = TOP_POSITION;
      window.scrollTo(position);
    } else {
      position = snapshot.previousPosition;
      window.scrollTo(position);
    }

    this.scrollPositions.set(locationKey, position);
    this.frozenLocationKeys.delete(locationKey);
  }

  override render(): null {
    return null;
  }
}

function RouteFocusAndTitle(): ReactElement {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    const title =
      routeTitles[location.pathname] ??
      (location.pathname.startsWith('/app/library/') ? 'Session details' : 'KendoMenu');
    updateRouteMetadata({
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      title,
    });
  }, [location.hash, location.pathname, location.search]);

  useEffect(() => {
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [location.pathname]);

  return <ScrollManager location={location} navigationType={navigationType} />;
}

export function RouteRoot() {
  const [isCookieNoticeVisible, setIsCookieNoticeVisible] = useState(shouldShowBrowserCookieNotice);
  const location = useLocation();
  const authNotice =
    authNoticeFromSearch(location.search) ??
    authErrorMessages.get(authErrorFromNavigationState(location.state) ?? '') ??
    null;
  const navigate = useNavigate();
  const accountWorkspace = useOptionalAccountWorkspace();
  const pageviewScheduled = useRef(false);
  const cancelScheduledPageview = useRef<(() => boolean) | null>(null);
  const initialPathname = useRef(location.pathname);
  const dismissCookieNotice = useCallback((): void => {
    persistBrowserCookieNoticeAcknowledgement();
    setIsCookieNoticeVisible(false);
  }, []);

  useEffect(() => {
    // The landing redirect carries the query to /app. Let that navigation finish before
    // removing the callback code, or the two replacements can discard its notice state.
    if (location.pathname === '/') return;
    const parameters = new URLSearchParams(location.search);
    const queryError = parameters.get('authError');
    if (queryError !== null) {
      // Keep only a recognized callback code in route state. A history replacement can
      // remount this layout, so component state alone cannot carry the fixed notice.
      // The provider's document-load check already verifies the session after the redirect.
      parameters.delete('authError');
      const search = parameters.toString();
      void navigate(
        { pathname: location.pathname, search: search.length === 0 ? '' : `?${search}` },
        {
          replace: true,
          state: authErrorMessages.has(queryError) ? { authError: queryError } : null,
        },
      );
    }
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    const accountVerification = accountWorkspace?.verification;
    const workspaceMode = accountWorkspace?.snapshot.mode;
    if (accountVerification === 'authenticated' || accountVerification === 'retryable') {
      // The document's initial check did not prove signed out. Later logout or recovery
      // must not turn an authenticated or unresolved visit into an analytics pageview.
      pageviewScheduled.current = true;
      cancelScheduledPageview.current?.();
      cancelScheduledPageview.current = null;
      return;
    }
    if (
      accountVerification !== 'signed-out' ||
      workspaceMode !== 'guest' ||
      pageviewScheduled.current
    )
      return;
    pageviewScheduled.current = true;
    cancelScheduledPageview.current = scheduleGuestPageview(initialPathname.current);
  }, [accountWorkspace?.snapshot.mode, accountWorkspace?.verification]);

  useEffect(() => {
    if (accountWorkspace?.snapshot.mode !== 'guest') {
      cancelScheduledPageview.current?.();
      cancelScheduledPageview.current = null;
    }
  }, [accountWorkspace?.snapshot.mode]);

  useEffect(() => {
    const cancelPageview = () => {
      pageviewScheduled.current = true;
      cancelScheduledPageview.current?.();
      cancelScheduledPageview.current = null;
    };
    window.addEventListener('kendomenu:sign-in-started', cancelPageview);
    const unsubscribeFromTransitions = subscribeToAccountTransitions(cancelPageview);
    return () => {
      window.removeEventListener('kendomenu:sign-in-started', cancelPageview);
      unsubscribeFromTransitions();
      if (cancelScheduledPageview.current?.()) pageviewScheduled.current = false;
      cancelScheduledPageview.current = null;
    };
  }, []);

  return (
    <InstallExperienceProvider isAutomaticPromptBlocked={isCookieNoticeVisible}>
      <RouteFocusAndTitle />
      <Outlet />
      {authNotice === null ? null : (
        <p className="auth-error-notice" role="alert">
          {authNotice}
        </p>
      )}
      {isCookieNoticeVisible ? <CookieNotice onDismiss={dismissCookieNotice} /> : null}
    </InstallExperienceProvider>
  );
}

export function StandaloneNotFoundPage() {
  return (
    <main id="main-content" className="main-content" tabIndex={-1}>
      <NotFoundPage />
    </main>
  );
}
