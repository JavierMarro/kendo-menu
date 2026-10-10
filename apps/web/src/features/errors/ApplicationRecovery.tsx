import { useState, type ReactNode } from 'react';

import { AppErrorBoundary } from './AppErrorBoundary';
import { PersistenceGate } from '../persistence/PersistenceGate';

/** Keeps route errors isolated without mounting guest persistence on public/account routes. */
export function ApplicationRecovery({ children }: { readonly children: ReactNode }) {
  return <AppErrorBoundary>{children}</AppErrorBoundary>;
}

/** Preserve the existing guest store while recovering a failed editor; account routes never mount it. */
export function GuestApplicationRecovery({ children }: { readonly children: ReactNode }) {
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
