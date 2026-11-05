import type { ReactNode } from 'react';

import { WorkspaceContext, type WorkspaceContextValue } from './workspace-context';

export function WorkspaceContextProvider({
  value,
  children,
}: {
  readonly value: WorkspaceContextValue;
  readonly children: ReactNode;
}) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
