/**
 * Owns custom-session draft transitions and converts the form into domain input only after
 * validation. Numeric fields remain strings while editing, and centralized limits constrain the
 * nested activity shape before submission.
 */
import {
  TRAINING_DATA_LIMITS,
  getEffectiveTrainingQuantity,
  isValidTrainingQuantityValue,
  type DashboardEntry,
  type CustomTrainingIntensity,
  type DurationUnit,
  type TrainingActivity,
  type TrainingSetInput,
} from '@kendo-menu/domain';

export type StepMeasurement = 'repetitions' | 'duration';

export interface StepDraft {
  readonly id: string;
  readonly activityId?: string;
  readonly label: string;
  readonly reps: string;
  readonly measurement: StepMeasurement;
  readonly durationUnit: DurationUnit;
  readonly quantityChanged?: boolean;
}

export interface SectionDraft {
  readonly id: string;
  readonly activityId?: string;
  readonly label: string;
  readonly steps: readonly StepDraft[];
}

export interface BuilderState {
  readonly name: string;
  readonly description: string;
  readonly customIntensity?: CustomTrainingIntensity;
  readonly allowEmptyExercises?: boolean;
  readonly sections: readonly SectionDraft[];
}

export type BuilderAction =
  | { readonly type: 'set-name'; readonly value: string }
  | { readonly type: 'set-description'; readonly value: string }
  | {
      readonly type: 'set-custom-intensity';
      readonly value: CustomTrainingIntensity | undefined;
    }
  | { readonly type: 'set-section-label'; readonly sectionId: string; readonly value: string }
  | { readonly type: 'set-step-label'; readonly stepId: string; readonly value: string }
  | { readonly type: 'set-step-reps'; readonly stepId: string; readonly value: string }
  | {
      readonly type: 'set-step-measurement';
      readonly stepId: string;
      readonly value: StepMeasurement;
    }
  | {
      readonly type: 'set-step-duration-unit';
      readonly stepId: string;
      readonly value: DurationUnit;
    }
  | { readonly type: 'add-section' }
  | { readonly type: 'remove-section'; readonly sectionId: string }
  | { readonly type: 'add-step'; readonly sectionId: string }
  | { readonly type: 'remove-step'; readonly sectionId: string; readonly stepId: string };

let draftId = 0;

function createDraftId(prefix: string): string {
  draftId += 1;
  return `${prefix}-${draftId}`;
}

function createStepDraft(): StepDraft {
  return {
    id: createDraftId('draft-step'),
    label: '',
    reps: '',
    measurement: 'repetitions',
    durationUnit: 'minutes',
  };
}

function createSectionDraft(): SectionDraft {
  return { id: createDraftId('draft-section'), label: '', steps: [createStepDraft()] };
}

export function createInitialBuilderState(): BuilderState {
  return { name: '', description: '', sections: [createSectionDraft()] };
}

function getBuilderQuantityUnit(
  activity: TrainingActivity,
  entry: DashboardEntry,
): 'repetitions' | DurationUnit | undefined {
  const overrides = entry.quantityOverrides[activity.id];
  if (activity.quantities?.repetitions !== undefined || overrides?.repetitions !== undefined) {
    return 'repetitions';
  }
  if (activity.quantities?.duration !== undefined) return activity.quantities.duration.unit;
  if (overrides?.seconds !== undefined) return 'seconds';
  if (overrides?.minutes !== undefined) return 'minutes';
  return undefined;
}

function createStepDraftFromActivity(activity: TrainingActivity, entry: DashboardEntry): StepDraft {
  const unit = getBuilderQuantityUnit(activity, entry);
  const quantity =
    unit === undefined
      ? undefined
      : getEffectiveTrainingQuantity(activity, entry.quantityOverrides[activity.id], unit);
  return {
    id: createDraftId('draft-step'),
    activityId: activity.id,
    label: activity.name,
    reps: typeof quantity === 'number' ? String(quantity) : '',
    measurement: unit === 'seconds' || unit === 'minutes' ? 'duration' : 'repetitions',
    durationUnit: unit === 'seconds' ? 'seconds' : 'minutes',
  };
}

