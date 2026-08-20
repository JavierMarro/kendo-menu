import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { persist, type StateStorage } from 'zustand/middleware';

import {
  asTrainingSetId,
  isValidRepetitionCount,
  TrainingValidationError,
  validateTrainingSetInput,
  type DashboardEntry,
  type TrainingSection,
  type TrainingSet,
  type TrainingSetId,
  type TrainingSetInput,
  type TrainingStep,
} from '@kendo-menu/domain';

import {
  createTrainingJSONStorage,
  inspectTrainingStorage,
  migratePersistedTrainingState,
  parsePersistedTrainingState,
  TRAINING_STORE_PERSISTENCE_VERSION,
  type PersistedTrainingState,
  type TrainingStorageInspection,
} from './persistence';

export type { StateStorage } from 'zustand/middleware';
export {
  classifyPersistedStorage,
  classifyRawTrainingStorage,
  classifyTrainingStorage,
  classifyTrainingStorageValue,
  createTrainingJSONStorage,
  inspectTrainingRawValue,
  inspectPersistedTrainingStorage,
  inspectTrainingStorage,
  migratePersistedTrainingState,
  migratePersistedTrainingStateV0ToV1,
  migratePersistedTrainingStateV1ToV2,
  migrateV0ToV1,
  migrateV1ToV2,
  parsePersistedTrainingState,
  parsePersistedTrainingStateV0,
  parsePersistedTrainingStateV1,
  TRAINING_STORE_PERSISTENCE_VERSION,
} from './persistence';
export type {
  LegacyPersistedTrainingState,
  LegacyTrainingSet,
  PersistedStorageState,
  PersistedTrainingState,
  TrainingStorageInspection,
} from './persistence';

export interface DashboardEntryPatch {
  readonly repOverrides?: Readonly<Record<string, number>>;
  readonly notes?: string;
}

export interface RemovedDashboardEntry {
  readonly entry: DashboardEntry;
  readonly index: number;
}

export interface CustomTrainingSetCreationResult {
  readonly trainingSetId: TrainingSetId;
  readonly dashboardEntryId: string;
  readonly trainingSet: TrainingSet;
  readonly dashboardEntry: DashboardEntry;
}

export interface TrainingStore {
  readonly dashboardEntries: readonly DashboardEntry[];
  readonly customTrainingSets: readonly TrainingSet[];
  readonly addToDashboard: (trainingSetId: TrainingSetId) => string;
  readonly updateDashboardEntry: (entryId: string, patch: DashboardEntryPatch) => void;
  readonly removeFromDashboard: (entryId: string) => RemovedDashboardEntry | null;
  readonly restoreDashboardEntry: (removed: RemovedDashboardEntry) => void;
  readonly undoRemoveFromDashboard: (removed: RemovedDashboardEntry) => void;
  readonly addCustomTrainingSet: (input: TrainingSetInput) => TrainingSetId;
  readonly createCustomTrainingSetAndAddToDashboard: (
    input: TrainingSetInput,
  ) => CustomTrainingSetCreationResult;
}

export interface TrainingStoreOptions {
  readonly storage: StateStorage;
  readonly storageKey?: string;
}

export type TrainingStoreApi = UseBoundStore<StoreApi<TrainingStore>>;

interface HydratableTrainingStoreApi extends TrainingStoreApi {
  readonly persist: {
    readonly rehydrate: () => void | Promise<void>;
  };
}

export class TrainingStoreBootstrapError extends Error {
  readonly inspection: TrainingStorageInspection;

  constructor(inspection: TrainingStorageInspection) {
    super(`Training-store storage is not writable (${inspection.status}).`);
    this.name = 'TrainingStoreBootstrapError';
    this.inspection = inspection;
  }
}

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === 'object' && value !== null && 'then' in value;
}

function ensureWritableInspection(
  inspection: TrainingStorageInspection,
): asserts inspection is Extract<
  TrainingStorageInspection,
  { readonly status: 'empty' | 'ready' | 'migrated' }
