import { describe, expect, it } from 'vitest';

import type { TrainingExercise, TrainingSection } from '@kendo-menu/domain';

import {
  formatCategory,
  getCategoryBadgeVariant,
  getInferredTrainingQuantityUnit,
  getMissingTrainingQuantityLabel,
  getSpecifiedTrainingQuantities,
} from './training-data';

function createStandaloneActivity(name: string): TrainingSection {
  return { id: `standalone-${name}`, name, exercises: [] };
}

function createExercise(name: string): TrainingExercise {
  return { id: `exercise-${name}`, name };
}

describe('training-data presentation helpers', () => {
  it('keeps category identifiers stable while presenting session terminology', () => {
    expect(formatCategory('intense-drill')).toBe('Intense session');
    expect(formatCategory('high-intensity-drill')).toBe('High intensity session');
    expect(getCategoryBadgeVariant('intense-drill')).toBe('intense');
    expect(getCategoryBadgeVariant('high-intensity-drill')).toBe('high-intensity');
  });

  it.each([
    [
      'standalone warm-up',
      createStandaloneActivity('Warm-up'),
      undefined,
      'minutes',
      'Time not set',
    ],
    ['standalone Suburi', createStandaloneActivity('Suburi'), undefined, 'minutes', 'Time not set'],
    [
      'child Suburi exercise',
      createExercise('shōmen'),
      { id: 'suburi', name: 'Suburi', exercises: [] },
      'repetitions',
      'Reps not set',
    ],
    [
      'Kakarigeiko',
      createStandaloneActivity('Ai kakari-geiko'),
      undefined,
      'seconds',
      'Time not set',
    ],
    [
      'Butsukarigeiko',
      createStandaloneActivity('Butsukarigeiko'),
      undefined,
      'seconds',
      'Time not set',
    ],
    [
      'Kirikaeshi',
      createStandaloneActivity('Kirikaeshi'),
      undefined,
      'repetitions',
      'Reps not set',
    ],
    [
      'ordinary waza exercise',
      createExercise('Men'),
      { id: 'kihon-waza', name: 'Kihon-waza', exercises: [] },
      'repetitions',
      'Reps not set',
    ],
  ] as const)(
    'infers the shared fallback for %s',
    (_label, activity, parentSection, expectedUnit, expectedMissingLabel) => {
      expect(getInferredTrainingQuantityUnit(activity, parentSection)).toBe(expectedUnit);
      expect(getMissingTrainingQuantityLabel(activity, parentSection)).toBe(expectedMissingLabel);
    },
  );

  it('keeps explicit quantities available instead of applying an inferred value', () => {
    const explicitlyTimedActivity: TrainingExercise = {
      id: 'ken-tore-men',
      name: 'Ken-tore Men',
      quantities: { duration: { unit: 'seconds', value: 30 } },
    };
    const explicitlyCountedActivity: TrainingExercise = {
      id: 'haya-suburi',
      name: 'Haya suburi',
      quantities: { repetitions: 100, sets: 2 },
    };

    expect(getSpecifiedTrainingQuantities(explicitlyTimedActivity)).toEqual([
      { unit: 'seconds', value: 30 },
    ]);
    expect(getSpecifiedTrainingQuantities(explicitlyCountedActivity)).toEqual([
      { unit: 'repetitions', value: 100 },
      { unit: 'sets', value: 2 },
    ]);
  });
});
