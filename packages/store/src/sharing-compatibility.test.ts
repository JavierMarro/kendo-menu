import { describe, expect, it } from 'vitest';

import type { TrainingSetInput } from '@kendo-menu/domain';

import {
  classifyTrainingStorageValue,
  createTrainingStore,
  serializePersistedTrainingStateV10,
  serializePersistedTrainingStateV11,
  type StateStorage,
} from './index';

class MemoryStorage implements StateStorage {
  readonly values = new Map<string, string>();
  writes = 0;

  getItem(name: string): string | null {
    return this.values.get(name) ?? null;
  }

  setItem(name: string, value: string): void {
    this.writes += 1;
    this.values.set(name, value);
  }

  removeItem(name: string): void {
    this.values.delete(name);
  }
}

const CUSTOM_INPUT = {
  name: 'Legacy custom menu',
  description: 'Keep this description.',
  category: 'custom',
  customIntensity: 'intense-drill',
  sections: [
    {
      name: 'Main work',
      quantities: { sets: 3 },
      exercises: [{ name: 'Men', quantities: { repetitions: 40 } }],
    },
  ],
} satisfies TrainingSetInput;

describe('v11 sharing persistence compatibility', () => {
  it('migrates a populated v10 dashboard losslessly and adds no received origin', () => {
    const source = createTrainingStore({ storage: new MemoryStorage() });
    const created = source.getState().createCustomTrainingSetAndAddToDashboard(CUSTOM_INPUT);
    const section = created.trainingSet.activities[0];
    const exercise = section?.children[0];
    if (section === undefined || exercise === undefined) {
      throw new Error('Expected the custom menu fixture activities.');
    }
    source.getState().setQuantityOverride(created.dashboardEntryId, exercise.id, 'repetitions', 0);
    source
      .getState()
      .updateDashboardEntry(created.dashboardEntryId, { notes: 'Keep these notes.' });

    const rawV10 = serializePersistedTrainingStateV10({
      dashboardEntries: source.getState().dashboardEntries,
    });
    expect(classifyTrainingStorageValue(rawV10)).toMatchObject({
      status: 'migrated',
      fromVersion: 10,
      version: 11,
    });

    const storage = new MemoryStorage();
    storage.values.set('kendo-menu', rawV10);
    const restored = createTrainingStore({ storage });
    const entry = restored.getState().dashboardEntries[0];
    expect(entry).toMatchObject({
      id: created.dashboardEntryId,
      trainingSetId: created.trainingSetId,
      quantityOverrides: { [exercise.id]: { repetitions: 0 } },
      notes: 'Keep these notes.',
      trainingSet: {
        name: 'Legacy custom menu',
        description: 'Keep this description.',
        customIntensity: 'intense-drill',
      },
    });
    expect(entry).not.toHaveProperty('receivedViaShare');

    const rewritten = storage.getItem('kendo-menu');
    expect(rewritten === null ? null : JSON.parse(rewritten)).toMatchObject({ version: 11 });
    expect(rewritten).not.toBeNull();
    if (rewritten !== null) {
      const inspection = classifyTrainingStorageValue(rewritten);
      if (inspection.status !== 'ready') throw new Error('Expected v11 storage');
      expect(inspection.state.dashboardEntries[0]).not.toHaveProperty('receivedViaShare');
    }
  });

  it('keeps malformed and future guest bytes untouched when hydration fails', () => {
    const invalidV11 = JSON.stringify({
      version: 11,
      state: { dashboardEntries: [{ receivedViaShare: true }] },
    });
    const future = JSON.stringify({ version: 12, state: { dashboardEntries: [] } });
    for (const raw of [invalidV11, future]) {
      const storage = new MemoryStorage();
      storage.values.set('kendo-menu', raw);
      expect(() => createTrainingStore({ storage })).toThrow();
      expect(storage.writes).toBe(0);
      expect(storage.getItem('kendo-menu')).toBe(raw);
    }
    expect(classifyTrainingStorageValue(future)).toMatchObject({ status: 'unsupported-future' });
    expect(classifyTrainingStorageValue(invalidV11)).toMatchObject({ status: 'corrupt' });
  });

  it('refuses v10 encoding of received provenance before storage can lose it', () => {
    const store = createTrainingStore({ storage: new MemoryStorage() });
    const received = store.getState().createCustomTrainingSetAndAddToDashboard(CUSTOM_INPUT, true);
    expect(() =>
      serializePersistedTrainingStateV10({ dashboardEntries: [received.dashboardEntry] }),
    ).toThrow();
    const v11: unknown = JSON.parse(
      serializePersistedTrainingStateV11({ dashboardEntries: [received.dashboardEntry] }),
    );
    expect(v11).toMatchObject({
      version: 11,
      state: { dashboardEntries: [{ receivedViaShare: true }] },
    });
  });
});
