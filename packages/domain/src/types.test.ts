import { describe, expect, it } from 'vitest';

import defaultDrillsSource from '../data/default-drills.json';
import {
  DEFAULT_TRAINING_SETS,
  MAX_REPETITIONS,
  RESEARCHED_ACTIVITY_COUNT,
  RESEARCHED_DRILL_COUNT,
  RESEARCHED_ID_COUNT,
  RESEARCHED_LEAF_EXERCISE_COUNT,
  RESEARCHED_SECTION_COUNT,
  TrainingValidationError,
  TRAINING_DATA_LIMITS,
  asTrainingSetId,
  assertValidRepetitionCount,
  assertValidTrainingSetInput,
  getDefaultTrainingQuantity,
  getDefaultTrainingQuantityUnits,
  getEditableTrainingQuantityUnits,
  getEffectiveTrainingQuantity,
  getTrainingSetActivities,
  getTrainingSetActivityCount,
  getTrainingSetLeafExerciseCount,
  getTrainingSetTags,
  isCustomTrainingIntensity,
  isValidEditableQuantityUnits,
  isValidRepetitionCount,
  isValidTrainingQuantities,
  isValidTrainingQuantityValue,
  validateCuratedDrills,
  validateRepetitionCount,
  validateTrainingSet,
  validateTrainingSetInput,
  trainingSetHasTag,
  type TrainingActivity,
  type TrainingSet,
} from './index';

function leaf(id: string, name = id, extras: object = {}): TrainingActivity {
  return { id, name, ...extras, children: [] };
}

function activity(
  id: string,
  name: string,
  children: readonly TrainingActivity[],
  extras: object = {},
): TrainingActivity {
  return { id, name, ...extras, children };
}

function trainingSet(activities: readonly TrainingActivity[]): TrainingSet {
  return {
    id: asTrainingSetId('fixture-set'),
    name: 'Fixture set',
    category: 'custom',
    activities,
    isBuiltIn: false,
  };
}

function repeatedText(length: number, character = 'x'): string {
  return character.repeat(length);
}

function runtimeSet(
  activities: readonly TrainingActivity[],
  overrides: Readonly<{
    readonly id?: string;
    readonly name?: string;
    readonly description?: string;
  }> = {},
): TrainingSet {
  return {
    id: asTrainingSetId(overrides.id ?? 'runtime-set'),
    name: overrides.name ?? 'Runtime set',
    ...(overrides.description === undefined ? {} : { description: overrides.description }),
    category: 'custom',
    activities,
    isBuiltIn: false,
  };
}

function runtimeActivityChain(depth: number): TrainingActivity {
  let current = leaf(`depth-${depth}`, `Depth ${depth}`);
  for (let level = depth - 1; level >= 1; level -= 1) {
    current = activity(`depth-${level}`, `Depth ${level}`, [current]);
  }
  return current;
}