> {
  if (
    inspection.status !== 'empty' &&
    inspection.status !== 'ready' &&
    inspection.status !== 'migrated'
  ) {
    throw new TrainingStoreBootstrapError(inspection);
  }
}

function collectUsedIds(
  state: Pick<TrainingStore, 'dashboardEntries' | 'customTrainingSets'>,
): Set<string> {
  const usedIds = new Set<string>();
  for (const trainingSet of state.customTrainingSets) {
    usedIds.add(trainingSet.id);
    for (const section of trainingSet.sections) {
      usedIds.add(section.id);
      for (const step of section.steps) {
        usedIds.add(step.id);
      }
    }
  }
  for (const entry of state.dashboardEntries) {
    usedIds.add(entry.id);
  }
  return usedIds;
}

function createUniqueId(prefix: string, usedIds: Set<string>): string {
  let id = `${prefix}-${createId()}`;
  let collision = 0;
  while (usedIds.has(id)) {
    collision += 1;
    id = `${prefix}-${createId()}-${collision}`;
  }
  usedIds.add(id);
  return id;
}

function normalizeRepOverrides(value: unknown): Readonly<Record<string, number>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Dashboard repetition overrides must be an object.');
  }

  const entries: [string, number][] = [];
  for (const [stepId, reps] of Object.entries(value)) {
    if (!isValidRepetitionCount(reps)) {
      throw new Error(`Dashboard repetition override for ${stepId} is invalid.`);
    }
    entries.push([stepId, reps]);
  }
  return Object.fromEntries(entries);
}

function buildCustomTrainingSet(input: TrainingSetInput, usedIds: Set<string>): TrainingSet {
  const validation = validateTrainingSetInput(input);
  if (!validation.success) {
    throw new TrainingValidationError(validation.issues);
  }

  const validatedInput = validation.value;
  const setId = asTrainingSetId(createUniqueId('custom-set', usedIds));
  const sections: TrainingSection[] = validatedInput.sections.map((sectionInput) => {
    const sectionId = createUniqueId('custom-section', usedIds);
    const steps: TrainingStep[] = sectionInput.steps.map((stepInput) => {
      const stepId = createUniqueId('custom-step', usedIds);
      const step: TrainingStep = {
        id: stepId,
        label: stepInput.label,
        defaultReps: stepInput.defaultReps,
        repUnit: 'repetitions',
      };
      return stepInput.description === undefined
        ? step
        : { ...step, description: stepInput.description };
    });
    return { id: sectionId, label: sectionInput.label, steps };
  });

  return {
    id: setId,
    name: validatedInput.name,
    description: validatedInput.description,
    category: 'custom',
    sections,
    isBuiltIn: false,
  };
}

function createDashboardEntry(trainingSetId: TrainingSetId, usedIds: Set<string>): DashboardEntry {
  return {
    id: createUniqueId('dashboard-entry', usedIds),
    trainingSetId,
    repOverrides: {},
    notes: '',
    createdAt: new Date().toISOString(),
  };
}

