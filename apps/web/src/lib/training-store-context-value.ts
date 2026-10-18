/**
 * Defines the context contract for injecting the active workspace's training store.
 * Its null default keeps missing provider composition detectable instead of creating a fallback store.
 */
import { createContext } from 'react';
import type { createTrainingStore } from '@kendo-menu/store';

export type TrainingStoreHook = ReturnType<typeof createTrainingStore>;

export const TrainingStoreContext = createContext<TrainingStoreHook | null>(null);
