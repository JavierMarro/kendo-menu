import {
  DEFAULT_TRAINING_SETS,
  isValidTrainingQuantityValue,
  TRAINING_QUANTITY_UNITS,
  type DashboardEntry,
  type TrainingSection,
  type TrainingSet,
  type TrainingStep,
  type TrainingQuantity,
  type TrainingQuantityUnit,
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

export function getTrainingSetDescription(trainingSet: TrainingSet): string {
  return trainingSet.description.trim().length > 0
    ? trainingSet.description
    : 'Description not provided.';
}

export function getTrainingQuantityValue(
  step: TrainingStep,
  unit: TrainingQuantityUnit,
): number | null {
  return step.quantities.find((quantity) => quantity.unit === unit)?.value ?? null;
}

export function getSpecifiedTrainingQuantities(step: TrainingStep): readonly TrainingQuantity[] {
  return step.quantities.filter((quantity) => quantity.value !== null);
}

export function getEffectiveTrainingQuantity(
  entry: DashboardEntry,
  step: TrainingStep,
  unit: TrainingQuantityUnit,
): number | null {
  const stepOverrides = entry.quantityOverrides[step.id];
  return stepOverrides !== undefined && Object.hasOwn(stepOverrides, unit)
    ? (stepOverrides[unit] ?? null)
    : getTrainingQuantityValue(step, unit);
}

export function getEditableTrainingQuantityUnits(
  entry: DashboardEntry,
  step: TrainingStep,
): readonly TrainingQuantityUnit[] {
  const stepOverrides = entry.quantityOverrides[step.id];
  const units = TRAINING_QUANTITY_UNITS.filter(
    (unit) =>
      getTrainingQuantityValue(step, unit) !== null ||
      (stepOverrides !== undefined && Object.hasOwn(stepOverrides, unit)),
  );
  if (units.length > 0) {
    return units;
  }
  return [step.repUnit === 'custom' ? 'repetitions' : step.repUnit];
}

export function isValidQuantityValue(unit: TrainingQuantityUnit, value: number): boolean {
  return isValidTrainingQuantityValue(unit, value);
}

export function formatQuantityUnit(unit: TrainingQuantityUnit, value: number): string {
  if (value === 1) {
    switch (unit) {
      case 'repetitions':
        return 'repetition';
      case 'sets':
        return 'set';
      case 'minutes':
        return 'minute';
      case 'rounds':
        return 'round';
    }
  }
  return unit;
}

export function formatQuantityValue(value: number): string {
  return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value);
}

export function formatTrainingQuantity(quantity: TrainingQuantity): string {
  return quantity.value === null
    ? 'Quantity not specified'
    : `${formatQuantityValue(quantity.value)} ${formatQuantityUnit(quantity.unit, quantity.value)}`;
}

export function getQuantityValidationMessage(unit: TrainingQuantityUnit): string {
  switch (unit) {
    case 'repetitions':
      return 'Enter a whole number from 0 to 500.';
    case 'sets':
      return 'Enter a whole number of sets, 0 or more.';
    case 'minutes':
      return 'Enter a number of minutes, 0 or more.';
    case 'rounds':
      return 'Enter a whole number of rounds, 0 or more.';
  }
}

export function formatCategory(category: TrainingSet['category']): string {
  if (category === 'custom') {
    return 'Custom';
  }

  if (category === 'unspecified') {
    return 'Category not specified';
  }

  const label = category.replaceAll('-', ' ');
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}
