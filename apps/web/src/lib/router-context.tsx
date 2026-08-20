import { createContext, useContext, type ReactNode } from 'react';

const DataRouterModeContext = createContext(false);

interface DataRouterModeProviderProps {
  readonly children: ReactNode;
}

export function DataRouterModeProvider({ children }: DataRouterModeProviderProps) {
  return <DataRouterModeContext.Provider value={true}>{children}</DataRouterModeContext.Provider>;
}

export function useDataRouterMode(): boolean {
  return useContext(DataRouterModeContext);
}
