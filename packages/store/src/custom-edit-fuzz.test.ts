import { beforeAll, describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAINING_SETS,
  TRAINING_DATA_LIMITS,
  getTrainingSetActivities,
  isTrainingQuantityUnit,
  type DashboardEntry,
  type TrainingExerciseInput,
  type TrainingSectionInput,
  type TrainingSetInput,
  type TrainingQuantities,
  type TrainingQuantityUnit,
} from '@kendo-menu/domain';

import {
  classifyTrainingStorageValue,
  createTrainingStore,
  type CustomTrainingSetEditIdentities,
  type StateStorage,
  TRAINING_STORE_RAW_JSON_LIMIT,
  type TrainingStoreApi,
} from './index';

const STORAGE_KEY = 'custom-edit-fuzz';
const DEFAULT_SEED = 0x43555354;
const SMOKE_SEQUENCES = 8;
const FUZZ_SEQUENCES = 96;
const EDITS_PER_SEQUENCE = 4;
const NAME_PARTS = ['Men', 'Kote-men', '足さばき', '面打ち 🥋', 'Kihon & mawari'] as const;

interface FuzzRandom {
  readonly next: (limit: number) => number;
}

interface EditPlan {
  readonly input: TrainingSetInput;
  readonly identities: CustomTrainingSetEditIdentities;
  readonly retainedIds: ReadonlySet<string>;
  readonly expectedActivities: ReadonlyMap<string, ExpectedActivity>;
  readonly clearedOverrideUnits: ReadonlyMap<string, ReadonlySet<TrainingQuantityUnit>>;
}

interface ExpectedActivity {
  readonly notes?: string;
  readonly quantities?: TrainingQuantities;
}

class MemoryStorage implements StateStorage {
  #value: string | null = null;

  getItem(name: string): string | null {
    return name === STORAGE_KEY ? this.#value : null;
  }

  setItem(name: string, value: string): void {
    if (name === STORAGE_KEY) {
      this.#value = value;
    }
  }

  removeItem(name: string): void {
    if (name === STORAGE_KEY) {
      this.#value = null;
    }
  }
}

function readSeed(): number {
  const runtime = globalThis;
  if (!('process' in runtime)) {
    return DEFAULT_SEED;
  }
  const processValue = runtime.process;
  if (typeof processValue !== 'object' || processValue === null || !('env' in processValue)) {
    return DEFAULT_SEED;
  }
  const environment = processValue.env;
  const configured =
    typeof environment === 'object' &&
    environment !== null &&
    'CUSTOM_EDIT_FUZZ_SEED' in environment &&
    typeof environment.CUSTOM_EDIT_FUZZ_SEED === 'string'
      ? environment.CUSTOM_EDIT_FUZZ_SEED
      : undefined;
  const seed = configured === undefined ? DEFAULT_SEED : Number(configured);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error('CUSTOM_EDIT_FUZZ_SEED must be an unsigned 32-bit integer.');
  }
  return seed;
}

function createRandom(seed: number): FuzzRandom {
  let state = seed >>> 0;
  return {
    next(limit) {
      if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new Error('Fuzz random limits must be positive integers.');
      }
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state % limit;
    },
  };
}

function fuzzName(random: FuzzRandom, sequence: number, operation: number, node: number): string {
  const part = NAME_PARTS[random.next(NAME_PARTS.length)];
  if (part === undefined) {
    throw new Error('Fuzz name generation lost its selected name.');
  }
  return `${part} ${sequence}.${operation}.${node}`;
}

function makeExercise(
  random: FuzzRandom,
  sequence: number,
  operation: number,
  node: number,
): TrainingExerciseInput {
  return {
    name: fuzzName(random, sequence, operation, node),
    quantities: { repetitions: random.next(501), sets: 1 + random.next(5) },
    notes: `Exercise note ${sequence}.${operation}.${node} 🥋`,
  };
}

