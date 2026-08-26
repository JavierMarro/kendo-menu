import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAINING_SETS,
  MAX_REPETITIONS,
  RESEARCHED_ACTIVITY_COUNT,
  RESEARCHED_DRILL_COUNT,
  RESEARCHED_SECTION_COUNT,
  TrainingValidationError,
  asTrainingSetId,
  assertValidRepetitionCount,
  assertValidTrainingSetInput,
  getDefaultTrainingQuantity,
  getDefaultTrainingQuantityUnits,
  getEffectiveTrainingQuantity,
  getTrainingSectionActivities,
  getTrainingSetActivityCount,
  isValidRepetitionCount,
  isValidTrainingQuantities,
  isValidTrainingQuantityValue,
  validateRepetitionCount,
  validateTrainingSet,
  validateTrainingSetInput,
  type TrainingActivity,
  type TrainingSection,
  type TrainingSet,
} from './index';

function requireTrainingSet(id: string): TrainingSet {
  const trainingSet = DEFAULT_TRAINING_SETS.find((candidate) => candidate.id === id);
  if (trainingSet === undefined) {
    throw new Error(`Missing curated training set: ${id}`);
  }
  return trainingSet;
}

function requireActivity(trainingSetId: string, activityId: string): TrainingActivity {
  const trainingSet = requireTrainingSet(trainingSetId);
  for (const section of trainingSet.sections) {
    if (section.id === activityId) {
      return section;
    }
    const exercise = section.exercises.find((candidate) => candidate.id === activityId);
    if (exercise !== undefined) {
      return exercise;
    }
  }
  throw new Error(`Missing activity: ${activityId}`);
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

  it('supports valid fixed and ranged durations and rejects malformed ranges', () => {
    expect(isValidTrainingQuantities({ duration: { unit: 'seconds', value: 30 } })).toBe(true);
    expect(isValidTrainingQuantities({ duration: { unit: 'minutes', min: 2, max: 5 } })).toBe(true);
    expect(isValidTrainingQuantities({ duration: { unit: 'seconds', min: 60, max: 30 } })).toBe(
      false,
    );
    expect(isValidTrainingQuantities({ duration: { unit: 'seconds', min: -1, max: 30 } })).toBe(
      false,
    );
    expect(
      isValidTrainingQuantities({
        duration: { unit: 'seconds', value: 30, min: 30, max: 30 },
      }),
    ).toBe(false);
    expect(isValidTrainingQuantities({ duration: { unit: 'hours', value: 1 } })).toBe(false);
  });

  it('validates scalar override units without silently converting durations', () => {
    expect(isValidTrainingQuantityValue('seconds', 20.5)).toBe(true);
    expect(isValidTrainingQuantityValue('minutes', 2.5)).toBe(true);
    expect(isValidTrainingQuantityValue('rounds', 3)).toBe(true);
    expect(isValidTrainingQuantityValue('sets', 1.5)).toBe(false);
    expect(isValidTrainingQuantityValue('repetitions', 501)).toBe(false);
  });
});

