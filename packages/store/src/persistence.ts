import {
  DEFAULT_TRAINING_SETS,
  asTrainingSetId,
  getTrainingSetActivities,
  isTrainingQuantityUnit,
  isValidRepetitionCount,
  isValidTrainingQuantities,
  isValidTrainingQuantityValue,
  validateTrainingSet,
  type DashboardEntry,
  type DashboardQuantityOverrides,
  type DrillCategory,
  type TrainingActivity,
  type TrainingQuantities,
  type TrainingQuantityOverrides,
  type TrainingQuantityUnit,
  type TrainingSet,
} from '@kendo-menu/domain';
import {
  createJSONStorage,
  type PersistStorage,
  type StateStorage,
  type StorageValue,
} from 'zustand/middleware';

export const TRAINING_STORE_PERSISTENCE_VERSION = 7;

export interface PersistedTrainingState {
  readonly dashboardEntries: readonly DashboardEntry[];
  readonly customTrainingSets: readonly TrainingSet[];
}

/** The v5-v7 storage DTO retained for the on-disk two-level sections/exercises shape. */
export interface PersistedTrainingExercise {
  readonly id: string;
  readonly name: string;
  readonly quantities?: TrainingQuantities;
  readonly notes?: string;
}

export interface PersistedTrainingSection {
  readonly id: string;
  readonly name: string;
  readonly quantities?: TrainingQuantities;
  readonly notes?: string;
  readonly exercises: readonly PersistedTrainingExercise[];
}

export interface PersistedCustomTrainingSet {
  readonly id: string;
  readonly sourceId?: never;
  readonly name: string;
  readonly description?: string;
  readonly category: 'custom';
  readonly sections: readonly PersistedTrainingSection[];
  readonly isBuiltIn: false;
}

export interface PersistedTrainingWireState {
  readonly dashboardEntries: readonly DashboardEntry[];
  readonly customTrainingSets: readonly PersistedCustomTrainingSet[];
}

export type PersistedTrainingStateV5 = PersistedTrainingWireState;
export type PersistedTrainingStateV6 = PersistedTrainingWireState;

export interface TrainingOverrideMigrationConflict {
  readonly dashboardEntryId: string;
  readonly unit: TrainingQuantityUnit;
  readonly overrides: readonly {
    readonly activityId: string;
    readonly value: number;
  }[];
}

export class TrainingOverrideMigrationConflictError extends Error {
  readonly conflict: TrainingOverrideMigrationConflict;

  constructor(conflict: TrainingOverrideMigrationConflict) {
    const values = conflict.overrides
      .map(({ activityId, value }) => `${activityId}=${String(value)}`)
      .join(', ');
    super(
      `Dashboard entry ${conflict.dashboardEntryId} has conflicting ${conflict.unit} overrides ` +
        `for the corrected International Uchikomi sequence: ${values}.`,
    );
    this.name = 'TrainingOverrideMigrationConflictError';
    this.conflict = conflict;
  }
}

export interface TrainingDurationOverrideMigrationConflict {
  readonly dashboardEntryId: string;
  readonly activityId: string;
  readonly seconds: number;
  readonly minutes: number;
}

export class TrainingDurationOverrideMigrationConflictError extends Error {
  readonly conflict: TrainingDurationOverrideMigrationConflict;

  constructor(conflict: TrainingDurationOverrideMigrationConflict) {
    super(
      `Dashboard entry ${conflict.dashboardEntryId} has conflicting duration overrides for ` +
        `${conflict.activityId}: seconds=${String(conflict.seconds)}, ` +
        `minutes=${String(conflict.minutes)}.`,
    );
    this.name = 'TrainingDurationOverrideMigrationConflictError';
    this.conflict = conflict;
  }
}

export type LegacyTrainingQuantityUnit = 'repetitions' | 'sets' | 'minutes' | 'rounds';
export type LegacyRepUnit = LegacyTrainingQuantityUnit | 'custom';

export interface LegacyDashboardEntry {
  readonly id: string;
  readonly trainingSetId: TrainingSet['id'];
  readonly repOverrides: Readonly<Record<string, number>>;
  readonly notes: string;
  readonly createdAt: string;
}

export interface LegacyTrainingSet {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: DrillCategory;
  readonly steps: readonly LegacyTrainingStep[];
  readonly isBuiltIn: false;
}

export interface LegacyTrainingStep {
  readonly id: string;
  readonly label: string;
  readonly defaultReps: number | null;
  readonly repUnit: LegacyRepUnit;
  readonly description?: string;
}

export interface LegacyTrainingSectionV2 {
  readonly id: string;
  readonly label: string;
  readonly steps: readonly LegacyTrainingStep[];
}

export interface LegacyTrainingSetV2 {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: DrillCategory;
  readonly sections: readonly LegacyTrainingSectionV2[];
  readonly isBuiltIn: false;
}

export interface LegacyTrainingQuantityV4 {
  readonly unit: LegacyTrainingQuantityUnit;
  readonly value: number | null;
}

export interface LegacyTrainingStepV4 extends LegacyTrainingStep {
  readonly quantities: readonly LegacyTrainingQuantityV4[];
}

export interface LegacyTrainingSectionV4 {
  readonly id: string;
  readonly label: string;
  readonly steps: readonly LegacyTrainingStepV4[];
}

export interface LegacyTrainingSetV4 {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: DrillCategory;
  readonly sections: readonly LegacyTrainingSectionV4[];
  readonly isBuiltIn: false;
}

export interface LegacyPersistedTrainingState {
  readonly dashboardEntries: readonly LegacyDashboardEntry[];
  readonly customTrainingSets: readonly LegacyTrainingSet[];
}

export interface LegacyPersistedTrainingStateV2 {
  readonly dashboardEntries: readonly LegacyDashboardEntry[];
  readonly customTrainingSets: readonly LegacyTrainingSetV2[];
}

export interface LegacyPersistedTrainingStateV3 {
  readonly dashboardEntries: readonly LegacyDashboardEntry[];
  readonly customTrainingSets: readonly LegacyTrainingSetV4[];
}

export interface LegacyPersistedTrainingStateV4 {
  readonly dashboardEntries: readonly DashboardEntry[];
  readonly customTrainingSets: readonly LegacyTrainingSetV4[];
}

export type PersistedStorageState =
  | PersistedTrainingState
  | PersistedTrainingWireState
  | LegacyPersistedTrainingStateV4
  | LegacyPersistedTrainingStateV3
  | LegacyPersistedTrainingStateV2
  | LegacyPersistedTrainingState;

export type TrainingStorageInspection =
  | {
      readonly status: 'empty';
      readonly kind: 'empty';
    }
  | {
      readonly status: 'ready';
      readonly kind: 'ready';
      readonly version: typeof TRAINING_STORE_PERSISTENCE_VERSION;
      readonly state: PersistedTrainingState;
    }
  | {
      readonly status: 'migrated';
      readonly kind: 'migrated';
      readonly fromVersion: 0 | 1 | 2 | 3 | 4 | 5 | 6;
      readonly version: typeof TRAINING_STORE_PERSISTENCE_VERSION;
      readonly state: PersistedTrainingState;
    }
  | {
      readonly status: 'corrupt';
      readonly kind: 'corrupt';
      readonly reason: 'malformed-json' | 'malformed-envelope' | 'invalid-domain';
    }
  | {
      readonly status: 'corrupt';
      readonly kind: 'corrupt';
      readonly reason: 'override-migration-conflict';
      readonly detail: string;
      readonly conflict:
        TrainingOverrideMigrationConflict | TrainingDurationOverrideMigrationConflict;
    }
  | {
      readonly status: 'unsupported-future';
      readonly kind: 'unsupported-future';
      readonly version: number;
    }
  | {
      readonly status: 'unavailable';
      readonly kind: 'unavailable';
    };

