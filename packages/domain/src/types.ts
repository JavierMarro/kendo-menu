declare const trainingSetIdBrand: unique symbol;

export type TrainingSetId = string & {
  readonly [trainingSetIdBrand]: true;
};

export type DrillCategory =
  | 'kihon'
  | 'kirikaeshi'
  | 'uchikomi'
  | 'kakari'
  | 'jigeiko'
  | 'mixed'
  | 'unspecified'
  | 'intense-drill'
  | 'high-intensity-drill'
  | 'custom';

export const TRAINING_QUANTITY_UNITS = [
  'repetitions',
  'sets',
  'rounds',
  'seconds',
  'minutes',
] as const;

export const DURATION_UNITS = ['seconds', 'minutes'] as const;

export type TrainingQuantityUnit = (typeof TRAINING_QUANTITY_UNITS)[number];
export type DurationUnit = (typeof DURATION_UNITS)[number];

export const MIN_REPETITIONS = 0;
export const MAX_REPETITIONS = 500;

export interface FixedTrainingDuration {
  readonly unit: DurationUnit;
  readonly value: number;
}

export interface RangedTrainingDuration {
  readonly unit: DurationUnit;
  readonly min: number;
  readonly max: number;
}

export type TrainingDuration = FixedTrainingDuration | RangedTrainingDuration;

export interface TrainingQuantities {
  readonly repetitions?: number;
  readonly sets?: number;
  readonly rounds?: number;
  readonly duration?: TrainingDuration;
}

export interface TrainingDurationRangeValue {
  readonly min: number;
  readonly max: number;
}

export type TrainingQuantityValue = number | TrainingDurationRangeValue;

export type TrainingQuantityOverrides = Readonly<Partial<Record<TrainingQuantityUnit, number>>>;

export type DashboardQuantityOverrides = Readonly<Record<string, TrainingQuantityOverrides>>;

export interface TrainingExercise {
  readonly id: string;
  readonly name: string;
  readonly quantities?: TrainingQuantities;
  readonly notes?: string;
}

export interface TrainingSection {
  readonly id: string;
  readonly name: string;
  readonly quantities?: TrainingQuantities;
  readonly notes?: string;
  readonly exercises: readonly TrainingExercise[];
}

export type TrainingActivity = TrainingSection | TrainingExercise;

export interface TrainingSet {
  readonly id: TrainingSetId;
  readonly sourceId?: number;
  readonly name: string;
  readonly description?: string;
  readonly category: DrillCategory;
  readonly sections: readonly TrainingSection[];
  readonly isBuiltIn: boolean;
}

export interface CuratedDrill {
  readonly id: string;
  readonly sourceId?: number;
  readonly name: string;
  readonly description?: string;
  readonly sections: readonly TrainingSection[];
}

/** Input for a user-authored exercise. Its generated id is deliberately not accepted. */
export interface TrainingExerciseInput {
  readonly name: string;
  readonly quantities?: TrainingQuantities;
  readonly notes?: string;
}

/** Input for a user-authored section. Its generated id is deliberately not accepted. */
export interface TrainingSectionInput {
  readonly name: string;
  readonly quantities?: TrainingQuantities;
  readonly notes?: string;
  readonly exercises: readonly TrainingExerciseInput[];
}

/** Input for a user-authored set. Set, section, exercise, and dashboard ids are generated. */
export interface TrainingSetInput {
  readonly name: string;
  readonly description?: string;
  readonly category: 'custom';
  readonly sections: readonly TrainingSectionInput[];
}

export type CustomTrainingExerciseInput = TrainingExerciseInput;
export type CustomTrainingSectionInput = TrainingSectionInput;
export type CustomTrainingSetInput = TrainingSetInput;

export interface DashboardEntry {
  readonly id: string;
  readonly trainingSetId: TrainingSetId;
  readonly quantityOverrides: DashboardQuantityOverrides;
  readonly notes: string;
  readonly createdAt: string;
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly issues: readonly ValidationIssue[] };

export class TrainingValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    this.name = 'TrainingValidationError';
    this.issues = issues;
  }
}

export const RESEARCHED_DRILL_COUNT = 11;
export const RESEARCHED_SECTION_COUNT = 90;
export const RESEARCHED_ACTIVITY_COUNT = 211;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasOnlyProperties(
  value: Readonly<Record<string, unknown>>,
  allowedProperties: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((property) => allowedProperties.has(property));
}

function pushIssue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function isValidCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isValidDurationValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function isValidRepetitionCount(value: unknown): value is number {
  return isValidCount(value) && value >= MIN_REPETITIONS && value <= MAX_REPETITIONS;
}

