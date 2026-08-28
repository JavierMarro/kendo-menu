import defaultDrillsSource from '../data/default-drills.json';

import {
  RESEARCHED_ACTIVITY_COUNT,
  RESEARCHED_ID_COUNT,
  RESEARCHED_LEAF_EXERCISE_COUNT,
  RESEARCHED_TOP_LEVEL_ACTIVITY_COUNT,
  RESEARCHED_TRAINING_SESSION_COUNT,
  TrainingValidationError,
  asTrainingSetId,
  getTrainingSetActivities,
  getTrainingSetLeafExerciseCount,
  validateCuratedDrills,
  type CuratedDrill,
  type CuratedActivity,
  type DrillCategory,
  type TrainingDuration,
  type TrainingActivity,
  type TrainingQuantities,
  type TrainingQuantityUnit,
  type TrainingQuantityUnits,
  type TrainingSet,
} from './types';

type BuiltInDrillCategory = Extract<DrillCategory, 'intense-drill' | 'high-intensity-drill'>;

const BUILT_IN_DRILL_CATEGORIES = Object.freeze({
  'international-dojo-2-hour-session': 'intense-drill',
  'japanese-school-club': 'intense-drill',
  'junior-high-kendo-club': 'high-intensity-drill',
  'official-znkr-ajkf': 'intense-drill',
  'police-dojo-asageiko': 'intense-drill',
  'police-dojo-asageiko-version-2': 'intense-drill',
  'senior-high-school-kendo-club': 'high-intensity-drill',
  'university-high-school': 'high-intensity-drill',
  'junior-high-school-version-2': 'intense-drill',
  'university-version-2': 'intense-drill',
  'top-university': 'high-intensity-drill',
} satisfies Readonly<Record<string, BuiltInDrillCategory>>);

type BuiltInDrillId = keyof typeof BUILT_IN_DRILL_CATEGORIES;

function isBuiltInDrillId(id: string): id is BuiltInDrillId {
  return Object.hasOwn(BUILT_IN_DRILL_CATEGORIES, id);
}

function getBuiltInDrillCategory(id: string): BuiltInDrillCategory {
  if (!isBuiltInDrillId(id)) {
    throw new TrainingValidationError([
      { path: 'id', message: `has no built-in category mapping: ${id}` },
    ]);
  }

  return BUILT_IN_DRILL_CATEGORIES[id];
}

function freezeDuration(duration: TrainingDuration): TrainingDuration {
  return Object.freeze(
    'value' in duration
      ? { unit: duration.unit, value: duration.value }
      : { unit: duration.unit, min: duration.min, max: duration.max },
  );
}

function freezeQuantities(quantities: TrainingQuantities): TrainingQuantities {
  return Object.freeze({
    ...(quantities.repetitions === undefined ? {} : { repetitions: quantities.repetitions }),
    ...(quantities.sets === undefined ? {} : { sets: quantities.sets }),
    ...(quantities.rounds === undefined ? {} : { rounds: quantities.rounds }),
    ...(quantities.duration === undefined ? {} : { duration: freezeDuration(quantities.duration) }),
  });
}

function freezeEditableQuantityUnits(units: TrainingQuantityUnits): TrainingQuantityUnits {
  const copy: [TrainingQuantityUnit, ...TrainingQuantityUnit[]] = [units[0], ...units.slice(1)];
  return Object.freeze(copy);
}

function freezeActivity(activity: CuratedActivity): TrainingActivity {
  const children = Object.freeze((activity.exercises ?? []).map(freezeActivity));
  const editableQuantityUnits =
    activity.editableQuantityUnits === undefined
      ? undefined
      : freezeEditableQuantityUnits(activity.editableQuantityUnits);

  return Object.freeze({
    id: activity.id,
    name: activity.name,
    ...(activity.quantities === undefined
      ? {}
      : { quantities: freezeQuantities(activity.quantities) }),
    ...(activity.notes === undefined ? {} : { notes: activity.notes }),
    children,
    ...(editableQuantityUnits === undefined ? {} : { editableQuantityUnits }),
    ...(activity.allowsSessionNotes === undefined
      ? {}
      : { allowsSessionNotes: activity.allowsSessionNotes }),
  });
}

function createBuiltInTrainingSet(drill: CuratedDrill): TrainingSet {
  const activities = Object.freeze(drill.sections.map(freezeActivity));
  return Object.freeze({
    id: asTrainingSetId(drill.id),
    ...(drill.sourceId === undefined ? {} : { sourceId: drill.sourceId }),
    name: drill.name,
    ...(drill.description === undefined ? {} : { description: drill.description }),
    category: getBuiltInDrillCategory(drill.id),
    activities,
    isBuiltIn: true,
  });
}

const validatedSource = validateCuratedDrills(defaultDrillsSource);
if (!validatedSource.success) {
  throw new TrainingValidationError(validatedSource.issues);
}

const adaptedTrainingSets = validatedSource.value.map(createBuiltInTrainingSet);
const adaptedActivities = adaptedTrainingSets.flatMap(getTrainingSetActivities);
const adaptedIds = new Set([
  ...adaptedTrainingSets.map((trainingSet) => trainingSet.id),
  ...adaptedActivities.map((activity) => activity.id),
]);
if (
  adaptedTrainingSets.length !== RESEARCHED_TRAINING_SESSION_COUNT ||
  adaptedTrainingSets.flatMap((trainingSet) => trainingSet.activities).length !==
    RESEARCHED_TOP_LEVEL_ACTIVITY_COUNT ||
  adaptedActivities.length !== RESEARCHED_ACTIVITY_COUNT ||
  adaptedTrainingSets.reduce(
    (total, trainingSet) => total + getTrainingSetLeafExerciseCount(trainingSet),
    0,
  ) !== RESEARCHED_LEAF_EXERCISE_COUNT ||
  adaptedIds.size !== RESEARCHED_ID_COUNT
) {
  throw new TrainingValidationError([
    { path: '', message: 'default training-set counts do not match the researched collection' },
  ]);
}

export const DEFAULT_TRAINING_SETS: readonly TrainingSet[] = Object.freeze(adaptedTrainingSets);