export type WritableTrainingStorageInspection = Extract<
  TrainingStorageInspection,
  { readonly status: 'empty' | 'ready' | 'migrated' }
>;

const LEGACY_TRAINING_QUANTITY_UNITS = ['repetitions', 'sets', 'minutes', 'rounds'] as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
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

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  );
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

function isLegacyTrainingQuantityUnit(value: unknown): value is LegacyTrainingQuantityUnit {
  return value === 'repetitions' || value === 'sets' || value === 'minutes' || value === 'rounds';
}

function isLegacyRepUnit(value: unknown): value is LegacyRepUnit {
  return isLegacyTrainingQuantityUnit(value) || value === 'custom';
}

function isValidLegacyQuantityValue(
  unit: LegacyTrainingQuantityUnit,
  value: unknown,
): value is number | null {
  return value === null || isValidTrainingQuantityValue(unit, value);
}

function parseArray<T>(
  value: unknown,
  parseItem: (item: unknown) => T | null,
): readonly T[] | null {
  if (!isUnknownArray(value)) {
    return null;
  }

  const parsedItems: T[] = [];
  for (const item of value) {
    const parsedItem = parseItem(item);
    if (parsedItem === null) {
      return null;
    }
    parsedItems.push(parsedItem);
  }
  return parsedItems;
}

function parseLegacyTrainingStep(value: unknown): LegacyTrainingStep | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, new Set(['id', 'label', 'defaultReps', 'repUnit', 'description']))
  ) {
    return null;
  }

  const id = value['id'];
  const label = value['label'];
  const defaultReps = value['defaultReps'];
  const repUnit = value['repUnit'];
  const description = value['description'];
  if (
    !isNonBlankString(id) ||
    !isNonBlankString(label) ||
    (defaultReps !== null && !isValidRepetitionCount(defaultReps)) ||
    !isLegacyRepUnit(repUnit) ||
    (Object.hasOwn(value, 'description') && typeof description !== 'string')
  ) {
    return null;
  }

  return {
    id,
    label,
    defaultReps,
    repUnit,
    ...(typeof description === 'string' ? { description } : {}),
  };
}

function parseLegacyTrainingQuantityV4(value: unknown): LegacyTrainingQuantityV4 | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, new Set(['unit', 'value'])) ||
    !isLegacyTrainingQuantityUnit(value['unit']) ||
    !isValidLegacyQuantityValue(value['unit'], value['value'])
  ) {
    return null;
  }
  return { unit: value['unit'], value: value['value'] };
}

function createLegacyTrainingQuantities(
  values: Readonly<Record<LegacyTrainingQuantityUnit, number | null>>,
): readonly LegacyTrainingQuantityV4[] {
  return LEGACY_TRAINING_QUANTITY_UNITS.map((unit) => ({ unit, value: values[unit] }));
}

function parseLegacyTrainingQuantitiesV4(
  value: unknown,
): readonly LegacyTrainingQuantityV4[] | null {
  const parsed = parseArray(value, parseLegacyTrainingQuantityV4);
  if (parsed === null || parsed.length !== LEGACY_TRAINING_QUANTITY_UNITS.length) {
    return null;
  }

  const values = new Map<LegacyTrainingQuantityUnit, number | null>();
  for (const quantity of parsed) {
    if (values.has(quantity.unit)) {
      return null;
    }
    values.set(quantity.unit, quantity.value);
  }

  const repetitions = values.get('repetitions');
  const sets = values.get('sets');
  const minutes = values.get('minutes');
  const rounds = values.get('rounds');
  if (
    repetitions === undefined ||
    sets === undefined ||
    minutes === undefined ||
    rounds === undefined
  ) {
    return null;
  }
  return createLegacyTrainingQuantities({ repetitions, sets, minutes, rounds });
}

function parseLegacyTrainingStepV4(value: unknown): LegacyTrainingStepV4 | null {
  if (!isRecord(value)) {
    return null;
  }
  const legacy = parseLegacyTrainingStep(
    Object.fromEntries(Object.entries(value).filter(([property]) => property !== 'quantities')),
  );
  const quantities = parseLegacyTrainingQuantitiesV4(value['quantities']);
  if (
    legacy === null ||
    quantities === null ||
    !hasOnlyProperties(
      value,
      new Set(['id', 'label', 'defaultReps', 'repUnit', 'description', 'quantities']),
    )
  ) {
    return null;
  }

  if (legacy.defaultReps !== null && isLegacyTrainingQuantityUnit(legacy.repUnit)) {
    const matching = quantities.find((quantity) => quantity.unit === legacy.repUnit);
    if (matching?.value !== legacy.defaultReps) {
      return null;
    }
  }
  return { ...legacy, quantities };
}

function parseLegacyTrainingSectionV2(value: unknown): LegacyTrainingSectionV2 | null {
  if (!isRecord(value) || !hasOnlyProperties(value, new Set(['id', 'label', 'steps']))) {
    return null;
  }
  const id = value['id'];
  const label = value['label'];
  const steps = parseArray(value['steps'], parseLegacyTrainingStep);
  if (!isNonBlankString(id) || !isNonBlankString(label) || steps === null || steps.length < 1) {
    return null;
  }
  const ids = new Set<string>([id]);
  for (const step of steps) {
    if (ids.has(step.id)) {
      return null;
    }
    ids.add(step.id);
  }
  return { id, label, steps };
}

function parseLegacyTrainingSectionV4(value: unknown): LegacyTrainingSectionV4 | null {
  if (!isRecord(value) || !hasOnlyProperties(value, new Set(['id', 'label', 'steps']))) {
    return null;
  }
  const id = value['id'];
  const label = value['label'];
  const steps = parseArray(value['steps'], parseLegacyTrainingStepV4);
  if (!isNonBlankString(id) || !isNonBlankString(label) || steps === null || steps.length < 1) {
    return null;
  }
  const ids = new Set<string>([id]);
  for (const step of steps) {
    if (ids.has(step.id)) {
      return null;
    }
    ids.add(step.id);
  }
  return { id, label, steps };
}

function parseRepOverrides(value: unknown): Readonly<Record<string, number>> | null {
  if (!isRecord(value)) {
    return null;
  }
  const entries: [string, number][] = [];
  for (const [activityId, repetitionCount] of Object.entries(value)) {
    if (!isNonBlankString(activityId) || !isValidRepetitionCount(repetitionCount)) {
      return null;
    }
    entries.push([activityId, repetitionCount]);
  }
  return Object.fromEntries(entries);
}

function parseLegacyDashboardEntry(value: unknown): LegacyDashboardEntry | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(
      value,
      new Set(['id', 'trainingSetId', 'repOverrides', 'notes', 'createdAt']),
    )
  ) {
    return null;
  }
  const id = value['id'];
  const trainingSetId = value['trainingSetId'];
  const repOverrides = parseRepOverrides(value['repOverrides']);
  const notes = value['notes'];
  const createdAt = value['createdAt'];
  if (
    !isNonBlankString(id) ||
    !isNonBlankString(trainingSetId) ||
    repOverrides === null ||
    typeof notes !== 'string' ||
    typeof createdAt !== 'string'
  ) {
    return null;
  }
  return {
    id,
    trainingSetId: asTrainingSetId(trainingSetId),
    repOverrides,
    notes,
    createdAt,
  };
}

