import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAINING_SETS,
  asTrainingSetId,
  type DashboardEntry,
  type TrainingSet,
  type TrainingSetInput,
} from '@kendo-menu/domain';

import {
  createTrainingStore,
  encodePersistedTrainingStateV10,
  migratePersistedTrainingStateV9ToV10,
  parsePersistedTrainingStateV10,
  type StateStorage,
} from './index';

class MemoryStorage implements StateStorage {
  readonly #values = new Map<string, string>();

  getItem(name: string): string | null {
    return this.#values.get(name) ?? null;
  }

  setItem(name: string, value: string): void {
    this.#values.set(name, value);
  }

  removeItem(name: string): void {
    this.#values.delete(name);
  }
}

const CUSTOM_INPUT = {
  name: 'Solo custom menu',
  description: 'A short session.',
  category: 'custom',
  customIntensity: 'high-intensity-drill',
  sections: [
    {
      name: 'Main work',
      exercises: [{ name: 'Men', quantities: { repetitions: 40 } }],
    },
  ],
} satisfies TrainingSetInput;

function entryFor(trainingSetId: string): DashboardEntry {
  return {
    id: 'entry-legacy-custom',
    trainingSetId: asTrainingSetId(trainingSetId),
    quantityOverrides: {},
    activityNotes: {},
    notes: '',
    createdAt: '2026-08-30T00:00:00.000Z',
  };
}

function customSet(): TrainingSet {
  return {
    id: asTrainingSetId('legacy-custom'),
    name: 'Legacy custom',
    category: 'custom',
    activities: [
      {
        id: 'legacy-section',
        name: 'Main work',
        children: [
          { id: 'legacy-men', name: 'Men', quantities: { repetitions: 20 }, children: [] },
        ],
      },
    ],
    isBuiltIn: false,
  };
}

describe('dashboard-owned training-set snapshots', () => {
  it('creates custom menus on the dashboard and never writes a library collection', () => {
    const storage = new MemoryStorage();
    const store = createTrainingStore({ storage });
    const result = store.getState().createCustomTrainingSetAndAddToDashboard(CUSTOM_INPUT);
    const entry = store.getState().dashboardEntries[0];

    expect(entry?.trainingSetId).toBe(result.trainingSetId);
    expect(entry?.trainingSet?.category).toBe('custom');
    expect(entry?.trainingSet?.customIntensity).toBe('high-intensity-drill');
    expect(store.getState().dashboardEntries).toHaveLength(1);
    const persisted: unknown = JSON.parse(storage.getItem('kendo-menu') ?? '{}');
    expect(persisted).not.toHaveProperty('state.customTrainingSets');
  });

  it('gives each curated dashboard entry an independent deep snapshot', () => {
    const store = createTrainingStore({ storage: new MemoryStorage() });
    const curated = DEFAULT_TRAINING_SETS[2];
    if (curated === undefined) {
      throw new Error('Expected a curated training set.');
    }

    store.getState().addToDashboard(curated.id);
    store.getState().addToDashboard(curated.id);
    const [first, second] = store.getState().dashboardEntries;
    expect(first?.trainingSet).not.toBe(curated);
    expect(second?.trainingSet).not.toBe(curated);
    expect(first?.trainingSet).not.toBe(second?.trainingSet);
    expect(first?.trainingSet?.activities[0]).not.toBe(second?.trainingSet?.activities[0]);
    expect(first?.quantityOverrides).not.toBe(second?.quantityOverrides);
  });

  it('keeps dashboard workload and notes independent from curated defaults across reload', () => {
    const storage: StateStorage = new MemoryStorage();
    const curated = DEFAULT_TRAINING_SETS[2];
    if (curated === undefined) {
      throw new Error('Expected a curated training set.');
    }
    const before = JSON.stringify(curated);
    const first = createTrainingStore({ storage });
    const entryId = first.getState().addToDashboard(curated.id);
    first
      .getState()
      .setQuantityOverride(entryId, 'junior-high-kendo-club-suburi-haya', 'repetitions', 75);
    first.getState().updateDashboardEntry(entryId, { notes: 'Today only.' });
    expect(JSON.stringify(curated)).toBe(before);

    const second = createTrainingStore({ storage });
    const entry = second.getState().dashboardEntries[0];
    expect(entry?.quantityOverrides).toEqual({
      'junior-high-kendo-club-suburi-haya': { repetitions: 75 },
    });
    expect(entry?.notes).toBe('Today only.');
    expect(JSON.stringify(curated)).toBe(before);
  });

  it('moves referenced v9 custom sets into owned entries and drops unreferenced definitions', () => {
    const source = customSet();
    const migrated = migratePersistedTrainingStateV9ToV10({
      dashboardEntries: [entryFor(source.id)],
      customTrainingSets: [source, { ...source, id: asTrainingSetId('unused-custom') }],
    });

    expect(Object.hasOwn(migrated, 'customTrainingSets')).toBe(false);
    expect(migrated.dashboardEntries[0]?.trainingSet?.id).toBe(source.id);
    expect(migrated.dashboardEntries[0]?.trainingSet).not.toBe(source);
    expect(migrated.dashboardEntries[0]?.trainingSet?.activities[0]).not.toBe(source.activities[0]);
  });

  it('rejects v10 custom snapshots that collide with a curated ID in runtime and wire forms', () => {
    const curated = DEFAULT_TRAINING_SETS[0];
    if (curated === undefined) {
      throw new Error('Expected a curated training set.');
    }

    const runtimeCollision = {
      dashboardEntries: [
        {
          ...entryFor(curated.id),
          trainingSet: { ...customSet(), id: curated.id },
        },
      ],
    };
    expect(parsePersistedTrainingStateV10(runtimeCollision)).toBeNull();
    expect(() => encodePersistedTrainingStateV10(runtimeCollision)).toThrow(
      'Training-store state is invalid and cannot be encoded.',
    );

    const wireCollision = {
      dashboardEntries: [
        {
          ...entryFor(curated.id),
          trainingSet: {
            id: curated.id,
            name: 'Colliding custom set',
            category: 'custom',
            sections: [
              {
                id: 'collision-section',
                name: 'Main work',
                exercises: [{ id: 'collision-exercise', name: 'Men' }],
              },
            ],
            isBuiltIn: false,
          },
        },
      ],
    };
    expect(parsePersistedTrainingStateV10(wireCollision)).toBeNull();
  });
});
