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

/** Optional intensity metadata for a user-authored training set. */
export type CustomTrainingIntensity = Extract<
  DrillCategory,
  'intense-drill' | 'high-intensity-drill'
>;

/** Filterable tags exposed by a training set. */
export type TrainingSetTag = 'custom' | CustomTrainingIntensity;

export const CUSTOM_TRAINING_INTENSITIES = [
  'intense-drill',
  'high-intensity-drill',
] as const satisfies readonly CustomTrainingIntensity[];

export const TRAINING_QUANTITY_UNITS = [
  'repetitions',
  'sets',
  'rounds',
  'seconds',
  'minutes',
] as const;

export const DURATION_UNITS = ['seconds', 'minutes'] as const;

/**
 * Generous bounds for untrusted authored and persisted training data. The current curated
 * maxima are depth 3, 14 sections, 9 children, 45 activities, 73-character ids, and a
 * 330-character description; these ceilings leave ample normal and migration headroom while
 * bounding local-storage work.
 */
export const TRAINING_DATA_LIMITS = {
  dashboardEntries: 128,
  legacyCustomSetCollection: 128,
  customSections: 64,
  exercisesPerSection: 128,
  totalActivitiesPerTrainingSet: 512,
  activityNestingDepth: 8,
  identifierCharacters: 256,
  nameCharacters: 200,
  descriptionCharacters: 4_000,
  noteCharacters: 8_000,
  dashboardRecordEntries: 512,
  timestampCharacters: 64,
} as const;

export type TrainingQuantityUnit = (typeof TRAINING_QUANTITY_UNITS)[number];
export type DurationUnit = (typeof DURATION_UNITS)[number];

/** A validated, nonempty ordered collection of units an activity may expose for editing. */
export type TrainingQuantityUnits = readonly [TrainingQuantityUnit, ...TrainingQuantityUnit[]];

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

/** Practitioner-entered notes keyed by the stable activity id within one dashboard entry. */
export type DashboardActivityNotes = Readonly<Record<string, string>>;

/**
 * The canonical recursive runtime node. Every activity owns an ordered child collection;
 * an empty collection makes the activity a leaf exercise.
 */
export interface TrainingActivity {
  readonly id: string;
  readonly name: string;
  readonly quantities?: TrainingQuantities;
  readonly notes?: string;
  readonly children: readonly TrainingActivity[];
  readonly editableQuantityUnits?: TrainingQuantityUnits;
  readonly allowsSessionNotes?: true;
}

/**
 * Source-only recursive activity DTO. Curated JSON calls child activities `exercises` and
 * requires that property only on top-level sections.
 */
export interface CuratedActivity {
  readonly id: string;
  readonly name: string;
  readonly quantities?: TrainingQuantities;
  readonly notes?: string;
  readonly exercises?: readonly CuratedActivity[];
  readonly editableQuantityUnits?: TrainingQuantityUnits;
  readonly allowsSessionNotes?: true;
}

/** Source-only top-level curated activity DTO, where `exercises` remains required. */
export interface CuratedSection extends CuratedActivity {
  readonly exercises: readonly CuratedActivity[];
}

/**
 * Legacy source DTO names retained for callers that consume curated `sections`/`exercises`.
 * They are not runtime training-set node types; use `TrainingActivity` for runtime values.
 */
export type TrainingExercise = CuratedActivity;
export type TrainingSection = CuratedSection;

export interface TrainingSet {
  readonly id: TrainingSetId;
  readonly sourceId?: number;
  readonly name: string;
  readonly description?: string;
  readonly category: DrillCategory;
  readonly customIntensity?: CustomTrainingIntensity;
  readonly activities: readonly TrainingActivity[];
  readonly isBuiltIn: boolean;
}

export interface CuratedDrill {
  readonly id: string;
  readonly sourceId?: number;
  readonly name: string;
  readonly description?: string;
  readonly sections: readonly CuratedSection[];
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
  readonly customIntensity?: CustomTrainingIntensity;
  readonly sections: readonly TrainingSectionInput[];
}

export type CustomTrainingExerciseInput = TrainingExerciseInput;
export type CustomTrainingSectionInput = TrainingSectionInput;
export type CustomTrainingSetInput = TrainingSetInput;