function parseTrainingQuantityOverrides(value: unknown): TrainingQuantityOverrides | null {
  if (!isRecord(value)) {
    return null;
  }
  const entries: [TrainingQuantityUnit, number][] = [];
  for (const [unit, quantityValue] of Object.entries(value)) {
    if (!isTrainingQuantityUnit(unit) || !isValidTrainingQuantityValue(unit, quantityValue)) {
      return null;
    }
    entries.push([unit, quantityValue]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function parseDashboardQuantityOverrides(value: unknown): DashboardQuantityOverrides | null {
  if (!isRecord(value)) {
    return null;
  }
  const entries: [string, TrainingQuantityOverrides][] = [];
  for (const [activityId, activityOverrides] of Object.entries(value)) {
    const parsedOverrides = parseTrainingQuantityOverrides(activityOverrides);
    if (!isNonBlankString(activityId) || parsedOverrides === null) {
      return null;
    }
    entries.push([activityId, parsedOverrides]);
  }
  return Object.fromEntries(entries);
}

function parseDashboardEntry(value: unknown): DashboardEntry | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(
      value,
      new Set(['id', 'trainingSetId', 'quantityOverrides', 'notes', 'createdAt']),
    )
  ) {
    return null;
  }
  const id = value['id'];
  const trainingSetId = value['trainingSetId'];
  const quantityOverrides = parseDashboardQuantityOverrides(value['quantityOverrides']);
  const notes = value['notes'];
  const createdAt = value['createdAt'];
  if (
    !isNonBlankString(id) ||
    !isNonBlankString(trainingSetId) ||
    quantityOverrides === null ||
    typeof notes !== 'string' ||
    typeof createdAt !== 'string'
  ) {
    return null;
  }
  return {
    id,
    trainingSetId: asTrainingSetId(trainingSetId),
    quantityOverrides,
    notes,
    createdAt,
  };
}

function parseLegacyTrainingSet(value: unknown): LegacyTrainingSet | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(
      value,
      new Set(['id', 'name', 'description', 'category', 'steps', 'isBuiltIn']),
    )
  ) {
    return null;
  }
  const id = value['id'];
  const name = value['name'];
  const description = value['description'];
  const category = value['category'];
  const steps = parseArray(value['steps'], parseLegacyTrainingStep);
  if (
    !isNonBlankString(id) ||
    !isNonBlankString(name) ||
    typeof description !== 'string' ||
    !isDrillCategory(category) ||
    steps === null ||
    steps.length < 1 ||
    value['isBuiltIn'] !== false
  ) {
    return null;
  }
  const ids = new Set<string>([id]);
  for (const step of steps) {
    if (ids.has(step.id)) {
      return null;
    }
    ids.add(step.id);
  }
  return { id, name, description, category, steps, isBuiltIn: false };
}

function parseLegacyTrainingSetV2(value: unknown): LegacyTrainingSetV2 | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(
      value,
      new Set(['id', 'name', 'description', 'category', 'sections', 'isBuiltIn']),
    )
  ) {
    return null;
  }
  const id = value['id'];
  const name = value['name'];
  const description = value['description'];
  const category = value['category'];
  const sections = parseArray(value['sections'], parseLegacyTrainingSectionV2);
  if (
    !isNonBlankString(id) ||
    !isNonBlankString(name) ||
    typeof description !== 'string' ||
    !isDrillCategory(category) ||
    sections === null ||
    sections.length < 1 ||
    value['isBuiltIn'] !== false
  ) {
    return null;
  }
  if (!validateUniqueNestedIds(id, sections)) {
    return null;
  }
  return { id, name, description, category, sections, isBuiltIn: false };
}

function parseLegacyTrainingSetV4(value: unknown): LegacyTrainingSetV4 | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(
      value,
      new Set(['id', 'name', 'description', 'category', 'sections', 'isBuiltIn']),
    )
  ) {
    return null;
  }
  const id = value['id'];
  const name = value['name'];
  const description = value['description'];
  const category = value['category'];
  const sections = parseArray(value['sections'], parseLegacyTrainingSectionV4);
  if (
    !isNonBlankString(id) ||
    !isNonBlankString(name) ||
    typeof description !== 'string' ||
    !isDrillCategory(category) ||
    sections === null ||
    sections.length < 1 ||
    value['isBuiltIn'] !== false
  ) {
    return null;
  }
  if (!validateUniqueNestedIds(id, sections)) {
    return null;
  }
  return { id, name, description, category, sections, isBuiltIn: false };
}

function parseLegacyCustomTrainingSetV2(value: unknown): LegacyTrainingSetV2 | null {
  const trainingSet = parseLegacyTrainingSetV2(value);
  return trainingSet !== null &&
    trainingSet.category === 'custom' &&
    trainingSet.sections.every((section) =>
      section.steps.every((step) => step.defaultReps !== null),
    )
    ? trainingSet
    : null;
}

function parseLegacyCustomTrainingSetV4(value: unknown): LegacyTrainingSetV4 | null {
  const trainingSet = parseLegacyTrainingSetV4(value);
  return trainingSet !== null &&
    trainingSet.category === 'custom' &&
    trainingSet.sections.every((section) =>
      section.steps.every((step) => step.defaultReps !== null),
    )
    ? trainingSet
    : null;
}

function validateUniqueNestedIds(
  trainingSetId: string,
  sections: readonly {
    readonly id: string;
    readonly steps: readonly { readonly id: string }[];
  }[],
): boolean {
  const ids = new Set<string>([trainingSetId]);
  for (const section of sections) {
    if (ids.has(section.id)) {
      return false;
    }
    ids.add(section.id);
    for (const step of section.steps) {
      if (ids.has(step.id)) {
        return false;
      }
      ids.add(step.id);
    }
  }
  return true;
}

function parsePersistedTrainingExercise(value: unknown): PersistedTrainingExercise | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, new Set(['id', 'name', 'quantities', 'notes'])) ||
    !isNonBlankString(value['id']) ||
    !isNonBlankString(value['name']) ||
    (Object.hasOwn(value, 'quantities') && !isValidTrainingQuantities(value['quantities'])) ||
    (Object.hasOwn(value, 'notes') && typeof value['notes'] !== 'string')
  ) {
    return null;
  }
  return {
    id: value['id'],
    name: value['name'],
    ...(isValidTrainingQuantities(value['quantities']) ? { quantities: value['quantities'] } : {}),
    ...(typeof value['notes'] === 'string' ? { notes: value['notes'] } : {}),
  };
}

function parsePersistedTrainingSection(value: unknown): PersistedTrainingSection | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, new Set(['id', 'name', 'quantities', 'notes', 'exercises'])) ||
    !isNonBlankString(value['id']) ||
    !isNonBlankString(value['name']) ||
    (Object.hasOwn(value, 'quantities') && !isValidTrainingQuantities(value['quantities'])) ||
    (Object.hasOwn(value, 'notes') && typeof value['notes'] !== 'string')
  ) {
    return null;
  }
  const exercises = parseArray(value['exercises'], parsePersistedTrainingExercise);
  if (exercises === null) {
    return null;
  }
  return {
    id: value['id'],
    name: value['name'],
    ...(isValidTrainingQuantities(value['quantities']) ? { quantities: value['quantities'] } : {}),
    ...(typeof value['notes'] === 'string' ? { notes: value['notes'] } : {}),
    exercises,
  };
}

