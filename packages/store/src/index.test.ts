import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAINING_SETS,
  asTrainingSetId,
  type DashboardEntry,
  type TrainingActivity,
  type TrainingSetInput,
} from '@kendo-menu/domain';

import {
  TRAINING_STORE_PERSISTENCE_VERSION,
  TrainingStoreBootstrapError,
  classifyTrainingStorageValue,
  createTrainingStore,
  createTrainingStoreAsync,
  getDashboardEffectiveTrainingQuantity,
  inspectTrainingStorage,
  migratePersistedTrainingState,
  migratePersistedTrainingStateV2ToV3,
  migratePersistedTrainingStateV3ToV4,
  migratePersistedTrainingStateV4ToV5,
  migratePersistedTrainingStateV5ToV6,
  parsePersistedTrainingState,
  parsePersistedTrainingStateV4,
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
      name: 'Preparation',
      exercises: [
        {
          name: 'Okuri-ashi',
          quantities: { repetitions: 0 },
          notes: 'Keep the feet quiet.',
        },
      ],
    },
    {
      name: 'Closing',
      exercises: [
        { name: 'Men', quantities: { repetitions: 500 } },
        { name: 'Kote-men', quantities: { repetitions: 24 } },
      ],
    },
  ],
} satisfies TrainingSetInput;

const LEGACY_DASHBOARD_ENTRY = {
  id: 'entry-legacy',
  trainingSetId: asTrainingSetId('custom-legacy'),
  repOverrides: { 'legacy-exercise': 0 },
  notes: 'Stay relaxed.',
  createdAt: '2026-08-19T10:00:00.000Z',
} satisfies LegacyDashboardEntry;

const LEGACY_V4_QUANTITIES = [
  { unit: 'repetitions', value: 0 },
  { unit: 'sets', value: 2 },
  { unit: 'minutes', value: 1.5 },
  { unit: 'rounds', value: 3 },
] as const;

const LEGACY_V4_REPETITION_QUANTITIES = [
  { unit: 'repetitions', value: 24 },
  { unit: 'sets', value: null },
  { unit: 'minutes', value: null },
  { unit: 'rounds', value: null },
] as const;

const LEGACY_V4_STATE = {
  dashboardEntries: [
    {
      id: 'entry-v4',
      trainingSetId: asTrainingSetId('custom-legacy'),
      quantityOverrides: {
        'legacy-exercise': { repetitions: 0, sets: 4, seconds: 30 },
      },
      notes: '',
      createdAt: '2026-08-19T10:00:00.000Z',
    },
  ],
  customTrainingSets: [
    {
      id: 'custom-legacy',
      name: 'Legacy custom set',
      description: '',
      category: 'custom',
      sections: [
        {
          id: 'legacy-section',
          label: 'Legacy section',
          steps: [
            {
              id: 'legacy-exercise',
              label: 'Legacy exercise',
              defaultReps: 0,
              repUnit: 'repetitions',
              description: '',
              quantities: LEGACY_V4_QUANTITIES,
            },
            {
              id: 'unknown-exercise',
              label: 'Unknown exercise',
              defaultReps: 24,
              repUnit: 'repetitions',
              quantities: LEGACY_V4_REPETITION_QUANTITIES,
            },
          ],
        },
      ],
      isBuiltIn: false,
    },
  ],
} as const;

const INTERNATIONAL_DOJO_ID = asTrainingSetId('international-dojo-2-hour-session');
const UNIVERSITY_VERSION_TWO_ID = asTrainingSetId('university-version-2');
const CORRECTED_UCHIKOMI_ID = 'international-dojo-2-hour-session-uchikomi-men-kote-kote-men-men';
const UNIVERSITY_VERSION_TWO_KAKARIGEIJO_ID = 'university-version-2-kakarigeijo-kakarigeijo';
const LEGACY_UCHIKOMI_IDS = [
  'international-dojo-2-hour-session-uchikomi-men-1',
  'international-dojo-2-hour-session-uchikomi-kote',
  'international-dojo-2-hour-session-uchikomi-kote-men',
  'international-dojo-2-hour-session-uchikomi-men-2',
] as const;

