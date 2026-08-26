import { describe, expect, it } from 'vitest';

import defaultDrillsSource from '../data/default-drills.json';
import researchedDrillsSource from '../data/researched-drills.json';
import kendoDrillsSchema from '../schema/kendo-drills.schema.json';
import trainingSetMetaSchema from '../schema/training-set.schema.json';
import {
  DEFAULT_TRAINING_SETS,
  getTrainingSetActivities,
  validateCuratedDrills,
  type TrainingActivity,
  type TrainingSet,
} from './index';

interface SourceExercise {
  readonly name: string;
  readonly description?: string;
  readonly reps?: number;
  readonly sets?: number;
  readonly durationSeconds?: number;
  readonly rounds?: number;
}

interface SourceSection {
  readonly name: string;
  readonly exercises: readonly SourceExercise[];
}

interface SourceDrill {
  readonly name: string;
  readonly description?: string;
  readonly sections: readonly SourceSection[];
}

function projectActivity(activity: TrainingActivity): SourceExercise {
  const quantities = activity.quantities;
  let durationSeconds: number | undefined;
  if (quantities?.duration !== undefined) {
    if (!('value' in quantities.duration)) {
      throw new Error('The researched source does not contain continuous duration ranges.');
    }
    durationSeconds =
      quantities.duration.unit === 'seconds'
        ? quantities.duration.value
        : quantities.duration.value * 60;
  }

  return {
    name: activity.name,
    ...(activity.notes === undefined ? {} : { description: activity.notes }),
    ...(quantities?.repetitions === undefined ? {} : { reps: quantities.repetitions }),
    ...(quantities?.sets === undefined ? {} : { sets: quantities.sets }),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(quantities?.rounds === undefined ? {} : { rounds: quantities.rounds }),
  };
}

function projectTrainingSet(trainingSet: TrainingSet): SourceDrill {
  return {
    name: trainingSet.name,
    ...(trainingSet.description === undefined ? {} : { description: trainingSet.description }),
    sections: trainingSet.sections.map((section) => ({
      name: section.name,
      exercises:
        section.exercises.length === 0
          ? [projectActivity(section)]
          : section.exercises.map(projectActivity),
    })),
  };
}

