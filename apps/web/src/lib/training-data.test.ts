import { describe, expect, it } from 'vitest';

import { asTrainingSetId } from '@kendo-menu/domain';
import type { DashboardEntry, TrainingActivity } from '@kendo-menu/domain';

import {
  formatCategory,
  getCategoryBadgeVariant,
  getEditableTrainingQuantityUnits,
  getInferredTrainingQuantityUnit,
  getMissingTrainingQuantityLabel,
  getSpecifiedTrainingQuantities,
} from './training-data';

function createStandaloneActivity(name: string): TrainingActivity {
  return { id: `standalone-${name}`, name, children: [] };
}

function createExercise(name: string): TrainingActivity {
  return { id: `exercise-${name}`, name, children: [] };
}

const EMPTY_ENTRY = {
  id: 'entry',
  trainingSetId: asTrainingSetId('set'),
  quantityOverrides: {},
  activityNotes: {},
  notes: '',
  createdAt: '',
} satisfies DashboardEntry;

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
      { id: 'suburi', name: 'Suburi', children: [] },
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
      { id: 'kihon-waza', name: 'Kihon-waza', children: [] },
      'repetitions',
      'Reps not set',
    ],
  ] as const)(
    'infers the shared fallback for %s',
    (_label, activity, parentActivity, expectedUnit, expectedMissingLabel) => {
      expect(getInferredTrainingQuantityUnit(activity, parentActivity)).toBe(expectedUnit);
      expect(getMissingTrainingQuantityLabel(activity, parentActivity)).toBe(expectedMissingLabel);
    },
  );

  it('keeps explicit quantities available instead of applying an inferred value', () => {
    const explicitlyTimedActivity: TrainingActivity = {
      id: 'ken-tore-men',
      name: 'Ken-tore Men',
      quantities: { duration: { unit: 'seconds', value: 30 } },
      children: [],
    };
    const explicitlyCountedActivity: TrainingActivity = {
      id: 'haya-suburi',
      name: 'Haya suburi',
      quantities: { repetitions: 100, sets: 2 },
      children: [],
    };

    expect(getSpecifiedTrainingQuantities(explicitlyTimedActivity)).toEqual([
      { unit: 'seconds', value: 30 },
    ]);
    expect(getSpecifiedTrainingQuantities(explicitlyCountedActivity)).toEqual([
      { unit: 'repetitions', value: 100 },
      { unit: 'sets', value: 2 },
    ]);
  });

  it('uses editable unit metadata before falling back to a name inference', () => {
    const metadataActivity: TrainingActivity = {
      id: 'timed-warm-up',
      name: 'Warm-up',
      editableQuantityUnits: ['seconds'],
      children: [],
    };

    expect(getEditableTrainingQuantityUnits(EMPTY_ENTRY, metadataActivity)).toEqual(['seconds']);
    expect(getMissingTrainingQuantityLabel(metadataActivity)).toBe('Time not set');
  });
});
