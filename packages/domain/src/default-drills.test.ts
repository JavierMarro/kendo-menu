import { describe, expect, it } from 'vitest';

import defaultDrillsSource from '../data/default-drills.json';
import kendoDrillsSchema from '../schema/kendo-drills.schema.json';
import {
  DEFAULT_TRAINING_SETS,
  getTrainingSetActivities,
  getTrainingSetLeafExerciseCount,
  validateCuratedDrills,
  validateTrainingSet,
  type CuratedDrill,
  type CuratedActivity,
  type TrainingActivity,
  type TrainingSet,
} from './index';

function projectCuratedActivity(activity: TrainingActivity): CuratedActivity {
  return {
    id: activity.id,
    name: activity.name,
    ...(activity.quantities === undefined ? {} : { quantities: activity.quantities }),
    ...(activity.notes === undefined ? {} : { notes: activity.notes }),
    ...(activity.editableQuantityUnits === undefined
      ? {}
      : { editableQuantityUnits: [...activity.editableQuantityUnits] }),
    ...(activity.allowsSessionNotes === undefined
      ? {}
      : { allowsSessionNotes: activity.allowsSessionNotes }),
    ...(activity.children.length === 0
      ? {}
      : { exercises: activity.children.map(projectCuratedActivity) }),
  };
}