describe('training-set validation', () => {
  const validTrainingSet: TrainingSet = {
    id: asTrainingSetId('custom-set'),
    name: 'Custom set',
    description: '',
    category: 'custom',
    sections: [
      {
        id: 'custom-section',
        name: 'Standalone section',
        quantities: { repetitions: 0 },
        notes: '',
        exercises: [],
      },
    ],
    isBuiltIn: false,
  };

  it('accepts optional text, section-owned quantities, and empty exercise arrays', () => {
    expect(validateTrainingSet(validTrainingSet)).toEqual({
      success: true,
      value: validTrainingSet,
    });
  });

  it.each([
    ['negative count', { repetitions: -1 }],
    ['decimal count', { sets: 1.5 }],
    ['non-finite duration', { duration: { unit: 'seconds', value: Number.POSITIVE_INFINITY } }],
    ['reversed range', { duration: { unit: 'minutes', min: 10, max: 5 } }],
    ['empty quantities', {}],
  ])('rejects %s', (_label, quantities) => {
    const malformed: unknown = {
      ...validTrainingSet,
      sections: [{ ...validTrainingSet.sections[0], quantities }],
    };
    expect(validateTrainingSet(malformed).success).toBe(false);
  });

  it('rejects duplicate activity IDs and unsupported properties', () => {
    const duplicate: unknown = {
      ...validTrainingSet,
      sections: [
        {
          id: 'duplicate',
          name: 'Section',
          exercises: [{ id: 'duplicate', name: 'Exercise' }],
        },
      ],
    };
    const unsupported: unknown = { ...validTrainingSet, defaultReps: 10 };
    expect(validateTrainingSet(duplicate).success).toBe(false);
    expect(validateTrainingSet(unsupported).success).toBe(false);
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

  it('accepts repetition-only builder output and preserves explicit zero', () => {
    const result = validateTrainingSetInput(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.sections[0]?.exercises[0]?.quantities?.repetitions).toBe(0);
    }
    expect(() => assertValidTrainingSetInput(validInput)).not.toThrow();
  });

  it('generalizes inputs to section quantities, notes, and empty exercise arrays', () => {
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

  it.each([
    ['blank set name', { ...validInput, name: ' ' }],
    [
      'blank section name',
      { ...validInput, sections: [{ name: ' ', exercises: validInput.sections[0].exercises }] },
    ],
    [
      'blank exercise name',
      {
        ...validInput,
        sections: [{ name: 'Section', exercises: [{ name: ' ', quantities: { repetitions: 1 } }] }],
      },
    ],
    [
      'repetitions above builder maximum',
      {
        ...validInput,
        sections: [
          {
            name: 'Section',
            exercises: [{ name: 'Exercise', quantities: { repetitions: MAX_REPETITIONS + 1 } }],
          },
        ],
      },
    ],
    [
      'caller-supplied id',
      {
        ...validInput,
        sections: [
          {
            id: 'caller-id',
            name: 'Section',
            exercises: validInput.sections[0].exercises,
          },
        ],
      },
    ],
  ])('rejects %s', (_label, input) => {
    expect(validateTrainingSetInput(input).success).toBe(false);
  });
});

describe('curated domain behavior', () => {
  it('keeps the researched collection counts and stable IDs', () => {
    const sections = DEFAULT_TRAINING_SETS.flatMap((trainingSet) => trainingSet.sections);
    const ids = DEFAULT_TRAINING_SETS.flatMap((trainingSet) => [
      trainingSet.id,
      ...trainingSet.sections.flatMap((section) => [
        section.id,
        ...section.exercises.map((exercise) => exercise.id),
      ]),
    ]);

    expect(DEFAULT_TRAINING_SETS).toHaveLength(RESEARCHED_DRILL_COUNT);
    expect(sections).toHaveLength(RESEARCHED_SECTION_COUNT);
    expect(
      DEFAULT_TRAINING_SETS.reduce(
        (total, trainingSet) => total + getTrainingSetActivityCount(trainingSet),
        0,
      ),
    ).toBe(RESEARCHED_ACTIVITY_COUNT);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('deep-freezes every curated built-in object and nested quantity', () => {
    expect(Object.isFrozen(DEFAULT_TRAINING_SETS)).toBe(true);
    for (const trainingSet of DEFAULT_TRAINING_SETS) {
      expect(trainingSet.isBuiltIn).toBe(true);
      expect(Object.isFrozen(trainingSet)).toBe(true);
      expect(Object.isFrozen(trainingSet.sections)).toBe(true);
      for (const section of trainingSet.sections) {
        expect(Object.isFrozen(section)).toBe(true);
        expect(Object.isFrozen(section.exercises)).toBe(true);
        if (section.quantities !== undefined) {
          expect(Object.isFrozen(section.quantities)).toBe(true);
          if (section.quantities.duration !== undefined) {
            expect(Object.isFrozen(section.quantities.duration)).toBe(true);
          }
        }
        for (const exercise of section.exercises) {
          expect(Object.isFrozen(exercise)).toBe(true);
          if (exercise.quantities !== undefined) {
            expect(Object.isFrozen(exercise.quantities)).toBe(true);
            if (exercise.quantities.duration !== undefined) {
              expect(Object.isFrozen(exercise.quantities.duration)).toBe(true);
            }
          }
        }
      }
    }
  });

  it('treats standalone sections and quantity-owning parent sections as editable activities', () => {
    const standalone: TrainingSection = {
      id: 'jigeiko',
      name: 'Jigeiko',
      exercises: [],
    };
    const blockWithExercise: TrainingSection = {
      id: 'circuit',
      name: 'Circuit',
      quantities: { rounds: 3 },
      exercises: [{ id: 'station', name: 'Station', quantities: { repetitions: 5 } }],
    };

    expect(getTrainingSectionActivities(standalone)).toEqual([standalone]);
    expect(getTrainingSectionActivities(blockWithExercise)).toEqual([
      blockWithExercise,
      blockWithExercise.exercises[0],
    ]);
  });

  it('reads fixed and ranged defaults and applies scalar overrides independently', () => {
    const activity: TrainingActivity = {
      id: 'activity',
      name: 'Timed block',
      quantities: {
        repetitions: 5,
        sets: 4,
        duration: { unit: 'seconds', min: 30, max: 60 },
      },
    };
    const originalQuantities = activity.quantities;

    expect(getDefaultTrainingQuantityUnits(activity)).toEqual(['repetitions', 'sets', 'seconds']);
    expect(getDefaultTrainingQuantity(activity, 'seconds')).toEqual({ min: 30, max: 60 });
    expect(getEffectiveTrainingQuantity(activity, { repetitions: 8, seconds: 45 }, 'seconds')).toBe(
      45,
    );
    expect(getEffectiveTrainingQuantity(activity, { repetitions: 8, seconds: 45 }, 'sets')).toBe(4);
    expect(getEffectiveTrainingQuantity(activity, undefined, 'seconds')).toEqual({
      min: 30,
      max: 60,
    });
    expect(activity.quantities).toBe(originalQuantities);
  });

  it('preserves representative stable standalone and exercise IDs', () => {
    const warmUp = requireActivity(
      'international-dojo-2-hour-session',
      'international-dojo-2-hour-session-warm-up-warm-up',
    );
    const secondMen = requireActivity(
      'international-dojo-2-hour-session',
      'international-dojo-2-hour-session-uchikomi-men-2',
    );

    expect(warmUp.name).toBe('Warm-up');
    expect(secondMen.name).toBe('men');
  });
});
