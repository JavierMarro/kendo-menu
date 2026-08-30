import {
  DEFAULT_TRAINING_SETS,
  asTrainingSetId,
  cloneTrainingSet,
  getTrainingSetActivities,
  isCustomTrainingIntensity,
  isTrainingQuantityUnit,
  isValidRepetitionCount,
  isValidTrainingQuantities,
  isValidTrainingQuantityValue,
  validateTrainingSet,
  type DashboardActivityNotes,
  type DashboardEntry,
  type DashboardQuantityOverrides,
  type DrillCategory,
  type CustomTrainingIntensity,
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

export const TRAINING_STORE_PERSISTENCE_VERSION = 10;

/** Runtime shape persisted by version 9. Kept solely for migration callers. */
export interface PersistedTrainingStateV9 {
  readonly dashboardEntries: readonly DashboardEntry[];
  readonly customTrainingSets: readonly TrainingSet[];
}

/** Compatibility name for the pre-v10 runtime persistence shape. */
export type PersistedTrainingState = PersistedTrainingStateV9;

/** Runtime shape persisted by the current store. */
export interface PersistedTrainingStateV10 {
  readonly dashboardEntries: readonly DashboardEntry[];
}

/** The v5-v9 storage DTO retained for the on-disk two-level sections/exercises shape. */
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
  readonly customIntensity?: CustomTrainingIntensity;
  readonly sections: readonly PersistedTrainingSection[];
  readonly isBuiltIn: false;
}

export interface PersistedTrainingWireState {
  readonly dashboardEntries: readonly DashboardEntry[];
  readonly customTrainingSets: readonly PersistedCustomTrainingSet[];
}

/** Compatibility name for the pre-v10 wire persistence shape. */
export type PersistedTrainingWireStateV9 = PersistedTrainingWireState;

/** Current embedded custom snapshot wire shape. */
export interface PersistedDashboardEntryV10 {
  readonly id: string;
  readonly trainingSetId: TrainingSet['id'];
  readonly trainingSet?: PersistedCustomTrainingSet;
  readonly quantityOverrides: DashboardQuantityOverrides;
  readonly activityNotes: DashboardActivityNotes;
  readonly notes: string;
  readonly createdAt: string;
}

export interface PersistedTrainingWireStateV10 {
  readonly dashboardEntries: readonly PersistedDashboardEntryV10[];
}

/** Dashboard entries as persisted by versions 5 through 8, before activity notes existed. */
export interface PersistedDashboardEntryV8 {
  readonly id: string;
  readonly trainingSetId: TrainingSet['id'];
  readonly quantityOverrides: DashboardQuantityOverrides;
  readonly notes: string;
  readonly createdAt: string;
}

/** Runtime-shaped state produced by the v8 parser, before the v8→v9 note migration. */
export interface PersistedTrainingStateV8 {
  readonly dashboardEntries: readonly PersistedDashboardEntryV8[];
  readonly customTrainingSets: readonly TrainingSet[];
}

/** The v5-v8 on-disk wire DTO, retained for the complete migration chain. */
export interface PersistedTrainingWireStateV8 {
  readonly dashboardEntries: readonly PersistedDashboardEntryV8[];
  readonly customTrainingSets: readonly PersistedCustomTrainingSet[];
}

export type PersistedTrainingStateV5 = PersistedTrainingWireStateV8;
export type PersistedTrainingStateV6 = PersistedTrainingWireStateV8;
export type PersistedTrainingStateV7 = PersistedTrainingWireStateV8;

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
  readonly dashboardEntries: readonly PersistedDashboardEntryV8[];
  readonly customTrainingSets: readonly LegacyTrainingSetV4[];
}

