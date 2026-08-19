import { create } from 'zustand';
import { persist, type StateStorage } from 'zustand/middleware';

import {
  asTrainingSetId,
  type DashboardEntry,
  type TrainingSet,
  type TrainingSetId,
  type TrainingSetInput,
} from '@kendo-menu/domain';

import {
  createTrainingPersistStorage,
  migratePersistedTrainingState,
  parsePersistedTrainingState,
  TRAINING_STORE_PERSISTENCE_VERSION,
  type PersistedTrainingState,
} from './persistence';

export type { StateStorage } from 'zustand/middleware';

export interface DashboardEntryPatch {
  readonly repOverrides?: Readonly<Record<string, number>>;
  readonly notes?: string;
}

export interface TrainingStore {
  readonly dashboardEntries: readonly DashboardEntry[];
  readonly customTrainingSets: readonly TrainingSet[];
  readonly addToDashboard: (trainingSetId: TrainingSetId) => void;
  readonly updateDashboardEntry: (entryId: string, patch: DashboardEntryPatch) => void;
  readonly removeFromDashboard: (entryId: string) => void;
  readonly addCustomTrainingSet: (input: TrainingSetInput) => TrainingSetId;
}

export interface TrainingStoreOptions {
  readonly storage: StateStorage;
  readonly storageKey?: string;
}

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createTrainingStore({ storage, storageKey = 'kendo-menu' }: TrainingStoreOptions) {
  return create<TrainingStore>()(
    persist(
      (set) => ({
        dashboardEntries: [],
        customTrainingSets: [],
        addToDashboard: (trainingSetId) =>
          set((state) => ({
            dashboardEntries: [
              ...state.dashboardEntries,
              {
                id: createId(),
                trainingSetId,
                repOverrides: {},
                notes: '',
                createdAt: new Date().toISOString(),
              },
            ],
          })),
        updateDashboardEntry: (entryId, patch) =>
          set((state) => ({
            dashboardEntries: state.dashboardEntries.map((entry) =>
              entry.id === entryId
                ? {
                    ...entry,
                    ...(patch.repOverrides === undefined
                      ? {}
                      : { repOverrides: patch.repOverrides }),
                    ...(patch.notes === undefined ? {} : { notes: patch.notes }),
                  }
                : entry,
            ),
          })),
        removeFromDashboard: (entryId) =>
          set((state) => ({
            dashboardEntries: state.dashboardEntries.filter((entry) => entry.id !== entryId),
          })),
        addCustomTrainingSet: (input) => {
          const id = asTrainingSetId(`custom-${createId()}`);
          const trainingSet: TrainingSet = {
            ...input,
            id,
            isBuiltIn: false,
          };

          set((state) => ({
            customTrainingSets: [...state.customTrainingSets, trainingSet],
          }));

          return id;
        },
      }),
      {
        name: storageKey,
        storage: createTrainingPersistStorage(storage),
        version: TRAINING_STORE_PERSISTENCE_VERSION,
        migrate: migratePersistedTrainingState,
        merge: (persistedState, currentState) => {
          const parsedState = parsePersistedTrainingState(persistedState);

          return parsedState === null
            ? currentState
            : {
                ...currentState,
                dashboardEntries: parsedState.dashboardEntries,
                customTrainingSets: parsedState.customTrainingSets,
              };
        },
        partialize: (state): PersistedTrainingState => ({
          dashboardEntries: state.dashboardEntries,
          customTrainingSets: state.customTrainingSets,
        }),
      },
    ),
  );
}
