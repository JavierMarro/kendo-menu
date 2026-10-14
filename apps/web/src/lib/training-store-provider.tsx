/**
 * Supplies the selected workspace's Zustand store to shared dashboard and library UI.
 * The guest gate or account controller chooses the store and storage mode before this provider
 * receives it.
 */
import type { ReactNode } from 'react';

import { TrainingStoreContext, type TrainingStoreHook } from './training-store-context-value';

interface TrainingStoreProviderProps {
  readonly store: TrainingStoreHook;
  readonly children: ReactNode;
}

export function TrainingStoreProvider({ store, children }: TrainingStoreProviderProps) {
  return <TrainingStoreContext.Provider value={store}>{children}</TrainingStoreContext.Provider>;
}
