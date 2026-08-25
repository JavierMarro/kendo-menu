import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAINING_SETS,
  asTrainingSetId,
  type DashboardEntry,
  type TrainingQuantityUnit,
  type TrainingSetInput,
} from '@kendo-menu/domain';

import {
  classifyTrainingStorageValue,
  createTrainingStore,
  createTrainingStoreAsync,
  inspectTrainingStorage,
  migratePersistedTrainingStateV2ToV3,
  migratePersistedTrainingStateV3ToV4,
  TrainingStoreBootstrapError,
  type LegacyDashboardEntry,
  type StateStorage,
} from './index';

const STORAGE_KEY = 'test-kendo-menu';

const CUSTOM_SET_INPUT = {
  name: 'Footwork basics',
  description: 'A short solo sequence.',
  category: 'custom',
  sections: [
    {
      label: 'Preparation',
      steps: [
        {
          label: 'Okuri-ashi',
          defaultReps: 0,
          description: 'Keep the feet quiet.',
        },
      ],
    },
    {
      label: 'Closing',
      steps: [
        { label: 'Men', defaultReps: 500 },
        { label: 'Kote-men', defaultReps: 24 },
      ],
    },
  ],
} satisfies TrainingSetInput;

const LEGACY_CUSTOM_SET = {
  id: asTrainingSetId('custom-legacy'),
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
  isBuiltIn: false,
} as const;

const LEGACY_DASHBOARD_ENTRY = {
  id: 'entry-legacy',
  trainingSetId: LEGACY_CUSTOM_SET.id,
  repOverrides: { 'okuri-ashi': 0 },
  notes: 'Stay relaxed.',
  createdAt: '2026-08-19T10:00:00.000Z',
} satisfies LegacyDashboardEntry;

const MIGRATED_DASHBOARD_ENTRY = {
  id: LEGACY_DASHBOARD_ENTRY.id,
  trainingSetId: LEGACY_DASHBOARD_ENTRY.trainingSetId,
  quantityOverrides: { 'okuri-ashi': { repetitions: 0 } },
  notes: LEGACY_DASHBOARD_ENTRY.notes,
  createdAt: LEGACY_DASHBOARD_ENTRY.createdAt,
} satisfies DashboardEntry;

class MemoryStorage implements StateStorage {
  readonly #values = new Map<string, string>();
  writes = 0;

  constructor(initialValue?: string) {
    if (initialValue !== undefined) {
      this.#values.set(STORAGE_KEY, initialValue);
    }
  }

  getItem(name: string): string | null {
    return this.#values.get(name) ?? null;
  }

  setItem(name: string, value: string): void {
    this.writes += 1;
    this.#values.set(name, value);
  }

  removeItem(name: string): void {
    this.#values.delete(name);
  }
}

class AsyncMemoryStorage implements StateStorage {
  readonly #values = new Map<string, string>();