export interface DashboardEntry {
  readonly id: string;
  readonly trainingSetId: TrainingSetId;
  /** Dashboard-owned snapshot; absent only for unknown legacy entries. */
  readonly trainingSet?: TrainingSet;
  readonly quantityOverrides: DashboardQuantityOverrides;
  readonly activityNotes: DashboardActivityNotes;
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

/** Canonical curated collection counts, asserted at the default-data adapter seam. */
export const RESEARCHED_TRAINING_SESSION_COUNT = 11;
export const RESEARCHED_TOP_LEVEL_ACTIVITY_COUNT = 88;
export const RESEARCHED_ACTIVITY_COUNT = 257;
export const RESEARCHED_LEAF_EXERCISE_COUNT = 211;
export const RESEARCHED_ID_COUNT = 268;

/** Compatibility aliases for callers that still use the source DTO terminology. */
export const RESEARCHED_DRILL_COUNT = RESEARCHED_TRAINING_SESSION_COUNT;
export const RESEARCHED_SECTION_COUNT = RESEARCHED_TOP_LEVEL_ACTIVITY_COUNT;
export const RESEARCHED_TOP_LEVEL_SECTION_COUNT = RESEARCHED_TOP_LEVEL_ACTIVITY_COUNT;
export const RESEARCHED_LEAF_ACTIVITY_COUNT = RESEARCHED_LEAF_EXERCISE_COUNT;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length <= maximumLength;
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

export function isValidEditableQuantityUnits(value: unknown): value is TrainingQuantityUnits {
  if (!isUnknownArray(value) || value.length < 1) {
    return false;
  }

  const seenUnits = new Set<TrainingQuantityUnit>();
  for (const unit of value) {
    if (!isTrainingQuantityUnit(unit) || seenUnits.has(unit)) {
      return false;
    }
    seenUnits.add(unit);
  }
  return true;
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

export function isCustomTrainingIntensity(value: unknown): value is CustomTrainingIntensity {
  return value === 'intense-drill' || value === 'high-intensity-drill';
}

function validateOptionalText(
  value: Readonly<Record<string, unknown>>,
  property: 'description' | 'notes',
  path: string,
  issues: ValidationIssue[],
): void {
  if (!Object.hasOwn(value, property)) {
    return;
  }
  const candidate = value[property];
  if (typeof candidate !== 'string') {
    pushIssue(issues, path, 'must be a string when provided');
    return;
  }
  const maximumLength =
    property === 'description'
      ? TRAINING_DATA_LIMITS.descriptionCharacters
      : TRAINING_DATA_LIMITS.noteCharacters;
  if (!isBoundedString(candidate, maximumLength)) {
    pushIssue(issues, path, `must be no more than ${maximumLength} characters`);
  }
}

function validateName(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isNonBlankString(value)) {
    pushIssue(issues, path, 'must be a nonblank string');
  } else if (!isBoundedString(value, TRAINING_DATA_LIMITS.nameCharacters)) {
    pushIssue(
      issues,
      path,
      `must be no more than ${TRAINING_DATA_LIMITS.nameCharacters} characters`,
    );
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

function validateOptionalActivityMetadata(
  value: Readonly<Record<string, unknown>>,
  path: string,
  issues: ValidationIssue[],
): void {
  if (
    Object.hasOwn(value, 'editableQuantityUnits') &&
    !isValidEditableQuantityUnits(value['editableQuantityUnits'])
  ) {
    pushIssue(
      issues,
      `${path}.editableQuantityUnits`,
      'must be a nonempty array of unique supported quantity units',
    );
  }
  if (Object.hasOwn(value, 'allowsSessionNotes') && value['allowsSessionNotes'] !== true) {
    pushIssue(issues, `${path}.allowsSessionNotes`, 'must be true when provided');
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
  } else if (!isBoundedString(id, TRAINING_DATA_LIMITS.identifierCharacters)) {
    pushIssue(
      issues,
      path,
      `must be no more than ${TRAINING_DATA_LIMITS.identifierCharacters} characters`,
    );
  } else if (seenIds.has(id)) {
    pushIssue(issues, path, 'must be unique');
  } else {
    seenIds.add(id);
  }
}

const CANONICAL_ACTIVITY_PROPERTIES = new Set([
  'id',
  'name',
  'quantities',
  'notes',
  'children',
  'editableQuantityUnits',
  'allowsSessionNotes',
]);

const CURATED_ACTIVITY_PROPERTIES = new Set([
  'id',
  'name',
  'quantities',
  'notes',
  'exercises',
  'editableQuantityUnits',
  'allowsSessionNotes',
]);

interface ActivityValidationBudget {
  count: number;
  exceeded: boolean;
}

function validateTrainingActivity(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  seenIds: Set<string>,
  ancestors: Set<object>,
  depth: number,
  budget: ActivityValidationBudget,
): value is TrainingActivity {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'must be an object');
    return false;
  }
  if (depth > TRAINING_DATA_LIMITS.activityNestingDepth) {
    pushIssue(
      issues,
      path,
      `must not exceed ${TRAINING_DATA_LIMITS.activityNestingDepth} activity levels`,
    );
    return false;
  }
  if (budget.count >= TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet) {
    budget.exceeded = true;
    pushIssue(
      issues,
      path,
      `must contain no more than ${TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet} activities`,
    );
    return false;
  }
  budget.count += 1;
  if (ancestors.has(value)) {
    pushIssue(issues, path, 'must not contain cyclic children');
    return false;
  }
  ancestors.add(value);

  if (!hasOnlyProperties(value, CANONICAL_ACTIVITY_PROPERTIES)) {
    pushIssue(issues, path, 'contains unsupported properties');
  }
  validateActivityId(value['id'], `${path}.id`, issues, seenIds);
  validateName(value['name'], `${path}.name`, issues);
  validateOptionalQuantities(value, `${path}.quantities`, issues);
  validateOptionalText(value, 'notes', `${path}.notes`, issues);
  validateOptionalActivityMetadata(value, path, issues);

  const children = value['children'];
  if (!Array.isArray(children)) {
    pushIssue(issues, `${path}.children`, 'must be an array');
    ancestors.delete(value);
    return false;
  }
  if (children.length > TRAINING_DATA_LIMITS.exercisesPerSection) {
    pushIssue(
      issues,
      `${path}.children`,
      `must contain no more than ${TRAINING_DATA_LIMITS.exercisesPerSection} activities`,
    );
    ancestors.delete(value);
    return false;
  }
  for (let index = 0; index < children.length; index += 1) {
    if (budget.exceeded) {
      break;
    }
    validateTrainingActivity(
      children[index],
      `${path}.children[${index}]`,
      issues,
      seenIds,
      ancestors,
      depth + 1,
      budget,
    );
  }
  ancestors.delete(value);
  return true;
}

function validateTrainingActivities(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  seenIds: Set<string>,
): value is readonly TrainingActivity[] {
  if (!isUnknownArray(value) || value.length < 1) {
    pushIssue(issues, path, 'must contain at least one activity');
    return false;
  }
  if (value.length > TRAINING_DATA_LIMITS.customSections) {
    pushIssue(
      issues,
      path,
      `must contain no more than ${TRAINING_DATA_LIMITS.customSections} activities`,
    );
    return false;
  }
  const ancestors = new Set<object>();
  const budget: ActivityValidationBudget = { count: 0, exceeded: false };
  for (let index = 0; index < value.length; index += 1) {
    if (budget.exceeded) {
      break;
    }
    validateTrainingActivity(
      value[index],
      `${path}[${index}]`,
      issues,
      seenIds,
      ancestors,
      1,
      budget,
    );
  }
  return true;
}

function cloneTrainingDuration(duration: TrainingDuration): TrainingDuration {
  return Object.freeze(
    'value' in duration
      ? { unit: duration.unit, value: duration.value }
      : { unit: duration.unit, min: duration.min, max: duration.max },
  );
}

function cloneTrainingQuantities(quantities: TrainingQuantities): TrainingQuantities {
  return Object.freeze({
    ...(quantities.repetitions === undefined ? {} : { repetitions: quantities.repetitions }),
    ...(quantities.sets === undefined ? {} : { sets: quantities.sets }),
    ...(quantities.rounds === undefined ? {} : { rounds: quantities.rounds }),
    ...(quantities.duration === undefined
      ? {}
      : { duration: cloneTrainingDuration(quantities.duration) }),
  });
}

function cloneEditableQuantityUnits(units: TrainingQuantityUnits): TrainingQuantityUnits {
  const copy: [TrainingQuantityUnit, ...TrainingQuantityUnit[]] = [units[0], ...units.slice(1)];
  return Object.freeze(copy);
}

function cloneCanonicalActivity(value: unknown): TrainingActivity {
  if (!isRecord(value)) {
    throw new Error('Validated training activity is not an object.');
  }
  const id = value['id'];
  const name = value['name'];
  const childrenValue = value['children'];
  if (!isNonBlankString(id) || !isNonBlankString(name) || !Array.isArray(childrenValue)) {
    throw new Error('Validated training activity contains invalid required fields.');
  }

  const quantitiesValue = value['quantities'];
  const editableUnitsValue = value['editableQuantityUnits'];
  const children = Object.freeze(childrenValue.map(cloneCanonicalActivity));
  return Object.freeze({
    id,
    name,
    ...(isValidTrainingQuantities(quantitiesValue)
      ? { quantities: cloneTrainingQuantities(quantitiesValue) }
      : {}),
    ...(typeof value['notes'] === 'string' ? { notes: value['notes'] } : {}),
    children,
    ...(isValidEditableQuantityUnits(editableUnitsValue)
      ? { editableQuantityUnits: cloneEditableQuantityUnits(editableUnitsValue) }
      : {}),
    ...(value['allowsSessionNotes'] === true ? { allowsSessionNotes: true as const } : {}),
  });
}

function cloneCanonicalTrainingSet(
  value: Readonly<Record<string, unknown>>,
  id: string,
  sourceId: number | undefined,
  name: string,
  category: DrillCategory,
  customIntensity: CustomTrainingIntensity | undefined,
  isBuiltIn: boolean,
): TrainingSet {
  const activitiesValue = value['activities'];
  if (!Array.isArray(activitiesValue)) {
    throw new Error('Validated training set activities are not an array.');
  }
  const activities = Object.freeze(activitiesValue.map(cloneCanonicalActivity));
  return Object.freeze({
    id: asTrainingSetId(id),
    ...(sourceId === undefined ? {} : { sourceId }),
    name,
    ...(typeof value['description'] === 'string' ? { description: value['description'] } : {}),
    category,
    ...(customIntensity === undefined ? {} : { customIntensity }),
    activities,
    isBuiltIn,
  });
}

function validateTrainingSetUnchecked(value: unknown): ValidationResult<TrainingSet> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return { success: false, issues: [{ path: '', message: 'must be an object' }] };
  }
  if (
    !hasOnlyProperties(
      value,
      new Set([
        'id',
        'sourceId',
        'name',
        'description',
        'category',
        'customIntensity',
        'activities',
        'isBuiltIn',
      ]),
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
  validateName(name, 'name', issues);
  validateOptionalText(value, 'description', 'description', issues);
  if (!isDrillCategory(category)) {
    pushIssue(issues, 'category', 'must be a supported category');
  }
  if (typeof isBuiltIn !== 'boolean') {
    pushIssue(issues, 'isBuiltIn', 'must be a boolean');
  }
  if (
    Object.hasOwn(value, 'customIntensity') &&
    !isCustomTrainingIntensity(value['customIntensity'])
  ) {
    pushIssue(issues, 'customIntensity', 'must be a supported custom intensity when provided');
  }
  if (isBuiltIn === false && category !== 'custom') {
    pushIssue(issues, 'category', 'custom sets must use the custom category');
  }
  if (isBuiltIn === true && Object.hasOwn(value, 'customIntensity')) {
    pushIssue(issues, 'customIntensity', 'built-in sets cannot define custom intensity metadata');
  }
  if (category !== 'custom' && Object.hasOwn(value, 'customIntensity')) {
    pushIssue(issues, 'customIntensity', 'only custom sets can define custom intensity metadata');
  }
  const activitiesAreValid = validateTrainingActivities(
    value['activities'],
    'activities',
    issues,
    seenIds,
  );

  if (
    issues.length > 0 ||
    !isNonBlankString(id) ||
    (Object.hasOwn(value, 'sourceId') && !isValidCount(sourceId)) ||
    !isNonBlankString(name) ||
    !isDrillCategory(category) ||
    (Object.hasOwn(value, 'customIntensity') &&
      !isCustomTrainingIntensity(value['customIntensity'])) ||
    typeof isBuiltIn !== 'boolean' ||
    !activitiesAreValid
  ) {
    return {
      success: false,
      issues: issues.length > 0 ? issues : [{ path: '', message: 'contains invalid fields' }],
    };
  }

  return {
    success: true,
    value: cloneCanonicalTrainingSet(
      value,
      id,
      isValidCount(sourceId) ? sourceId : undefined,
      name,
      category,
      isCustomTrainingIntensity(value['customIntensity']) ? value['customIntensity'] : undefined,
      isBuiltIn,
    ),
  };
}

/** Validate an untrusted canonical runtime training set without leaking hostile getter errors. */
export function validateTrainingSet(value: unknown): ValidationResult<TrainingSet> {
  try {
    return validateTrainingSetUnchecked(value);
  } catch {
    return {
      success: false,
      issues: [{ path: '', message: 'could not be inspected safely' }],
    };
  }
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
  validateName(value['name'], `${path}.name`, issues);
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
  validateName(value['name'], `${path}.name`, issues);
  validateOptionalQuantities(value, `${path}.quantities`, issues);
  validateOptionalText(value, 'notes', `${path}.notes`, issues);

  if (!Array.isArray(value['exercises'])) {
    pushIssue(issues, `${path}.exercises`, 'must be an array');
    return false;
  }
  if (value['exercises'].length > TRAINING_DATA_LIMITS.exercisesPerSection) {
    pushIssue(
      issues,
      `${path}.exercises`,
      `must contain no more than ${TRAINING_DATA_LIMITS.exercisesPerSection} exercises`,
    );
    return false;
  }
  for (let index = 0; index < value['exercises'].length; index += 1) {
    validateTrainingExerciseInput(value['exercises'][index], `${path}.exercises[${index}]`, issues);
  }
  return true;
}

function validateTrainingSetInputUnchecked(value: unknown): ValidationResult<TrainingSetInput> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return { success: false, issues: [{ path: '', message: 'must be an object' }] };
  }
  if (
    !hasOnlyProperties(
      value,
      new Set(['name', 'description', 'category', 'customIntensity', 'sections']),
    )
  ) {
    pushIssue(issues, '', 'contains unsupported properties');
  }

  const name = value['name'];
  const category = value['category'];
  const sections = value['sections'];

  validateName(name, 'name', issues);
  validateOptionalText(value, 'description', 'description', issues);
  if (category !== 'custom') {
    pushIssue(issues, 'category', 'custom sets must use the custom category');
  }
  if (
    Object.hasOwn(value, 'customIntensity') &&
    !isCustomTrainingIntensity(value['customIntensity'])
  ) {
    pushIssue(issues, 'customIntensity', 'must be a supported custom intensity when provided');
  }
  if (!Array.isArray(sections) || sections.length < 1) {
    pushIssue(issues, 'sections', 'must contain at least one section');
  } else if (sections.length > TRAINING_DATA_LIMITS.customSections) {
    pushIssue(
      issues,
      'sections',
      `must contain no more than ${TRAINING_DATA_LIMITS.customSections} sections`,
    );
  } else {
    let activityCount = 0;
    for (const section of sections) {
      activityCount += 1;
      if (isRecord(section) && Array.isArray(section['exercises'])) {
        activityCount += section['exercises'].length;
      }
    }
    if (activityCount > TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet) {
      pushIssue(
        issues,
        'sections',
        `must contain no more than ${TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet} activities`,
      );
    }
    if (activityCount <= TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet) {
      for (let index = 0; index < sections.length; index += 1) {
        validateTrainingSectionInput(sections[index], `sections[${index}]`, issues);
      }
    }
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
    ...(isCustomTrainingIntensity(value['customIntensity'])
      ? { customIntensity: value['customIntensity'] }
      : {}),
    sections: sections.filter(
      (section): section is TrainingSectionInput =>
        isRecord(section) &&
        isNonBlankString(section['name']) &&
        Array.isArray(section['exercises']),
    ),
  };
  return { success: true, value: input };
}

