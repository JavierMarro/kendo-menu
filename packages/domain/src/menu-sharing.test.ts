import { describe, expect, it } from 'vitest';

import { asTrainingSetId, type DashboardEntry, type TrainingSet } from './types.js';
import {
  createSharedMenuV1,
  parseSharedMenuV1,
  sharedMenuV1ToTrainingSetInput,
} from './menu-sharing.js';

function makeEntry(overrides: Partial<DashboardEntry> = {}): DashboardEntry {
  const trainingSet: TrainingSet = {
    id: asTrainingSetId('custom-menu'),
    name: 'Keiko menu',
    description: 'Private description',
    category: 'custom',
    customIntensity: 'high-intensity-drill',
    isBuiltIn: false,
    activities: [
      {
        id: 'section',
        name: 'Suburi',
        notes: 'Private section note',
        quantities: { sets: 3, duration: { unit: 'minutes', min: 5, max: 10 } },
        allowsSessionNotes: true,
        children: [
          {
            id: 'exercise',
            name: 'Men uchi',
            notes: 'Private exercise note',
            quantities: { repetitions: 100, duration: { unit: 'seconds', min: 20, max: 30 } },
            editableQuantityUnits: ['repetitions', 'seconds'],
            allowsSessionNotes: true,
            children: [],
          },
        ],
      },
    ],
  };
  return {
    id: 'dashboard-entry',
    trainingSetId: trainingSet.id,
    trainingSet,
    quantityOverrides: {
      section: { sets: 0, minutes: 0 },
      exercise: { repetitions: 0, seconds: 25 },
    },
    activityNotes: { exercise: 'Private activity note' },
    notes: 'Private menu note',
    createdAt: '2026-11-08T12:00:00.000Z',
    ...overrides,
  };
}

describe('custom menu sharing payload', () => {
  it('projects effective quantities and excludes IDs, descriptions and notes', () => {
    const payload = createSharedMenuV1(makeEntry());
    expect(payload).toEqual({
      version: 1,
      name: 'Keiko menu',
      customIntensity: 'high-intensity-drill',
      sections: [
        {
          name: 'Suburi',
          quantities: { sets: 0, duration: { unit: 'minutes', value: 0 } },
          exercises: [
            {
              name: 'Men uchi',
              quantities: {
                repetitions: 0,
                duration: { unit: 'seconds', value: 25 },
              },
            },
          ],
        },
      ],
    });
    const text = JSON.stringify(payload);
    for (const privateValue of [
      'custom-menu',
      'dashboard-entry',
      'Private description',
      'Private section note',
      'Private exercise note',
      'Private activity note',
      'Private menu note',
    ]) {
      expect(text).not.toContain(privateValue);
    }
  });

  it('preserves base ranges when there is no override', () => {
    const payload = createSharedMenuV1(
      makeEntry({ quantityOverrides: {}, activityNotes: {}, notes: '' }),
    );
    expect(payload.sections[0]?.quantities?.duration).toEqual({
      unit: 'minutes',
      min: 5,
      max: 10,
    });
    expect(payload.sections[0]?.exercises[0]?.quantities?.duration).toEqual({
      unit: 'seconds',
      min: 20,
      max: 30,
    });
  });

  it('rejects invalid, unknown-field and unsupported payloads', () => {
    const valid = createSharedMenuV1(makeEntry());
    expect(parseSharedMenuV1({ ...valid, description: 'not shareable' })).toBeNull();
    expect(
      parseSharedMenuV1({
        ...valid,
        sections: [{ ...valid.sections[0], notes: 'not shareable' }],
      }),
    ).toBeNull();
    expect(
      parseSharedMenuV1({
        ...valid,
        sections: [
          {
            ...valid.sections[0],
            exercises: [{ ...valid.sections[0]?.exercises[0], id: 'foreign-id' }],
          },
        ],
      }),
    ).toBeNull();
    expect(parseSharedMenuV1({ ...valid, version: 2 })).toBeNull();
    expect(parseSharedMenuV1({ ...valid, sections: [{ name: '', exercises: [] }] })).toBeNull();
  });

  it('rejects built-in, recursively nested and lossy duration snapshots', () => {
    const entry = makeEntry();
    const source = entry.trainingSet;
    if (source === undefined) throw new Error('Test fixture is missing a menu.');
    const section = source.activities[0];
    if (section === undefined) throw new Error('Test fixture is missing a section.');
    expect(() =>
      createSharedMenuV1({
        ...entry,
        trainingSet: { ...source, isBuiltIn: true },
      }),
    ).toThrow('Only a valid custom dashboard menu can be shared.');

    expect(() =>
      createSharedMenuV1({
        ...entry,
        trainingSet: {
          ...source,
          activities: [
            {
              ...section,
              children: [
                {
                  id: 'child',
                  name: 'Nested',
                  children: [{ id: 'leaf', name: 'Leaf', children: [] }],
                },
              ],
            },
          ],
        },
      }),
    ).toThrow('This custom menu structure cannot be shared.');

    expect(
      createSharedMenuV1({
        ...entry,
        quantityOverrides: { exercise: { seconds: 10, minutes: 20 } },
      }).sections[0]?.exercises[0],
    ).toMatchObject({
      quantities: { duration: { unit: 'seconds', value: 10 } },
      additionalDuration: { unit: 'minutes', value: 20 },
    });
  });

  it('canonicalizes equivalent fixed duration pairs across stored representations', () => {
    const entry = makeEntry();
    const source = entry.trainingSet;
    const section = source?.activities[0];
    if (source === undefined || section === undefined) throw new Error('Missing fixture');
    const project = (
      duration: { unit: 'seconds' | 'minutes'; value: number },
      overrides: DashboardEntry['quantityOverrides'],
    ) =>
      createSharedMenuV1({
        ...entry,
        trainingSet: { ...source, activities: [{ ...section, quantities: { duration } }] },
        quantityOverrides: overrides,
      });
    expect(project({ unit: 'minutes', value: 2 }, { section: { seconds: 30 } })).toEqual(
      project({ unit: 'seconds', value: 30 }, { section: { minutes: 2 } }),
    );
    expect(
      project({ unit: 'minutes', value: 9 }, { section: { seconds: 30, minutes: 2 } }),
    ).toEqual(project({ unit: 'seconds', value: 30 }, { section: { minutes: 2 } }));
  });

  it('converts valid share content into the existing custom-menu input shape', () => {
    const share = createSharedMenuV1(makeEntry());
    expect(sharedMenuV1ToTrainingSetInput(share)).toEqual({
      name: 'Keiko menu',
      customIntensity: 'high-intensity-drill',
      category: 'custom',
      sections: [
        {
          name: 'Suburi',
          quantities: { sets: 0, duration: { unit: 'minutes', value: 0 } },
          exercises: [
            {
              name: 'Men uchi',
              quantities: {
                repetitions: 0,
                duration: { unit: 'seconds', value: 25 },
              },
            },
          ],
        },
      ],
    });
    expect(sharedMenuV1ToTrainingSetInput({ ...share, unexpected: true })).toBeNull();
  });
});
