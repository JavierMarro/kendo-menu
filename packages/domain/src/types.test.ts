import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAINING_SETS,
  MAX_REPETITIONS,
  MIN_REPETITIONS,
  isValidRepetitionCount,
  validateTrainingSetInput,
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
});

describe('curated defaults', () => {
  it('contains only the supplied high-school club drill with ordered sections', () => {
    expect(DEFAULT_TRAINING_SETS).toHaveLength(1);
    const trainingSet = DEFAULT_TRAINING_SETS[0];

    expect(trainingSet?.name).toBe('High School Kendo Club Drill');
    expect(trainingSet?.isBuiltIn).toBe(true);
    expect(trainingSet?.sections.map((section) => section.label)).toEqual([
      'Warm-up',
      'Suburi',
      'Footwork',
      'Kihon',
      'Waza-geiko',
      'Oikomi-geiko',
      'Ji-geiko',
      'Kakari-geiko',
    ]);
    expect(trainingSet?.sections.map((section) => section.steps.map((step) => step.label))).toEqual(
      [
        ['stretch', 'ladder training'],
        ['jogeburi', 'shomen', 'sayu-men', 'matawari', 'ikkyodo (one-hand)'],
        ['Big step (forward and backward)', 'Short step (forward and backward)', 'Hopping on left'],
        [
          'Kirikaeshi — suri-ashi version',
          'Kirikaeshi — one-breath version',
          'Kirikaeshi — mutual version',
          'Kirikaeshi — do-kirikaeshi version',
          'Men',
          'sashi-men',
          'kote',
          'do',
          'morote-tsuki',
          'gyaku-do',
          'kote-men',
          'hiki-men',
          'katsugi',
          'hiki-kote',
          'hiki-do',
          'hiki-gyaku-do',
        ],
        [
          'debana-men',
          'debana-kote',
          'men-nuki-do',
          'men-suriage-men',
          'ai-kote-men',
          'kote-kaeshi-men',
          'oji-waza vs. kote-men',
          'oji-waza vs. hiki-men',
          'oji-waza vs. hiki-do',
        ],
        ['big men', 'small men', 'small kote-men', 'hiki-men', 'kosa-men', 'kote-men-do-kote-men'],
        ['ji-geiko'],
        ['kakari-geiko'],
      ],
    );
    const ids =
      trainingSet?.sections.flatMap((section) => [
        section.id,
        ...section.steps.map((step) => step.id),
      ]) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      trainingSet?.sections
        .flatMap((section) => section.steps)
        .every((step) => step.defaultReps === null),
    ).toBe(true);
    const steps = trainingSet?.sections.flatMap((section) => section.steps) ?? [];
    expect(steps.find((step) => step.id === 'kihon-morote-tsuki')?.description).toContain(
      'HS-only',
    );
    expect(
      steps
        .filter((step) => step.id !== 'kihon-morote-tsuki')
        .every((step) => step.description === undefined),
    ).toBe(true);
  });
});
