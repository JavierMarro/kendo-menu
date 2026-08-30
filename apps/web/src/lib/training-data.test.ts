import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAINING_SETS,
  asTrainingSetId,
  getDefaultTrainingQuantityUnits,
} from '@kendo-menu/domain';
import type {
  DashboardEntry,
  TrainingActivity,
  TrainingQuantityUnit,
  TrainingSet,
} from '@kendo-menu/domain';

import {
  formatCategory,
  getCategoryBadgeVariant,
  getEditableTrainingQuantityUnits,
  getMissingTrainingQuantityLabel,
  getSpecifiedTrainingQuantities,
  filterDashboardEntries,
  getTrainingSetTagLabels,
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

type QuantityPolicyBasis = 'explicit' | 'fallback' | 'not editable';

interface QuantityPolicyCharacterization {
  readonly trainingSet: TrainingSet;
  readonly parentActivity?: TrainingActivity;
  readonly activity: TrainingActivity;
  readonly basis: QuantityPolicyBasis;
  readonly units: readonly TrainingQuantityUnit[];
}

function getQuantityPolicyBasis(activity: TrainingActivity): QuantityPolicyBasis {
  const hasExplicitUnits =
    getDefaultTrainingQuantityUnits(activity).length > 0 ||
    (activity.editableQuantityUnits?.length ?? 0) > 0;

  if (hasExplicitUnits) {
    return 'explicit';
  }
  return activity.children.length === 0 ? 'fallback' : 'not editable';
}

function characterizeActivityQuantityPolicy(
  trainingSet: TrainingSet,
  entry: DashboardEntry,
  activity: TrainingActivity,
  parentActivity?: TrainingActivity,
): readonly QuantityPolicyCharacterization[] {
  const characterization: QuantityPolicyCharacterization = {
    trainingSet,
    ...(parentActivity === undefined ? {} : { parentActivity }),
    activity,
    basis: getQuantityPolicyBasis(activity),
    units: getEditableTrainingQuantityUnits(entry, activity, parentActivity),
  };

  return [
    characterization,
    ...activity.children.flatMap((child) =>
      characterizeActivityQuantityPolicy(trainingSet, entry, child, activity),
    ),
  ];
}

function getCuratedQuantityPolicyCharacterization(): readonly QuantityPolicyCharacterization[] {
  return DEFAULT_TRAINING_SETS.flatMap((trainingSet) => {
    const entry = { ...EMPTY_ENTRY, trainingSetId: trainingSet.id };
    return trainingSet.activities.flatMap((activity) =>
      characterizeActivityQuantityPolicy(trainingSet, entry, activity),
    );
  });
}

function formatQuantityPolicyCharacterization(
  characterization: QuantityPolicyCharacterization,
): string {
  const { trainingSet, parentActivity, activity, basis, units } = characterization;
  const parent = parentActivity === undefined ? '(root)' : parentActivity.id;
  const editableUnits = units.length === 0 ? 'none' : units.join(', ');

  return `${trainingSet.id} | ${parent} > ${activity.id} (${activity.name}) | ${basis} | ${editableUnits}`;
}

describe('training-data presentation helpers', () => {
  it('characterizes editable quantity units for every curated activity', () => {
    const characterization = getCuratedQuantityPolicyCharacterization();

    expect(new Set(characterization.map(({ basis }) => basis))).toEqual(
      new Set<QuantityPolicyBasis>(['explicit', 'fallback', 'not editable']),
    );
    expect(characterization.map(formatQuantityPolicyCharacterization)).toMatchSnapshot();
  });

  it('keeps category identifiers stable while presenting session terminology', () => {
    expect(formatCategory('intense-drill')).toBe('Intense session');
    expect(formatCategory('high-intensity-drill')).toBe('High intensity session');
    expect(getCategoryBadgeVariant('intense-drill')).toBe('intense');
    expect(getCategoryBadgeVariant('high-intensity-drill')).toBe('high-intensity');
  });

  it.each([
    ['standalone warm-up', createStandaloneActivity('Warm-up'), undefined, 'Time not set'],
    ['standalone Suburi', createStandaloneActivity('Suburi'), undefined, 'Time not set'],
    [
      'child Suburi exercise',
      createExercise('shōmen'),
      { id: 'suburi', name: 'Suburi', children: [] },
      'Reps not set',
    ],
    ['Kakarigeiko', createStandaloneActivity('Ai kakari-geiko'), undefined, 'Time not set'],
    ['Butsukarigeiko', createStandaloneActivity('Butsukarigeiko'), undefined, 'Time not set'],
    ['Kirikaeshi', createStandaloneActivity('Kirikaeshi'), undefined, 'Reps not set'],
    [
      'ordinary waza exercise',
      createExercise('Men'),
      { id: 'kihon-waza', name: 'Kihon-waza', children: [] },
      'Reps not set',
    ],
  ] as const)(
    'presents the missing-quantity label for %s',
    (_label, activity, parentActivity, expectedMissingLabel) => {
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

  it('derives all custom and curated tag combinations for filtering', () => {
    const custom = {
      id: asTrainingSetId('custom'),
      name: 'Custom',
      category: 'custom',
      customIntensity: 'intense-drill',
      activities: [createStandaloneActivity('Men')],
      isBuiltIn: false,
    } as const;
    const high = {
      id: asTrainingSetId('high'),
      name: 'High',
      category: 'high-intensity-drill',
      activities: [createStandaloneActivity('Men')],
      isBuiltIn: true,
    } as const;
    const entries = [
      { ...EMPTY_ENTRY, id: 'custom-entry', trainingSet: custom },
      { ...EMPTY_ENTRY, id: 'high-entry', trainingSet: high },
      { ...EMPTY_ENTRY, id: 'unknown-entry', trainingSetId: asTrainingSetId('unknown') },
    ];

    expect(getTrainingSetTagLabels(custom)).toEqual(['Custom', 'Intense session']);
    expect(filterDashboardEntries(entries, 'all').map((entry) => entry.id)).toEqual([
      'custom-entry',
      'high-entry',
      'unknown-entry',
    ]);
    expect(filterDashboardEntries(entries, 'custom').map((entry) => entry.id)).toEqual([
      'custom-entry',
    ]);
    expect(filterDashboardEntries(entries, 'intense-drill').map((entry) => entry.id)).toEqual([
      'custom-entry',
    ]);
    expect(
      filterDashboardEntries(entries, 'high-intensity-drill').map((entry) => entry.id),
    ).toEqual(['high-entry']);
  });
});
