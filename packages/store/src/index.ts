import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { persist, type StateStorage } from 'zustand/middleware';

import {
  asTrainingSetId,
  getEffectiveTrainingQuantity,
  isTrainingQuantityUnit,
  isValidTrainingQuantityValue,
  TrainingValidationError,
  validateTrainingSetInput,
  type DashboardEntry,
  type DashboardQuantityOverrides,
  type TrainingActivity,
  type TrainingExercise,
  type TrainingQuantities,
  type TrainingQuantityOverrides,
  type TrainingQuantityUnit,
  type TrainingQuantityValue,
  type TrainingSection,
  type TrainingSet,
  type TrainingSetId,
  type TrainingSetInput,
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
  migratePersistedTrainingStateV2ToV3,
  migratePersistedTrainingStateV3ToV4,
  migratePersistedTrainingStateV4ToV5,
  migratePersistedTrainingStateV5ToV6,
  migrateV0ToV1,
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  migrateV4ToV5,
  migrateV5ToV6,
  parsePersistedTrainingState,
  parsePersistedTrainingStateV0,
  parsePersistedTrainingStateV1,
  parsePersistedTrainingStateV2,
  parsePersistedTrainingStateV3,
  parsePersistedTrainingStateV4,
  TrainingDurationOverrideMigrationConflictError,
  TrainingOverrideMigrationConflictError,
  TRAINING_STORE_PERSISTENCE_VERSION,
} from './persistence';
export type {
  LegacyPersistedTrainingState,
  LegacyPersistedTrainingStateV2,
  LegacyPersistedTrainingStateV3,
  LegacyPersistedTrainingStateV4,
  LegacyDashboardEntry,
  LegacyTrainingSectionV2,
  LegacyTrainingSet,
  LegacyTrainingSetV2,
  LegacyTrainingStep,
  LegacyTrainingStepV4,
  PersistedStorageState,
  PersistedTrainingState,
  PersistedTrainingStateV5,
  TrainingDurationOverrideMigrationConflict,
  TrainingOverrideMigrationConflict,
  TrainingStorageInspection,
} from './persistence';

