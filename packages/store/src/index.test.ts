import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_TRAINING_SETS,
  TRAINING_DATA_LIMITS,
  asTrainingSetId,
  validateTrainingSetInput,
  type DashboardEntry,
  type TrainingActivity,
  type TrainingSetInput,
} from '@kendo-menu/domain';

import {
  TRAINING_STORE_PERSISTENCE_VERSION,
  TrainingStoreBootstrapError,
  classifyTrainingStorageValue,
  createTrainingJSONStorage,
  createTrainingStore,
  createTrainingStoreAsync,
  encodePersistedTrainingState,
  getDashboardEffectiveTrainingQuantity,
  inspectTrainingStorage,
  MAX_PERSISTED_JSON_CHARACTERS,
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
  parsePersistedTrainingState,
  parsePersistedTrainingStateV0,
  parsePersistedTrainingStateV1,
  parsePersistedTrainingStateV2,
  parsePersistedTrainingStateV3,
  parsePersistedTrainingStateV8,
  parsePersistedTrainingStateV4,
  parsePersistedTrainingStateV9,
  parsePersistedTrainingStateV10,
  parsePersistedTrainingWireStateV9,
  type LegacyDashboardEntry,
  type PersistedDashboardEntryV8,
  type StateStorage,
} from './index';

const STORAGE_KEY = 'test-kendo-menu';
const STATE_SEQUENCE_STRESS_SEED = 0x4b454e44;
const STATE_SEQUENCE_STRESS_ITERATIONS = 300;
const HOSTILE_DEPTH = 2_000;

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

