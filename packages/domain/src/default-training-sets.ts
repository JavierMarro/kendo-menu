import defaultDrillsSource from '../data/default-drills.json';

import {
  TrainingValidationError,
  asTrainingSetId,
  validateCuratedDrills,
  type CuratedDrill,
  type DrillCategory,
  type TrainingDuration,
  type TrainingExercise,
  type TrainingQuantities,
  type TrainingSection,
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

function freezeExercise(exercise: TrainingExercise): TrainingExercise {
  return Object.freeze({
    id: exercise.id,
    name: exercise.name,
    ...(exercise.quantities === undefined
      ? {}
      : { quantities: freezeQuantities(exercise.quantities) }),
    ...(exercise.notes === undefined ? {} : { notes: exercise.notes }),
  });
}

function freezeSection(section: TrainingSection): TrainingSection {
  return Object.freeze({
    id: section.id,
    name: section.name,
    ...(section.quantities === undefined
      ? {}
      : { quantities: freezeQuantities(section.quantities) }),
    ...(section.notes === undefined ? {} : { notes: section.notes }),
    exercises: Object.freeze(section.exercises.map(freezeExercise)),
  });
}

function createBuiltInTrainingSet(drill: CuratedDrill): TrainingSet {
  return Object.freeze({
    id: asTrainingSetId(drill.id),
    ...(drill.sourceId === undefined ? {} : { sourceId: drill.sourceId }),
    name: drill.name,
    ...(drill.description === undefined ? {} : { description: drill.description }),
    category: getBuiltInDrillCategory(drill.id),
    sections: Object.freeze(drill.sections.map(freezeSection)),
    isBuiltIn: true,
  });
}

const validatedSource = validateCuratedDrills(defaultDrillsSource);
if (!validatedSource.success) {
  throw new TrainingValidationError(validatedSource.issues);
}

export const DEFAULT_TRAINING_SETS: readonly TrainingSet[] = Object.freeze(
  validatedSource.value.map(createBuiltInTrainingSet),
);