function projectTrainingSet(trainingSet: TrainingSet): CuratedDrill {
  return {
    id: trainingSet.id,
    ...(trainingSet.sourceId === undefined ? {} : { sourceId: trainingSet.sourceId }),
    name: trainingSet.name,
    ...(trainingSet.description === undefined ? {} : { description: trainingSet.description }),
    sections: trainingSet.activities.map((activity) => ({
      ...projectCuratedActivity(activity),
      exercises: activity.children.map(projectCuratedActivity),
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

function requireSection(trainingSetId: string, sectionId: string): TrainingActivity {
  const section = requireTrainingSet(trainingSetId).activities.find(
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

const RECURSIVE_SCHEMA_VALID_FIXTURE: unknown = [
  {
    id: 'recursive-session',
    sourceId: 99,
    name: 'Recursive session',
    description: 'A schema fixture with four activity levels.',
    sections: [
      {
        id: 'recursive-root',
        name: 'Root activity',
        exercises: [
          {
            id: 'recursive-child',
            name: 'Child activity',
            exercises: [
              {
                id: 'recursive-grandchild',
                name: 'Grandchild activity',
                quantities: { duration: { unit: 'seconds', min: 5, max: 10 } },
                editableQuantityUnits: ['seconds', 'minutes'],
                allowsSessionNotes: true,
                exercises: [{ id: 'recursive-leaf', name: 'Leaf activity' }],
              },
            ],
          },
        ],
      },
    ],
  },
];

const RECURSIVE_SCHEMA_INVALID_FIXTURES: readonly unknown[] = [
  [
    {
      id: 'recursive-session',
      name: 'Duplicate nested ID',
      sections: [
        {
          id: 'recursive-root',
          name: 'Root activity',
          exercises: [{ id: 'recursive-root', name: 'Duplicate child' }],
        },
      ],
    },
  ],
  [
    {
      id: 'recursive-session',
      name: 'Malformed nested children',
      sections: [
        {
          id: 'recursive-root',
          name: 'Root activity',
          exercises: [{ id: 'recursive-child', name: 'Child activity', exercises: 'not-an-array' }],
        },
      ],
    },
  ],
  [
    {
      id: 'recursive-session',
      name: 'Invalid activity metadata',
      sections: [
        {
          id: 'recursive-root',
          name: 'Root activity',
          exercises: [
            {
              id: 'recursive-child',
              name: 'Child activity',
              editableQuantityUnits: ['seconds', 'seconds'],
              allowsSessionNotes: false,
            },
          ],
        },
      ],
    },
  ],
];

type ActivityNameTree = string | readonly [string, readonly ActivityNameTree[]];

function projectActivityNameTree(activity: TrainingActivity): ActivityNameTree {
  return activity.children.length === 0
    ? activity.name
    : [activity.name, activity.children.map(projectActivityNameTree)];
}

const IN_SCOPE_ACTIVITY_NAME_TREES = {
  'international-dojo-2-hour-session': [
    'Warm-up',
    'Suburi',
    'Ashi sabaki',
    'Kirikaeshi',
    ['Kihon-waza', ['Men', 'Kote', 'Do', 'Tsuki']],
    ['Uchikomi', ['Men → Kote → Kote-men → Men']],
    ['Shikake-waza', ['Men', 'Kote', 'Do']],
    ['Oji-waza', ['Kaeshi do', 'Kaeshi men']],
    ['Hiki-waza', ['Hiki men', 'Hiki kote', 'Hiki do']],
    'Butsukarigeiko',
    'Kakarigeiko',
    'Jigeiko',
  ],
  'japanese-school-club': [
    'Warm-up',
    ['Suburi', ['Joge', 'Shomen', 'Sayu-men', 'Haya']],
    'Ashi sabaki',
    'Kirikaeshi',
    'Kihon-waza',
    [
      'Oji-waza',
      [
        'Ai-men',
        'Men-suriage-men',
        'Debana kote',
        'Nuki-do',
        'Kaeshi-do',
        'Kote-suriage-men',
        'Kote-kaeshi-men',
        'Ai-kote-men',
        'Kote-nuki-men',
      ],
    ],
    'Jigeiko',
    ['Hiki-waza', ['Hiki men', 'Hiki kote', 'Hiki do']],
    'Kakarigeiko',
    'Ai kakarigeiko',
    'Kirikaeshi',
  ],
  'junior-high-kendo-club': [
    ['Suburi', ['Joge', 'Shomen', 'Fumikomi', 'Sayu-men', 'Taisabaki-joge', 'Haya']],
    'Men-kirikaeshi',
    'Do-kirikaeshi',
    'Ai kirikaeshi',
    ['Kihon-waza', ['Big men', 'Big kote-men']],
    ['"Match-speed" strikes', ['Men', 'Kote', 'Do', 'Kote-men', 'Kote-do']],
    'Kakarigeiko',
    'Jigeiko',
  ],
  'official-znkr-ajkf': [
    'Warm-up',
    ['Kihon-waza', ['Men', 'Kote', 'Do', 'Tsuki']],
    ['Renzoku-waza', ['Kote-men']],
    ['Shikake-waza', ['Harai-men', 'Debana-kote']],
    ['Hiki-waza', ['Hiki-do']],
    ['Oji-waza', ['Men-nuki-do', 'Kote-suriage-men', 'Men-kaeshi-do', 'Do-uchiotoshi-men']],
  ],
  'police-dojo-asageiko': [
    'Warm-up',
    'Kirikaeshi',
    ['Kihon-waza', ['Men', 'Kote', 'Kote-men', "Moshiawase (kakarite's choice)"]],
    ['Uchikomi', ['Men']],
    'Kirikaeshi',
  ],
  'police-dojo-asageiko-version-2': [
    'Kirikaeshi',
    ['Renzoku-waza', ['Big men', 'Small men']],
    [
      'Kihon-waza',
      ['Small men', 'Small men', 'Small men', 'Kote', 'Kote-men', 'Katate-kote → morote-men'],
    ],
    ['Moshiawase oji-waza', ['Men', 'Kote', 'Men oji-waza vs. jodan', 'Kote oji-waza vs. jodan']],
    'Mawarigeiko',
    'Kirikaeshi',
  ],
  'senior-high-school-kendo-club': [
    ['Warm-up', ['Stretch', 'Ladder training']],
    ['Suburi', ['Joge', 'Shomen', 'Sayu-men', 'Matawari', 'Fumikomi', 'Ikkyodo (one-hand)']],
    ['Ashi sabaki', ['Suri-ashi drills']],
    'Suri-ash-kirikaeshi',
    'One-breath-kirikaeshi',
    'Ai kirikaeshi',
    'Do-kirikaeshi',
    ['Kihon-waza', ['Men', 'Sashi-men', 'Kote', 'Do', 'Morote-tsuki', 'Gyaku-do', 'Kote-men']],
    ['Hiki-waza', ['Hiki-men', 'Hiki-kote', 'Hiki-do', 'Hiki-gyaku-do']],
    [
      'Waza-geiko',
      [
        'Debana-men',
        'Debana-kote',
        'Men-nuki-do',
        'Men-suriage-men',
        'Ai-kote-men',
        'Kote-kaeshi-men',
      ],
    ],
    ['Oikomi-geiko', ['Big men', 'Small men', 'Kote-men', 'Hiki-men', 'Kote-men-do-kote-men']],
    'Pattern-geiko',
    'Jigeiko',
    'Kakarigeiko',
  ],
  'junior-high-school-version-2': [
    'Warm-up',
    [
      'Suburi',
      [
        'Sankyodo-shomen',
        'Sayu-men',
        'Shomen 2-step 4-directions',
        'Sayu 2-step 8-directions',
        'Zenshin-kotae shomen',
        'Haya',
      ],
    ],
    [
      'Ashi sabaki',
      [
        'One-step advances',
        'Position-swap suri-ashi',
        'One-leg suburi',
        '3-direction fumikomi',
        'Fumikomi-into-strike drills',
      ],
    ],
    'Kihon-waza',
    'Mawarigeiko',
  ],
  'university-version-2': [
    'Warm-up',
    'Suburi',
    'Ashi sabaki',
    ['Dojo-length drills', ['Slow kirikaeshi', 'Kirikaeshi', 'Kirikaeshi + suri-ashi']],
    ['Oikomi-geiko', ['Men', 'Kote-men']],
    ['Kihon-waza', ['Men', 'Kote', 'Do', 'Tsuki']],
    ['Shikake-waza', ['Men', 'Kote', 'Do']],
    ['Debana-waza', ['Debana men', 'Debana kote']],
    ['Hiki-waza', ['Hiki men', 'Hiki kote', 'Hiki do']],
    'Jigeiko',
    'Kakarigeiko',
    'Shiaigeiko',
  ],
  'university-high-school': [
    [
      'Kirikaeshi',
      [
        'Men + kirikaeshi',
        'Tsuki + kirikaeshi',
        'Fast kirikaeshi',
        'One-breath kirikaeshi',
        'Ai kirikaeshi',
      ],
    ],
    [
      'Kihon-waza',
      ['Big men', 'Small men', 'Seme ashi men', 'Seme men', 'Kote', 'Tsuki', 'Do', 'Gyaku-do'],
    ],
    ['Renzoku-waza', ['Kote-men', 'Kote-do', 'Tsuki-men', 'Tsuki-kote']],
    [
      'Ken-tore circuit',
      [
        [
          'Station A',
          ['Kirikaeshi', 'Hayasuburi', 'Stationary Kote-men', 'Left-right Dō-kirikaeshi'],
        ],
        ['Station B', ['Men', 'Kote', 'Kote-men', 'Dō']],
      ],
    ],
  ],
  'top-university': [
    'Warm-up',
    [
      'Sandan-geiko',
      [
        'Kirikaeshi',
        [
          'Yakusoku-geiko',
          [
            'Men → Kote',
            'Men → Kukan-datotsu-men',
            'Men → Kote-Men → Taiatari',
            'Hiki-dō → Men → 100 Kirikaeshi strikes',
          ],
        ],
        ['Free version', ['Uchikomi', 'Kakarigeiko']],
      ],
    ],
    ['Kubun-geiko', ['Uchikomi (Men only)', 'Kakari-geiko', 'Kirikaeshi']],
    'Jigeiko',
    'Kakarigeiko',
  ],
} satisfies Readonly<Record<string, readonly ActivityNameTree[]>>;

const IN_SCOPE_DESCRIPTIONS = {
  'international-dojo-2-hour-session': 'Set for a 2 hours long session.',
  'japanese-school-club': undefined,
  'junior-high-kendo-club': undefined,
  'official-znkr-ajkf':
    'Officially published by the All Japan Kendo Federation in 2001, for nidan and below, focused on basics.',
  'police-dojo-asageiko': 'Practiced with mostly 5th–8th dan practitioners, 30 minutes long.',
  'police-dojo-asageiko-version-2':
    'Normally run for small groups, and the menu tends to change depending on practitioners. 45 minutes long.',
  'senior-high-school-kendo-club': undefined,
  'junior-high-school-version-2': undefined,
  'university-version-2': undefined,
  'university-high-school':
    'Weekly rotation: Monday is self-directed practice; Tuesday centers on "Ken-tore" circuit (muscle training); Wednesday running/stair sprints plus suburi and suri-ashi; Thursday is kihon plus ji-geiko; Friday is kihon plus shiaigeiko; weekends are tournaments or shiaigeiko (defaulting to normal kihon/Ken-tore when there are none).',
  'top-university': undefined,
} satisfies Readonly<Record<string, string | undefined>>;

const RESEARCHED_SESSION_COUNTS = {
  'international-dojo-2-hour-session': { topLevel: 12, activities: 25, leaves: 20 },
  'japanese-school-club': { topLevel: 11, activities: 27, leaves: 24 },
  'junior-high-kendo-club': { topLevel: 8, activities: 21, leaves: 18 },
  'official-znkr-ajkf': { topLevel: 6, activities: 18, leaves: 13 },
  'police-dojo-asageiko': { topLevel: 5, activities: 10, leaves: 8 },
  'police-dojo-asageiko-version-2': { topLevel: 6, activities: 18, leaves: 15 },
  'senior-high-school-kendo-club': { topLevel: 14, activities: 45, leaves: 38 },
  'university-high-school': { topLevel: 4, activities: 31, leaves: 25 },
  'junior-high-school-version-2': { topLevel: 5, activities: 16, leaves: 14 },
  'university-version-2': { topLevel: 12, activities: 29, leaves: 23 },
  'top-university': { topLevel: 5, activities: 17, leaves: 13 },
} as const;

const SESSION_NOTE_ACTIVITY_IDS = [
  'international-dojo-2-hour-session-warm-up-warm-up',
  'international-dojo-2-hour-session-suburi-suburi',
  'international-dojo-2-hour-session-ashi-sabaki-ashi-sabaki',
  'japanese-school-club-warm-up-warm-up',
  'japanese-school-club-ashi-sabaki-ashi-sabaki',
  'japanese-school-club-kihon-waza-kihon-waza',
  'official-znkr-ajkf-warm-up-warm-up',
  'police-dojo-asageiko-warm-up-warm-up',
  'senior-high-school-kendo-club-pattern-geiko-pattern-geiko',
  'junior-high-school-version-2-warm-up-warm-up',
  'university-version-2-warm-up-warm-up',
  'university-version-2-suburi-suburi',
  'university-version-2-ashi-sabaki-ashi-sabaki',
  'top-university-warm-up-warm-up',
] as const;

describe('canonical default drills', () => {
  it('validates the canonical source and preserves it exactly in the runtime adapter', () => {
    expect(validateCuratedDrills(defaultDrillsSource)).toEqual({
      success: true,
      value: defaultDrillsSource,
    });
    expect(DEFAULT_TRAINING_SETS.map(projectTrainingSet)).toEqual(defaultDrillsSource);
  });

  it('keeps all authoritative order, counts, provenance values, and unique stable IDs', () => {
    const sections = DEFAULT_TRAINING_SETS.flatMap((trainingSet) => trainingSet.activities);
    const childExercises = sections.flatMap((section) => section.children);
    const standaloneSections = sections.filter((section) => section.children.length === 0);
    const activities = DEFAULT_TRAINING_SETS.flatMap(getTrainingSetActivities);
    const ids = DEFAULT_TRAINING_SETS.flatMap((trainingSet) => [
      trainingSet.id,
      ...getTrainingSetActivities(trainingSet).map((activity) => activity.id),
    ]);

    expect(DEFAULT_TRAINING_SETS).toHaveLength(11);
    expect(sections).toHaveLength(88);
    expect(childExercises).toHaveLength(155);
    expect(standaloneSections).toHaveLength(46);
    expect(activities).toHaveLength(257);
    expect(
      DEFAULT_TRAINING_SETS.reduce(
        (total, trainingSet) => total + getTrainingSetLeafExerciseCount(trainingSet),
        0,
      ),
    ).toBe(211);
    expect(ids).toHaveLength(268);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_TRAINING_SETS.map((trainingSet) => trainingSet.sourceId)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it('enables session notes only for the explicitly curated activities', () => {
    const eligibleIds = DEFAULT_TRAINING_SETS.flatMap(getTrainingSetActivities)
      .filter((activity) => activity.allowsSessionNotes === true)
      .map((activity) => activity.id);

    expect(eligibleIds).toEqual(SESSION_NOTE_ACTIVITY_IDS);
    expect(new Set(eligibleIds).size).toBe(SESSION_NOTE_ACTIVITY_IDS.length);
    for (const activityId of SESSION_NOTE_ACTIVITY_IDS) {
      const activity = DEFAULT_TRAINING_SETS.flatMap(getTrainingSetActivities).find(
        (candidate) => candidate.id === activityId,
      );
      expect(activity?.allowsSessionNotes).toBe(true);
      expect(activity === undefined ? false : Object.isFrozen(activity)).toBe(true);
    }
  });

  it('matches the final PDF name, hierarchy, and order projection for every in-scope session', () => {
    for (const [trainingSetId, expected] of Object.entries(IN_SCOPE_ACTIVITY_NAME_TREES)) {
      expect(
        requireTrainingSet(trainingSetId).activities.map(projectActivityNameTree),
        trainingSetId,
      ).toEqual(expected);
    }
  });

  it('keeps every in-scope session description exactly aligned with the final PDF', () => {
    for (const [trainingSetId, expected] of Object.entries(IN_SCOPE_DESCRIPTIONS)) {
      expect(requireTrainingSet(trainingSetId).description, trainingSetId).toBe(expected);
    }
  });

  it('matches independently calculated section, activity, and leaf counts per session', () => {
    for (const [trainingSetId, expected] of Object.entries(RESEARCHED_SESSION_COUNTS)) {
      const trainingSet = requireTrainingSet(trainingSetId);
      expect(
        {
          topLevel: trainingSet.activities.length,
          activities: getTrainingSetActivities(trainingSet).length,
          leaves: getTrainingSetLeafExerciseCount(trainingSet),
        },
        trainingSetId,
      ).toEqual(expected);
    }
  });

  it('adds and removes only the audited IDs while preserving corrected-name IDs', () => {
    expect(
      requireSection(
        'junior-high-school-version-2',
        'junior-high-school-version-2-kihon-waza-kihon-waza',
      ),
    ).toEqual({
      id: 'junior-high-school-version-2-kihon-waza-kihon-waza',
      name: 'Kihon-waza',
      children: [],
    });
    expect(
      getTrainingSetActivities(requireTrainingSet('senior-high-school-kendo-club')).some(
        (activity) =>
          activity.id ===
          'senior-high-school-kendo-club-core-strength-training-core-strength-training',
      ),
    ).toBe(false);
    expect(
      requireActivity(
        'police-dojo-asageiko-version-2',
        'police-dojo-asageiko-version-2-mawari-geiko-mawari-geiko',
      ),
    ).toEqual({
      id: 'police-dojo-asageiko-version-2-mawari-geiko-mawari-geiko',
      name: 'Mawarigeiko',
      editableQuantityUnits: ['minutes'],
      children: [],
    });
    expect(
      requireActivity('university-version-2', 'university-version-2-kakarigeijo-kakarigeijo'),
    ).toMatchObject({
      id: 'university-version-2-kakarigeijo-kakarigeijo',
      name: 'Kakarigeiko',
    });
  });

  it('maps the current authoritative drill names to their existing IDs and source IDs', () => {
    expect(DEFAULT_TRAINING_SETS.map(({ id, sourceId, name }) => ({ id, sourceId, name }))).toEqual(
      [
        {
          id: 'international-dojo-2-hour-session',
          sourceId: 1,
          name: 'International dojo menu',
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

  it('derives the exact built-in intensity categories from stable drill IDs', () => {
    expect(
      DEFAULT_TRAINING_SETS.filter(
        (trainingSet) => trainingSet.category === 'high-intensity-drill',
      ).map((trainingSet) => trainingSet.id),
    ).toEqual([
      'junior-high-kendo-club',
      'senior-high-school-kendo-club',
      'university-high-school',
      'top-university',
    ]);
    expect(
      DEFAULT_TRAINING_SETS.filter((trainingSet) => trainingSet.category === 'intense-drill').map(
        (trainingSet) => trainingSet.id,
      ),
    ).toEqual([
      'international-dojo-2-hour-session',
      'japanese-school-club',
      'official-znkr-ajkf',
      'police-dojo-asageiko',
      'police-dojo-asageiko-version-2',
      'junior-high-school-version-2',
      'university-version-2',
    ]);
    expect(
      DEFAULT_TRAINING_SETS.every((trainingSet) => validateTrainingSet(trainingSet).success),
    ).toBe(true);
  });

  it('keeps final-PDF display corrections separate from stable IDs', () => {
    expect(
      requireActivity('japanese-school-club', 'japanese-school-club-suburi-joge'),
    ).toMatchObject({
      id: 'japanese-school-club-suburi-joge',
      name: 'Joge',
    });
    expect(requireActivity('official-znkr-ajkf', 'official-znkr-ajkf-kihon-waza-do')).toMatchObject(
      {
        id: 'official-znkr-ajkf-kihon-waza-do',
        name: 'Do',
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
    expect(internationalSuburi.children).toEqual([]);
    expect(universitySuburi.quantities).toBeUndefined();
    expect(universitySuburi.children).toEqual([]);
    expect(japaneseSuburi.children.map((exercise) => exercise.quantities)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(seniorHighSuburi.children.every((exercise) => exercise.quantities === undefined)).toBe(
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

    expect(standalone.children).toEqual([]);
    expect(standalone.quantities).toEqual({ duration: { unit: 'minutes', value: 10 } });
    expect(ranged.quantities).toEqual({ duration: { unit: 'seconds', min: 30, max: 60 } });
    expect(
      getTrainingSetActivities(requireTrainingSet('international-dojo-2-hour-session')),
    ).toContain(standalone);
    expect(Object.isFrozen(DEFAULT_TRAINING_SETS)).toBe(true);
    for (const trainingSet of DEFAULT_TRAINING_SETS) {
      expect(Object.isFrozen(trainingSet)).toBe(true);
      expect(Object.isFrozen(trainingSet.activities)).toBe(true);
      for (const activity of getTrainingSetActivities(trainingSet)) {
        expect(Object.isFrozen(activity)).toBe(true);
        expect(Object.isFrozen(activity.children)).toBe(true);
        if (activity.quantities !== undefined) {
          expect(Object.isFrozen(activity.quantities)).toBe(true);
          if (activity.quantities.duration !== undefined) {
            expect(Object.isFrozen(activity.quantities.duration)).toBe(true);
          }
        }
        if (activity.editableQuantityUnits !== undefined) {
          expect(Object.isFrozen(activity.editableQuantityUnits)).toBe(true);
        }
      }
      for (const section of trainingSet.activities) {
        expect(Object.isFrozen(section)).toBe(true);
        expect(Object.isFrozen(section.children)).toBe(true);
        if (section.quantities !== undefined) {
          expect(Object.isFrozen(section.quantities)).toBe(true);
          if (section.quantities.duration !== undefined) {
            expect(Object.isFrozen(section.quantities.duration)).toBe(true);
          }
        }
        for (const exercise of section.children) {
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

    expect(uchikomi.children).toEqual([
      {
        id: 'international-dojo-2-hour-session-uchikomi-men-kote-kote-men-men',
        name: 'Men → Kote → Kote-men → Men',
        quantities: { repetitions: 5 },
        children: [],
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
      notes: '3 minutes rounds',
      quantities: { duration: { unit: 'minutes', value: 3 } },
    });
    expect(requireActivity('top-university', 'top-university-jigeiko-jigeiko')).toMatchObject({
      notes: '2 minutes per round',
      quantities: { duration: { unit: 'minutes', value: 2 } },
    });
  });

  it('keeps the eight Ken-tore station exercises timed under pure ordered containers', () => {
    const section = requireSection(
      'university-high-school',
      'university-high-school-ken-tore-circuit',
    );

    expect(section.notes).toBe('30 seconds per exercise in each station:');
    expect(section.quantities).toBeUndefined();
    expect(section.editableQuantityUnits).toBeUndefined();
    expect(section.allowsSessionNotes).toBeUndefined();

    const stationA = section.children[0];
    const stationB = section.children[1];
    expect(stationA?.id).toBe('university-high-school-ken-tore-circuit-station-a');
    expect(stationA?.name).toBe('Station A');
    expect(stationB?.id).toBe('university-high-school-ken-tore-circuit-station-b');
    expect(stationB?.name).toBe('Station B');
    expect(stationA?.quantities).toBeUndefined();
    expect(stationA?.editableQuantityUnits).toBeUndefined();
    expect(stationA?.allowsSessionNotes).toBeUndefined();
    expect(stationB?.quantities).toBeUndefined();
    expect(stationB?.editableQuantityUnits).toBeUndefined();
    expect(stationB?.allowsSessionNotes).toBeUndefined();
    expect(stationA?.children.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'university-high-school-ken-tore-circuit-kirikaeshi', name: 'Kirikaeshi' },
      { id: 'university-high-school-ken-tore-circuit-hayasuburi', name: 'Hayasuburi' },
      {
        id: 'university-high-school-ken-tore-circuit-stationary-kote-men',
        name: 'Stationary Kote-men',
      },
      {
        id: 'university-high-school-ken-tore-circuit-left-right-do-kirikaeshi',
        name: 'Left-right Dō-kirikaeshi',
      },
    ]);
    expect(stationB?.children.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'university-high-school-ken-tore-circuit-men', name: 'Men' },
      { id: 'university-high-school-ken-tore-circuit-kote', name: 'Kote' },
      { id: 'university-high-school-ken-tore-circuit-kote-men', name: 'Kote-men' },
      { id: 'university-high-school-ken-tore-circuit-do', name: 'Dō' },
    ]);
    expect(
      [...(stationA?.children ?? []), ...(stationB?.children ?? [])].map(
        (exercise) => exercise.quantities,
      ),
    ).toEqual(Array.from({ length: 8 }, () => ({ duration: { unit: 'seconds', value: 30 } })));
  });

  it('scopes the dojo-length instruction to its three source exercises', () => {
    const section = requireSection(
      'university-version-2',
      'university-version-2-dojo-length-drills',
    );

    expect(section.notes).toBe(
      'The following three Kirikaeshi exercises are performed over the length of the dojo:',
    );
    expect(section.children.map((exercise) => exercise.id)).toEqual([
      'university-version-2-dojo-length-drills-slow-kirikaeshi',
      'university-version-2-dojo-length-drills-kirikaeshi',
      'university-version-2-dojo-length-drills-kirikaeshi-suriashi',
    ]);
    expect(section.children.map((exercise) => exercise.quantities?.repetitions)).toEqual([2, 2, 2]);
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
      universityHighKirikaeshi.children.map(({ id, name, quantities }) => ({
        id,
        name,
        quantities,
      })),
    ).toEqual([
      {
        id: 'university-high-school-kirikaeshi-5-men-kirikaeshi',
        name: 'Men + kirikaeshi',
        quantities: { repetitions: 5 },
      },
      {
        id: 'university-high-school-kirikaeshi-5-tsuki-kirikaeshi',
        name: 'Tsuki + kirikaeshi',
        quantities: { repetitions: 5 },
      },
      {
        id: 'university-high-school-kirikaeshi-fast-kirikaeshi',
        name: 'Fast kirikaeshi',
        quantities: { repetitions: 1 },
      },
      {
        id: 'university-high-school-kirikaeshi-one-breath-kirikaeshi',
        name: 'One-breath kirikaeshi',
        quantities: { repetitions: 1 },
      },
      {
        id: 'university-high-school-kirikaeshi-ai-kirikaeshi',
        name: 'Ai kirikaeshi',
        quantities: { repetitions: 1 },
      },
    ]);

    expect(
      requireActivity('top-university', 'top-university-yakusoku-geiko-hiki-do-men-kirikaeshi'),
    ).toEqual({
      id: 'top-university-yakusoku-geiko-hiki-do-men-kirikaeshi',
      name: 'Hiki-dō → Men → 100 Kirikaeshi strikes',
      quantities: { repetitions: 1 },
      children: [],
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
    expect(kubun.children.map((exercise) => exercise.notes)).toEqual([
      '1st person',
      '2nd person',
      '3rd person',
    ]);
    expect(kubun.children.map((exercise) => exercise.quantities)).toEqual(
      Array.from({ length: 3 }, () => ({
        duration: { unit: 'seconds', min: 30, max: 60 },
      })),
    );
  });

  it('keeps the two Free version methods as stable-ID options', () => {
    const sandan = requireSection('top-university', 'top-university-sandan-geiko');
    const freeVersion = sandan.children[2];

    expect(freeVersion).toMatchObject({
      id: 'top-university-fee-version',
      name: 'Free version',
      notes: 'These two methods are options, not sequential mandatory exercises.',
    });
    expect(freeVersion?.children.map(({ id, name }) => ({ id, name }))).toEqual([
      {
        id: 'top-university-fee-version-uchikomi-geiko',
        name: 'Uchikomi',
      },
      {
        id: 'top-university-fee-version-kakari-geiko',
        name: 'Kakarigeiko',
      },
    ]);
    expect(freeVersion?.children.map((activity) => activity.notes)).toEqual([
      'A method of keiko in which one learns basic striking techniques by responding to striking opportunities provided by the motodachi (instructor). Motodachi-focused.',
      'A method in which the trainee, for a short time, strikes the motodachi with full energy using all techniques learned, without hesitation or concern about being struck. Kakarite-focused.',
    ]);
    expect(freeVersion?.children.map((activity) => activity.editableQuantityUnits)).toEqual([
      ['seconds'],
      ['seconds'],
    ]);
    expect(freeVersion?.children.map((activity) => activity.quantities)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('keeps the final Kakarigeiko editable in seconds without a prescribed default', () => {
    const kakarigeiko = requireActivity('top-university', 'top-university-kakarigeiko-kakarigeiko');

    expect(kakarigeiko).toMatchObject({
      id: 'top-university-kakarigeiko-kakarigeiko',
      name: 'Kakarigeiko',
      editableQuantityUnits: ['seconds'],
    });
    expect(kakarigeiko.quantities).toBeUndefined();
  });

  it('preserves the Sandan-geiko order and the legacy Free version ID', () => {
    const sandan = requireSection('top-university', 'top-university-sandan-geiko');

    expect(sandan.children.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'top-university-sandan-geiko-kirikaeshi', name: 'Kirikaeshi' },
      { id: 'top-university-yakusoku-geiko', name: 'Yakusoku-geiko' },
      { id: 'top-university-fee-version', name: 'Free version' },
    ]);
    expect(sandan.notes).toBe('Three motodachi. Kakarite cycle through each of them with no rest.');
  });

  it('retains the canonical Free version notes', () => {
    const feeVersion = requireActivity('top-university', 'top-university-fee-version');

    expect(feeVersion.notes).toBe(
      'These two methods are options, not sequential mandatory exercises.',
    );
    expect(feeVersion.children.map(({ id }) => id)).toEqual([
      'top-university-fee-version-uchikomi-geiko',
      'top-university-fee-version-kakari-geiko',
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
  it('covers default and recursive source fixtures through the domain validator', () => {
    /*
     * This workspace does not declare a Draft-07 validator. Ajv is only present transitively
     * in tooling, so importing it here would make the test depend on an undeclared package.
     * Keep executable fixture coverage in the domain validator and assert the schema recursion
     * contract below until a first-party validator is declared.
     */
    expect(validateCuratedDrills(defaultDrillsSource).success).toBe(true);
    expect(validateCuratedDrills(RECURSIVE_SCHEMA_VALID_FIXTURE).success).toBe(true);
    for (const fixture of RECURSIVE_SCHEMA_INVALID_FIXTURES) {
      expect(validateCuratedDrills(fixture).success).toBe(false);
    }
  });

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
        activity: {
          required: ['id', 'name'],
          additionalProperties: false,
        },
        section: {
          allOf: [{ $ref: '#/definitions/activity' }, { type: 'object', required: ['exercises'] }],
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
    expect(kendoDrillsSchema.definitions.activity.properties.quantities).toEqual({
      $ref: '#/definitions/quantities',
    });
    expect(kendoDrillsSchema.definitions.activity.required).not.toContain('quantities');
    expect(kendoDrillsSchema.definitions.activity.properties.notes).toEqual({ type: 'string' });
    expect(kendoDrillsSchema.definitions.activity.properties.exercises).toEqual({
      type: 'array',
      items: { $ref: '#/definitions/activity' },
    });
    expect(kendoDrillsSchema.definitions.activity.properties.editableQuantityUnits).toEqual({
      $ref: '#/definitions/editableQuantityUnits',
    });
    expect(kendoDrillsSchema.definitions.activity.properties.allowsSessionNotes).toEqual({
      const: true,
    });
    expect(kendoDrillsSchema.definitions.editableQuantityUnits).toMatchObject({
      minItems: 1,
      uniqueItems: true,
    });
  });
});
