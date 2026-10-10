import { createRoot } from 'react-dom/client';

import {
  PROOF_CALLBACK_PATH,
  clearAuthReturnMarker,
  resolveAuthReturn,
} from '../../lib/auth-return';
import { createManagedProofClient } from '../../lib/managed-auth-proof';
import { ManagedAuthProof } from './ManagedAuthProof';
import { AuthCallbackFailure } from '../auth-callback/AuthCallbackFailure';
import '../../styles.css';

const root = document.getElementById('root');
if (import.meta.env.DEV && root !== null) {
  const resolution = resolveAuthReturn(window.location.pathname, window.location.search);
  if (
    resolution.kind === 'invalid' ||
    resolution.kind === 'cancelled' ||
    (resolution.kind === 'callback' && resolution.flow !== 'proof')
  ) {
    clearAuthReturnMarker();
    window.history.replaceState(null, '', PROOF_CALLBACK_PATH);
    createRoot(root).render(
      <AuthCallbackFailure onHome={clearAuthReturnMarker} retryAvailable={false} />,
    );
  } else {
    const configuredUrl: unknown = import.meta.env['VITE_NEON_AUTH_URL'];
    const client =
      typeof configuredUrl === 'string' ? createManagedProofClient(configuredUrl) : undefined;
    if (client === undefined && resolution.kind === 'callback') {
      clearAuthReturnMarker();
      window.history.replaceState(null, '', PROOF_CALLBACK_PATH);
    }
    createRoot(root).render(<ManagedAuthProof client={client} />);
  }
}
