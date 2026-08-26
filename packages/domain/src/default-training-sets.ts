import defaultDrillsSource from '../data/default-drills.json';

import {
  TrainingValidationError,
  asTrainingSetId,
  validateCuratedDrills,
  type CuratedDrill,
  type TrainingDuration,
  type TrainingExercise,
  type TrainingQuantities,
  type TrainingSection,
  type TrainingSet,
} from './types';

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
    category: 'unspecified',
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
