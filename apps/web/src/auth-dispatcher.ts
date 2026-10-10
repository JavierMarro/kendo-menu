import {
  APPLICATION_CALLBACK_PATH,
  AUTH_VERIFIER_PARAMETER,
  callbackDestination,
  clearAuthReturnMarker,
  resolveAuthReturn,
} from './lib/auth-return';

const pathname = window.location.pathname;
const resolution = resolveAuthReturn(pathname, window.location.search);

if (pathname === APPLICATION_CALLBACK_PATH) {
  void import('./features/auth-callback/entry');
} else if (resolution.kind === 'cancelled') {
  const destination = callbackDestination(resolution.flow);
  const cleanUrl = new URL(destination, window.location.origin);
  clearAuthReturnMarker();
  window.location.replace(`${cleanUrl.pathname}`);
} else if (resolution.kind === 'callback') {
  if (pathname === '/') {
    const destination = new URL(callbackDestination(resolution.flow), window.location.origin);
    destination.searchParams.set(AUTH_VERIFIER_PARAMETER, resolution.verifier);
    window.location.replace(`${destination.pathname}${destination.search}`);
  } else if (resolution.flow === 'application') {
    void import('./features/auth-callback/entry');
  } else {
    const destination = new URL(callbackDestination('proof'), window.location.origin);
    destination.searchParams.set(AUTH_VERIFIER_PARAMETER, resolution.verifier);
    window.location.replace(`${destination.pathname}${destination.search}`);
  }
} else if (resolution.kind === 'invalid') {
  clearAuthReturnMarker();
  void import('./features/auth-callback/entry');
} else {
  void import('./app-entry');
}
