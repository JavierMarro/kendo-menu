/**
 * Keeps unexpected UI failures outside route rendering and provides a separate guest recovery
 * boundary. The guest persistence gate remains mounted while only the failed editor subtree is
 * retried; public and account routes do not mount guest persistence.
 */
import { useState, type ReactNode } from 'react';

import { AppErrorBoundary } from './AppErrorBoundary';
import { PersistenceGate } from '../persistence/PersistenceGate';

export function ApplicationRecovery({ children }: { readonly children: ReactNode }) {
  return <AppErrorBoundary>{children}</AppErrorBoundary>;
}

export function GuestApplicationRecovery({
  children,
  recoveryLayout,
}: {
  readonly children: ReactNode;
  readonly recoveryLayout?: (recoveryView: ReactNode) => ReactNode;
}) {
  const [recoveryRequested, setRecoveryRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <AppErrorBoundary>
      <PersistenceGate
        {...(recoveryLayout === undefined ? {} : { recoveryLayout })}
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