function validateUniquePersistedNestedIds(
  trainingSetId: string,
  sections: readonly PersistedTrainingSection[],
): boolean {
  const ids = new Set<string>([trainingSetId]);
  for (const section of sections) {
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

function parsePersistedCustomTrainingSetWire(value: unknown): PersistedCustomTrainingSet | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(
      value,
      new Set(['id', 'name', 'description', 'category', 'sections', 'isBuiltIn']),
    ) ||
    !isNonBlankString(value['id']) ||
    !isNonBlankString(value['name']) ||
    (Object.hasOwn(value, 'description') && typeof value['description'] !== 'string') ||
    value['category'] !== 'custom' ||
    value['isBuiltIn'] !== false
  ) {
    return null;
  }
  const sections = parseArray(value['sections'], parsePersistedTrainingSection);
  if (
    sections === null ||
    sections.length < 1 ||
    !validateUniquePersistedNestedIds(value['id'], sections)
  ) {
    return null;
  }
  return {
    id: value['id'],
    name: value['name'],
    ...(typeof value['description'] === 'string' ? { description: value['description'] } : {}),
    category: 'custom',
    sections,
    isBuiltIn: false,
  };
}

function decodePersistedCustomTrainingSet(
  trainingSet: PersistedCustomTrainingSet,
): TrainingSet | null {
  const candidate: unknown = {
    id: asTrainingSetId(trainingSet.id),
    name: trainingSet.name,
    ...(trainingSet.description === undefined ? {} : { description: trainingSet.description }),
    category: 'custom',
    activities: trainingSet.sections.map((section) => ({
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

function parseCustomTrainingSet(value: unknown): TrainingSet | null {
  if (!isRecord(value)) {
    return null;
  }

  if (Object.hasOwn(value, 'activities')) {
    const validation = validateTrainingSet(value);
    if (!validation.success) {
      return null;
    }
    const trainingSet = validation.value;
    return trainingSet.isBuiltIn === false &&
      trainingSet.category === 'custom' &&
      trainingSet.sourceId === undefined
      ? trainingSet
      : null;
  }

  const wireTrainingSet = parsePersistedCustomTrainingSetWire(value);
  return wireTrainingSet === null ? null : decodePersistedCustomTrainingSet(wireTrainingSet);
}

function parsePersistedTrainingWireState(value: unknown): PersistedTrainingState | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, new Set(['dashboardEntries', 'customTrainingSets']))
  ) {
    return null;
  }
  const dashboardEntries = parseArray(value['dashboardEntries'], parseDashboardEntry);
  const wireCustomTrainingSets = parseArray(
    value['customTrainingSets'],
    parsePersistedCustomTrainingSetWire,
  );
  if (
    dashboardEntries === null ||
    wireCustomTrainingSets === null ||
    !validateUniqueEntryIds(dashboardEntries) ||
    !validateUniqueSetIds(wireCustomTrainingSets) ||
    !validateNoCuratedSetIdCollisions(wireCustomTrainingSets)
  ) {
    return null;
  }

  const customTrainingSets: TrainingSet[] = [];
  for (const wireTrainingSet of wireCustomTrainingSets) {
    const trainingSet = decodePersistedCustomTrainingSet(wireTrainingSet);
    if (trainingSet === null) {
      return null;
    }
    customTrainingSets.push(trainingSet);
  }
  return { dashboardEntries, customTrainingSets };
}

function validateUniqueEntryIds(entries: readonly { readonly id: string }[]): boolean {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      return false;
    }
    ids.add(entry.id);
  }
  return true;
}

function validateUniqueSetIds(sets: readonly { readonly id: string }[]): boolean {
  const ids = new Set<string>();
  for (const trainingSet of sets) {
    if (ids.has(trainingSet.id)) {
      return false;
    }
    ids.add(trainingSet.id);
  }
  return true;
}

function validateNoCuratedSetIdCollisions(sets: readonly { readonly id: string }[]): boolean {
  const curatedIds = new Set<string>(DEFAULT_TRAINING_SETS.map((trainingSet) => trainingSet.id));
  return sets.every((trainingSet) => !curatedIds.has(trainingSet.id));
}

export function parsePersistedTrainingState(value: unknown): PersistedTrainingState | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, new Set(['dashboardEntries', 'customTrainingSets']))
  ) {
    return null;
  }
  const dashboardEntries = parseArray(value['dashboardEntries'], parseDashboardEntry);
  const customTrainingSets = parseArray(value['customTrainingSets'], parseCustomTrainingSet);
  if (
    dashboardEntries === null ||
    customTrainingSets === null ||
    !validateUniqueEntryIds(dashboardEntries) ||
    !validateUniqueSetIds(customTrainingSets) ||
    !validateNoCuratedSetIdCollisions(customTrainingSets)
  ) {
    return null;
  }
  return { dashboardEntries, customTrainingSets };
}

export function parsePersistedTrainingStateV1(value: unknown): LegacyPersistedTrainingState | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, new Set(['dashboardEntries', 'customTrainingSets']))
  ) {
    return null;
  }
  const dashboardEntries = parseArray(value['dashboardEntries'], parseLegacyDashboardEntry);
  const customTrainingSets = parseArray(value['customTrainingSets'], parseLegacyTrainingSet);
  if (
    dashboardEntries === null ||
    customTrainingSets === null ||
    !validateUniqueEntryIds(dashboardEntries) ||
    !validateUniqueSetIds(customTrainingSets) ||
    !validateNoCuratedSetIdCollisions(customTrainingSets)
  ) {
    return null;
  }
  return { dashboardEntries, customTrainingSets };
}

export function parsePersistedTrainingStateV2(
  value: unknown,
): LegacyPersistedTrainingStateV2 | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, new Set(['dashboardEntries', 'customTrainingSets']))
  ) {
    return null;
  }
  const dashboardEntries = parseArray(value['dashboardEntries'], parseLegacyDashboardEntry);
  const customTrainingSets = parseArray(
    value['customTrainingSets'],
    parseLegacyCustomTrainingSetV2,
  );
  if (
    dashboardEntries === null ||
    customTrainingSets === null ||
    !validateUniqueEntryIds(dashboardEntries) ||
    !validateUniqueSetIds(customTrainingSets) ||
    !validateNoCuratedSetIdCollisions(customTrainingSets)
  ) {
    return null;
  }
  return { dashboardEntries, customTrainingSets };
}

export function parsePersistedTrainingStateV3(
  value: unknown,
): LegacyPersistedTrainingStateV3 | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, new Set(['dashboardEntries', 'customTrainingSets']))
  ) {
    return null;
  }
  const dashboardEntries = parseArray(value['dashboardEntries'], parseLegacyDashboardEntry);
  const customTrainingSets = parseArray(
    value['customTrainingSets'],
    parseLegacyCustomTrainingSetV4,
  );
  if (
    dashboardEntries === null ||
    customTrainingSets === null ||
    !validateUniqueEntryIds(dashboardEntries) ||
    !validateUniqueSetIds(customTrainingSets) ||
    !validateNoCuratedSetIdCollisions(customTrainingSets)
  ) {
    return null;
  }
  return { dashboardEntries, customTrainingSets };
}

