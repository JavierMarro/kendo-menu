import { describe, expect, it } from 'vitest';

import {
  builderReducer,
  createInitialBuilderState,
  parseBuilderState,
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

function requireValidInput(state: BuilderState) {
  const result = parseBuilderState(state);
  if (!result.success) {
    throw new Error('Expected a valid builder submission.');
  }
  return result.value;
}

describe('session builder state', () => {
  it('characterizes a valid ordered submission with trimmed mixed measurements', () => {
    const state: BuilderState = {
      name: '  Mixed keiko  ',
      description: '  Repetitions followed by timed work.  ',
      customIntensity: 'high-intensity-drill',
      sections: [
        {
          id: 'activity-first',
          label: '  Main practice  ',
          steps: [
            {
              id: 'exercise-repetitions',
              label: '  Men  ',
              reps: '24',
              measurement: 'repetitions',
              durationUnit: 'minutes',
            },
            {
              id: 'exercise-minutes',
              label: '  Jigeiko  ',
              reps: '12.5',
              measurement: 'duration',
              durationUnit: 'minutes',
            },
          ],
        },
        {
          id: 'activity-second',
          label: '  Finish  ',
          steps: [
            {
              id: 'exercise-seconds',
              label: '  Kakarigeiko  ',
              reps: '45',
              measurement: 'duration',
              durationUnit: 'seconds',
            },
          ],
        },
      ],
    };

    expect(parseBuilderState(state)).toEqual({
      success: true,
      value: {
        name: 'Mixed keiko',
        description: 'Repetitions followed by timed work.',
        category: 'custom',
        customIntensity: 'high-intensity-drill',
        sections: [
          {
            name: 'Main practice',
            exercises: [
              { name: 'Men', quantities: { repetitions: 24 } },
              {
                name: 'Jigeiko',
                quantities: { duration: { unit: 'minutes', value: 12.5 } },
              },
            ],
          },
          {
            name: 'Finish',
            exercises: [
              {
                name: 'Kakarigeiko',
                quantities: { duration: { unit: 'seconds', value: 45 } },
              },
            ],
          },
        ],
      },
    });
  });

  it('characterizes invalid submission errors in presentation order', () => {
    const state: BuilderState = {
      name: '  ',
      description: 'Draft remains entered.',
      sections: [
        {
          id: 'activity-first',
          label: '',
          steps: [
            {
              id: 'exercise-repetitions',
              label: ' ',
              reps: '501',
              measurement: 'repetitions',
              durationUnit: 'minutes',
            },
            {
              id: 'exercise-seconds',
              label: 'Kakarigeiko',
              reps: '-1',
              measurement: 'duration',
              durationUnit: 'seconds',
            },
          ],
        },
        {
          id: 'activity-second',
          label: 'Finish',
          steps: [
            {
              id: 'exercise-minutes',
              label: 'Jigeiko',
              reps: '',
              measurement: 'duration',
              durationUnit: 'minutes',
            },
          ],
        },
      ],
    };

    const result = parseBuilderState(state);
    expect(result).toEqual({
      success: false,
      errors: {
        name: 'Give this session a name.',
        'section-activity-first': 'Name this activity.',
        'step-label-exercise-repetitions': 'Name this exercise.',
        'step-reps-exercise-repetitions': 'Enter a whole number from 0 to 500.',
        'step-reps-exercise-seconds': 'Enter a number of seconds, 0 or more.',
        'step-reps-exercise-minutes': 'Enter a number of minutes, 0 or more.',
      },
    });
    if (result.success) {
      throw new Error('Expected the invalid builder submission to return field errors.');
    }
    expect(Object.keys(result.errors)).toEqual([
      'name',
      'section-activity-first',
      'step-label-exercise-repetitions',
      'step-reps-exercise-repetitions',
      'step-reps-exercise-seconds',
      'step-reps-exercise-minutes',
    ]);
  });

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

    const result = parseBuilderState(state);
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error('Expected the duration builder state to parse.');
    }
    expect(result.value.sections[0]?.exercises[0]?.quantities).toEqual({
      duration: { unit: 'seconds', value: 12.5 },
    });

    const repetitionsState = builderReducer(state, {
      type: 'set-step-measurement',
      stepId: step.id,
      value: 'repetitions',
    });
    expect(parseBuilderState(repetitionsState)).toEqual({
      success: false,
      errors: {
        [`step-reps-${step.id}`]: 'Enter a whole number from 0 to 500.',
      },
    });
    expect(requireStep(requireSection(state)).measurement).toBe('duration');
  });

  it('keeps one optional intensity choice in the typed authored input', () => {
    const initial = createInitialBuilderState();
    const section = requireSection(initial);
    const step = requireStep(section);
    let valid = builderReducer(initial, { type: 'set-name', value: 'Tagged keiko' });
    valid = builderReducer(valid, {
      type: 'set-section-label',
      sectionId: section.id,
      value: 'Main practice',
    });
    valid = builderReducer(valid, {
      type: 'set-step-label',
      stepId: step.id,
      value: 'Men',
    });
    valid = builderReducer(valid, { type: 'set-step-reps', stepId: step.id, value: '20' });

    const intense = builderReducer(valid, {
      type: 'set-custom-intensity',
      value: 'intense-drill',
    });
    expect(intense.customIntensity).toBe('intense-drill');
    expect(requireValidInput(intense)).toMatchObject({ customIntensity: 'intense-drill' });

    const high = builderReducer(intense, {
      type: 'set-custom-intensity',
      value: 'high-intensity-drill',
    });
    expect(requireValidInput(high)).toMatchObject({ customIntensity: 'high-intensity-drill' });

    const untagged = builderReducer(high, {
      type: 'set-custom-intensity',
      value: undefined,
    });
    expect(untagged.customIntensity).toBeUndefined();
    expect(Object.hasOwn(requireValidInput(untagged), 'customIntensity')).toBe(false);
  });
});
