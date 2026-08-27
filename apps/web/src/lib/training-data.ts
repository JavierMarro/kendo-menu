import {
  DEFAULT_TRAINING_SETS,
  getDefaultTrainingQuantity,
  getDefaultTrainingQuantityUnits,
  getEffectiveTrainingQuantity as calculateEffectiveTrainingQuantity,
  getTrainingSectionActivities,
  getTrainingSetActivities as getDomainTrainingSetActivities,
  getTrainingSetActivityCount as getDomainTrainingSetActivityCount,
  isValidTrainingQuantityValue,
  TRAINING_QUANTITY_UNITS,
  type DashboardEntry,
  type TrainingActivity,
  type TrainingQuantityUnit,
  type TrainingQuantityValue,
  type TrainingSection,
  type TrainingSet,
} from '@kendo-menu/domain';

export interface DisplayTrainingQuantity {
  readonly unit: TrainingQuantityUnit;
  readonly value: TrainingQuantityValue;
}

export const CURATED_TRAINING_SET_COUNT = DEFAULT_TRAINING_SETS.length;

export const CURATED_EXERCISE_COUNT = DEFAULT_TRAINING_SETS.reduce(
  (trainingSetTotal, trainingSet) =>
    trainingSetTotal +
    trainingSet.sections.reduce(
      (sectionTotal, section) => sectionTotal + section.exercises.length,
      0,
    ),
  0,
);

export function getTrainingSetSections(trainingSet: TrainingSet): readonly TrainingSection[] {
  return trainingSet.sections;
}

export function getTrainingSetActivities(trainingSet: TrainingSet): readonly TrainingActivity[] {
  return getDomainTrainingSetActivities(trainingSet);
}

export function getTrainingSetActivityCount(trainingSet: TrainingSet): number {
  return getDomainTrainingSetActivityCount(trainingSet);
}

export function getSectionActivityCount(section: TrainingSection): number {
  return getTrainingSectionActivities(section).length;
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

export function getTrainingSetDescription(trainingSet: TrainingSet): string | undefined {
  return trainingSet.description !== undefined && trainingSet.description.trim().length > 0
    ? trainingSet.description
    : undefined;
}

export function getTrainingQuantityValue(
  activity: TrainingActivity,
  unit: TrainingQuantityUnit,
): TrainingQuantityValue | undefined {
  return getDefaultTrainingQuantity(activity, unit);
}

export function getSpecifiedTrainingQuantities(
  activity: TrainingActivity,
): readonly DisplayTrainingQuantity[] {
  return getDefaultTrainingQuantityUnits(activity).flatMap((unit) => {
    const value = getDefaultTrainingQuantity(activity, unit);
    return value === undefined ? [] : [{ unit, value }];
  });
}

export function getEffectiveTrainingQuantity(
  entry: DashboardEntry,
  activity: TrainingActivity,
  unit: TrainingQuantityUnit,
): TrainingQuantityValue | undefined {
  return calculateEffectiveTrainingQuantity(activity, entry.quantityOverrides[activity.id], unit);
}

function getFallbackQuantityUnit(
  activity: TrainingActivity,
  parentSection?: TrainingSection,
): TrainingQuantityUnit {
  const activityName = activity.name.toLocaleLowerCase('en');
  const sectionName = parentSection?.name.toLocaleLowerCase('en');

  if (sectionName?.includes('suburi') === true) {
    return 'repetitions';
  }

  const name = `${sectionName ?? ''} ${activityName}`;
  if (name.includes('kakari')) {
    return 'seconds';
  }
  if (
    name.includes('warm-up') ||
    name.includes('warmup') ||
    name.includes('suburi') ||
    name.includes('ashi sabaki') ||
    name.includes('suri-ashi') ||
    name.includes('footwork') ||
    name.includes('jigeiko') ||
    name.includes('shiaigeiko')
  ) {
    return 'minutes';
  }
  return 'repetitions';
}

export function getEditableTrainingQuantityUnits(
  entry: DashboardEntry,
  activity: TrainingActivity,
  parentSection?: TrainingSection,
): readonly TrainingQuantityUnit[] {
  const overrides = entry.quantityOverrides[activity.id];
  const defaultUnits = getDefaultTrainingQuantityUnits(activity);
  const fallbackUnit =
    defaultUnits.length === 0 ? getFallbackQuantityUnit(activity, parentSection) : undefined;

  return TRAINING_QUANTITY_UNITS.filter(
    (unit) =>
      defaultUnits.includes(unit) ||
      (overrides !== undefined && Object.hasOwn(overrides, unit)) ||
      unit === fallbackUnit,
  );
}

export function isValidQuantityValue(unit: TrainingQuantityUnit, value: number): boolean {
  return isValidTrainingQuantityValue(unit, value);
}

export function isTrainingQuantityRange(
  value: TrainingQuantityValue,
): value is Exclude<TrainingQuantityValue, number> {
  return typeof value !== 'number';
}

export function formatQuantityUnit(unit: TrainingQuantityUnit, value: number): string {
  if (value === 1) {
    switch (unit) {
      case 'repetitions':
        return 'repetition';
      case 'sets':
        return 'set';
      case 'rounds':
        return 'round';
      case 'seconds':
        return 'second';
      case 'minutes':
        return 'minute';
    }
  }
  return unit;
}

export function formatQuantityValue(value: number): string {
  return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value);
}

export function formatTrainingQuantity(quantity: DisplayTrainingQuantity): string {
  if (typeof quantity.value === 'number') {
    return `${formatQuantityValue(quantity.value)} ${formatQuantityUnit(
      quantity.unit,
      quantity.value,
    )}`;
  }

  return `${formatQuantityValue(quantity.value.min)}–${formatQuantityValue(
    quantity.value.max,
  )} ${formatQuantityUnit(quantity.unit, 2)}`;
}

export function getQuantityValidationMessage(unit: TrainingQuantityUnit): string {
  switch (unit) {
    case 'repetitions':
      return 'Enter a whole number from 0 to 500.';
    case 'sets':
      return 'Enter a whole number of sets, 0 or more.';
    case 'rounds':
      return 'Enter a whole number of rounds, 0 or more.';
    case 'seconds':
      return 'Enter a number of seconds, 0 or more.';
    case 'minutes':
      return 'Enter a number of minutes, 0 or more.';
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