export function parsePersistedTrainingStateV4(
  value: unknown,
): LegacyPersistedTrainingStateV4 | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, new Set(['dashboardEntries', 'customTrainingSets']))
  ) {
    return null;
  }
  const dashboardEntries = parseArray(value['dashboardEntries'], parseDashboardEntry);
  const customTrainingSets = parseArray(
    value['customTrainingSets'],
    parseLegacyCustomTrainingSetV4,
  );
  if (
    dashboardEntries === null ||
    customTrainingSets === null ||
    !validateUniqueEntryIds(dashboardEntries) ||
    !validateUniqueSetIds(customTrainingSets) ||
    !validateNoCuratedSetIdCollisions(customTrainingSets)
  ) {
    return null;
  }
  return { dashboardEntries, customTrainingSets };
}

export function parsePersistedTrainingStateV0(value: unknown): LegacyPersistedTrainingState | null {
  return parsePersistedTrainingStateV1(value);
}

export function migratePersistedTrainingStateV0ToV1(value: unknown): LegacyPersistedTrainingState {
  const parsed = parsePersistedTrainingStateV0(value);
  if (parsed === null) {
    throw new Error('Training-store version 0 state is invalid.');
  }
  return parsed;
}

export const migrateV0ToV1 = migratePersistedTrainingStateV0ToV1;

export function migratePersistedTrainingStateV1ToV2(
  value: unknown,
): LegacyPersistedTrainingStateV2 {
  const parsed = parsePersistedTrainingStateV1(value);
  if (parsed === null) {
    throw new Error('Training-store version 1 state is invalid.');
  }

  const customTrainingSets: LegacyTrainingSetV2[] = parsed.customTrainingSets.map(
    (trainingSet) => ({
      id: trainingSet.id,
      name: trainingSet.name,
      description: trainingSet.description,
      category: 'custom',
      sections: [
        {
          id: `${trainingSet.id}-exercises`,
          label: 'Exercises',
          steps: trainingSet.steps,
        },
      ],
      isBuiltIn: false,
    }),
  );
  const migrated = { dashboardEntries: parsed.dashboardEntries, customTrainingSets };
  const result = parsePersistedTrainingStateV2(migrated);
  if (result === null) {
    throw new Error('Training-store version 1 migration produced invalid state.');
  }
  return result;
}

export const migrateV1ToV2 = migratePersistedTrainingStateV1ToV2;

function migrateLegacyTrainingStepV2ToV3(step: LegacyTrainingStep): LegacyTrainingStepV4 {
  const values: Record<LegacyTrainingQuantityUnit, number | null> = {
    repetitions: null,
    sets: null,
    minutes: null,
    rounds: null,
  };
  if (step.defaultReps !== null) {
    const unit = step.repUnit === 'custom' ? 'repetitions' : step.repUnit;
    values[unit] = step.defaultReps;
  }
  return { ...step, quantities: createLegacyTrainingQuantities(values) };
}

export function migratePersistedTrainingStateV2ToV3(
  value: unknown,
): LegacyPersistedTrainingStateV3 {
  const parsed = parsePersistedTrainingStateV2(value);
  if (parsed === null) {
    throw new Error('Training-store version 2 state is invalid.');
  }

  const customTrainingSets: LegacyTrainingSetV4[] = parsed.customTrainingSets.map(
    (trainingSet) => ({
      id: trainingSet.id,
      name: trainingSet.name,
      description: trainingSet.description,
      category: trainingSet.category,
      sections: trainingSet.sections.map((section) => ({
        id: section.id,
        label: section.label,
        steps: section.steps.map(migrateLegacyTrainingStepV2ToV3),
      })),
      isBuiltIn: false,
    }),
  );
  const migrated = { dashboardEntries: parsed.dashboardEntries, customTrainingSets };
  const result = parsePersistedTrainingStateV3(migrated);
  if (result === null) {
    throw new Error('Training-store version 2 migration produced invalid state.');
  }
  return result;
}

export const migrateV2ToV3 = migratePersistedTrainingStateV2ToV3;

function collectKnownLegacyOverrideUnits(
  customTrainingSets: readonly LegacyTrainingSetV4[],
): ReadonlyMap<string, TrainingQuantityUnit> {
  const units = new Map<string, TrainingQuantityUnit>();
  for (const trainingSet of DEFAULT_TRAINING_SETS) {
    for (const activity of getTrainingSetActivities(trainingSet)) {
      units.set(activity.id, 'repetitions');
    }
  }
  for (const trainingSet of customTrainingSets) {
    for (const section of trainingSet.sections) {
      for (const step of section.steps) {
        units.set(step.id, step.repUnit === 'custom' ? 'repetitions' : step.repUnit);
      }
    }
  }
  return units;
}

function migrateLegacyDashboardEntryV3ToV4(
  entry: LegacyDashboardEntry,
  unitsByActivityId: ReadonlyMap<string, TrainingQuantityUnit>,
): DashboardEntry {
  const quantityOverrideEntries: [string, TrainingQuantityOverrides][] = Object.entries(
    entry.repOverrides,
  ).map(([activityId, value]) => [
    activityId,
    { [unitsByActivityId.get(activityId) ?? 'repetitions']: value },
  ]);

  return {
    id: entry.id,
    trainingSetId: entry.trainingSetId,
    quantityOverrides: Object.fromEntries(quantityOverrideEntries),
    notes: entry.notes,
    createdAt: entry.createdAt,
  };
}

export function migratePersistedTrainingStateV3ToV4(
  value: unknown,
): LegacyPersistedTrainingStateV4 {
  const parsed = parsePersistedTrainingStateV3(value);
  if (parsed === null) {
    throw new Error('Training-store version 3 state is invalid.');
  }

  const unitsByActivityId = collectKnownLegacyOverrideUnits(parsed.customTrainingSets);
  const migrated = {
    dashboardEntries: parsed.dashboardEntries.map((entry) =>
      migrateLegacyDashboardEntryV3ToV4(entry, unitsByActivityId),
    ),
    customTrainingSets: parsed.customTrainingSets,
  };
  const result = parsePersistedTrainingStateV4(migrated);
  if (result === null) {
    throw new Error('Training-store version 3 migration produced invalid state.');
  }
  return result;
}

export const migrateV3ToV4 = migratePersistedTrainingStateV3ToV4;

function migrateLegacyQuantitiesV4ToV5(step: LegacyTrainingStepV4): TrainingQuantities | undefined {
  const values = new Map(step.quantities.map((quantity) => [quantity.unit, quantity.value]));
  const repetitions =
    values.get('repetitions') ?? (step.repUnit === 'custom' ? step.defaultReps : null);
  const sets = values.get('sets');
  const minutes = values.get('minutes');
  const rounds = values.get('rounds');
  const quantities: TrainingQuantities = {
    ...(repetitions === null || repetitions === undefined ? {} : { repetitions }),
    ...(sets === null || sets === undefined ? {} : { sets }),
    ...(rounds === null || rounds === undefined ? {} : { rounds }),
    ...(minutes === null || minutes === undefined
      ? {}
      : { duration: { unit: 'minutes', value: minutes } }),
  };
  return Object.keys(quantities).length === 0 ? undefined : quantities;
}

function migrateLegacyExerciseV4ToV5(step: LegacyTrainingStepV4): TrainingActivity {
  const quantities = migrateLegacyQuantitiesV4ToV5(step);
  return {
    id: step.id,
    name: step.label,
    ...(quantities === undefined ? {} : { quantities }),
    ...(step.description === undefined ? {} : { notes: step.description }),
    children: [],
  };
}

