import { describe, expect, it } from 'vitest';

import defaultDrillsSource from '../data/default-drills.json';
import kendoDrillsSchema from '../schema/kendo-drills.schema.json';
import {
  DEFAULT_TRAINING_SETS,
  getTrainingSetActivities,
  validateCuratedDrills,
  type CuratedDrill,
  type TrainingActivity,
  type TrainingSection,
  type TrainingSet,
} from './index';

function projectTrainingSet(trainingSet: TrainingSet): CuratedDrill {
  return {
    id: trainingSet.id,
    ...(trainingSet.sourceId === undefined ? {} : { sourceId: trainingSet.sourceId }),
    name: trainingSet.name,
    ...(trainingSet.description === undefined ? {} : { description: trainingSet.description }),
    sections: trainingSet.sections.map((section) => ({
      id: section.id,
      name: section.name,
      ...(section.quantities === undefined ? {} : { quantities: section.quantities }),
      ...(section.notes === undefined ? {} : { notes: section.notes }),
      exercises: section.exercises.map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        ...(exercise.quantities === undefined ? {} : { quantities: exercise.quantities }),
        ...(exercise.notes === undefined ? {} : { notes: exercise.notes }),
      })),
    })),
  };
}

function requireTrainingSet(id: string): TrainingSet {
  const trainingSet = DEFAULT_TRAINING_SETS.find((candidate) => candidate.id === id);
  if (trainingSet === undefined) {
    throw new Error(`Expected curated drill ${id}.`);
  }
  return trainingSet;
}

function requireSection(trainingSetId: string, sectionId: string): TrainingSection {
  const section = requireTrainingSet(trainingSetId).sections.find(
    (candidate) => candidate.id === sectionId,
  );
  if (section === undefined) {
    throw new Error(`Expected curated section ${sectionId}.`);
  }
  return section;
}

function requireActivity(trainingSetId: string, activityId: string): TrainingActivity {
  const activity = getTrainingSetActivities(requireTrainingSet(trainingSetId)).find(
    (candidate) => candidate.id === activityId,
  );
  if (activity === undefined) {
    throw new Error(`Expected curated activity ${activityId}.`);
  }
  return activity;
}