export const isValidReps = isValidRepetitionCount;

export function isDurationUnit(value: unknown): value is DurationUnit {
  return value === 'seconds' || value === 'minutes';
}

export function isTrainingQuantityUnit(value: unknown): value is TrainingQuantityUnit {
  return (
    value === 'repetitions' ||
    value === 'sets' ||
    value === 'rounds' ||
    value === 'seconds' ||
    value === 'minutes'
  );
}

export function isValidTrainingQuantityValue(
  unit: TrainingQuantityUnit,
  value: unknown,
): value is number {
  if (unit === 'seconds' || unit === 'minutes') {
    return isValidDurationValue(value);
  }
  if (!isValidCount(value)) {
    return false;
  }
  return unit !== 'repetitions' || value <= MAX_REPETITIONS;
}

function isTrainingDuration(value: unknown): value is TrainingDuration {
  if (!isRecord(value) || !isDurationUnit(value['unit'])) {
    return false;
  }

  const keys = new Set(Object.keys(value));
  if (
    keys.size === 2 &&
    keys.has('unit') &&
    keys.has('value') &&
    isValidDurationValue(value['value'])
  ) {
    return true;
  }

  return (
    keys.size === 3 &&
    keys.has('unit') &&
    keys.has('min') &&
    keys.has('max') &&
    isValidDurationValue(value['min']) &&
    isValidDurationValue(value['max']) &&
    value['min'] <= value['max']
  );
}

export function isValidTrainingQuantities(value: unknown): value is TrainingQuantities {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value);
  if (
    keys.length === 0 ||
    !hasOnlyProperties(value, new Set(['repetitions', 'sets', 'rounds', 'duration']))
  ) {
    return false;
  }

  for (const property of ['repetitions', 'sets', 'rounds'] as const) {
    if (Object.hasOwn(value, property) && !isValidCount(value[property])) {
      return false;
    }
  }

  return !Object.hasOwn(value, 'duration') || isTrainingDuration(value['duration']);
}

export function validateRepetitionCount(value: unknown, path = 'reps'): ValidationResult<number> {
  return isValidRepetitionCount(value)
    ? { success: true, value }
    : {
        success: false,
        issues: [
          {
            path,
            message: `must be an integer from ${MIN_REPETITIONS} through ${MAX_REPETITIONS}`,
          },
        ],
      };
}

export const validateReps = validateRepetitionCount;

export function assertValidRepetitionCount(value: unknown, path = 'reps'): asserts value is number {
  if (!isValidRepetitionCount(value)) {
    throw new TrainingValidationError([
      {
        path,
        message: `must be an integer from ${MIN_REPETITIONS} through ${MAX_REPETITIONS}`,
      },
    ]);
  }
}

function isDrillCategory(value: unknown): value is DrillCategory {
  return (
    value === 'kihon' ||
    value === 'kirikaeshi' ||
    value === 'uchikomi' ||
    value === 'kakari' ||
    value === 'jigeiko' ||
    value === 'mixed' ||
    value === 'unspecified' ||
    value === 'intense-drill' ||
    value === 'high-intensity-drill' ||
    value === 'custom'
  );
}

function validateOptionalText(
  value: Readonly<Record<string, unknown>>,
  property: 'description' | 'notes',
  path: string,
  issues: ValidationIssue[],
): void {
  if (Object.hasOwn(value, property) && typeof value[property] !== 'string') {
    pushIssue(issues, path, 'must be a string when provided');
  }
}

function validateOptionalQuantities(
  value: Readonly<Record<string, unknown>>,
  path: string,
  issues: ValidationIssue[],
): void {
  if (Object.hasOwn(value, 'quantities') && !isValidTrainingQuantities(value['quantities'])) {
    pushIssue(
      issues,
      path,
      'must be a nonempty sparse quantity object with valid counts and duration',
    );
  }
}

function validateActivityId(
  id: unknown,
  path: string,
  issues: ValidationIssue[],
  seenIds: Set<string>,
): void {
  if (!isNonBlankString(id)) {
    pushIssue(issues, path, 'must be a nonblank string');
  } else if (seenIds.has(id)) {
    pushIssue(issues, path, 'must be unique');
  } else {
    seenIds.add(id);
  }
}

