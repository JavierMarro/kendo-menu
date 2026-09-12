import { DEFAULT_TRAINING_SETS } from './default-training-sets.js';
import {
  asTrainingSetId,
  getTrainingSetActivities,
  isCustomTrainingIntensity,
  isTrainingQuantityUnit,
  isValidTrainingQuantities,
  isValidTrainingQuantityValue,
  TRAINING_DATA_LIMITS,
  validateTrainingSet,
  type DashboardActivityNotes,
  type DashboardQuantityOverrides,
  type CustomTrainingIntensity,
  type TrainingActivity,
  type TrainingQuantities,
  type TrainingQuantityOverrides,
  type TrainingQuantityUnit,
  type TrainingSet,
} from './types.js';

/** A v10 custom exercise in the intentionally two-level persistence representation. */
export interface PersistedTrainingExercise {
  readonly id: string;
  readonly name: string;
  readonly quantities?: TrainingQuantities;
  readonly notes?: string;
}

/** A v10 custom section in the intentionally two-level persistence representation. */
export interface PersistedTrainingSection {
  readonly id: string;
  readonly name: string;
  readonly quantities?: TrainingQuantities;
  readonly notes?: string;
  readonly exercises: readonly PersistedTrainingExercise[];
}

/** A complete custom dashboard-owned snapshot in the v10 wire representation. */
export interface PersistedCustomTrainingSet {
  readonly id: string;
  readonly sourceId?: never;
  readonly name: string;
  readonly description?: string;
  readonly category: 'custom';
  readonly customIntensity?: CustomTrainingIntensity;
  readonly sections: readonly PersistedTrainingSection[];
  readonly isBuiltIn: false;
}

/** The platform-neutral v10 dashboard state exchanged by the cloud transport. */
export interface PersistedTrainingWireStateV10 {
  readonly dashboardEntries: readonly PersistedDashboardEntryV10[];
}

/** One dashboard entry in the v10 wire representation. */
export interface PersistedDashboardEntryV10 {
  readonly id: string;
  readonly trainingSetId: TrainingSet['id'];
  /** Present only for a custom dashboard-owned snapshot; built-ins are references by ID. */
  readonly trainingSet?: PersistedCustomTrainingSet;
  readonly quantityOverrides: DashboardQuantityOverrides;
  readonly activityNotes: DashboardActivityNotes;
  readonly notes: string;
  readonly createdAt: string;
}

const DASHBOARD_STATE_PROPERTIES = new Set(['dashboardEntries']);
const DASHBOARD_ENTRY_PROPERTIES = new Set([
  'id',
  'trainingSetId',
  'trainingSet',
  'quantityOverrides',
  'activityNotes',
  'notes',
  'createdAt',
]);
const CUSTOM_SET_PROPERTIES = new Set([
  'id',
  'name',
  'description',
  'category',
  'customIntensity',
  'sections',
  'isBuiltIn',
]);
const SECTION_PROPERTIES = new Set(['id', 'name', 'quantities', 'notes', 'exercises']);
const EXERCISE_PROPERTIES = new Set(['id', 'name', 'quantities', 'notes']);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function hasOwnProperties(
  value: Readonly<Record<string, unknown>>,
  properties: readonly string[],
): boolean {
  return properties.every((property) => Object.hasOwn(value, property));
}

function hasOnlyProperties(
  value: Readonly<Record<string, unknown>>,
  allowedProperties: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((property) => allowedProperties.has(property));
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length <= maximumLength;
}

function isNonBlankIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= TRAINING_DATA_LIMITS.identifierCharacters
  );
}

function isStrictNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0);
}

function hasStrictQuantityNumbers(value: TrainingQuantities): boolean {
  for (const property of ['repetitions', 'sets', 'rounds'] as const) {
    if (Object.hasOwn(value, property) && !isStrictNumber(value[property])) {
      return false;
    }
  }
  if (!Object.hasOwn(value, 'duration')) {
    return true;
  }
  const duration = value.duration;
  if (
    !isRecord(duration) ||
    (!isStrictNumber(duration['value']) && !isStrictNumber(duration['min']))
  ) {
    return false;
  }
  return !Object.hasOwn(duration, 'max') || isStrictNumber(duration['max']);
}

