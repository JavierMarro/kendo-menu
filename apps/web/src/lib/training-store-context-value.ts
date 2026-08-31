import { createContext } from 'react';
import type { createTrainingStore } from '@kendo-menu/store';

export type TrainingStoreHook = ReturnType<typeof createTrainingStore>;

export const TrainingStoreContext = createContext<TrainingStoreHook | null>(null);
