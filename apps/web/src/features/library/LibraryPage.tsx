import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  findTrainingSet,
  formatCategory,
  getAllTrainingSets,
  getCategoryBadgeVariant,
  getTrainingSetDescription,
  getTrainingSetActivityCount,
} from '../../lib/training-data';
import { useTrainingStore } from '../../lib/training-store-context';
import { DrillDetailDialog } from './DrillDetailDialog';
import {
  getLibraryDrillLocation,
  getLibraryLocationWithoutDrill,
  getSelectedDrillId,
  isLibraryDrillNavigationState,
  LIBRARY_DRILL_NAVIGATION_STATE,
} from './library-query';

export function LibraryPage() {
  const customTrainingSets = useTrainingStore((state) => state.customTrainingSets);
  const trainingSets = useMemo(() => getAllTrainingSets(customTrainingSets), [customTrainingSets]);
  const location = useLocation();
  const navigate = useNavigate();
  const selectedDrillId = getSelectedDrillId(location.search);
  const selectedTrainingSet = findTrainingSet(trainingSets, selectedDrillId ?? '');
  const openerLinksRef = useRef(new Map<string, HTMLAnchorElement>());
  const originatingDrillIdRef = useRef<string | null>(null);
  const previousSelectedDrillIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedDrillId === undefined || selectedTrainingSet !== undefined) {
      return;
    }

    void navigate(getLibraryLocationWithoutDrill(location.search), {
      replace: true,
      state: null,
    });
  }, [location.search, navigate, selectedDrillId, selectedTrainingSet]);

  useEffect(() => {
    const nextSelectedDrillId = selectedTrainingSet?.id ?? null;
    const previousSelectedDrillId = previousSelectedDrillIdRef.current;
    previousSelectedDrillIdRef.current = nextSelectedDrillId;

    if (previousSelectedDrillId === null || nextSelectedDrillId !== null) {
      return;
    }

    const originatingLink =
      originatingDrillIdRef.current === previousSelectedDrillId
        ? openerLinksRef.current.get(previousSelectedDrillId)
        : undefined;

    if (originatingLink !== undefined) {
      originatingLink.focus({ preventScroll: true });
      return;
    }

    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [selectedTrainingSet?.id]);

  const closeSelectedDrill = useCallback(() => {
    if (isLibraryDrillNavigationState(location.state)) {
      void navigate(-1);
      return;
    }

    void navigate(getLibraryLocationWithoutDrill(location.search), {
      replace: true,
      state: null,
    });
  }, [location.search, location.state, navigate]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Keiko catalogue</p>
          <h1>Keiko library</h1>
          <p className="page-intro">
            Browse curated keiko menus, add them to your dashboard and set the workload.
          </p>
        </div>
        {/* <Link className="primary-button" to="/app/drills/new">
          Create session
        </Link> */}
      </header>

      {trainingSets.length === 0 ? (
        <section className="empty-state empty-state--library" aria-labelledby="empty-library-title">
          <p className="eyebrow">Build your catalogue</p>
          <h2 id="empty-library-title">No training sessions are available yet.</h2>
          <p>Create the first training session for your own practice.</p>
          <Link className="primary-button" to="/app/drills/new">
            Create a training session
          </Link>
        </section>
      ) : (
        <section className="library-grid" aria-labelledby="library-list-title">
          <h2 id="library-list-title" className="sr-only">
            Available training sessions
          </h2>
          {trainingSets.map((trainingSet) => {
            const description = getTrainingSetDescription(trainingSet);
            const detailLocation = getLibraryDrillLocation(location.search, trainingSet.id);

            return (
              <article className="library-card" key={trainingSet.id}>
                <div className="library-card-topline">
                  <span
                    className="category-pill"
                    data-category-variant={getCategoryBadgeVariant(trainingSet.category)}
                  >
                    {formatCategory(trainingSet.category)}
                  </span>
                  <span className="step-count">
                    {getTrainingSetActivityCount(trainingSet)} activities
                  </span>
                </div>
                <h2>{trainingSet.name}</h2>
                {description === undefined ? null : (
                  <p className="library-card-description">{description}</p>
                )}
                <div className="library-card-actions">
                  <Link
                    ref={(element) => {
                      if (element === null) {
                        openerLinksRef.current.delete(trainingSet.id);
                        return;
                      }

                      openerLinksRef.current.set(trainingSet.id, element);
                    }}
                    className="secondary-button"
                    to={{ ...detailLocation, hash: location.hash }}
                    state={LIBRARY_DRILL_NAVIGATION_STATE}
                    onClick={() => {
                      originatingDrillIdRef.current = trainingSet.id;
                    }}
                  >
                    View session
                  </Link>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {selectedTrainingSet === undefined ? null : (
        <DrillDetailDialog
          key={selectedTrainingSet.id}
          trainingSet={selectedTrainingSet}
          onClose={closeSelectedDrill}
        />
      )}
    </>
  );
}