function cloneQuantities(value: TrainingQuantities): TrainingQuantities {
  const duration = value.duration;
  const clonedDuration =
    duration === undefined
      ? undefined
      : Object.freeze(
          'value' in duration
            ? { unit: duration.unit, value: duration.value }
            : { unit: duration.unit, min: duration.min, max: duration.max },
        );
  return Object.freeze({
    ...(value.repetitions === undefined ? {} : { repetitions: value.repetitions }),
    ...(value.sets === undefined ? {} : { sets: value.sets }),
    ...(value.rounds === undefined ? {} : { rounds: value.rounds }),
    ...(clonedDuration === undefined ? {} : { duration: clonedDuration }),
  });
}

function parseQuantities(value: unknown): TrainingQuantities | null {
  if (!isValidTrainingQuantities(value) || !hasStrictQuantityNumbers(value)) {
    return null;
  }
  return cloneQuantities(value);
}

function cloneQuantityOverrides(value: TrainingQuantityOverrides): TrainingQuantityOverrides {
  const entries: [TrainingQuantityUnit, number][] = [];
  for (const [unit, quantityValue] of Object.entries(value)) {
    if (isTrainingQuantityUnit(unit)) {
      entries.push([unit, quantityValue]);
    }
  }
  return Object.freeze(Object.fromEntries(entries));
}

function parseQuantityOverrides(value: unknown): TrainingQuantityOverrides | null {
  if (!isRecord(value) || Object.keys(value).length > TRAINING_DATA_LIMITS.dashboardRecordEntries) {
    return null;
  }
  const entries: [TrainingQuantityUnit, number][] = [];
  for (const [unit, quantityValue] of Object.entries(value)) {
    if (!isTrainingQuantityUnit(unit) || !isValidTrainingQuantityValue(unit, quantityValue)) {
      return null;
    }
    if (!isStrictNumber(quantityValue)) {
      return null;
    }
    entries.push([unit, quantityValue]);
  }
  return entries.length === 0 ? null : cloneQuantityOverrides(Object.fromEntries(entries));
}

function parseDashboardQuantityOverrides(value: unknown): DashboardQuantityOverrides | null {
  if (!isRecord(value) || Object.keys(value).length > TRAINING_DATA_LIMITS.dashboardRecordEntries) {
    return null;
  }
  const entries: [string, TrainingQuantityOverrides][] = [];
  for (const [activityId, overrides] of Object.entries(value)) {
    if (!isNonBlankIdentifier(activityId)) {
      return null;
    }
    const parsedOverrides = parseQuantityOverrides(overrides);
    if (parsedOverrides === null) {
      return null;
    }
    entries.push([activityId, parsedOverrides]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function parseDashboardActivityNotes(value: unknown): DashboardActivityNotes | null {
  if (!isRecord(value) || Object.keys(value).length > TRAINING_DATA_LIMITS.dashboardRecordEntries) {
    return null;
  }
  const entries: [string, string][] = [];
  for (const [activityId, note] of Object.entries(value)) {
    if (
      !isNonBlankIdentifier(activityId) ||
      !isBoundedString(note, TRAINING_DATA_LIMITS.noteCharacters)
    ) {
      return null;
    }
    entries.push([activityId, note]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function parseExercise(value: unknown): PersistedTrainingExercise | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, EXERCISE_PROPERTIES) ||
    !hasOwnProperties(value, ['id', 'name']) ||
    !isNonBlankIdentifier(value['id']) ||
    !isBoundedString(value['name'], TRAINING_DATA_LIMITS.nameCharacters) ||
    value['name'].trim().length === 0 ||
    (Object.hasOwn(value, 'quantities') && parseQuantities(value['quantities']) === null) ||
    (Object.hasOwn(value, 'notes') &&
      !isBoundedString(value['notes'], TRAINING_DATA_LIMITS.noteCharacters))
  ) {
    return null;
  }
  let quantities: TrainingQuantities | undefined;
  if (Object.hasOwn(value, 'quantities')) {
    const parsedQuantities = parseQuantities(value['quantities']);
    if (parsedQuantities === null) {
      return null;
    }
    quantities = parsedQuantities;
  }
  const notes = value['notes'];
  return Object.freeze({
    id: value['id'],
    name: value['name'],
    ...(quantities === undefined ? {} : { quantities }),
    ...(typeof notes === 'string' ? { notes } : {}),
  });
}

function parseSection(value: unknown): PersistedTrainingSection | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, SECTION_PROPERTIES) ||
    !hasOwnProperties(value, ['id', 'name', 'exercises']) ||
    !isNonBlankIdentifier(value['id']) ||
    !isBoundedString(value['name'], TRAINING_DATA_LIMITS.nameCharacters) ||
    value['name'].trim().length === 0 ||
    (Object.hasOwn(value, 'quantities') && parseQuantities(value['quantities']) === null) ||
    (Object.hasOwn(value, 'notes') &&
      !isBoundedString(value['notes'], TRAINING_DATA_LIMITS.noteCharacters)) ||
    !Array.isArray(value['exercises']) ||
    value['exercises'].length > TRAINING_DATA_LIMITS.exercisesPerSection
  ) {
    return null;
  }
  let quantities: TrainingQuantities | undefined;
  if (Object.hasOwn(value, 'quantities')) {
    const parsedQuantities = parseQuantities(value['quantities']);
    if (parsedQuantities === null) {
      return null;
    }
    quantities = parsedQuantities;
  }
  const exercises: PersistedTrainingExercise[] = [];
  for (const exercise of value['exercises']) {
    const parsedExercise = parseExercise(exercise);
    if (parsedExercise === null) {
      return null;
    }
    exercises.push(parsedExercise);
  }
  const notes = value['notes'];
  return Object.freeze({
    id: value['id'],
    name: value['name'],
    ...(quantities === undefined ? {} : { quantities }),
    ...(typeof notes === 'string' ? { notes } : {}),
    exercises: Object.freeze(exercises),
  });
}