  getItem(name: string): Promise<string | null> {
    return Promise.resolve(this.#values.get(name) ?? null);
  }

  setItem(name: string, value: string): Promise<void> {
    this.#values.set(name, value);
    return Promise.resolve();
  }

  removeItem(name: string): Promise<void> {
    this.#values.delete(name);
    return Promise.resolve();
  }
}

function serializeState(state: unknown, version: number): string {
  return JSON.stringify({ state, version });
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function repetitionQuantities(value: number | null): readonly {
  readonly unit: 'repetitions' | 'sets' | 'minutes' | 'rounds';
  readonly value: number | null;
}[] {
  return [
    { unit: 'repetitions', value },
    { unit: 'sets', value: null },
    { unit: 'minutes', value: null },
    { unit: 'rounds', value: null },
  ];
}

function requireStoredValue(storage: StateStorage): string {
  const value = storage.getItem(STORAGE_KEY);
  if (typeof value !== 'string') {
    throw new Error('Expected synchronous persisted test state.');
  }
  return value;
}

function legacyState(): {
  readonly dashboardEntries: readonly LegacyDashboardEntry[];
  readonly customTrainingSets: readonly unknown[];
} {
  return {
    dashboardEntries: [LEGACY_DASHBOARD_ENTRY],
    customTrainingSets: [LEGACY_CUSTOM_SET],
  };
}

function nestedVersion2State(): {
  readonly dashboardEntries: readonly LegacyDashboardEntry[];
  readonly customTrainingSets: readonly unknown[];
} {
  return {
    dashboardEntries: [LEGACY_DASHBOARD_ENTRY],
    customTrainingSets: [
      {
        id: LEGACY_CUSTOM_SET.id,
        name: LEGACY_CUSTOM_SET.name,
        description: LEGACY_CUSTOM_SET.description,
        category: 'custom',
        sections: [
          {
            id: 'custom-legacy-exercises',
            label: 'Exercises',
            steps: LEGACY_CUSTOM_SET.steps,
          },
        ],
        isBuiltIn: false,
      },
    ],
  };
}

describe('createTrainingStore', () => {
  it('creates nested custom sets with generated unique ids and repetitions', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const id = store.getState().addCustomTrainingSet(CUSTOM_SET_INPUT);
    const trainingSet = store.getState().customTrainingSets[0];

    expect(id).toBe(trainingSet?.id);
    expect(trainingSet?.sections.map((section) => section.label)).toEqual([
      'Preparation',
      'Closing',
    ]);
    expect(trainingSet?.sections[0]?.steps[0]?.defaultReps).toBe(0);
    expect(trainingSet?.sections[0]?.steps[0]?.quantities).toEqual(repetitionQuantities(0));
    expect(trainingSet?.sections[1]?.steps[0]?.defaultReps).toBe(500);
    expect(trainingSet?.sections.flatMap((section) => section.steps)).toEqual([
      expect.objectContaining({ label: 'Okuri-ashi', repUnit: 'repetitions' }),
      expect.objectContaining({ label: 'Men', repUnit: 'repetitions' }),
      expect.objectContaining({ label: 'Kote-men', repUnit: 'repetitions' }),
    ]);

    const allIds = [
      trainingSet?.id,
      ...(trainingSet?.sections.flatMap((section) => [
        section.id,
        ...section.steps.map((step) => step.id),
      ]) ?? []),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('rejects invalid custom input before changing state or storage', () => {
    const storage = new MemoryStorage();
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    const before = store.getState();
    const invalidInput = {
      ...CUSTOM_SET_INPUT,
      sections: [{ label: ' ', steps: [{ label: 'Men', defaultReps: 501 }] }],
    } satisfies TrainingSetInput;

    expect(() => store.getState().createCustomTrainingSetAndAddToDashboard(invalidInput)).toThrow();
    expect(store.getState().customTrainingSets).toEqual(before.customTrainingSets);
    expect(store.getState().dashboardEntries).toEqual(before.dashboardEntries);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('saves a custom set and linked dashboard entry atomically', () => {
    const storage = new MemoryStorage();
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    const result = store.getState().createCustomTrainingSetAndAddToDashboard(CUSTOM_SET_INPUT);

    expect(storage.writes).toBe(1);
    expect(result.trainingSetId).toBe(result.trainingSet.id);
    expect(result.dashboardEntryId).toBe(result.dashboardEntry.id);
    expect(result.dashboardEntry.trainingSetId).toBe(result.trainingSet.id);
    expect(store.getState().customTrainingSets).toEqual([result.trainingSet]);
    expect(store.getState().dashboardEntries).toEqual([result.dashboardEntry]);
  });

  it('allows duplicate dashboard entries that remain independently editable', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const setId = store.getState().addCustomTrainingSet(CUSTOM_SET_INPUT);
    const firstId = store.getState().addToDashboard(setId);
    const secondId = store.getState().addToDashboard(setId);

    expect(firstId).not.toBe(secondId);
    store.getState().updateDashboardEntry(firstId, { notes: 'Short session.' });
    expect(store.getState().dashboardEntries[0]?.notes).toBe('Short session.');
    expect(store.getState().dashboardEntries[1]?.notes).toBe('');
  });

  it('preserves sparse quantity override keys and distinguishes zero from missing', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const setId = store.getState().addCustomTrainingSet(CUSTOM_SET_INPUT);
    const entryId = store.getState().addToDashboard(setId);
    const overrides = Object.fromEntries([
      ['__proto__', { repetitions: 0 }],
      ['step-500', { repetitions: 500 }],
    ]);

    store.getState().updateDashboardEntry(entryId, { quantityOverrides: overrides });
    const storedOverrides = store.getState().dashboardEntries[0]?.quantityOverrides;

    expect(Object.hasOwn(storedOverrides ?? {}, '__proto__')).toBe(true);
    expect(Object.hasOwn(storedOverrides ?? {}, 'step-500')).toBe(true);
    expect(storedOverrides?.['__proto__']).toEqual({ repetitions: 0 });
    expect(storedOverrides?.['step-500']).toEqual({ repetitions: 500 });
    expect(Object.hasOwn(storedOverrides ?? {}, 'missing-step')).toBe(false);
  });

  it('accepts supported quantity overrides and rejects malformed values', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const setId = store.getState().addCustomTrainingSet(CUSTOM_SET_INPUT);
    const entryId = store.getState().addToDashboard(setId);

    const validOverrides = {
      step: { repetitions: 0, sets: 2, minutes: 0.5, rounds: 3 },
    } as const;
    store.getState().updateDashboardEntry(entryId, { quantityOverrides: validOverrides });
    expect(store.getState().dashboardEntries[0]?.quantityOverrides).toEqual(validOverrides);
    store.getState().updateDashboardEntry(entryId, {
      quantityOverrides: { step: { repetitions: 500 } },
    });
    expect(store.getState().dashboardEntries[0]?.quantityOverrides).toEqual({
      step: { repetitions: 500 },
    });
    expect(() =>
      store
        .getState()
        .updateDashboardEntry(entryId, { quantityOverrides: { step: { repetitions: 501 } } }),
    ).toThrow();
    expect(() =>
      store
        .getState()
        .updateDashboardEntry(entryId, { quantityOverrides: { step: { sets: 1.5 } } }),
    ).toThrow();
    expect(() =>
      store.getState().updateDashboardEntry(entryId, { quantityOverrides: { step: {} } }),
    ).toThrow();
    expect(store.getState().dashboardEntries[0]?.quantityOverrides).toEqual({
      step: { repetitions: 500 },
    });
  });

  it('removes and restores an entry with exact position and data', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const setId = store.getState().addCustomTrainingSet(CUSTOM_SET_INPUT);
    const firstId = store.getState().addToDashboard(setId);
    store.getState().addToDashboard(setId);
    store.getState().updateDashboardEntry(firstId, {
      notes: 'Keep this note.',
      quantityOverrides: { 'generated-step': { repetitions: 0 } },
    });
    const before = [...store.getState().dashboardEntries];
    const removed = store.getState().removeFromDashboard(firstId);

    expect(removed).toEqual({ entry: before[0], index: 0 });
    if (removed === null) {
      throw new Error('Expected an entry to be removed.');
    }
    store.getState().restoreDashboardEntry(removed);
    expect(store.getState().dashboardEntries).toEqual(before);
  });

  it('round-trips the quantity-aware nested state as version 4', () => {
    const storage = new MemoryStorage();
    const firstStore = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    firstStore.getState().createCustomTrainingSetAndAddToDashboard(CUSTOM_SET_INPUT);
    const persisted = {
      dashboardEntries: firstStore.getState().dashboardEntries,
      customTrainingSets: firstStore.getState().customTrainingSets,
    };

    expect(parseJson(requireStoredValue(storage))).toEqual({ state: persisted, version: 4 });
    const restoredStore = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    expect(restoredStore.getState().dashboardEntries).toEqual(persisted.dashboardEntries);
    expect(restoredStore.getState().customTrainingSets).toEqual(persisted.customTrainingSets);
  });

  it('copies only recognized nested fields while hydrating', () => {
    const raw = serializeState(
      {
        dashboardEntries: [{ ...LEGACY_DASHBOARD_ENTRY, unexpectedEntryField: 'ignored' }],
        customTrainingSets: [
          {
            id: LEGACY_CUSTOM_SET.id,
            name: LEGACY_CUSTOM_SET.name,
            description: LEGACY_CUSTOM_SET.description,
            category: LEGACY_CUSTOM_SET.category,
            isBuiltIn: false,
            unexpectedSetField: 'ignored',
            sections: [
              {
                id: 'section',
                label: 'Section',
                unexpectedSectionField: 'ignored',
                steps: [
                  {
                    id: 'step',
                    label: 'Step',
                    defaultReps: 0,
                    repUnit: 'repetitions',
                    unexpectedStepField: 'ignored',
                  },
                ],
              },
            ],
          },
        ],
      },
      2,
    );
    const store = createTrainingStore({
      storage: new MemoryStorage(raw),
      storageKey: STORAGE_KEY,
    });
    const entry = store.getState().dashboardEntries[0];
    const trainingSet = store.getState().customTrainingSets[0];

    expect(entry).toEqual(MIGRATED_DASHBOARD_ENTRY);
    expect(trainingSet).toEqual({
      id: LEGACY_CUSTOM_SET.id,
      name: LEGACY_CUSTOM_SET.name,
      description: LEGACY_CUSTOM_SET.description,
      category: LEGACY_CUSTOM_SET.category,
      isBuiltIn: false,
      sections: [
        {
          id: 'section',
          label: 'Section',
          steps: [
            {
              id: 'step',
              label: 'Step',
              defaultReps: 0,
              repUnit: 'repetitions',
              quantities: repetitionQuantities(0),
            },
          ],
        },
      ],
    });
  });

  it.each([0, 1])('migrates valid flat version %s data to an Exercises section', (version) => {
    const storage = new MemoryStorage(serializeState(legacyState(), version));
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    const migratedSet = store.getState().customTrainingSets[0];

    expect(migratedSet?.sections).toEqual([
      {
        id: 'custom-legacy-exercises',
        label: 'Exercises',
        steps: LEGACY_CUSTOM_SET.steps.map((step) => ({
          ...step,
          quantities: repetitionQuantities(step.defaultReps),
        })),
      },
    ]);
    expect(store.getState().dashboardEntries).toEqual([MIGRATED_DASHBOARD_ENTRY]);
    expect(parseJson(requireStoredValue(storage))).toMatchObject({ version: 4 });
  });

  it('migrates version 2 nested exercises to explicit quantity units', () => {
    const raw = serializeState(nestedVersion2State(), 2);
    const storage = new MemoryStorage(raw);

    expect(classifyTrainingStorageValue(raw)).toMatchObject({
      status: 'migrated',
      kind: 'migrated',
      fromVersion: 2,
      version: 4,
    });

    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    expect(store.getState().customTrainingSets[0]?.sections[0]?.steps[0]).toEqual({
      ...LEGACY_CUSTOM_SET.steps[0],
      quantities: repetitionQuantities(20),
    });
    expect(store.getState().dashboardEntries).toEqual([MIGRATED_DASHBOARD_ENTRY]);
    expect(parseJson(requireStoredValue(storage))).toMatchObject({ version: 4 });
  });

  it.each(['repetitions', 'sets', 'minutes', 'rounds'] as const)(
    'preserves a version 2 singular %s value in its declared unit',
    (unit: TrainingQuantityUnit) => {
      const migrated = migratePersistedTrainingStateV2ToV3({
        dashboardEntries: [],
        customTrainingSets: [
          {
            id: LEGACY_CUSTOM_SET.id,
            name: LEGACY_CUSTOM_SET.name,
            description: LEGACY_CUSTOM_SET.description,
            category: 'custom',
            sections: [
              {
                id: 'unit-section',
                label: 'Unit section',
                steps: [
                  {
                    id: 'unit-step',
                    label: 'Unit step',
                    defaultReps: 2,
                    repUnit: unit,
                  },
                ],
              },
            ],
            isBuiltIn: false,
          },
        ],
      });
      const quantities = migrated.customTrainingSets[0]?.sections[0]?.steps[0]?.quantities;

      expect(quantities?.find((quantity) => quantity.unit === unit)?.value).toBe(2);
      expect(quantities?.filter((quantity) => quantity.value !== null)).toHaveLength(1);
    },
  );

  it('migrates version 3 overrides into each exercise declared unit', () => {
    const version3State = migratePersistedTrainingStateV2ToV3({
      dashboardEntries: [
        {
          ...LEGACY_DASHBOARD_ENTRY,
          repOverrides: { 'unit-step': 0, 'missing-step': 5 },
        },
      ],
      customTrainingSets: [
        {
          id: LEGACY_CUSTOM_SET.id,
          name: LEGACY_CUSTOM_SET.name,
          description: LEGACY_CUSTOM_SET.description,
          category: 'custom',
          sections: [
            {
              id: 'unit-section',
              label: 'Unit section',
              steps: [
                {
                  id: 'unit-step',
                  label: 'Unit step',
                  defaultReps: 2,
                  repUnit: 'minutes',
                },
              ],
            },
          ],
          isBuiltIn: false,
        },
      ],
    });

    expect(migratePersistedTrainingStateV3ToV4(version3State).dashboardEntries[0]).toEqual({
      id: LEGACY_DASHBOARD_ENTRY.id,
      trainingSetId: LEGACY_DASHBOARD_ENTRY.trainingSetId,
      quantityOverrides: {
        'unit-step': { minutes: 0 },
        'missing-step': { repetitions: 5 },
      },
      notes: LEGACY_DASHBOARD_ENTRY.notes,
      createdAt: LEGACY_DASHBOARD_ENTRY.createdAt,
    });
  });

  it('normalizes a legacy authored category to custom during migration', () => {
    const storage = new MemoryStorage(
      serializeState(
        {
          ...legacyState(),
          customTrainingSets: [{ ...LEGACY_CUSTOM_SET, category: 'kihon' }],
        },
        1,
      ),
    );
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });

    expect(store.getState().customTrainingSets[0]?.category).toBe('custom');
  });

  it('rejects a current custom set whose id collides with a curated set', () => {
    const curatedSet = DEFAULT_TRAINING_SETS[0];
    if (curatedSet === undefined) {
      throw new Error('Expected a curated training set.');
    }
    const raw = serializeState(
      {
        dashboardEntries: [],
        customTrainingSets: [
          {
            id: curatedSet.id,
            name: 'Collision',
            description: '',
            category: 'custom',
            isBuiltIn: false,
            sections: [
              {
                id: 'collision-section',
                label: 'Section',
                steps: [
                  {
                    id: 'collision-step',
                    label: 'Step',
                    defaultReps: 0,
                    repUnit: 'repetitions',
                    quantities: repetitionQuantities(0),
                  },
                ],
              },
            ],
          },
        ],
      },
      4,
    );
    const storage = new MemoryStorage(raw);

    expect(classifyTrainingStorageValue(raw)).toEqual({
      status: 'corrupt',
      kind: 'corrupt',
      reason: 'invalid-domain',
    });
    expect(() => createTrainingStore({ storage, storageKey: STORAGE_KEY })).toThrow(
      TrainingStoreBootstrapError,
    );
    expect(requireStoredValue(storage)).toBe(raw);
  });

  it('rejects a legacy migration whose custom set id collides with a curated set', () => {
    const curatedSet = DEFAULT_TRAINING_SETS[0];
    if (curatedSet === undefined) {
      throw new Error('Expected a curated training set.');
    }
    const raw = serializeState(
      {
        dashboardEntries: [{ ...LEGACY_DASHBOARD_ENTRY, trainingSetId: curatedSet.id }],
        customTrainingSets: [{ ...LEGACY_CUSTOM_SET, id: curatedSet.id }],
      },
      1,
    );
    const storage = new MemoryStorage(raw);

    expect(classifyTrainingStorageValue(raw)).toEqual({
      status: 'corrupt',
      kind: 'corrupt',
      reason: 'invalid-domain',
    });
    expect(() => createTrainingStore({ storage, storageKey: STORAGE_KEY })).toThrow(
      TrainingStoreBootstrapError,
    );
    expect(requireStoredValue(storage)).toBe(raw);
  });

  it('classifies empty, current, and legacy storage without writing', () => {
    const empty = new MemoryStorage();
    expect(classifyTrainingStorageValue(empty.getItem(STORAGE_KEY))).toEqual({
      status: 'empty',
      kind: 'empty',
    });

    const legacyRaw = serializeState(legacyState(), 1);
    expect(classifyTrainingStorageValue(legacyRaw)).toMatchObject({
      status: 'migrated',
      kind: 'migrated',
      fromVersion: 1,
      version: 4,
    });

    const currentRaw = serializeState({ dashboardEntries: [], customTrainingSets: [] }, 4);
    expect(classifyTrainingStorageValue(currentRaw)).toMatchObject({
      status: 'ready',
      kind: 'ready',
      version: 4,
    });
  });

  it('supports asynchronous adapters through inspection and async bootstrap', async () => {
    const storage = new AsyncMemoryStorage();
    const inspection = await inspectTrainingStorage(storage, STORAGE_KEY);
    expect(inspection.status).toBe('empty');

    const store = await createTrainingStoreAsync({ storage, storageKey: STORAGE_KEY });
    const id = store.getState().addCustomTrainingSet(CUSTOM_SET_INPUT);
    expect(store.getState().customTrainingSets[0]?.id).toBe(id);
  });

  it('rejects invalid legacy repetitions instead of clamping them', () => {
    const invalidState = {
      ...legacyState(),
      customTrainingSets: [
        { ...LEGACY_CUSTOM_SET, steps: [{ ...LEGACY_CUSTOM_SET.steps[0], defaultReps: 501 }] },
      ],
    };
    const raw = serializeState(invalidState, 1);
    const storage = new MemoryStorage(raw);

    expect(() => createTrainingStore({ storage, storageKey: STORAGE_KEY })).toThrow(
      TrainingStoreBootstrapError,
    );
    expect(requireStoredValue(storage)).toBe(raw);
  });

  it('rejects a missing defaultReps field rather than treating it as zero or null', () => {
    const raw = serializeState(
      {
        dashboardEntries: [],
        customTrainingSets: [
          {
            ...LEGACY_CUSTOM_SET,
            sections: [
              {
                id: 'section',
                label: 'Section',
                steps: [{ id: 'step', label: 'Step', repUnit: 'repetitions' }],
              },
            ],
          },
        ],
      },
      2,
    );
    const storage = new MemoryStorage(raw);

    expect(() => createTrainingStore({ storage, storageKey: STORAGE_KEY })).toThrow(
      TrainingStoreBootstrapError,
    );
    expect(requireStoredValue(storage)).toBe(raw);
  });

  it('rejects current persisted exercises that omit explicit quantities', () => {
    const raw = serializeState(
      { ...nestedVersion2State(), dashboardEntries: [] },
      4,
    );
    const storage = new MemoryStorage(raw);

    expect(classifyTrainingStorageValue(raw)).toEqual({
      status: 'corrupt',
      kind: 'corrupt',
      reason: 'invalid-domain',
    });
    expect(() => createTrainingStore({ storage, storageKey: STORAGE_KEY })).toThrow(
      TrainingStoreBootstrapError,
    );
    expect(requireStoredValue(storage)).toBe(raw);
  });

  it('rejects malformed persisted quantity overrides', () => {
    const raw = serializeState(
      {
        dashboardEntries: [
          {
            ...MIGRATED_DASHBOARD_ENTRY,
            quantityOverrides: { 'okuri-ashi': { seconds: 10 } },
          },
        ],
        customTrainingSets: [],
      },
      4,
    );
    const storage = new MemoryStorage(raw);

    expect(classifyTrainingStorageValue(raw)).toEqual({
      status: 'corrupt',
      kind: 'corrupt',
      reason: 'invalid-domain',
    });
    expect(() => createTrainingStore({ storage, storageKey: STORAGE_KEY })).toThrow(
      TrainingStoreBootstrapError,
    );
    expect(requireStoredValue(storage)).toBe(raw);
  });

  it.each([
    ['malformed JSON', '{"state":'],
    ['malformed envelope', JSON.stringify({ state: legacyState() })],
    [
      'invalid domain',
      serializeState(
        {
          dashboardEntries: [],
          customTrainingSets: [{ ...LEGACY_CUSTOM_SET, isBuiltIn: true }],
        },
        2,
      ),
    ],
  ])('classifies %s as corrupt and preserves raw bytes', (_label, raw) => {
    const storage = new MemoryStorage(raw);
    const inspection = classifyTrainingStorageValue(raw);

    expect(inspection.status).toBe('corrupt');
    expect(() => createTrainingStore({ storage, storageKey: STORAGE_KEY })).toThrow(
      TrainingStoreBootstrapError,
    );
    expect(requireStoredValue(storage)).toBe(raw);
  });

  it('rejects unsupported future versions without creating a writable store', () => {
    const raw = serializeState(legacyState(), 99);
    const storage = new MemoryStorage(raw);

    expect(classifyTrainingStorageValue(raw)).toEqual({
      status: 'unsupported-future',
      kind: 'unsupported-future',
      version: 99,
    });
    expect(() => createTrainingStore({ storage, storageKey: STORAGE_KEY })).toThrow(
      TrainingStoreBootstrapError,
    );
    expect(requireStoredValue(storage)).toBe(raw);
  });
});
