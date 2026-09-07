import { useState, type ReactNode } from 'react';

import { AppErrorBoundary } from './AppErrorBoundary';
import { PersistenceGate } from '../persistence/PersistenceGate';

/** The inner boundary preserves the live store; the outer boundary also protects recovery itself. */
export function ApplicationRecovery({ children }: { readonly children: ReactNode }) {
  const [recoveryRequested, setRecoveryRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);

  return (
    <AppErrorBoundary>
      <PersistenceGate
        recoveryRequested={recoveryRequested}
        onRecoveryComplete={() => {
          setRecoveryRequested(false);
          setAttempt((current) => current + 1);
        }}
      >
        <AppErrorBoundary key={attempt} onRecovery={() => setRecoveryRequested(true)}>
          {children}
        </AppErrorBoundary>
      </PersistenceGate>
    </AppErrorBoundary>
  );
}