export interface DashboardEntryPatch {
  readonly quantityOverrides?: DashboardQuantityOverrides;
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
  readonly setQuantityOverride: (
    entryId: string,
    activityId: string,
    unit: TrainingQuantityUnit,
    value: number,
  ) => void;
  readonly clearQuantityOverride: (
    entryId: string,
    activityId: string,
    unit: TrainingQuantityUnit,
  ) => void;
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
    super(
      inspection.status === 'corrupt' && inspection.reason === 'override-migration-conflict'
        ? inspection.detail
        : `Training-store storage is not writable (${inspection.status}).`,
    );
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
      for (const exercise of section.exercises) {
        usedIds.add(exercise.id);
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

function normalizeQuantityOverrides(value: unknown): DashboardQuantityOverrides {
  if (!isRecord(value)) {
    throw new Error('Dashboard quantity overrides must be an object.');
  }

  const entries: [string, TrainingQuantityOverrides][] = [];
  for (const [activityId, activityValue] of Object.entries(value)) {
    if (activityId.trim().length === 0) {
      throw new Error('Dashboard quantity override activity ids must not be blank.');
    }
    if (!isRecord(activityValue)) {
      throw new Error(`Dashboard quantity overrides for ${activityId} must be an object.`);
    }

    const unitEntries: [TrainingQuantityUnit, number][] = [];
    for (const [unit, quantityValue] of Object.entries(activityValue)) {
      if (
        !isTrainingQuantityUnit(unit) ||
        quantityValue === null ||
        !isValidTrainingQuantityValue(unit, quantityValue)
      ) {
        throw new Error(`Dashboard ${unit} override for ${activityId} is invalid.`);
      }
      unitEntries.push([unit, quantityValue]);
    }
    if (unitEntries.length === 0) {
      throw new Error(`Dashboard quantity overrides for ${activityId} must not be empty.`);
    }
    entries.push([activityId, Object.fromEntries(unitEntries)]);
  }
  return Object.fromEntries(entries);
}

export function setDashboardQuantityOverride(
  overrides: DashboardQuantityOverrides,
  activityId: string,
  unit: TrainingQuantityUnit,
  value: number,
): DashboardQuantityOverrides {
  if (activityId.trim().length === 0) {
    throw new Error('Dashboard quantity override activity ids must not be blank.');
  }
  if (!isValidTrainingQuantityValue(unit, value)) {
    throw new Error(`Dashboard ${unit} override for ${activityId} is invalid.`);
  }
  return {
    ...overrides,
    [activityId]: {
      ...overrides[activityId],
      [unit]: value,
    },
  };
}

export function clearDashboardQuantityOverride(
  overrides: DashboardQuantityOverrides,
  activityId: string,
  unit: TrainingQuantityUnit,
): DashboardQuantityOverrides {
  const existing = overrides[activityId];
  if (existing === undefined || !Object.hasOwn(existing, unit)) {
    return overrides;
  }

  const nextActivity: Partial<Record<TrainingQuantityUnit, number>> = { ...existing };
  delete nextActivity[unit];
  const next: Record<string, TrainingQuantityOverrides> = { ...overrides };
  if (Object.keys(nextActivity).length === 0) {
    delete next[activityId];
  } else {
    next[activityId] = nextActivity;
  }
  return next;
}

export function getDashboardEffectiveTrainingQuantity(
  entry: DashboardEntry,
  activity: TrainingActivity,
  unit: TrainingQuantityUnit,
): TrainingQuantityValue | undefined {
  return getEffectiveTrainingQuantity(activity, entry.quantityOverrides[activity.id], unit);
}

function copyQuantities(quantities: TrainingQuantities): TrainingQuantities {
  return {
    ...(quantities.repetitions === undefined ? {} : { repetitions: quantities.repetitions }),
    ...(quantities.sets === undefined ? {} : { sets: quantities.sets }),
    ...(quantities.rounds === undefined ? {} : { rounds: quantities.rounds }),
    ...(quantities.duration === undefined
      ? {}
      : {
          duration:
            'value' in quantities.duration
              ? { unit: quantities.duration.unit, value: quantities.duration.value }
              : {
                  unit: quantities.duration.unit,
                  min: quantities.duration.min,
                  max: quantities.duration.max,
                },
        }),
  };
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
    const exercises: TrainingExercise[] = sectionInput.exercises.map((exerciseInput) => {
      const exerciseId = createUniqueId('custom-exercise', usedIds);
      return {
        id: exerciseId,
        name: exerciseInput.name,
        ...(exerciseInput.quantities === undefined
          ? {}
          : { quantities: copyQuantities(exerciseInput.quantities) }),
        ...(exerciseInput.notes === undefined ? {} : { notes: exerciseInput.notes }),
      };
    });
    return {
      id: sectionId,
      name: sectionInput.name,
      ...(sectionInput.quantities === undefined
        ? {}
        : { quantities: copyQuantities(sectionInput.quantities) }),
      ...(sectionInput.notes === undefined ? {} : { notes: sectionInput.notes }),
      exercises,
    };
  });

  return {
    id: setId,
    name: validatedInput.name,
    ...(validatedInput.description === undefined
      ? {}
      : { description: validatedInput.description }),
    category: 'custom',
    sections,
    isBuiltIn: false,
  };
}

function createDashboardEntry(trainingSetId: TrainingSetId, usedIds: Set<string>): DashboardEntry {
  return {
    id: createUniqueId('dashboard-entry', usedIds),
    trainingSetId,
    quantityOverrides: {},
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
          const quantityOverrides =
            patch.quantityOverrides === undefined
              ? undefined
              : normalizeQuantityOverrides(patch.quantityOverrides);
          if (patch.notes !== undefined && typeof patch.notes !== 'string') {
            throw new Error('Dashboard notes must be a string.');
          }

          set((state) => ({
            dashboardEntries: state.dashboardEntries.map((entry) =>
              entry.id === entryId
                ? {
                    ...entry,
                    ...(quantityOverrides === undefined ? {} : { quantityOverrides }),
                    ...(patch.notes === undefined ? {} : { notes: patch.notes }),
                  }
                : entry,
            ),
          }));
        },
        setQuantityOverride: (entryId, activityId, unit, value) => {
          set((state) => ({
            dashboardEntries: state.dashboardEntries.map((entry) =>
              entry.id === entryId
                ? {
                    ...entry,
                    quantityOverrides: setDashboardQuantityOverride(
                      entry.quantityOverrides,
                      activityId,
                      unit,
                      value,
                    ),
                  }
                : entry,
            ),
          }));
        },
        clearQuantityOverride: (entryId, activityId, unit) => {
          set((state) => ({
            dashboardEntries: state.dashboardEntries.map((entry) =>
              entry.id === entryId
                ? {
                    ...entry,
                    quantityOverrides: clearDashboardQuantityOverride(
                      entry.quantityOverrides,
                      activityId,
                      unit,
                    ),
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