describe('training quantity validation', () => {
  it('preserves the repetition-only 0–500 authored-input rule', () => {
    expect(isValidRepetitionCount(0)).toBe(true);
    expect(isValidRepetitionCount(MAX_REPETITIONS)).toBe(true);
    expect(isValidRepetitionCount(-1)).toBe(false);
    expect(isValidRepetitionCount(MAX_REPETITIONS + 1)).toBe(false);
    expect(isValidRepetitionCount(1.5)).toBe(false);
    expect(isValidRepetitionCount(Number.POSITIVE_INFINITY)).toBe(false);
    expect(validateRepetitionCount(24).success).toBe(true);
    expect(validateRepetitionCount('24').success).toBe(false);
    expect(() => assertValidRepetitionCount(501)).toThrow(TrainingValidationError);
  });

  it('validates sparse quantities and keeps unknown distinct from explicit zero', () => {
    expect(isValidTrainingQuantities({ repetitions: 0 })).toBe(true);
    expect(isValidTrainingQuantities({ sets: 4, repetitions: 5 })).toBe(true);
    expect(isValidTrainingQuantities({})).toBe(false);
    expect(isValidTrainingQuantities({ repetitions: null })).toBe(false);
    expect(isValidTrainingQuantities({ repetitions: -1 })).toBe(false);
    expect(isValidTrainingQuantities({ sets: 1.5 })).toBe(false);
    expect(isValidTrainingQuantities({ rounds: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
    expect(isValidTrainingQuantities({ duration: { unit: 'seconds', value: 0 } })).toBe(true);
    expect(isValidTrainingQuantities({ duration: { unit: 'minutes', value: Number.NaN } })).toBe(
      false,
    );
  });

  it('supports ordered fixed and ranged durations and rejects malformed ranges', () => {
    expect(isValidTrainingQuantities({ duration: { unit: 'seconds', value: 30 } })).toBe(true);
    expect(isValidTrainingQuantities({ duration: { unit: 'minutes', min: 2, max: 5 } })).toBe(true);
    expect(isValidTrainingQuantities({ duration: { unit: 'seconds', min: 60, max: 30 } })).toBe(
      false,
    );
    expect(isValidTrainingQuantities({ duration: { unit: 'seconds', min: -1, max: 30 } })).toBe(
      false,
    );
    expect(
      isValidTrainingQuantities({ duration: { unit: 'seconds', value: 30, min: 30, max: 30 } }),
    ).toBe(false);
    expect(isValidTrainingQuantityValue('seconds', 20.5)).toBe(true);
    expect(isValidTrainingQuantityValue('minutes', 2.5)).toBe(true);
    expect(isValidTrainingQuantityValue('rounds', 3)).toBe(true);
    expect(isValidTrainingQuantityValue('sets', 1.5)).toBe(false);
    expect(isValidTrainingQuantityValue('repetitions', 501)).toBe(false);
  });
});

describe('training-set intensity tags', () => {
  const customInput = {
    name: 'Tagged custom session',
    category: 'custom',
    sections: [{ name: 'Activity', exercises: [{ name: 'Men' }] }],
  } as const;

  it('always derives Custom and optionally the selected intensity for custom sets', () => {
    const noIntensity = validateTrainingSetInput(customInput);
    expect(noIntensity.success).toBe(true);
    if (!noIntensity.success) {
      return;
    }
    expect(getTrainingSetTags({ category: 'custom' })).toEqual(['custom']);
    expect(getTrainingSetTags({ category: 'custom', customIntensity: 'intense-drill' })).toEqual([
      'custom',
      'intense-drill',
    ]);
    expect(
      getTrainingSetTags({ category: 'custom', customIntensity: 'high-intensity-drill' }),
    ).toEqual(['custom', 'high-intensity-drill']);
    expect(
      trainingSetHasTag({ category: 'custom', customIntensity: 'intense-drill' }, 'custom'),
    ).toBe(true);
  });

  it('derives curated intensity tags from their existing category', () => {
    expect(getTrainingSetTags({ category: 'intense-drill' })).toEqual(['intense-drill']);
    expect(getTrainingSetTags({ category: 'high-intensity-drill' })).toEqual([
      'high-intensity-drill',
    ]);
    expect(getTrainingSetTags({ category: 'kihon' })).toEqual([]);
  });

  it('strictly validates custom intensity metadata', () => {
    expect(isCustomTrainingIntensity('intense-drill')).toBe(true);
    expect(isCustomTrainingIntensity('high-intensity-drill')).toBe(true);
    expect(isCustomTrainingIntensity('custom')).toBe(false);
    expect(validateTrainingSetInput({ ...customInput, customIntensity: 'custom' }).success).toBe(
      false,
    );
    expect(
      validateTrainingSet({
        ...trainingSet([leaf('activity')]),
        customIntensity: 'high-intensity-drill',
      }).success,
    ).toBe(true);
    expect(
      validateTrainingSet({
        ...trainingSet([leaf('activity')]),
        customIntensity: 'not-an-intensity',
      }).success,
    ).toBe(false);
    expect(
      validateTrainingSet({
        ...trainingSet([leaf('activity')]),
        category: 'intense-drill',
        isBuiltIn: true,
        customIntensity: 'high-intensity-drill',
      }).success,
    ).toBe(false);
  });
});

describe('recursive training-set validation and traversal', () => {
  const recursiveSet = trainingSet([
    activity(
      'root',
      'Root',
      [
        activity(
          'branch',
          'Branch',
          [activity('nested', 'Nested', [leaf('leaf', 'Leaf', { notes: 'Keep posture.' })])],
          { quantities: { rounds: 2 }, editableQuantityUnits: ['rounds', 'minutes'] },
        ),
        leaf('sibling', 'Sibling'),
      ],
      { allowsSessionNotes: true },
    ),
  ]);

  it('accepts a valid four-level tree and returns a deeply cloned, frozen value', () => {
    const result = validateTrainingSet(recursiveSet);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.value).not.toBe(recursiveSet);
    expect(getTrainingSetActivities(result.value).map((item) => item.id)).toEqual([
      'root',
      'branch',
      'nested',
      'leaf',
      'sibling',
    ]);
    expect(getTrainingSetActivityCount(result.value)).toBe(5);
    expect(getTrainingSetLeafExerciseCount(result.value)).toBe(2);
    expect(result.value.activities[0]?.children[0]?.children[0]?.children[0]?.notes).toBe(
      'Keep posture.',
    );
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.activities)).toBe(true);
    expect(Object.isFrozen(result.value.activities[0]?.children)).toBe(true);
    expect(Object.isFrozen(result.value.activities[0]?.children[0]?.quantities)).toBe(true);
    expect(Object.isFrozen(result.value.activities[0]?.children[0]?.editableQuantityUnits)).toBe(
      true,
    );
    expect(Object.isFrozen(result.value.activities[0]?.children[0]?.children)).toBe(true);
  });

  it('requires children on every runtime activity, including empty leaf collections', () => {
    expect(
      validateTrainingSet({
        ...recursiveSet,
        activities: [{ id: 'root', name: 'Root', children: [] }],
      }).success,
    ).toBe(true);
    expect(
      validateTrainingSet({
        ...recursiveSet,
        activities: [{ id: 'root', name: 'Root' }],
      }).success,
    ).toBe(false);
    expect(
      validateTrainingSet({
        ...recursiveSet,
        activities: [{ id: 'root', name: 'Root', children: [{ id: 'child', name: 'Child' }] }],
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate IDs across depths and unsupported activity properties', () => {
    const duplicate: unknown = trainingSet([activity('root', 'Root', [leaf('root', 'Duplicate')])]);
    const unsupported: unknown = {
      ...recursiveSet,
      activities: [{ id: 'root', name: 'Root', children: [], exercises: [] }],
    };
    expect(validateTrainingSet(duplicate).success).toBe(false);
    expect(validateTrainingSet(unsupported).success).toBe(false);
  });

  it('rejects cyclic children without recursing forever', () => {
    const cyclic: { id: string; name: string; children: unknown[] } = {
      id: 'cyclic',
      name: 'Cyclic',
      children: [],
    };
    cyclic.children.push(cyclic);
    expect(
      validateTrainingSet({
        ...recursiveSet,
        activities: [cyclic],
      }).success,
    ).toBe(false);
  });

  it('validates literal session-note permission and nonempty unique editable units', () => {
    expect(isValidEditableQuantityUnits(['seconds'])).toBe(true);
    expect(isValidEditableQuantityUnits([])).toBe(false);
    expect(isValidEditableQuantityUnits(['seconds', 'seconds'])).toBe(false);
    expect(isValidEditableQuantityUnits(['hours'])).toBe(false);
    expect(
      validateTrainingSet({
        ...recursiveSet,
        activities: [{ id: 'root', name: 'Root', children: [], editableQuantityUnits: [] }],
      }).success,
    ).toBe(false);
    expect(
      validateTrainingSet({
        ...recursiveSet,
        activities: [{ id: 'root', name: 'Root', children: [], allowsSessionNotes: false }],
      }).success,
    ).toBe(false);
    expect(
      validateTrainingSet({
        ...recursiveSet,
        activities: [{ id: 'root', name: 'Root', children: [], allowsSessionNotes: undefined }],
      }).success,
    ).toBe(false);
  });

  it('combines explicit quantities, editable metadata, and overrides without fabricating defaults', () => {
    const activityWithMetadata = leaf('metadata', 'Metadata', {
      editableQuantityUnits: ['minutes', 'seconds'],
    });
    expect(getDefaultTrainingQuantityUnits(activityWithMetadata)).toEqual([]);
    expect(getDefaultTrainingQuantity(activityWithMetadata, 'minutes')).toBeUndefined();
    expect(getEditableTrainingQuantityUnits(activityWithMetadata)).toEqual(['minutes', 'seconds']);
    expect(getEditableTrainingQuantityUnits(activityWithMetadata, { repetitions: 0 })).toEqual([
      'minutes',
      'seconds',
      'repetitions',
    ]);
    const explicit = leaf('explicit', 'Explicit', {
      quantities: { repetitions: 0 },
    });
    expect(getEffectiveTrainingQuantity(explicit, undefined, 'repetitions')).toBe(0);
    expect(getEffectiveTrainingQuantity(activityWithMetadata, undefined, 'repetitions')).toBe(
      undefined,
    );
  });
});

describe('training data limits', () => {
  const validInput = {
    name: 'Valid session',
    description: '',
    category: 'custom',
    sections: [
      {
        name: 'Valid activity',
        notes: '',
        exercises: [{ name: 'Valid exercise', notes: '' }],
      },
    ],
  } as const;

  it('accepts exact authored text limits and rejects each one-character overflow', () => {
    const exactName = repeatedText(TRAINING_DATA_LIMITS.nameCharacters);
    const exactDescription = repeatedText(TRAINING_DATA_LIMITS.descriptionCharacters);
    const exactNote = repeatedText(TRAINING_DATA_LIMITS.noteCharacters);
    const exact = validateTrainingSetInput({
      ...validInput,
      name: exactName,
      description: exactDescription,
      sections: [
        {
          name: exactName,
          notes: exactNote,
          exercises: [{ name: exactName, notes: exactNote }],
        },
      ],
    });
    expect(exact.success).toBe(true);

    const overflows = [
      { name: repeatedText(TRAINING_DATA_LIMITS.nameCharacters + 1) },
      { description: repeatedText(TRAINING_DATA_LIMITS.descriptionCharacters + 1) },
      {
        sections: [
          {
            name: exactName,
            notes: repeatedText(TRAINING_DATA_LIMITS.noteCharacters + 1),
            exercises: [{ name: exactName, notes: exactNote }],
          },
        ],
      },
      {
        sections: [
          {
            name: exactName,
            notes: exactNote,
            exercises: [
              { name: exactName, notes: repeatedText(TRAINING_DATA_LIMITS.noteCharacters + 1) },
            ],
          },
        ],
      },
      {
        sections: [
          {
            name: exactName,
            notes: exactNote,
            exercises: [
              { name: repeatedText(TRAINING_DATA_LIMITS.nameCharacters + 1), notes: exactNote },
            ],
          },
        ],
      },
      {
        sections: [
          {
            name: repeatedText(TRAINING_DATA_LIMITS.nameCharacters + 1),
            notes: exactNote,
            exercises: [{ name: exactName, notes: exactNote }],
          },
        ],
      },
    ] as const;

    for (const overrides of overflows) {
      expect(validateTrainingSetInput({ ...validInput, ...overrides }).success).toBe(false);
    }
  });

  it('accepts exact runtime text and identifier limits and rejects one-character overflows', () => {
    const exactSetId = repeatedText(TRAINING_DATA_LIMITS.identifierCharacters, 'i');
    const exactActivityId = repeatedText(TRAINING_DATA_LIMITS.identifierCharacters, 'j');
    const exactName = repeatedText(TRAINING_DATA_LIMITS.nameCharacters);
    const exactDescription = repeatedText(TRAINING_DATA_LIMITS.descriptionCharacters);
    const exactNote = repeatedText(TRAINING_DATA_LIMITS.noteCharacters);
    const exact = validateTrainingSet(
      runtimeSet([leaf(exactActivityId, exactName, { notes: exactNote })], {
        id: exactSetId,
        name: exactName,
        description: exactDescription,
      }),
    );
    expect(exact.success).toBe(true);

    const baseActivity = leaf('runtime-leaf', 'Runtime leaf', { notes: 'note' });
    const overflowValues = [
      runtimeSet([baseActivity], {
        id: repeatedText(TRAINING_DATA_LIMITS.identifierCharacters + 1, 'i'),
      }),
      runtimeSet([baseActivity], { name: repeatedText(TRAINING_DATA_LIMITS.nameCharacters + 1) }),
      runtimeSet([baseActivity], {
        description: repeatedText(TRAINING_DATA_LIMITS.descriptionCharacters + 1),
      }),
      runtimeSet([
        leaf('runtime-leaf', 'Runtime leaf', {
          notes: repeatedText(TRAINING_DATA_LIMITS.noteCharacters + 1),
        }),
      ]),
      runtimeSet([
        leaf(repeatedText(TRAINING_DATA_LIMITS.identifierCharacters + 1, 'i'), 'Runtime leaf'),
      ]),
      runtimeSet([leaf('runtime-leaf', repeatedText(TRAINING_DATA_LIMITS.nameCharacters + 1))]),
    ];
    for (const candidate of overflowValues) {
      expect(validateTrainingSet(candidate).success).toBe(false);
    }
  });

  it('accepts exact section, child, total-activity, and nesting-depth limits', () => {
    const authoredExactSections = Array.from(
      { length: TRAINING_DATA_LIMITS.customSections },
      (_, index) => ({ name: `Activity ${index}`, exercises: [] }),
    );
    expect(
      validateTrainingSetInput({
        name: 'Many activities',
        category: 'custom',
        sections: authoredExactSections,
      }).success,
    ).toBe(true);
    expect(
      validateTrainingSetInput({
        name: 'Too many activities',
        category: 'custom',
        sections: [...authoredExactSections, { name: 'Activity over', exercises: [] }],
      }).success,
    ).toBe(false);

    const authoredExactChildren = Array.from(
      { length: TRAINING_DATA_LIMITS.exercisesPerSection },
      (_, index) => ({ name: `Exercise ${index}` }),
    );
    expect(
      validateTrainingSetInput({
        name: 'Many exercises',
        category: 'custom',
        sections: [{ name: 'Activity', exercises: authoredExactChildren }],
      }).success,
    ).toBe(true);
    expect(
      validateTrainingSetInput({
        name: 'Too many exercises',
        category: 'custom',
        sections: [
          {
            name: 'Activity',
            exercises: [...authoredExactChildren, { name: 'Exercise over' }],
          },
        ],
      }).success,
    ).toBe(false);

    const authoredExactTotal = Array.from({ length: 4 }, (_, sectionIndex) => ({
      name: `Activity ${sectionIndex}`,
      exercises: Array.from(
        { length: TRAINING_DATA_LIMITS.exercisesPerSection - 1 },
        (_, exerciseIndex) => ({ name: `Exercise ${sectionIndex}-${exerciseIndex}` }),
      ),
    }));
    expect(
      validateTrainingSetInput({
        name: 'Exact total',
        category: 'custom',
        sections: authoredExactTotal,
      }).success,
    ).toBe(true);
    expect(
      validateTrainingSetInput({
        name: 'One over total',
        category: 'custom',
        sections: [
          ...authoredExactTotal.slice(0, 3),
          {
            name: 'Activity over',
            exercises: Array.from(
              { length: TRAINING_DATA_LIMITS.exercisesPerSection },
              (_, exerciseIndex) => ({ name: `Exercise over-${exerciseIndex}` }),
            ),
          },
        ],
      }).success,
    ).toBe(false);

    const exactSections = Array.from({ length: TRAINING_DATA_LIMITS.customSections }, (_, index) =>
      leaf(`section-${index}`, `Section ${index}`),
    );
    expect(validateTrainingSet(runtimeSet(exactSections)).success).toBe(true);

    const overSections = [...exactSections, leaf('section-over', 'Section over')];
    expect(validateTrainingSet(runtimeSet(overSections)).success).toBe(false);

    const exactChildren = Array.from(
      { length: TRAINING_DATA_LIMITS.exercisesPerSection },
      (_, index) => leaf(`child-${index}`, `Child ${index}`),
    );
    expect(
      validateTrainingSet(runtimeSet([activity('section', 'Section', exactChildren)])).success,
    ).toBe(true);
    expect(
      validateTrainingSet(
        runtimeSet([
          activity('section', 'Section', [...exactChildren, leaf('child-over', 'Child over')]),
        ]),
      ).success,
    ).toBe(false);

    const exactTotal = Array.from({ length: 4 }, (_, sectionIndex) =>
      activity(
        `total-section-${sectionIndex}`,
        `Section ${sectionIndex}`,
        Array.from({ length: TRAINING_DATA_LIMITS.exercisesPerSection - 1 }, (_, exerciseIndex) =>
          leaf(
            `total-child-${sectionIndex}-${exerciseIndex}`,
            `Child ${sectionIndex}-${exerciseIndex}`,
          ),
        ),
      ),
    );
    expect(validateTrainingSet(runtimeSet(exactTotal)).success).toBe(true);
    expect(
      validateTrainingSet(
        runtimeSet([
          ...exactTotal.slice(0, 3),
          activity(
            'total-section-over',
            'Section over',
            Array.from({ length: TRAINING_DATA_LIMITS.exercisesPerSection }, (_, exerciseIndex) =>
              leaf(`total-over-child-${exerciseIndex}`, `Child ${exerciseIndex}`),
            ),
          ),
        ]),
      ).success,
    ).toBe(false);

    expect(
      validateTrainingSet(
        runtimeSet([runtimeActivityChain(TRAINING_DATA_LIMITS.activityNestingDepth)]),
      ).success,
    ).toBe(true);
    expect(
      validateTrainingSet(
        runtimeSet([runtimeActivityChain(TRAINING_DATA_LIMITS.activityNestingDepth + 1)]),
      ).success,
    ).toBe(false);
  });
});

describe('curated source validation', () => {
  const fixture = [
    {
      id: 'session',
      name: 'Session',
      sections: [
        {
          id: 'root',
          name: 'Root',
          exercises: [
            {
              id: 'branch',
              name: 'Branch',
              editableQuantityUnits: ['repetitions', 'minutes'],
              allowsSessionNotes: true,
              exercises: [
                {
                  id: 'leaf',
                  name: 'Leaf',
                },
              ],
            },
            { id: 'empty', name: 'Empty', exercises: [] },
            { id: 'omitted', name: 'Omitted' },
          ],
        },
      ],
    },
  ] as const;

  it('accepts nested three-level/four-level source activities and empty child arrays', () => {
    const result = validateCuratedDrills(fixture);
    expect(result).toEqual({ success: true, value: fixture });
  });

  it('rejects malformed nested children, unsupported properties, and duplicate IDs at depth', () => {
    expect(
      validateCuratedDrills([
        {
          ...fixture[0],
          sections: [
            {
              ...fixture[0].sections[0],
              exercises: [
                { id: 'branch', name: 'Branch', exercises: [{ id: 'branch', name: 'Dup' }] },
              ],
            },
          ],
        },
      ]).success,
    ).toBe(false);
    expect(
      validateCuratedDrills([
        {
          ...fixture[0],
          sections: [
            { ...fixture[0].sections[0], exercises: [{ id: 'bad', name: 'Bad', exercises: {} }] },
          ],
        },
      ]).success,
    ).toBe(false);
    expect(
      validateCuratedDrills([
        {
          ...fixture[0],
          sections: [
            {
              ...fixture[0].sections[0],
              exercises: [{ id: 'bad-prop', name: 'Bad prop', unsupported: true }],
            },
          ],
        },
      ]).success,
    ).toBe(false);
  });

  it('validates the unchanged default curated JSON without researched-count coupling', () => {
    const result = validateCuratedDrills(defaultDrillsSource);
    expect(result.success).toBe(true);
    expect(DEFAULT_TRAINING_SETS).toHaveLength(RESEARCHED_DRILL_COUNT);
    expect(DEFAULT_TRAINING_SETS.flatMap((set) => set.activities)).toHaveLength(
      RESEARCHED_SECTION_COUNT,
    );
    expect(DEFAULT_TRAINING_SETS.flatMap(getTrainingSetActivities)).toHaveLength(
      RESEARCHED_ACTIVITY_COUNT,
    );
    expect(
      DEFAULT_TRAINING_SETS.reduce((total, set) => total + getTrainingSetLeafExerciseCount(set), 0),
    ).toBe(RESEARCHED_LEAF_EXERCISE_COUNT);
    expect(
      new Set([
        ...DEFAULT_TRAINING_SETS.map((set) => set.id),
        ...DEFAULT_TRAINING_SETS.flatMap(getTrainingSetActivities).map((item) => item.id),
      ]),
    ).toHaveProperty('size', RESEARCHED_ID_COUNT);
  });
});

describe('custom training-set input', () => {
  const validInput = {
    name: 'Zero quantity example',
    description: '',
    category: 'custom',
    sections: [
      {
        name: 'Example',
        exercises: [{ name: 'Still explicit', quantities: { repetitions: 0 } }],
      },
    ],
  } as const;

  it('accepts existing two-level builder output and preserves explicit zero', () => {
    const result = validateTrainingSetInput(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.sections[0]?.exercises[0]?.quantities?.repetitions).toBe(0);
    }
    expect(() => assertValidTrainingSetInput(validInput)).not.toThrow();
  });

  it('accepts section quantities, notes, and empty exercise arrays', () => {
    expect(
      validateTrainingSetInput({
        name: 'Standalone',
        category: 'custom',
        sections: [
          {
            name: 'Jigeiko',
            notes: 'Session note',
            quantities: { duration: { unit: 'minutes', value: 5 } },
            exercises: [],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects blank names, caller IDs, and invalid quantities', () => {
    expect(validateTrainingSetInput({ ...validInput, name: ' ' }).success).toBe(false);
    expect(
      validateTrainingSetInput({
        ...validInput,
        sections: [{ name: ' ', exercises: validInput.sections[0].exercises }],
      }).success,
    ).toBe(false);
    expect(
      validateTrainingSetInput({
        ...validInput,
        sections: [{ name: 'Section', exercises: [{ name: ' ' }] }],
      }).success,
    ).toBe(false);
    expect(
      validateTrainingSetInput({
        ...validInput,
        sections: [{ name: 'Section', exercises: [{ name: 'Exercise', quantities: {} }] }],
      }).success,
    ).toBe(false);
    expect(
      validateTrainingSetInput({
        ...validInput,
        sections: [
          {
            name: 'Section',
            exercises: [{ name: 'Exercise', quantities: { repetitions: MAX_REPETITIONS + 1 } }],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      validateTrainingSetInput({
        ...validInput,
        sections: [{ id: 'caller-id', name: 'Section', exercises: [] }],
      }).success,
    ).toBe(false);
  });
});
