import { describe, expect, it } from 'vitest';

import {
  builderReducer,
  createInitialBuilderState,
  toTrainingSetInput,
  validateBuilderState,
  type BuilderState,
  type SectionDraft,
  type StepDraft,
} from './builder-state';

function requireSection(state: BuilderState, index = 0): SectionDraft {
  const section = state.sections[index];
  if (section === undefined) {
    throw new Error(`Expected activity draft ${index + 1}.`);
  }
  return section;
}

function requireStep(section: SectionDraft, index = 0): StepDraft {
  const step = section.steps[index];
  if (step === undefined) {
    throw new Error(`Expected exercise draft ${index + 1}.`);
  }
  return step;
}

describe('session builder state', () => {
  it('defaults existing and newly added exercise rows to repetitions', () => {
    const initial = createInitialBuilderState();
    const firstSection = requireSection(initial);
    expect(requireStep(firstSection)).toMatchObject({
      measurement: 'repetitions',
      durationUnit: 'minutes',
      reps: '',
    });

    const expanded = builderReducer(initial, { type: 'add-step', sectionId: firstSection.id });
    expect(requireStep(requireSection(expanded), 1)).toMatchObject({
      measurement: 'repetitions',
      durationUnit: 'minutes',
      reps: '',
    });
    expect(initial.sections).toHaveLength(1);
    expect(firstSection.steps).toHaveLength(1);
  });

  it('validates and converts repetitions and duration through the existing quantity model', () => {
    const initial = createInitialBuilderState();
    const section = requireSection(initial);
    const step = requireStep(section);
    let state = builderReducer(initial, { type: 'set-name', value: 'Mixed keiko' });
    state = builderReducer(state, {
      type: 'set-section-label',
      sectionId: section.id,
      value: 'Main practice',
    });
    state = builderReducer(state, {
      type: 'set-step-label',
      stepId: step.id,
      value: 'Jigeiko',
    });
    state = builderReducer(state, {
      type: 'set-step-measurement',
      stepId: step.id,
      value: 'duration',
    });
    state = builderReducer(state, {
      type: 'set-step-duration-unit',
      stepId: step.id,
      value: 'seconds',
    });
    state = builderReducer(state, { type: 'set-step-reps', stepId: step.id, value: '12.5' });

    expect(validateBuilderState(state)).toEqual({});
    expect(toTrainingSetInput(state).sections[0]?.exercises[0]?.quantities).toEqual({
      duration: { unit: 'seconds', value: 12.5 },
    });

    const repetitionsState = builderReducer(state, {
      type: 'set-step-measurement',
      stepId: step.id,
      value: 'repetitions',
    });
    expect(validateBuilderState(repetitionsState)[`step-reps-${step.id}`]).toBe(
      'Enter a whole number from 0 to 500.',
    );
    expect(requireStep(requireSection(state)).measurement).toBe('duration');
  });
});
