import {
  DEFAULT_TRAINING_SETS,
  type DashboardEntry,
  type TrainingSection,
  type TrainingSet,
  type TrainingStep,
} from '@kendo-menu/domain';

export function getTrainingSetSections(trainingSet: TrainingSet): readonly TrainingSection[] {
  return trainingSet.sections;
}

export function getTrainingSetSteps(trainingSet: TrainingSet): readonly TrainingStep[] {
  return getTrainingSetSections(trainingSet).flatMap((section) => section.steps);
}

export function getTrainingSetStepCount(trainingSet: TrainingSet): number {
  return getTrainingSetSteps(trainingSet).length;
}

export function getAllTrainingSets(
  customTrainingSets: readonly TrainingSet[],
): readonly TrainingSet[] {
  return [...DEFAULT_TRAINING_SETS, ...customTrainingSets];
}

export function findTrainingSet(
  trainingSets: readonly TrainingSet[],
  trainingSetId: string,
): TrainingSet | undefined {
  return trainingSets.find((trainingSet) => trainingSet.id === trainingSetId);
}

export function getEffectiveReps(entry: DashboardEntry, step: TrainingStep): number | null {
  return Object.hasOwn(entry.repOverrides, step.id)
    ? (entry.repOverrides[step.id] ?? null)
    : step.defaultReps;
}

export function isValidRepValue(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 500;
}

export function formatRepUnit(step: TrainingStep): string {
  return step.repUnit === 'repetitions' ? 'reps' : step.repUnit;
}

export function formatCategory(category: TrainingSet['category']): string {
  if (category === 'custom') {
    return 'Custom';
  }

  return category.replaceAll('-', ' ');
}