function validateNestedIds(
  trainingSetId: string,
  sections: readonly PersistedTrainingSection[],
): boolean {
  const ids = new Set<string>([trainingSetId]);
  let activityCount = 0;
  for (const section of sections) {
    activityCount += section.exercises.length + 1;
    if (activityCount > TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet) {
      return false;
    }
    if (ids.has(section.id)) {
      return false;
    }
    ids.add(section.id);
    for (const exercise of section.exercises) {
      if (ids.has(exercise.id)) {
        return false;
      }
      ids.add(exercise.id);
    }
  }
  return true;
}

function parseCustomTrainingSet(value: unknown): PersistedCustomTrainingSet | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, CUSTOM_SET_PROPERTIES) ||
    !hasOwnProperties(value, ['id', 'name', 'category', 'sections', 'isBuiltIn']) ||
    !isNonBlankIdentifier(value['id']) ||
    !isBoundedString(value['name'], TRAINING_DATA_LIMITS.nameCharacters) ||
    value['name'].trim().length === 0 ||
    (Object.hasOwn(value, 'description') &&
      !isBoundedString(value['description'], TRAINING_DATA_LIMITS.descriptionCharacters)) ||
    value['category'] !== 'custom' ||
    (Object.hasOwn(value, 'customIntensity') &&
      !isCustomTrainingIntensity(value['customIntensity'])) ||
    !Array.isArray(value['sections']) ||
    value['sections'].length < 1 ||
    value['sections'].length > TRAINING_DATA_LIMITS.customSections ||
    value['isBuiltIn'] !== false
  ) {
    return null;
  }
  const sections: PersistedTrainingSection[] = [];
  for (const section of value['sections']) {
    const parsedSection = parseSection(section);
    if (parsedSection === null) {
      return null;
    }
    sections.push(parsedSection);
  }
  if (!validateNestedIds(value['id'], sections)) {
    return null;
  }
  const description = value['description'];
  const customIntensity = value['customIntensity'];
  return Object.freeze({
    id: value['id'],
    name: value['name'],
    ...(typeof description === 'string' ? { description } : {}),
    category: 'custom',
    ...(isCustomTrainingIntensity(customIntensity) ? { customIntensity } : {}),
    sections: Object.freeze(sections),
    isBuiltIn: false,
  });
}

function isCustomEntryReferenceCompatible(
  trainingSet: PersistedCustomTrainingSet,
  quantityOverrides: DashboardQuantityOverrides,
  activityNotes: DashboardActivityNotes,
): boolean {
  const activityIds = new Set<string>();
  for (const section of trainingSet.sections) {
    activityIds.add(section.id);
    for (const exercise of section.exercises) {
      activityIds.add(exercise.id);
    }
  }

  for (const activityId of Object.keys(quantityOverrides)) {
    if (!activityIds.has(activityId)) {
      return false;
    }
  }

  // The compact custom wire snapshot intentionally omits activity metadata. The local
  // decoder therefore cannot establish that a custom activity accepts a dashboard note and
  // would discard every custom activityNotes entry during its sanitizing round trip.
  return Object.keys(activityNotes).length === 0;
}

