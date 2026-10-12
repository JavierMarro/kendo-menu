/**
 * Exposes the training store instance supplied by the active workspace route.
 * Required hooks fail loudly outside that provider; the optional API hook supports route-boundary
 * composition where guest and account owners decide whether a store already exists.
 */
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

export function useOptionalTrainingStoreApi(): TrainingStoreHook | null {
  return useContext(TrainingStoreContext);
}