export function createEditBuilderState(entry: DashboardEntry): BuilderState | null {
  const trainingSet = entry.trainingSet;
  if (trainingSet === undefined || trainingSet.isBuiltIn || trainingSet.category !== 'custom') {
    return null;
  }
  if (
    trainingSet.activities.some((section) =>
      section.children.some((exercise) => exercise.children.length > 0),
    )
  ) {
    return null;
  }

  return {
    name: trainingSet.name,
    description: trainingSet.description ?? '',
    allowEmptyExercises: true,
    ...(trainingSet.customIntensity === undefined
      ? {}
      : { customIntensity: trainingSet.customIntensity }),
    sections: trainingSet.activities.map((section) => ({
      id: createDraftId('draft-section'),
      activityId: section.id,
      label: section.name,
      steps: section.children.map((exercise) => createStepDraftFromActivity(exercise, entry)),
    })),
  };
}

export function getBuilderEditIdentities(state: BuilderState) {
  return {
    sections: state.sections.map((section) => ({
      ...(section.activityId === undefined ? {} : { id: section.activityId }),
      exercises: section.steps.map((step) =>
        step.activityId === undefined ? {} : { id: step.activityId },
      ),
    })),
  };
}

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case 'set-name':
      return { ...state, name: action.value };
    case 'set-description':
      return { ...state, description: action.value };
    case 'set-custom-intensity':
      if (action.value === undefined) {
        const { customIntensity: _customIntensity, ...stateWithoutIntensity } = state;
        return stateWithoutIntensity;
      }
      return { ...state, customIntensity: action.value };
    case 'set-section-label':
      return {
        ...state,
        sections: state.sections.map((section) =>
          section.id === action.sectionId ? { ...section, label: action.value } : section,
        ),
      };
    case 'set-step-label':
      return {
        ...state,
        sections: state.sections.map((section) => ({
          ...section,
          steps: section.steps.map((step) =>
            step.id === action.stepId ? { ...step, label: action.value } : step,
          ),
        })),
      };
    case 'set-step-reps':
      return {
        ...state,
        sections: state.sections.map((section) => ({
          ...section,
          steps: section.steps.map((step) =>
            step.id === action.stepId
              ? { ...step, reps: action.value, quantityChanged: true }
              : step,
          ),
        })),
      };
    case 'set-step-measurement':
      return {
        ...state,
        sections: state.sections.map((section) => ({
          ...section,
          steps: section.steps.map((step) =>
            step.id === action.stepId
              ? { ...step, measurement: action.value, quantityChanged: true }
              : step,
          ),
        })),
      };
    case 'set-step-duration-unit':
      return {
        ...state,
        sections: state.sections.map((section) => ({
          ...section,
          steps: section.steps.map((step) =>
            step.id === action.stepId
              ? { ...step, durationUnit: action.value, quantityChanged: true }
              : step,
          ),
        })),
      };
    case 'add-section':
      if (
        state.sections.length >= TRAINING_DATA_LIMITS.customSections ||
        getDraftActivityCount(state) + 2 > TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet
      ) {
        return state;
      }
      return { ...state, sections: [...state.sections, createSectionDraft()] };
    case 'remove-section':
      return state.sections.length <= 1
        ? state
        : {
            ...state,
            sections: state.sections.filter((section) => section.id !== action.sectionId),
          };
    case 'add-step':
      return {
        ...state,
        sections: state.sections.map((section) =>
          section.id === action.sectionId
            ? section.steps.length >= TRAINING_DATA_LIMITS.exercisesPerSection ||
              getDraftActivityCount(state) >= TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet
              ? section
              : { ...section, steps: [...section.steps, createStepDraft()] }
            : section,
        ),
      };
    case 'remove-step':
      return {
        ...state,
        sections: state.sections.map((section) =>
          section.id === action.sectionId &&
          section.steps.length > (state.allowEmptyExercises === true ? 0 : 1)
            ? { ...section, steps: section.steps.filter((step) => step.id !== action.stepId) }
            : section,
        ),
      };
  }
}