function makeInitialInput(random: FuzzRandom, sequence: number): TrainingSetInput {
  const sections: TrainingSectionInput[] = [];
  const sectionCount = 2 + random.next(2);
  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
    const exercises: TrainingExerciseInput[] = [];
    const exerciseCount = 2 + random.next(3);
    for (let exerciseIndex = 0; exerciseIndex < exerciseCount; exerciseIndex += 1) {
      exercises.push(makeExercise(random, sequence, -1, sectionIndex * 10 + exerciseIndex));
    }
    sections.push({
      name: fuzzName(random, sequence, -1, sectionIndex),
      notes: `Section note ${sequence}.${sectionIndex}`,
      exercises,
    });
  }
  return {
    name: `Custom menu ${sequence} ${fuzzName(random, sequence, -1, 100)}`,
    description: `Seeded custom menu ${sequence} 🥋`,
    category: 'custom',
    ...(random.next(2) === 0 ? { customIntensity: 'intense-drill' as const } : {}),
    sections,
  };
}

function requireEntry(store: TrainingStoreApi, entryId: string): DashboardEntry {
  const entry = store.getState().dashboardEntries.find((candidate) => candidate.id === entryId);
  if (entry === undefined) {
    throw new Error(`Expected dashboard entry ${entryId}.`);
  }
  return entry;
}

function requireTrainingSet(entry: DashboardEntry): NonNullable<DashboardEntry['trainingSet']> {
  if (entry.trainingSet === undefined || entry.trainingSet.isBuiltIn) {
    throw new Error(`Expected custom training-set snapshot for ${entry.id}.`);
  }
  return entry.trainingSet;
}

function currentQuantityUnit(
  activity: TrainingExerciseInput & { readonly id: string },
  overrides: DashboardEntry['quantityOverrides'][string] | undefined,
): TrainingQuantityUnit | undefined {
  if (activity.quantities?.repetitions !== undefined || overrides?.repetitions !== undefined) {
    return 'repetitions';
  }
  if (activity.quantities?.duration !== undefined) {
    return activity.quantities.duration.unit;
  }
  if (overrides?.seconds !== undefined) return 'seconds';
  if (overrides?.minutes !== undefined) return 'minutes';
  return undefined;
}

function removeQuantityUnit(
  quantities: TrainingQuantities | undefined,
  unit: TrainingQuantityUnit,
): TrainingQuantities | undefined {
  if (quantities === undefined) return undefined;
  const next: TrainingQuantities = {
    ...(unit === 'repetitions' || quantities.repetitions === undefined
      ? {}
      : { repetitions: quantities.repetitions }),
    ...(quantities.sets === undefined ? {} : { sets: quantities.sets }),
    ...(quantities.rounds === undefined ? {} : { rounds: quantities.rounds }),
    ...(quantities.duration === undefined || quantities.duration.unit === unit
      ? {}
      : { duration: quantities.duration }),
  };
  return Object.keys(next).length === 0 ? undefined : next;
}

function createScenario(
  random: FuzzRandom,
  sequence: number,
): {
  readonly storage: MemoryStorage;
  readonly store: TrainingStoreApi;
  readonly entryId: string;
} {
  const storage = new MemoryStorage();
  const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });
  const created = store
    .getState()
    .createCustomTrainingSetAndAddToDashboard(makeInitialInput(random, sequence));
  store.getState().updateDashboardEntry(created.dashboardEntryId, {
    notes: `Session note ${sequence}; preserve through edits.`,
  });
  const initialEntry = requireEntry(store, created.dashboardEntryId);
  for (const activity of getTrainingSetActivities(requireTrainingSet(initialEntry))) {
    if (activity.children.length === 0) {
      store
        .getState()
        .setQuantityOverride(initialEntry.id, activity.id, 'repetitions', random.next(501));
      store
        .getState()
        .setQuantityOverride(initialEntry.id, activity.id, 'minutes', random.next(21));
      store
        .getState()
        .setQuantityOverride(initialEntry.id, activity.id, 'sets', 1 + random.next(5));
    }
  }
  return { storage, store, entryId: created.dashboardEntryId };
}

