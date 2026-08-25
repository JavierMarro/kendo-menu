import {
  DEFAULT_TRAINING_SETS,
  asTrainingSetId,
  createTrainingQuantities,
  isValidRepetitionCount,
  isValidTrainingQuantityValue,
  TRAINING_QUANTITY_UNITS,
  type DashboardEntry,
  type DashboardQuantityOverrides,
  type DrillCategory,
  type RepUnit,
  type TrainingQuantities,
  type TrainingQuantity,
  type TrainingQuantityOverrides,
  type TrainingQuantityUnit,
  type TrainingSection,
  type TrainingSet,
  type TrainingStep,
} from '@kendo-menu/domain';
import {
  createJSONStorage,
  type PersistStorage,
  type StateStorage,
  type StorageValue,
} from 'zustand/middleware';

export const TRAINING_STORE_PERSISTENCE_VERSION = 4;

export interface PersistedTrainingState {
  readonly dashboardEntries: readonly DashboardEntry[];
  readonly customTrainingSets: readonly TrainingSet[];
}

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
  readonly repUnit: RepUnit;
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

export interface LegacyPersistedTrainingStateV2 {
  readonly dashboardEntries: readonly LegacyDashboardEntry[];
  readonly customTrainingSets: readonly LegacyTrainingSetV2[];
}

export interface LegacyPersistedTrainingState {
  readonly dashboardEntries: readonly LegacyDashboardEntry[];
  readonly customTrainingSets: readonly LegacyTrainingSet[];
}

export interface LegacyPersistedTrainingStateV3 {
  readonly dashboardEntries: readonly LegacyDashboardEntry[];
  readonly customTrainingSets: readonly TrainingSet[];
}

export type PersistedStorageState =
  | PersistedTrainingState
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
      readonly fromVersion: 0 | 1 | 2 | 3;
      readonly version: typeof TRAINING_STORE_PERSISTENCE_VERSION;
      readonly state: PersistedTrainingState;
    }
  | {
      readonly status: 'corrupt';
      readonly kind: 'corrupt';
      readonly reason: 'malformed-json' | 'malformed-envelope' | 'invalid-domain';
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    return false;
  }
  return typeof (value as { readonly then?: unknown }).then === 'function';
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
    value === 'custom'
  );
}

function isTrainingQuantityUnit(value: unknown): value is TrainingQuantityUnit {
  return value === 'repetitions' || value === 'sets' || value === 'minutes' || value === 'rounds';
}