function migrateLegacySectionV4ToV5(section: LegacyTrainingSectionV4): TrainingActivity {
  return {
    id: section.id,
    name: section.label,
    children: section.steps.map(migrateLegacyExerciseV4ToV5),
  };
}

function migrateLegacyTrainingSetV4ToV5(trainingSet: LegacyTrainingSetV4): TrainingSet {
  return {
    id: asTrainingSetId(trainingSet.id),
    name: trainingSet.name,
    description: trainingSet.description,
    category: 'custom',
    activities: trainingSet.sections.map(migrateLegacySectionV4ToV5),
    isBuiltIn: false,
  };
}

export function migratePersistedTrainingStateV4ToV5(value: unknown): PersistedTrainingState {
  const parsed = parsePersistedTrainingStateV4(value);
  if (parsed === null) {
    throw new Error('Training-store version 4 state is invalid.');
  }

  const migrated = {
    dashboardEntries: parsed.dashboardEntries,
    customTrainingSets: parsed.customTrainingSets.map(migrateLegacyTrainingSetV4ToV5),
  };
  const result = parsePersistedTrainingState(migrated);
  if (result === null) {
    throw new Error('Training-store version 4 migration produced invalid state.');
  }
  return result;
}

export const migrateV4ToV5 = migratePersistedTrainingStateV4ToV5;

const INTERNATIONAL_DOJO_ID = asTrainingSetId('international-dojo-2-hour-session');
const CORRECTED_INTERNATIONAL_UCHIKOMI_ACTIVITY_ID =
  'international-dojo-2-hour-session-uchikomi-men-kote-kote-men-men';
const LEGACY_INTERNATIONAL_UCHIKOMI_ACTIVITY_IDS = [
  'international-dojo-2-hour-session-uchikomi-men-1',
  'international-dojo-2-hour-session-uchikomi-kote',
  'international-dojo-2-hour-session-uchikomi-kote-men',
  'international-dojo-2-hour-session-uchikomi-men-2',
] as const;
const INTERNATIONAL_UCHIKOMI_MIGRATION_ACTIVITY_IDS = [
  ...LEGACY_INTERNATIONAL_UCHIKOMI_ACTIVITY_IDS,
  CORRECTED_INTERNATIONAL_UCHIKOMI_ACTIVITY_ID,
] as const;
const INTERNATIONAL_UCHIKOMI_MIGRATION_ACTIVITY_ID_SET = new Set<string>(
  INTERNATIONAL_UCHIKOMI_MIGRATION_ACTIVITY_IDS,
);
const UNIVERSITY_VERSION_TWO_ID = asTrainingSetId('university-version-2');
const UNIVERSITY_VERSION_TWO_KAKARIGEIJO_ACTIVITY_ID =
  'university-version-2-kakarigeijo-kakarigeijo';

function createQuantityOverridesFromMap(
  values: ReadonlyMap<TrainingQuantityUnit, number>,
): TrainingQuantityOverrides {
  const repetitions = values.get('repetitions');
  const sets = values.get('sets');
  const rounds = values.get('rounds');
  const seconds = values.get('seconds');
  const minutes = values.get('minutes');
  return {
    ...(repetitions === undefined ? {} : { repetitions }),
    ...(sets === undefined ? {} : { sets }),
    ...(rounds === undefined ? {} : { rounds }),
    ...(seconds === undefined ? {} : { seconds }),
    ...(minutes === undefined ? {} : { minutes }),
  };
}

function migrateDashboardEntryV5ToV6(entry: DashboardEntry): DashboardEntry {
  if (entry.trainingSetId !== INTERNATIONAL_DOJO_ID) {
    return entry;
  }

  const relevantOverrides: {
    readonly activityId: string;
    readonly overrides: TrainingQuantityOverrides;
  }[] = [];
  for (const activityId of INTERNATIONAL_UCHIKOMI_MIGRATION_ACTIVITY_IDS) {
    const overrides = entry.quantityOverrides[activityId];
    if (overrides !== undefined) {
      relevantOverrides.push({ activityId, overrides });
    }
  }
  if (relevantOverrides.length === 0) {
    return entry;
  }

  const mergedValues = new Map<TrainingQuantityUnit, number>();
  for (const { overrides } of relevantOverrides) {
    for (const [unit, value] of Object.entries(overrides)) {
      if (!isTrainingQuantityUnit(unit) || !isValidTrainingQuantityValue(unit, value)) {
        throw new Error('Training-store version 5 state is invalid.');
      }
      const existingValue = mergedValues.get(unit);
      if (existingValue !== undefined && existingValue !== value) {
        const conflictingOverrides = relevantOverrides.flatMap(
          ({ activityId, overrides: candidateOverrides }) => {
            const candidateValue = candidateOverrides[unit];
            return candidateValue === undefined ? [] : [{ activityId, value: candidateValue }];
          },
        );
        throw new TrainingOverrideMigrationConflictError({
          dashboardEntryId: entry.id,
          unit,
          overrides: conflictingOverrides,
        });
      }
      mergedValues.set(unit, value);
    }
  }

  const quantityOverrides: Record<string, TrainingQuantityOverrides> = {};
  for (const [activityId, overrides] of Object.entries(entry.quantityOverrides)) {
    if (!INTERNATIONAL_UCHIKOMI_MIGRATION_ACTIVITY_ID_SET.has(activityId)) {
      quantityOverrides[activityId] = overrides;
    }
  }
  quantityOverrides[CORRECTED_INTERNATIONAL_UCHIKOMI_ACTIVITY_ID] =
    createQuantityOverridesFromMap(mergedValues);

  return { ...entry, quantityOverrides };
}

function migrateKakarigeijoDurationOverrideV5ToV6(entry: DashboardEntry): DashboardEntry {
  if (entry.trainingSetId !== UNIVERSITY_VERSION_TWO_ID) {
    return entry;
  }

  const overrides = entry.quantityOverrides[UNIVERSITY_VERSION_TWO_KAKARIGEIJO_ACTIVITY_ID];
  const seconds = overrides?.seconds;
  if (overrides === undefined || seconds === undefined) {
    return entry;
  }

  const migratedMinutes = seconds / 60;
  if (!isValidTrainingQuantityValue('minutes', migratedMinutes)) {
    throw new Error('Training-store version 5 state is invalid.');
  }
  if (overrides.minutes !== undefined && overrides.minutes !== migratedMinutes) {
    throw new TrainingDurationOverrideMigrationConflictError({
      dashboardEntryId: entry.id,
      activityId: UNIVERSITY_VERSION_TWO_KAKARIGEIJO_ACTIVITY_ID,
      seconds,
      minutes: overrides.minutes,
    });
  }

  const migratedValues = new Map<TrainingQuantityUnit, number>();
  for (const [unit, value] of Object.entries(overrides)) {
    if (!isTrainingQuantityUnit(unit) || !isValidTrainingQuantityValue(unit, value)) {
      throw new Error('Training-store version 5 state is invalid.');
    }
    if (unit !== 'seconds') {
      migratedValues.set(unit, value);
    }
  }
  migratedValues.set('minutes', migratedMinutes);

  return {
    ...entry,
    quantityOverrides: {
      ...entry.quantityOverrides,
      [UNIVERSITY_VERSION_TWO_KAKARIGEIJO_ACTIVITY_ID]:
        createQuantityOverridesFromMap(migratedValues),
    },
  };
}