export type PersistedStorageState =
  | PersistedTrainingState
  | PersistedTrainingStateV10
  | PersistedTrainingWireState
  | PersistedTrainingStateV8
  | PersistedTrainingWireStateV8
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
      readonly state: PersistedTrainingStateV10;
    }
  | {
      readonly status: 'migrated';
      readonly kind: 'migrated';
      readonly fromVersion: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
      readonly version: typeof TRAINING_STORE_PERSISTENCE_VERSION;
      readonly state: PersistedTrainingStateV10;
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

function parseDashboardActivityNotes(value: unknown): DashboardActivityNotes | null {
  if (!isRecord(value)) {
    return null;
  }

  const entries: [string, string][] = [];
  for (const [activityId, note] of Object.entries(value)) {
    if (!isNonBlankString(activityId) || typeof note !== 'string') {
      return null;
    }
    entries.push([activityId, note]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function parseDashboardEntry(value: unknown): DashboardEntry | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(
      value,
      new Set(['id', 'trainingSetId', 'quantityOverrides', 'activityNotes', 'notes', 'createdAt']),
    )
  ) {
    return null;
  }
  const id = value['id'];
  const trainingSetId = value['trainingSetId'];
  const quantityOverrides = parseDashboardQuantityOverrides(value['quantityOverrides']);
  const activityNotes = parseDashboardActivityNotes(value['activityNotes']);
  const notes = value['notes'];
  const createdAt = value['createdAt'];
  if (
    !isNonBlankString(id) ||
    !isNonBlankString(trainingSetId) ||
    quantityOverrides === null ||
    activityNotes === null ||
    typeof notes !== 'string' ||
    typeof createdAt !== 'string'
  ) {
    return null;
  }
  return {
    id,
    trainingSetId: asTrainingSetId(trainingSetId),
    quantityOverrides,
    activityNotes,
    notes,
    createdAt,
  };
}

function parsePersistedDashboardEntryV8(value: unknown): PersistedDashboardEntryV8 | null {
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
      new Set([
        'id',
        'name',
        'description',
        'category',
        'customIntensity',
        'sections',
        'isBuiltIn',
      ]),
    ) ||
    !isNonBlankString(value['id']) ||
    !isNonBlankString(value['name']) ||
    (Object.hasOwn(value, 'description') && typeof value['description'] !== 'string') ||
    value['category'] !== 'custom' ||
    (Object.hasOwn(value, 'customIntensity') &&
      !isCustomTrainingIntensity(value['customIntensity'])) ||
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
    ...(isCustomTrainingIntensity(value['customIntensity'])
      ? { customIntensity: value['customIntensity'] }
      : {}),
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
    ...(trainingSet.customIntensity === undefined
      ? {}
      : { customIntensity: trainingSet.customIntensity }),
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

function sanitizeDashboardActivityNotes(
  entry: DashboardEntry,
  customTrainingSets: readonly TrainingSet[],
): DashboardEntry {
  const trainingSet = [...DEFAULT_TRAINING_SETS, ...customTrainingSets].find(
    (candidate) => candidate.id === entry.trainingSetId,
  );
  if (trainingSet === undefined) {
    return entry;
  }

  const eligibleActivityIds = new Set(
    getTrainingSetActivities(trainingSet)
      .filter((activity) => activity.allowsSessionNotes === true)
      .map((activity) => activity.id),
  );
  const activityNotesEntries: [string, string][] = [];
  for (const [activityId, note] of Object.entries(entry.activityNotes)) {
    if (eligibleActivityIds.has(activityId) && note.trim().length > 0) {
      activityNotesEntries.push([activityId, note]);
    }
  }
  return {
    ...entry,
    activityNotes: Object.freeze(Object.fromEntries(activityNotesEntries)),
  };
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
  return {
    dashboardEntries: dashboardEntries.map((entry) =>
      sanitizeDashboardActivityNotes(entry, customTrainingSets),
    ),
    customTrainingSets,
  };
}

/** Parse the v9 wire state before the v9→v10 ownership migration. */
export function parsePersistedTrainingWireStateV9(value: unknown): PersistedTrainingStateV9 | null {
  return parsePersistedTrainingWireState(value);
}

function parsePersistedTrainingWireStateV8(value: unknown): PersistedTrainingStateV8 | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, new Set(['dashboardEntries', 'customTrainingSets']))
  ) {
    return null;
  }
  const dashboardEntries = parseArray(value['dashboardEntries'], parsePersistedDashboardEntryV8);
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
  return sets.every((trainingSet) => !isCuratedTrainingSetId(trainingSet.id));
}

function isCuratedTrainingSetId(id: string): boolean {
  return DEFAULT_TRAINING_SETS.some((trainingSet) => trainingSet.id === id);
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
  return {
    dashboardEntries: dashboardEntries.map((entry) =>
      sanitizeDashboardActivityNotes(entry, customTrainingSets),
    ),
    customTrainingSets,
  };
}

/** Explicit parser for the v9 runtime state used by the v9→v10 migration. */
export function parsePersistedTrainingStateV9(value: unknown): PersistedTrainingStateV9 | null {
  return parsePersistedTrainingState(value);
}