function versionFiveUchikomiState(quantityOverrides: DashboardEntry['quantityOverrides']): {
  readonly dashboardEntries: readonly DashboardEntry[];
  readonly customTrainingSets: readonly [];
} {
  return {
    dashboardEntries: [
      {
        id: 'international-entry',
        trainingSetId: INTERNATIONAL_DOJO_ID,
        quantityOverrides,
        notes: 'Preserve this note.',
        createdAt: '2026-08-19T10:00:00.000Z',
      },
    ],
    customTrainingSets: [],
  };
}

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

  read(): string | null {
    return this.getItem(STORAGE_KEY);
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

function requireString(value: string | null): string {
  if (value === null) {
    throw new Error('Expected persisted test data.');
  }
  return value;
}

function requireFirstDashboardEntry(entries: readonly DashboardEntry[]): DashboardEntry {
  const entry = entries[0];
  if (entry === undefined) {
    throw new Error('Expected a dashboard entry.');
  }
  return entry;
}

function legacyVersionTwoState(): unknown {
  return {
    dashboardEntries: [LEGACY_DASHBOARD_ENTRY],
    customTrainingSets: [
      {
        id: 'custom-legacy',
        name: 'Legacy custom set',
        description: '',
        category: 'custom',
        sections: [
          {
            id: 'legacy-section',
            label: 'Legacy section',
            steps: [
              {
                id: 'legacy-exercise',
                label: 'Legacy exercise',
                defaultReps: 20,
                repUnit: 'repetitions',
                description: 'Mechanical note',
              },
            ],
          },
        ],
        isBuiltIn: false,
      },
    ],
  };
}

function legacyVersionOneState(): unknown {
  return {
    dashboardEntries: [LEGACY_DASHBOARD_ENTRY],
    customTrainingSets: [
      {
        id: 'custom-legacy',
        name: 'Legacy custom set',
        description: '',
        category: 'custom',
        steps: [
          {
            id: 'legacy-exercise',
            label: 'Legacy exercise',
            defaultReps: 20,
            repUnit: 'repetitions',
            description: 'Mechanical note',
          },
        ],
        isBuiltIn: false,
      },
    ],
  };
}

describe('custom training sets', () => {
  it('creates the existing repetition-only custom-builder result with stable generated IDs', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const id = store.getState().addCustomTrainingSet(CUSTOM_SET_INPUT);
    const trainingSet = store.getState().customTrainingSets[0];

    expect(trainingSet).toMatchObject({
      id,
      name: CUSTOM_SET_INPUT.name,
      description: CUSTOM_SET_INPUT.description,
      category: 'custom',
      isBuiltIn: false,
    });
    expect(trainingSet?.sections.map((section) => section.name)).toEqual([
      'Preparation',
      'Closing',
    ]);
    expect(trainingSet?.sections[0]?.exercises[0]).toMatchObject({
      name: 'Okuri-ashi',
      quantities: { repetitions: 0 },
      notes: 'Keep the feet quiet.',
    });

    const ids =
      trainingSet === undefined
        ? []
        : [
            trainingSet.id,
            ...trainingSet.sections.flatMap((section) => [
              section.id,
              ...section.exercises.map((exercise) => exercise.id),
            ]),
          ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('creates a custom set and dashboard entry atomically', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const result = store.getState().createCustomTrainingSetAndAddToDashboard(CUSTOM_SET_INPUT);

    expect(store.getState().customTrainingSets).toEqual([result.trainingSet]);
    expect(store.getState().dashboardEntries).toEqual([result.dashboardEntry]);
    expect(result.dashboardEntry.trainingSetId).toBe(result.trainingSetId);
  });

  it('rejects malformed custom input without partially changing state', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const malformed: TrainingSetInput = {
      ...CUSTOM_SET_INPUT,
      sections: [
        {
          name: 'Invalid',
          exercises: [{ name: 'Too many', quantities: { repetitions: 501 } }],
        },
      ],
    };

    expect(() => store.getState().createCustomTrainingSetAndAddToDashboard(malformed)).toThrow();
    expect(store.getState().customTrainingSets).toEqual([]);
    expect(store.getState().dashboardEntries).toEqual([]);
  });
});

describe('dashboard quantity override APIs', () => {
  it('sets and clears individual units without disturbing sibling overrides', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const trainingSetId = asTrainingSetId('junior-high-kendo-club');
    const entryId = store.getState().addToDashboard(trainingSetId);

    store.getState().setQuantityOverride(entryId, 'junior-high-kendo-club-suburi-haya', 'sets', 4);
    store
      .getState()
      .setQuantityOverride(entryId, 'junior-high-kendo-club-suburi-haya', 'repetitions', 80);
    expect(requireFirstDashboardEntry(store.getState().dashboardEntries).quantityOverrides).toEqual(
      {
        'junior-high-kendo-club-suburi-haya': { sets: 4, repetitions: 80 },
      },
    );

    store
      .getState()
      .clearQuantityOverride(entryId, 'junior-high-kendo-club-suburi-haya', 'repetitions');
    expect(requireFirstDashboardEntry(store.getState().dashboardEntries).quantityOverrides).toEqual(
      {
        'junior-high-kendo-club-suburi-haya': { sets: 4 },
      },
    );

    store.getState().clearQuantityOverride(entryId, 'junior-high-kendo-club-suburi-haya', 'sets');
    expect(requireFirstDashboardEntry(store.getState().dashboardEntries).quantityOverrides).toEqual(
      {},
    );
  });

  it('supports seconds, explicit zero, and a unit with no curated default', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const entryId = store
      .getState()
      .addToDashboard(asTrainingSetId('senior-high-school-kendo-club'));

    store
      .getState()
      .setQuantityOverride(entryId, 'senior-high-school-kendo-club-warm-up-stretch', 'seconds', 0);

    expect(requireFirstDashboardEntry(store.getState().dashboardEntries).quantityOverrides).toEqual(
      {
        'senior-high-school-kendo-club-warm-up-stretch': { seconds: 0 },
      },
    );
  });

  it('falls back to immutable defaults and lets scalar overrides supersede ranges', () => {
    const entry: DashboardEntry = {
      id: 'entry',
      trainingSetId: asTrainingSetId('synthetic'),
      quantityOverrides: { activity: { seconds: 45 } },
      notes: '',
      createdAt: '',
    };
    const activity: TrainingActivity = {
      id: 'activity',
      name: 'Timed activity',
      quantities: {
        repetitions: 5,
        sets: 4,
        duration: { unit: 'seconds', min: 30, max: 60 },
      },
    };
    const original = activity.quantities;

    expect(getDashboardEffectiveTrainingQuantity(entry, activity, 'seconds')).toBe(45);
    expect(getDashboardEffectiveTrainingQuantity(entry, activity, 'sets')).toBe(4);
    expect(activity.quantities).toBe(original);
  });

  it('does not mutate curated defaults when applying dashboard overrides', () => {
    const curated = DEFAULT_TRAINING_SETS[2];
    if (curated === undefined) {
      throw new Error('Expected the junior-high curated drill.');
    }
    const before = JSON.stringify(curated);
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const entryId = store.getState().addToDashboard(curated.id);
    store
      .getState()
      .setQuantityOverride(entryId, 'junior-high-kendo-club-suburi-haya', 'repetitions', 75);

    expect(JSON.stringify(curated)).toBe(before);
  });

  it('rejects malformed values and empty override maps', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const entryId = store.getState().addToDashboard(asTrainingSetId('junior-high-kendo-club'));

    expect(() =>
      store
        .getState()
        .setQuantityOverride(entryId, 'junior-high-kendo-club-suburi-haya', 'sets', 1.5),
    ).toThrow();
    expect(() =>
      store.getState().updateDashboardEntry(entryId, {
        quantityOverrides: { activity: {} },
      }),
    ).toThrow();
  });
});

