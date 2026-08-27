import type { TrainingSetInput } from '@kendo-menu/domain';

export interface StepDraft {
  readonly id: string;
  readonly label: string;
  readonly reps: string;
}

export interface SectionDraft {
  readonly id: string;
  readonly label: string;
  readonly steps: readonly StepDraft[];
}

export interface BuilderState {
  readonly name: string;
  readonly description: string;
  readonly sections: readonly SectionDraft[];
}

export type BuilderAction =
  | { readonly type: 'set-name'; readonly value: string }
  | { readonly type: 'set-description'; readonly value: string }
  | { readonly type: 'set-section-label'; readonly sectionId: string; readonly value: string }
  | { readonly type: 'set-step-label'; readonly stepId: string; readonly value: string }
  | { readonly type: 'set-step-reps'; readonly stepId: string; readonly value: string }
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
  return { id: createDraftId('draft-step'), label: '', reps: '' };
}

function createSectionDraft(): SectionDraft {
  return { id: createDraftId('draft-section'), label: '', steps: [createStepDraft()] };
}

export function createInitialBuilderState(): BuilderState {
  return { name: '', description: '', sections: [createSectionDraft()] };
}

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case 'set-name':
      return { ...state, name: action.value };
    case 'set-description':
      return { ...state, description: action.value };
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
            step.id === action.stepId ? { ...step, reps: action.value } : step,
          ),
        })),
      };
    case 'add-section':
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
            ? { ...section, steps: [...section.steps, createStepDraft()] }
            : section,
        ),
      };
    case 'remove-step':
      return {
        ...state,
        sections: state.sections.map((section) =>
          section.id === action.sectionId && section.steps.length > 1
            ? { ...section, steps: section.steps.filter((step) => step.id !== action.stepId) }
            : section,
        ),
      };
  }
}

export type BuilderErrors = Readonly<Record<string, string>>;

export function validateBuilderState(state: BuilderState): BuilderErrors {
  const errors: Record<string, string> = {};

  if (state.name.trim().length === 0) {
    errors['name'] = 'Give this session a name.';
  }

  state.sections.forEach((section) => {
    if (section.label.trim().length === 0) {
      errors[`section-${section.id}`] = 'Name this exercise section.';
    }

    section.steps.forEach((step) => {
      if (step.label.trim().length === 0) {
        errors[`step-label-${step.id}`] = 'Name this subexercise.';
      }

      if (!/^\d+$/.test(step.reps.trim())) {
        errors[`step-reps-${step.id}`] = 'Enter a whole number from 0 to 500.';
        return;
      }

      const reps = Number(step.reps);
      if (!Number.isInteger(reps) || reps < 0 || reps > 500) {
        errors[`step-reps-${step.id}`] = 'Enter a whole number from 0 to 500.';
      }
    });
  });

  return errors;
}

export function toTrainingSetInput(state: BuilderState): TrainingSetInput {
  return {
    name: state.name.trim(),
    description: state.description.trim(),
    category: 'custom',
    sections: state.sections.map((section) => ({
      name: section.label.trim(),
      exercises: section.steps.map((step) => ({
        name: step.label.trim(),
        quantities: { repetitions: Number(step.reps) },
      })),
    })),
  };
}