const MIXED_MEASUREMENT_SET_INPUT = {
  name: 'Mixed measurement keiko',
  category: 'custom',
  sections: [
    {
      name: 'Main practice',
      exercises: [
        { name: 'Suburi', quantities: { repetitions: 30 } },
        { name: 'Jigeiko', quantities: { duration: { unit: 'minutes', value: 12.5 } } },
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
const POLICE_TYPE_TWO_MAWARIGEIKO_ID = 'police-dojo-asageiko-version-2-mawari-geiko-mawari-geiko';
const REMOVED_SENIOR_HIGH_SCHOOL_CORE_STRENGTH_ID =
  'senior-high-school-kendo-club-core-strength-training-core-strength-training';
const TOP_UNIVERSITY_HIKI_SEQUENCE_ID = 'top-university-yakusoku-geiko-hiki-do-men-kirikaeshi';
const TOP_UNIVERSITY_FREE_UCHIKOMI_ID = 'top-university-fee-version-uchikomi-geiko';
const TOP_UNIVERSITY_FREE_KAKARIGEIKO_ID = 'top-university-fee-version-kakari-geiko';
const TOP_UNIVERSITY_FINAL_KAKARIGEIKO_ID = 'top-university-kakarigeiko-kakarigeiko';
const LEGACY_UCHIKOMI_IDS = [
  'international-dojo-2-hour-session-uchikomi-men-1',
  'international-dojo-2-hour-session-uchikomi-kote',
  'international-dojo-2-hour-session-uchikomi-kote-men',
  'international-dojo-2-hour-session-uchikomi-men-2',
] as const;

function versionFiveUchikomiState(quantityOverrides: DashboardEntry['quantityOverrides']): {
  readonly dashboardEntries: readonly PersistedDashboardEntryV8[];
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
  reads = 0;
  writes = 0;

  constructor(initialValue?: string) {
    if (initialValue !== undefined) {
      this.#values.set(STORAGE_KEY, initialValue);
    }
  }

  getItem(name: string): Promise<string | null> {
    this.reads += 1;
    return Promise.resolve(this.#values.get(name) ?? null);
  }

  setItem(name: string, value: string): Promise<void> {
    this.writes += 1;
    this.#values.set(name, value);
    return Promise.resolve();
  }

  read(): Promise<string | null> {
    return this.getItem(STORAGE_KEY);
  }

  removeItem(name: string): Promise<void> {
    this.#values.delete(name);
    return Promise.resolve();
  }
}

function serializeState(state: unknown, version: number): string {
  return JSON.stringify({ state, version });
}

function repeatedText(length: number, character = 'x'): string {
  return character.repeat(length);
}

function dashboardWireEntry(index: number, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: `entry-${index}`,
    trainingSetId: asTrainingSetId(`unknown-session-${index}`),
    quantityOverrides: {},
    activityNotes: {},
    notes: '',
    createdAt: '',
    ...overrides,
  };
}

function customWireSet(index: number) {
  return {
    id: `custom-wire-${index}`,
    name: `Custom wire ${index}`,
    description: '',
    category: 'custom' as const,
    sections: [
      {
        id: `custom-wire-section-${index}`,
        name: 'Main work',
        exercises: [],
      },
    ],
    isBuiltIn: false as const,
  };
}

function maximumCustomSetInput(): TrainingSetInput {
  const sectionCount = TRAINING_DATA_LIMITS.customSections;
  const exerciseCount = TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet - sectionCount;
  const exercisesPerSection = Math.floor(exerciseCount / sectionCount);
  const sectionsWithOneExtraExercise = exerciseCount % sectionCount;
  const note = repeatedText(TRAINING_DATA_LIMITS.noteCharacters);
  return {
    name: 'Maximum custom session',
    description: repeatedText(TRAINING_DATA_LIMITS.descriptionCharacters),
    category: 'custom',
    sections: Array.from({ length: sectionCount }, (_, sectionIndex) => ({
      name: `Activity ${sectionIndex}`,
      notes: note,
      exercises: Array.from(
        {
          length: exercisesPerSection + (sectionIndex < sectionsWithOneExtraExercise ? 1 : 0),
        },
        (_, exerciseIndex) => ({
          name: `Exercise ${sectionIndex}-${exerciseIndex}`,
          notes: note,
        }),
      ),
    })),
  };
}

function deepRuntimeActivity(depth: number): TrainingActivity {
  let current: TrainingActivity = {
    id: `deep-${depth}`,
    name: `Deep ${depth}`,
    children: [],
  };
  for (let level = depth - 1; level >= 1; level -= 1) {
    current = { id: `deep-${level}`, name: `Deep ${level}`, children: [current] };
  }
  return current;
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

function createDeterministicIndexGenerator(seed: number): (limit: number) => number {
  let state = seed >>> 0;
  return (limit: number) => {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error('Deterministic index limits must be positive integers.');
    }
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % limit;
  };
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
    const result = store.getState().createCustomTrainingSetAndAddToDashboard(CUSTOM_SET_INPUT);
    const { trainingSet } = result;

    expect(trainingSet).toMatchObject({
      id: result.trainingSetId,
      name: CUSTOM_SET_INPUT.name,
      description: CUSTOM_SET_INPUT.description,
      category: 'custom',
      isBuiltIn: false,
    });
    expect(trainingSet?.activities.map((section) => section.name)).toEqual([
      'Preparation',
      'Closing',
    ]);
    expect(trainingSet?.activities[0]?.children[0]).toMatchObject({
      name: 'Okuri-ashi',
      quantities: { repetitions: 0 },
      notes: 'Keep the feet quiet.',
    });

    const ids =
      trainingSet === undefined
        ? []
        : [
            trainingSet.id,
            ...trainingSet.activities.flatMap((section) => [
              section.id,
              ...section.children.map((exercise) => exercise.id),
            ]),
          ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('creates a custom set and dashboard entry atomically', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const result = store.getState().createCustomTrainingSetAndAddToDashboard(CUSTOM_SET_INPUT);

    expect(store.getState().dashboardEntries).toEqual([result.dashboardEntry]);
    expect(result.dashboardEntry.trainingSetId).toBe(result.trainingSetId);
    expect(result.dashboardEntry.trainingSet).toEqual(result.trainingSet);
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
    expect(store.getState().dashboardEntries).toEqual([]);
  });

  it('rejects one-over authored limits without partially changing state', () => {
    const storage = new MemoryStorage();
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    const sourceSection = CUSTOM_SET_INPUT.sections[0];
    const sourceExercise = sourceSection?.exercises[0];
    if (sourceSection === undefined || sourceExercise === undefined) {
      throw new Error('Expected the custom input fixture to contain an exercise.');
    }
    const candidates: readonly TrainingSetInput[] = [
      {
        ...CUSTOM_SET_INPUT,
        name: repeatedText(TRAINING_DATA_LIMITS.nameCharacters + 1),
      },
      {
        ...CUSTOM_SET_INPUT,
        description: repeatedText(TRAINING_DATA_LIMITS.descriptionCharacters + 1),
      },
      {
        ...CUSTOM_SET_INPUT,
        sections: [
          {
            ...sourceSection,
            name: repeatedText(TRAINING_DATA_LIMITS.nameCharacters + 1),
          },
        ],
      },
      {
        ...CUSTOM_SET_INPUT,
        sections: [
          {
            ...sourceSection,
            exercises: [
              {
                ...sourceExercise,
                name: repeatedText(TRAINING_DATA_LIMITS.nameCharacters + 1),
              },
            ],
          },
        ],
      },
      {
        ...CUSTOM_SET_INPUT,
        sections: [
          {
            ...sourceSection,
            notes: repeatedText(TRAINING_DATA_LIMITS.noteCharacters + 1),
          },
        ],
      },
      {
        ...CUSTOM_SET_INPUT,
        sections: [
          {
            ...sourceSection,
            exercises: [
              {
                ...sourceExercise,
                notes: repeatedText(TRAINING_DATA_LIMITS.noteCharacters + 1),
              },
            ],
          },
        ],
      },
    ];

    for (const candidate of candidates) {
      expect(() => store.getState().createCustomTrainingSetAndAddToDashboard(candidate)).toThrow();
      expect(store.getState().dashboardEntries).toEqual([]);
    }
    expect(storage.writes).toBe(0);
  });
});

describe('persistence resource limits', () => {
  it('accepts exact dashboard and legacy custom-set collection limits and rejects one-over', () => {
    const exactDashboard = Array.from(
      { length: TRAINING_DATA_LIMITS.dashboardEntries },
      (_, index) => dashboardWireEntry(index),
    );
    expect(parsePersistedTrainingStateV10({ dashboardEntries: exactDashboard })).not.toBeNull();
    expect(
      parsePersistedTrainingStateV10({
        dashboardEntries: [
          ...exactDashboard,
          dashboardWireEntry(TRAINING_DATA_LIMITS.dashboardEntries),
        ],
      }),
    ).toBeNull();

    const exactCustomSets = Array.from(
      { length: TRAINING_DATA_LIMITS.legacyCustomSetCollection },
      (_, index) => customWireSet(index),
    );
    expect(
      parsePersistedTrainingStateV9({ dashboardEntries: [], customTrainingSets: exactCustomSets }),
    ).not.toBeNull();
    expect(
      parsePersistedTrainingStateV9({
        dashboardEntries: [],
        customTrainingSets: [
          ...exactCustomSets,
          customWireSet(TRAINING_DATA_LIMITS.legacyCustomSetCollection),
        ],
      }),
    ).toBeNull();
  });

  it('bounds wire custom sections, exercises per section, and total activities', () => {
    const exactSections = Array.from(
      { length: TRAINING_DATA_LIMITS.customSections },
      (_, index) => ({
        id: `wire-section-${index}`,
        name: `Wire section ${index}`,
        exercises: [],
      }),
    );
    const exactSectionSet = { ...customWireSet(1000), sections: exactSections };
    expect(
      parsePersistedTrainingStateV9({
        dashboardEntries: [],
        customTrainingSets: [exactSectionSet],
      }),
    ).not.toBeNull();
    expect(
      parsePersistedTrainingStateV9({
        dashboardEntries: [],
        customTrainingSets: [
          {
            ...exactSectionSet,
            sections: [
              ...exactSections,
              { id: 'wire-section-over', name: 'Wire section over', exercises: [] },
            ],
          },
        ],
      }),
    ).toBeNull();

    const exactExercises = Array.from(
      { length: TRAINING_DATA_LIMITS.exercisesPerSection },
      (_, index) => ({ id: `wire-exercise-${index}`, name: `Wire exercise ${index}` }),
    );
    const exactExerciseSet = {
      ...customWireSet(1001),
      sections: [{ id: 'wire-exercise-section', name: 'Wire section', exercises: exactExercises }],
    };
    expect(
      parsePersistedTrainingStateV9({
        dashboardEntries: [],
        customTrainingSets: [exactExerciseSet],
      }),
    ).not.toBeNull();
    expect(
      parsePersistedTrainingStateV9({
        dashboardEntries: [],
        customTrainingSets: [
          {
            ...exactExerciseSet,
            sections: [
              {
                ...exactExerciseSet.sections[0],
                exercises: [
                  ...exactExercises,
                  { id: 'wire-exercise-over', name: 'Wire exercise over' },
                ],
              },
            ],
          },
        ],
      }),
    ).toBeNull();

    const exactTotalSections = Array.from({ length: 4 }, (_, sectionIndex) => ({
      id: `wire-total-section-${sectionIndex}`,
      name: `Wire total section ${sectionIndex}`,
      exercises: Array.from(
        { length: TRAINING_DATA_LIMITS.exercisesPerSection - 1 },
        (_, exerciseIndex) => ({
          id: `wire-total-exercise-${sectionIndex}-${exerciseIndex}`,
          name: `Wire total exercise ${sectionIndex}-${exerciseIndex}`,
        }),
      ),
    }));
    const exactTotalSet = { ...customWireSet(1002), sections: exactTotalSections };
    expect(
      parsePersistedTrainingStateV9({
        dashboardEntries: [],
        customTrainingSets: [exactTotalSet],
      }),
    ).not.toBeNull();
    expect(
      parsePersistedTrainingStateV9({
        dashboardEntries: [],
        customTrainingSets: [
          {
            ...exactTotalSet,
            sections: [
              ...exactTotalSections.slice(0, 3),
              {
                id: 'wire-total-section-over',
                name: 'Wire total section over',
                exercises: Array.from(
                  { length: TRAINING_DATA_LIMITS.exercisesPerSection },
                  (_, exerciseIndex) => ({
                    id: `wire-total-over-exercise-${exerciseIndex}`,
                    name: `Wire total over exercise ${exerciseIndex}`,
                  }),
                ),
              },
            ],
          },
        ],
      }),
    ).toBeNull();
  });

  it('accepts exact outer override/note records and text fields and rejects one-over values', () => {
    const quantityOverrides = Object.fromEntries(
      Array.from({ length: TRAINING_DATA_LIMITS.dashboardRecordEntries }, (_, index) => [
        `activity-${index}`,
        { repetitions: 0 },
      ]),
    );
    const activityNotes = Object.fromEntries(
      Array.from({ length: TRAINING_DATA_LIMITS.dashboardRecordEntries }, (_, index) => [
        `activity-${index}`,
        'note',
      ]),
    );
    const exactEntry = dashboardWireEntry(0, {
      quantityOverrides,
      activityNotes,
      notes: repeatedText(TRAINING_DATA_LIMITS.noteCharacters),
      createdAt: repeatedText(TRAINING_DATA_LIMITS.timestampCharacters),
      id: repeatedText(TRAINING_DATA_LIMITS.identifierCharacters, 'e'),
      trainingSetId: asTrainingSetId(repeatedText(TRAINING_DATA_LIMITS.identifierCharacters, 's')),
    });
    expect(parsePersistedTrainingStateV10({ dashboardEntries: [exactEntry] })).not.toBeNull();

    const overQuantityOverrides = {
      ...quantityOverrides,
      'activity-over': { repetitions: 0 },
    };
    const overActivityNotes = { ...activityNotes, 'activity-over': 'note' };
    expect(
      parsePersistedTrainingStateV10({
        dashboardEntries: [{ ...exactEntry, quantityOverrides: overQuantityOverrides }],
      }),
    ).toBeNull();
    expect(
      parsePersistedTrainingStateV10({
        dashboardEntries: [{ ...exactEntry, activityNotes: overActivityNotes }],
      }),
    ).toBeNull();
    expect(
      parsePersistedTrainingStateV10({
        dashboardEntries: [
          { ...exactEntry, notes: repeatedText(TRAINING_DATA_LIMITS.noteCharacters + 1) },
        ],
      }),
    ).toBeNull();
    expect(
      parsePersistedTrainingStateV10({
        dashboardEntries: [
          {
            ...exactEntry,
            createdAt: repeatedText(TRAINING_DATA_LIMITS.timestampCharacters + 1),
          },
        ],
      }),
    ).toBeNull();
    expect(
      parsePersistedTrainingStateV10({
        dashboardEntries: [
          { ...exactEntry, id: repeatedText(TRAINING_DATA_LIMITS.identifierCharacters + 1) },
        ],
      }),
    ).toBeNull();
    expect(
      parsePersistedTrainingStateV10({
        dashboardEntries: [
          {
            ...exactEntry,
            trainingSetId: asTrainingSetId(
              repeatedText(TRAINING_DATA_LIMITS.identifierCharacters + 1, 's'),
            ),
          },
        ],
      }),
    ).toBeNull();
    const overRecordKey = repeatedText(TRAINING_DATA_LIMITS.identifierCharacters + 1, 'a');
    expect(
      parsePersistedTrainingStateV10({
        dashboardEntries: [
          {
            ...exactEntry,
            quantityOverrides: { [overRecordKey]: { repetitions: 0 } },
            activityNotes: { [overRecordKey]: 'note' },
          },
        ],
      }),
    ).toBeNull();

    const exactCustom = {
      ...customWireSet(0),
      id: repeatedText(TRAINING_DATA_LIMITS.identifierCharacters, 'c'),
      name: repeatedText(TRAINING_DATA_LIMITS.nameCharacters),
      description: repeatedText(TRAINING_DATA_LIMITS.descriptionCharacters),
      sections: [
        {
          id: repeatedText(TRAINING_DATA_LIMITS.identifierCharacters, 'a'),
          name: repeatedText(TRAINING_DATA_LIMITS.nameCharacters),
          notes: repeatedText(TRAINING_DATA_LIMITS.noteCharacters),
          exercises: [
            {
              id: repeatedText(TRAINING_DATA_LIMITS.identifierCharacters, 'x'),
              name: repeatedText(TRAINING_DATA_LIMITS.nameCharacters),
              notes: repeatedText(TRAINING_DATA_LIMITS.noteCharacters),
            },
          ],
        },
      ],
    };
    expect(
      parsePersistedTrainingStateV9({ dashboardEntries: [], customTrainingSets: [exactCustom] }),
    ).not.toBeNull();
    const customOverflowCases = [
      { name: repeatedText(TRAINING_DATA_LIMITS.nameCharacters + 1) },
      { description: repeatedText(TRAINING_DATA_LIMITS.descriptionCharacters + 1) },
      {
        sections: [
          {
            ...exactCustom.sections[0],
            name: repeatedText(TRAINING_DATA_LIMITS.nameCharacters + 1),
          },
        ],
      },
      {
        sections: [
          {
            ...exactCustom.sections[0],
            notes: repeatedText(TRAINING_DATA_LIMITS.noteCharacters + 1),
          },
        ],
      },
    ] as const;
    for (const overrides of customOverflowCases) {
      expect(
        parsePersistedTrainingStateV9({
          dashboardEntries: [],
          customTrainingSets: [{ ...exactCustom, ...overrides }],
        }),
      ).toBeNull();
    }
  });

  it('rejects oversized raw JSON before parsing and refuses oversized writes', () => {
    const base = serializeState({ dashboardEntries: [] }, TRAINING_STORE_PERSISTENCE_VERSION);
    const exact = `${base}${' '.repeat(MAX_PERSISTED_JSON_CHARACTERS - base.length)}`;
    const over = `${exact} `;
    expect(exact.length).toBe(MAX_PERSISTED_JSON_CHARACTERS);
    expect(classifyTrainingStorageValue(exact)).toMatchObject({ status: 'ready' });

    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw new Error('oversized values must not be parsed');
    });
    try {
      expect(classifyTrainingStorageValue(over)).toEqual({
        status: 'corrupt',
        kind: 'corrupt',
        reason: 'resource-limit',
      });
      expect(parseSpy).not.toHaveBeenCalled();
    } finally {
      parseSpy.mockRestore();
    }

    const hugeNote = repeatedText(TRAINING_DATA_LIMITS.noteCharacters);
    const largeState = {
      dashboardEntries: Array.from(
        { length: TRAINING_DATA_LIMITS.dashboardEntries },
        (_, index) => {
          const trainingSetId = asTrainingSetId(`large-custom-${index}`);
          return {
            id: `large-entry-${index}`,
            trainingSetId,
            trainingSet: {
              id: trainingSetId,
              name: `Large custom ${index}`,
              description: repeatedText(TRAINING_DATA_LIMITS.descriptionCharacters),
              category: 'custom' as const,
              activities: [
                {
                  id: `large-section-${index}`,
                  name: 'Large section',
                  notes: hugeNote,
                  children: [
                    {
                      id: `large-exercise-${index}`,
                      name: 'Large exercise',
                      notes: hugeNote,
                      children: [],
                    },
                  ],
                },
              ],
              isBuiltIn: false as const,
            },
            quantityOverrides: {},
            activityNotes: {},
            notes: hugeNote,
            createdAt: '',
          };
        },
      ),
    } satisfies { readonly dashboardEntries: readonly DashboardEntry[] };
    const storage = new MemoryStorage();
    const persistStorage = createTrainingJSONStorage(storage);
    expect(() =>
      persistStorage.setItem(STORAGE_KEY, {
        state: largeState,
        version: TRAINING_STORE_PERSISTENCE_VERSION,
      }),
    ).toThrow(/exceeds/);
    expect(storage.writes).toBe(0);
  });

  it('rejects an oversized custom creation atomically before state or storage mutation', () => {
    const persistedBefore = serializeState(
      { dashboardEntries: [] },
      TRAINING_STORE_PERSISTENCE_VERSION,
    );
    const storage = new MemoryStorage(persistedBefore);
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    const input = maximumCustomSetInput();
    const activityCount = input.sections.reduce(
      (total, section) => total + 1 + section.exercises.length,
      0,
    );
    expect(activityCount).toBe(TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet);
    expect(validateTrainingSetInput(input).success).toBe(true);

    const dashboardBefore = store.getState().dashboardEntries;
    const writesBefore = storage.writes;
    expect(() => store.getState().createCustomTrainingSetAndAddToDashboard(input)).toThrow(
      /exceeds/,
    );

    expect(store.getState().dashboardEntries).toEqual(dashboardBefore);
    expect(storage.writes).toBe(writesBefore);
    expect(storage.read()).toBe(persistedBefore);
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
      activityNotes: {},
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
      children: [],
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
    expect(() => {
      Reflect.apply(store.getState().updateDashboardEntry, undefined, [entryId, { notes: 42 }]);
    }).toThrow('Dashboard notes must be a string.');
  });
});

describe('dashboard activity note APIs', () => {
  it('accepts exact note limits and rejects one-over writes without changing state', () => {
    const storage = new MemoryStorage();
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    const entryId = store
      .getState()
      .addToDashboard(asTrainingSetId('international-dojo-2-hour-session'));
    const activityId = 'international-dojo-2-hour-session-warm-up-warm-up';
    const exactNote = repeatedText(TRAINING_DATA_LIMITS.noteCharacters);

    store.getState().setActivityNote(entryId, activityId, exactNote);
    expect(store.getState().dashboardEntries[0]?.activityNotes[activityId]).toBe(exactNote);
    const beforeOverflow = store.getState().dashboardEntries;
    expect(() =>
      store
        .getState()
        .setActivityNote(
          entryId,
          activityId,
          repeatedText(TRAINING_DATA_LIMITS.noteCharacters + 1),
        ),
    ).toThrow();
    expect(store.getState().dashboardEntries).toEqual(beforeOverflow);

    store.getState().updateDashboardEntry(entryId, { notes: exactNote });
    const beforeSessionOverflow = store.getState().dashboardEntries;
    expect(() =>
      store.getState().updateDashboardEntry(entryId, {
        notes: repeatedText(TRAINING_DATA_LIMITS.noteCharacters + 1),
      }),
    ).toThrow();
    expect(store.getState().dashboardEntries).toEqual(beforeSessionOverflow);
  });

  it('starts entries empty, preserves meaningful whitespace, and removes blank notes', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const entryId = store
      .getState()
      .addToDashboard(asTrainingSetId('international-dojo-2-hour-session'));

    expect(requireFirstDashboardEntry(store.getState().dashboardEntries).activityNotes).toEqual({});

    store
      .getState()
      .setActivityNote(
        entryId,
        'international-dojo-2-hour-session-warm-up-warm-up',
        '  Keep the knees soft.\nBreathe.  ',
      );
    expect(requireFirstDashboardEntry(store.getState().dashboardEntries).activityNotes).toEqual({
      'international-dojo-2-hour-session-warm-up-warm-up': '  Keep the knees soft.\nBreathe.  ',
    });

    store
      .getState()
      .setActivityNote(
        entryId,
        'international-dojo-2-hour-session-warm-up-warm-up',
        'Updated note',
      );
    expect(requireFirstDashboardEntry(store.getState().dashboardEntries).activityNotes).toEqual({
      'international-dojo-2-hour-session-warm-up-warm-up': 'Updated note',
    });

    store
      .getState()
      .setActivityNote(entryId, 'international-dojo-2-hour-session-warm-up-warm-up', ' \n  ');
    expect(requireFirstDashboardEntry(store.getState().dashboardEntries).activityNotes).toEqual({});
  });

  it('keeps notes independent for duplicate dashboard entries', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const trainingSetId = asTrainingSetId('international-dojo-2-hour-session');
    const firstId = store.getState().addToDashboard(trainingSetId);
    const secondId = store.getState().addToDashboard(trainingSetId);
    const activityId = 'international-dojo-2-hour-session-warm-up-warm-up';

    store.getState().setActivityNote(firstId, activityId, 'First entry');
    store.getState().setActivityNote(secondId, activityId, 'Second entry');

    expect(store.getState().dashboardEntries).toEqual([
      expect.objectContaining({ id: firstId, activityNotes: { [activityId]: 'First entry' } }),
      expect.objectContaining({ id: secondId, activityNotes: { [activityId]: 'Second entry' } }),
    ]);
  });

  it('rejects blank, unknown, ineligible, and custom activity targets', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const entryId = store
      .getState()
      .addToDashboard(asTrainingSetId('international-dojo-2-hour-session'));

    expect(() => store.getState().setActivityNote('', 'activity', 'note')).toThrow();
    expect(() => store.getState().setActivityNote(entryId, '', 'note')).toThrow();
    expect(() => {
      Reflect.apply(store.getState().setActivityNote, undefined, [42, 'activity', 'note']);
    }).toThrow();
    expect(() => {
      Reflect.apply(store.getState().setActivityNote, undefined, [entryId, 42, 'note']);
    }).toThrow();
    expect(() => {
      Reflect.apply(store.getState().setActivityNote, undefined, [entryId, 'activity', 42]);
    }).toThrow();
    expect(() => store.getState().setActivityNote(entryId, 'unknown-activity', 'note')).toThrow();
    expect(() =>
      store
        .getState()
        .setActivityNote(
          entryId,
          'international-dojo-2-hour-session-kirikaeshi-kirikaeshi',
          'note',
        ),
    ).toThrow();

    const customResult = store
      .getState()
      .createCustomTrainingSetAndAddToDashboard(CUSTOM_SET_INPUT);
    const customEntryId = customResult.dashboardEntryId;
    const customActivityId =
      customResult.dashboardEntry.trainingSet?.activities[0]?.children[0]?.id;
    if (customActivityId === undefined) {
      throw new Error('Expected a custom activity.');
    }
    expect(() =>
      store.getState().setActivityNote(customEntryId, customActivityId, 'note'),
    ).toThrow();
  });

  it('restores activity notes when an entry is undone', () => {
    const store = createTrainingStore({ storage: new MemoryStorage(), storageKey: STORAGE_KEY });
    const entryId = store
      .getState()
      .addToDashboard(asTrainingSetId('international-dojo-2-hour-session'));
    const activityId = 'international-dojo-2-hour-session-warm-up-warm-up';
    store.getState().setActivityNote(entryId, activityId, 'Restore me');

    const removed = store.getState().removeFromDashboard(entryId);
    if (removed === null) {
      throw new Error('Expected a removed dashboard entry.');
    }
    store.getState().restoreDashboardEntry(removed);
    expect(requireFirstDashboardEntry(store.getState().dashboardEntries).activityNotes).toEqual({
      [activityId]: 'Restore me',
    });
  });
});