function parseEntry(value: unknown): PersistedDashboardEntryV10 | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, DASHBOARD_ENTRY_PROPERTIES) ||
    !hasOwnProperties(value, [
      'id',
      'trainingSetId',
      'quantityOverrides',
      'activityNotes',
      'notes',
      'createdAt',
    ]) ||
    !isNonBlankIdentifier(value['id']) ||
    !isNonBlankIdentifier(value['trainingSetId']) ||
    !isBoundedString(value['notes'], TRAINING_DATA_LIMITS.noteCharacters) ||
    !isBoundedString(value['createdAt'], TRAINING_DATA_LIMITS.timestampCharacters)
  ) {
    return null;
  }
  const quantityOverrides = parseDashboardQuantityOverrides(value['quantityOverrides']);
  const activityNotes = parseDashboardActivityNotes(value['activityNotes']);
  if (quantityOverrides === null || activityNotes === null) {
    return null;
  }
  let trainingSet: PersistedCustomTrainingSet | undefined;
  if (Object.hasOwn(value, 'trainingSet')) {
    const parsedTrainingSet = parseCustomTrainingSet(value['trainingSet']);
    if (
      parsedTrainingSet === null ||
      parsedTrainingSet.id !== value['trainingSetId'] ||
      !isCustomEntryReferenceCompatible(parsedTrainingSet, quantityOverrides, activityNotes)
    ) {
      return null;
    }
    trainingSet = parsedTrainingSet;
  }
  return Object.freeze({
    id: value['id'],
    trainingSetId: asTrainingSetId(value['trainingSetId']),
    ...(trainingSet === undefined ? {} : { trainingSet }),
    quantityOverrides,
    activityNotes,
    notes: value['notes'],
    createdAt: value['createdAt'],
  });
}

function validateUniqueEntryIds(entries: readonly PersistedDashboardEntryV10[]): boolean {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      return false;
    }
    ids.add(entry.id);
  }
  return true;
}

function parseWireState(value: unknown): PersistedTrainingWireStateV10 | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, DASHBOARD_STATE_PROPERTIES) ||
    !hasOwnProperties(value, ['dashboardEntries']) ||
    !Array.isArray(value['dashboardEntries']) ||
    value['dashboardEntries'].length > TRAINING_DATA_LIMITS.dashboardEntries
  ) {
    return null;
  }
  const dashboardEntries: PersistedDashboardEntryV10[] = [];
  for (const entry of value['dashboardEntries']) {
    const parsedEntry = parseEntry(entry);
    if (parsedEntry === null) {
      return null;
    }
    dashboardEntries.push(parsedEntry);
  }
  return validateUniqueEntryIds(dashboardEntries)
    ? Object.freeze({ dashboardEntries: Object.freeze(dashboardEntries) })
    : null;
}

/**
 * Parse a strict, complete v10 cloud state. This function has no catalogue dependency and never
 * sanitizes notes or canonicalizes built-in references. Callers must run catalogue compatibility
 * after receipt lookup for a genuinely new write.
 */
export function parseDashboardPersistenceV10(value: unknown): PersistedTrainingWireStateV10 | null {
  try {
    return parseWireState(value);
  } catch {
    return null;
  }
}

function assertStorageCompatibleActivity(activity: TrainingActivity): void {
  if (activity.editableQuantityUnits !== undefined || activity.allowsSessionNotes !== undefined) {
    throw new Error('Dashboard persistence cannot encode activity metadata.');
  }
}

