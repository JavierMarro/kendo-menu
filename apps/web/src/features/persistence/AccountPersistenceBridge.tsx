import { useContext, type ReactNode } from 'react';

import type { AccountWorkspaceContextValue } from '../account/AccountWorkspaceProvider';
import { PersistenceContext } from './persistence-context';

/** Selects the verified account writer for account pages while preserving the guest writer elsewhere. */
export function AccountPersistenceBridge({
  children,
  workspace,
}: {
  readonly children: ReactNode;
  readonly workspace: AccountWorkspaceContextValue;
}) {
  const inherited = useContext(PersistenceContext);
  const snapshot = workspace.snapshot;

  if (inherited === null || snapshot.mode !== 'account') {
    return <>{children}</>;
  }

  return (
    <PersistenceContext.Provider
      value={{
        mode: 'account',
        writeFailed: snapshot.persistenceFailure !== null,
        pending: snapshot.persistencePending,
        flush: workspace.controller.flushPersistence,
      }}
    >
      {children}
    </PersistenceContext.Provider>
  );
}
