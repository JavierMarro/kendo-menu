import {
  DEFAULT_TRAINING_SETS,
  getDefaultTrainingQuantity,
  getDefaultTrainingQuantityUnits,
  getEffectiveTrainingQuantity as calculateEffectiveTrainingQuantity,
  getTrainingQuantityPolicy,
  getTrainingSetActivities as getDomainTrainingSetActivities,
  getTrainingSetActivityCount as getDomainTrainingSetActivityCount,
  getTrainingSetLeafExerciseCount as getDomainTrainingSetLeafExerciseCount,
  getTrainingSetTags,
  isValidTrainingQuantityValue,
  type DashboardEntry,
  type TrainingSetTag,
  type TrainingActivity,
  type TrainingQuantityUnit,
  type TrainingQuantityValue,
  type TrainingSet,
} from '@kendo-menu/domain';

export interface DisplayTrainingQuantity {
  readonly unit: TrainingQuantityUnit;
  readonly value: TrainingQuantityValue;
}

export type CategoryBadgeVariant = 'custom' | 'high-intensity' | 'intense' | 'legacy';

const CATEGORY_BADGE_VARIANTS = {
  custom: 'custom',
  'high-intensity-drill': 'high-intensity',
  'intense-drill': 'intense',
  jigeiko: 'legacy',
  kakari: 'legacy',
  kihon: 'legacy',
  kirikaeshi: 'legacy',
  mixed: 'legacy',
  uchikomi: 'legacy',
  unspecified: 'legacy',
} as const satisfies Readonly<Record<TrainingSet['category'], CategoryBadgeVariant>>;

export const CURATED_TRAINING_SET_COUNT = DEFAULT_TRAINING_SETS.length;

export const CURATED_EXERCISE_COUNT = DEFAULT_TRAINING_SETS.reduce(
  (trainingSetTotal, trainingSet) =>
    trainingSetTotal + getDomainTrainingSetLeafExerciseCount(trainingSet),
  0,
);

export function getTrainingSetSections(trainingSet: TrainingSet): readonly TrainingActivity[] {
  return trainingSet.activities;
}

export function getTrainingSetActivities(trainingSet: TrainingSet): readonly TrainingActivity[] {
  return getDomainTrainingSetActivities(trainingSet);
}

export function getTrainingSetActivityCount(trainingSet: TrainingSet): number {
  return getDomainTrainingSetActivityCount(trainingSet);
}

export function getSectionActivityCount(activity: TrainingActivity): number {
  return getDomainTrainingSetActivityCount({ activities: [activity] });
}

export function getAllTrainingSets(): readonly TrainingSet[] {
  return DEFAULT_TRAINING_SETS;
}

export function getDashboardTrainingSet(entry: DashboardEntry): TrainingSet | undefined {
  return (
    entry.trainingSet ??
    DEFAULT_TRAINING_SETS.find((trainingSet) => trainingSet.id === entry.trainingSetId)
  );
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

export function getMissingTrainingQuantityLabel(
  activity: TrainingActivity,
  parentActivity?: TrainingActivity,
): 'Reps not set' | 'Time not set' {
  const { primaryUnit } = getTrainingQuantityPolicy(activity, parentActivity);
  return primaryUnit === 'seconds' || primaryUnit === 'minutes' ? 'Time not set' : 'Reps not set';
}

export function getEditableTrainingQuantityUnits(
  entry: DashboardEntry,
  activity: TrainingActivity,
  parentActivity?: TrainingActivity,
): readonly TrainingQuantityUnit[] {
  return getTrainingQuantityPolicy(activity, parentActivity, entry.quantityOverrides[activity.id])
    .editableUnits;
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
  if (category === 'intense-drill') {
    return 'Intense session';
  }
  if (category === 'high-intensity-drill') {
    return 'High intensity session';
  }
  if (category === 'custom') {
    return 'Custom';
  }
  if (category === 'unspecified') {
    return 'Category not specified';
  }

  const label = category.replaceAll('-', ' ');
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

export function formatTrainingSetTag(tag: TrainingSetTag): string {
  return tag === 'custom' ? 'Custom' : formatCategory(tag);
}

export function getTrainingSetTagVariant(tag: TrainingSetTag): CategoryBadgeVariant {
  if (tag === 'custom') {
    return 'custom';
  }
  return tag === 'intense-drill' ? 'intense' : 'high-intensity';
}

export function getTrainingSetTagLabels(
  trainingSet: Pick<TrainingSet, 'category' | 'customIntensity'>,
): readonly string[] {
  return getTrainingSetTags(trainingSet).map(formatTrainingSetTag);
}

export type DashboardFilter = 'all' | TrainingSetTag;

export const DASHBOARD_FILTER_OPTIONS: readonly {
  readonly value: DashboardFilter;
  readonly label: string;
}[] = [
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
  { value: 'intense-drill', label: 'Intense session' },
  { value: 'high-intensity-drill', label: 'High intensity session' },
];

export function matchesDashboardFilter(entry: DashboardEntry, filter: DashboardFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  return entry.trainingSet === undefined
    ? false
    : getTrainingSetTags(entry.trainingSet).includes(filter);
}

export function filterDashboardEntries(
  entries: readonly DashboardEntry[],
  filter: DashboardFilter,
): readonly DashboardEntry[] {
  return entries.filter((entry) => matchesDashboardFilter(entry, filter));
}

export function getCategoryBadgeVariant(category: TrainingSet['category']): CategoryBadgeVariant {
  return CATEGORY_BADGE_VARIANTS[category];
}