export function parsePersistedTrainingStateV8(value: unknown): PersistedTrainingStateV8 | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, new Set(['dashboardEntries', 'customTrainingSets']))
  ) {
    return null;
  }
  const dashboardEntries = parseArray(value['dashboardEntries'], parsePersistedDashboardEntryV8);
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

function parsePersistedDashboardEntryV10(value: unknown): DashboardEntry | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(
      value,
      new Set([
        'id',
        'trainingSetId',
        'trainingSet',
        'quantityOverrides',
        'activityNotes',
        'notes',
        'createdAt',
      ]),
    )
  ) {
    return null;
  }

  const id = value['id'];
  const trainingSetId = value['trainingSetId'];
  const quantityOverrides = parseDashboardQuantityOverrides(value['quantityOverrides']);
  const activityNotes = parseDashboardActivityNotes(value['activityNotes']);
  const notes = value['notes'];
  const createdAt = value['createdAt'];
  if (
    !isNonBlankString(id) ||
    !isNonBlankString(trainingSetId) ||
    quantityOverrides === null ||
    activityNotes === null ||
    typeof notes !== 'string' ||
    typeof createdAt !== 'string'
  ) {
    return null;
  }

  let ownedTrainingSet: TrainingSet | undefined;
  if (Object.hasOwn(value, 'trainingSet')) {
    const trainingSetValue = value['trainingSet'];
    if (isRecord(trainingSetValue) && Object.hasOwn(trainingSetValue, 'activities')) {
      const validation = validateTrainingSet(trainingSetValue);
      if (!validation.success || validation.value.id !== trainingSetId) {
        return null;
      }
      if (validation.value.isBuiltIn === true) {
        const canonicalTrainingSet = DEFAULT_TRAINING_SETS.find(
          (trainingSet) => trainingSet.id === trainingSetId,
        );
        if (canonicalTrainingSet === undefined) {
          return null;
        }
        ownedTrainingSet = cloneTrainingSet(canonicalTrainingSet);
      } else if (
        !isCuratedTrainingSetId(validation.value.id) &&
        validation.value.category === 'custom' &&
        validation.value.sourceId === undefined
      ) {
        ownedTrainingSet = validation.value;
      } else {
        return null;
      }
    } else {
      const wireTrainingSet = parsePersistedCustomTrainingSetWire(trainingSetValue);
      if (
        wireTrainingSet === null ||
        wireTrainingSet.id !== trainingSetId ||
        isCuratedTrainingSetId(wireTrainingSet.id)
      ) {
        return null;
      }
      const decodedTrainingSet = decodePersistedCustomTrainingSet(wireTrainingSet);
      if (decodedTrainingSet === null) {
        return null;
      }
      ownedTrainingSet = cloneTrainingSet(decodedTrainingSet);
    }
  } else {
    const canonicalTrainingSet = DEFAULT_TRAINING_SETS.find(
      (trainingSet) => trainingSet.id === trainingSetId,
    );
    if (canonicalTrainingSet !== undefined) {
      ownedTrainingSet = cloneTrainingSet(canonicalTrainingSet);
    }
  }

  const entry: DashboardEntry = {
    id,
    trainingSetId: asTrainingSetId(trainingSetId),
    ...(ownedTrainingSet === undefined ? {} : { trainingSet: ownedTrainingSet }),
    quantityOverrides,
    activityNotes,
    notes,
    createdAt,
  };
  return sanitizeDashboardActivityNotesForTrainingSet(entry, ownedTrainingSet);
}

function sanitizeDashboardActivityNotesForTrainingSet(
  entry: DashboardEntry,
  trainingSet: TrainingSet | undefined,
): DashboardEntry {
  if (trainingSet === undefined) {
    return entry;
  }
  const eligibleActivityIds = new Set(
    getTrainingSetActivities(trainingSet)
      .filter((activity) => activity.allowsSessionNotes === true)
      .map((activity) => activity.id),
  );
  const activityNotesEntries: [string, string][] = [];
  for (const [activityId, note] of Object.entries(entry.activityNotes)) {
    if (eligibleActivityIds.has(activityId) && note.trim().length > 0) {
      activityNotesEntries.push([activityId, note]);
    }
  }
  return {
    ...entry,
    activityNotes: Object.freeze(Object.fromEntries(activityNotesEntries)),
  };
}

