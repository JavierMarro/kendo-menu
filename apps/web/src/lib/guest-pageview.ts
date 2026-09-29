/** Sends one allow-listed GoatCounter pixel after the current document verifies signed out. */
const GOATCOUNTER_PIXEL_ENDPOINT = 'https://javiermarro.goatcounter.com/count';
const ACCOUNT_TRANSITION_CHANNEL = 'kendomenu-account-transition-v1';
const DOCUMENT_TRANSITION_ID = `${Date.now()}:${Math.random()}`;
export type AccountTransitionSignal = 'sign-in-started' | 'verified-account-active' | 'signed-out';

const PUBLIC_ROUTE_PATHS: Readonly<Record<string, string>> = {
  '/': '/app',
  '/app': '/app',
  '/app/dashboard': '/app/dashboard',
  '/app/library': '/app/library',
  '/app/drills/new': '/app/drills/new',
  '/app/sources': '/app/sources',
  '/app/glossary': '/app/glossary',
  '/cookies': '/cookies',
};

export function getGuestPageviewPath(pathname: string): string {
  if (pathname.startsWith('/app/library/')) return '/app/library/session';
  return PUBLIC_ROUTE_PATHS[pathname] ?? '/404';
}

export function scheduleGuestPageview(pathname: string): () => boolean {
  if (!navigator.onLine) return () => true;
  let image: HTMLImageElement | undefined;
  let emitted = false;
  let pending = true;
  function cancelForOffline() {
    pending = false;
    window.clearTimeout(timeoutId);
    window.removeEventListener('offline', cancelForOffline);
  }
  const timeoutId = window.setTimeout(() => {
    window.removeEventListener('offline', cancelForOffline);
    if (!pending || !navigator.onLine) return;
    pending = false;
    image = new Image();
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    emitted = true;
    image.src = `${GOATCOUNTER_PIXEL_ENDPOINT}?p=${encodeURIComponent(getGuestPageviewPath(pathname))}`;
  }, 1000);
  window.addEventListener('offline', cancelForOffline, { once: true });

  return () => {
    pending = false;
    window.clearTimeout(timeoutId);
    window.removeEventListener('offline', cancelForOffline);
    return !emitted;
  };
}

/** Broadcasts a cancellation hint only; receiving tabs must never treat it as identity proof. */
export function broadcastAccountTransition(signal: AccountTransitionSignal): void {
  try {
    const channel = new BroadcastChannel(ACCOUNT_TRANSITION_CHANNEL);
    channel.postMessage({ signal, sender: DOCUMENT_TRANSITION_ID });
    channel.close();
  } catch {
    // Cross-tab cancellation is best effort and never changes session verification.
  }
}

export function subscribeToAccountTransitions(
  listener: (signal: AccountTransitionSignal) => void,
): () => void {
  try {
    const channel = new BroadcastChannel(ACCOUNT_TRANSITION_CHANNEL);
    const onMessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      const signal =
        typeof message === 'object' && message !== null && 'signal' in message
          ? message.signal
          : message;
      if (
        typeof message === 'object' &&
        message !== null &&
        'sender' in message &&
        message.sender === DOCUMENT_TRANSITION_ID
      )
        return;
      if (
        signal === 'sign-in-started' ||
        signal === 'verified-account-active' ||
        signal === 'signed-out'
      )
        listener(signal);
    };
    channel.addEventListener('message', onMessage);
    return () => {
      channel.removeEventListener('message', onMessage);
      channel.close();
    };
  } catch {
    return () => undefined;
  }
}
