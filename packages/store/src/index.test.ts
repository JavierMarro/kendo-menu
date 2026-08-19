import { describe, expect, it } from 'vitest';

import {
  asTrainingSetId,
  type DashboardEntry,
  type TrainingSet,
  type TrainingSetInput,
} from '@kendo-menu/domain';

import { createTrainingStore, type StateStorage } from './index';

const STORAGE_KEY = 'test-kendo-menu';

const CUSTOM_SET_INPUT = {
  name: 'Footwork basics',
  description: 'A short solo sequence.',
  category: 'custom',
  steps: [
    {
      id: 'okuri-ashi',
      label: 'Okuri-ashi',
      defaultReps: 20,
      repUnit: 'repetitions',
      description: 'Keep the feet quiet.',
    },
  ],
} satisfies TrainingSetInput;

const LEGACY_CUSTOM_SET = {
  ...CUSTOM_SET_INPUT,
  id: asTrainingSetId('custom-legacy'),
  isBuiltIn: false,
} satisfies TrainingSet;

const LEGACY_DASHBOARD_ENTRY = {
  id: 'entry-legacy',
  trainingSetId: LEGACY_CUSTOM_SET.id,
  repOverrides: { 'okuri-ashi': 30 },
  notes: 'Stay relaxed.',
  createdAt: '2026-08-19T10:00:00.000Z',
} satisfies DashboardEntry;

interface PersistedCollections {
  readonly dashboardEntries: readonly DashboardEntry[];
  readonly customTrainingSets: readonly TrainingSet[];
}

class MemoryStorage implements StateStorage {
  readonly #values = new Map<string, string>();

  constructor(initialValue?: string) {
    if (initialValue !== undefined) {
      this.#values.set(STORAGE_KEY, initialValue);
    }
  }

  getItem(name: string): string | null {
    return this.#values.get(name) ?? null;
  }

  setItem(name: string, value: string): void {
    this.#values.set(name, value);
  }

  removeItem(name: string): void {
    this.#values.delete(name);
  }
}

class AsyncMemoryStorage implements StateStorage {
  readonly #storage: MemoryStorage;

  constructor(initialValue: string) {
    this.#storage = new MemoryStorage(initialValue);
  }

  async getItem(name: string): Promise<string | null> {
    await Promise.resolve();
    return this.#storage.getItem(name);
  }

  setItem(name: string, value: string): void {
    this.#storage.setItem(name, value);
  }

  removeItem(name: string): void {
    this.#storage.removeItem(name);
  }

  readStoredValue(): string {
    return requireStoredValue(this.#storage);
  }
}

interface PendingRead {
  readonly resolve: (value: string | null) => void;
  readonly snapshot: string | null;
  resolved: boolean;
}

class ControlledAsyncStorage implements StateStorage {
  readonly #pendingReads: PendingRead[] = [];
  #value: string | null;

  constructor(initialValue: string) {
    this.#value = initialValue;
  }

  getItem(): Promise<string | null> {
    const snapshot = this.#value;

    return new Promise((resolve) => {
      this.#pendingReads.push({ resolve, snapshot, resolved: false });
    });
  }

  setItem(_name: string, value: string): void {
    this.#value = value;
  }

  removeItem(): void {
    this.#value = null;
  }

  replaceStoredValue(value: string): void {
    this.#value = value;
  }

  resolveRead(index: number): void {
    const pendingRead = this.#pendingReads[index];

    if (pendingRead === undefined || pendingRead.resolved) {
      throw new Error(`Expected unresolved storage read ${String(index)}.`);
    }

    pendingRead.resolved = true;
    pendingRead.resolve(pendingRead.snapshot);
  }

  resolveNextRead(): void {
    const nextRead = this.#pendingReads.findIndex((pendingRead) => !pendingRead.resolved);

    if (nextRead === -1) {
      throw new Error('Expected an unresolved storage read.');
    }

    this.resolveRead(nextRead);
  }

  unresolvedReadCount(): number {
    return this.#pendingReads.filter((pendingRead) => !pendingRead.resolved).length;
  }