/** Parse the current v10 runtime state from an untrusted wire value. */
export function parsePersistedTrainingStateV10(value: unknown): PersistedTrainingStateV10 | null {
  if (!isRecord(value) || !hasOnlyProperties(value, new Set(['dashboardEntries']))) {
    return null;
  }
  const dashboardEntries = parseArray(value['dashboardEntries'], parsePersistedDashboardEntryV10);
  if (dashboardEntries === null || !validateUniqueEntryIds(dashboardEntries)) {
    return null;
  }
  return { dashboardEntries };
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
  const dashboardEntries = parseArray(value['dashboardEntries'], parsePersistedDashboardEntryV8);
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
): PersistedDashboardEntryV8 {
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

export function migratePersistedTrainingStateV4ToV5(value: unknown): PersistedTrainingStateV8 {
  const parsed = parsePersistedTrainingStateV4(value);
  if (parsed === null) {
    throw new Error('Training-store version 4 state is invalid.');
  }

  const migrated = {
    dashboardEntries: parsed.dashboardEntries,
    customTrainingSets: parsed.customTrainingSets.map(migrateLegacyTrainingSetV4ToV5),
  };
  const result = parsePersistedTrainingStateV8(migrated);
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

function migrateDashboardEntryV5ToV6(entry: PersistedDashboardEntryV8): PersistedDashboardEntryV8 {
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

  const quantityOverrideEntries: [string, TrainingQuantityOverrides][] = [];
  for (const [activityId, overrides] of Object.entries(entry.quantityOverrides)) {
    if (!INTERNATIONAL_UCHIKOMI_MIGRATION_ACTIVITY_ID_SET.has(activityId)) {
      quantityOverrideEntries.push([activityId, overrides]);
    }
  }
  quantityOverrideEntries.push([
    CORRECTED_INTERNATIONAL_UCHIKOMI_ACTIVITY_ID,
    createQuantityOverridesFromMap(mergedValues),
  ]);

  return { ...entry, quantityOverrides: Object.fromEntries(quantityOverrideEntries) };
}

function migrateKakarigeijoDurationOverrideV5ToV6(
  entry: PersistedDashboardEntryV8,
): PersistedDashboardEntryV8 {
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

export function migratePersistedTrainingStateV5ToV6(value: unknown): PersistedTrainingStateV8 {
  const parsed = parsePersistedTrainingStateV8(value);
  if (parsed === null) {
    throw new Error('Training-store version 5 state is invalid.');
  }

  const migrated = {
    dashboardEntries: parsed.dashboardEntries.map((entry) =>
      migrateKakarigeijoDurationOverrideV5ToV6(migrateDashboardEntryV5ToV6(entry)),
    ),
    customTrainingSets: parsed.customTrainingSets,
  };
  const result = parsePersistedTrainingStateV8(migrated);
  if (result === null) {
    throw new Error('Training-store version 5 migration produced invalid state.');
  }
  return result;
}

export const migrateV5ToV6 = migratePersistedTrainingStateV5ToV6;

const POLICE_TYPE_TWO_MAWARIGEIKO_ACTIVITY_ID =
  'police-dojo-asageiko-version-2-mawari-geiko-mawari-geiko';
const POLICE_TYPE_TWO_ID = asTrainingSetId('police-dojo-asageiko-version-2');
const REMOVED_SENIOR_HIGH_SCHOOL_CORE_STRENGTH_ACTIVITY_ID =
  'senior-high-school-kendo-club-core-strength-training-core-strength-training';
const SENIOR_HIGH_SCHOOL_ID = asTrainingSetId('senior-high-school-kendo-club');

function migrateDashboardEntryV6ToV7(entry: PersistedDashboardEntryV8): PersistedDashboardEntryV8 {
  let changed = false;
  const quantityOverrideEntries: [string, TrainingQuantityOverrides][] = [];

  for (const [activityId, overrides] of Object.entries(entry.quantityOverrides)) {
    if (
      entry.trainingSetId === SENIOR_HIGH_SCHOOL_ID &&
      activityId === REMOVED_SENIOR_HIGH_SCHOOL_CORE_STRENGTH_ACTIVITY_ID
    ) {
      changed = true;
      continue;
    }

    if (
      entry.trainingSetId === POLICE_TYPE_TWO_ID &&
      activityId === POLICE_TYPE_TWO_MAWARIGEIKO_ACTIVITY_ID
    ) {
      const minutes = overrides.minutes;
      if (minutes === undefined) {
        changed = true;
        continue;
      }

      quantityOverrideEntries.push([activityId, { minutes }]);
      if (Object.keys(overrides).length !== 1) {
        changed = true;
      }
      continue;
    }

    quantityOverrideEntries.push([activityId, overrides]);
  }

  return changed
    ? { ...entry, quantityOverrides: Object.fromEntries(quantityOverrideEntries) }
    : entry;
}

export function migratePersistedTrainingStateV6ToV7(value: unknown): PersistedTrainingStateV8 {
  const parsed = parsePersistedTrainingStateV8(value);
  if (parsed === null) {
    throw new Error('Training-store version 6 state is invalid.');
  }

  const migrated = {
    dashboardEntries: parsed.dashboardEntries.map(migrateDashboardEntryV6ToV7),
    customTrainingSets: parsed.customTrainingSets,
  };
  const result = parsePersistedTrainingStateV8(migrated);
  if (result === null) {
    throw new Error('Training-store version 6 migration produced invalid state.');
  }
  return result;
}

export const migrateV6ToV7 = migratePersistedTrainingStateV6ToV7;

const TOP_UNIVERSITY_CORRECTED_HIKI_SEQUENCE_ACTIVITY_ID =
  'top-university-yakusoku-geiko-hiki-do-men-kirikaeshi';
const TOP_UNIVERSITY_FREE_UCHIKOMI_ACTIVITY_ID = 'top-university-fee-version-uchikomi-geiko';
const TOP_UNIVERSITY_FREE_KAKARIGEIKO_ACTIVITY_ID = 'top-university-fee-version-kakari-geiko';
const TOP_UNIVERSITY_FINAL_KAKARIGEIKO_ACTIVITY_ID = 'top-university-kakarigeiko-kakarigeiko';
const TOP_UNIVERSITY_ID = asTrainingSetId('top-university');
const TOP_UNIVERSITY_SECONDS_ONLY_ACTIVITY_IDS = new Set<string>([
  TOP_UNIVERSITY_FREE_UCHIKOMI_ACTIVITY_ID,
  TOP_UNIVERSITY_FREE_KAKARIGEIKO_ACTIVITY_ID,
  TOP_UNIVERSITY_FINAL_KAKARIGEIKO_ACTIVITY_ID,
]);

function migrateDashboardEntryV7ToV8(entry: PersistedDashboardEntryV8): PersistedDashboardEntryV8 {
  if (entry.trainingSetId !== TOP_UNIVERSITY_ID) {
    return entry;
  }

  let changed = false;
  const quantityOverrideEntries: [string, TrainingQuantityOverrides][] = [];

  for (const [activityId, overrides] of Object.entries(entry.quantityOverrides)) {
    if (activityId === TOP_UNIVERSITY_CORRECTED_HIKI_SEQUENCE_ACTIVITY_ID) {
      if (!Object.hasOwn(overrides, 'repetitions')) {
        quantityOverrideEntries.push([activityId, overrides]);
        continue;
      }

      const migratedValues = new Map<TrainingQuantityUnit, number>();
      for (const [unit, value] of Object.entries(overrides)) {
        if (unit !== 'repetitions') {
          if (!isTrainingQuantityUnit(unit) || !isValidTrainingQuantityValue(unit, value)) {
            throw new Error('Training-store version 7 state is invalid.');
          }
          migratedValues.set(unit, value);
        }
      }
      const migratedOverrides = createQuantityOverridesFromMap(migratedValues);
      changed = true;
      if (Object.keys(migratedOverrides).length > 0) {
        quantityOverrideEntries.push([activityId, migratedOverrides]);
      }
      continue;
    }

    if (TOP_UNIVERSITY_SECONDS_ONLY_ACTIVITY_IDS.has(activityId)) {
      const seconds = overrides.seconds;
      if (seconds === undefined) {
        changed = true;
        continue;
      }
      quantityOverrideEntries.push([activityId, { seconds }]);
      if (Object.keys(overrides).length !== 1) {
        changed = true;
      }
      continue;
    }

    quantityOverrideEntries.push([activityId, overrides]);
  }

  return changed
    ? { ...entry, quantityOverrides: Object.fromEntries(quantityOverrideEntries) }
    : entry;
}

export function migratePersistedTrainingStateV7ToV8(value: unknown): PersistedTrainingStateV8 {
  const parsed = parsePersistedTrainingStateV8(value);
  if (parsed === null) {
    throw new Error('Training-store version 7 state is invalid.');
  }

  const migrated = {
    dashboardEntries: parsed.dashboardEntries.map(migrateDashboardEntryV7ToV8),
    customTrainingSets: parsed.customTrainingSets,
  };
  const result = parsePersistedTrainingStateV8(migrated);
  if (result === null) {
    throw new Error('Training-store version 7 migration produced invalid state.');
  }
  return result;
}

export const migrateV7ToV8 = migratePersistedTrainingStateV7ToV8;

export function migratePersistedTrainingStateV8ToV9(value: unknown): PersistedTrainingState {
  const parsed = parsePersistedTrainingStateV8(value);
  if (parsed === null) {
    throw new Error('Training-store version 8 state is invalid.');
  }

  const migrated = {
    dashboardEntries: parsed.dashboardEntries.map((entry) => ({
      ...entry,
      activityNotes: {},
    })),
    customTrainingSets: parsed.customTrainingSets,
  };
  const result = parsePersistedTrainingState(migrated);
  if (result === null) {
    throw new Error('Training-store version 8 migration produced invalid state.');
  }
  return result;
}

export const migrateV8ToV9 = migratePersistedTrainingStateV8ToV9;

/**
 * Move v9's shared custom-set collection into independent dashboard-owned snapshots.
 * Curated entries are cloned from the canonical defaults; unreferenced custom sets are dropped.
 */
export function migratePersistedTrainingStateV9ToV10(value: unknown): PersistedTrainingStateV10 {
  const parsed = parsePersistedTrainingStateV9(value);
  if (parsed === null) {
    throw new Error('Training-store version 9 state is invalid.');
  }

  const migratedEntries = parsed.dashboardEntries.map((entry) => {
    const source = [...DEFAULT_TRAINING_SETS, ...parsed.customTrainingSets].find(
      (trainingSet) => trainingSet.id === entry.trainingSetId,
    );
    if (source === undefined) {
      return entry;
    }
    const ownedTrainingSet = cloneTrainingSet(source);
    return sanitizeDashboardActivityNotesForTrainingSet(
      { ...entry, trainingSet: ownedTrainingSet },
      ownedTrainingSet,
    );
  });

  return { dashboardEntries: migratedEntries };
}

export const migrateV9ToV10 = migratePersistedTrainingStateV9ToV10;

export function migratePersistedTrainingState(
  persistedState: unknown,
  version: number,
): PersistedTrainingStateV10 {
  switch (version) {
    case 0: {
      const stateV1 = migratePersistedTrainingStateV0ToV1(persistedState);
      const stateV2 = migratePersistedTrainingStateV1ToV2(stateV1);
      const stateV3 = migratePersistedTrainingStateV2ToV3(stateV2);
      const stateV4 = migratePersistedTrainingStateV3ToV4(stateV3);
      const stateV5 = migratePersistedTrainingStateV4ToV5(stateV4);
      const stateV6 = migratePersistedTrainingStateV5ToV6(stateV5);
      const stateV7 = migratePersistedTrainingStateV6ToV7(stateV6);
      const stateV8 = migratePersistedTrainingStateV7ToV8(stateV7);
      return migratePersistedTrainingStateV9ToV10(migratePersistedTrainingStateV8ToV9(stateV8));
    }
    case 1: {
      const stateV2 = migratePersistedTrainingStateV1ToV2(persistedState);
      const stateV3 = migratePersistedTrainingStateV2ToV3(stateV2);
      const stateV4 = migratePersistedTrainingStateV3ToV4(stateV3);
      const stateV5 = migratePersistedTrainingStateV4ToV5(stateV4);
      const stateV6 = migratePersistedTrainingStateV5ToV6(stateV5);
      const stateV7 = migratePersistedTrainingStateV6ToV7(stateV6);
      const stateV8 = migratePersistedTrainingStateV7ToV8(stateV7);
      return migratePersistedTrainingStateV9ToV10(migratePersistedTrainingStateV8ToV9(stateV8));
    }
    case 2: {
      const stateV3 = migratePersistedTrainingStateV2ToV3(persistedState);
      const stateV4 = migratePersistedTrainingStateV3ToV4(stateV3);
      const stateV5 = migratePersistedTrainingStateV4ToV5(stateV4);
      const stateV6 = migratePersistedTrainingStateV5ToV6(stateV5);
      const stateV7 = migratePersistedTrainingStateV6ToV7(stateV6);
      const stateV8 = migratePersistedTrainingStateV7ToV8(stateV7);
      return migratePersistedTrainingStateV9ToV10(migratePersistedTrainingStateV8ToV9(stateV8));
    }
    case 3: {
      const stateV4 = migratePersistedTrainingStateV3ToV4(persistedState);
      const stateV5 = migratePersistedTrainingStateV4ToV5(stateV4);
      const stateV6 = migratePersistedTrainingStateV5ToV6(stateV5);
      const stateV7 = migratePersistedTrainingStateV6ToV7(stateV6);
      const stateV8 = migratePersistedTrainingStateV7ToV8(stateV7);
      return migratePersistedTrainingStateV9ToV10(migratePersistedTrainingStateV8ToV9(stateV8));
    }
    case 4: {
      const stateV5 = migratePersistedTrainingStateV4ToV5(persistedState);
      const stateV6 = migratePersistedTrainingStateV5ToV6(stateV5);
      const stateV7 = migratePersistedTrainingStateV6ToV7(stateV6);
      const stateV8 = migratePersistedTrainingStateV7ToV8(stateV7);
      return migratePersistedTrainingStateV9ToV10(migratePersistedTrainingStateV8ToV9(stateV8));
    }
    case 5: {
      const stateV6 = migratePersistedTrainingStateV5ToV6(persistedState);
      const stateV7 = migratePersistedTrainingStateV6ToV7(stateV6);
      const stateV8 = migratePersistedTrainingStateV7ToV8(stateV7);
      return migratePersistedTrainingStateV9ToV10(migratePersistedTrainingStateV8ToV9(stateV8));
    }
    case 6: {
      const stateV7 = migratePersistedTrainingStateV6ToV7(persistedState);
      const stateV8 = migratePersistedTrainingStateV7ToV8(stateV7);
      return migratePersistedTrainingStateV9ToV10(migratePersistedTrainingStateV8ToV9(stateV8));
    }
    case 7:
      return migratePersistedTrainingStateV9ToV10(
        migratePersistedTrainingStateV8ToV9(migratePersistedTrainingStateV7ToV8(persistedState)),
      );
    case 8:
      return migratePersistedTrainingStateV9ToV10(
        migratePersistedTrainingStateV8ToV9(persistedState),
      );
    case 9:
      return migratePersistedTrainingStateV9ToV10(persistedState);
    case TRAINING_STORE_PERSISTENCE_VERSION: {
      const stateV10 = parsePersistedTrainingStateV10(persistedState);
      if (stateV10 === null) {
        throw new Error('Training-store version 10 state is invalid.');
      }
      return stateV10;
    }
    default:
      throw new Error(`Unsupported training-store persistence version: ${String(version)}`);
  }
}

function assertStorageCompatibleActivity(activity: TrainingActivity, path: string): void {
  if (activity.editableQuantityUnits !== undefined || activity.allowsSessionNotes !== undefined) {
    throw new Error(`${path} contains activity metadata unsupported by custom-set storage.`);
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
    ...(trainingSet.customIntensity === undefined
      ? {}
      : { customIntensity: trainingSet.customIntensity }),
    sections: trainingSet.activities.map((activity, activityIndex) =>
      encodePersistedTrainingSection(
        activity,
        `customTrainingSets[${index}].activities[${activityIndex}]`,
      ),
    ),
    isBuiltIn: false,
  };
}

/** Encode canonical state into the unchanged two-level sections/exercises storage DTO. */
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

function parseRuntimeDashboardEntry(value: unknown): DashboardEntry | null {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(
      value,
      new Set([
        'id',
        'trainingSetId',
        'trainingSet',
        'quantityOverrides',
        'activityNotes',
        'notes',
        'createdAt',
      ]),
    )
  ) {
    return null;
  }
  const id = value['id'];
  const trainingSetId = value['trainingSetId'];
  const quantityOverrides = parseDashboardQuantityOverrides(value['quantityOverrides']);
  const activityNotes = parseDashboardActivityNotes(value['activityNotes']);
  const notes = value['notes'];
  const createdAt = value['createdAt'];
  if (
    !isNonBlankString(id) ||
    !isNonBlankString(trainingSetId) ||
    quantityOverrides === null ||
    activityNotes === null ||
    typeof notes !== 'string' ||
    typeof createdAt !== 'string'
  ) {
    return null;
  }
  let trainingSet: TrainingSet | undefined;
  if (Object.hasOwn(value, 'trainingSet')) {
    const trainingSetValue = value['trainingSet'];
    if (!isRecord(trainingSetValue)) {
      return null;
    }
    if (trainingSetValue['isBuiltIn'] === true) {
      const canonicalTrainingSet = DEFAULT_TRAINING_SETS.find(
        (candidate) => candidate.id === trainingSetId,
      );
      if (canonicalTrainingSet === undefined || trainingSetValue['id'] !== trainingSetId) {
        return null;
      }
      // Built-in snapshots are validated by their stable id and canonicalized on load.
    } else {
      const validation = validateTrainingSet(trainingSetValue);
      if (
        !validation.success ||
        validation.value.id !== trainingSetId ||
        validation.value.category !== 'custom' ||
        validation.value.sourceId !== undefined ||
        isCuratedTrainingSetId(validation.value.id)
      ) {
        return null;
      }
      trainingSet = validation.value;
    }
  }
  return sanitizeDashboardActivityNotesForTrainingSet(
    {
      id,
      trainingSetId: asTrainingSetId(trainingSetId),
      ...(trainingSet === undefined ? {} : { trainingSet }),
      quantityOverrides,
      activityNotes,
      notes,
      createdAt,
    },
    trainingSet,
  );
}

/** Encode the current v10 runtime state, embedding only custom dashboard snapshots. */
export function encodePersistedTrainingStateV10(value: unknown): PersistedTrainingWireStateV10 {
  if (!isRecord(value) || !hasOnlyProperties(value, new Set(['dashboardEntries']))) {
    throw new Error('Training-store state is invalid and cannot be encoded.');
  }
  const dashboardEntries = parseArray(value['dashboardEntries'], parseRuntimeDashboardEntry);
  if (dashboardEntries === null || !validateUniqueEntryIds(dashboardEntries)) {
    throw new Error('Training-store state is invalid and cannot be encoded.');
  }
  return {
    dashboardEntries: dashboardEntries.map((entry, index) => {
      const trainingSet = entry.trainingSet;
      if (trainingSet === undefined || trainingSet.isBuiltIn === true) {
        return {
          id: entry.id,
          trainingSetId: entry.trainingSetId,
          quantityOverrides: entry.quantityOverrides,
          activityNotes: entry.activityNotes,
          notes: entry.notes,
          createdAt: entry.createdAt,
        };
      }
      if (trainingSet.id !== entry.trainingSetId || trainingSet.category !== 'custom') {
        throw new Error(`dashboardEntries[${index}].trainingSet does not match its entry.`);
      }
      return {
        id: entry.id,
        trainingSetId: entry.trainingSetId,
        trainingSet: encodePersistedCustomTrainingSet(trainingSet, index),
        quantityOverrides: entry.quantityOverrides,
        activityNotes: entry.activityNotes,
        notes: entry.notes,
        createdAt: entry.createdAt,
      };
    }),
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
    const state = parsePersistedTrainingStateV10(value['state']);
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
    case 5:
    case 6:
    case 7:
    case 8: {
      const state = parsePersistedTrainingWireStateV8(value['state']);
      if (state === null) {
        throw new Error(`Training-store version ${String(version)} persistence data is invalid.`);
      }
      return { state, version };
    }
    case 9: {
      const state = parsePersistedTrainingWireStateV9(value['state']);
      if (state === null) {
        throw new Error('Training-store version 9 persistence data is invalid.');
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
      const state = encodePersistedTrainingStateV10(value.state);
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
    const state = parsePersistedTrainingStateV10(value['state']);
    return state === null
      ? { status: 'corrupt', kind: 'corrupt', reason: 'invalid-domain' }
      : { status: 'ready', kind: 'ready', version, state };
  }

  try {
    const persistedState =
      version === 5 || version === 6 || version === 7 || version === 8
        ? parsePersistedTrainingWireStateV8(value['state'])
        : version === 9
          ? parsePersistedTrainingWireStateV9(value['state'])
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
      case 7:
      case 8:
      case 9:
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
