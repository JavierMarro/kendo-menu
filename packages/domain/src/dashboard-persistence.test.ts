import { describe, expect, it } from 'vitest';

import { DEFAULT_TRAINING_SETS } from './default-training-sets';
import { asTrainingSetId, TRAINING_DATA_LIMITS, type TrainingSet } from './types';
import {
  encodeDashboardPersistenceV10,
  isDashboardCatalogueCompatible,
  parseDashboardPersistenceV10,
  type PersistedDashboardEntryV10,
  type PersistedTrainingWireStateV10,
} from './dashboard-persistence';

function catalogueSet(activities: TrainingSet['activities'], id = 'catalogue-set'): TrainingSet {
  return {
    id: asTrainingSetId(id),
    name: 'Catalogue set',
    category: 'custom',
    activities,
    isBuiltIn: true,
  };
}

const noteActivity = {
  id: 'note-activity',
  name: 'Note activity',
  editableQuantityUnits: ['seconds'] as const,
  allowsSessionNotes: true as const,
  children: [],
};

const catalogue = [
  {
    ...catalogueSet([noteActivity]),
    category: 'kihon' as const,
  },
] satisfies readonly TrainingSet[];

function builtInEntry(
  overrides: Partial<
    Pick<
      PersistedDashboardEntryV10,
      'id' | 'trainingSetId' | 'quantityOverrides' | 'activityNotes' | 'notes' | 'createdAt'
    >
  > = {},
): PersistedTrainingWireStateV10 {
  return {
    dashboardEntries: [
      {
        id: 'entry-1',
        trainingSetId: asTrainingSetId('catalogue-set'),
        quantityOverrides: { 'note-activity': { seconds: 0 } },
        activityNotes: { 'note-activity': '  keep spacing  ' },
        notes: '',
        createdAt: '2026-09-12T08:00:00.000Z',
        ...overrides,
      },
    ],
  };
}

function customState(
  trainingSet: unknown,
  trainingSetId = 'custom-set',
  overrides: Readonly<Record<string, unknown>> = {},
): unknown {
  return {
    dashboardEntries: [
      {
        id: 'entry-custom',
        trainingSetId: asTrainingSetId(trainingSetId),
        trainingSet,
        quantityOverrides: {},
        activityNotes: {},
        notes: '',
        createdAt: '2026-09-12T08:00:00.000Z',
        ...overrides,
      },
    ],
  };
}

const customSnapshot = {
  id: 'custom-set',
  name: 'Custom set',
  description: '',
  category: 'custom' as const,
  sections: [
    {
      id: 'custom-section',
      name: 'Section',
      notes: '  section  ',
      exercises: [
        {
          id: 'custom-exercise',
          name: 'Exercise',
          quantities: { repetitions: 0 },
          notes: '',
        },
      ],
    },
  ],
  isBuiltIn: false as const,
};