function validateTrainingExercise(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  seenIds: Set<string>,
): value is TrainingExercise {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'must be an object');
    return false;
  }
  if (!hasOnlyProperties(value, new Set(['id', 'name', 'quantities', 'notes']))) {
    pushIssue(issues, path, 'contains unsupported properties');
  }

  validateActivityId(value['id'], `${path}.id`, issues, seenIds);
  if (!isNonBlankString(value['name'])) {
    pushIssue(issues, `${path}.name`, 'must be a nonblank string');
  }
  validateOptionalQuantities(value, `${path}.quantities`, issues);
  validateOptionalText(value, 'notes', `${path}.notes`, issues);
  return true;
}

function validateTrainingSection(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  seenIds: Set<string>,
): value is TrainingSection {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'must be an object');
    return false;
  }
  if (!hasOnlyProperties(value, new Set(['id', 'name', 'quantities', 'notes', 'exercises']))) {
    pushIssue(issues, path, 'contains unsupported properties');
  }

  validateActivityId(value['id'], `${path}.id`, issues, seenIds);
  if (!isNonBlankString(value['name'])) {
    pushIssue(issues, `${path}.name`, 'must be a nonblank string');
  }
  validateOptionalQuantities(value, `${path}.quantities`, issues);
  validateOptionalText(value, 'notes', `${path}.notes`, issues);

  const exercises = value['exercises'];
  if (!Array.isArray(exercises)) {
    pushIssue(issues, `${path}.exercises`, 'must be an array');
    return false;
  }
  exercises.forEach((exercise, index) => {
    validateTrainingExercise(exercise, `${path}.exercises[${index}]`, issues, seenIds);
  });
  return true;
}

function validateTrainingSections(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  seenIds: Set<string>,
): value is readonly TrainingSection[] {
  if (!Array.isArray(value) || value.length < 1) {
    pushIssue(issues, path, 'must contain at least one section');
    return false;
  }
  value.forEach((section, index) => {
    validateTrainingSection(section, `${path}[${index}]`, issues, seenIds);
  });
  return true;
}

export function validateTrainingSet(value: unknown): ValidationResult<TrainingSet> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return { success: false, issues: [{ path: '', message: 'must be an object' }] };
  }
  if (
    !hasOnlyProperties(
      value,
      new Set(['id', 'sourceId', 'name', 'description', 'category', 'sections', 'isBuiltIn']),
    )
  ) {
    pushIssue(issues, '', 'contains unsupported properties');
  }

  const id = value['id'];
  const sourceId = value['sourceId'];
  const name = value['name'];
  const category = value['category'];
  const isBuiltIn = value['isBuiltIn'];
  const seenIds = new Set<string>();

  validateActivityId(id, 'id', issues, seenIds);
  if (Object.hasOwn(value, 'sourceId') && !isValidCount(sourceId)) {
    pushIssue(issues, 'sourceId', 'must be a nonnegative safe integer when provided');
  }
  if (!isNonBlankString(name)) {
    pushIssue(issues, 'name', 'must be a nonblank string');
  }
  validateOptionalText(value, 'description', 'description', issues);
  if (!isDrillCategory(category)) {
    pushIssue(issues, 'category', 'must be a supported category');
  }
  if (typeof isBuiltIn !== 'boolean') {
    pushIssue(issues, 'isBuiltIn', 'must be a boolean');
  }
  if (isBuiltIn === false && category !== 'custom') {
    pushIssue(issues, 'category', 'custom sets must use the custom category');
  }
  const sections = value['sections'];
  const sectionsAreValid = validateTrainingSections(sections, 'sections', issues, seenIds);

  if (
    issues.length > 0 ||
    !isNonBlankString(id) ||
    (Object.hasOwn(value, 'sourceId') && !isValidCount(sourceId)) ||
    !isNonBlankString(name) ||
    !isDrillCategory(category) ||
    typeof isBuiltIn !== 'boolean' ||
    !sectionsAreValid
  ) {
    return {
      success: false,
      issues: issues.length > 0 ? issues : [{ path: '', message: 'contains invalid fields' }],
    };
  }

  const trainingSet: TrainingSet = {
    id: asTrainingSetId(id),
    ...(isValidCount(sourceId) ? { sourceId } : {}),
    name,
    ...(typeof value['description'] === 'string' ? { description: value['description'] } : {}),
    category,
    sections,
    isBuiltIn,
  };
  return { success: true, value: trainingSet };
}

