import { createContext, useContext } from 'react';
import type { createTrainingStore, TrainingStore } from '@kendo-menu/store';

export { TrainingStoreProvider } from './training-store-provider';

export type TrainingStoreHook = ReturnType<typeof createTrainingStore>;

export const TrainingStoreContext = createContext<TrainingStoreHook | null>(null);

export function useTrainingStore<T>(selector: (state: TrainingStore) => T): T {
  const store = useContext(TrainingStoreContext);

  if (store === null) {
    throw new Error('useTrainingStore must be used inside TrainingStoreProvider.');
  }

  return store(selector);
}

export function useTrainingStoreApi(): TrainingStoreHook {
  const store = useContext(TrainingStoreContext);

  if (store === null) {
    throw new Error('useTrainingStoreApi must be used inside TrainingStoreProvider.');
  }

  return store;
}
