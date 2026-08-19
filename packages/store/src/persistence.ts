import {
  asTrainingSetId,
  type DashboardEntry,
  type DrillCategory,
  type RepUnit,
  type TrainingSet,
  type TrainingStep,
} from '@kendo-menu/domain';
import {
  createJSONStorage,
  type PersistStorage,
  type StateStorage,
  type StorageValue,
} from 'zustand/middleware';

export const TRAINING_STORE_PERSISTENCE_VERSION = 1;

export interface PersistedTrainingState {
  readonly dashboardEntries: readonly DashboardEntry[];
  readonly customTrainingSets: readonly TrainingSet[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isDrillCategory(value: unknown): value is DrillCategory {
  return (
    value === 'kihon' ||
    value === 'kirikaeshi' ||
    value === 'uchikomi' ||
    value === 'kakari' ||
    value === 'jigeiko' ||
    value === 'custom'
  );
}

function isRepUnit(value: unknown): value is RepUnit {
  return (
    value === 'repetitions' ||
    value === 'sets' ||
    value === 'minutes' ||
    value === 'rounds' ||
    value === 'custom'
  );
}

function parseArray<T>(
  value: unknown,
  parseItem: (item: unknown) => T | null,
): readonly T[] | null {
  if (!isUnknownArray(value)) {
    return null;
  }

  const parsedItems: T[] = [];

  for (const item of value) {
    const parsedItem = parseItem(item);

    if (parsedItem === null) {
      return null;
    }

    parsedItems.push(parsedItem);
  }

  return parsedItems;
}

function parseTrainingStep(value: unknown): TrainingStep | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value['id'];
  const label = value['label'];
  const defaultReps = value['defaultReps'];
  const repUnit = value['repUnit'];
  const description = value['description'];

  if (
    typeof id !== 'string' ||
    typeof label !== 'string' ||
    !isFiniteNumber(defaultReps) ||
    !isRepUnit(repUnit) ||
    (description !== undefined && typeof description !== 'string')
  ) {
    return null;
  }

  const step: TrainingStep = { id, label, defaultReps, repUnit };
  return description === undefined ? step : { ...step, description };
}

function parseTrainingSet(value: unknown): TrainingSet | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value['id'];
  const name = value['name'];
  const description = value['description'];
  const category = value['category'];
  const steps = parseArray(value['steps'], parseTrainingStep);
  const isBuiltIn = value['isBuiltIn'];

  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof description !== 'string' ||
    !isDrillCategory(category) ||
    steps === null ||
    typeof isBuiltIn !== 'boolean'
  ) {
    return null;
  }

  return {
    id: asTrainingSetId(id),
    name,
    description,
    category,
    steps,
    isBuiltIn,
  };
}

function parseCustomTrainingSet(value: unknown): TrainingSet | null {
  const trainingSet = parseTrainingSet(value);
  return trainingSet?.isBuiltIn === false ? trainingSet : null;
}

function parseRepOverrides(value: unknown): Readonly<Record<string, number>> | null {
  if (!isRecord(value)) {
    return null;
  }

  const repOverrides: [string, number][] = [];

  for (const [stepId, reps] of Object.entries(value)) {
    if (!isFiniteNumber(reps)) {
      return null;
    }

    repOverrides.push([stepId, reps]);
  }

  return Object.fromEntries(repOverrides);
}

function parseDashboardEntry(value: unknown): DashboardEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value['id'];
  const trainingSetId = value['trainingSetId'];
  const repOverrides = parseRepOverrides(value['repOverrides']);
  const notes = value['notes'];
  const createdAt = value['createdAt'];

  if (
    typeof id !== 'string' ||
    typeof trainingSetId !== 'string' ||
    repOverrides === null ||
    typeof notes !== 'string' ||
    typeof createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id,
    trainingSetId: asTrainingSetId(trainingSetId),
    repOverrides,
    notes,
    createdAt,
  };
}

export function parsePersistedTrainingState(value: unknown): PersistedTrainingState | null {
  if (!isRecord(value)) {
    return null;
  }

  const dashboardEntries = parseArray(value['dashboardEntries'], parseDashboardEntry);
  const customTrainingSets = parseArray(value['customTrainingSets'], parseCustomTrainingSet);

  return dashboardEntries === null || customTrainingSets === null
    ? null
    : { dashboardEntries, customTrainingSets };
}

export function migratePersistedTrainingState(
  persistedState: unknown,
  version: number,
): PersistedTrainingState {
  if (version !== 0) {
    throw new Error(`Unsupported training-store persistence version: ${String(version)}`);
  }

  const parsedState = parsePersistedTrainingState(persistedState);

  if (parsedState === null) {
    throw new Error('Training-store persistence data is invalid.');
  }

  return parsedState;
}

function parseStorageValue(value: unknown): StorageValue<PersistedTrainingState> | null {
  if (value === null) {
    return null;
  }

  if (
    !isRecord(value) ||
    !Object.hasOwn(value, 'state') ||
    typeof value['version'] !== 'number' ||
    !Number.isInteger(value['version']) ||
    value['version'] < 0
  ) {
    throw new Error('Training-store persistence envelope is invalid.');
  }

  const state = parsePersistedTrainingState(value['state']);

  if (state === null) {
    throw new Error('Training-store persistence data is invalid.');
  }

  return { state, version: value['version'] };
}

export function createTrainingJSONStorage(
  storage: StateStorage,
): PersistStorage<PersistedTrainingState> {
  const jsonStorage = createJSONStorage<unknown>(() => storage);

  if (jsonStorage === undefined) {
    throw new Error('Training-store storage is unavailable.');
  }

  return {
    getItem: (name) => {
      const storedValue = jsonStorage.getItem(name);
      return storedValue instanceof Promise
        ? storedValue.then(parseStorageValue)
        : parseStorageValue(storedValue);
    },
    setItem: (name, value) => jsonStorage.setItem(name, value),
    removeItem: (name) => jsonStorage.removeItem(name),
  };
}