function createEditPlan(
  entry: DashboardEntry,
  random: FuzzRandom,
  sequence: number,
  operation: number,
  changeFirstQuantityUnit: boolean,
): EditPlan {
  const currentSet = requireTrainingSet(entry);
  const sections: TrainingSectionInput[] = [];
  const sectionIdentities: CustomTrainingSetEditIdentities['sections'][number][] = [];
  const retainedIds = new Set<string>();
  const expectedActivities = new Map<string, ExpectedActivity>();
  const clearedOverrideUnits = new Map<string, ReadonlySet<TrainingQuantityUnit>>();
  let nodeIndex = 0;
  const omitLastSection = operation % 2 === 1 && currentSet.activities.length > 1;

  for (let sectionIndex = 0; sectionIndex < currentSet.activities.length; sectionIndex += 1) {
    const section = currentSet.activities[sectionIndex];
    if (section === undefined) {
      throw new Error(`Missing source section ${sectionIndex}.`);
    }
    if (omitLastSection && sectionIndex === currentSet.activities.length - 1) {
      continue;
    }
    if (sectionIndex > 1 && random.next(5) === 0) {
      continue;
    }

    retainedIds.add(section.id);
    expectedActivities.set(section.id, {
      ...(section.notes === undefined ? {} : { notes: section.notes }),
      ...(section.quantities === undefined ? {} : { quantities: section.quantities }),
    });
    const exerciseInputs: TrainingExerciseInput[] = [];
    const exerciseIdentities: CustomTrainingSetEditIdentities['sections'][number]['exercises'][number][] =
      [];

    for (let exerciseIndex = 0; exerciseIndex < section.children.length; exerciseIndex += 1) {
      const exercise = section.children[exerciseIndex];
      if (exercise === undefined) {
        throw new Error(`Missing source exercise ${section.id}.${exerciseIndex}.`);
      }
      const omitExercise =
        sectionIndex !== 0 &&
        section.children.length > 1 &&
        exerciseIndex === section.children.length - 1 &&
        operation % 2 === 0;
      if (omitExercise) {
        continue;
      }

      const editsQuantity =
        (changeFirstQuantityUnit || operation % 3 === 2) &&
        sectionIndex === 0 &&
        exerciseIndex === 0;
      const oldUnit = currentQuantityUnit(exercise, entry.quantityOverrides[exercise.id]);
      const newUnit = !editsQuantity
        ? oldUnit
        : changeFirstQuantityUnit
          ? oldUnit === 'repetitions'
            ? 'minutes'
            : 'repetitions'
          : 'repetitions';
      const duration =
        editsQuantity && newUnit === 'minutes'
          ? { unit: 'minutes' as const, value: 1 + random.next(60) }
          : undefined;
      const repetitions = editsQuantity && newUnit === 'repetitions' ? random.next(501) : undefined;
      const inputQuantities: TrainingQuantities | undefined =
        duration === undefined
          ? repetitions === undefined
            ? undefined
            : { repetitions }
          : { duration };
      const baseQuantities =
        oldUnit !== undefined && oldUnit !== newUnit
          ? removeQuantityUnit(exercise.quantities, oldUnit)
          : exercise.quantities;
      const expectedQuantities =
        inputQuantities === undefined
          ? baseQuantities
          : { ...(baseQuantities ?? {}), ...inputQuantities };
      const exerciseInput: TrainingExerciseInput = {
        name: fuzzName(random, sequence, operation, nodeIndex),
        ...(inputQuantities === undefined ? {} : { quantities: inputQuantities }),
        ...(exercise.notes === undefined ? {} : { notes: exercise.notes }),
      };
      exerciseInputs.push(exerciseInput);
      exerciseIdentities.push({ id: exercise.id });
      retainedIds.add(exercise.id);
      expectedActivities.set(exercise.id, {
        ...(exercise.notes === undefined ? {} : { notes: exercise.notes }),
        ...(expectedQuantities === undefined ? {} : { quantities: expectedQuantities }),
      });
      if (inputQuantities !== undefined) {
        const cleared = new Set<TrainingQuantityUnit>();
        if (oldUnit !== undefined && oldUnit !== newUnit) cleared.add(oldUnit);
        if (newUnit !== undefined) cleared.add(newUnit);
        clearedOverrideUnits.set(exercise.id, cleared);
      }
      nodeIndex += 1;
    }

    if (sectionIndex === 0) {
      exerciseInputs.push(makeExercise(random, sequence, operation, nodeIndex));
      exerciseIdentities.push({});
      nodeIndex += 1;
    }

    sections.push({
      name: fuzzName(random, sequence, operation, nodeIndex),
      ...(section.quantities === undefined ? {} : { quantities: section.quantities }),
      ...(section.notes === undefined ? {} : { notes: section.notes }),
      exercises: exerciseInputs,
    });
    sectionIdentities.push({ id: section.id, exercises: exerciseIdentities });
    nodeIndex += 1;
  }

  if (random.next(3) === 0) {
    const exercise = makeExercise(random, sequence, operation, nodeIndex + 1);
    sections.push({
      name: fuzzName(random, sequence, operation, nodeIndex),
      notes: `Added section ${sequence}.${operation}`,
      exercises: [exercise],
    });
    sectionIdentities.push({ exercises: [{}] });
  }

  return {
    input: {
      name: `Edited ${fuzzName(random, sequence, operation, nodeIndex)}`,
      description: `Updated in seeded sequence ${sequence}.${operation} 日本語 🥋`,
      category: 'custom',
      ...(random.next(2) === 0 ? { customIntensity: 'high-intensity-drill' as const } : {}),
      sections,
    },
    identities: { sections: sectionIdentities },
    retainedIds,
    expectedActivities,
    clearedOverrideUnits,
  };
}

