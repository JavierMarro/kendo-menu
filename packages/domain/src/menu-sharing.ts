/** The note-free, versioned content that may be exposed by a custom-menu link. */
import {
  isValidTrainingQuantities,
  type FixedTrainingDuration,
  validateTrainingSet,
  validateTrainingSetInput,
  type DashboardEntry,
  type TrainingActivity,
  type TrainingQuantities,
  type TrainingSetInput,
} from './types.js';

export interface SharedMenuExerciseV1 {
  readonly name: string;
  readonly quantities?: TrainingQuantities;
  readonly additionalDuration?: FixedTrainingDuration;
}

export interface SharedMenuSectionV1 {
  readonly name: string;
  readonly quantities?: TrainingQuantities;
  readonly additionalDuration?: FixedTrainingDuration;
  readonly exercises: readonly SharedMenuExerciseV1[];
}

export interface SharedMenuV1 {
  readonly version: 1;
  readonly name: string;
  readonly customIntensity?: TrainingSetInput['customIntensity'];
  readonly sections: readonly SharedMenuSectionV1[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnly(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validAdditionalDuration(value: Readonly<Record<string, unknown>>): boolean {
  if (!Object.hasOwn(value, 'additionalDuration')) return true;
  const extra = value['additionalDuration'];
  const quantities = value['quantities'];
  return (
    isRecord(extra) &&
    hasOnly(extra, ['unit', 'value']) &&
    Object.hasOwn(extra, 'unit') &&
    Object.hasOwn(extra, 'value') &&
    isValidTrainingQuantities({ duration: extra }) &&
    isRecord(quantities) &&
    isRecord(quantities['duration']) &&
    extra['unit'] !== quantities['duration']['unit']
  );
}

function additionalDurationField(value: unknown): {
  readonly additionalDuration?: FixedTrainingDuration;
} {
  if (!isRecord(value) || !Object.hasOwn(value, 'additionalDuration')) return {};
  const extra = value['additionalDuration'];
  if (
    !isRecord(extra) ||
    (extra['unit'] !== 'seconds' && extra['unit'] !== 'minutes') ||
    typeof extra['value'] !== 'number'
  )
    return {};
  return { additionalDuration: { unit: extra['unit'], value: extra['value'] } };
}

function readExercise(section: unknown, index: number): unknown {
  return isRecord(section) && Array.isArray(section['exercises'])
    ? section['exercises'][index]
    : undefined;
}

function stripAdditionalDuration(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { additionalDuration: _extra, exercises, ...rest } = value;
  return Array.isArray(exercises)
    ? { ...rest, exercises: exercises.map(stripAdditionalDuration) }
    : rest;
}

function effectiveQuantities(
  activity: TrainingActivity,
  overrides: DashboardEntry['quantityOverrides'][string],
): TrainingQuantities | undefined {
  const base = activity.quantities;
  const durationOverrideUnits = (['seconds', 'minutes'] as const).filter(
    (unit) => overrides?.[unit] !== undefined,
  );
  const durationUnit = base?.duration?.unit ?? durationOverrideUnits[0];
  const durationOverride = durationUnit === undefined ? undefined : overrides?.[durationUnit];
  const duration =
    durationUnit === undefined
      ? undefined
      : durationOverride !== undefined
        ? { unit: durationUnit, value: durationOverride }
        : base?.duration;
  const quantities: TrainingQuantities = {
    ...(base?.repetitions === undefined
      ? overrides?.repetitions === undefined
        ? {}
        : { repetitions: overrides.repetitions }
      : { repetitions: overrides?.repetitions ?? base.repetitions }),
    ...(base?.sets === undefined
      ? overrides?.sets === undefined
        ? {}
        : { sets: overrides.sets }
      : { sets: overrides?.sets ?? base.sets }),
    ...(base?.rounds === undefined
      ? overrides?.rounds === undefined
        ? {}
        : { rounds: overrides.rounds }
      : { rounds: overrides?.rounds ?? base.rounds }),
    ...(duration === undefined ? {} : { duration }),
  };
  return Object.keys(quantities).length === 0 ? undefined : quantities;
}

function activityInput(
  activity: TrainingActivity,
  overrides: DashboardEntry['quantityOverrides'],
): SharedMenuExerciseV1 {
  const quantities = effectiveQuantities(activity, overrides[activity.id] ?? {});
  const extraUnit = (['seconds', 'minutes'] as const).find(
    (unit) => overrides[activity.id]?.[unit] !== undefined && unit !== quantities?.duration?.unit,
  );
  const extraValue = extraUnit === undefined ? undefined : overrides[activity.id]?.[extraUnit];
  // Equal effective fixed durations must share one canonical representation.
  if (
    quantities?.duration?.unit === 'minutes' &&
    'value' in quantities.duration &&
    extraUnit === 'seconds' &&
    extraValue !== undefined
  ) {
    return {
      name: activity.name,
      quantities: { ...quantities, duration: { unit: 'seconds', value: extraValue } },
      additionalDuration: quantities.duration,
    };
  }
  return {
    name: activity.name,
    ...(quantities === undefined ? {} : { quantities }),
    ...(extraUnit === undefined || extraValue === undefined
      ? {}
      : { additionalDuration: { unit: extraUnit, value: extraValue } }),
  };
}

/** Project a validated custom dashboard snapshot, resolving current quantity overrides. */
export function createSharedMenuV1(entry: DashboardEntry): SharedMenuV1 {
  const validated = validateTrainingSet(entry.trainingSet);
  if (!validated.success || validated.value.isBuiltIn || validated.value.category !== 'custom') {
    throw new Error('Only a valid custom dashboard menu can be shared.');
  }
  const trainingSet = validated.value;
  if (
    trainingSet.activities.some((section) =>
      section.children.some((child) => child.children.length),
    )
  ) {
    throw new Error('This custom menu structure cannot be shared.');
  }

  const share: SharedMenuV1 = {
    version: 1,
    name: trainingSet.name,
    ...(trainingSet.customIntensity === undefined
      ? {}
      : { customIntensity: trainingSet.customIntensity }),
    sections: trainingSet.activities.map((section) => {
      return {
        ...activityInput(section, entry.quantityOverrides),
        exercises: section.children.map((exercise) =>
          activityInput(exercise, entry.quantityOverrides),
        ),
      };
    }),
  };
  const parsed = parseSharedMenuV1(share);
  if (parsed === null) throw new Error('The custom menu cannot be represented as a share.');
  return parsed;
}

/** Parse a public share payload into fresh custom-menu input; unknown fields are rejected. */
export function parseSharedMenuV1(value: unknown): SharedMenuV1 | null {
  try {
    if (
      !isRecord(value) ||
      !hasOnly(value, ['version', 'name', 'customIntensity', 'sections']) ||
      value['version'] !== 1 ||
      !Array.isArray(value['sections'])
    ) {
      return null;
    }
    for (const section of value['sections']) {
      if (
        !isRecord(section) ||
        !hasOnly(section, ['name', 'quantities', 'additionalDuration', 'exercises'])
      )
        return null;
      if (!validAdditionalDuration(section)) return null;
      if (!Array.isArray(section['exercises'])) return null;
      for (const exercise of section['exercises']) {
        if (
          !isRecord(exercise) ||
          !hasOnly(exercise, ['name', 'quantities', 'additionalDuration']) ||
          !validAdditionalDuration(exercise)
        )
          return null;
      }
    }
    const input = validateTrainingSetInput({
      name: value['name'],
      ...(Object.hasOwn(value, 'customIntensity')
        ? { customIntensity: value['customIntensity'] }
        : {}),
      category: 'custom',
      sections: value['sections'].map((section) => stripAdditionalDuration(section)),
    });
    if (!input.success) return null;
    const sections = value['sections'];
    const result: SharedMenuV1 = {
      version: 1,
      name: input.value.name,
      ...(input.value.customIntensity === undefined
        ? {}
        : { customIntensity: input.value.customIntensity }),
      sections: input.value.sections.map((section, index) => ({
        ...additionalDurationField(sections[index]),
        name: section.name,
        ...(section.quantities === undefined ? {} : { quantities: section.quantities }),
        exercises: section.exercises.map((exercise, childIndex) => ({
          ...additionalDurationField(readExercise(sections[index], childIndex)),
          name: exercise.name,
          ...(exercise.quantities === undefined ? {} : { quantities: exercise.quantities }),
        })),
      })),
    };
    return result;
  } catch {
    return null;
  }
}

/** Convert a validated share payload to the existing custom-menu creation contract. */
export function sharedMenuV1ToTrainingSetInput(value: unknown): TrainingSetInput | null {
  const share = parseSharedMenuV1(value);
  if (share === null) return null;
  return {
    name: share.name,
    ...(share.customIntensity === undefined ? {} : { customIntensity: share.customIntensity }),
    category: 'custom',
    sections: share.sections.map((section) => ({
      name: section.name,
      ...(section.quantities === undefined ? {} : { quantities: section.quantities }),
      exercises: section.exercises.map((exercise) => ({
        name: exercise.name,
        ...(exercise.quantities === undefined ? {} : { quantities: exercise.quantities }),
      })),
    })),
  };
}
