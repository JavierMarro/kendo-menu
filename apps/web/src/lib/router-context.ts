import { useContext } from 'react';

import { DataRouterModeContext } from './router-context-value';

export { DataRouterModeProvider } from './data-router-mode-provider';

export function useDataRouterMode(): boolean {
  return useContext(DataRouterModeContext);
}
