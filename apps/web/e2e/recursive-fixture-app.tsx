import type { TrainingStoreApi } from '@kendo-menu/store';
import { MemoryRouter } from 'react-router-dom';

import { DashboardTrainingSet } from '../src/features/dashboard/DashboardPage';
import { PersistenceContext } from '../src/features/persistence/PersistenceGate';
import { DrillDetailContent } from '../src/features/library/DrillDetailContent';
import {
  TrainingStoreProvider,
  useTrainingStore,
  useTrainingStoreApi,
} from '../src/lib/training-store-context';
import { RECURSIVE_TRAINING_SET } from '../src/test/recursive-activity.fixture';

export function RecursiveDashboardFixture() {
  const entry = useTrainingStore((state) =>
    state.dashboardEntries.find(
      (candidate) => candidate.trainingSetId === RECURSIVE_TRAINING_SET.id,
    ),
  );
  const storeApi = useTrainingStoreApi();

  if (entry === undefined) {
    return <p>Waiting for the synthetic dashboard entry.</p>;
  }

  return (
    <DashboardTrainingSet
      entry={entry}
      index={0}
      trainingSet={RECURSIVE_TRAINING_SET}
      onRemove={() => undefined}
      onUpdate={(patch) => storeApi.getState().updateDashboardEntry(entry.id, patch)}
      onSetQuantity={(activityId, unit, value) =>
        storeApi.getState().setQuantityOverride(entry.id, activityId, unit, value)
      }
      onClearQuantity={(activityId, unit) =>
        storeApi.getState().clearQuantityOverride(entry.id, activityId, unit)
      }
    />
  );
}

export function RecursiveFixtureApp({
  store,
  view,
}: {
  readonly store: TrainingStoreApi;
  readonly view: 'library' | 'dashboard';
}) {
  return (
    <PersistenceContext.Provider value={{ mode: 'local', writeFailed: false }}>
      <TrainingStoreProvider store={store}>
        {view === 'library' ? (
          <MemoryRouter>
            <main id="main-content" tabIndex={-1}>
              <DrillDetailContent
                titleId="recursive-fixture-title"
                trainingSet={RECURSIVE_TRAINING_SET}
              />
            </main>
          </MemoryRouter>
        ) : (
          <main id="main-content" tabIndex={-1}>
            <RecursiveDashboardFixture />
          </main>
        )}
      </TrainingStoreProvider>
    </PersistenceContext.Provider>
  );
}