function encodeCustomTrainingSet(value: unknown): PersistedCustomTrainingSet {
  if (
    !isRecord(value) ||
    !hasOwnProperties(value, ['id', 'name', 'category', 'activities', 'isBuiltIn'])
  ) {
    throw new Error('Dashboard persistence custom snapshot is invalid.');
  }
  const validation = validateTrainingSet(value);
  if (
    !validation.success ||
    validation.value.isBuiltIn ||
    validation.value.category !== 'custom' ||
    validation.value.sourceId !== undefined ||
    Object.hasOwn(value, 'sourceId')
  ) {
    throw new Error('Dashboard persistence custom snapshot is invalid.');
  }
  const trainingSet = validation.value;
  const sections: PersistedTrainingSection[] = [];
  for (const section of trainingSet.activities) {
    assertStorageCompatibleActivity(section);
    const exercises: PersistedTrainingExercise[] = [];
    for (const exercise of section.children) {
      assertStorageCompatibleActivity(exercise);
      if (exercise.children.length > 0) {
        throw new Error('Dashboard persistence cannot encode nested custom activities.');
      }
      exercises.push({
        id: exercise.id,
        name: exercise.name,
        ...(exercise.quantities === undefined ? {} : { quantities: exercise.quantities }),
        ...(exercise.notes === undefined ? {} : { notes: exercise.notes }),
      });
    }
    sections.push({
      id: section.id,
      name: section.name,
      ...(section.quantities === undefined ? {} : { quantities: section.quantities }),
      ...(section.notes === undefined ? {} : { notes: section.notes }),
      exercises,
    });
  }
  const wire = {
    id: trainingSet.id,
    name: trainingSet.name,
    ...(trainingSet.description === undefined ? {} : { description: trainingSet.description }),
    category: 'custom' as const,
    ...(trainingSet.customIntensity === undefined
      ? {}
      : { customIntensity: trainingSet.customIntensity }),
    sections,
    isBuiltIn: false as const,
  };
  const parsed = parseCustomTrainingSet(wire);
  if (parsed === null) {
    throw new Error('Dashboard persistence custom snapshot is invalid.');
  }
  return parsed;
}

function areValuesStructurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => areValuesStructurallyEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every(
    (key) => Object.hasOwn(right, key) && areValuesStructurallyEqual(left[key], right[key]),
  );
}

function encodeEntry(value: unknown): PersistedDashboardEntryV10 {
  if (
    !isRecord(value) ||
    !hasOwnProperties(value, [
      'id',
      'trainingSetId',
      'quantityOverrides',
      'activityNotes',
      'notes',
      'createdAt',
    ]) ||
    !isNonBlankIdentifier(value['id']) ||
    !isNonBlankIdentifier(value['trainingSetId'])
  ) {
    throw new Error('Dashboard persistence entry is invalid.');
  }
  if (!hasOnlyProperties(value, DASHBOARD_ENTRY_PROPERTIES)) {
    throw new Error('Dashboard persistence entry contains unsupported properties.');
  }
  const quantityOverrides = parseDashboardQuantityOverrides(value['quantityOverrides']);
  const activityNotes = parseDashboardActivityNotes(value['activityNotes']);
  if (
    quantityOverrides === null ||
    activityNotes === null ||
    !isBoundedString(value['notes'], TRAINING_DATA_LIMITS.noteCharacters) ||
    !isBoundedString(value['createdAt'], TRAINING_DATA_LIMITS.timestampCharacters)
  ) {
    throw new Error('Dashboard persistence entry is invalid.');
  }
  let trainingSet: PersistedCustomTrainingSet | undefined;
  if (Object.hasOwn(value, 'trainingSet')) {
    const trainingSetValue = value['trainingSet'];
    if (!isRecord(trainingSetValue)) {
      throw new Error('Dashboard persistence entry snapshot is invalid.');
    }
    const isBuiltIn = trainingSetValue['isBuiltIn'] === true;
    const validation = validateTrainingSet(trainingSetValue);
    if (!validation.success || validation.value.id !== value['trainingSetId']) {
      throw new Error('Dashboard persistence entry snapshot does not match its ID.');
    }
    if (isBuiltIn) {
      const canonicalTrainingSet = DEFAULT_TRAINING_SETS.find(
        (trainingSet) => trainingSet.id === validation.value.id,
      );
      if (
        canonicalTrainingSet === undefined ||
        !areValuesStructurallyEqual(validation.value, canonicalTrainingSet)
      ) {
        throw new Error('Dashboard persistence entry built-in snapshot is not canonical.');
      }
    } else {
      trainingSet = encodeCustomTrainingSet(trainingSetValue);
    }
  }
  const wire: Record<string, unknown> = {
    id: value['id'],
    trainingSetId: value['trainingSetId'],
    ...(trainingSet === undefined ? {} : { trainingSet }),
    quantityOverrides,
    activityNotes,
    notes: value['notes'],
    createdAt: value['createdAt'],
  };
  const parsed = parseEntry(wire);
  if (parsed === null) {
    throw new Error('Dashboard persistence entry is invalid.');
  }
  return parsed;
}