describe('canonical default drills', () => {
  it('validates the canonical source and preserves it exactly in the runtime adapter', () => {
    expect(validateCuratedDrills(defaultDrillsSource)).toEqual({
      success: true,
      value: defaultDrillsSource,
    });
    expect(DEFAULT_TRAINING_SETS.map(projectTrainingSet)).toEqual(defaultDrillsSource);
  });

  it('keeps all authoritative order, counts, provenance values, and unique stable IDs', () => {
    const sections = DEFAULT_TRAINING_SETS.flatMap((trainingSet) => trainingSet.sections);
    const childExercises = sections.flatMap((section) => section.exercises);
    const standaloneSections = sections.filter((section) => section.exercises.length === 0);
    const ids = DEFAULT_TRAINING_SETS.flatMap((trainingSet) => [
      trainingSet.id,
      ...trainingSet.sections.flatMap((section) => [
        section.id,
        ...section.exercises.map((exercise) => exercise.id),
      ]),
    ]);

    expect(DEFAULT_TRAINING_SETS).toHaveLength(11);
    expect(sections).toHaveLength(90);
    expect(childExercises).toHaveLength(165);
    expect(standaloneSections).toHaveLength(46);
    expect(DEFAULT_TRAINING_SETS.flatMap(getTrainingSetActivities)).toHaveLength(211);
    expect(ids).toHaveLength(266);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_TRAINING_SETS.map((trainingSet) => trainingSet.sourceId)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it('maps the current authoritative drill names to their existing IDs and source IDs', () => {
    expect(DEFAULT_TRAINING_SETS.map(({ id, sourceId, name }) => ({ id, sourceId, name }))).toEqual(
      [
        {
          id: 'international-dojo-2-hour-session',
          sourceId: 1,
          name: 'International dojo menu (2 hour session)',
        },
        {
          id: 'japanese-school-club',
          sourceId: 2,
          name: 'Japanese school dojo menu',
        },
        {
          id: 'junior-high-kendo-club',
          sourceId: 3,
          name: 'Junior-high school dojo menu',
        },
        {
          id: 'official-znkr-ajkf',
          sourceId: 4,
          name: 'Official ZNKR/AJKF menu',
        },
        {
          id: 'police-dojo-asageiko',
          sourceId: 5,
          name: 'Police dojo asageiko menu',
        },
        {
          id: 'police-dojo-asageiko-version-2',
          sourceId: 6,
          name: 'Police dojo asageiko type 2 menu',
        },
        {
          id: 'senior-high-school-kendo-club',
          sourceId: 7,
          name: 'Senior High School dojo menu',
        },
        {
          id: 'university-high-school',
          sourceId: 8,
          name: 'University High School dojo menu',
        },
        {
          id: 'junior-high-school-version-2',
          sourceId: 9,
          name: 'Junior High School dojo type 2 menu',
        },
        {
          id: 'university-version-2',
          sourceId: 10,
          name: 'University dojo menu',
        },
        {
          id: 'top-university',
          sourceId: 11,
          name: 'Top university dojo menu',
        },
      ],
    );
  });

  it('keeps accepted display normalization separate from stable ASCII IDs', () => {
    expect(
      requireActivity('japanese-school-club', 'japanese-school-club-suburi-joge'),
    ).toMatchObject({
      id: 'japanese-school-club-suburi-joge',
      name: 'jōge',
    });
    expect(requireActivity('official-znkr-ajkf', 'official-znkr-ajkf-kihon-waza-do')).toMatchObject(
      {
        id: 'official-znkr-ajkf-kihon-waza-do',
        name: 'Dō',
      },
    );
  });

  it('keeps Suburi source quantities sparse at the correct structural level', () => {
    const internationalSuburi = requireSection(
      'international-dojo-2-hour-session',
      'international-dojo-2-hour-session-suburi-suburi',
    );
    const universitySuburi = requireSection(
      'university-version-2',
      'university-version-2-suburi-suburi',
    );
    const japaneseSuburi = requireSection('japanese-school-club', 'japanese-school-club-suburi');
    const seniorHighSuburi = requireSection(
      'senior-high-school-kendo-club',
      'senior-high-school-kendo-club-suburi',
    );

    expect(internationalSuburi.quantities).toEqual({
      duration: { unit: 'minutes', value: 15 },
    });
    expect(internationalSuburi.exercises).toEqual([]);
    expect(universitySuburi.quantities).toBeUndefined();
    expect(universitySuburi.exercises).toEqual([]);
    expect(japaneseSuburi.exercises.map((exercise) => exercise.quantities)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(seniorHighSuburi.exercises.every((exercise) => exercise.quantities === undefined)).toBe(
      true,
    );
    expect(
      requireActivity('junior-high-kendo-club', 'junior-high-kendo-club-suburi-haya').quantities,
    ).toEqual({ repetitions: 100, sets: 2 });
    expect(
      requireActivity(
        'junior-high-school-version-2',
        'junior-high-school-version-2-suburi-hayasuburi',
      ).quantities,
    ).toEqual({ repetitions: 100, sets: 3 });
  });

  it('deep-freezes the canonical runtime tree, including standalone and ranged activities', () => {
    const standalone = requireSection(
      'international-dojo-2-hour-session',
      'international-dojo-2-hour-session-warm-up-warm-up',
    );
    const ranged = requireActivity(
      'top-university',
      'top-university-kubun-geiko-uchikomi-men-only',
    );

    expect(standalone.exercises).toEqual([]);
    expect(standalone.quantities).toEqual({ duration: { unit: 'minutes', value: 10 } });
    expect(ranged.quantities).toEqual({ duration: { unit: 'seconds', min: 30, max: 60 } });
    expect(
      getTrainingSetActivities(requireTrainingSet('international-dojo-2-hour-session')),
    ).toContain(standalone);
    expect(Object.isFrozen(DEFAULT_TRAINING_SETS)).toBe(true);
    for (const trainingSet of DEFAULT_TRAINING_SETS) {
      expect(Object.isFrozen(trainingSet)).toBe(true);
      expect(Object.isFrozen(trainingSet.sections)).toBe(true);
      for (const section of trainingSet.sections) {
        expect(Object.isFrozen(section)).toBe(true);
        expect(Object.isFrozen(section.exercises)).toBe(true);
        if (section.quantities !== undefined) {
          expect(Object.isFrozen(section.quantities)).toBe(true);
          if (section.quantities.duration !== undefined) {
            expect(Object.isFrozen(section.quantities.duration)).toBe(true);
          }
        }
        for (const exercise of section.exercises) {
          expect(Object.isFrozen(exercise)).toBe(true);
          if (exercise.quantities !== undefined) {
            expect(Object.isFrozen(exercise.quantities)).toBe(true);
            if (exercise.quantities.duration !== undefined) {
              expect(Object.isFrozen(exercise.quantities.duration)).toBe(true);
            }
          }
        }
      }
    }
  });

  it('models International Uchikomi as one ordered sequence repeated five times', () => {
    const uchikomi = requireSection(
      'international-dojo-2-hour-session',
      'international-dojo-2-hour-session-uchikomi',
    );

    expect(uchikomi.exercises).toEqual([
      {
        id: 'international-dojo-2-hour-session-uchikomi-men-kote-kote-men-men',
        name: 'Men → Kote → Kote-men → Men',
        quantities: { repetitions: 5 },
      },
    ]);
  });

  it('keeps parenthetical totals as notes without deriving rounds', () => {
    const internationalKakarigeiko = requireActivity(
      'international-dojo-2-hour-session',
      'international-dojo-2-hour-session-kakarigeiko-kakarigeiko',
    );
    const internationalJigeiko = requireActivity(
      'international-dojo-2-hour-session',
      'international-dojo-2-hour-session-jigeiko-jigeiko',
    );
    const juniorHighKakarigeiko = requireActivity(
      'junior-high-kendo-club',
      'junior-high-kendo-club-kakarigeiko-kakarigeiko',
    );

    expect(internationalKakarigeiko).toMatchObject({
      notes: '10 minutes total',
      quantities: { duration: { unit: 'seconds', value: 60 } },
    });
    expect(internationalJigeiko).toMatchObject({
      notes: '20 minutes total',
      quantities: { duration: { unit: 'minutes', value: 2 } },
    });
    expect(juniorHighKakarigeiko).toMatchObject({
      notes: '10 minutes total',
      quantities: { duration: { unit: 'seconds', value: 20 } },
    });
    expect(
      DEFAULT_TRAINING_SETS.flatMap(getTrainingSetActivities).every(
        (activity) => activity.quantities?.rounds === undefined,
      ),
    ).toBe(true);
  });

  it('preserves per-round meaning without inventing a round count', () => {
    expect(
      requireActivity(
        'senior-high-school-kendo-club',
        'senior-high-school-kendo-club-jigeiko-jigeiko',
      ),
    ).toMatchObject({
      notes: '3 min rounds',
      quantities: { duration: { unit: 'minutes', value: 3 } },
    });
    expect(requireActivity('top-university', 'top-university-jigeiko-jigeiko')).toMatchObject({
      notes: '2 min per round',
      quantities: { duration: { unit: 'minutes', value: 2 } },
    });
  });

  it('keeps the eight Ken-tore station exercises timed and independently editable', () => {
    const section = requireSection(
      'university-high-school',
      'university-high-school-ken-tore-circuit',
    );

    expect(section.notes).toBe(
      'Station A: Kirikaeshi, Hayasuburi, Stationary kote-men, Left-right do-kirikaeshi\n' +
        'Station B: Men, Kote, Kote-men, Do',
    );
    expect(section.exercises.map(({ id, name }) => ({ id, name }))).toEqual([
      {
        id: 'university-high-school-ken-tore-circuit-kirikaeshi',
        name: 'kirikaeshi',
      },
      {
        id: 'university-high-school-ken-tore-circuit-hayasuburi',
        name: 'hayasuburi',
      },
      {
        id: 'university-high-school-ken-tore-circuit-stationary-kote-men',
        name: 'stationary kote-men',
      },
      {
        id: 'university-high-school-ken-tore-circuit-left-right-do-kirikaeshi',
        name: 'left-right do-kirikaeshi',
      },
      { id: 'university-high-school-ken-tore-circuit-men', name: 'men' },
      { id: 'university-high-school-ken-tore-circuit-kote', name: 'kote' },
      { id: 'university-high-school-ken-tore-circuit-kote-men', name: 'kote-men' },
      { id: 'university-high-school-ken-tore-circuit-do', name: 'do' },
    ]);
    expect(section.exercises.map((exercise) => exercise.quantities)).toEqual(
      Array.from({ length: 8 }, () => ({ duration: { unit: 'seconds', value: 30 } })),
    );
  });

  it('scopes the dojo-length instruction to its three source exercises', () => {
    const section = requireSection(
      'university-version-2',
      'university-version-2-dojo-length-drills',
    );

    expect(section.notes).toBe(
      'The following three Kirikaeshi exercises are performed over the length of the dojo',
    );
    expect(section.exercises.map((exercise) => exercise.id)).toEqual([
      'university-version-2-dojo-length-drills-slow-kirikaeshi',
      'university-version-2-dojo-length-drills-kirikaeshi',
      'university-version-2-dojo-length-drills-kirikaeshi-suriashi',
    ]);
    expect(section.exercises.map((exercise) => exercise.quantities?.repetitions)).toEqual([
      2, 2, 2,
    ]);
  });

  it('preserves the current source repetition scopes without changing stable IDs', () => {
    expect(
      requireSection('police-dojo-asageiko', 'police-dojo-asageiko-kirikaeshi-2-kirikaeshi'),
    ).toMatchObject({
      id: 'police-dojo-asageiko-kirikaeshi-2-kirikaeshi',
      quantities: { repetitions: 1 },
    });
    expect(
      requireSection(
        'police-dojo-asageiko-version-2',
        'police-dojo-asageiko-version-2-kirikaeshi-1-kirikaeshi',
      ),
    ).toMatchObject({
      id: 'police-dojo-asageiko-version-2-kirikaeshi-1-kirikaeshi',
      notes: '3 men + 1 full kirikaeshi',
      quantities: { repetitions: 3 },
    });
    expect(
      requireSection(
        'police-dojo-asageiko-version-2',
        'police-dojo-asageiko-version-2-kirikaeshi-2-kirikaeshi',
      ),
    ).toMatchObject({
      id: 'police-dojo-asageiko-version-2-kirikaeshi-2-kirikaeshi',
      quantities: { repetitions: 1 },
    });

    const universityHighKirikaeshi = requireSection(
      'university-high-school',
      'university-high-school-kirikaeshi',
    );
    expect(
      universityHighKirikaeshi.exercises.map(({ id, name, quantities }) => ({
        id,
        name,
        quantities,
      })),
    ).toEqual([
      {
        id: 'university-high-school-kirikaeshi-5-men-kirikaeshi',
        name: 'men + kirikaeshi',
        quantities: { repetitions: 5 },
      },
      {
        id: 'university-high-school-kirikaeshi-5-tsuki-kirikaeshi',
        name: 'tsuki + kirikaeshi',
        quantities: { repetitions: 5 },
      },
      {
        id: 'university-high-school-kirikaeshi-fast-kirikaeshi',
        name: 'fast kirikaeshi',
        quantities: { repetitions: 1 },
      },
      {
        id: 'university-high-school-kirikaeshi-one-breath-kirikaeshi',
        name: 'one-breath kirikaeshi',
        quantities: { repetitions: 1 },
      },
      {
        id: 'university-high-school-kirikaeshi-ai-kirikaeshi',
        name: 'ai kirikaeshi',
        quantities: { repetitions: 1 },
      },
    ]);

    expect(
      requireActivity('top-university', 'top-university-yakusoku-geiko-hiki-do-men-kirikaeshi'),
    ).toEqual({
      id: 'top-university-yakusoku-geiko-hiki-do-men-kirikaeshi',
      name: 'Hiki-dō → Men → Kirikaeshi',
      quantities: { repetitions: 100 },
    });
    expect(
      requireActivity('top-university', 'top-university-yakusoku-geiko-men-kote-men-taiatari')
        .notes,
    ).toBeUndefined();
  });

  it('keeps explicit units, simultaneous counts, and continuous duration ranges', () => {
    expect(
      requireActivity('university-version-2', 'university-version-2-kakarigeijo-kakarigeijo')
        .quantities,
    ).toEqual({ duration: { unit: 'minutes', value: 5 } });
    expect(
      requireActivity('junior-high-kendo-club', 'junior-high-kendo-club-suburi-haya').quantities,
    ).toEqual({ repetitions: 100, sets: 2 });

    const kubun = requireSection('top-university', 'top-university-kubun-geiko');
    expect(kubun.notes).toBe('Classification-geiko');
    expect(kubun.exercises.map((exercise) => exercise.notes)).toEqual([
      '1st person',
      '2nd person',
      '3rd person',
    ]);
    expect(kubun.exercises.map((exercise) => exercise.quantities)).toEqual(
      Array.from({ length: 3 }, () => ({
        duration: { unit: 'seconds', min: 30, max: 60 },
      })),
    );
  });

  it('keeps the two Fee version methods as stable-ID options', () => {
    const feeVersion = requireSection('top-university', 'top-university-fee-version');

    expect(feeVersion.notes).toBe(
      'These two methods are options, not sequential mandatory exercises.',
    );
    expect(feeVersion.exercises.map(({ id, name }) => ({ id, name }))).toEqual([
      {
        id: 'top-university-fee-version-uchikomi-geiko',
        name: 'Uchikomi-geiko',
      },
      {
        id: 'top-university-fee-version-kakari-geiko',
        name: 'Kakari-geiko',
      },
    ]);
  });

  it('rejects duplicate IDs, malformed quantities, non-finite values, and reversed ranges', () => {
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
    const nonFinite: unknown = defaultDrillsSource.map((drill, drillIndex) =>
      drillIndex === 0
        ? {
            ...drill,
            sections: drill.sections.map((section, sectionIndex) =>
              sectionIndex === 0
                ? {
                    ...section,
                    quantities: { duration: { unit: 'seconds', value: Number.POSITIVE_INFINITY } },
                  }
                : section,
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
                    quantities: { duration: { unit: 'minutes', min: 10, max: 5 } },
                  }
                : section,
            ),
          }
        : drill,
    );
    const emptyQuantities: unknown = defaultDrillsSource.map((drill, drillIndex) =>
      drillIndex === 0
        ? {
            ...drill,
            sections: drill.sections.map((section, sectionIndex) =>
              sectionIndex === 0 ? { ...section, quantities: {} } : section,
            ),
          }
        : drill,
    );

    expect(validateCuratedDrills(duplicateIds).success).toBe(false);
    expect(validateCuratedDrills(negative).success).toBe(false);
    expect(validateCuratedDrills(nonFinite).success).toBe(false);
    expect(validateCuratedDrills(reversed).success).toBe(false);
    expect(validateCuratedDrills(emptyQuantities).success).toBe(false);
  });
});

describe('canonical schema role and constraints', () => {
  it('defines a strict Draft-07 Kendo collection schema that covers corrected data', () => {
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
    expect(kendoDrillsSchema.definitions.durationRange.required).toEqual(['unit', 'min', 'max']);
    expect(kendoDrillsSchema.definitions.section.properties.quantities).toEqual({
      $ref: '#/definitions/quantities',
    });
    expect(kendoDrillsSchema.definitions.exercise.properties.quantities).toEqual({
      $ref: '#/definitions/quantities',
    });
    expect(kendoDrillsSchema.definitions.exercise.required).not.toContain('quantities');
    expect(kendoDrillsSchema.definitions.section.properties.notes).toEqual({ type: 'string' });
    expect(kendoDrillsSchema.definitions.exercise.properties.notes).toEqual({ type: 'string' });
  });
});