describe('version 4 to version 5 migration', () => {
  it('converts null-filled arrays to sparse quantities and preserves every ID and value', () => {
    const migrated = migratePersistedTrainingStateV4ToV5(LEGACY_V4_STATE);
    const trainingSet = migrated.customTrainingSets[0];
    const section = trainingSet?.sections[0];
    const firstExercise = section?.exercises[0];
    const secondExercise = section?.exercises[1];

    expect(trainingSet).toMatchObject({
      id: 'custom-legacy',
      description: '',
      isBuiltIn: false,
    });
    expect(section).toMatchObject({ id: 'legacy-section', name: 'Legacy section' });
    expect(firstExercise).toEqual({
      id: 'legacy-exercise',
      name: 'Legacy exercise',
      notes: '',
      quantities: {
        repetitions: 0,
        sets: 2,
        rounds: 3,
        duration: { unit: 'minutes', value: 1.5 },
      },
    });
    expect(secondExercise).toEqual({
      id: 'unknown-exercise',
      name: 'Unknown exercise',
      quantities: { repetitions: 24 },
    });
    expect(migrated.dashboardEntries).toEqual(LEGACY_V4_STATE.dashboardEntries);
    expect(firstExercise === undefined ? true : Object.hasOwn(firstExercise, 'defaultReps')).toBe(
      false,
    );
    expect(firstExercise === undefined ? true : Object.hasOwn(firstExercise, 'repUnit')).toBe(
      false,
    );
  });

  it('mechanically moves exercise descriptions to notes, including blank text', () => {
    const migrated = migratePersistedTrainingStateV4ToV5(LEGACY_V4_STATE);
    expect(migrated.customTrainingSets[0]?.sections[0]?.exercises[0]?.notes).toBe('');
    expect(
      Object.hasOwn(migrated.customTrainingSets[0]?.sections[0]?.exercises[1] ?? {}, 'notes'),
    ).toBe(false);
  });

  it('keeps dashboard overrides keyed by activity ID then unit, including seconds', () => {
    const migrated = migratePersistedTrainingStateV4ToV5(LEGACY_V4_STATE);
    expect(migrated.dashboardEntries[0]?.quantityOverrides).toEqual({
      'legacy-exercise': { repetitions: 0, sets: 4, seconds: 30 },
    });
  });

  it('preserves the old synthetic built-in ID for standalone activity overrides', () => {
    const standaloneId = 'international-dojo-2-hour-session-jigeiko-jigeiko';
    const state = {
      dashboardEntries: [
        {
          id: 'built-in-entry',
          trainingSetId: asTrainingSetId('international-dojo-2-hour-session'),
          quantityOverrides: { [standaloneId]: { minutes: 5 } },
          notes: '',
          createdAt: '',
        },
      ],
      customTrainingSets: [],
    };

    const migrated = migratePersistedTrainingStateV4ToV5(state);
    expect(migrated.dashboardEntries[0]?.quantityOverrides).toEqual({
      [standaloneId]: { minutes: 5 },
    });
    expect(DEFAULT_TRAINING_SETS[0]?.sections.some((section) => section.id === standaloneId)).toBe(
      true,
    );
  });

  it('rejects malformed, duplicate, unsupported, and unrepaired v4 data', () => {
    const negative = {
      ...LEGACY_V4_STATE,
      customTrainingSets: [
        {
          ...LEGACY_V4_STATE.customTrainingSets[0],
          sections: [
            {
              ...LEGACY_V4_STATE.customTrainingSets[0]?.sections[0],
              steps: [
                {
                  ...LEGACY_V4_STATE.customTrainingSets[0]?.sections[0]?.steps[0],
                  quantities: [
                    { unit: 'repetitions', value: -1 },
                    ...LEGACY_V4_QUANTITIES.slice(1),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const duplicate = {
      ...LEGACY_V4_STATE,
      customTrainingSets: [
        LEGACY_V4_STATE.customTrainingSets[0],
        LEGACY_V4_STATE.customTrainingSets[0],
      ],
    };
    const unsupported = {
      ...LEGACY_V4_STATE,
      dashboardEntries: [
        {
          ...LEGACY_V4_STATE.dashboardEntries[0],
          quantityOverrides: { activity: { hours: 1 } },
        },
      ],
    };

    expect(parsePersistedTrainingStateV4(negative)).toBeNull();
    expect(parsePersistedTrainingStateV4(duplicate)).toBeNull();
    expect(parsePersistedTrainingStateV4(unsupported)).toBeNull();
    expect(() => migratePersistedTrainingStateV4ToV5(negative)).toThrow();
  });
});

describe('version 5 to version 6 canonical correction migration', () => {
  it('merges unambiguous legacy sequence overrides by unit and preserves unrelated data', () => {
    const state = versionFiveUchikomiState({
      [LEGACY_UCHIKOMI_IDS[0]]: { repetitions: 5, seconds: 30 },
      [LEGACY_UCHIKOMI_IDS[1]]: { repetitions: 5, sets: 2 },
      [LEGACY_UCHIKOMI_IDS[2]]: { minutes: 1 },
      [LEGACY_UCHIKOMI_IDS[3]]: { rounds: 0 },
      'unrelated-activity': { repetitions: 12 },
    });

    const migrated = migratePersistedTrainingStateV5ToV6(state);

    expect(migrated.dashboardEntries[0]).toEqual({
      id: 'international-entry',
      trainingSetId: INTERNATIONAL_DOJO_ID,
      quantityOverrides: {
        'unrelated-activity': { repetitions: 12 },
        [CORRECTED_UCHIKOMI_ID]: {
          repetitions: 5,
          sets: 2,
          rounds: 0,
          seconds: 30,
          minutes: 1,
        },
      },
      notes: 'Preserve this note.',
      createdAt: '2026-08-19T10:00:00.000Z',
    });
    expect(migrated.customTrainingSets).toEqual([]);
  });

  it('converts University dojo kakarigeijo overrides to the corrected minutes unit', () => {
    const state = {
      dashboardEntries: [
        {
          id: 'university-entry',
          trainingSetId: UNIVERSITY_VERSION_TWO_ID,
          quantityOverrides: {
            [UNIVERSITY_VERSION_TWO_KAKARIGEIJO_ID]: { repetitions: 0, seconds: 300 },
            'unrelated-activity': { seconds: 45 },
          },
          notes: 'Keep this note.',
          createdAt: '2026-08-19T10:00:00.000Z',
        },
        {
          id: 'university-zero-entry',
          trainingSetId: UNIVERSITY_VERSION_TWO_ID,
          quantityOverrides: {
            [UNIVERSITY_VERSION_TWO_KAKARIGEIJO_ID]: { seconds: 0, minutes: 0 },
          },
          notes: '',
          createdAt: '',
        },
      ],
      customTrainingSets: [],
    };

    const migrated = migratePersistedTrainingStateV5ToV6(state);

    expect(migrated.dashboardEntries[0]).toMatchObject({
      id: 'university-entry',
      quantityOverrides: {
        [UNIVERSITY_VERSION_TWO_KAKARIGEIJO_ID]: { repetitions: 0, minutes: 5 },
        'unrelated-activity': { seconds: 45 },
      },
      notes: 'Keep this note.',
    });
    expect(migrated.dashboardEntries[1]?.quantityOverrides).toEqual({
      [UNIVERSITY_VERSION_TWO_KAKARIGEIJO_ID]: { minutes: 0 },
    });
  });

  it('rejects disagreeing second and minute overrides for corrected kakarigeijo', () => {
    const state = {
      dashboardEntries: [
        {
          id: 'university-entry',
          trainingSetId: UNIVERSITY_VERSION_TWO_ID,
          quantityOverrides: {
            [UNIVERSITY_VERSION_TWO_KAKARIGEIJO_ID]: { seconds: 300, minutes: 4 },
          },
          notes: '',
          createdAt: '',
        },
      ],
      customTrainingSets: [],
    };

    expect(() => migratePersistedTrainingStateV5ToV6(state)).toThrow(
      'Dashboard entry university-entry has conflicting duration overrides for ' +
        'university-version-2-kakarigeijo-kakarigeijo: seconds=300, minutes=4.',
    );
  });

  it('rejects conflicting legacy values and reports every conflicting source ID', () => {
    const state = versionFiveUchikomiState({
      [LEGACY_UCHIKOMI_IDS[0]]: { repetitions: 4 },
      [LEGACY_UCHIKOMI_IDS[1]]: { repetitions: 5 },
      [LEGACY_UCHIKOMI_IDS[2]]: { repetitions: 4 },
    });
    const detail =
      'Dashboard entry international-entry has conflicting repetitions overrides for the ' +
      'corrected International Uchikomi sequence: ' +
      'international-dojo-2-hour-session-uchikomi-men-1=4, ' +
      'international-dojo-2-hour-session-uchikomi-kote=5, ' +
      'international-dojo-2-hour-session-uchikomi-kote-men=4.';

    expect(() => migratePersistedTrainingStateV5ToV6(state)).toThrow(detail);
    expect(classifyTrainingStorageValue(serializeState(state, 5))).toEqual({
      status: 'corrupt',
      kind: 'corrupt',
      reason: 'override-migration-conflict',
      detail,
      conflict: {
        dashboardEntryId: 'international-entry',
        unit: 'repetitions',
        overrides: [
          { activityId: LEGACY_UCHIKOMI_IDS[0], value: 4 },
          { activityId: LEGACY_UCHIKOMI_IDS[1], value: 5 },
          { activityId: LEGACY_UCHIKOMI_IDS[2], value: 4 },
        ],
      },
    });
  });
});

describe('older migration chain', () => {
  it('preserves v2 repetition data through full quantities and into v5 exercises', () => {
    const stateV3 = migratePersistedTrainingStateV2ToV3(legacyVersionTwoState());
    expect(stateV3.customTrainingSets[0]?.sections[0]?.steps[0]?.quantities).toEqual([
      { unit: 'repetitions', value: 20 },
      { unit: 'sets', value: null },
      { unit: 'minutes', value: null },
      { unit: 'rounds', value: null },
    ]);

    const stateV4 = migratePersistedTrainingStateV3ToV4(stateV3);
    const stateV5 = migratePersistedTrainingStateV4ToV5(stateV4);
    expect(stateV5.customTrainingSets[0]?.sections[0]?.exercises[0]).toEqual({
      id: 'legacy-exercise',
      name: 'Legacy exercise',
      notes: 'Mechanical note',
      quantities: { repetitions: 20 },
    });
    expect(stateV5.dashboardEntries[0]?.quantityOverrides).toEqual({
      'legacy-exercise': { repetitions: 0 },
    });
  });

  it('migrates v1 through every version without changing set, section, exercise, or entry IDs', () => {
    const migrated = migratePersistedTrainingState(legacyVersionOneState(), 1);
    expect(migrated.dashboardEntries[0]?.id).toBe('entry-legacy');
    expect(migrated.customTrainingSets[0]?.id).toBe('custom-legacy');
    expect(migrated.customTrainingSets[0]?.sections[0]?.id).toBe('custom-legacy-exercises');
    expect(migrated.customTrainingSets[0]?.sections[0]?.exercises[0]?.id).toBe('legacy-exercise');
  });
});

describe('persistence lifecycle', () => {
  it('writes version 6 and reloads custom sets, notes, seconds, and independent units', () => {
    const storage = new MemoryStorage();
    const first = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    const customId = first.getState().addCustomTrainingSet(CUSTOM_SET_INPUT);
    const entryId = first.getState().addToDashboard(customId);
    const activityId = first.getState().customTrainingSets[0]?.sections[0]?.exercises[0]?.id;
    if (activityId === undefined) {
      throw new Error('Expected a generated custom activity ID.');
    }

    first.getState().setQuantityOverride(entryId, activityId, 'repetitions', 12);
    first.getState().setQuantityOverride(entryId, activityId, 'seconds', 20);
    first.getState().updateDashboardEntry(entryId, { notes: 'Persist me.' });

    const envelope: unknown = JSON.parse(requireString(storage.read()));
    expect(envelope).toMatchObject({ version: TRAINING_STORE_PERSISTENCE_VERSION });

    const second = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    expect(second.getState().customTrainingSets[0]?.id).toBe(customId);
    expect(second.getState().dashboardEntries[0]).toMatchObject({
      id: entryId,
      notes: 'Persist me.',
      quantityOverrides: {
        [activityId]: { repetitions: 12, seconds: 20 },
      },
    });
  });

  it('loads a v4 envelope through Zustand and persists migrated v6 state', () => {
    const storage = new MemoryStorage(serializeState(LEGACY_V4_STATE, 4));
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });

    expect(store.getState().customTrainingSets[0]?.sections[0]?.exercises[0]?.name).toBe(
      'Legacy exercise',
    );
    expect(store.getState().dashboardEntries[0]?.quantityOverrides).toEqual({
      'legacy-exercise': { repetitions: 0, sets: 4, seconds: 30 },
    });
  });

  it('loads v5 Uchikomi overrides through Zustand under the corrected activity ID', () => {
    const state = versionFiveUchikomiState({
      [LEGACY_UCHIKOMI_IDS[0]]: { repetitions: 7 },
      [LEGACY_UCHIKOMI_IDS[1]]: { repetitions: 7, sets: 2 },
    });
    const storage = new MemoryStorage(serializeState(state, 5));
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });

    expect(store.getState().dashboardEntries[0]?.quantityOverrides).toEqual({
      [CORRECTED_UCHIKOMI_ID]: { repetitions: 7, sets: 2 },
    });
    const envelope: unknown = JSON.parse(requireString(storage.read()));
    expect(envelope).toMatchObject({ version: TRAINING_STORE_PERSISTENCE_VERSION });
  });

  it('supports async injected storage', async () => {
    const store = await createTrainingStoreAsync({
      storage: new AsyncMemoryStorage(),
      storageKey: STORAGE_KEY,
    });
    expect(store.getState().dashboardEntries).toEqual([]);
    store.getState().addToDashboard(asTrainingSetId('international-dojo-2-hour-session'));
    expect(store.getState().dashboardEntries).toHaveLength(1);
  });

  it('reports data that becomes invalid between preflight and hydration', () => {
    const validValue = serializeState({ dashboardEntries: [], customTrainingSets: [] }, 6);
    let reads = 0;
    let hydrationError: unknown;
    const storage: StateStorage = {
      getItem: () => {
        reads += 1;
        return reads === 1 ? validValue : '{became invalid';
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };

    const store = createTrainingStore({
      storage,
      storageKey: STORAGE_KEY,
      onHydrationError: (error) => {
        hydrationError = error;
      },
    });

    expect(hydrationError).toBeInstanceOf(SyntaxError);
    expect(store.getState().dashboardEntries).toEqual([]);
    expect(store.getState().customTrainingSets).toEqual([]);
  });

  it('removes and restores a dashboard entry at its previous position', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const firstId = store
      .getState()
      .addToDashboard(asTrainingSetId('international-dojo-2-hour-session'));
    store.getState().addToDashboard(asTrainingSetId('japanese-school-club'));

    const removed = store.getState().removeFromDashboard(firstId);
    if (removed === null) {
      throw new Error('Expected a removed dashboard entry.');
    }
    store.getState().restoreDashboardEntry(removed);
    expect(store.getState().dashboardEntries.map((entry) => entry.id)).toEqual([
      firstId,
      store.getState().dashboardEntries[1]?.id,
    ]);
  });
});

describe('untrusted persistence classification', () => {
  it('classifies empty, malformed, current, migrated, and future envelopes', () => {
    expect(classifyTrainingStorageValue(null).status).toBe('empty');
    expect(classifyTrainingStorageValue('{bad json')).toMatchObject({
      status: 'corrupt',
      reason: 'malformed-json',
    });
    expect(
      classifyTrainingStorageValue(
        serializeState({ dashboardEntries: [], customTrainingSets: [] }, 6),
      ),
    ).toMatchObject({ status: 'ready', version: 6 });
    expect(classifyTrainingStorageValue(serializeState(LEGACY_V4_STATE, 4))).toMatchObject({
      status: 'migrated',
      fromVersion: 4,
      version: 6,
    });
    expect(
      classifyTrainingStorageValue(
        serializeState({ dashboardEntries: [], customTrainingSets: [] }, 999),
      ),
    ).toEqual({ status: 'unsupported-future', kind: 'unsupported-future', version: 999 });
  });

  it('rejects duplicate current IDs, malformed ranges, and curated-ID collisions', () => {
    const validCurrent = migratePersistedTrainingStateV4ToV5(LEGACY_V4_STATE);
    const duplicateEntries = {
      ...validCurrent,
      dashboardEntries: [validCurrent.dashboardEntries[0], validCurrent.dashboardEntries[0]],
    };
    const malformedRange = {
      ...validCurrent,
      customTrainingSets: [
        {
          ...validCurrent.customTrainingSets[0],
          sections: [
            {
              ...validCurrent.customTrainingSets[0]?.sections[0],
              exercises: [
                {
                  id: 'range',
                  name: 'Range',
                  quantities: {
                    duration: { unit: 'seconds', min: 60, max: 30 },
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const collision = {
      dashboardEntries: [],
      customTrainingSets: [
        {
          id: DEFAULT_TRAINING_SETS[0]?.id,
          name: 'Collision',
          category: 'custom',
          sections: [{ id: 'section', name: 'Section', exercises: [] }],
          isBuiltIn: false,
        },
      ],
    };

    expect(parsePersistedTrainingState(duplicateEntries)).toBeNull();
    expect(parsePersistedTrainingState(malformedRange)).toBeNull();
    expect(parsePersistedTrainingState(collision)).toBeNull();
  });

  it('does not create a store over future-version data', () => {
    const storage = new MemoryStorage(
      serializeState({ dashboardEntries: [], customTrainingSets: [] }, 999),
    );
    expect(() => createTrainingStore({ storage, storageKey: STORAGE_KEY })).toThrow(
      TrainingStoreBootstrapError,
    );
    expect(storage.writes).toBe(0);
  });

  it('reports unavailable storage without trying to repair it', () => {
    const storage: StateStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(inspectTrainingStorage(storage, STORAGE_KEY)).toEqual({
      status: 'unavailable',
      kind: 'unavailable',
    });
  });
});