function requireRaw(storage: MemoryStorage): string {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) {
    throw new Error('Expected a serialized training-store state.');
  }
  return raw;
}

function expectAtomicRejection(
  store: TrainingStoreApi,
  storage: MemoryStorage,
  entryId: string,
  input: TrainingSetInput,
  identities: CustomTrainingSetEditIdentities,
  seed: number,
  label: string,
): void {
  const beforeState = store.getState().dashboardEntries;
  const beforeRaw = requireRaw(storage);
  expect(
    () => store.getState().updateCustomTrainingSet(entryId, input, identities),
    `seed ${seed}: ${label} should be rejected`,
  ).toThrow();
  expect(store.getState().dashboardEntries, `seed ${seed}: ${label} changed live state`).toEqual(
    beforeState,
  );
  expect(requireRaw(storage), `seed ${seed}: ${label} wrote partial state`).toBe(beforeRaw);
}

function invalidPlan(
  plan: EditPlan,
  variant: number,
): {
  readonly input: TrainingSetInput;
  readonly identities: CustomTrainingSetEditIdentities;
} {
  if (variant === 0) {
    return { input: { ...plan.input, name: '' }, identities: plan.identities };
  }
  if (variant === 1) {
    return {
      input: {
        ...plan.input,
        description: 'x'.repeat(TRAINING_DATA_LIMITS.descriptionCharacters + 1),
      },
      identities: plan.identities,
    };
  }
  if (variant === 2) {
    const sections = plan.input.sections.map((section, sectionIndex) =>
      sectionIndex === 0
        ? {
            ...section,
            exercises: section.exercises.map((exercise, index) =>
              index === 0 ? { ...exercise, quantities: { repetitions: 501 } } : exercise,
            ),
          }
        : section,
    );
    return { input: { ...plan.input, sections }, identities: plan.identities };
  }
  if (variant === 3) {
    const sections = plan.identities.sections.map((section, sectionIndex) =>
      sectionIndex === 0 ? { ...section, id: 'foreign-section-id' } : section,
    );
    return { input: plan.input, identities: { sections } };
  }

  const sections = plan.identities.sections.map((section, sectionIndex) => {
    if (sectionIndex !== 0) {
      return section;
    }
    const firstId = section.exercises[0]?.id;
    if (firstId === undefined || section.exercises[1] === undefined) {
      throw new Error('Fuzz plan needs two retained exercise identities for duplicate-ID attack.');
    }
    return {
      ...section,
      exercises: section.exercises.map((exercise, exerciseIndex) =>
        exerciseIndex === 1 ? { id: firstId } : exercise,
      ),
    };
  });
  return { input: plan.input, identities: { sections } };
}