/** Validate user-authored builder input without leaking hostile getter/proxy errors. */
export function validateTrainingSetInput(value: unknown): ValidationResult<TrainingSetInput> {
  try {
    return validateTrainingSetInputUnchecked(value);
  } catch {
    return {
      success: false,
      issues: [{ path: '', message: 'could not be inspected safely' }],
    };
  }
}

function validateCuratedActivity(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  seenIds: Set<string>,
  requireExercises: boolean,
  ancestors: Set<object>,
  depth: number,
  budget: ActivityValidationBudget,
): value is CuratedActivity {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'must be an object');
    return false;
  }
  if (depth > TRAINING_DATA_LIMITS.activityNestingDepth) {
    pushIssue(
      issues,
      path,
      `must not exceed ${TRAINING_DATA_LIMITS.activityNestingDepth} activity levels`,
    );
    return false;
  }
  if (budget.count >= TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet) {
    budget.exceeded = true;
    pushIssue(
      issues,
      path,
      `must contain no more than ${TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet} activities`,
    );
    return false;
  }
  budget.count += 1;
  if (ancestors.has(value)) {
    pushIssue(issues, path, 'must not contain cyclic exercises');
    return false;
  }
  ancestors.add(value);
  if (!hasOnlyProperties(value, CURATED_ACTIVITY_PROPERTIES)) {
    pushIssue(issues, path, 'contains unsupported properties');
  }
  validateActivityId(value['id'], `${path}.id`, issues, seenIds);
  validateName(value['name'], `${path}.name`, issues);
  validateOptionalQuantities(value, `${path}.quantities`, issues);
  validateOptionalText(value, 'notes', `${path}.notes`, issues);
  validateOptionalActivityMetadata(value, path, issues);

  const hasExercises = Object.hasOwn(value, 'exercises');
  const exercises = value['exercises'];
  if (requireExercises && !hasExercises) {
    pushIssue(issues, `${path}.exercises`, 'must be an array');
    ancestors.delete(value);
    return false;
  }
  if (hasExercises && !Array.isArray(exercises)) {
    pushIssue(issues, `${path}.exercises`, 'must be an array when provided');
    ancestors.delete(value);
    return false;
  }
  if (Array.isArray(exercises) && exercises.length > TRAINING_DATA_LIMITS.exercisesPerSection) {
    pushIssue(
      issues,
      `${path}.exercises`,
      `must contain no more than ${TRAINING_DATA_LIMITS.exercisesPerSection} activities`,
    );
    ancestors.delete(value);
    return false;
  }
  if (Array.isArray(exercises)) {
    for (let index = 0; index < exercises.length; index += 1) {
      if (budget.exceeded) {
        break;
      }
      validateCuratedActivity(
        exercises[index],
        `${path}.exercises[${index}]`,
        issues,
        seenIds,
        false,
        ancestors,
        depth + 1,
        budget,
      );
    }
  }
  ancestors.delete(value);
  return true;
}

