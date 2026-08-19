import {
  asTrainingSetId,
  type DashboardEntry,
  type DrillCategory,
  type RepUnit,
  type TrainingSet,
  type TrainingStep,
} from '@kendo-menu/domain';
import type { PersistStorage, StateStorage, StorageValue } from 'zustand/middleware';

export const TRAINING_STORE_PERSISTENCE_VERSION = 1;

export interface PersistedTrainingState {
  readonly dashboardEntries: readonly DashboardEntry[];
  readonly customTrainingSets: readonly TrainingSet[];
}

type WritePolicy = 'allowed' | 'pending' | 'protected';

interface ParsedStorageValue {
  readonly value: StorageValue<PersistedTrainingState> | null;
  readonly writePolicy: Exclude<WritePolicy, 'pending'>;
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

function emptyPersistedTrainingState(): PersistedTrainingState {
  return { dashboardEntries: [], customTrainingSets: [] };
}

function serializeStorageValue(value: StorageValue<PersistedTrainingState>): string {
  const serializedValue = JSON.stringify(value);

  if (serializedValue === undefined) {
    throw new Error('Training-store persistence data could not be serialized.');
  }

  return serializedValue;
}

function hasFuturePersistenceVersion(serializedValue: string | null): boolean {
  if (serializedValue === null) {
    return false;
  }

  let value: unknown;

  try {
    value = JSON.parse(serializedValue) as unknown;
  } catch {
    return false;
  }

  return (
    isRecord(value) &&
    typeof value['version'] === 'number' &&
    Number.isInteger(value['version']) &&
    value['version'] > TRAINING_STORE_PERSISTENCE_VERSION
  );
}

export function createTrainingPersistStorage(
  storage: StateStorage,
): PersistStorage<PersistedTrainingState> {
  let writePolicy: WritePolicy = 'allowed';
  let readBarrier: Promise<void> | null = null;
  let readGeneration = 0;
  let usesAsyncStorage = false;
  let asyncWriteQueue = Promise.resolve();
  let operationGeneration = 0;

  const deserializeStorageValue = (serializedValue: string | null): ParsedStorageValue => {
    if (serializedValue === null) {
      return { value: null, writePolicy: 'allowed' };
    }

    const value = JSON.parse(serializedValue) as unknown;

    if (
      !isRecord(value) ||
      !Object.hasOwn(value, 'state') ||
      typeof value['version'] !== 'number' ||
      !Number.isInteger(value['version']) ||
      value['version'] < 0
    ) {
      throw new Error('Training-store persistence envelope is invalid.');
    }

    const version = value['version'];

    if (version > TRAINING_STORE_PERSISTENCE_VERSION) {
      // An older client may read newer data, but it must not silently downgrade or erase it.
      return {
        value: { state: emptyPersistedTrainingState(), version },
        writePolicy: 'protected',
      };
    }

    const state = parsePersistedTrainingState(value['state']);

    if (state === null) {
      throw new Error('Training-store persistence data is invalid.');
    }

    return { value: { state, version }, writePolicy: 'allowed' };
  };

  const writeStorageValue = (
    name: string,
    value: StorageValue<PersistedTrainingState>,
    generation: number,
  ): unknown => {
    if (generation !== operationGeneration || writePolicy === 'protected') {
      return undefined;
    }

    const serializedValue = serializeStorageValue(value);
    const persistIfCompatible = (currentValue: string | null): unknown => {
      if (generation !== operationGeneration) {
        return undefined;
      }

      if (hasFuturePersistenceVersion(currentValue)) {
        writePolicy = 'protected';
        return undefined;
      }

      return writePolicy === 'protected' ? undefined : storage.setItem(name, serializedValue);
    };

    if (usesAsyncStorage) {
      const queuedWrite = asyncWriteQueue.then(async () => {
        if (generation !== operationGeneration || writePolicy === 'protected') {
          return;
        }

        const currentValue = await storage.getItem(name);
        await persistIfCompatible(currentValue);
      });
      asyncWriteQueue = queuedWrite.then(
        () => undefined,
        () => undefined,
      );
      return queuedWrite;
    }

    const currentValue = storage.getItem(name);

    if (currentValue instanceof Promise) {
      usesAsyncStorage = true;
      const queuedWrite = asyncWriteQueue.then(async () => {
        await persistIfCompatible(await currentValue);
      });
      asyncWriteQueue = queuedWrite.then(
        () => undefined,
        () => undefined,
      );
      return queuedWrite;
    }

    return persistIfCompatible(currentValue);
  };

  const writeAfterActiveRead = (
    name: string,
    value: StorageValue<PersistedTrainingState>,
    generation: number,
  ): Promise<unknown> => {
    if (generation !== operationGeneration) {
      return Promise.resolve(undefined);
    }

    const activeBarrier = readBarrier;

    if (writePolicy !== 'pending' || activeBarrier === null) {
      return Promise.resolve(writeStorageValue(name, value, generation));
    }

    return activeBarrier.then(() =>
      generation !== operationGeneration
        ? undefined
        : activeBarrier === readBarrier && writePolicy !== 'pending'
          ? writeStorageValue(name, value, generation)
          : writeAfterActiveRead(name, value, generation),
    );
  };

  return {
    getItem: (name) => {
      const generation = ++readGeneration;
      let storedValue: string | null | Promise<string | null>;

      try {
        storedValue = storage.getItem(name);
      } catch (error) {
        writePolicy = 'allowed';
        readBarrier = null;
        throw error;
      }

      if (storedValue instanceof Promise) {
        usesAsyncStorage = true;
        writePolicy = 'pending';
        const parsedValue = storedValue.then(deserializeStorageValue).then(
          (parsed) => {
            if (generation !== readGeneration) {
              return null;
            }

            writePolicy = parsed.writePolicy;
            return parsed.value;
          },
          (error: unknown) => {
            if (generation === readGeneration) {
              writePolicy = 'allowed';
            }

            throw error;
          },
        );
        const currentBarrier = parsedValue.then(
          () => undefined,
          () => undefined,
        );
        readBarrier = currentBarrier;
        return parsedValue;
      }

      readBarrier = null;

      try {
        const parsedValue = deserializeStorageValue(storedValue);
        writePolicy = parsedValue.writePolicy;
        return parsedValue.value;
      } catch (error) {
        writePolicy = 'allowed';
        throw error;
      }
    },
    setItem: (name, value) => {
      const generation = operationGeneration;

      return writePolicy === 'pending'
        ? writeAfterActiveRead(name, value, generation)
        : writeStorageValue(name, value, generation);
    },
    removeItem: (name) => {
      const generation = ++operationGeneration;
      readGeneration += 1;
      readBarrier = null;

      if (usesAsyncStorage) {
        writePolicy = 'allowed';
        const queuedRemoval = asyncWriteQueue.then(async () => {
          await storage.removeItem(name);

          if (generation === operationGeneration) {
            writePolicy = 'allowed';
          }
        });
        asyncWriteQueue = queuedRemoval.then(
          () => undefined,
          () => undefined,
        );
        return queuedRemoval;
      }

      const removalResult = storage.removeItem(name);
      writePolicy = 'allowed';
      return removalResult;
    },
  };
}