describe('version 4 to version 5 migration', () => {
  it('converts null-filled arrays to sparse quantities and preserves every ID and value', () => {
    const migrated = migratePersistedTrainingStateV4ToV5(LEGACY_V4_STATE);
    const trainingSet = migrated.customTrainingSets[0];
    const section = trainingSet?.activities[0];
    const firstExercise = section?.children[0];
    const secondExercise = section?.children[1];

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
      children: [],
    });
    expect(secondExercise).toEqual({
      id: 'unknown-exercise',
      name: 'Unknown exercise',
      quantities: { repetitions: 24 },
      children: [],
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
    expect(migrated.customTrainingSets[0]?.activities[0]?.children[0]?.notes).toBe('');
    expect(
      Object.hasOwn(migrated.customTrainingSets[0]?.activities[0]?.children[1] ?? {}, 'notes'),
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
    expect(
      DEFAULT_TRAINING_SETS[0]?.activities.some((section) => section.id === standaloneId),
    ).toBe(true);
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

  it('preserves prototype-named unrelated activity IDs while rebuilding override maps', () => {
    const quantityOverrides = Object.fromEntries([
      ['__proto__', { seconds: 45 }],
      [LEGACY_UCHIKOMI_IDS[0], { repetitions: 5 }],
    ]);
    const migrated = migratePersistedTrainingStateV5ToV6(
      versionFiveUchikomiState(quantityOverrides),
    );
    const migratedOverrides = migrated.dashboardEntries[0]?.quantityOverrides;

    expect(Object.hasOwn(migratedOverrides ?? {}, '__proto__')).toBe(true);
    expect(migratedOverrides?.['__proto__']).toEqual({ seconds: 45 });
    expect(migratedOverrides?.[CORRECTED_UCHIKOMI_ID]).toEqual({ repetitions: 5 });
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

describe('version 6 to version 7 curated-data correction migration', () => {
  it('keeps Mawarigeiko minutes, removes incompatible and stale overrides, and round-trips', () => {
    const customTrainingSets =
      migratePersistedTrainingStateV4ToV5(LEGACY_V4_STATE).customTrainingSets;
    const state = {
      dashboardEntries: [
        {
          id: 'police-entry',
          trainingSetId: asTrainingSetId('police-dojo-asageiko-version-2'),
          quantityOverrides: {
            [POLICE_TYPE_TWO_MAWARIGEIKO_ID]: {
              repetitions: 6,
              sets: 2,
              rounds: 1,
              seconds: 45,
              minutes: 8,
            },
            [REMOVED_SENIOR_HIGH_SCHOOL_CORE_STRENGTH_ID]: { minutes: 5 },
            'unrelated-activity': { repetitions: 12, seconds: 30 },
          },
          notes: 'Preserve the police entry note.',
          createdAt: '2026-08-28T10:00:00.000Z',
        },
        {
          id: 'other-entry',
          trainingSetId: asTrainingSetId('custom-legacy'),
          quantityOverrides: {
            [POLICE_TYPE_TWO_MAWARIGEIKO_ID]: { repetitions: 4 },
            [REMOVED_SENIOR_HIGH_SCHOOL_CORE_STRENGTH_ID]: { repetitions: 10 },
            'legacy-exercise': { repetitions: 0, sets: 4, seconds: 30 },
          },
          notes: 'Preserve the unrelated entry note.',
          createdAt: '2026-08-19T10:00:00.000Z',
        },
        {
          id: 'senior-entry',
          trainingSetId: asTrainingSetId('senior-high-school-kendo-club'),
          quantityOverrides: {
            [REMOVED_SENIOR_HIGH_SCHOOL_CORE_STRENGTH_ID]: { minutes: 5 },
            'unrelated-senior-activity': { repetitions: 7 },
          },
          notes: 'Preserve the senior entry note.',
          createdAt: '2026-08-28T11:00:00.000Z',
        },
        {
          id: 'zero-entry',
          trainingSetId: asTrainingSetId('police-dojo-asageiko-version-2'),
          quantityOverrides: {
            [POLICE_TYPE_TWO_MAWARIGEIKO_ID]: { seconds: 0, minutes: 0 },
          },
          notes: 'Preserve an explicit zero.',
          createdAt: '',
        },
      ],
      customTrainingSets,
    } as const;

    const migrated = migratePersistedTrainingStateV6ToV7(state);

    expect(migrated.dashboardEntries).toEqual([
      {
        ...state.dashboardEntries[0],
        quantityOverrides: {
          [POLICE_TYPE_TWO_MAWARIGEIKO_ID]: { minutes: 8 },
          [REMOVED_SENIOR_HIGH_SCHOOL_CORE_STRENGTH_ID]: { minutes: 5 },
          'unrelated-activity': { repetitions: 12, seconds: 30 },
        },
      },
      {
        ...state.dashboardEntries[1],
        quantityOverrides: {
          [POLICE_TYPE_TWO_MAWARIGEIKO_ID]: { repetitions: 4 },
          [REMOVED_SENIOR_HIGH_SCHOOL_CORE_STRENGTH_ID]: { repetitions: 10 },
          'legacy-exercise': { repetitions: 0, sets: 4, seconds: 30 },
        },
      },
      {
        ...state.dashboardEntries[2],
        quantityOverrides: {
          'unrelated-senior-activity': { repetitions: 7 },
        },
      },
      {
        ...state.dashboardEntries[3],
        quantityOverrides: {
          [POLICE_TYPE_TWO_MAWARIGEIKO_ID]: { minutes: 0 },
        },
      },
    ]);
    expect(migrated.customTrainingSets).toEqual(customTrainingSets);
    expect(parsePersistedTrainingStateV8(migrated)).toEqual(migrated);
    const migratedV9 = migratePersistedTrainingStateV8ToV9(migrated);
    expect(parsePersistedTrainingState(encodePersistedTrainingState(migratedV9))).toEqual(
      migratedV9,
    );
  });

  it('rejects malformed version 6 input before applying cleanup', () => {
    const malformed = {
      dashboardEntries: [
        {
          id: 'malformed-entry',
          trainingSetId: asTrainingSetId('police-dojo-asageiko-version-2'),
          quantityOverrides: {
            [POLICE_TYPE_TWO_MAWARIGEIKO_ID]: { minutes: Number.POSITIVE_INFINITY },
          },
          notes: '',
          createdAt: '',
        },
      ],
      customTrainingSets: [],
    };

    expect(() => migratePersistedTrainingStateV6ToV7(malformed)).toThrow(
      'Training-store version 6 state is invalid.',
    );
  });

  it('classifies an old version 6 envelope as migrated with the same cleanup', () => {
    const state = {
      dashboardEntries: [
        {
          id: 'version-six-entry',
          trainingSetId: asTrainingSetId('police-dojo-asageiko-version-2'),
          quantityOverrides: {
            [POLICE_TYPE_TWO_MAWARIGEIKO_ID]: { repetitions: 6, minutes: 9 },
            [REMOVED_SENIOR_HIGH_SCHOOL_CORE_STRENGTH_ID]: { repetitions: 3 },
          },
          notes: 'Keep me.',
          createdAt: '',
        },
      ],
      customTrainingSets: [],
    };

    const inspection = classifyTrainingStorageValue(serializeState(state, 6));

    expect(inspection).toMatchObject({
      status: 'migrated',
      fromVersion: 6,
      version: TRAINING_STORE_PERSISTENCE_VERSION,
    });
    if (inspection.status !== 'migrated') {
      throw new Error('Expected the version 6 envelope to migrate.');
    }
    expect(inspection.state.dashboardEntries[0]).toMatchObject({
      notes: 'Keep me.',
    });
    expect(inspection.state.dashboardEntries[0]?.quantityOverrides).toEqual({
      [POLICE_TYPE_TWO_MAWARIGEIKO_ID]: { minutes: 9 },
      [REMOVED_SENIOR_HIGH_SCHOOL_CORE_STRENGTH_ID]: { repetitions: 3 },
    });
  });
});

describe('version 7 to version 8 complex-session correction migration', () => {
  it('removes incompatible overrides while retaining valid seconds and unrelated state', () => {
    const state = {
      dashboardEntries: [
        {
          id: 'top-university-entry',
          trainingSetId: asTrainingSetId('top-university'),
          quantityOverrides: {
            [TOP_UNIVERSITY_HIKI_SEQUENCE_ID]: { repetitions: 100, seconds: 20 },
            [TOP_UNIVERSITY_FREE_UCHIKOMI_ID]: {
              repetitions: 5,
              minutes: 2,
              seconds: 45,
            },
            [TOP_UNIVERSITY_FREE_KAKARIGEIKO_ID]: { seconds: 30, rounds: 2 },
            [TOP_UNIVERSITY_FINAL_KAKARIGEIKO_ID]: { minutes: 3 },
            'unrelated-activity': { repetitions: 12, seconds: 30 },
          },
          notes: 'Preserve this session note.',
          createdAt: '2026-08-28T10:00:00.000Z',
        },
        {
          id: 'unrelated-entry',
          trainingSetId: asTrainingSetId('custom-collision'),
          quantityOverrides: {
            [TOP_UNIVERSITY_HIKI_SEQUENCE_ID]: { repetitions: 100, seconds: 20 },
            [TOP_UNIVERSITY_FREE_UCHIKOMI_ID]: { repetitions: 5, minutes: 2 },
            [TOP_UNIVERSITY_FINAL_KAKARIGEIKO_ID]: { rounds: 2 },
          },
          notes: 'Preserve all coincident custom overrides.',
          createdAt: '2026-08-28T11:00:00.000Z',
        },
      ],
      customTrainingSets: [],
    } as const;

    const migrated = migratePersistedTrainingStateV7ToV8(state);

    expect(migrated.dashboardEntries).toEqual([
      {
        ...state.dashboardEntries[0],
        quantityOverrides: {
          [TOP_UNIVERSITY_HIKI_SEQUENCE_ID]: { seconds: 20 },
          [TOP_UNIVERSITY_FREE_UCHIKOMI_ID]: { seconds: 45 },
          [TOP_UNIVERSITY_FREE_KAKARIGEIKO_ID]: { seconds: 30 },
          'unrelated-activity': { repetitions: 12, seconds: 30 },
        },
      },
      state.dashboardEntries[1],
    ]);
    expect(parsePersistedTrainingStateV8(migrated)).toEqual(migrated);
  });

  it('removes a corrected repetition-only override and drops seconds-less target entries', () => {
    const state = {
      dashboardEntries: [
        {
          id: 'top-university-entry',
          trainingSetId: asTrainingSetId('top-university'),
          quantityOverrides: {
            [TOP_UNIVERSITY_HIKI_SEQUENCE_ID]: { repetitions: 100 },
            [TOP_UNIVERSITY_FREE_UCHIKOMI_ID]: { repetitions: 5 },
            [TOP_UNIVERSITY_FINAL_KAKARIGEIKO_ID]: { rounds: 2 },
          },
          notes: '',
          createdAt: '',
        },
      ],
      customTrainingSets: [],
    };

    const migrated = migratePersistedTrainingStateV7ToV8(state);

    expect(migrated.dashboardEntries[0]?.quantityOverrides).toEqual({});
  });

  it('classifies a version 7 envelope as migrated through version 8 to current', () => {
    const state = {
      dashboardEntries: [
        {
          id: 'version-seven-entry',
          trainingSetId: asTrainingSetId('top-university'),
          quantityOverrides: {
            [TOP_UNIVERSITY_FINAL_KAKARIGEIKO_ID]: { seconds: 90, minutes: 2 },
          },
          notes: 'Keep me.',
          createdAt: '',
        },
      ],
      customTrainingSets: [],
    };

    const inspection = classifyTrainingStorageValue(serializeState(state, 7));

    expect(inspection).toMatchObject({
      status: 'migrated',
      fromVersion: 7,
      version: TRAINING_STORE_PERSISTENCE_VERSION,
    });
    if (inspection.status !== 'migrated') {
      throw new Error('Expected the version 7 envelope to migrate.');
    }
    expect(inspection.state.dashboardEntries[0]?.quantityOverrides).toEqual({
      [TOP_UNIVERSITY_FINAL_KAKARIGEIKO_ID]: { seconds: 90 },
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
    expect(stateV5.customTrainingSets[0]?.activities[0]?.children[0]).toEqual({
      id: 'legacy-exercise',
      name: 'Legacy exercise',
      notes: 'Mechanical note',
      quantities: { repetitions: 20 },
      children: [],
    });
    expect(stateV5.dashboardEntries[0]?.quantityOverrides).toEqual({
      'legacy-exercise': { repetitions: 0 },
    });
  });

  it('migrates v1 through every version without changing set, section, exercise, or entry IDs', () => {
    const migrated = migratePersistedTrainingState(legacyVersionOneState(), 1);
    const trainingSet = migrated.dashboardEntries[0]?.trainingSet;
    expect(migrated.dashboardEntries[0]?.id).toBe('entry-legacy');
    expect(trainingSet?.id).toBe('custom-legacy');
    expect(trainingSet?.activities[0]?.id).toBe('custom-legacy-exercises');
    expect(trainingSet?.activities[0]?.children[0]?.id).toBe('legacy-exercise');
  });

  it('migrates every supported historical start version from 0 through 8 to version 10', () => {
    const stateV0 = legacyVersionOneState();
    const stateV1 = migratePersistedTrainingStateV0ToV1(stateV0);
    const stateV2 = migratePersistedTrainingStateV1ToV2(stateV1);
    const stateV3 = migratePersistedTrainingStateV2ToV3(stateV2);
    const stateV4 = migratePersistedTrainingStateV3ToV4(stateV3);
    const stateV5 = migratePersistedTrainingStateV4ToV5(stateV4);
    const stateV5Wire = {
      dashboardEntries: stateV5.dashboardEntries,
      customTrainingSets: [
        {
          id: 'custom-legacy',
          name: 'Legacy custom set',
          description: '',
          category: 'custom',
          sections: [
            {
              id: 'custom-legacy-exercises',
              name: 'Exercises',
              exercises: [
                {
                  id: 'legacy-exercise',
                  name: 'Legacy exercise',
                  quantities: { repetitions: 20 },
                  notes: 'Mechanical note',
                },
              ],
            },
          ],
          isBuiltIn: false,
        },
      ],
    };
    const historicalStates: readonly (readonly [number, unknown])[] = [
      [0, stateV0],
      [1, stateV1],
      [2, stateV2],
      [3, stateV3],
      [4, stateV4],
      [5, stateV5Wire],
      [6, stateV5Wire],
      [7, stateV5Wire],
      [8, stateV5Wire],
    ];

    for (const [version, state] of historicalStates) {
      const inspection = classifyTrainingStorageValue(serializeState(state, version));
      expect(inspection, `historical version ${version}`).toMatchObject({
        status: 'migrated',
        fromVersion: version,
        version: TRAINING_STORE_PERSISTENCE_VERSION,
      });
      if (inspection.status !== 'migrated') {
        throw new Error(`Expected historical version ${version} to migrate.`);
      }

      const entry = inspection.state.dashboardEntries[0];
      const trainingSet = entry?.trainingSet;
      expect(entry?.id, `entry id from version ${version}`).toBe('entry-legacy');
      expect(entry?.notes, `session note from version ${version}`).toBe('Stay relaxed.');
      expect(entry?.quantityOverrides, `overrides from version ${version}`).toEqual({
        'legacy-exercise': { repetitions: 0 },
      });
      expect(entry?.activityNotes, `activity notes from version ${version}`).toEqual({});
      expect(trainingSet?.id, `set id from version ${version}`).toBe('custom-legacy');
      expect(trainingSet?.activities[0]?.id, `root id from version ${version}`).toBe(
        'custom-legacy-exercises',
      );
      expect(trainingSet?.activities[0]?.children[0]?.id, `leaf id from version ${version}`).toBe(
        'legacy-exercise',
      );
    }
  });
});

describe('persistence lifecycle', () => {
  it('round-trips independent activity notes at version 10', () => {
    const storage = new MemoryStorage();
    const first = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    const entryId = first
      .getState()
      .addToDashboard(asTrainingSetId('international-dojo-2-hour-session'));
    const activityId = 'international-dojo-2-hour-session-warm-up-warm-up';
    first.getState().setActivityNote(entryId, activityId, 'Reload this note.\nKeep the spacing.');

    const envelope: unknown = JSON.parse(requireString(storage.read()));
    expect(envelope).toMatchObject({ version: TRAINING_STORE_PERSISTENCE_VERSION });
    expect(envelope).toHaveProperty(
      `state.dashboardEntries.0.activityNotes.${activityId}`,
      'Reload this note.\nKeep the spacing.',
    );

    const second = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    expect(second.getState().dashboardEntries[0]?.activityNotes).toEqual({
      [activityId]: 'Reload this note.\nKeep the spacing.',
    });
  });

  it('adds an empty activity-note record when migrating version 8 without losing state', () => {
    const legacyState = migratePersistedTrainingStateV4ToV5(LEGACY_V4_STATE);
    const state = {
      dashboardEntries: legacyState.dashboardEntries.map((entry) => ({
        ...entry,
        quantityOverrides: {
          'legacy-exercise': { repetitions: 0, sets: 4, seconds: 30 },
        },
        notes: 'Preserve this custom-session note.',
      })),
      customTrainingSets: legacyState.customTrainingSets,
    };
    const migrated = migratePersistedTrainingStateV8ToV9(state);

    expect(migrated.dashboardEntries[0]?.activityNotes).toEqual({});
    expect(migrated.dashboardEntries[0]?.notes).toBe('Preserve this custom-session note.');
    expect(migrated.dashboardEntries[0]?.quantityOverrides).toEqual({
      'legacy-exercise': { repetitions: 0, sets: 4, seconds: 30 },
    });
    expect(migrated.customTrainingSets).toEqual(legacyState.customTrainingSets);
  });

  it('round-trips current dashboard-owned custom sets, notes, seconds, and independent units', () => {
    const storage = new MemoryStorage();
    const first = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    const creation = first
      .getState()
      .createCustomTrainingSetAndAddToDashboard(MIXED_MEASUREMENT_SET_INPUT);
    const customId = creation.trainingSetId;
    const entryId = creation.dashboardEntryId;
    const activityId = creation.dashboardEntry.trainingSet?.activities[0]?.children[0]?.id;
    if (activityId === undefined) {
      throw new Error('Expected a generated custom activity ID.');
    }

    first.getState().setQuantityOverride(entryId, activityId, 'repetitions', 12);
    first.getState().setQuantityOverride(entryId, activityId, 'seconds', 20);
    first.getState().updateDashboardEntry(entryId, { notes: 'Persist me.' });

    const envelope: unknown = JSON.parse(requireString(storage.read()));
    expect(envelope).toMatchObject({ version: TRAINING_STORE_PERSISTENCE_VERSION });
    expect(envelope).toHaveProperty('state.dashboardEntries.0.trainingSet.sections');
    expect(envelope).not.toHaveProperty('state.customTrainingSets');
    expect(envelope).toHaveProperty('state.dashboardEntries.0.trainingSet.sections.0.exercises');

    const second = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    expect(second.getState().dashboardEntries[0]?.trainingSet?.id).toBe(customId);
    expect(
      second.getState().dashboardEntries[0]?.trainingSet?.activities[0]?.children,
    ).toMatchObject([
      { name: 'Suburi', quantities: { repetitions: 30 } },
      { name: 'Jigeiko', quantities: { duration: { unit: 'minutes', value: 12.5 } } },
    ]);
    expect(second.getState().dashboardEntries[0]).toMatchObject({
      id: entryId,
      activityNotes: {},
      notes: 'Persist me.',
      quantityOverrides: {
        [activityId]: { repetitions: 12, seconds: 20 },
      },
    });
  });

  it('decodes the current wire tree and rejects deeper canonical trees on encode', () => {
    const wireState = {
      dashboardEntries: [],
      customTrainingSets: [
        {
          id: 'wire-set',
          name: 'Wire set',
          category: 'custom',
          sections: [
            {
              id: 'wire-section',
              name: 'Wire section',
              exercises: [{ id: 'wire-exercise', name: 'Wire exercise' }],
            },
          ],
          isBuiltIn: false,
        },
      ],
    };
    const decoded = parsePersistedTrainingState(wireState);
    expect(decoded?.customTrainingSets[0]?.activities[0]?.children[0]).toEqual({
      id: 'wire-exercise',
      name: 'Wire exercise',
      children: [],
    });

    const deepState = {
      dashboardEntries: [],
      customTrainingSets: [
        {
          id: asTrainingSetId('deep-set'),
          name: 'Deep set',
          category: 'custom',
          activities: [
            {
              id: 'deep-root',
              name: 'Deep root',
              children: [
                {
                  id: 'deep-child',
                  name: 'Deep child',
                  children: [{ id: 'deep-leaf', name: 'Deep leaf', children: [] }],
                },
              ],
            },
          ],
          isBuiltIn: false,
        },
      ],
    };
    expect(() => encodePersistedTrainingState(deepState)).toThrow(
      'unsupported nested custom activities',
    );
  });

  it('loads a v4 envelope through Zustand and persists migrated v10 state', () => {
    const storage = new MemoryStorage(serializeState(LEGACY_V4_STATE, 4));
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });

    expect(
      store.getState().dashboardEntries[0]?.trainingSet?.activities[0]?.children[0]?.name,
    ).toBe('Legacy exercise');
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

  it('keeps sync and async storage classification and round-trip behavior equivalent', async () => {
    const validRaw = serializeState({ dashboardEntries: [] }, TRAINING_STORE_PERSISTENCE_VERSION);
    const corruptRaw = serializeState(
      { dashboardEntries: [{ ...dashboardWireEntry(0), notes: 42 }] },
      TRAINING_STORE_PERSISTENCE_VERSION,
    );

    const syncReadyStorage = new MemoryStorage(validRaw);
    const asyncReadyStorage = new AsyncMemoryStorage(validRaw);
    expect(inspectTrainingStorage(syncReadyStorage, STORAGE_KEY)).toEqual({
      status: 'ready',
      kind: 'ready',
      version: TRAINING_STORE_PERSISTENCE_VERSION,
      state: { dashboardEntries: [] },
    });
    await expect(inspectTrainingStorage(asyncReadyStorage, STORAGE_KEY)).resolves.toEqual(
      inspectTrainingStorage(syncReadyStorage, STORAGE_KEY),
    );

    const syncCorruptStorage = new MemoryStorage(corruptRaw);
    const asyncCorruptStorage = new AsyncMemoryStorage(corruptRaw);
    expect(inspectTrainingStorage(syncCorruptStorage, STORAGE_KEY)).toEqual({
      status: 'corrupt',
      kind: 'corrupt',
      reason: 'invalid-domain',
    });
    await expect(inspectTrainingStorage(asyncCorruptStorage, STORAGE_KEY)).resolves.toEqual(
      inspectTrainingStorage(syncCorruptStorage, STORAGE_KEY),
    );

    const syncStorage = new MemoryStorage();
    const syncRoundTrip = createTrainingStore({ storage: syncStorage, storageKey: STORAGE_KEY });
    const roundTripEntryId = syncRoundTrip
      .getState()
      .addToDashboard(asTrainingSetId('international-dojo-2-hour-session'));
    syncRoundTrip.getState().updateDashboardEntry(roundTripEntryId, { notes: 'Round trip.' });
    const asyncRoundTripStorage = new AsyncMemoryStorage(requireString(syncStorage.read()));
    const asyncRoundTrip = await createTrainingStoreAsync({
      storage: asyncRoundTripStorage,
      storageKey: STORAGE_KEY,
    });
    expect(asyncRoundTrip.getState().dashboardEntries).toEqual(
      syncRoundTrip.getState().dashboardEntries,
    );
    expect(asyncRoundTripStorage.reads).toBe(2);
    asyncRoundTrip
      .getState()
      .updateDashboardEntry(roundTripEntryId, { notes: 'Async round trip.' });
    expect(asyncRoundTripStorage.writes).toBe(1);
    const asyncWrittenRaw = requireString(await asyncRoundTripStorage.read());
    expect(classifyTrainingStorageValue(asyncWrittenRaw)).toMatchObject({ status: 'ready' });
    expect(asyncRoundTripStorage.reads).toBe(3);
    const asyncReloadStorage = new AsyncMemoryStorage(asyncWrittenRaw);
    const asyncReloaded = await createTrainingStoreAsync({
      storage: asyncReloadStorage,
      storageKey: STORAGE_KEY,
    });
    expect(asyncReloaded.getState().dashboardEntries).toEqual(
      asyncRoundTrip.getState().dashboardEntries,
    );
    expect(asyncReloadStorage.reads).toBe(2);

    const asyncCorruptBootstrapStorage = new AsyncMemoryStorage(corruptRaw);
    await expect(
      createTrainingStoreAsync({
        storage: asyncCorruptBootstrapStorage,
        storageKey: STORAGE_KEY,
      }),
    ).rejects.toThrow(TrainingStoreBootstrapError);
    expect(asyncCorruptBootstrapStorage.reads).toBe(1);
    expect(asyncCorruptBootstrapStorage.writes).toBe(0);
  });

  it('reports data that becomes invalid between preflight and hydration', () => {
    const validValue = serializeState({ dashboardEntries: [] }, TRAINING_STORE_PERSISTENCE_VERSION);
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

  it(
    `survives ${STATE_SEQUENCE_STRESS_ITERATIONS} deterministic public state operations (seed ${STATE_SEQUENCE_STRESS_SEED})`,
    { timeout: 10_000 },
    () => {
      const storage = new MemoryStorage();
      const nextIndex = createDeterministicIndexGenerator(STATE_SEQUENCE_STRESS_SEED);
      let store = createTrainingStore({ storage, storageKey: STORAGE_KEY });
      const quantityActivityId = 'international-dojo-2-hour-session-kirikaeshi-kirikaeshi';
      const noteActivityId = 'international-dojo-2-hour-session-warm-up-warm-up';

      for (let iteration = 0; iteration < STATE_SEQUENCE_STRESS_ITERATIONS; iteration += 1) {
        const operation = nextIndex(8);
        const entries = store.getState().dashboardEntries;
        if (entries.length === 0 || operation === 0 || operation === 7) {
          store.getState().addToDashboard(INTERNATIONAL_DOJO_ID);
        } else {
          const entry = entries[nextIndex(entries.length)];
          if (entry === undefined) {
            throw new Error(`Seed ${STATE_SEQUENCE_STRESS_SEED} lost an entry at ${iteration}.`);
          }

          switch (operation) {
            case 1:
              store
                .getState()
                .setQuantityOverride(entry.id, quantityActivityId, 'repetitions', nextIndex(51));
              break;
            case 2:
              store.getState().clearQuantityOverride(entry.id, quantityActivityId, 'repetitions');
              break;
            case 3:
              store
                .getState()
                .setActivityNote(entry.id, noteActivityId, `Seeded note ${iteration}`);
              break;
            case 4:
              store.getState().setActivityNote(entry.id, noteActivityId, '  ');
              break;
            case 5: {
              const removed = store.getState().removeFromDashboard(entry.id);
              if (removed === null) {
                throw new Error(
                  `Seed ${STATE_SEQUENCE_STRESS_SEED} could not remove at ${iteration}.`,
                );
              }
              if (nextIndex(2) === 0) {
                store.getState().restoreDashboardEntry(removed);
              }
              break;
            }
            case 6:
              store
                .getState()
                .updateDashboardEntry(entry.id, { notes: `Session note ${iteration}` });
              break;
          }
        }

        const currentEntries = store.getState().dashboardEntries;
        const currentIds = currentEntries.map((entry) => entry.id);
        expect(
          new Set(currentIds).size,
          `unique entry ids for seed ${STATE_SEQUENCE_STRESS_SEED} at iteration ${iteration}`,
        ).toBe(currentIds.length);

        const persisted = requireString(storage.read());
        const inspection = classifyTrainingStorageValue(persisted);
        expect(
          inspection.status,
          `valid envelope for seed ${STATE_SEQUENCE_STRESS_SEED} at iteration ${iteration}`,
        ).toBe('ready');
        if (inspection.status !== 'ready') {
          throw new Error(
            `Seed ${STATE_SEQUENCE_STRESS_SEED} produced ${inspection.status} at ${iteration}.`,
          );
        }
        expect(inspection.state.dashboardEntries).toEqual(currentEntries);

        if (operation === 6) {
          store = createTrainingStore({ storage, storageKey: STORAGE_KEY });
        }
      }

      const beforeFinalReload = store.getState().dashboardEntries;
      store = createTrainingStore({ storage, storageKey: STORAGE_KEY });
      expect(store.getState().dashboardEntries).toEqual(beforeFinalReload);
    },
  );
});

describe('untrusted persistence classification', () => {
  it('returns null for hostile inputs across every exported parser', () => {
    const throwingGetter = Object.defineProperty({}, 'dashboardEntries', {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error('hostile getter');
      },
    });
    const throwingProxy = new Proxy(
      { dashboardEntries: [], customTrainingSets: [] },
      {
        get: () => {
          throw new Error('hostile proxy');
        },
      },
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const parsers = [
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
    ] as const;
    const malformedValues: readonly unknown[] = [
      undefined,
      null,
      42,
      'not persisted state',
      {},
      throwingGetter,
      throwingProxy,
      revoked.proxy,
    ];

    for (const parser of parsers) {
      for (const value of malformedValues) {
        expect(() => parser(value)).not.toThrow();
        expect(parser(value)).toBeNull();
      }
    }
  });

  it('returns null for cyclic and too-deep v9/v10 runtime trees', () => {
    const cyclicNode: { id: string; name: string; children: unknown[] } = {
      id: 'cyclic-node',
      name: 'Cyclic node',
      children: [],
    };
    cyclicNode.children.push(cyclicNode);
    const cyclicCustomSet = {
      id: 'cyclic-custom',
      name: 'Cyclic custom',
      category: 'custom' as const,
      activities: [cyclicNode],
      isBuiltIn: false as const,
    };
    const cyclicV9 = {
      dashboardEntries: [],
      customTrainingSets: [cyclicCustomSet],
    };
    const cyclicV10 = {
      dashboardEntries: [
        dashboardWireEntry(0, {
          trainingSetId: asTrainingSetId('cyclic-custom'),
          trainingSet: cyclicCustomSet,
        }),
      ],
    };
    expect(() => parsePersistedTrainingStateV9(cyclicV9)).not.toThrow();
    expect(parsePersistedTrainingStateV9(cyclicV9)).toBeNull();
    expect(() => parsePersistedTrainingStateV10(cyclicV10)).not.toThrow();
    expect(parsePersistedTrainingStateV10(cyclicV10)).toBeNull();

    const deepCustomSet = {
      id: 'deep-custom',
      name: 'Deep custom',
      category: 'custom' as const,
      activities: [deepRuntimeActivity(HOSTILE_DEPTH)],
      isBuiltIn: false as const,
    };
    const deepV9 = { dashboardEntries: [], customTrainingSets: [deepCustomSet] };
    const deepV10 = {
      dashboardEntries: [
        dashboardWireEntry(1, {
          trainingSetId: asTrainingSetId('deep-custom'),
          trainingSet: deepCustomSet,
        }),
      ],
    };
    expect(() => parsePersistedTrainingStateV9(deepV9)).not.toThrow();
    expect(parsePersistedTrainingStateV9(deepV9)).toBeNull();
    expect(() => parsePersistedTrainingStateV10(deepV10)).not.toThrow();
    expect(parsePersistedTrainingStateV10(deepV10)).toBeNull();
  });

  it('contains hostile JSON.parse results on current and legacy classifier paths', () => {
    const rawCurrent = serializeState({ dashboardEntries: [] }, TRAINING_STORE_PERSISTENCE_VERSION);
    const rawLegacy = serializeState({ dashboardEntries: [], customTrainingSets: [] }, 9);
    const throwingCurrent = new Proxy(
      { state: { dashboardEntries: [] }, version: TRAINING_STORE_PERSISTENCE_VERSION },
      {
        get: () => {
          throw new Error('throwing parsed current envelope');
        },
      },
    );
    const throwingLegacy = new Proxy(
      { state: { dashboardEntries: [], customTrainingSets: [] }, version: 9 },
      {
        get: () => {
          throw new Error('throwing parsed legacy envelope');
        },
      },
    );
    const deepSet = {
      id: 'classifier-deep-custom',
      name: 'Classifier deep custom',
      category: 'custom' as const,
      activities: [deepRuntimeActivity(HOSTILE_DEPTH)],
      isBuiltIn: false as const,
    };
    const deepCurrent = {
      state: {
        dashboardEntries: [
          dashboardWireEntry(2, {
            trainingSetId: asTrainingSetId('classifier-deep-custom'),
            trainingSet: deepSet,
          }),
        ],
      },
      version: TRAINING_STORE_PERSISTENCE_VERSION,
    };
    const deepLegacy = {
      state: { dashboardEntries: [], customTrainingSets: [deepSet] },
      version: 9,
    };
    const cyclicNode: { id: string; name: string; children: unknown[] } = {
      id: 'classifier-cyclic-node',
      name: 'Classifier cyclic node',
      children: [],
    };
    cyclicNode.children.push(cyclicNode);
    const cyclicSet = {
      id: 'classifier-cyclic-custom',
      name: 'Classifier cyclic custom',
      category: 'custom' as const,
      activities: [cyclicNode],
      isBuiltIn: false as const,
    };
    const cyclicCurrent = {
      state: {
        dashboardEntries: [
          dashboardWireEntry(3, {
            trainingSetId: asTrainingSetId('classifier-cyclic-custom'),
            trainingSet: cyclicSet,
          }),
        ],
      },
      version: TRAINING_STORE_PERSISTENCE_VERSION,
    };
    const cyclicLegacy = {
      state: { dashboardEntries: [], customTrainingSets: [cyclicSet] },
      version: 9,
    };

    const classifyHostileValues = (rawValue: string, values: readonly unknown[]): void => {
      for (const hostileValue of values) {
        const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation(() => hostileValue);
        try {
          expect(() => classifyTrainingStorageValue(rawValue)).not.toThrow();
          expect(classifyTrainingStorageValue(rawValue)).toMatchObject({ status: 'corrupt' });
        } finally {
          parseSpy.mockRestore();
        }
      }
    };

    classifyHostileValues(rawCurrent, [throwingCurrent, deepCurrent, cyclicCurrent]);
    classifyHostileValues(rawLegacy, [throwingLegacy, deepLegacy, cyclicLegacy]);

    const legacyConflict = versionFiveUchikomiState({
      [LEGACY_UCHIKOMI_IDS[0]]: { repetitions: 4 },
      [LEGACY_UCHIKOMI_IDS[1]]: { repetitions: 5 },
    });
    expect(classifyTrainingStorageValue(serializeState(legacyConflict, 5))).toMatchObject({
      status: 'corrupt',
      reason: 'override-migration-conflict',
    });
  });

  it('classifies empty, malformed, current, migrated, and future envelopes', () => {
    expect(classifyTrainingStorageValue(null).status).toBe('empty');
    expect(classifyTrainingStorageValue('{bad json')).toMatchObject({
      status: 'corrupt',
      reason: 'malformed-json',
    });
    expect(
      classifyTrainingStorageValue(
        serializeState({ dashboardEntries: [] }, TRAINING_STORE_PERSISTENCE_VERSION),
      ),
    ).toMatchObject({ status: 'ready', version: TRAINING_STORE_PERSISTENCE_VERSION });
    expect(classifyTrainingStorageValue(serializeState(LEGACY_V4_STATE, 4))).toMatchObject({
      status: 'migrated',
      fromVersion: 4,
      version: TRAINING_STORE_PERSISTENCE_VERSION,
    });
    expect(classifyTrainingStorageValue(serializeState({ dashboardEntries: [] }, 999))).toEqual({
      status: 'unsupported-future',
      kind: 'unsupported-future',
      version: 999,
    });
  });

  it('sanitizes stale activity notes while preserving valid notes, overrides, and session notes', () => {
    const activityId = 'international-dojo-2-hour-session-warm-up-warm-up';
    const ineligibleActivityId = 'international-dojo-2-hour-session-kirikaeshi-kirikaeshi';
    const parsed = parsePersistedTrainingState({
      dashboardEntries: [
        {
          id: 'entry-with-notes',
          trainingSetId: INTERNATIONAL_DOJO_ID,
          quantityOverrides: { [ineligibleActivityId]: { repetitions: 6 } },
          activityNotes: {
            [activityId]: '  Keep this spacing.\n',
            [ineligibleActivityId]: 'This activity is not eligible.',
            'removed-activity': 'This activity no longer exists.',
            blank: ' \n  ',
          },
          notes: 'Keep this session note.',
          createdAt: '2026-08-19T10:00:00.000Z',
        },
      ],
      customTrainingSets: [],
    });

    expect(parsed?.dashboardEntries[0]).toMatchObject({
      quantityOverrides: { [ineligibleActivityId]: { repetitions: 6 } },
      activityNotes: { [activityId]: '  Keep this spacing.\n' },
      notes: 'Keep this session note.',
    });
  });

  it('preserves activity notes while their referenced session is unavailable', () => {
    const state = {
      dashboardEntries: [
        {
          id: 'unavailable-entry',
          trainingSetId: asTrainingSetId('temporarily-unavailable-session'),
          quantityOverrides: { 'unavailable-activity': { repetitions: 6 } },
          activityNotes: {
            'unavailable-activity': '  Preserve this note for recovery.\n',
          },
          notes: 'Preserve this session note too.',
          createdAt: '2026-08-29T08:00:00.000Z',
        },
      ],
      customTrainingSets: [],
    };
    const parsed = parsePersistedTrainingState(state);
    if (parsed === null) {
      throw new Error('Expected unavailable-session state to remain recoverable.');
    }

    expect(parsed.dashboardEntries[0]).toEqual(state.dashboardEntries[0]);
    expect(parsePersistedTrainingState(encodePersistedTrainingState(parsed))).toEqual(parsed);
  });

  it('rejects malformed activity-note records and keys', () => {
    const entry = {
      id: 'entry-malformed-notes',
      trainingSetId: INTERNATIONAL_DOJO_ID,
      quantityOverrides: {},
      activityNotes: { 'international-dojo-2-hour-session-warm-up-warm-up': 'valid' },
      notes: '',
      createdAt: '2026-08-19T10:00:00.000Z',
    };

    expect(
      parsePersistedTrainingState({
        dashboardEntries: [{ ...entry, activityNotes: ['not-a-record'] }],
        customTrainingSets: [],
      }),
    ).toBeNull();
    expect(
      parsePersistedTrainingState({
        dashboardEntries: [
          {
            ...entry,
            activityNotes: { 'international-dojo-2-hour-session-warm-up-warm-up': 42 },
          },
        ],
        customTrainingSets: [],
      }),
    ).toBeNull();
    expect(
      parsePersistedTrainingState({
        dashboardEntries: [{ ...entry, activityNotes: { '   ': 'invalid key' } }],
        customTrainingSets: [],
      }),
    ).toBeNull();
  });

  it('rejects canonical runtime trees at the two-level storage boundary', () => {
    const deepCanonicalState = {
      dashboardEntries: [],
      customTrainingSets: [
        {
          id: 'deep-set',
          name: 'Deep set',
          category: 'custom',
          activities: [
            {
              id: 'deep-root',
              name: 'Deep root',
              children: [
                {
                  id: 'deep-child',
                  name: 'Deep child',
                  children: [{ id: 'deep-leaf', name: 'Deep leaf', children: [] }],
                },
              ],
            },
          ],
          isBuiltIn: false,
        },
      ],
    };
    const metadataCanonicalState = {
      dashboardEntries: [],
      customTrainingSets: [
        {
          id: 'metadata-set',
          name: 'Metadata set',
          category: 'custom',
          activities: [
            {
              id: 'metadata-root',
              name: 'Metadata root',
              editableQuantityUnits: ['repetitions'],
              allowsSessionNotes: true,
              children: [],
            },
          ],
          isBuiltIn: false,
        },
      ],
    };

    expect(
      classifyTrainingStorageValue(
        serializeState(deepCanonicalState, TRAINING_STORE_PERSISTENCE_VERSION),
      ),
    ).toEqual({
      status: 'corrupt',
      kind: 'corrupt',
      reason: 'invalid-domain',
    });
    expect(
      classifyTrainingStorageValue(
        serializeState(metadataCanonicalState, TRAINING_STORE_PERSISTENCE_VERSION),
      ),
    ).toEqual({
      status: 'corrupt',
      kind: 'corrupt',
      reason: 'invalid-domain',
    });
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
          activities: [
            {
              ...validCurrent.customTrainingSets[0]?.activities[0],
              children: [
                {
                  id: 'range',
                  name: 'Range',
                  quantities: {
                    duration: { unit: 'seconds', min: 60, max: 30 },
                  },
                  children: [],
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
    const storage = new MemoryStorage(serializeState({ dashboardEntries: [] }, 999));
    expect(() => createTrainingStore({ storage, storageKey: STORAGE_KEY })).toThrow(
      TrainingStoreBootstrapError,
    );
    expect(storage.writes).toBe(0);
  });

  it('does not write or partially hydrate corrupt and over-limit current data', () => {
    const exactEntries = Array.from({ length: TRAINING_DATA_LIMITS.dashboardEntries }, (_, index) =>
      dashboardWireEntry(index),
    );
    const overLimitStorage = new MemoryStorage(
      serializeState(
        {
          dashboardEntries: [
            ...exactEntries,
            dashboardWireEntry(TRAINING_DATA_LIMITS.dashboardEntries),
          ],
        },
        TRAINING_STORE_PERSISTENCE_VERSION,
      ),
    );
    expect(() =>
      createTrainingStore({ storage: overLimitStorage, storageKey: STORAGE_KEY }),
    ).toThrow(TrainingStoreBootstrapError);
    expect(overLimitStorage.writes).toBe(0);

    const corruptStorage = new MemoryStorage(
      serializeState(
        {
          dashboardEntries: [{ ...dashboardWireEntry(0), notes: 42 }],
        },
        TRAINING_STORE_PERSISTENCE_VERSION,
      ),
    );
    expect(() => createTrainingStore({ storage: corruptStorage, storageKey: STORAGE_KEY })).toThrow(
      TrainingStoreBootstrapError,
    );
    expect(corruptStorage.writes).toBe(0);
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
