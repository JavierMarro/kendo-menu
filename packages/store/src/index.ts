import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { persist, type StateStorage } from 'zustand/middleware';

import {
  DEFAULT_TRAINING_SETS,
  asTrainingSetId,
  cloneTrainingSet,
  getEffectiveTrainingQuantity,
  getTrainingSetActivities,
  isTrainingQuantityUnit,
  isValidTrainingQuantityValue,
  TrainingValidationError,
  validateTrainingSet,
  validateTrainingSetInput,
  type DashboardActivityNotes,
  type DashboardEntry,
  type DashboardQuantityOverrides,
  type TrainingActivity,
  type TrainingQuantities,
  type TrainingQuantityOverrides,
  type TrainingQuantityUnit,
  type TrainingQuantityValue,
  type TrainingSet,
  type TrainingSetId,
  type TrainingSetInput,
} from '@kendo-menu/domain';

import {
  createTrainingJSONStorage,
  inspectTrainingStorage,
  migratePersistedTrainingState,
  parsePersistedTrainingStateV10,
  TRAINING_STORE_PERSISTENCE_VERSION,
  type PersistedTrainingStateV10,
  type TrainingStorageInspection,
} from './persistence';

export type { StateStorage } from 'zustand/middleware';
export {
  classifyPersistedStorage,
  classifyRawTrainingStorage,
  classifyTrainingStorage,
  classifyTrainingStorageValue,
  createTrainingJSONStorage,
  encodePersistedTrainingState,
  encodePersistedTrainingStateV10,
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
  migratePersistedTrainingStateV6ToV7,
  migratePersistedTrainingStateV7ToV8,
  migratePersistedTrainingStateV8ToV9,
  migratePersistedTrainingStateV9ToV10,
  migrateV0ToV1,
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  migrateV4ToV5,
  migrateV5ToV6,
  migrateV6ToV7,
  migrateV7ToV8,
  migrateV8ToV9,
  migrateV9ToV10,
  parsePersistedTrainingState,
  parsePersistedTrainingStateV0,
  parsePersistedTrainingStateV1,
  parsePersistedTrainingStateV2,
  parsePersistedTrainingStateV3,
  parsePersistedTrainingStateV4,
  parsePersistedTrainingStateV8,
  parsePersistedTrainingStateV9,
  parsePersistedTrainingStateV10,
  parsePersistedTrainingWireStateV9,
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
  PersistedTrainingStateV9,
  PersistedTrainingExercise,
  PersistedTrainingSection,
  PersistedCustomTrainingSet,
  PersistedTrainingWireState,
  PersistedTrainingWireStateV9,
  PersistedTrainingStateV5,
  PersistedTrainingStateV6,
  PersistedTrainingStateV7,
  PersistedDashboardEntryV8,
  PersistedTrainingStateV8,
  PersistedTrainingStateV10,
  PersistedDashboardEntryV10,
  PersistedTrainingWireStateV10,
  PersistedTrainingWireStateV8,
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
  readonly setActivityNote: (entryId: string, activityId: string, note: string) => void;
  readonly removeFromDashboard: (entryId: string) => RemovedDashboardEntry | null;
  readonly restoreDashboardEntry: (removed: RemovedDashboardEntry) => void;
  readonly undoRemoveFromDashboard: (removed: RemovedDashboardEntry) => void;
  readonly createCustomTrainingSetAndAddToDashboard: (
    input: TrainingSetInput,
  ) => CustomTrainingSetCreationResult;
}

