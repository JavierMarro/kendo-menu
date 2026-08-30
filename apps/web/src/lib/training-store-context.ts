import { useContext } from 'react';
import type { TrainingStore } from '@kendo-menu/store';

import { TrainingStoreContext, type TrainingStoreHook } from './training-store-context-value';

export { TrainingStoreProvider } from './training-store-provider';

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
