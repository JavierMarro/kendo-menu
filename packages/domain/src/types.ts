declare const trainingSetIdBrand: unique symbol;

export type TrainingSetId = string & {
  readonly [trainingSetIdBrand]: true;
};

export type DrillCategory =
  'kihon' | 'kirikaeshi' | 'uchikomi' | 'kakari' | 'jigeiko' | 'mixed' | 'custom';

export type RepUnit = 'repetitions' | 'sets' | 'minutes' | 'rounds' | 'custom';

export const MIN_REPETITIONS = 0;
export const MAX_REPETITIONS = 500;

export interface TrainingStep {
  readonly id: string;
  readonly label: string;
  readonly defaultReps: number | null;
  readonly repUnit: RepUnit;
  readonly description?: string;
}

export interface TrainingSection {
  readonly id: string;
  readonly label: string;
  readonly steps: readonly TrainingStep[];
}

export interface TrainingSet {
  readonly id: TrainingSetId;
  readonly name: string;
  readonly description: string;
  readonly category: DrillCategory;
  readonly sections: readonly TrainingSection[];
  readonly isBuiltIn: boolean;
}

/** Input for a user-authored step. Its generated id is deliberately not accepted. */
export interface TrainingStepInput {
  readonly label: string;
  readonly defaultReps: number;
  readonly repUnit?: 'repetitions';
  readonly description?: string;
}

/** Input for a user-authored section. Its generated id is deliberately not accepted. */
export interface TrainingSectionInput {
  readonly label: string;
  readonly steps: readonly TrainingStepInput[];
}

/** Input for a user-authored set. Set, section, step, and dashboard ids are generated. */
export interface TrainingSetInput {
  readonly name: string;
  readonly description: string;
  readonly category: 'custom';
  readonly sections: readonly TrainingSectionInput[];
}

export type CustomTrainingStepInput = TrainingStepInput;
export type CustomTrainingSectionInput = TrainingSectionInput;
export type CustomTrainingSetInput = TrainingSetInput;

export interface DashboardEntry {
  readonly id: string;
  readonly trainingSetId: TrainingSetId;
  readonly repOverrides: Readonly<Record<string, number>>;
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidRepetitionCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_REPETITIONS &&
    value <= MAX_REPETITIONS
  );
}

export const isValidReps = isValidRepetitionCount;

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
    value === 'custom'
  );
}

function isRepUnit(value: unknown): value is RepUnit {
  return (
    value === 'repetitions' ||
    value === 'sets' ||
    value === 'minutes' ||
    value === 'rounds' ||
    value === 'custom'
  );
}

function pushIssue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function validateTrainingStep(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is TrainingStep {
  if (!isRecord(value)) {
    pushIssue(issues, path, 'must be an object');
    return false;
  }

  const id = value['id'];
  const label = value['label'];
  const defaultReps = value['defaultReps'];
  const repUnit = value['repUnit'];
  const description = value['description'];

  if (!isNonBlankString(id)) {
    pushIssue(issues, `${path}.id`, 'must be a nonblank string');
  }
  if (!isNonBlankString(label)) {
    pushIssue(issues, `${path}.label`, 'must be a nonblank string');
  }
  if (defaultReps !== null && !isValidRepetitionCount(defaultReps)) {
    pushIssue(
      issues,
      `${path}.defaultReps`,
      `must be null or an integer from ${MIN_REPETITIONS} through ${MAX_REPETITIONS}`,
    );
  }
  if (!isRepUnit(repUnit)) {
    pushIssue(issues, `${path}.repUnit`, 'must be a supported repetition unit');
  }
  if (description !== undefined && typeof description !== 'string') {
    pushIssue(issues, `${path}.description`, 'must be a string when provided');
  }

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

  const id = value['id'];
  const label = value['label'];
  const steps = value['steps'];

  if (!isNonBlankString(id)) {
    pushIssue(issues, `${path}.id`, 'must be a nonblank string');
  } else if (seenIds.has(id)) {
    pushIssue(issues, `${path}.id`, 'must be unique');
  } else {
    seenIds.add(id);
  }
  if (!isNonBlankString(label)) {
    pushIssue(issues, `${path}.label`, 'must be a nonblank string');
  }
  if (!Array.isArray(steps) || steps.length < 1) {
    pushIssue(issues, `${path}.steps`, 'must contain at least one step');
    return false;
  }

  steps.forEach((step, index) => {
    const stepPath = `${path}.steps[${index}]`;
    if (validateTrainingStep(step, stepPath, issues) && isRecord(step)) {
      const stepId = step['id'];
      if (typeof stepId === 'string') {
        if (seenIds.has(stepId)) {
          pushIssue(issues, `${stepPath}.id`, 'must be unique');
        } else {
          seenIds.add(stepId);
        }
      }
    }
  });

  return true;
}

export function validateTrainingSet(value: unknown): ValidationResult<TrainingSet> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(value)) {
    return {
      success: false,
      issues: [{ path: '', message: 'must be an object' }],
    };
  }

  const id = value['id'];
  const name = value['name'];
  const description = value['description'];
  const category = value['category'];
  const sections = value['sections'];
  const isBuiltIn = value['isBuiltIn'];

  if (!isNonBlankString(id)) {
    pushIssue(issues, 'id', 'must be a nonblank string');
  }
  if (!isNonBlankString(name)) {
    pushIssue(issues, 'name', 'must be a nonblank string');
  }
  if (typeof description !== 'string') {
    pushIssue(issues, 'description', 'must be a string');
  }
  if (!isDrillCategory(category)) {
    pushIssue(issues, 'category', 'must be a supported category');
  }
  if (!Array.isArray(sections) || sections.length < 1) {
    pushIssue(issues, 'sections', 'must contain at least one section');
  }
  if (typeof isBuiltIn !== 'boolean') {
    pushIssue(issues, 'isBuiltIn', 'must be a boolean');
  }
  if (isBuiltIn === false && category !== 'custom') {
    pushIssue(issues, 'category', 'custom sets must use the custom category');
  }

  const seenIds = new Set<string>();
  if (typeof id === 'string' && id.trim().length > 0) {
    seenIds.add(id);
  }
  if (Array.isArray(sections)) {
    sections.forEach((section, index) => {
      validateTrainingSection(section, `sections[${index}]`, issues, seenIds);
    });
  }

  if (isBuiltIn === false && Array.isArray(sections)) {
    sections.forEach((section, sectionIndex) => {
      if (!isRecord(section) || !Array.isArray(section['steps'])) {
        return;
      }
      section['steps'].forEach((step, stepIndex) => {
        if (isRecord(step) && step['defaultReps'] === null) {
          pushIssue(
            issues,
            `sections[${sectionIndex}].steps[${stepIndex}].defaultReps`,
            'custom steps must include a repetition count',
          );
        }
      });
    });
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof description !== 'string' ||
    !isDrillCategory(category) ||
    !Array.isArray(sections) ||
    typeof isBuiltIn !== 'boolean'
  ) {
    return { success: false, issues: [{ path: '', message: 'contains invalid fields' }] };
  }

  return {
    success: true,
    value: {
      id: asTrainingSetId(id),
      name,
      description,
      category,
      sections: sections as readonly TrainingSection[],
      isBuiltIn,
    },
  };
}