function createValidatedTrainingStore(
  { storage, storageKey = 'kendo-menu' }: TrainingStoreOptions,
  skipHydration = false,
): HydratableTrainingStoreApi {
  return create<TrainingStore>()(
    persist(
      (set) => ({
        dashboardEntries: [],
        customTrainingSets: [],
        addToDashboard: (trainingSetId) => {
          let entryId = '';
          set((state) => {
            const usedIds = collectUsedIds(state);
            const entry = createDashboardEntry(trainingSetId, usedIds);
            entryId = entry.id;
            return { dashboardEntries: [...state.dashboardEntries, entry] };
          });
          return entryId;
        },
        updateDashboardEntry: (entryId, patch) => {
          const repOverrides =
            patch.repOverrides === undefined
              ? undefined
              : normalizeRepOverrides(patch.repOverrides);
          if (patch.notes !== undefined && typeof patch.notes !== 'string') {
            throw new Error('Dashboard notes must be a string.');
          }

          set((state) => ({
            dashboardEntries: state.dashboardEntries.map((entry) =>
              entry.id === entryId
                ? {
                    ...entry,
                    ...(repOverrides === undefined ? {} : { repOverrides }),
                    ...(patch.notes === undefined ? {} : { notes: patch.notes }),
                  }
                : entry,
            ),
          }));
        },
        removeFromDashboard: (entryId) => {
          let removed: RemovedDashboardEntry | null = null;
          set((state) => {
            const index = state.dashboardEntries.findIndex((entry) => entry.id === entryId);
            if (index < 0) {
              return state;
            }
            const entry = state.dashboardEntries[index];
            if (entry === undefined) {
              return state;
            }
            removed = { entry, index };
            return {
              dashboardEntries: [
                ...state.dashboardEntries.slice(0, index),
                ...state.dashboardEntries.slice(index + 1),
              ],
            };
          });
          return removed;
        },
        restoreDashboardEntry: (removed) => {
          set((state) => {
            if (state.dashboardEntries.some((entry) => entry.id === removed.entry.id)) {
              return state;
            }
            const index = Math.max(0, Math.min(removed.index, state.dashboardEntries.length));
            const dashboardEntries = [...state.dashboardEntries];
            dashboardEntries.splice(index, 0, removed.entry);
            return { dashboardEntries };
          });
        },
        undoRemoveFromDashboard: (removed) => {
          set((state) => {
            if (state.dashboardEntries.some((entry) => entry.id === removed.entry.id)) {
              return state;
            }
            const index = Math.max(0, Math.min(removed.index, state.dashboardEntries.length));
            const dashboardEntries = [...state.dashboardEntries];
            dashboardEntries.splice(index, 0, removed.entry);
            return { dashboardEntries };
          });
        },
        addCustomTrainingSet: (input) => {
          let trainingSetId: TrainingSetId = asTrainingSetId('');
          set((state) => {
            const usedIds = collectUsedIds(state);
            const trainingSet = buildCustomTrainingSet(input, usedIds);
            trainingSetId = trainingSet.id;
            return { customTrainingSets: [...state.customTrainingSets, trainingSet] };
          });
          return trainingSetId;
        },
        createCustomTrainingSetAndAddToDashboard: (input) => {
          let result: CustomTrainingSetCreationResult | null = null;
          set((state) => {
            const usedIds = collectUsedIds(state);
            const trainingSet = buildCustomTrainingSet(input, usedIds);
            const dashboardEntry = createDashboardEntry(trainingSet.id, usedIds);
            result = {
              trainingSetId: trainingSet.id,
              dashboardEntryId: dashboardEntry.id,
              trainingSet,
              dashboardEntry,
            };
            return {
              customTrainingSets: [...state.customTrainingSets, trainingSet],
              dashboardEntries: [...state.dashboardEntries, dashboardEntry],
            };
          });
          if (result === null) {
            throw new Error('Custom training-set creation did not produce a result.');
          }
          return result;
        },
      }),
      {
        name: storageKey,
        storage: createTrainingJSONStorage(storage),
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
        skipHydration,
      },
    ),
  );
}

export function createTrainingStore(options: TrainingStoreOptions): TrainingStoreApi {
  const storageKey = options.storageKey ?? 'kendo-menu';
  const inspection = inspectTrainingStorage(options.storage, storageKey);
  if (isPromiseLike(inspection)) {
    throw new TrainingStoreBootstrapError({ status: 'unavailable', kind: 'unavailable' });
  }
  ensureWritableInspection(inspection);
  return createValidatedTrainingStore(options);
}

export async function createTrainingStoreAsync(
  options: TrainingStoreOptions,
): Promise<TrainingStoreApi> {
  const storageKey = options.storageKey ?? 'kendo-menu';
  const inspection = await inspectTrainingStorage(options.storage, storageKey);
  ensureWritableInspection(inspection);
  const store = createValidatedTrainingStore(options, true);
  await store.persist.rehydrate();
  return store;
}
