import { createRoot } from 'react-dom/client';
import '../../styles.css';

import {
  APPLICATION_CALLBACK_PATH,
  clearAuthReturnMarker,
  resolveAuthReturn,
} from '../../lib/auth-return';
import { createManagedAuthClient } from '../../lib/managed-auth';
import { AuthCallbackFailure } from './AuthCallbackFailure';

const root = document.getElementById('root');
if (root !== null) {
  const reactRoot = createRoot(root);
  const resolution = resolveAuthReturn(window.location.pathname, window.location.search);
  if (resolution.kind !== 'callback' || resolution.flow !== 'application') {
    if (resolution.kind === 'invalid' || resolution.kind === 'cancelled') {
      clearAuthReturnMarker();
      window.history.replaceState(null, '', APPLICATION_CALLBACK_PATH);
    }
    reactRoot.render(<AuthCallbackFailure onHome={clearAuthReturnMarker} retryAvailable={false} />);
  } else {
    const configuredUrl: unknown = import.meta.env['VITE_NEON_AUTH_URL'];
    const client =
      typeof configuredUrl === 'string'
        ? createManagedAuthClient(configuredUrl, 'application')
        : undefined;
    if (client === undefined) {
      clearAuthReturnMarker();
      window.history.replaceState(null, '', APPLICATION_CALLBACK_PATH);
      reactRoot.render(
        <AuthCallbackFailure onHome={clearAuthReturnMarker} retryAvailable={false} />,
      );
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
            onHome={clearAuthReturnMarker}
            retryAvailable={retryAvailable}
          />,
        );
      reactRoot.render(
        <main className="app-shell">
          <section aria-labelledby="callback-title" className="panel">
            <h1 id="callback-title">Completing sign-in</h1>
            <p role="status">Verifying the managed sign-in response…</p>
          </section>
        </main>,
      );
      const bootstrap = async () => {
        const result = await client.bootstrapCallback(controller.signal);
        if (result.status === 'callback-failed') {
          retryAvailable = true;
          renderFailure();
        } else if (result.status === 'unavailable') {
          clearAuthReturnMarker();
          window.history.replaceState(null, '', APPLICATION_CALLBACK_PATH);
          renderFailure();
        }
      };
      void bootstrap();
    }
  }
}
