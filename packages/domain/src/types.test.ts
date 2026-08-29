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
  isValidEditableQuantityUnits,
  isValidRepetitionCount,
  isValidTrainingQuantities,
  isValidTrainingQuantityValue,
  validateCuratedDrills,
  validateRepetitionCount,
  validateTrainingSet,
  validateTrainingSetInput,
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