function isRepUnit(value: unknown): value is RepUnit {
  return isTrainingQuantityUnit(value) || value === 'custom';
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

function parseTrainingQuantity(value: unknown): TrainingQuantity | null {
  if (!isRecord(value)) {
    return null;
  }

  const unit = value['unit'];
  const quantityValue = value['value'];
  if (!isTrainingQuantityUnit(unit) || !isValidTrainingQuantityValue(unit, quantityValue)) {
    return null;
  }
  return { unit, value: quantityValue };
}

function parseTrainingQuantities(value: unknown): TrainingQuantities | null {
  const parsedQuantities = parseArray(value, parseTrainingQuantity);
  if (parsedQuantities === null || parsedQuantities.length !== TRAINING_QUANTITY_UNITS.length) {
    return null;
  }

  const quantitiesByUnit = new Map<TrainingQuantityUnit, number | null>();
  for (const quantity of parsedQuantities) {
    if (quantitiesByUnit.has(quantity.unit)) {
      return null;
    }
    quantitiesByUnit.set(quantity.unit, quantity.value);
  }

  const repetitions = quantitiesByUnit.get('repetitions');
  const sets = quantitiesByUnit.get('sets');
  const minutes = quantitiesByUnit.get('minutes');
  const rounds = quantitiesByUnit.get('rounds');
  if (
    repetitions === undefined ||
    sets === undefined ||
    minutes === undefined ||
    rounds === undefined
  ) {
    return null;
  }
  return createTrainingQuantities({ repetitions, sets, minutes, rounds });
}

function parseLegacyTrainingStep(value: unknown): LegacyTrainingStep | null {
  if (!isRecord(value)) {
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
    !isRepUnit(repUnit) ||
    (description !== undefined && typeof description !== 'string')
  ) {
    return null;
  }

  const step: LegacyTrainingStep = { id, label, defaultReps, repUnit };
  return description === undefined ? step : { ...step, description };
}

function parseTrainingStep(value: unknown): TrainingStep | null {
  const legacyStep = parseLegacyTrainingStep(value);
  if (legacyStep === null) {
    return null;
  }

  const quantities = isRecord(value) ? parseTrainingQuantities(value['quantities']) : null;
  if (quantities === null) {
    return null;
  }
  if (legacyStep.defaultReps !== null && isTrainingQuantityUnit(legacyStep.repUnit)) {
    const matchingQuantity = quantities.find((quantity) => quantity.unit === legacyStep.repUnit);
    if (matchingQuantity?.value !== legacyStep.defaultReps) {
      return null;
    }
  }

  return { ...legacyStep, quantities };
}

function parseTrainingSection(value: unknown): TrainingSection | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value['id'];
  const label = value['label'];
  const steps = parseArray(value['steps'], parseTrainingStep);
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

function parseLegacyTrainingSectionV2(value: unknown): LegacyTrainingSectionV2 | null {
  if (!isRecord(value)) {
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

function parseRepOverrides(value: unknown): Readonly<Record<string, number>> | null {
  if (!isRecord(value)) {
    return null;
  }

  const repOverrides: [string, number][] = [];
  for (const [stepId, reps] of Object.entries(value)) {
    if (!isValidRepetitionCount(reps)) {
      return null;
    }
    repOverrides.push([stepId, reps]);
  }

  return Object.fromEntries(repOverrides);
}

function parseLegacyDashboardEntry(value: unknown): LegacyDashboardEntry | null {
  if (!isRecord(value)) {
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
    if (
      !isTrainingQuantityUnit(unit) ||
      quantityValue === null ||
      !isValidTrainingQuantityValue(unit, quantityValue)
    ) {
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
  for (const [stepId, stepOverrides] of Object.entries(value)) {
    const parsedOverrides = parseTrainingQuantityOverrides(stepOverrides);
    if (stepId.trim().length === 0 || parsedOverrides === null) {
      return null;
    }
    entries.push([stepId, parsedOverrides]);
  }
  return Object.fromEntries(entries);
}

function parseDashboardEntry(value: unknown): DashboardEntry | null {
  if (!isRecord(value)) {
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
  if (!isRecord(value)) {
    return null;
  }

  const id = value['id'];
  const name = value['name'];
  const description = value['description'];
  const category = value['category'];
  const steps = parseArray(value['steps'], parseLegacyTrainingStep);
  const isBuiltIn = value['isBuiltIn'];

  if (
    !isNonBlankString(id) ||
    !isNonBlankString(name) ||
    typeof description !== 'string' ||
    !isDrillCategory(category) ||
    steps === null ||
    steps.length < 1 ||
    isBuiltIn !== false
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

function parseTrainingSet(value: unknown): TrainingSet | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value['id'];
  const name = value['name'];
  const description = value['description'];
  const category = value['category'];
  const sections = parseArray(value['sections'], parseTrainingSection);
  const isBuiltIn = value['isBuiltIn'];

  if (
    !isNonBlankString(id) ||
    !isNonBlankString(name) ||
    typeof description !== 'string' ||
    !isDrillCategory(category) ||
    sections === null ||
    sections.length < 1 ||
    typeof isBuiltIn !== 'boolean'
  ) {
    return null;
  }

  const ids = new Set<string>([id]);
  for (const section of sections) {
    if (ids.has(section.id)) {
      return null;
    }
    ids.add(section.id);
    for (const step of section.steps) {
      if (ids.has(step.id)) {
        return null;
      }
      ids.add(step.id);
    }
  }

  return {
    id: asTrainingSetId(id),
    name,
    description,
    category,
    sections,
    isBuiltIn,
  };
}

function parseLegacyTrainingSetV2(value: unknown): LegacyTrainingSetV2 | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value['id'];
  const name = value['name'];
  const description = value['description'];
  const category = value['category'];
  const sections = parseArray(value['sections'], parseLegacyTrainingSectionV2);
  const isBuiltIn = value['isBuiltIn'];

  if (
    !isNonBlankString(id) ||
    !isNonBlankString(name) ||
    typeof description !== 'string' ||
    !isDrillCategory(category) ||
    sections === null ||
    sections.length < 1 ||
    isBuiltIn !== false
  ) {
    return null;
  }

  const ids = new Set<string>([id]);
  for (const section of sections) {
    if (ids.has(section.id)) {
      return null;
    }
    ids.add(section.id);
    for (const step of section.steps) {
      if (ids.has(step.id)) {
        return null;
      }
      ids.add(step.id);
    }
  }

  return { id, name, description, category, sections, isBuiltIn: false };
}

function parseCustomTrainingSet(value: unknown): TrainingSet | null {
  const trainingSet = parseTrainingSet(value);
  if (
    trainingSet === null ||
    trainingSet.isBuiltIn !== false ||
    trainingSet.category !== 'custom'
  ) {
    return null;
  }
  return trainingSet.sections.every((section) =>
    section.steps.every((step) => step.defaultReps !== null),
  )
    ? trainingSet
    : null;
}

function parseLegacyCustomTrainingSetV2(value: unknown): LegacyTrainingSetV2 | null {
  const trainingSet = parseLegacyTrainingSetV2(value);
  if (
    trainingSet === null ||
    trainingSet.isBuiltIn !== false ||
    trainingSet.category !== 'custom'
  ) {
    return null;
  }
  return trainingSet.sections.every((section) =>
    section.steps.every((step) => step.defaultReps !== null),
  )
    ? trainingSet
    : null;
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
  for (const set of sets) {
    if (ids.has(set.id)) {
      return false;
    }
    ids.add(set.id);
  }
  return true;
}

function validateNoCuratedSetIdCollisions(sets: readonly { readonly id: string }[]): boolean {
  const curatedIds = new Set<string>(DEFAULT_TRAINING_SETS.map((trainingSet) => trainingSet.id));
  return sets.every((trainingSet) => !curatedIds.has(trainingSet.id));
}

export function parsePersistedTrainingState(value: unknown): PersistedTrainingState | null {
  if (!isRecord(value)) {
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
  if (!isRecord(value)) {
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
  if (!isRecord(value)) {
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
  if (!isRecord(value)) {
    return null;
  }

  const dashboardEntries = parseArray(value['dashboardEntries'], parseLegacyDashboardEntry);
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
  const migratedState = parsePersistedTrainingStateV2(migrated);
  if (migratedState === null) {
    throw new Error('Training-store version 1 migration produced invalid state.');
  }
  return migratedState;
}

export const migrateV1ToV2 = migratePersistedTrainingStateV1ToV2;

function migrateLegacyTrainingStepV2ToV3(step: LegacyTrainingStep): TrainingStep {
  const emptyQuantities = {
    repetitions: null,
    sets: null,
    minutes: null,
    rounds: null,
  } as const;
  const quantities =
    step.repUnit === 'custom'
      ? createTrainingQuantities(emptyQuantities)
      : createTrainingQuantities({
          ...emptyQuantities,
          [step.repUnit]: step.defaultReps,
        });
  return { ...step, quantities };
}

export function migratePersistedTrainingStateV2ToV3(
  value: unknown,
): LegacyPersistedTrainingStateV3 {
  const parsed = parsePersistedTrainingStateV2(value);
  if (parsed === null) {
    throw new Error('Training-store version 2 state is invalid.');
  }

  const customTrainingSets: TrainingSet[] = parsed.customTrainingSets.map((trainingSet) => ({
    id: asTrainingSetId(trainingSet.id),
    name: trainingSet.name,
    description: trainingSet.description,
    category: trainingSet.category,
    sections: trainingSet.sections.map((section) => ({
      id: section.id,
      label: section.label,
      steps: section.steps.map(migrateLegacyTrainingStepV2ToV3),
    })),
    isBuiltIn: false,
  }));

  const migrated = { dashboardEntries: parsed.dashboardEntries, customTrainingSets };
  const migratedState = parsePersistedTrainingStateV3(migrated);
  if (migratedState === null) {
    throw new Error('Training-store version 2 migration produced invalid state.');
  }
  return migratedState;
}

export const migrateV2ToV3 = migratePersistedTrainingStateV2ToV3;

function collectKnownLegacyOverrideUnits(
  customTrainingSets: readonly TrainingSet[],
): ReadonlyMap<string, TrainingQuantityUnit> {
  const units = new Map<string, TrainingQuantityUnit>();
  for (const trainingSet of [...DEFAULT_TRAINING_SETS, ...customTrainingSets]) {
    for (const section of trainingSet.sections) {
      for (const step of section.steps) {
        if (isTrainingQuantityUnit(step.repUnit)) {
          units.set(step.id, step.repUnit);
        }
      }
    }
  }
  return units;
}

function migrateLegacyDashboardEntryV3ToV4(
  entry: LegacyDashboardEntry,
  unitsByStepId: ReadonlyMap<string, TrainingQuantityUnit>,
): DashboardEntry {
  const quantityOverrideEntries: [string, TrainingQuantityOverrides][] = Object.entries(
    entry.repOverrides,
  ).map(([stepId, value]) => {
    const unit = unitsByStepId.get(stepId) ?? 'repetitions';
    return [stepId, { [unit]: value }];
  });

  return {
    id: entry.id,
    trainingSetId: entry.trainingSetId,
    quantityOverrides: Object.fromEntries(quantityOverrideEntries),
    notes: entry.notes,
    createdAt: entry.createdAt,
  };
}

export function migratePersistedTrainingStateV3ToV4(value: unknown): PersistedTrainingState {
  const parsed = parsePersistedTrainingStateV3(value);
  if (parsed === null) {
    throw new Error('Training-store version 3 state is invalid.');
  }

  const unitsByStepId = collectKnownLegacyOverrideUnits(parsed.customTrainingSets);
  const migrated = {
    dashboardEntries: parsed.dashboardEntries.map((entry) =>
      migrateLegacyDashboardEntryV3ToV4(entry, unitsByStepId),
    ),
    customTrainingSets: parsed.customTrainingSets,
  };
  const migratedState = parsePersistedTrainingState(migrated);
  if (migratedState === null) {
    throw new Error('Training-store version 3 migration produced invalid state.');
  }
  return migratedState;
}

export const migrateV3ToV4 = migratePersistedTrainingStateV3ToV4;

export function migratePersistedTrainingState(
  persistedState: unknown,
  version: number,
): PersistedTrainingState {
  switch (version) {
    case 0: {
      const stateV1 = migratePersistedTrainingStateV0ToV1(persistedState);
      const stateV2 = migratePersistedTrainingStateV1ToV2(stateV1);
      const stateV3 = migratePersistedTrainingStateV2ToV3(stateV2);
      return migratePersistedTrainingStateV3ToV4(stateV3);
    }
    case 1: {
      const stateV2 = migratePersistedTrainingStateV1ToV2(persistedState);
      const stateV3 = migratePersistedTrainingStateV2ToV3(stateV2);
      return migratePersistedTrainingStateV3ToV4(stateV3);
    }
    case 2: {
      const stateV3 = migratePersistedTrainingStateV2ToV3(persistedState);
      return migratePersistedTrainingStateV3ToV4(stateV3);
    }
    case 3:
      return migratePersistedTrainingStateV3ToV4(persistedState);
    case TRAINING_STORE_PERSISTENCE_VERSION: {
      const stateV4 = parsePersistedTrainingState(persistedState);
      if (stateV4 === null) {
        throw new Error('Training-store version 4 state is invalid.');
      }
      return stateV4;
    }
    default:
      throw new Error(`Unsupported training-store persistence version: ${String(version)}`);
  }
}

function parseStorageValue(value: unknown): StorageValue<PersistedStorageState> | null {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
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
    const state = parsePersistedTrainingState(value['state']);
    if (state === null) {
      throw new Error('Training-store persistence data is invalid.');
    }
    return { state, version };
  }

  switch (version) {
    case 0:
    case 1: {
      const legacyState = parsePersistedTrainingStateV1(value['state']);
      if (legacyState === null) {
        throw new Error('Training-store legacy persistence data is invalid.');
      }
      return { state: legacyState, version };
    }
    case 2: {
      const legacyState = parsePersistedTrainingStateV2(value['state']);
      if (legacyState === null) {
        throw new Error('Training-store version 2 persistence data is invalid.');
      }
      return { state: legacyState, version };
    }
    case 3: {
      const legacyState = parsePersistedTrainingStateV3(value['state']);
      if (legacyState === null) {
        throw new Error('Training-store version 3 persistence data is invalid.');
      }
      return { state: legacyState, version };
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
    setItem: (name, value) => jsonStorage.setItem(name, value),
    removeItem: (name) => jsonStorage.removeItem(name),
  };
}

function classifyParsedEnvelope(value: unknown): TrainingStorageInspection {
  if (!isRecord(value)) {
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
    const state = parsePersistedTrainingState(value['state']);
    return state === null
      ? { status: 'corrupt', kind: 'corrupt', reason: 'invalid-domain' }
      : { status: 'ready', kind: 'ready', version, state };
  }

  try {
    const state = migratePersistedTrainingState(value['state'], version);
    switch (version) {
      case 0:
      case 1:
      case 2:
      case 3:
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
  } catch {
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
    parsed = JSON.parse(rawValue) as unknown;
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
