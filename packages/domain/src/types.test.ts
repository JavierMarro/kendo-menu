import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAINING_SETS,
  MAX_REPETITIONS,
  MIN_REPETITIONS,
  TRAINING_QUANTITY_UNITS,
  asTrainingSetId,
  isValidRepetitionCount,
  validateTrainingSet,
  validateTrainingSetInput,
  type TrainingSet,
  type TrainingSetInput,
} from './index';

describe('training-domain validation', () => {
  it.each([MIN_REPETITIONS, MAX_REPETITIONS])(
    'accepts the boundary repetition value %s',
    (value) => {
      expect(isValidRepetitionCount(value)).toBe(true);
    },
  );

  it.each([-1, MAX_REPETITIONS + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '20', null])(
    'rejects invalid repetition value %s',
    (value) => {
      expect(isValidRepetitionCount(value)).toBe(false);
    },
  );

  it('keeps null, zero, and a missing override distinguishable', () => {
    const input = {
      name: 'Distinctions',
      description: '',
      category: 'custom',
      sections: [{ label: 'Section', steps: [{ label: 'Zero', defaultReps: 0 }] }],
    } satisfies TrainingSetInput;
    const result = validateTrainingSetInput(input);
    const firstStep = input.sections[0]?.steps[0];

    expect(result.success).toBe(true);
    expect(firstStep).toBeDefined();
    expect(firstStep === undefined ? false : 'defaultReps' in firstStep).toBe(true);
    expect(firstStep?.defaultReps).toBe(0);
    expect(firstStep === undefined ? false : 'repOverrides' in firstStep).toBe(false);
  });

  it.each([
    {
      name: '',
      description: '',
      category: 'custom',
      sections: [{ label: 'S', steps: [{ label: 'T', defaultReps: 1 }] }],
    },
    { name: 'Set', description: '', category: 'custom', sections: [] },
    {
      name: 'Set',
      description: '',
      category: 'custom',
      sections: [{ label: 'S', steps: [] }],
    },
    {
      name: 'Set',
      description: '',
      category: 'custom',
      sections: [{ label: ' ', steps: [{ label: 'T', defaultReps: 1 }] }],
    },
    {
      name: 'Set',
      description: '',
      category: 'custom',
      sections: [{ label: 'S', steps: [{ label: ' ', defaultReps: 1 }] }],
    },
    {
      name: 'Set',
      description: '',
      category: 'custom',
      sections: [{ label: 'S', steps: [{ label: 'T', defaultReps: null }] }],
    },
    {
      name: 'Set',
      description: '',
      category: 'kihon',
      sections: [{ label: 'S', steps: [{ label: 'T', defaultReps: 1 }] }],
    },
    {
      id: 'generated-set-id',
      name: 'Set',
      description: '',
      category: 'custom',
      sections: [{ label: 'S', steps: [{ label: 'T', defaultReps: 1 }] }],
    },
    {
      name: 'Set',
      description: '',
      category: 'custom',
      sections: [
        { id: 'generated-section-id', label: 'S', steps: [{ label: 'T', defaultReps: 1 }] },
      ],
    },
    {
      name: 'Set',
      description: '',
      category: 'custom',
      sections: [{ label: 'S', steps: [{ id: 'generated-step-id', label: 'T', defaultReps: 1 }] }],
    },
  ])('rejects invalid custom input %#', (input) => {
    expect(validateTrainingSetInput(input).success).toBe(false);
  });

  function trainingSetWithQuantities(quantities: unknown): unknown {
    return {
      id: 'malformed-quantity-set',
      name: 'Malformed quantity set',
      description: '',
      category: 'mixed',
      sections: [
        {
          id: 'malformed-quantity-section',
          label: 'Section',
          steps: [
            {
              id: 'malformed-quantity-step',
              label: 'Step',
              defaultReps: null,
              repUnit: 'repetitions',
              quantities,
            },
          ],
        },
      ],
      isBuiltIn: true,
    };
  }

  it.each([
    ['missing collection', undefined],
    [
      'missing unit',
      [
        { unit: 'repetitions', value: null },
        { unit: 'sets', value: null },
        { unit: 'minutes', value: null },
      ],
    ],
    [
      'duplicate unit',
      [
        { unit: 'repetitions', value: null },
        { unit: 'sets', value: null },
        { unit: 'minutes', value: null },
        { unit: 'rounds', value: null },
        { unit: 'rounds', value: 2 },
      ],
    ],
    [
      'non-object entry',
      [
        null,
        { unit: 'repetitions', value: null },
        { unit: 'sets', value: null },
        { unit: 'minutes', value: null },
        { unit: 'rounds', value: null },
      ],
    ],
    [
      'unsupported unit',
      [
        { unit: 'repetitions', value: null },
        { unit: 'sets', value: null },
        { unit: 'minutes', value: null },
        { unit: 'seconds', value: 30 },
      ],
    ],
    [
      'negative value',
      [
        { unit: 'repetitions', value: null },
        { unit: 'sets', value: -1 },
        { unit: 'minutes', value: null },
        { unit: 'rounds', value: null },
      ],
    ],
    [
      'fractional set count',
      [
        { unit: 'repetitions', value: null },
        { unit: 'sets', value: 1.5 },
        { unit: 'minutes', value: null },
        { unit: 'rounds', value: null },
      ],
    ],
    [
      'non-finite minutes',
      [
        { unit: 'repetitions', value: null },
        { unit: 'sets', value: null },
        { unit: 'minutes', value: Number.NaN },
        { unit: 'rounds', value: null },
      ],
    ],
  ])('rejects malformed training quantities: %s', (_label, quantities) => {
    expect(validateTrainingSet(trainingSetWithQuantities(quantities)).success).toBe(false);
  });
});

