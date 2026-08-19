import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';

import { useTrainingStore } from '../../lib/training-store';

export function LibraryPage() {
  const customTrainingSets = useTrainingStore((state) => state.customTrainingSets);
  const addToDashboard = useTrainingStore((state) => state.addToDashboard);
  const trainingSets = [...DEFAULT_TRAINING_SETS, ...customTrainingSets];

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Your practice catalogue</p>
          <h2>Drill library</h2>
          <p className="page-intro">
            Curated defaults will live here alongside the training sets you create yourself.
          </p>
        </div>
        <button className="primary-button" type="button" disabled>
          + Create training set
        </button>
      </header>

      {trainingSets.length === 0 ? (
        <section className="empty-state empty-state--library" aria-labelledby="empty-library-title">
          <div className="empty-icon" aria-hidden="true">
            稽
          </div>
          <p className="eyebrow">Ready for your curriculum</p>
          <h3 id="empty-library-title">No drills have been added yet.</h3>
          <p>
            Add the first curated sets to <code>packages/domain/src/default-training-sets.ts</code>.
            The library and dashboard are already wired to the shared model and local store.
          </p>
        </section>
      ) : (
        <section className="library-grid" aria-label="Training set library">
          {trainingSets.map((trainingSet) => (
            <article className="library-card" key={trainingSet.id}>
              <div className="library-card-topline">
                <span className="category-pill">{trainingSet.category}</span>
                <span className="step-count">{trainingSet.steps.length} steps</span>
              </div>
              <h3>{trainingSet.name}</h3>
              <p>{trainingSet.description}</p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => addToDashboard(trainingSet.id)}
              >
                Add to dashboard
              </button>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