function getDraftActivityCount(state: BuilderState): number {
  return state.sections.reduce((total, section) => total + 1 + section.steps.length, 0);
}

export type BuilderErrors = Readonly<Record<string, string>>;

export type BuilderParseResult =
  | { readonly success: true; readonly value: TrainingSetInput }
  | { readonly success: false; readonly errors: BuilderErrors };

export function parseBuilderState(state: BuilderState): BuilderParseResult {
  const errors: Record<string, string> = {};

  if (state.name.trim().length === 0) {
    errors['name'] = 'Give this session a name.';
  } else if (state.name.length > TRAINING_DATA_LIMITS.nameCharacters) {
    errors['name'] =
      `Keep the session name to ${TRAINING_DATA_LIMITS.nameCharacters} characters or fewer.`;
  }
  if (state.description.length > TRAINING_DATA_LIMITS.descriptionCharacters) {
    errors['description'] =
      `Keep the description to ${TRAINING_DATA_LIMITS.descriptionCharacters} characters or fewer.`;
  }

  if (state.sections.length < 1) {
    errors['sections'] = 'Add at least one activity.';
  } else if (state.sections.length > TRAINING_DATA_LIMITS.customSections) {
    errors['sections'] = `Use no more than ${TRAINING_DATA_LIMITS.customSections} activities.`;
  } else if (getDraftActivityCount(state) > TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet) {
    errors['activities'] =
      `Use no more than ${TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet} activities in total.`;
  }

  if (state.sections.length > TRAINING_DATA_LIMITS.customSections) {
    return { success: false, errors };
  }

  state.sections.forEach((section) => {
    if (section.label.trim().length === 0) {
      errors[`section-${section.id}`] = 'Name this activity.';
    } else if (section.label.length > TRAINING_DATA_LIMITS.nameCharacters) {
      errors[`section-${section.id}`] =
        `Keep the activity name to ${TRAINING_DATA_LIMITS.nameCharacters} characters or fewer.`;
    }

    if (section.steps.length > TRAINING_DATA_LIMITS.exercisesPerSection) {
      errors[`section-steps-${section.id}`] =
        `Use no more than ${TRAINING_DATA_LIMITS.exercisesPerSection} exercises per activity.`;
    }

    section.steps.slice(0, TRAINING_DATA_LIMITS.exercisesPerSection + 1).forEach((step) => {
      if (step.label.trim().length === 0) {
        errors[`step-label-${step.id}`] = 'Name this exercise.';
      } else if (step.label.length > TRAINING_DATA_LIMITS.nameCharacters) {
        errors[`step-label-${step.id}`] =
          `Keep the exercise name to ${TRAINING_DATA_LIMITS.nameCharacters} characters or fewer.`;
      }

      if (step.activityId === undefined || step.quantityChanged === true) {
        const quantityValue = step.reps.trim();
        const quantityUnit = step.measurement === 'repetitions' ? 'repetitions' : step.durationUnit;
        if (
          quantityValue.length === 0 ||
          !isValidTrainingQuantityValue(quantityUnit, Number(quantityValue))
        ) {
          errors[`step-reps-${step.id}`] =
            step.measurement === 'repetitions'
              ? 'Enter a whole number from 0 to 500.'
              : `Enter a number of ${step.durationUnit}, 0 or more.`;
        }
      }
    });
  });

  return Object.keys(errors).length > 0
    ? { success: false, errors }
    : {
        success: true,
        value: {
          name: state.name.trim(),
          description: state.description.trim(),
          category: 'custom',
          ...(state.customIntensity === undefined
            ? {}
            : { customIntensity: state.customIntensity }),
          sections: state.sections.map((section) => ({
            name: section.label.trim(),
            exercises: section.steps.map((step) => ({
              name: step.label.trim(),
              ...(step.activityId !== undefined && step.quantityChanged !== true
                ? {}
                : {
                    quantities:
                      step.measurement === 'repetitions'
                        ? { repetitions: Number(step.reps) }
                        : { duration: { unit: step.durationUnit, value: Number(step.reps) } },
                  }),
            })),
          })),
        },
      };
}
