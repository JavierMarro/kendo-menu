import { describe, expect, it } from 'vitest';

import { TRAINING_DATA_LIMITS, asTrainingSetId, type DashboardEntry } from '@kendo-menu/domain';

import {
  builderReducer,
  createEditBuilderState,
  createInitialBuilderState,
  getBuilderEditIdentities,
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

function draftStep(sectionIndex: number, stepIndex: number): StepDraft {
  return {
    id: `section-${sectionIndex}-step-${stepIndex}`,
    label: `Exercise ${sectionIndex}-${stepIndex}`,
    reps: '1',
    measurement: 'repetitions',
    durationUnit: 'minutes',
  };
}

function builderStateWithShape(sectionCount: number, stepsPerSection: number): BuilderState {
  return {
    name: 'Valid session',
    description: '',
    sections: Array.from({ length: sectionCount }, (_, sectionIndex) => ({
      id: `section-${sectionIndex}`,
      label: `Activity ${sectionIndex}`,
      steps: Array.from({ length: stepsPerSection }, (_, stepIndex) =>
        draftStep(sectionIndex, stepIndex),
      ),
    })),
  };
}

function customEntry(): DashboardEntry {
  return {
    id: 'custom-entry',
    trainingSetId: asTrainingSetId('custom-session'),
    trainingSet: {
      id: asTrainingSetId('custom-session'),
      name: 'My keiko',
      description: 'Personal practice',
      category: 'custom',
      customIntensity: 'high-intensity-drill',
      activities: [
        {
          id: 'empty-activity',
          name: 'Empty activity',
          quantities: { duration: { unit: 'seconds', min: 30, max: 60 } },
          notes: 'Keep this hidden section note.',
          children: [],
        },
        {
          id: 'main-activity',
          name: 'Main practice',
          children: [
            {
              id: 'overridden-exercise',
              name: 'Men',
              quantities: { repetitions: 10, sets: 3 },
              notes: 'Keep this authored exercise note.',
              children: [],
            },
            {
              id: 'ranged-exercise',
              name: 'Jigeiko',
              quantities: { duration: { unit: 'minutes', min: 2, max: 5 } },
              children: [],
            },
            { id: 'quantity-free-exercise', name: 'Footwork', children: [] },
          ],
        },
      ],
      isBuiltIn: false,
    },
    quantityOverrides: { 'overridden-exercise': { repetitions: 24 } },
    activityNotes: { 'main-activity': 'Dashboard activity note.' },
    notes: 'Practice note.',
    createdAt: '2026-08-19T10:00:00.000Z',
  };
}

describe('session builder state', () => {
  it('opens custom menus with effective quantities and preserves untouched optional values', () => {
    const entry = customEntry();
    const state = createEditBuilderState(entry);
    expect(state).not.toBeNull();
    if (state === null) throw new Error('Expected a supported custom menu.');

    expect(state).toMatchObject({
      name: 'My keiko',
      description: 'Personal practice',
      customIntensity: 'high-intensity-drill',
      sections: [
        { activityId: 'empty-activity', steps: [] },
        {
          activityId: 'main-activity',
          steps: [
            { activityId: 'overridden-exercise', label: 'Men', reps: '24' },
            { activityId: 'ranged-exercise', label: 'Jigeiko', reps: '' },
            { activityId: 'quantity-free-exercise', label: 'Footwork', reps: '' },
          ],
        },
      ],
    });
    expect(getBuilderEditIdentities(state)).toEqual({
      sections: [
        { id: 'empty-activity', exercises: [] },
        {
          id: 'main-activity',
          exercises: [
            { id: 'overridden-exercise' },
            { id: 'ranged-exercise' },
            { id: 'quantity-free-exercise' },
          ],
        },
      ],
    });

    const parsed = parseBuilderState(state);
    expect(parsed).toMatchObject({
      success: true,
      value: {
        sections: [
          { name: 'Empty activity', exercises: [] },
          {
            name: 'Main practice',
            exercises: [{ name: 'Men' }, { name: 'Jigeiko' }, { name: 'Footwork' }],
          },
        ],
      },
    });
    if (!parsed.success) throw new Error('Expected a valid edit draft.');
    expect(parsed.value.sections[1]?.exercises[0]?.quantities).toBeUndefined();
    expect(parsed.value.sections[1]?.exercises[1]?.quantities).toBeUndefined();
    expect(parsed.value.sections[1]?.exercises[2]?.quantities).toBeUndefined();
  });

  it('includes a quantity when an existing exercise quantity is deliberately changed', () => {
    const initial = createEditBuilderState(customEntry());
    if (initial === null) throw new Error('Expected a supported custom menu.');
    const section = requireSection(initial, 1);
    const step = requireStep(section, 0);
    const changed = builderReducer(initial, {
      type: 'set-step-reps',
      stepId: step.id,
      value: '36',
    });
    const parsed = parseBuilderState(changed);
    if (!parsed.success) throw new Error('Expected a valid changed quantity.');
    expect(parsed.value.sections[1]?.exercises[0]?.quantities).toEqual({ repetitions: 36 });
  });

  it('allows an edited activity to remove its last exercise and add one back', () => {
    const initial = createEditBuilderState(customEntry());
    if (initial === null) throw new Error('Expected a supported custom menu.');
    const section = requireSection(initial, 1);
    let emptySection = initial;
    for (const step of section.steps) {
      emptySection = builderReducer(emptySection, {
        type: 'remove-step',
        sectionId: section.id,
        stepId: step.id,
      });
    }
    expect(requireSection(emptySection, 1).steps).toHaveLength(0);
    expect(
      builderReducer(emptySection, { type: 'add-step', sectionId: section.id }).sections[1]?.steps,
    ).toHaveLength(1);
  });

  it('enforces exact builder collection limits in reducer and parser boundaries', () => {
    const exactSections = builderStateWithShape(TRAINING_DATA_LIMITS.customSections, 1);
    const afterSectionLimit = builderReducer(exactSections, { type: 'add-section' });
    expect(afterSectionLimit).toBe(exactSections);
    expect(parseBuilderState(exactSections).success).toBe(true);
    const overSections = builderStateWithShape(TRAINING_DATA_LIMITS.customSections + 1, 1);
    expect(parseBuilderState(overSections)).toMatchObject({
      success: false,
      errors: {
        sections: `Use no more than ${TRAINING_DATA_LIMITS.customSections} activities.`,
      },
    });

    const exactSteps = builderStateWithShape(1, TRAINING_DATA_LIMITS.exercisesPerSection);
    const section = requireSection(exactSteps);
    const afterStepLimit = builderReducer(exactSteps, {
      type: 'add-step',
      sectionId: section.id,
    });
    expect(afterStepLimit).toEqual(exactSteps);
    expect(parseBuilderState(exactSteps).success).toBe(true);
    const overSteps = builderStateWithShape(1, TRAINING_DATA_LIMITS.exercisesPerSection + 1);
    expect(parseBuilderState(overSteps)).toMatchObject({
      success: false,
      errors: {
        [`section-steps-${requireSection(overSteps).id}`]: `Use no more than ${TRAINING_DATA_LIMITS.exercisesPerSection} exercises per activity.`,
      },
    });

    const exactTotal = builderStateWithShape(4, TRAINING_DATA_LIMITS.exercisesPerSection - 1);
    expect(parseBuilderState(exactTotal).success).toBe(true);
    expect(builderReducer(exactTotal, { type: 'add-section' })).toBe(exactTotal);
    const exactTotalSection = requireSection(exactTotal);
    expect(
      builderReducer(exactTotal, { type: 'add-step', sectionId: exactTotalSection.id }),
    ).toEqual(exactTotal);
    const overTotal = builderStateWithShape(4, TRAINING_DATA_LIMITS.exercisesPerSection - 1);
    const overTotalLastSection = requireSection(overTotal, 3);
    const overTotalWithOneExtra: BuilderState = {
      ...overTotal,
      sections: overTotal.sections.map((candidate, sectionIndex) =>
        sectionIndex === 3
          ? {
              ...candidate,
              steps: [
                ...overTotalLastSection.steps,
                draftStep(3, TRAINING_DATA_LIMITS.exercisesPerSection - 1),
              ],
            }
          : candidate,
      ),
    };
    expect(parseBuilderState(overTotalWithOneExtra)).toMatchObject({
      success: false,
      errors: {
        activities: `Use no more than ${TRAINING_DATA_LIMITS.totalActivitiesPerTrainingSet} activities in total.`,
      },
    });
  });

  it('rejects one-over builder text limits while accepting exact values', () => {
    const exact = builderStateWithShape(1, 1);
    const exactSection = requireSection(exact);
    const exactStep = requireStep(exactSection);
    const exactTextState: BuilderState = {
      ...exact,
      name: 'n'.repeat(TRAINING_DATA_LIMITS.nameCharacters),
      description: 'd'.repeat(TRAINING_DATA_LIMITS.descriptionCharacters),
      sections: [
        {
          ...exactSection,
          label: 's'.repeat(TRAINING_DATA_LIMITS.nameCharacters),
          steps: [
            {
              ...exactStep,
              label: 'e'.repeat(TRAINING_DATA_LIMITS.nameCharacters),
            },
          ],
        },
      ],
    };
    expect(parseBuilderState(exactTextState).success).toBe(true);
    const overflowCases: readonly BuilderState[] = [
      { ...exactTextState, name: 'n'.repeat(TRAINING_DATA_LIMITS.nameCharacters + 1) },
      {
        ...exactTextState,
        description: 'd'.repeat(TRAINING_DATA_LIMITS.descriptionCharacters + 1),
      },
      {
        ...exactTextState,
        sections: [
          {
            ...exactSection,
            label: 's'.repeat(TRAINING_DATA_LIMITS.nameCharacters + 1),
          },
        ],
      },
      {
        ...exactTextState,
        sections: [
          {
            ...exactSection,
            steps: [
              {
                ...exactStep,
                label: 'e'.repeat(TRAINING_DATA_LIMITS.nameCharacters + 1),
              },
            ],
          },
        ],
      },
    ];
    for (const state of overflowCases) {
      expect(parseBuilderState(state).success).toBe(false);
    }
  });

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