function verifySuccessfulEdit(
  store: TrainingStoreApi,
  storage: MemoryStorage,
  before: DashboardEntry,
  plan: EditPlan,
  returned: DashboardEntry,
  seed: number,
  sequence: number,
  operation: number,
): void {
  const label = `seed ${seed} sequence ${sequence} edit ${operation}`;
  const after = requireEntry(store, before.id);
  const afterSet = requireTrainingSet(after);
  expect(returned, `${label}: action result`).toEqual(after);
  expect(after.id, `${label}: dashboard entry id`).toBe(before.id);
  expect(after.trainingSetId, `${label}: training-set id`).toBe(before.trainingSetId);
  expect(afterSet.id, `${label}: custom set id`).toBe(requireTrainingSet(before).id);
  expect(afterSet.name, `${label}: edited name`).toBe(plan.input.name);
  expect(after.notes, `${label}: session note retention`).toBe(before.notes);

  const afterActivities = getTrainingSetActivities(afterSet);
  const activityIds = afterActivities.map((activity) => activity.id);
  expect(new Set(activityIds).size, `${label}: unique activity ids`).toBe(activityIds.length);
  for (const activityId of plan.retainedIds) {
    const current = afterActivities.find((activity) => activity.id === activityId);
    const expected = plan.expectedActivities.get(activityId);
    expect(current, `${label}: retained activity ${activityId}`).toBeDefined();
    expect(expected, `${label}: expected activity ${activityId}`).toBeDefined();
    if (current === undefined || expected === undefined) {
      throw new Error(`${label}: missing retained activity assertion data.`);
    }
    expect(current.notes, `${label}: activity note ${activityId}`).toBe(expected.notes);
    expect(current.quantities, `${label}: base quantities ${activityId}`).toEqual(
      expected.quantities,
    );
  }

  const beforeOverrides = before.quantityOverrides;
  const afterOverrides = after.quantityOverrides;
  for (const [activityId, overrides] of Object.entries(beforeOverrides)) {
    const resulting = afterOverrides[activityId];
    if (!plan.retainedIds.has(activityId)) {
      expect(resulting, `${label}: stale override for ${activityId}`).toBeUndefined();
    } else {
      const clearedUnits = plan.clearedOverrideUnits.get(activityId) ?? new Set();
      const expectedOverrides = Object.fromEntries(
        Object.entries(overrides).filter(
          ([unit]) => !isTrainingQuantityUnit(unit) || !clearedUnits.has(unit),
        ),
      );
      expect(resulting, `${label}: retained overrides for ${activityId}`).toEqual(
        Object.keys(expectedOverrides).length === 0 ? undefined : expectedOverrides,
      );
    }
  }
  for (const activityId of Object.keys(afterOverrides)) {
    expect(
      plan.retainedIds.has(activityId),
      `${label}: unexpected override target ${activityId}`,
    ).toBe(true);
  }
  for (const activity of afterActivities) {
    const clearedUnits = plan.clearedOverrideUnits.get(activity.id);
    if (clearedUnits !== undefined) {
      for (const unit of clearedUnits) {
        expect(
          afterOverrides[activity.id]?.[unit],
          `${label}: cleared ${unit} override for ${activity.id}`,
        ).toBeUndefined();
      }
    }
  }

  const raw = requireRaw(storage);
  const inspection = classifyTrainingStorageValue(raw);
  expect(inspection.status, `${label}: persisted envelope`).toBe('ready');
  if (inspection.status !== 'ready') {
    throw new Error(`${label}: expected ready persistence state, got ${inspection.status}.`);
  }
  expect(inspection.state.dashboardEntries, `${label}: serialized state`).toEqual(
    store.getState().dashboardEntries,
  );

  const rehydrated = createTrainingStore({ storage, storageKey: STORAGE_KEY });
  expect(rehydrated.getState().dashboardEntries, `${label}: rehydrated state`).toEqual(
    store.getState().dashboardEntries,
  );
}

