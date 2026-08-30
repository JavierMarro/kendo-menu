import type { ReactNode } from 'react';

import { TrainingStoreContext, type TrainingStoreHook } from './training-store-context-value';

interface TrainingStoreProviderProps {
  readonly store: TrainingStoreHook;
  readonly children: ReactNode;
}

export function TrainingStoreProvider({ store, children }: TrainingStoreProviderProps) {
  return <TrainingStoreContext.Provider value={store}>{children}</TrainingStoreContext.Provider>;
}