describe('canonical researched drills', () => {
  it('validates the canonical collection and preserves the previous source exactly', () => {
    expect(validateCuratedDrills(defaultDrillsSource)).toEqual({
      success: true,
      value: defaultDrillsSource,
    });
    expect(DEFAULT_TRAINING_SETS.map(projectTrainingSet)).toEqual(researchedDrillsSource.drills);
  });

  it('keeps all source order, counts, and numeric provenance references', () => {
    const sections = DEFAULT_TRAINING_SETS.flatMap((trainingSet) => trainingSet.sections);
    const childExercises = sections.flatMap((section) => section.exercises);
    const standaloneSections = sections.filter((section) => section.exercises.length === 0);

    expect(DEFAULT_TRAINING_SETS).toHaveLength(11);
    expect(sections).toHaveLength(90);
    expect(childExercises).toHaveLength(168);
    expect(standaloneSections).toHaveLength(46);
    expect(DEFAULT_TRAINING_SETS.flatMap(getTrainingSetActivities)).toHaveLength(214);
    expect(DEFAULT_TRAINING_SETS.map((trainingSet) => trainingSet.sourceId)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(DEFAULT_TRAINING_SETS.map((trainingSet) => trainingSet.name)).toEqual(
      researchedDrillsSource.drills.map((drill) => drill.name),
    );
  });

  it('preserves the four independent International dojo Uchikomi exercises', () => {
    const international = DEFAULT_TRAINING_SETS[0];
    const uchikomi = international?.sections.find((section) => section.name === 'Uchikomi');

    expect(international?.name).toBe('International dojo (2 hour session)');
    expect(uchikomi?.exercises.map((exercise) => exercise.name)).toEqual([
      'men',
      'kote',
      'kote-men',
      'men',
    ]);
    expect(uchikomi?.exercises.map((exercise) => exercise.id)).toEqual([
      'international-dojo-2-hour-session-uchikomi-men-1',
      'international-dojo-2-hour-session-uchikomi-kote',
      'international-dojo-2-hour-session-uchikomi-kote-men',
      'international-dojo-2-hour-session-uchikomi-men-2',
    ]);
  });

  it('preserves all three rounds values alongside their original durations', () => {
    const activities = DEFAULT_TRAINING_SETS.flatMap(getTrainingSetActivities);
    expect(
      activities
        .filter((activity) => activity.quantities?.rounds !== undefined)
        .map((activity) => ({
          id: activity.id,
          rounds: activity.quantities?.rounds,
          duration: activity.quantities?.duration,
        })),
    ).toEqual([
      {
        id: 'international-dojo-2-hour-session-kakarigeiko-kakarigeiko',
        rounds: 10,
        duration: { unit: 'seconds', value: 60 },
      },
      {
        id: 'international-dojo-2-hour-session-jigeiko-jigeiko',
        rounds: 10,
        duration: { unit: 'minutes', value: 2 },
      },
      {
        id: 'junior-high-kendo-club-kakarigeiko-kakarigeiko',
        rounds: 30,
        duration: { unit: 'seconds', value: 20 },
      },
    ]);
  });

  it('keeps fixed minutes, fixed seconds, timed circuits, and simultaneous counts', () => {
    const activities = DEFAULT_TRAINING_SETS.flatMap(getTrainingSetActivities);
    const byId = new Map(activities.map((activity) => [activity.id, activity]));

    expect(
      byId.get('international-dojo-2-hour-session-butsukarigeiko-butsukarigeiko')?.quantities,
    ).toEqual({ duration: { unit: 'minutes', value: 5 } });
    expect(byId.get('university-version-2-kakarigeijo-kakarigeijo')?.quantities).toEqual({
      duration: { unit: 'seconds', value: 300 },
    });
    expect(byId.get('university-high-school-ken-tore-circuit-kirikaeshi')?.quantities).toEqual({
      sets: 3,
      duration: { unit: 'seconds', value: 30 },
    });
    expect(byId.get('junior-high-kendo-club-suburi-haya')?.quantities).toEqual({
      repetitions: 100,
      sets: 2,
    });
  });

  it('keeps conservative wording and does not turn stated alternatives into a range', () => {
    const universityVersionTwo = DEFAULT_TRAINING_SETS.find(
      (trainingSet) => trainingSet.id === 'university-version-2',
    );
    const topUniversity = DEFAULT_TRAINING_SETS.find(
      (trainingSet) => trainingSet.id === 'top-university',
    );
    const dojoLength = universityVersionTwo?.sections[3];
    const kakarigeijo = universityVersionTwo?.sections[10];
    const sandan = topUniversity?.sections[1];
    const feeVersion = topUniversity?.sections[3];
    const kubun = topUniversity?.sections[4];

    expect(dojoLength?.name).toBe('Dojo-length drills');
    expect(kakarigeijo?.name).toBe('kakarigeijo');
    expect(sandan?.name).toBe('Sandan geiko');
    expect(sandan?.exercises).toEqual([
      expect.objectContaining({
        name: 'Kirikaeshi',
        notes: '50/40/30 pattern or 100/100/100 pattern',
      }),
    ]);
    expect(feeVersion?.name).toBe('Fee version');
    expect(kubun?.exercises.map((exercise) => exercise.notes)).toEqual([
      '1st person, 30/60 seconds',
      '2nd person, 30/60 seconds',
      '3rd person, 30/60 seconds',
    ]);
    expect(kubun?.exercises.every((exercise) => exercise.quantities === undefined)).toBe(true);
  });

  it('rejects duplicate IDs, malformed quantities, and reversed ranges', () => {
    const duplicateIds: unknown = defaultDrillsSource.map((drill, index) =>
      index === 1 ? { ...drill, id: defaultDrillsSource[0]?.id } : drill,
    );
    const negative: unknown = defaultDrillsSource.map((drill, drillIndex) =>
      drillIndex === 0
        ? {
            ...drill,
            sections: drill.sections.map((section, sectionIndex) =>
              sectionIndex === 0 ? { ...section, quantities: { repetitions: -1 } } : section,
            ),
          }
        : drill,
    );
    const reversed: unknown = defaultDrillsSource.map((drill, drillIndex) =>
      drillIndex === 0
        ? {
            ...drill,
            sections: drill.sections.map((section, sectionIndex) =>
              sectionIndex === 0
                ? {
                    ...section,
                    quantities: {
                      duration: { unit: 'minutes', min: 10, max: 5 },
                    },
                  }
                : section,
            ),
          }
        : drill,
    );

    expect(validateCuratedDrills(duplicateIds).success).toBe(false);
    expect(validateCuratedDrills(negative).success).toBe(false);
    expect(validateCuratedDrills(reversed).success).toBe(false);
  });
});

describe('schema roles and constraints', () => {
  it('keeps training-set.schema.json as the generic Draft-07 meta-schema', () => {
    expect(trainingSetMetaSchema).toMatchObject({
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'http://json-schema.org/draft-07/schema#',
      title: 'Core schema meta-schema',
    });
  });

  it('defines a separate strict Draft-07 Kendo collection schema', () => {
    expect(kendoDrillsSchema).toMatchObject({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'array',
      minItems: 1,
      items: { $ref: '#/definitions/drill' },
      definitions: {
        quantities: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
        },
        duration: {
          oneOf: [{ $ref: '#/definitions/fixedDuration' }, { $ref: '#/definitions/durationRange' }],
        },
        exercise: {
          required: ['id', 'name'],
          additionalProperties: false,
        },
        section: {
          required: ['id', 'name', 'exercises'],
          additionalProperties: false,
        },
        drill: {
          required: ['id', 'name', 'sections'],
          additionalProperties: false,
        },
      },
    });
    expect(kendoDrillsSchema.definitions.count).toMatchObject({
      type: 'integer',
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    expect(kendoDrillsSchema.definitions.durationUnit.enum).toEqual(['seconds', 'minutes']);
  });
});
