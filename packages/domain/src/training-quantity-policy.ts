import { getDefaultTrainingQuantityUnits, getEditableTrainingQuantityUnits } from './types';
import type { TrainingActivity, TrainingQuantityOverrides, TrainingQuantityUnit } from './types';

export interface TrainingQuantityPolicy {
  readonly primaryUnit: TrainingQuantityUnit;
  readonly editableUnits: readonly TrainingQuantityUnit[];
}

function normalizeTrainingActivityName(value: string): string {
  return value.toLocaleLowerCase('en').replaceAll(/[^a-z0-9]+/g, '');
}

function inferTrainingQuantityUnit(
  activity: TrainingActivity,
  parentActivity?: TrainingActivity,
): TrainingQuantityUnit {
  const activityName = normalizeTrainingActivityName(activity.name);
  const parentActivityName =
    parentActivity === undefined ? undefined : normalizeTrainingActivityName(parentActivity.name);

  if (parentActivityName?.includes('suburi') === true) {
    return 'repetitions';
  }

  const name = `${parentActivityName ?? ''}${activityName}`;
  if (name.includes('kakari') || name.includes('butsukari')) {
    return 'seconds';
  }
  if (
    name.includes('warmup') ||
    name.includes('suburi') ||
    name.includes('ashisabaki') ||
    name.includes('suriashi') ||
    name.includes('footwork') ||
    name.includes('jigeiko') ||
    name.includes('shiaigeiko')
  ) {
    return 'minutes';
  }
  return 'repetitions';
}

/** Resolve the quantity information a client needs without exposing legacy fallback mechanics. */
export function getTrainingQuantityPolicy(
  activity: TrainingActivity,
  parentActivity?: TrainingActivity,
  overrides?: TrainingQuantityOverrides,
): TrainingQuantityPolicy {
  const configuredUnits = getDefaultTrainingQuantityUnits(activity);
  const hasExplicitQuantityUnits = configuredUnits.length > 0;
  const hasEditableUnitMetadata = (activity.editableQuantityUnits?.length ?? 0) > 0;
  const isEligibleContainer = hasExplicitQuantityUnits || hasEditableUnitMetadata;
  const editableUnits =
    activity.children.length === 0 || isEligibleContainer
      ? getEditableTrainingQuantityUnits(activity, overrides)
      : [];
  const primaryUnit =
    configuredUnits[0] ??
    activity.editableQuantityUnits?.[0] ??
    inferTrainingQuantityUnit(activity, parentActivity);
  const needsFallbackUnit =
    activity.children.length === 0 &&
    !hasExplicitQuantityUnits &&
    !hasEditableUnitMetadata &&
    !editableUnits.includes(primaryUnit);

  return {
    primaryUnit,
    editableUnits: needsFallbackUnit ? [...editableUnits, primaryUnit] : editableUnits,
  };
}