export function migratePersistedTrainingStateV5ToV6(value: unknown): PersistedTrainingState {
  const parsed = parsePersistedTrainingState(value);
  if (parsed === null) {
    throw new Error('Training-store version 5 state is invalid.');
  }

  const migrated = {
    dashboardEntries: parsed.dashboardEntries.map((entry) =>
      migrateKakarigeijoDurationOverrideV5ToV6(migrateDashboardEntryV5ToV6(entry)),
    ),
    customTrainingSets: parsed.customTrainingSets,
  };
  const result = parsePersistedTrainingState(migrated);
  if (result === null) {
    throw new Error('Training-store version 5 migration produced invalid state.');
  }
  return result;
}

export const migrateV5ToV6 = migratePersistedTrainingStateV5ToV6;

const POLICE_TYPE_TWO_MAWARIGEIKO_ACTIVITY_ID =
  'police-dojo-asageiko-version-2-mawari-geiko-mawari-geiko';
const REMOVED_SENIOR_HIGH_SCHOOL_CORE_STRENGTH_ACTIVITY_ID =
  'senior-high-school-kendo-club-core-strength-training-core-strength-training';

function migrateDashboardEntryV6ToV7(entry: DashboardEntry): DashboardEntry {
  let changed = false;
  const quantityOverrides: Record<string, TrainingQuantityOverrides> = {};

  for (const [activityId, overrides] of Object.entries(entry.quantityOverrides)) {
    if (activityId === REMOVED_SENIOR_HIGH_SCHOOL_CORE_STRENGTH_ACTIVITY_ID) {
      changed = true;
      continue;
    }

    if (activityId === POLICE_TYPE_TWO_MAWARIGEIKO_ACTIVITY_ID) {
      const minutes = overrides.minutes;
      if (minutes === undefined) {
        changed = true;
        continue;
      }

      quantityOverrides[activityId] = { minutes };
      if (Object.keys(overrides).length !== 1) {
        changed = true;
      }
      continue;
    }

    quantityOverrides[activityId] = overrides;
  }

  return changed ? { ...entry, quantityOverrides } : entry;
}

export function migratePersistedTrainingStateV6ToV7(value: unknown): PersistedTrainingState {
  const parsed = parsePersistedTrainingState(value);
  if (parsed === null) {
    throw new Error('Training-store version 6 state is invalid.');
  }

  const migrated = {
    dashboardEntries: parsed.dashboardEntries.map(migrateDashboardEntryV6ToV7),
    customTrainingSets: parsed.customTrainingSets,
  };
  const result = parsePersistedTrainingState(migrated);
  if (result === null) {
    throw new Error('Training-store version 6 migration produced invalid state.');
  }
  return result;
}

export const migrateV6ToV7 = migratePersistedTrainingStateV6ToV7;

export function migratePersistedTrainingState(
  persistedState: unknown,
  version: number,
): PersistedTrainingState {
  switch (version) {
    case 0: {
      const stateV1 = migratePersistedTrainingStateV0ToV1(persistedState);
      const stateV2 = migratePersistedTrainingStateV1ToV2(stateV1);
      const stateV3 = migratePersistedTrainingStateV2ToV3(stateV2);
      const stateV4 = migratePersistedTrainingStateV3ToV4(stateV3);
      const stateV5 = migratePersistedTrainingStateV4ToV5(stateV4);
      const stateV6 = migratePersistedTrainingStateV5ToV6(stateV5);
      return migratePersistedTrainingStateV6ToV7(stateV6);
    }
    case 1: {
      const stateV2 = migratePersistedTrainingStateV1ToV2(persistedState);
      const stateV3 = migratePersistedTrainingStateV2ToV3(stateV2);
      const stateV4 = migratePersistedTrainingStateV3ToV4(stateV3);
      const stateV5 = migratePersistedTrainingStateV4ToV5(stateV4);
      const stateV6 = migratePersistedTrainingStateV5ToV6(stateV5);
      return migratePersistedTrainingStateV6ToV7(stateV6);
    }
    case 2: {
      const stateV3 = migratePersistedTrainingStateV2ToV3(persistedState);
      const stateV4 = migratePersistedTrainingStateV3ToV4(stateV3);
      const stateV5 = migratePersistedTrainingStateV4ToV5(stateV4);
      const stateV6 = migratePersistedTrainingStateV5ToV6(stateV5);
      return migratePersistedTrainingStateV6ToV7(stateV6);
    }
    case 3: {
      const stateV4 = migratePersistedTrainingStateV3ToV4(persistedState);
      const stateV5 = migratePersistedTrainingStateV4ToV5(stateV4);
      const stateV6 = migratePersistedTrainingStateV5ToV6(stateV5);
      return migratePersistedTrainingStateV6ToV7(stateV6);
    }
    case 4: {
      const stateV5 = migratePersistedTrainingStateV4ToV5(persistedState);
      const stateV6 = migratePersistedTrainingStateV5ToV6(stateV5);
      return migratePersistedTrainingStateV6ToV7(stateV6);
    }
    case 5: {
      const stateV6 = migratePersistedTrainingStateV5ToV6(persistedState);
      return migratePersistedTrainingStateV6ToV7(stateV6);
    }
    case 6:
      return migratePersistedTrainingStateV6ToV7(persistedState);
    case TRAINING_STORE_PERSISTENCE_VERSION: {
      const stateV7 = parsePersistedTrainingState(persistedState);
      if (stateV7 === null) {
        throw new Error('Training-store version 7 state is invalid.');
      }
      return stateV7;
    }
    default:
      throw new Error(`Unsupported training-store persistence version: ${String(version)}`);
  }
}

function assertStorageCompatibleActivity(activity: TrainingActivity, path: string): void {
  if (activity.editableQuantityUnits !== undefined || activity.allowsSessionNotes !== undefined) {
    throw new Error(`${path} contains activity metadata unsupported by v7 custom-set storage.`);
  }
}

function encodePersistedTrainingExercise(
  activity: TrainingActivity,
  path: string,
): PersistedTrainingExercise {
  assertStorageCompatibleActivity(activity, path);
  if (activity.children.length > 0) {
    throw new Error(`${path}.children contains unsupported nested custom activities.`);
  }
  return {
    id: activity.id,
    name: activity.name,
    ...(activity.quantities === undefined ? {} : { quantities: activity.quantities }),
    ...(activity.notes === undefined ? {} : { notes: activity.notes }),
  };
}

function encodePersistedTrainingSection(
  activity: TrainingActivity,
  path: string,
): PersistedTrainingSection {
  assertStorageCompatibleActivity(activity, path);
  return {
    id: activity.id,
    name: activity.name,
    ...(activity.quantities === undefined ? {} : { quantities: activity.quantities }),
    ...(activity.notes === undefined ? {} : { notes: activity.notes }),
    exercises: activity.children.map((child, index) =>
      encodePersistedTrainingExercise(child, `${path}.children[${index}]`),
    ),
  };
}