function validateCuratedSections(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  seenIds: Set<string>,
): value is readonly CuratedSection[] {
  if (!isUnknownArray(value) || value.length < 1) {
    pushIssue(issues, path, 'must contain at least one section');
    return false;
  }
  if (value.length > TRAINING_DATA_LIMITS.customSections) {
    pushIssue(
      issues,
      path,
      `must contain no more than ${TRAINING_DATA_LIMITS.customSections} sections`,
    );
    return false;
  }
  const ancestors = new Set<object>();
  const budget: ActivityValidationBudget = { count: 0, exceeded: false };
  for (let index = 0; index < value.length; index += 1) {
    if (budget.exceeded) {
      break;
    }
    validateCuratedActivity(
      value[index],
      `${path}[${index}]`,
      issues,
      seenIds,
      true,
      ancestors,
      1,
      budget,
    );
  }
  return true;
}

function validateCuratedDrillsUnchecked(value: unknown): ValidationResult<readonly CuratedDrill[]> {
  const issues: ValidationIssue[] = [];
  if (!isUnknownArray(value)) {
    return { success: false, issues: [{ path: '', message: 'must be an array' }] };
  }
  if (value.length < 1) {
    return { success: false, issues: [{ path: '', message: 'must contain at least one drill' }] };
  }

  const seenIds = new Set<string>();
  const seenSourceIds = new Set<number>();
  const drills: CuratedDrill[] = [];
  for (let drillIndex = 0; drillIndex < value.length; drillIndex += 1) {
    const item = value[drillIndex];
    const path = `[${drillIndex}]`;
    if (!isRecord(item)) {
      pushIssue(issues, path, 'must be an object');
      continue;
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
    validateName(name, `${path}.name`, issues);
    validateOptionalText(item, 'description', `${path}.description`, issues);
    const sectionsAreValid = validateCuratedSections(
      item['sections'],
      `${path}.sections`,
      issues,
      seenIds,
    );

    if (
      isNonBlankString(id) &&
      (!Object.hasOwn(item, 'sourceId') || isValidCount(sourceId)) &&
      isNonBlankString(name) &&
      sectionsAreValid
    ) {
      const sections = item['sections'];
      if (Array.isArray(sections)) {
        drills.push({
          id,
          ...(isValidCount(sourceId) ? { sourceId } : {}),
          name,
          ...(typeof item['description'] === 'string' ? { description: item['description'] } : {}),
          sections,
        });
      }
    }
  }

  return issues.length > 0 ? { success: false, issues } : { success: true, value: drills };
}

/** Validate curated source trees without leaking hostile getter/proxy errors. */
export function validateCuratedDrills(value: unknown): ValidationResult<readonly CuratedDrill[]> {
  try {
    return validateCuratedDrillsUnchecked(value);
  } catch {
    return {
      success: false,
      issues: [{ path: '', message: 'could not be inspected safely' }],
    };
  }
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

/** Return every canonical activity in stable depth-first pre-order. */
export function getTrainingSetActivities(
  trainingSet: Pick<TrainingSet, 'activities'>,
): readonly TrainingActivity[] {
  const result: TrainingActivity[] = [];
  const pending = [...trainingSet.activities].reverse();
  while (pending.length > 0) {
    const activity = pending.pop();
    if (activity === undefined) {
      continue;
    }
    result.push(activity);
    for (let index = activity.children.length - 1; index >= 0; index -= 1) {
      const child = activity.children[index];
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return result;
}

/** Count every canonical activity, including roots, parents, and leaf exercises. */
export function getTrainingSetActivityCount(trainingSet: Pick<TrainingSet, 'activities'>): number {
  return getTrainingSetActivities(trainingSet).length;
}

/** Count canonical leaf exercises, namely activities whose child collection is empty. */
export function getTrainingSetLeafExerciseCount(
  trainingSet: Pick<TrainingSet, 'activities'>,
): number {
  return getTrainingSetActivities(trainingSet).filter((activity) => activity.children.length === 0)
    .length;
}

/** Alias for callers that describe leaves as leaf activities rather than exercises. */
export const getTrainingSetLeafActivityCount = getTrainingSetLeafExerciseCount;

/** Return quantity units backed by explicit defaults, editable metadata, or existing overrides. */
export function getEditableTrainingQuantityUnits(
  activity: TrainingActivity,
  overrides?: TrainingQuantityOverrides,
): readonly TrainingQuantityUnit[] {
  const units: TrainingQuantityUnit[] = [];
  const addUnit = (unit: TrainingQuantityUnit): void => {
    if (!units.includes(unit)) {
      units.push(unit);
    }
  };
  for (const unit of getDefaultTrainingQuantityUnits(activity)) {
    addUnit(unit);
  }
  for (const unit of activity.editableQuantityUnits ?? []) {
    addUnit(unit);
  }
  for (const unit of TRAINING_QUANTITY_UNITS) {
    if (overrides !== undefined && Object.hasOwn(overrides, unit)) {
      addUnit(unit);
    }
  }
  return units;
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

/** Deep-clone a validated training set while preserving all stable ids and metadata. */
export function cloneTrainingSet(trainingSet: TrainingSet): TrainingSet {
  const result = validateTrainingSet(trainingSet);
  if (!result.success) {
    throw new TrainingValidationError(result.issues);
  }
  return result.value;
}

/** Return the filterable tags associated with a training set. */
export function getTrainingSetTags(
  trainingSet: Pick<TrainingSet, 'category' | 'customIntensity'>,
): readonly TrainingSetTag[] {
  if (trainingSet.category === 'custom') {
    return trainingSet.customIntensity === undefined
      ? ['custom']
      : ['custom', trainingSet.customIntensity];
  }
  return trainingSet.category === 'intense-drill' || trainingSet.category === 'high-intensity-drill'
    ? [trainingSet.category]
    : [];
}

/** Test whether a training set carries a filterable tag. */
export function trainingSetHasTag(
  trainingSet: Pick<TrainingSet, 'category' | 'customIntensity'>,
  tag: TrainingSetTag,
): boolean {
  return getTrainingSetTags(trainingSet).includes(tag);
}

export function asTrainingSetId(value: string): TrainingSetId {
  return value as TrainingSetId;
}
