import { Link } from 'react-router-dom';

import {
  formatCategory,
  getAllTrainingSets,
  getTrainingSetDescription,
  getTrainingSetStepCount,
} from '../../lib/training-data';
import { useTrainingStore } from '../../lib/training-store-context';

export function LibraryPage() {
  const customTrainingSets = useTrainingStore((state) => state.customTrainingSets);
  const trainingSets = getAllTrainingSets(customTrainingSets);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Your practice catalogue</p>
          <h1>Drill library</h1>
          <p className="page-intro">
            Browse curated keiko drills and the training sets you create for yourself.
          </p>
        </div>
        {/* <Link className="primary-button" to="/app/drills/new">
          Create drill
        </Link> */}
      </header>

      {trainingSets.length === 0 ? (
        <section className="empty-state empty-state--library" aria-labelledby="empty-library-title">
          <p className="eyebrow">Build your catalogue</p>
          <h2 id="empty-library-title">No drills are available yet.</h2>
          <p>Create the first training set for your own practice.</p>
          <Link className="primary-button" to="/app/drills/new">
            Create a drill
          </Link>
        </section>
      ) : (
        <section className="library-grid" aria-labelledby="library-list-title">
          <h2 id="library-list-title" className="sr-only">
            Available training sets
          </h2>
          {trainingSets.map((trainingSet) => (
            <article className="library-card" key={trainingSet.id}>
              <div className="library-card-topline">
                <span className="category-pill">{formatCategory(trainingSet.category)}</span>
                <span className="step-count">{getTrainingSetStepCount(trainingSet)} exercises</span>
              </div>
              <h2>{trainingSet.name}</h2>
              <p>{getTrainingSetDescription(trainingSet)}</p>
              <div className="library-card-actions">
                <Link className="secondary-button" to={`/app/library/${trainingSet.id}`}>
                  View drill
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
