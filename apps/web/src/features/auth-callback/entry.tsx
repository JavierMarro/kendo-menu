/**
 * Completes the application callback before the ordinary route tree starts.
 * It exchanges the verifier through the managed SDK, then replaces the document with a fixed,
 * clean account destination.
 */
import { createRoot } from 'react-dom/client';
import '../../styles.css';

import {
  APPLICATION_CALLBACK_PATH,
  SHARE_CALLBACK_PATH,
  clearAuthReturnMarker,
  resolveAuthReturn,
} from '../../lib/auth-return';
import { createManagedAuthClient } from '../../lib/managed-auth';
import { AuthCallbackFailure } from './AuthCallbackFailure';

import { clearShareReturnMarker } from '../../lib/share-return';

function clearContinuation() {
  clearAuthReturnMarker();
  clearShareReturnMarker();
}

const root = document.getElementById('root');
const callbackPath =
  window.location.pathname === SHARE_CALLBACK_PATH
    ? SHARE_CALLBACK_PATH
    : APPLICATION_CALLBACK_PATH;
if (root !== null) {
  const reactRoot = createRoot(root);
  const resolution = resolveAuthReturn(window.location.pathname, window.location.search);
  if (resolution.kind !== 'callback' || resolution.flow !== 'application') {
    if (resolution.kind === 'invalid' || resolution.kind === 'cancelled') {
      clearContinuation();
      window.history.replaceState(null, '', callbackPath);
    }
    reactRoot.render(<AuthCallbackFailure onHome={clearContinuation} retryAvailable={false} />);
  } else {
    const configuredUrl: unknown = import.meta.env['VITE_NEON_AUTH_URL'];
    const client =
      typeof configuredUrl === 'string'
        ? createManagedAuthClient(configuredUrl, 'application')
        : undefined;
    if (client === undefined) {
      clearContinuation();
      window.history.replaceState(null, '', callbackPath);
      reactRoot.render(<AuthCallbackFailure onHome={clearContinuation} retryAvailable={false} />);
    } else {
      const controller = new AbortController();
      window.addEventListener('pagehide', () => controller.abort(), { once: true });
      let retryAvailable = false;
      const renderFailure = () =>
        reactRoot.render(
          <AuthCallbackFailure
            onRetry={() => {
              retryAvailable = false;
              void bootstrap();
            }}
            onHome={clearContinuation}
            retryAvailable={retryAvailable}
          />,
        );
      // Only a failed callback exchange retains a retry; token and API checks start after replacement.
      const bootstrap = async () => {
        reactRoot.render(
          <main className="app-shell auth-callback-progress">
            <img src="/assets/kendo-menu-logo-264.webp" alt="KendoMenu" width="132" height="66" />
            <p className="auth-progress-message" role="status">
              Signing you in…
            </p>
          </main>,
        );
        const result = await client.bootstrapCallback(controller.signal);
        if (result.status === 'callback-failed') {
          retryAvailable = true;
          renderFailure();
        } else if (result.status === 'unavailable') {
          clearContinuation();
          window.history.replaceState(null, '', callbackPath);
          renderFailure();
        }
      };
      void bootstrap();
    }
  }
}