describe('strict dashboard persistence codec', () => {
  it('clones and preserves wire values, optional fields, zero, order, and prototype keys', () => {
    const state = builtInEntry({
      quantityOverrides: Object.fromEntries([
        ['__proto__', { repetitions: 0 }],
        ['note-activity', { seconds: 0 }],
      ]),
      activityNotes: Object.fromEntries([
        ['__proto__', '  prototype note  '],
        ['note-activity', '  keep spacing  '],
      ]),
    });
    const parsed = parseDashboardPersistenceV10(state);
    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }
    expect(Object.keys(parsed.dashboardEntries[0]?.quantityOverrides ?? {})).toEqual([
      '__proto__',
      'note-activity',
    ]);
    expect(Object.hasOwn(parsed.dashboardEntries[0]?.quantityOverrides ?? {}, '__proto__')).toBe(
      true,
    );
    expect(parsed.dashboardEntries[0]?.quantityOverrides['__proto__']).toEqual({ repetitions: 0 });
    expect(parsed.dashboardEntries[0]?.activityNotes['__proto__']).toBe('  prototype note  ');
    expect(parsed.dashboardEntries[0]?.activityNotes['note-activity']).toBe('  keep spacing  ');
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.dashboardEntries)).toBe(true);
    expect(Object.isFrozen(parsed.dashboardEntries[0]?.activityNotes)).toBe(true);
  });

  it('does not apply current catalogue semantics during structural parsing', () => {
    const state = builtInEntry({
      trainingSetId: asTrainingSetId('old-catalogue-set'),
      activityNotes: { 'unknown-activity': 'meaningful' },
    });
    expect(parseDashboardPersistenceV10(state)).not.toBeNull();
    expect(isDashboardCatalogueCompatible(state, catalogue)).toBe(false);
  });

  it('rejects unknown properties, mismatched snapshots, duplicate ids, and deeper custom trees', () => {
    expect(
      parseDashboardPersistenceV10({
        ...builtInEntry(),
        unexpected: true,
      }),
    ).toBeNull();
    expect(
      parseDashboardPersistenceV10({
        dashboardEntries: [
          {
            ...builtInEntry().dashboardEntries[0],
            trainingSet: { ...customSnapshot, id: 'other-set' },
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseDashboardPersistenceV10({
        dashboardEntries: [
          builtInEntry().dashboardEntries[0],
          { ...builtInEntry().dashboardEntries[0], id: 'entry-1' },
        ],
      }),
    ).toBeNull();
    expect(
      parseDashboardPersistenceV10({
        dashboardEntries: [
          {
            ...builtInEntry().dashboardEntries[0],
            trainingSetId: asTrainingSetId('custom-set'),
            trainingSet: {
              ...customSnapshot,
              sections: [
                {
                  ...customSnapshot.sections[0],
                  exercises: [
                    {
                      ...customSnapshot.sections[0]?.exercises[0],
                      children: [],
                    },
                  ],
                },
              ],
            },
          },
        ],
      }),
    ).toBeNull();
  });

  it('rejects custom references that the two-level wire snapshot cannot preserve', () => {
    expect(
      parseDashboardPersistenceV10(
        customState(customSnapshot, 'custom-set', {
          quantityOverrides: { 'missing-activity': { repetitions: 0 } },
        }),
      ),
    ).toBeNull();
    expect(
      parseDashboardPersistenceV10(
        customState(customSnapshot, 'custom-set', {
          activityNotes: { 'custom-exercise': 'a session note' },
        }),
      ),
    ).toBeNull();
    expect(
      parseDashboardPersistenceV10(
        customState(customSnapshot, 'custom-set', {
          activityNotes: { 'missing-activity': '' },
        }),
      ),
    ).toBeNull();
  });

  it('checks built-in references, custom collisions, activity references, and lossy notes', () => {
    expect(isDashboardCatalogueCompatible(builtInEntry(), catalogue)).toBe(true);
    expect(
      isDashboardCatalogueCompatible(
        builtInEntry({ activityNotes: { 'note-activity': '   ' } }),
        catalogue,
      ),
    ).toBe(false);
    expect(
      isDashboardCatalogueCompatible(
        builtInEntry({ quantityOverrides: { missing: { repetitions: 0 } } }),
        catalogue,
      ),
    ).toBe(false);
    expect(
      isDashboardCatalogueCompatible(
        {
          dashboardEntries: [
            {
              ...builtInEntry().dashboardEntries[0],
              trainingSetId: asTrainingSetId('catalogue-set'),
              trainingSet: { ...customSnapshot, id: 'catalogue-set' },
              activityNotes: {},
              quantityOverrides: {},
            },
          ],
        },
        catalogue,
      ),
    ).toBe(false);
  });

  it('encodes a runtime custom snapshot without dropping content and rejects unsupported metadata', () => {
    const runtimeState = {
      dashboardEntries: [
        {
          id: 'entry-custom',
          trainingSetId: asTrainingSetId('custom-set'),
          trainingSet: {
            id: asTrainingSetId('custom-set'),
            name: 'Custom set',
            description: '',
            category: 'custom' as const,
            activities: [
              {
                id: 'custom-section',
                name: 'Section',
                notes: '  section  ',
                children: [
                  {
                    id: 'custom-exercise',
                    name: 'Exercise',
                    quantities: { repetitions: 0 },
                    notes: '',
                    children: [],
                  },
                ],
              },
            ],
            isBuiltIn: false as const,
          },
          quantityOverrides: { 'custom-exercise': { repetitions: 0 } },
          activityNotes: {},
          notes: '',
          createdAt: '2026-09-12T08:00:00.000Z',
        },
      ],
    };
    const encoded = encodeDashboardPersistenceV10(runtimeState);
    expect(encoded.dashboardEntries[0]?.trainingSet).toEqual(customSnapshot);
    expect(parseDashboardPersistenceV10(encoded)).toEqual(encoded);
    expect(isDashboardCatalogueCompatible(encoded, catalogue)).toBe(true);

    const runtimeEntry = runtimeState.dashboardEntries[0];
    if (runtimeEntry === undefined || runtimeEntry.trainingSet === undefined) {
      throw new Error('Expected the runtime custom entry fixture.');
    }
    const runtimeTrainingSet = runtimeEntry.trainingSet;
    expect(() =>
      encodeDashboardPersistenceV10({
        dashboardEntries: [
          {
            ...runtimeEntry,
            trainingSet: {
              ...runtimeTrainingSet,
              activities: [
                {
                  ...runtimeTrainingSet.activities[0],
                  editableQuantityUnits: ['repetitions'] as const,
                },
              ],
            },
          },
        ],
      }),
    ).toThrow();
  });

  it('does not silently reduce altered explicit built-in snapshots to references', () => {
    const canonicalTrainingSet = DEFAULT_TRAINING_SETS[0];
    if (canonicalTrainingSet === undefined) {
      throw new Error('Expected the default catalogue fixture.');
    }
    const runtimeEntry = {
      id: 'entry-built-in',
      trainingSetId: canonicalTrainingSet.id,
      trainingSet: canonicalTrainingSet,
      quantityOverrides: {},
      activityNotes: {},
      notes: '',
      createdAt: '2026-09-12T08:00:00.000Z',
    };
    const encoded = encodeDashboardPersistenceV10({ dashboardEntries: [runtimeEntry] });
    expect(encoded.dashboardEntries[0]?.trainingSet).toBeUndefined();
    expect(() =>
      encodeDashboardPersistenceV10({
        dashboardEntries: [
          {
            ...runtimeEntry,
            trainingSet: {
              ...canonicalTrainingSet,
              name: `${canonicalTrainingSet.name} altered`,
            },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      encodeDashboardPersistenceV10({
        dashboardEntries: [
          {
            ...runtimeEntry,
            trainingSet: {
              ...canonicalTrainingSet,
              unexpected: true,
            },
          },
        ],
      }),
    ).toThrow();
  });

  it('enforces the existing domain collection and record limits', () => {
    const entries = Array.from(
      { length: TRAINING_DATA_LIMITS.dashboardEntries + 1 },
      (_, index) => ({
        ...builtInEntry().dashboardEntries[0],
        id: `entry-${index}`,
      }),
    );
    expect(parseDashboardPersistenceV10({ dashboardEntries: entries })).toBeNull();

    const tooManyActivities = {
      ...customSnapshot,
      sections: Array.from({ length: TRAINING_DATA_LIMITS.customSections + 1 }, (_, index) => ({
        id: `section-${index}`,
        name: 'Section',
        exercises: [],
      })),
    };
    expect(
      parseDashboardPersistenceV10({
        dashboardEntries: [
          {
            ...builtInEntry().dashboardEntries[0],
            trainingSetId: asTrainingSetId('custom-set'),
            trainingSet: tooManyActivities,
            quantityOverrides: {},
            activityNotes: {},
          },
        ],
      }),
    ).toBeNull();
  });

  it('accepts scalar and collection values at each cloud codec boundary', () => {
    const exactIdentifier = 'i'.repeat(TRAINING_DATA_LIMITS.identifierCharacters);
    const exactSectionIdentifier = 's'.repeat(TRAINING_DATA_LIMITS.identifierCharacters);
    const exactExerciseIdentifier = 'e'.repeat(TRAINING_DATA_LIMITS.identifierCharacters);
    const exactIdentifierSnapshot = {
      ...customSnapshot,
      id: exactIdentifier,
      name: 'n'.repeat(TRAINING_DATA_LIMITS.nameCharacters),
      description: 'd'.repeat(TRAINING_DATA_LIMITS.descriptionCharacters),
      sections: [
        {
          ...customSnapshot.sections[0],
          id: exactSectionIdentifier,
          name: 's'.repeat(TRAINING_DATA_LIMITS.nameCharacters),
          notes: 'q'.repeat(TRAINING_DATA_LIMITS.noteCharacters),
          exercises: [
            {
              ...customSnapshot.sections[0]?.exercises[0],
              id: exactExerciseIdentifier,
              name: 'e'.repeat(TRAINING_DATA_LIMITS.nameCharacters),
              notes: 'r'.repeat(TRAINING_DATA_LIMITS.noteCharacters),
            },
          ],
        },
      ],
    };
    expect(
      parseDashboardPersistenceV10(customState(exactIdentifierSnapshot, exactIdentifier)),
    ).not.toBeNull();
    expect(
      parseDashboardPersistenceV10(
        customState(
          {
            ...exactIdentifierSnapshot,
            sections: [
              {
                ...exactIdentifierSnapshot.sections[0],
                id: `${exactSectionIdentifier}x`,
              },
            ],
          },
          exactIdentifier,
        ),
      ),
    ).toBeNull();
    expect(
      parseDashboardPersistenceV10(
        customState(
          {
            ...exactIdentifierSnapshot,
            sections: [
              {
                ...exactIdentifierSnapshot.sections[0],
                exercises: [
                  {
                    ...exactIdentifierSnapshot.sections[0]?.exercises[0],
                    id: `${exactExerciseIdentifier}x`,
                  },
                ],
              },
            ],
          },
          exactIdentifier,
        ),
      ),
    ).toBeNull();

    const overIdentifier = `${exactIdentifier}x`;
    expect(
      parseDashboardPersistenceV10(
        customState({ ...exactIdentifierSnapshot, id: overIdentifier }, overIdentifier),
      ),
    ).toBeNull();
    expect(
      parseDashboardPersistenceV10({
        dashboardEntries: [
          {
            ...builtInEntry().dashboardEntries[0],
            id: overIdentifier,
          },
        ],
      }),
    ).toBeNull();

    const exactNamedSnapshot = {
      ...customSnapshot,
      name: 'n'.repeat(TRAINING_DATA_LIMITS.nameCharacters),
      description: 'd'.repeat(TRAINING_DATA_LIMITS.descriptionCharacters),
      sections: [
        {
          ...customSnapshot.sections[0],
          name: 's'.repeat(TRAINING_DATA_LIMITS.nameCharacters),
          notes: 'q'.repeat(TRAINING_DATA_LIMITS.noteCharacters),
          exercises: [
            {
              ...customSnapshot.sections[0]?.exercises[0],
              name: 'e'.repeat(TRAINING_DATA_LIMITS.nameCharacters),
              notes: 'r'.repeat(TRAINING_DATA_LIMITS.noteCharacters),
            },
          ],
        },
      ],
    };
    expect(parseDashboardPersistenceV10(customState(exactNamedSnapshot))).not.toBeNull();
    expect(
      parseDashboardPersistenceV10(
        customState({
          ...exactNamedSnapshot,
          name: `${exactNamedSnapshot.name}x`,
        }),
      ),
    ).toBeNull();
    expect(
      parseDashboardPersistenceV10(
        customState({
          ...exactNamedSnapshot,
          description: `${exactNamedSnapshot.description}x`,
        }),
      ),
    ).toBeNull();
    expect(
      parseDashboardPersistenceV10(
        customState({
          ...exactNamedSnapshot,
          sections: [
            {
              ...exactNamedSnapshot.sections[0],
              name: `${exactNamedSnapshot.sections[0]?.name}x`,
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parseDashboardPersistenceV10(
        customState({
          ...exactNamedSnapshot,
          sections: [
            {
              ...exactNamedSnapshot.sections[0],
              exercises: [
                {
                  ...exactNamedSnapshot.sections[0]?.exercises[0],
                  name: `${exactNamedSnapshot.sections[0]?.exercises[0]?.name}x`,
                },
              ],
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parseDashboardPersistenceV10(
        customState(exactNamedSnapshot, 'custom-set', {
          notes: 'n'.repeat(TRAINING_DATA_LIMITS.noteCharacters),
          createdAt: 't'.repeat(TRAINING_DATA_LIMITS.timestampCharacters),
        }),
      ),
    ).not.toBeNull();
    expect(
      parseDashboardPersistenceV10(
        customState(exactNamedSnapshot, 'custom-set', {
          notes: `${'n'.repeat(TRAINING_DATA_LIMITS.noteCharacters)}x`,
        }),
      ),
    ).toBeNull();
    expect(
      parseDashboardPersistenceV10(
        customState(exactNamedSnapshot, 'custom-set', {
          createdAt: `${'t'.repeat(TRAINING_DATA_LIMITS.timestampCharacters)}x`,
        }),
      ),
    ).toBeNull();

    const exactEntries = Array.from(
      { length: TRAINING_DATA_LIMITS.dashboardEntries },
      (_, index) => ({
        ...builtInEntry().dashboardEntries[0],
        id: `entry-${index}`,
      }),
    );
    expect(parseDashboardPersistenceV10({ dashboardEntries: exactEntries })).not.toBeNull();

    const exactQuantityOverrides = Object.fromEntries(
      Array.from({ length: TRAINING_DATA_LIMITS.dashboardRecordEntries }, (_, index) => [
        `activity-${index}`,
        { repetitions: 0 },
      ]),
    );
    expect(
      parseDashboardPersistenceV10(builtInEntry({ quantityOverrides: exactQuantityOverrides })),
    ).not.toBeNull();
    expect(
      parseDashboardPersistenceV10(
        builtInEntry({
          quantityOverrides: {
            ...exactQuantityOverrides,
            [`activity-${TRAINING_DATA_LIMITS.dashboardRecordEntries}`]: { repetitions: 0 },
          },
        }),
      ),
    ).toBeNull();

    const exactActivityNotes = Object.fromEntries(
      Array.from({ length: TRAINING_DATA_LIMITS.dashboardRecordEntries }, (_, index) => [
        `activity-${index}`,
        '',
      ]),
    );
    expect(
      parseDashboardPersistenceV10(builtInEntry({ activityNotes: exactActivityNotes })),
    ).not.toBeNull();
    expect(
      parseDashboardPersistenceV10(
        builtInEntry({
          activityNotes: {
            ...exactActivityNotes,
            [`activity-${TRAINING_DATA_LIMITS.dashboardRecordEntries}`]: '',
          },
        }),
      ),
    ).toBeNull();
  });

  it('enforces custom section, exercise, total-activity, and unit limits', () => {
    const exactSections = Array.from(
      { length: TRAINING_DATA_LIMITS.customSections },
      (_, index) => ({
        id: `section-${index}`,
        name: 'Section',
        exercises: [],
      }),
    );
    expect(
      parseDashboardPersistenceV10(customState({ ...customSnapshot, sections: exactSections })),
    ).not.toBeNull();

    const exactExercises = Array.from(
      { length: TRAINING_DATA_LIMITS.exercisesPerSection },
      (_, index) => ({
        id: `exercise-${index}`,
        name: 'Exercise',
      }),
    );
    expect(
      parseDashboardPersistenceV10(
        customState({
          ...customSnapshot,
          sections: [{ id: 'section-limit', name: 'Section', exercises: exactExercises }],
        }),
      ),
    ).not.toBeNull();
    expect(
      parseDashboardPersistenceV10(
        customState({
          ...customSnapshot,
          sections: [
            {
              id: 'section-limit',
              name: 'Section',
              exercises: [...exactExercises, { id: 'exercise-over', name: 'Exercise' }],
            },
          ],
        }),
      ),
    ).toBeNull();

    const exactTotalActivities = Array.from(
      { length: TRAINING_DATA_LIMITS.customSections },
      (_, sectionIndex) => ({
        id: `total-section-${sectionIndex}`,
        name: 'Section',
        exercises: Array.from({ length: 7 }, (_, exerciseIndex) => ({
          id: `total-exercise-${sectionIndex}-${exerciseIndex}`,
          name: 'Exercise',
        })),
      }),
    );
    expect(
      parseDashboardPersistenceV10(
        customState({ ...customSnapshot, sections: exactTotalActivities }),
      ),
    ).not.toBeNull();
    const overTotalActivities = exactTotalActivities.map((section) => ({
      ...section,
      exercises: [...section.exercises, { id: `${section.id}-exercise-over`, name: 'Exercise' }],
    }));
    expect(
      parseDashboardPersistenceV10(
        customState({ ...customSnapshot, sections: overTotalActivities }),
      ),
    ).toBeNull();

    expect(
      parseDashboardPersistenceV10(
        customState({
          ...customSnapshot,
          sections: [
            {
              ...customSnapshot.sections[0],
              exercises: [
                {
                  ...customSnapshot.sections[0]?.exercises[0],
                  quantities: { duration: { unit: 'hours', value: 1 } },
                },
              ],
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parseDashboardPersistenceV10(
        customState(customSnapshot, 'custom-set', {
          quantityOverrides: { 'custom-exercise': { hours: 0 } },
        }),
      ),
    ).toBeNull();
  });
});