  readStoredValue(): string | null {
    return this.#value;
  }
}

function serializeState(state: unknown, version: number): string {
  return JSON.stringify({ state, version });
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

async function flushMicrotasks(): Promise<void> {
  for (let iteration = 0; iteration < 8; iteration += 1) {
    await Promise.resolve();
  }
}

function requireStoredValue(storage: StateStorage): string {
  const value = storage.getItem(STORAGE_KEY);

  if (typeof value !== 'string') {
    throw new Error('Expected synchronous persisted test state.');
  }

  return value;
}

function validPersistedCollections(): PersistedCollections {
  return {
    dashboardEntries: [LEGACY_DASHBOARD_ENTRY],
    customTrainingSets: [LEGACY_CUSTOM_SET],
  };
}

describe('createTrainingStore', () => {
  it('creates custom sets and immutably adds, updates, and removes dashboard entries', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const customSetId = store.getState().addCustomTrainingSet(CUSTOM_SET_INPUT);

    expect(customSetId).toMatch(/^custom-/);
    expect(store.getState().customTrainingSets).toEqual([
      { ...CUSTOM_SET_INPUT, id: customSetId, isBuiltIn: false },
    ]);

    store.getState().addToDashboard(customSetId);
    store.getState().addToDashboard(customSetId);

    const entriesBeforeUpdate = store.getState().dashboardEntries;
    const firstEntry = entriesBeforeUpdate[0];
    const secondEntry = entriesBeforeUpdate[1];

    expect(firstEntry).toBeDefined();
    expect(secondEntry).toBeDefined();
    expect(firstEntry?.id).not.toBe(secondEntry?.id);

    if (firstEntry === undefined || secondEntry === undefined) {
      throw new Error('Expected two dashboard entries.');
    }

    store.getState().updateDashboardEntry(firstEntry.id, { notes: 'Light shoulders.' });

    const entriesAfterNotes = store.getState().dashboardEntries;
    expect(entriesAfterNotes[0]).not.toBe(firstEntry);
    expect(entriesAfterNotes[0]?.notes).toBe('Light shoulders.');
    expect(entriesAfterNotes[0]?.repOverrides).toEqual({});
    expect(entriesAfterNotes[1]).toBe(secondEntry);

    store.getState().updateDashboardEntry(firstEntry.id, { repOverrides: { 'okuri-ashi': 24 } });

    expect(store.getState().dashboardEntries[0]).toMatchObject({
      notes: 'Light shoulders.',
      repOverrides: { 'okuri-ashi': 24 },
    });

    store.getState().removeFromDashboard(firstEntry.id);
    expect(store.getState().dashboardEntries).toEqual([secondEntry]);
  });

  it('round-trips only the persisted collections in version 1', () => {
    const storage = new MemoryStorage();
    const firstStore = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    const customSetId = firstStore.getState().addCustomTrainingSet(CUSTOM_SET_INPUT);
    firstStore.getState().addToDashboard(customSetId);

    const persistedCollections = {
      dashboardEntries: firstStore.getState().dashboardEntries,
      customTrainingSets: firstStore.getState().customTrainingSets,
    };

    expect(parseJson(requireStoredValue(storage))).toEqual({
      state: persistedCollections,
      version: 1,
    });

    const restoredStore = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    expect(restoredStore.getState().dashboardEntries).toEqual(
      persistedCollections.dashboardEntries,
    );
    expect(restoredStore.getState().customTrainingSets).toEqual(
      persistedCollections.customTrainingSets,
    );
    expect(restoredStore.getState().addToDashboard).toEqual(expect.any(Function));
  });

  it('migrates a valid version 0 payload and rewrites it as version 1', () => {
    const persistedCollections = validPersistedCollections();
    const storage = new MemoryStorage(serializeState(persistedCollections, 0));
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });

    expect(store.getState().dashboardEntries).toEqual(persistedCollections.dashboardEntries);
    expect(store.getState().customTrainingSets).toEqual(persistedCollections.customTrainingSets);
    expect(parseJson(requireStoredValue(storage))).toEqual({
      state: persistedCollections,
      version: 1,
    });
  });

  it('rejects invalid version 0 data without overwriting it during hydration', () => {
    const rawLegacyState = serializeState(
      { dashboardEntries: 'invalid', customTrainingSets: [] },
      0,
    );
    const storage = new MemoryStorage(rawLegacyState);
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });

    expect(store.getState().dashboardEntries).toEqual([]);
    expect(store.getState().customTrainingSets).toEqual([]);
    expect(store.getState().addToDashboard).toEqual(expect.any(Function));
    expect(requireStoredValue(storage)).toBe(rawLegacyState);
  });

  it.each([
    ['a non-array dashboard collection', { dashboardEntries: {}, customTrainingSets: [] }],
    [
      'an incomplete dashboard entry',
      { dashboardEntries: [{ id: 'entry' }], customTrainingSets: [] },
    ],
    [
      'a non-numeric repetition override',
      {
        dashboardEntries: [{ ...LEGACY_DASHBOARD_ENTRY, repOverrides: { 'okuri-ashi': null } }],
        customTrainingSets: [LEGACY_CUSTOM_SET],
      },
    ],
    [
      'an unknown category',
      {
        dashboardEntries: [],
        customTrainingSets: [{ ...LEGACY_CUSTOM_SET, category: 'unknown' }],
      },
    ],
    [
      'an invalid training step',
      {
        dashboardEntries: [],
        customTrainingSets: [
          {
            ...LEGACY_CUSTOM_SET,
            steps: [{ ...LEGACY_CUSTOM_SET.steps[0], repUnit: 'unknown' }],
          },
        ],
      },
    ],
    [
      'a built-in set in custom storage',
      {
        dashboardEntries: [],
        customTrainingSets: [{ ...LEGACY_CUSTOM_SET, isBuiltIn: true }],
      },
    ],
  ])('ignores current-version state with %s', (_label, persistedState) => {
    const storage = new MemoryStorage(serializeState(persistedState, 1));
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });

    expect(store.getState().dashboardEntries).toEqual([]);
    expect(store.getState().customTrainingSets).toEqual([]);
    expect(store.getState().addToDashboard).toEqual(expect.any(Function));
  });

  it('copies only recognized persisted fields and preserves live actions', () => {
    const injectedState = {
      dashboardEntries: [{ ...LEGACY_DASHBOARD_ENTRY, unexpectedEntryField: 'value' }],
      customTrainingSets: [
        {
          ...LEGACY_CUSTOM_SET,
          unexpectedSetField: 'value',
          steps: [
            {
              ...LEGACY_CUSTOM_SET.steps[0],
              unexpectedStepField: 'value',
            },
          ],
        },
      ],
      addToDashboard: 'replaced',
      unexpected: 'value',
    };
    const store = createTrainingStore({
      storage: new MemoryStorage(serializeState(injectedState, 1)),
      storageKey: STORAGE_KEY,
    });

    expect(store.getState().dashboardEntries).toEqual([LEGACY_DASHBOARD_ENTRY]);
    expect(store.getState().customTrainingSets).toEqual([LEGACY_CUSTOM_SET]);
    expect(store.getState().addToDashboard).toEqual(expect.any(Function));
    expect(store.getState()).not.toHaveProperty('unexpected');
    expect(store.getState().dashboardEntries[0]).not.toHaveProperty('unexpectedEntryField');
    expect(store.getState().customTrainingSets[0]).not.toHaveProperty('unexpectedSetField');
    expect(store.getState().customTrainingSets[0]?.steps[0]).not.toHaveProperty(
      'unexpectedStepField',
    );
  });

  it('preserves a __proto__ step id as repetition-override data', () => {
    const repOverrides = Object.fromEntries([['__proto__', 24]]);
    const persistedState = {
      dashboardEntries: [{ ...LEGACY_DASHBOARD_ENTRY, repOverrides }],
      customTrainingSets: [LEGACY_CUSTOM_SET],
    };
    const store = createTrainingStore({
      storage: new MemoryStorage(serializeState(persistedState, 1)),
      storageKey: STORAGE_KEY,
    });
    const restoredOverrides = store.getState().dashboardEntries[0]?.repOverrides;

    expect(restoredOverrides).toBeDefined();
    expect(Object.hasOwn(restoredOverrides ?? {}, '__proto__')).toBe(true);
    expect(restoredOverrides?.['__proto__']).toBe(24);
  });

  it.each([undefined, '99', null])('rejects a persistence envelope with version %s', (version) => {
    const rawState = JSON.stringify({ state: validPersistedCollections(), version });
    const storage = new MemoryStorage(rawState);
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });

    expect(store.getState().dashboardEntries).toEqual([]);
    expect(store.getState().customTrainingSets).toEqual([]);
    expect(requireStoredValue(storage)).toBe(rawState);
  });

  it('keeps working after malformed JSON and overwrites it on the next action', () => {
    const storage = new MemoryStorage('{"state":');
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });

    expect(store.getState().dashboardEntries).toEqual([]);
    expect(store.getState().customTrainingSets).toEqual([]);

    store.getState().addToDashboard(asTrainingSetId('set-after-corruption'));

    expect(parseJson(requireStoredValue(storage))).toEqual({
      state: {
        dashboardEntries: store.getState().dashboardEntries,
        customTrainingSets: [],
      },
      version: 1,
    });
  });

  it('does not interpret or overwrite a future persistence version after an action', () => {
    const rawFutureState = serializeState(validPersistedCollections(), 99);
    const storage = new MemoryStorage(rawFutureState);
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });

    expect(store.getState().dashboardEntries).toEqual([]);
    expect(store.getState().customTrainingSets).toEqual([]);

    store.getState().addToDashboard(asTrainingSetId('current-version-set'));

    expect(store.getState().dashboardEntries).toHaveLength(1);
    expect(requireStoredValue(storage)).toBe(rawFutureState);
  });

  it('does not let an already-hydrated store overwrite a future version from another tab', () => {
    const storage = new MemoryStorage();
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    const rawFutureState = serializeState(validPersistedCollections(), 99);

    storage.setItem(STORAGE_KEY, rawFutureState);
    store.getState().addToDashboard(asTrainingSetId('current-version-set'));

    expect(store.getState().dashboardEntries).toHaveLength(1);
    expect(requireStoredValue(storage)).toBe(rawFutureState);
  });

  it('quarantines an action while asynchronous storage reveals a future version', async () => {
    const rawFutureState = serializeState(validPersistedCollections(), 99);
    const storage = new AsyncMemoryStorage(rawFutureState);
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });

    store.getState().addToDashboard(asTrainingSetId('current-version-set'));
    await store.persist.rehydrate();

    expect(store.getState().dashboardEntries).toHaveLength(1);
    expect(storage.readStoredValue()).toBe(rawFutureState);
  });

  it('does not let a stale asynchronous read undo the latest quarantine policy', async () => {
    const rawCurrentState = serializeState(validPersistedCollections(), 1);
    const rawFutureState = serializeState(validPersistedCollections(), 99);
    const storage = new ControlledAsyncStorage(rawCurrentState);
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });

    storage.replaceStoredValue(rawFutureState);
    const latestHydration = store.persist.rehydrate();
    storage.resolveRead(1);
    await latestHydration;
    storage.resolveRead(0);
    await Promise.resolve();

    store.getState().addToDashboard(asTrainingSetId('current-version-set'));

    expect(store.getState().dashboardEntries).toHaveLength(1);
    expect(storage.readStoredValue()).toBe(rawFutureState);
  });

  it('serializes asynchronous action writes so the newest state persists last', async () => {
    const emptyState = { dashboardEntries: [], customTrainingSets: [] };
    const storage = new ControlledAsyncStorage(serializeState(emptyState, 1));
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    const hydrationFinished = new Promise<void>((resolve) => {
      store.persist.onFinishHydration(() => resolve());
    });

    storage.resolveNextRead();
    await hydrationFinished;

    store.getState().addToDashboard(asTrainingSetId('first-set'));
    store.getState().addToDashboard(asTrainingSetId('second-set'));
    await flushMicrotasks();

    expect(storage.unresolvedReadCount()).toBe(1);
    storage.resolveNextRead();
    await flushMicrotasks();
    expect(storage.unresolvedReadCount()).toBe(1);
    storage.resolveNextRead();
    await flushMicrotasks();

    expect(parseJson(storage.readStoredValue() ?? '')).toEqual({
      state: {
        dashboardEntries: store.getState().dashboardEntries,
        customTrainingSets: [],
      },
      version: 1,
    });
  });

  it('does not repopulate async storage with a write scheduled before clearStorage', async () => {
    const storage = new ControlledAsyncStorage(serializeState(validPersistedCollections(), 1));
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });

    store.getState().addToDashboard(asTrainingSetId('pre-clear-set'));
    store.persist.clearStorage();
    await flushMicrotasks();
    storage.resolveNextRead();
    await flushMicrotasks();

    expect(storage.readStoredValue()).toBeNull();
    expect(store.getState().dashboardEntries).toHaveLength(1);
    expect(store.getState().customTrainingSets).toEqual([]);
  });

  it('does not migrate a version 0 snapshot resolved after clearStorage', async () => {
    const storage = new ControlledAsyncStorage(serializeState(validPersistedCollections(), 0));
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });

    store.persist.clearStorage();
    await flushMicrotasks();
    storage.resolveNextRead();
    await flushMicrotasks();

    expect(storage.readStoredValue()).toBeNull();
    expect(store.getState().dashboardEntries).toEqual([]);
    expect(store.getState().customTrainingSets).toEqual([]);
  });

  it('resets async write quarantine after a queued clearStorage completes', async () => {
    const emptyState = { dashboardEntries: [], customTrainingSets: [] };
    const storage = new ControlledAsyncStorage(serializeState(emptyState, 1));
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    const hydrationFinished = new Promise<void>((resolve) => {
      store.persist.onFinishHydration(() => resolve());
    });

    storage.resolveNextRead();
    await hydrationFinished;

    storage.replaceStoredValue(serializeState(validPersistedCollections(), 99));
    store.getState().addToDashboard(asTrainingSetId('pre-clear-set'));
    await flushMicrotasks();
    store.persist.clearStorage();
    storage.resolveNextRead();
    await flushMicrotasks();

    expect(storage.readStoredValue()).toBeNull();

    store.getState().addToDashboard(asTrainingSetId('post-clear-set'));
    await flushMicrotasks();
    storage.resolveNextRead();
    await flushMicrotasks();

    expect(parseJson(storage.readStoredValue() ?? '')).toEqual({
      state: {
        dashboardEntries: store.getState().dashboardEntries,
        customTrainingSets: [],
      },
      version: 1,
    });
  });
});