/** Encode a validated runtime v10 state into the strict two-level cloud wire representation. */
export function encodeDashboardPersistenceV10(value: unknown): PersistedTrainingWireStateV10 {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, DASHBOARD_STATE_PROPERTIES) ||
    !Array.isArray(value['dashboardEntries']) ||
    value['dashboardEntries'].length > TRAINING_DATA_LIMITS.dashboardEntries
  ) {
    throw new Error('Dashboard persistence state is invalid.');
  }
  try {
    const dashboardEntries = value['dashboardEntries'].map(encodeEntry);
    if (!validateUniqueEntryIds(dashboardEntries)) {
      throw new Error('Dashboard persistence state contains duplicate entry IDs.');
    }
    return Object.freeze({ dashboardEntries: Object.freeze(dashboardEntries) });
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Dashboard persistence state is invalid.', { cause: error });
  }
}

function decodeCustomTrainingSet(wire: PersistedCustomTrainingSet): TrainingSet | null {
  const candidate: unknown = {
    id: asTrainingSetId(wire.id),
    name: wire.name,
    ...(wire.description === undefined ? {} : { description: wire.description }),
    category: 'custom',
    ...(wire.customIntensity === undefined ? {} : { customIntensity: wire.customIntensity }),
    activities: wire.sections.map((section) => ({
      id: section.id,
      name: section.name,
      ...(section.quantities === undefined ? {} : { quantities: section.quantities }),
      ...(section.notes === undefined ? {} : { notes: section.notes }),
      children: section.exercises.map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        ...(exercise.quantities === undefined ? {} : { quantities: exercise.quantities }),
        ...(exercise.notes === undefined ? {} : { notes: exercise.notes }),
        children: [],
      })),
    })),
    isBuiltIn: false,
  };
  const validation = validateTrainingSet(candidate);
  return validation.success ? validation.value : null;
}

function isCatalogueValid(catalogue: readonly TrainingSet[]): boolean {
  const ids = new Set<string>();
  for (const trainingSet of catalogue) {
    if (
      !validateTrainingSet(trainingSet).success ||
      !trainingSet.isBuiltIn ||
      ids.has(trainingSet.id)
    ) {
      return false;
    }
    ids.add(trainingSet.id);
    for (const activity of getTrainingSetActivities(trainingSet)) {
      if (ids.has(activity.id)) {
        return false;
      }
      ids.add(activity.id);
    }
  }
  return true;
}

/**
 * Check catalogue-dependent semantics after strict structural parsing. In particular this checks
 * built-in references, custom-set collisions, activity references, and notes that local loading
 * would otherwise discard.
 */
export function isDashboardCatalogueCompatible(
  value: unknown,
  catalogue: readonly TrainingSet[] = DEFAULT_TRAINING_SETS,
): boolean {
  try {
    const state = parseDashboardPersistenceV10(value);
    if (state === null || !isCatalogueValid(catalogue)) {
      return false;
    }
    const catalogueById = new Map<string, TrainingSet>();
    const catalogueIds = new Set<string>();
    for (const trainingSet of catalogue) {
      catalogueById.set(trainingSet.id, trainingSet);
      catalogueIds.add(trainingSet.id);
      for (const activity of getTrainingSetActivities(trainingSet)) {
        catalogueIds.add(activity.id);
      }
    }
    for (const entry of state.dashboardEntries) {
      let trainingSet: TrainingSet | null;
      if (entry.trainingSet === undefined) {
        trainingSet = catalogueById.get(entry.trainingSetId) ?? null;
      } else {
        if (catalogueIds.has(entry.trainingSet.id)) {
          return false;
        }
        trainingSet = decodeCustomTrainingSet(entry.trainingSet);
        if (trainingSet === null || catalogueIds.has(trainingSet.id)) {
          return false;
        }
        for (const activity of getTrainingSetActivities(trainingSet)) {
          if (catalogueIds.has(activity.id)) {
            return false;
          }
        }
      }
      if (trainingSet === null) {
        return false;
      }
      const activitiesById = new Map(
        getTrainingSetActivities(trainingSet).map((activity) => [activity.id, activity]),
      );
      for (const activityId of Object.keys(entry.quantityOverrides)) {
        if (!activitiesById.has(activityId)) {
          return false;
        }
      }
      for (const [activityId, note] of Object.entries(entry.activityNotes)) {
        const activity = activitiesById.get(activityId);
        if (
          activity === undefined ||
          activity.allowsSessionNotes !== true ||
          note.trim().length === 0
        ) {
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}