function runSequence(seed: number, sequence: number, editCount: number): void {
  const random = createRandom((seed + sequence) >>> 0);
  const { storage, store, entryId } = createScenario(random, sequence);
  let activeStore = store;

  for (let operation = 0; operation < editCount; operation += 1) {
    const before = requireEntry(activeStore, entryId);
    const changeFirstQuantityUnit = sequence % 12 === 0 && operation === 0;
    const plan = createEditPlan(before, random, sequence, operation, changeFirstQuantityUnit);
    const invalid = invalidPlan(plan, random.next(5));
    expectAtomicRejection(
      activeStore,
      storage,
      entryId,
      invalid.input,
      invalid.identities,
      seed,
      `sequence ${sequence} edit ${operation} invalid input`,
    );

    const returned = activeStore
      .getState()
      .updateCustomTrainingSet(entryId, plan.input, plan.identities);
    verifySuccessfulEdit(activeStore, storage, before, plan, returned, seed, sequence, operation);
    activeStore = createTrainingStore({ storage, storageKey: STORAGE_KEY });
  }
}

function draftWithoutRetainedIds(
  sections: readonly TrainingSectionInput[],
  overrides: { readonly name?: string; readonly description?: string } = {},
): { readonly input: TrainingSetInput; readonly identities: CustomTrainingSetEditIdentities } {
  return {
    input: {
      name: overrides.name ?? 'Boundary custom menu',
      description: overrides.description ?? 'Boundary test',
      category: 'custom',
      sections,
    },
    identities: {
      sections: sections.map((section) => ({ exercises: section.exercises.map(() => ({})) })),
    },
  };
}

function makeBoundarySection(sectionIndex: number, exerciseCount: number): TrainingSectionInput {
  return {
    name: `Boundary section ${sectionIndex}`,
    exercises: Array.from({ length: exerciseCount }, (_value, exerciseIndex) => ({
      name: `Boundary exercise ${sectionIndex}.${exerciseIndex}`,
    })),
  };
}

function makeSimpleCustomInput(): TrainingSetInput {
  return {
    name: 'Seed source menu',
    category: 'custom',
    sections: [
      {
        name: 'Warm-up',
        exercises: [{ name: 'Suburi', quantities: { repetitions: 24 } }, { name: 'Men' }],
      },
      { name: 'Main keiko', exercises: [{ name: 'Kote-men' }] },
    ],
  };
}

