import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';

import { useTrainingStore } from '../../lib/training-store';

export function DashboardPage() {
  const dashboardEntries = useTrainingStore((state) => state.dashboardEntries);
  const customTrainingSets = useTrainingStore((state) => state.customTrainingSets);
  const removeFromDashboard = useTrainingStore((state) => state.removeFromDashboard);
  const allTrainingSets = [...DEFAULT_TRAINING_SETS, ...customTrainingSets];
  const trainingSetById = new Map(
    allTrainingSets.map((trainingSet) => [trainingSet.id, trainingSet]),
  );

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Today&apos;s keiko</p>
          <h2>Your dashboard</h2>
          <p className="page-intro">
            Build a focused session from your favourite drills, then tune the work to match your
            practice.
          </p>
        </div>
        <div className="session-status">
          <span className="status-pulse" aria-hidden="true" />
          <span>Local session</span>
        </div>
      </header>

      {dashboardEntries.length === 0 ? (
        <section className="empty-state" aria-labelledby="empty-dashboard-title">
          <div className="empty-icon" aria-hidden="true">
            竹
          </div>
          <p className="eyebrow">A clean starting line</p>
          <h3 id="empty-dashboard-title">Your dashboard is ready.</h3>
          <p>
            Add a drill from the library and shape it for today&apos;s practice. Reps and notes will
            be saved locally as you refine the set.
          </p>
        </section>
      ) : (
        <section className="dashboard-list" aria-label="Selected training sets">
          {dashboardEntries.map((entry, index) => {
            const trainingSet = trainingSetById.get(entry.trainingSetId);

            return (
              <article className="dashboard-card" key={entry.id}>
                <div className="card-index">{String(index + 1).padStart(2, '0')}</div>
                <div className="card-content">
                  <p className="card-kicker">{trainingSet?.category ?? 'Custom drill'}</p>
                  <h3>{trainingSet?.name ?? 'Removed training set'}</h3>
                  <p>{trainingSet?.description ?? 'This drill is no longer in your library.'}</p>
                  <div className="card-meta">
                    <span>{trainingSet?.steps.length ?? 0} steps</span>
                    <span>{entry.notes.length > 0 ? 'Has notes' : 'No notes yet'}</span>
                  </div>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => removeFromDashboard(entry.id)}
                >
                  Remove
                </button>
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}