export interface TrainingStoreOptions {
  readonly storage: StateStorage;
  readonly storageKey?: string;
  readonly onHydrationError?: (error: unknown) => void;
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

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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

function collectUsedIds(state: Pick<TrainingStore, 'dashboardEntries'>): Set<string> {
  const usedIds = new Set<string>();
  for (const trainingSet of DEFAULT_TRAINING_SETS) {
    usedIds.add(trainingSet.id);
    for (const activity of getTrainingSetActivities(trainingSet)) {
      usedIds.add(activity.id);
    }
  }
  for (const entry of state.dashboardEntries) {
    usedIds.add(entry.id);
    if (entry.trainingSet !== undefined) {
      usedIds.add(entry.trainingSet.id);
      for (const activity of getTrainingSetActivities(entry.trainingSet)) {
        usedIds.add(activity.id);
      }
    }
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

function setDashboardActivityNote(
  activityNotes: DashboardActivityNotes,
  activityId: string,
  note: string,
): DashboardActivityNotes {
  const next: Record<string, string> = { ...activityNotes };
  if (note.trim().length === 0) {
    delete next[activityId];
  } else {
    next[activityId] = note;
  }
  return Object.freeze(next);
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
  const activities: TrainingActivity[] = validatedInput.sections.map((sectionInput) => {
    const sectionId = createUniqueId('custom-section', usedIds);
    const children: TrainingActivity[] = sectionInput.exercises.map((exerciseInput) => {
      const exerciseId = createUniqueId('custom-exercise', usedIds);
      return {
        id: exerciseId,
        name: exerciseInput.name,
        ...(exerciseInput.quantities === undefined
          ? {}
          : { quantities: copyQuantities(exerciseInput.quantities) }),
        ...(exerciseInput.notes === undefined ? {} : { notes: exerciseInput.notes }),
        children: [],
      };
    });
    return {
      id: sectionId,
      name: sectionInput.name,
      ...(sectionInput.quantities === undefined
        ? {}
        : { quantities: copyQuantities(sectionInput.quantities) }),
      ...(sectionInput.notes === undefined ? {} : { notes: sectionInput.notes }),
      children,
    };
  });

  const candidate: unknown = {
    id: setId,
    name: validatedInput.name,
    ...(validatedInput.description === undefined
      ? {}
      : { description: validatedInput.description }),
    category: 'custom',
    ...(validatedInput.customIntensity === undefined
      ? {}
      : { customIntensity: validatedInput.customIntensity }),
    activities,
    isBuiltIn: false,
  };
  const result = validateTrainingSet(candidate);
  if (!result.success) {
    throw new TrainingValidationError(result.issues);
  }
  return result.value;
}

function findTrainingSetSource(trainingSetId: TrainingSetId): TrainingSet | undefined {
  return DEFAULT_TRAINING_SETS.find((trainingSet) => trainingSet.id === trainingSetId);
}

function createDashboardEntry(
  trainingSetId: TrainingSetId,
  usedIds: Set<string>,
  trainingSet?: TrainingSet,
): DashboardEntry {
  return {
    id: createUniqueId('dashboard-entry', usedIds),
    trainingSetId,
    ...(trainingSet === undefined ? {} : { trainingSet: cloneTrainingSet(trainingSet) }),
    quantityOverrides: {},
    activityNotes: Object.freeze({}),
    notes: '',
    createdAt: new Date().toISOString(),
  };
}

function createValidatedTrainingStore(
  options: TrainingStoreOptions,
  skipHydration = false,
): HydratableTrainingStoreApi {
  const { storage, storageKey = 'kendo-menu' } = options;

  return create<TrainingStore>()(
    persist(
      (set, get) => ({
        dashboardEntries: [],
        addToDashboard: (trainingSetId) => {
          let entryId = '';
          set((state) => {
            const usedIds = collectUsedIds(state);
            const source = findTrainingSetSource(trainingSetId);
            const entry =
              source === undefined
                ? createDashboardEntry(trainingSetId, usedIds)
                : createDashboardEntry(trainingSetId, usedIds, source);
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
        setActivityNote: (entryId, activityId, note) => {
          if (!isNonBlankString(entryId)) {
            throw new Error('Dashboard entry ids must not be blank.');
          }
          if (!isNonBlankString(activityId)) {
            throw new Error('Dashboard activity note ids must not be blank.');
          }
          if (typeof note !== 'string') {
            throw new Error('Dashboard activity notes must be strings.');
          }

          const entry = get().dashboardEntries.find((candidate) => candidate.id === entryId);
          if (entry === undefined) {
            throw new Error(`Dashboard entry ${entryId} does not exist.`);
          }
          const trainingSet = entry.trainingSet ?? findTrainingSetSource(entry.trainingSetId);
          if (trainingSet === undefined) {
            throw new Error(`Dashboard entry ${entryId} has no available training session.`);
          }
          const activity = getTrainingSetActivities(trainingSet).find(
            (candidate) => candidate.id === activityId,
          );
          if (activity === undefined || activity.allowsSessionNotes !== true) {
            throw new Error(`Activity ${activityId} does not allow dashboard notes.`);
          }

          const activityNotes = setDashboardActivityNote(entry.activityNotes, activityId, note);
          set((state) => ({
            dashboardEntries: state.dashboardEntries.map((candidate) =>
              candidate.id === entryId ? { ...candidate, activityNotes } : candidate,
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
        createCustomTrainingSetAndAddToDashboard: (input) => {
          let result: CustomTrainingSetCreationResult | null = null;
          set((state) => {
            const usedIds = collectUsedIds(state);
            const trainingSet = buildCustomTrainingSet(input, usedIds);
            const dashboardEntry = createDashboardEntry(trainingSet.id, usedIds, trainingSet);
            result = {
              trainingSetId: trainingSet.id,
              dashboardEntryId: dashboardEntry.id,
              trainingSet,
              dashboardEntry,
            };
            return {
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
          const parsedState = parsePersistedTrainingStateV10(persistedState);
          return parsedState === null
            ? currentState
            : {
                ...currentState,
                dashboardEntries: parsedState.dashboardEntries,
              };
        },
        partialize: (state): PersistedTrainingStateV10 => ({
          dashboardEntries: state.dashboardEntries,
        }),
        onRehydrateStorage: () => (_state, error) => {
          if (error !== undefined) {
            options.onHydrationError?.(error);
          }
        },
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