function encodePersistedCustomTrainingSet(
  trainingSet: TrainingSet,
  index: number,
): PersistedCustomTrainingSet {
  if (
    trainingSet.isBuiltIn !== false ||
    trainingSet.category !== 'custom' ||
    trainingSet.sourceId !== undefined
  ) {
    throw new Error(`customTrainingSets[${index}] must be a custom user-authored training set.`);
  }
  return {
    id: trainingSet.id,
    name: trainingSet.name,
    ...(trainingSet.description === undefined ? {} : { description: trainingSet.description }),
    category: 'custom',
    sections: trainingSet.activities.map((activity, activityIndex) =>
      encodePersistedTrainingSection(
        activity,
        `customTrainingSets[${index}].activities[${activityIndex}]`,
      ),
    ),
    isBuiltIn: false,
  };
}

/** Encode canonical state into the unchanged v7 two-level sections/exercises storage DTO. */
export function encodePersistedTrainingState(value: unknown): PersistedTrainingWireState {
  const parsed = parsePersistedTrainingState(value);
  if (parsed === null) {
    throw new Error('Training-store state is invalid and cannot be encoded.');
  }
  return {
    dashboardEntries: parsed.dashboardEntries,
    customTrainingSets: parsed.customTrainingSets.map(encodePersistedCustomTrainingSet),
  };
}

function parseStorageValue(value: unknown): StorageValue<PersistedStorageState> | null {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, new Set(['state', 'version'])) ||
    !Object.hasOwn(value, 'state') ||
    typeof value['version'] !== 'number' ||
    !Number.isInteger(value['version']) ||
    value['version'] < 0
  ) {
    throw new Error('Training-store persistence envelope is invalid.');
  }

  const version = value['version'];
  if (version > TRAINING_STORE_PERSISTENCE_VERSION) {
    throw new Error(`Unsupported training-store persistence version: ${String(version)}`);
  }
  if (version === TRAINING_STORE_PERSISTENCE_VERSION) {
    const state = parsePersistedTrainingWireState(value['state']);
    if (state === null) {
      throw new Error('Training-store persistence data is invalid.');
    }
    return { state, version };
  }

  switch (version) {
    case 0:
    case 1: {
      const state = parsePersistedTrainingStateV1(value['state']);
      if (state === null) {
        throw new Error('Training-store legacy persistence data is invalid.');
      }
      return { state, version };
    }
    case 2: {
      const state = parsePersistedTrainingStateV2(value['state']);
      if (state === null) {
        throw new Error('Training-store version 2 persistence data is invalid.');
      }
      return { state, version };
    }
    case 3: {
      const state = parsePersistedTrainingStateV3(value['state']);
      if (state === null) {
        throw new Error('Training-store version 3 persistence data is invalid.');
      }
      return { state, version };
    }
    case 4: {
      const state = parsePersistedTrainingStateV4(value['state']);
      if (state === null) {
        throw new Error('Training-store version 4 persistence data is invalid.');
      }
      return { state, version };
    }
    case 5: {
      const state = parsePersistedTrainingWireState(value['state']);
      if (state === null) {
        throw new Error('Training-store version 5 persistence data is invalid.');
      }
      return { state, version };
    }
    case 6: {
      const state = parsePersistedTrainingWireState(value['state']);
      if (state === null) {
        throw new Error('Training-store version 6 persistence data is invalid.');
      }
      return { state, version };
    }
    default:
      throw new Error(`Unsupported training-store persistence version: ${String(version)}`);
  }
}

export function createTrainingJSONStorage(
  storage: StateStorage,
): PersistStorage<PersistedStorageState> {
  const jsonStorage = createJSONStorage<unknown>(() => storage);
  if (jsonStorage === undefined) {
    throw new Error('Training-store storage is unavailable.');
  }

  return {
    getItem: (name) => {
      const storedValue = jsonStorage.getItem(name);
      return isPromiseLike(storedValue)
        ? storedValue.then(parseStorageValue)
        : parseStorageValue(storedValue);
    },
    setItem: (name, value) => {
      const state = encodePersistedTrainingState(value.state);
      const encodedValue =
        value.version === undefined ? { state } : { state, version: value.version };
      return jsonStorage.setItem(name, encodedValue);
    },
    removeItem: (name) => jsonStorage.removeItem(name),
  };
}

function classifyParsedEnvelope(value: unknown): TrainingStorageInspection {
  if (!isRecord(value) || !hasOnlyProperties(value, new Set(['state', 'version']))) {
    return { status: 'corrupt', kind: 'corrupt', reason: 'malformed-envelope' };
  }
  const version = value['version'];
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 0 ||
    !Object.hasOwn(value, 'state')
  ) {
    return { status: 'corrupt', kind: 'corrupt', reason: 'malformed-envelope' };
  }
  if (version > TRAINING_STORE_PERSISTENCE_VERSION) {
    return { status: 'unsupported-future', kind: 'unsupported-future', version };
  }
  if (version === TRAINING_STORE_PERSISTENCE_VERSION) {
    const state = parsePersistedTrainingWireState(value['state']);
    return state === null
      ? { status: 'corrupt', kind: 'corrupt', reason: 'invalid-domain' }
      : { status: 'ready', kind: 'ready', version, state };
  }

  try {
    const persistedState =
      version === 5 || version === 6
        ? parsePersistedTrainingWireState(value['state'])
        : value['state'];
    if (persistedState === null) {
      return { status: 'corrupt', kind: 'corrupt', reason: 'invalid-domain' };
    }
    const state = migratePersistedTrainingState(persistedState, version);
    switch (version) {
      case 0:
      case 1:
      case 2:
      case 3:
      case 4:
      case 5:
      case 6:
        return {
          status: 'migrated',
          kind: 'migrated',
          fromVersion: version,
          version: TRAINING_STORE_PERSISTENCE_VERSION,
          state,
        };
      default:
        return { status: 'corrupt', kind: 'corrupt', reason: 'invalid-domain' };
    }
  } catch (error) {
    if (
      error instanceof TrainingOverrideMigrationConflictError ||
      error instanceof TrainingDurationOverrideMigrationConflictError
    ) {
      return {
        status: 'corrupt',
        kind: 'corrupt',
        reason: 'override-migration-conflict',
        detail: error.message,
        conflict: error.conflict,
      };
    }
    return { status: 'corrupt', kind: 'corrupt', reason: 'invalid-domain' };
  }
}

export function classifyTrainingStorageValue(
  rawValue: string | null | undefined,
): TrainingStorageInspection {
  if (rawValue === undefined) {
    return { status: 'unavailable', kind: 'unavailable' };
  }
  if (rawValue === null) {
    return { status: 'empty', kind: 'empty' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return { status: 'corrupt', kind: 'corrupt', reason: 'malformed-json' };
  }
  return classifyParsedEnvelope(parsed);
}

export const classifyPersistedStorage = classifyTrainingStorageValue;
export const inspectTrainingRawValue = classifyTrainingStorageValue;
export const classifyRawTrainingStorage = classifyTrainingStorageValue;

export function inspectTrainingStorage(
  storage: StateStorage,
  storageKey = 'kendo-menu',
): TrainingStorageInspection | Promise<TrainingStorageInspection> {
  try {
    const rawValue = storage.getItem(storageKey);
    if (isPromiseLike(rawValue)) {
      return rawValue
        .then((value) => classifyTrainingStorageValue(value))
        .catch(() => ({ status: 'unavailable', kind: 'unavailable' }));
    }
    return classifyTrainingStorageValue(rawValue);
  } catch {
    return { status: 'unavailable', kind: 'unavailable' };
  }
}

export const classifyTrainingStorage = inspectTrainingStorage;
export const inspectPersistedTrainingStorage = inspectTrainingStorage;