describe('seeded custom-menu edit fuzz', () => {
  const seed = readSeed();

  beforeAll(() => {
    // eslint-disable-next-line no-console -- The fuzz skill requires the exact seed on each run.
    console.info(
      `[custom-edit-fuzz] seed=${seed} smoke=${SMOKE_SEQUENCES} broad=${FUZZ_SEQUENCES} editsPerSequence=${EDITS_PER_SEQUENCE}`,
    );
  });

  it(`smokes ${SMOKE_SEQUENCES} deterministic mixed edit sequences (seed ${seed})`, () => {
    for (let sequence = 0; sequence < SMOKE_SEQUENCES; sequence += 1) {
      runSequence(seed, sequence, 2);
    }
  });

  it(
    `survives ${FUZZ_SEQUENCES} bounded mixed edit sequences and ${FUZZ_SEQUENCES * EDITS_PER_SEQUENCE} edits (seed ${seed})`,
    { timeout: 30_000 },
    () => {
      for (let sequence = 0; sequence < FUZZ_SEQUENCES; sequence += 1) {
        runSequence(seed, sequence + 100, EDITS_PER_SEQUENCE);
      }
    },
  );

  it('keeps built-in menu structure immutable through the custom edit action', () => {
    const storage = new MemoryStorage();
    const store = createTrainingStore({ storage, storageKey: STORAGE_KEY });
    const builtIn = DEFAULT_TRAINING_SETS[0];
    if (builtIn === undefined) {
      throw new Error('Expected a curated built-in training set.');
    }
    const entryId = store.getState().addToDashboard(builtIn.id);
    const beforeState = store.getState().dashboardEntries;
    const beforeRaw = requireRaw(storage);
    const draft = draftWithoutRetainedIds(makeSimpleCustomInput().sections);

    expect(() =>
      store.getState().updateCustomTrainingSet(entryId, draft.input, draft.identities),
    ).toThrow();
    expect(store.getState().dashboardEntries).toEqual(beforeState);
    expect(requireRaw(storage)).toBe(beforeRaw);
  });

  it('rejects identity attacks and malformed candidates without a partial write', () => {
    const random = createRandom(seed);
    const { storage, store, entryId } = createScenario(random, 999);
    const entry = requireEntry(store, entryId);
    const plan = createEditPlan(entry, random, 999, 0, false);

    for (let variant = 0; variant < 5; variant += 1) {
      const invalid = invalidPlan(plan, variant);
      expectAtomicRejection(
        store,
        storage,
        entryId,
        invalid.input,
        invalid.identities,
        seed,
        `invalid variant ${variant}`,
      );
    }
  });

  it('accepts exact activity limits and atomically rejects every overflow boundary', () => {
    const random = createRandom(seed);
    const { storage, store, entryId } = createScenario(random, 1_001);
    const exactMaxSections = Array.from(
      { length: TRAINING_DATA_LIMITS.customSections },
      (_, index) => makeBoundarySection(index, 7),
    );
    const maximum = draftWithoutRetainedIds(exactMaxSections, {
      name: 'M'.repeat(TRAINING_DATA_LIMITS.nameCharacters),
      description: 'D'.repeat(TRAINING_DATA_LIMITS.descriptionCharacters),
    });
    const edited = store
      .getState()
      .updateCustomTrainingSet(entryId, maximum.input, maximum.identities);
    expect(getTrainingSetActivities(requireTrainingSet(edited))).toHaveLength(
      TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet,
    );
    expect(edited.quantityOverrides).toEqual({});
    expect(edited.notes).toContain('preserve through edits');
    const maxInspection = classifyTrainingStorageValue(requireRaw(storage));
    expect(maxInspection.status).toBe('ready');

    const tooManySections = draftWithoutRetainedIds(
      Array.from({ length: TRAINING_DATA_LIMITS.customSections + 1 }, (_, index) =>
        makeBoundarySection(index, 1),
      ),
    );
    const tooManyExercises = draftWithoutRetainedIds([
      makeBoundarySection(0, TRAINING_DATA_LIMITS.exercisesPerSection + 1),
    ]);
    const overActivityLimit = exactMaxSections.map((section, index) =>
      index === exactMaxSections.length - 1
        ? { ...section, exercises: [...section.exercises, { name: 'Extra exercise' }] }
        : section,
    );
    const tooManyActivities = draftWithoutRetainedIds(overActivityLimit);
    const tooLongName = draftWithoutRetainedIds(exactMaxSections, {
      name: 'M'.repeat(TRAINING_DATA_LIMITS.nameCharacters + 1),
    });
    const tooLongDescription = draftWithoutRetainedIds(exactMaxSections, {
      description: 'D'.repeat(TRAINING_DATA_LIMITS.descriptionCharacters + 1),
    });
    const tooLongNote = draftWithoutRetainedIds([
      {
        ...makeBoundarySection(0, 1),
        exercises: [
          {
            name: 'Long note',
            notes: 'N'.repeat(TRAINING_DATA_LIMITS.noteCharacters + 1),
          },
        ],
      },
    ]);

    for (const [label, draft] of [
      ['too many sections', tooManySections],
      ['too many exercises in a section', tooManyExercises],
      ['too many activities', tooManyActivities],
      ['overlong menu name', tooLongName],
      ['overlong description', tooLongDescription],
      ['overlong exercise note', tooLongNote],
    ] as const) {
      expectAtomicRejection(store, storage, entryId, draft.input, draft.identities, seed, label);
    }

    const oversizedNotes = Array.from(
      { length: TRAINING_DATA_LIMITS.customSections },
      (_, index) => ({
        name: `Large section ${index}`,
        exercises: Array.from({ length: 7 }, (_value, exerciseIndex) => ({
          name: `Large exercise ${index}.${exerciseIndex}`,
          notes: 'N'.repeat(TRAINING_DATA_LIMITS.noteCharacters),
        })),
      }),
    );
    const oversizedPersistence = draftWithoutRetainedIds(oversizedNotes);
    expect(TRAINING_STORE_RAW_JSON_LIMIT).toBeGreaterThan(0);
    expectAtomicRejection(
      store,
      storage,
      entryId,
      oversizedPersistence.input,
      oversizedPersistence.identities,
      seed,
      'serialized storage size overflow',
    );
  });
});