function validateTrainingExerciseInput(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is TrainingExerciseInput {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'must be an object');
    return false;
  }
  if (!hasOnlyProperties(value, new Set(['name', 'quantities', 'notes']))) {
    pushIssue(issues, path, 'contains unsupported properties');
  }
  if (!isNonBlankString(value['name'])) {
    pushIssue(issues, `${path}.name`, 'must be a nonblank string');
  }
  validateOptionalQuantities(value, `${path}.quantities`, issues);
  if (
    isRecord(value['quantities']) &&
    Object.hasOwn(value['quantities'], 'repetitions') &&
    !isValidRepetitionCount(value['quantities']['repetitions'])
  ) {
    pushIssue(
      issues,
      `${path}.quantities.repetitions`,
      `must be an integer from ${MIN_REPETITIONS} through ${MAX_REPETITIONS}`,
    );
  }
  validateOptionalText(value, 'notes', `${path}.notes`, issues);
  return true;
}

function validateTrainingSectionInput(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is TrainingSectionInput {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'must be an object');
    return false;
  }
  if (!hasOnlyProperties(value, new Set(['name', 'quantities', 'notes', 'exercises']))) {
    pushIssue(issues, path, 'contains unsupported properties');
  }
  if (!isNonBlankString(value['name'])) {
    pushIssue(issues, `${path}.name`, 'must be a nonblank string');
  }
  validateOptionalQuantities(value, `${path}.quantities`, issues);
  validateOptionalText(value, 'notes', `${path}.notes`, issues);

  if (!Array.isArray(value['exercises'])) {
    pushIssue(issues, `${path}.exercises`, 'must be an array');
    return false;
  }
  value['exercises'].forEach((exercise, index) => {
    validateTrainingExerciseInput(exercise, `${path}.exercises[${index}]`, issues);
  });
  return true;
}

export function validateTrainingSetInput(value: unknown): ValidationResult<TrainingSetInput> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return { success: false, issues: [{ path: '', message: 'must be an object' }] };
  }
  if (!hasOnlyProperties(value, new Set(['name', 'description', 'category', 'sections']))) {
    pushIssue(issues, '', 'contains unsupported properties');
  }

  const name = value['name'];
  const category = value['category'];
  const sections = value['sections'];

  if (!isNonBlankString(name)) {
    pushIssue(issues, 'name', 'must be a nonblank string');
  }
  validateOptionalText(value, 'description', 'description', issues);
  if (category !== 'custom') {
    pushIssue(issues, 'category', 'custom sets must use the custom category');
  }
  if (!Array.isArray(sections) || sections.length < 1) {
    pushIssue(issues, 'sections', 'must contain at least one section');
  } else {
    sections.forEach((section, index) => {
      validateTrainingSectionInput(section, `sections[${index}]`, issues);
    });
  }

  if (
    issues.length > 0 ||
    !isNonBlankString(name) ||
    category !== 'custom' ||
    !Array.isArray(sections)
  ) {
    return {
      success: false,
      issues: issues.length > 0 ? issues : [{ path: '', message: 'contains invalid fields' }],
    };
  }

  const input: TrainingSetInput = {
    name,
    ...(typeof value['description'] === 'string' ? { description: value['description'] } : {}),
    category,
    sections: sections.filter(
      (section): section is TrainingSectionInput =>
        isRecord(section) &&
        isNonBlankString(section['name']) &&
        Array.isArray(section['exercises']),
    ),
  };
  return { success: true, value: input };
}

