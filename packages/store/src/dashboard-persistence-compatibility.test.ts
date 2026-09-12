import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAINING_SETS,
  asTrainingSetId,
  getTrainingSetActivities,
  type DashboardEntry,
  type TrainingSet,
} from '@kendo-menu/domain';
import {
  encodeDashboardPersistenceV10,
  isDashboardCatalogueCompatible,
  parseDashboardPersistenceV10,
} from '@kendo-menu/domain/dashboard-persistence';

import { encodePersistedTrainingStateV10, parsePersistedTrainingStateV10 } from './index';

function findSessionNoteActivity(): {
  readonly trainingSet: TrainingSet;
  readonly activityId: string;
} {
  for (const trainingSet of DEFAULT_TRAINING_SETS) {
    const activity = getTrainingSetActivities(trainingSet).find(
      (candidate) => candidate.allowsSessionNotes === true,
    );
    if (activity !== undefined) {
      return { trainingSet, activityId: activity.id };
    }
  }
  throw new Error('The default catalogue must contain a session-note activity.');
}

function createCustomTrainingSet(): TrainingSet {
  return {
    id: asTrainingSetId('compatibility-custom-set'),
    name: 'Custom set \ud800',
    description: '\udc00',
    category: 'custom',
    customIntensity: 'intense-drill',
    activities: [
      {
        id: 'compatibility-section',
        name: 'Section',
        quantities: { duration: { unit: 'minutes', value: 0 } },
        notes: '  section \ud800  ',
        children: [
          {
            id: '__proto__',
            name: 'Exercise \udc00',
            quantities: { repetitions: 0 },
            notes: '\ud800',
            children: [],
          },
        ],
      },
    ],
    isBuiltIn: false,
  };
}

describe('domain v10 codec and local store compatibility', () => {
  it('round-trips built-in and custom entries through both codecs without loss', () => {
    const { trainingSet: builtInTrainingSet, activityId: noteActivityId } =
      findSessionNoteActivity();
    const customTrainingSet = createCustomTrainingSet();
    const customQuantityOverrides = Object.fromEntries([['__proto__', { repetitions: 0 }]]);
    const runtimeState = {
      dashboardEntries: [
        {
          id: 'compatibility-built-in-entry',
          trainingSetId: builtInTrainingSet.id,
          trainingSet: builtInTrainingSet,
          quantityOverrides: { [noteActivityId]: { seconds: 0 } },
          activityNotes: { [noteActivityId]: '  built-in note \ud800  ' },
          notes: '  dashboard note  ',
          createdAt: '2026-09-12T08:00:00.000Z',
        },
        {
          id: 'compatibility-custom-entry',
          trainingSetId: customTrainingSet.id,
          trainingSet: customTrainingSet,
          quantityOverrides: customQuantityOverrides,
          activityNotes: {},
          notes: 'Custom dashboard note \udc00',
          createdAt: '2026-09-12T08:01:00.000Z',
        },
      ],
    } satisfies { readonly dashboardEntries: readonly DashboardEntry[] };

    const localWire = encodePersistedTrainingStateV10(runtimeState);
    const cloudWire = encodeDashboardPersistenceV10(runtimeState);
    expect(cloudWire).toEqual(localWire);
    expect(parseDashboardPersistenceV10(localWire)).toEqual(cloudWire);
    expect(isDashboardCatalogueCompatible(cloudWire)).toBe(true);

    const localParsed = parsePersistedTrainingStateV10(localWire);
    expect(localParsed).not.toBeNull();
    if (localParsed === null) {
      return;
    }
    expect(encodePersistedTrainingStateV10(localParsed)).toEqual(localWire);
    expect(encodeDashboardPersistenceV10(localParsed)).toEqual(cloudWire);

    const customWire = cloudWire.dashboardEntries[1]?.trainingSet;
    expect(customWire?.name).toBe('Custom set \ud800');
    expect(customWire?.description).toBe('\udc00');
    expect(customWire?.sections[0]?.notes).toBe('  section \ud800  ');
    expect(customWire?.sections[0]?.exercises[0]?.id).toBe('__proto__');
    expect(customWire?.sections[0]?.exercises[0]?.notes).toBe('\ud800');

    const customEntry = cloudWire.dashboardEntries[1];
    expect(customEntry).toBeDefined();
    if (customEntry === undefined) {
      return;
    }
    expect(Object.hasOwn(customEntry.quantityOverrides, '__proto__')).toBe(true);
    expect(customEntry.quantityOverrides['__proto__']).toEqual({ repetitions: 0 });

    const raw = JSON.stringify(cloudWire);
    expect(raw).toContain('\\ud800');
    expect(raw).toContain('\\udc00');
    expect(raw).not.toContain('�');
  });
});
