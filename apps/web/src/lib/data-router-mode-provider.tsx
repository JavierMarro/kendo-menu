import type { ReactNode } from 'react';

import { DataRouterModeContext } from './router-context-value';

interface DataRouterModeProviderProps {
  readonly children: ReactNode;
}

export function DataRouterModeProvider({ children }: DataRouterModeProviderProps) {
  return <DataRouterModeContext.Provider value={true}>{children}</DataRouterModeContext.Provider>;
}