export function validateCuratedDrills(value: unknown): ValidationResult<readonly CuratedDrill[]> {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(value)) {
    return { success: false, issues: [{ path: '', message: 'must be an array' }] };
  }
  if (value.length !== RESEARCHED_DRILL_COUNT) {
    pushIssue(issues, '', `must contain exactly ${RESEARCHED_DRILL_COUNT} researched drills`);
  }

  const seenIds = new Set<string>();
  const seenSourceIds = new Set<number>();
  const drills: CuratedDrill[] = [];
  value.forEach((item, drillIndex) => {
    const path = `[${drillIndex}]`;
    if (!isRecord(item)) {
      pushIssue(issues, path, 'must be an object');
      return;
    }
    if (!hasOnlyProperties(item, new Set(['id', 'sourceId', 'name', 'description', 'sections']))) {
      pushIssue(issues, path, 'contains unsupported properties');
    }

    const id = item['id'];
    const sourceId = item['sourceId'];
    const name = item['name'];
    validateActivityId(id, `${path}.id`, issues, seenIds);
    if (Object.hasOwn(item, 'sourceId')) {
      if (!isValidCount(sourceId)) {
        pushIssue(issues, `${path}.sourceId`, 'must be a nonnegative safe integer');
      } else if (seenSourceIds.has(sourceId)) {
        pushIssue(issues, `${path}.sourceId`, 'must be unique');
      } else {
        seenSourceIds.add(sourceId);
      }
    }
    if (!isNonBlankString(name)) {
      pushIssue(issues, `${path}.name`, 'must be a nonblank string');
    }
    validateOptionalText(item, 'description', `${path}.description`, issues);
    const sections = item['sections'];
    const sectionsAreValid = validateTrainingSections(
      sections,
      `${path}.sections`,
      issues,
      seenIds,
    );

    if (
      isNonBlankString(id) &&
      (sourceId === undefined || isValidCount(sourceId)) &&
      isNonBlankString(name) &&
      sectionsAreValid
    ) {
      drills.push({
        id,
        ...(isValidCount(sourceId) ? { sourceId } : {}),
        name,
        ...(typeof item['description'] === 'string' ? { description: item['description'] } : {}),
        sections,
      });
    }
  });

  const sectionCount = drills.flatMap((drill) => drill.sections).length;
  if (drills.length === RESEARCHED_DRILL_COUNT && sectionCount !== RESEARCHED_SECTION_COUNT) {
    pushIssue(issues, '', `must contain exactly ${RESEARCHED_SECTION_COUNT} researched sections`);
  }
  const activityCount = drills.reduce(
    (total, drill) => total + getTrainingSetActivityCount(drill),
    0,
  );
  if (drills.length === RESEARCHED_DRILL_COUNT && activityCount !== RESEARCHED_ACTIVITY_COUNT) {
    pushIssue(
      issues,
      '',
      `must contain exactly ${RESEARCHED_ACTIVITY_COUNT} researched activities`,
    );
  }

  return issues.length > 0 ? { success: false, issues } : { success: true, value: drills };
}

export function assertValidTrainingSetInput(value: unknown): asserts value is TrainingSetInput {
  const result = validateTrainingSetInput(value);
  if (!result.success) {
    throw new TrainingValidationError(result.issues);
  }
}

export function assertValidTrainingSet(value: unknown): asserts value is TrainingSet {
  const result = validateTrainingSet(value);
  if (!result.success) {
    throw new TrainingValidationError(result.issues);
  }
}

export function getTrainingSectionActivities(
  section: TrainingSection,
): readonly TrainingActivity[] {
  return section.exercises.length === 0 || section.quantities !== undefined
    ? [section, ...section.exercises]
    : section.exercises;
}

export function getTrainingSetActivities(
  trainingSet: Pick<TrainingSet, 'sections'> | Pick<CuratedDrill, 'sections'>,
): readonly TrainingActivity[] {
  return trainingSet.sections.flatMap(getTrainingSectionActivities);
}

export function getTrainingSetActivityCount(
  trainingSet: Pick<TrainingSet, 'sections'> | Pick<CuratedDrill, 'sections'>,
): number {
  return trainingSet.sections.reduce(
    (total, section) => total + getTrainingSectionActivities(section).length,
    0,
  );
}

export function getDefaultTrainingQuantity(
  activity: TrainingActivity,
  unit: TrainingQuantityUnit,
): TrainingQuantityValue | undefined {
  const quantities = activity.quantities;
  if (quantities === undefined) {
    return undefined;
  }

  if (unit === 'repetitions' || unit === 'sets' || unit === 'rounds') {
    return quantities[unit];
  }
  if (quantities.duration === undefined || quantities.duration.unit !== unit) {
    return undefined;
  }
  return 'value' in quantities.duration
    ? quantities.duration.value
    : { min: quantities.duration.min, max: quantities.duration.max };
}

export function getDefaultTrainingQuantityUnits(
  activity: TrainingActivity,
): readonly TrainingQuantityUnit[] {
  const quantities = activity.quantities;
  if (quantities === undefined) {
    return [];
  }

  const units: TrainingQuantityUnit[] = [];
  for (const unit of ['repetitions', 'sets', 'rounds'] as const) {
    if (quantities[unit] !== undefined) {
      units.push(unit);
    }
  }
  if (quantities.duration !== undefined) {
    units.push(quantities.duration.unit);
  }
  return units;
}

export function getEffectiveTrainingQuantity(
  activity: TrainingActivity,
  overrides: TrainingQuantityOverrides | undefined,
  unit: TrainingQuantityUnit,
): TrainingQuantityValue | undefined {
  const override = overrides?.[unit];
  return override === undefined ? getDefaultTrainingQuantity(activity, unit) : override;
}

export function asTrainingSetId(value: string): TrainingSetId {
  return value as TrainingSetId;
}
