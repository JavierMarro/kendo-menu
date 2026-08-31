import { Component, useEffect, type ReactElement } from 'react';
import {
  NavigationType,
  Outlet,
  useLocation,
  useNavigationType,
  type Location,
} from 'react-router-dom';

import { AppShell } from '../components/AppShell';
import { CookieNotice } from '../components/CookieNotice';
import { InstallExperienceProvider } from '../features/install/InstallExperience';
import { NotFoundPage } from '../features/not-found/NotFoundPage';

const routeTitles: Readonly<Record<string, string>> = {
  '/app': 'Plan your keiko',
  '/app/dashboard': 'Dashboard',
  '/app/library': 'Keiko library',
  '/app/drills/new': 'Create session',
  '/app/sources': 'Sources',
  '/cookies': 'Cookie Policy',
};

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
    document.title = `${title} · KendoMenu`;
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [location.pathname]);

  return <ScrollManager location={location} navigationType={navigationType} />;
}

export function RouteRoot() {
  return (
    <InstallExperienceProvider>
      <RouteFocusAndTitle />
      <Outlet />
      <CookieNotice />
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