export function validateTrainingSetInput(value: unknown): ValidationResult<TrainingSetInput> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(value)) {
    return { success: false, issues: [{ path: '', message: 'must be an object' }] };
  }

  const name = value['name'];
  const description = value['description'];
  const category = value['category'];
  const sections = value['sections'];

  if (!isNonBlankString(name)) {
    pushIssue(issues, 'name', 'must be a nonblank string');
  }
  if (typeof description !== 'string') {
    pushIssue(issues, 'description', 'must be a string');
  }
  if (category !== 'custom') {
    pushIssue(issues, 'category', 'custom sets must use the custom category');
  }
  if (!Array.isArray(sections) || sections.length < 1) {
    pushIssue(issues, 'sections', 'must contain at least one section');
  }

  if (Array.isArray(sections)) {
    sections.forEach((section, sectionIndex) => {
      const sectionPath = `sections[${sectionIndex}]`;
      if (!isRecord(section)) {
        pushIssue(issues, sectionPath, 'must be an object');
        return;
      }

      const label = section['label'];
      const steps = section['steps'];
      if (!isNonBlankString(label)) {
        pushIssue(issues, `${sectionPath}.label`, 'must be a nonblank string');
      }
      if (!Array.isArray(steps) || steps.length < 1) {
        pushIssue(issues, `${sectionPath}.steps`, 'must contain at least one step');
        return;
      }

      steps.forEach((step, stepIndex) => {
        const stepPath = `${sectionPath}.steps[${stepIndex}]`;
        if (!isRecord(step)) {
          pushIssue(issues, stepPath, 'must be an object');
          return;
        }

        const stepLabel = step['label'];
        const defaultReps = step['defaultReps'];
        const repUnit = step['repUnit'];
        const stepDescription = step['description'];
        if (!isNonBlankString(stepLabel)) {
          pushIssue(issues, `${stepPath}.label`, 'must be a nonblank string');
        }
        if (!isValidRepetitionCount(defaultReps)) {
          pushIssue(
            issues,
            `${stepPath}.defaultReps`,
            `must be an integer from ${MIN_REPETITIONS} through ${MAX_REPETITIONS}`,
          );
        }
        if (repUnit !== undefined && repUnit !== 'repetitions') {
          pushIssue(issues, `${stepPath}.repUnit`, 'new authored steps must use repetitions');
        }
        if (stepDescription !== undefined && typeof stepDescription !== 'string') {
          pushIssue(issues, `${stepPath}.description`, 'must be a string when provided');
        }
        if (Object.hasOwn(step, 'id')) {
          pushIssue(issues, `${stepPath}.id`, 'must be omitted; ids are generated');
        }
      });

      if (Object.hasOwn(section, 'id')) {
        pushIssue(issues, `${sectionPath}.id`, 'must be omitted; ids are generated');
      }
    });
  }

  if (Object.hasOwn(value, 'id')) {
    pushIssue(issues, 'id', 'must be omitted; the set id is generated');
  }
  if (Object.hasOwn(value, 'isBuiltIn')) {
    pushIssue(issues, 'isBuiltIn', 'must be omitted; custom sets are not built in');
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  if (
    typeof name !== 'string' ||
    typeof description !== 'string' ||
    category !== 'custom' ||
    !Array.isArray(sections)
  ) {
    return { success: false, issues: [{ path: '', message: 'contains invalid fields' }] };
  }

  return {
    success: true,
    value: {
      name,
      description,
      category,
      sections: sections as readonly TrainingSectionInput[],
    },
  };
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

export function asTrainingSetId(value: string): TrainingSetId {
  return value as TrainingSetId;
}