describe('curated defaults', () => {
  const EXPECTED_DRILLS = [
    ['international-dojo-2-hour-session', 'International dojo (2 hour session)', 12, 23],
    ['japanese-school-club', 'Japanese school club', 11, 24],
    ['junior-high-kendo-club', 'Junior-high kendo club', 8, 18],
    ['official-znkr-ajkf', 'Official ZNKR/AJKF', 6, 13],
    ['police-dojo-asageiko', 'Police dojo asageiko', 5, 8],
    ['police-dojo-asageiko-version-2', 'Police dojo asageiko version 2', 6, 15],
    ['senior-high-school-kendo-club', 'Senior High School kendo club', 15, 39],
    ['university-high-school', 'University High School', 4, 25],
    ['junior-high-school-version-2', 'Junior High School version 2', 4, 13],
    ['university-version-2', 'University version 2', 12, 23],
    ['top-university', 'Top university', 7, 13],
  ] as const;

  function requireTrainingSet(id: string): TrainingSet {
    const trainingSet = DEFAULT_TRAINING_SETS.find((candidate) => candidate.id === id);
    if (trainingSet === undefined) {
      throw new Error(`Expected curated training set ${id}.`);
    }
    return trainingSet;
  }

  it('contains exactly the 11 researched drills with all supplied sections and exercises', () => {
    expect(
      DEFAULT_TRAINING_SETS.map((trainingSet) => [
        trainingSet.id,
        trainingSet.name,
        trainingSet.sections.length,
        trainingSet.sections.flatMap((section) => section.steps).length,
      ]),
    ).toEqual(EXPECTED_DRILLS);
    expect(DEFAULT_TRAINING_SETS).toHaveLength(11);
    expect(DEFAULT_TRAINING_SETS.flatMap((trainingSet) => trainingSet.sections)).toHaveLength(90);
    expect(
      DEFAULT_TRAINING_SETS.flatMap((trainingSet) =>
        trainingSet.sections.flatMap((section) => section.steps),
      ),
    ).toHaveLength(214);
    expect(
      DEFAULT_TRAINING_SETS.some(
        (trainingSet) => trainingSet.id === 'high-school-kendo-club-drill',
      ),
    ).toBe(false);
  });

  it('uses globally unique stable ids, including deterministic duplicate suffixes', () => {
    const ids = DEFAULT_TRAINING_SETS.flatMap((trainingSet) => [
      trainingSet.id,
      ...trainingSet.sections.flatMap((section) => [
        section.id,
        ...section.steps.map((step) => step.id),
      ]),
    ]);

    expect(ids).toHaveLength(315);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_TRAINING_SETS.map((trainingSet) => trainingSet.id)).toEqual(
      EXPECTED_DRILLS.map(([id]) => asTrainingSetId(id)),
    );
    expect(
      requireTrainingSet('international-dojo-2-hour-session')
        .sections.find((section) => section.label === 'Uchikomi')
        ?.steps.filter((step) => step.label === 'men')
        .map((step) => step.id),
    ).toEqual([
      'international-dojo-2-hour-session-uchikomi-men-1',
      'international-dojo-2-hour-session-uchikomi-men-2',
    ]);
    expect(
      requireTrainingSet('police-dojo-asageiko-version-2')
        .sections.find((section) => section.label === 'Kihon-waza')
        ?.steps.slice(0, 3)
        .map((step) => step.id),
    ).toEqual([
      'police-dojo-asageiko-version-2-kihon-waza-small-men-1',
      'police-dojo-asageiko-version-2-kihon-waza-small-men-2',
      'police-dojo-asageiko-version-2-kihon-waza-small-men-3',
    ]);
  });

  it('contains only valid, deeply immutable built-in training sets', () => {
    for (const trainingSet of DEFAULT_TRAINING_SETS) {
      expect(validateTrainingSet(trainingSet)).toEqual({ success: true, value: trainingSet });
      expect(trainingSet.isBuiltIn).toBe(true);
      expect(trainingSet.category).toBe('unspecified');
      expect(trainingSet.sections.length).toBeGreaterThan(0);
      expect(Object.isFrozen(trainingSet)).toBe(true);
      expect(Object.isFrozen(trainingSet.sections)).toBe(true);
      for (const section of trainingSet.sections) {
        expect(section.steps.length).toBeGreaterThan(0);
        expect(Object.isFrozen(section)).toBe(true);
        expect(Object.isFrozen(section.steps)).toBe(true);
        for (const step of section.steps) {
          expect(Object.isFrozen(step)).toBe(true);
          expect(Object.isFrozen(step.quantities)).toBe(true);
          expect(step.quantities.every((quantity) => Object.isFrozen(quantity))).toBe(true);
        }
      }
    }
  });

  it('normalizes every supported quantity unit without conflating missing values with zero', () => {
    const steps = DEFAULT_TRAINING_SETS.flatMap((trainingSet) =>
      trainingSet.sections.flatMap((section) => section.steps),
    );
    const signatures: Record<string, number> = {};
    for (const step of steps) {
      expect(step.quantities.map((quantity) => quantity.unit)).toEqual(TRAINING_QUANTITY_UNITS);
      const presentUnits = step.quantities
        .filter((quantity) => quantity.value !== null)
        .map((quantity) => quantity.unit)
        .join('+');
      signatures[presentUnits] = (signatures[presentUnits] ?? 0) + 1;
      expect(step.defaultReps).toBe(
        step.quantities.find((quantity) => quantity.unit === 'repetitions')?.value,
      );
    }

    expect(signatures).toEqual({
      minutes: 11,
      'minutes+rounds': 3,
      repetitions: 45,
      'repetitions+sets': 26,
      sets: 1,
      'sets+minutes': 8,
      '': 120,
    });

    const unknownQuantities = requireTrainingSet('japanese-school-club').sections[0]?.steps[0];
    expect(unknownQuantities?.quantities.map((quantity) => quantity.value)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(unknownQuantities?.quantities.some((quantity) => quantity.value === 0)).toBe(false);
  });

  it('preserves simultaneous quantities and converts source seconds to minutes exactly', () => {
    const juniorHigh = requireTrainingSet('junior-high-kendo-club');
    const haya = juniorHigh.sections[0]?.steps.find((step) => step.label === 'haya');
    expect(haya?.quantities).toEqual([
      { unit: 'repetitions', value: 100 },
      { unit: 'sets', value: 2 },
      { unit: 'minutes', value: null },
      { unit: 'rounds', value: null },
    ]);

    const kakarigeiko = juniorHigh.sections.find((section) => section.label === 'Kakarigeiko')
      ?.steps[0];
    expect(kakarigeiko?.quantities).toEqual([
      { unit: 'repetitions', value: null },
      { unit: 'sets', value: null },
      { unit: 'minutes', value: 20 / 60 },
      { unit: 'rounds', value: 30 },
    ]);
  });

  it('leaves prose-only quantities unresolved instead of inventing numeric values', () => {
    const topUniversity = requireTrainingSet('top-university');
    const sandanKirikaeshi = topUniversity.sections.find(
      (section) => section.label === 'Sandan geiko',
    )?.steps[0];

    expect(sandanKirikaeshi?.description).toBe('50/40/30 pattern or 100/100/100 pattern');
    expect(sandanKirikaeshi?.quantities.every((quantity) => quantity.value === null)).toBe(true);
  });
});
