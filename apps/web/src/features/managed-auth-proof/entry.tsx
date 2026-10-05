import { createRoot } from 'react-dom/client';

import { createManagedProofClient } from '../../lib/managed-auth-proof';
import { ManagedAuthProof } from './ManagedAuthProof';

const root = document.getElementById('root');
if (import.meta.env.DEV && root !== null) {
  const configuredUrl: unknown = import.meta.env['VITE_NEON_AUTH_URL'];
  createRoot(root).render(
    <ManagedAuthProof
      client={
        typeof configuredUrl === 'string' ? createManagedProofClient(configuredUrl) : undefined
      }
    />,
  );
}
