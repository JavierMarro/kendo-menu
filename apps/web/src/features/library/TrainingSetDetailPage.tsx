import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';

import type { TrainingActivity } from '@kendo-menu/domain';

import { useTrainingStore } from '../../lib/training-store-context';
import {
  findTrainingSet,
  formatCategory,
  formatTrainingQuantity,
  getAllTrainingSets,
  getSpecifiedTrainingQuantities,
  getTrainingSetDescription,
  getSectionActivityCount,
  getTrainingSetActivityCount,
} from '../../lib/training-data';

function TrainingActivityQuantities({ activity }: { readonly activity: TrainingActivity }) {
  const quantities = getSpecifiedTrainingQuantities(activity);

  return quantities.length === 0 ? (
    <span className="quantity-not-specified">Quantity not specified</span>
  ) : (
    <ul className="quantity-list" aria-label={`Quantities for ${activity.name}`}>
      {quantities.map((quantity) => (
        <li key={quantity.unit}>{formatTrainingQuantity(quantity)}</li>
      ))}
    </ul>
  );
}

export function TrainingSetDetailPage() {
  const { trainingSetId } = useParams();
  const customTrainingSets = useTrainingStore((state) => state.customTrainingSets);
  const addToDashboard = useTrainingStore((state) => state.addToDashboard);
  const [statusMessage, setStatusMessage] = useState('');
  const trainingSet = findTrainingSet(getAllTrainingSets(customTrainingSets), trainingSetId ?? '');

  if (trainingSet === undefined) {
    return (
      <section className="empty-state" aria-labelledby="missing-training-set-title">
        <p className="eyebrow">Drill not found</p>
        <h1 id="missing-training-set-title">This training set is unavailable.</h1>
        <p>Return to the library to choose another drill.</p>
        <Link className="primary-button" to="/app/library">
          Back to drill library
        </Link>
      </section>
    );
  }

  const description = getTrainingSetDescription(trainingSet);

  return (
    <>
      <p className="breadcrumb">
        <Link to="/app/library">Drill library</Link>
        <span aria-hidden="true"> / </span>
        <span>{trainingSet.name}</span>
      </p>
      <header className="page-header detail-header">
        <div>
          <p className="eyebrow">{formatCategory(trainingSet.category)}</p>
          <h1>{trainingSet.name}</h1>
          {description === undefined ? null : <p className="page-intro">{description}</p>}
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            addToDashboard(trainingSet.id);
            setStatusMessage(`${trainingSet.name} added to your dashboard.`);
          }}
        >
          Add to dashboard
        </button>
      </header>

      <p className="detail-meta">
        {getTrainingSetActivityCount(trainingSet)} activities in this drill.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {statusMessage}
      </p>
      {statusMessage.length > 0 ? (
        <p className="inline-confirmation" role="status">
          {statusMessage} <Link to="/app/dashboard">View dashboard</Link>
        </p>
      ) : null}

      <div className="detail-sections">
        {trainingSet.sections.map((section, sectionIndex) => {
          const activityCount = getSectionActivityCount(section);
          const countLabel =
            section.exercises.length === 0 || section.quantities !== undefined
              ? `${activityCount} ${activityCount === 1 ? 'activity' : 'activities'}`
              : `${activityCount} ${activityCount === 1 ? 'exercise' : 'exercises'}`;

          return (
            <details className="detail-section" key={section.id}>
              <summary className="detail-section-summary">
                <span className="detail-section-summary-content">
                  <span className="section-number" aria-hidden="true">
                    {sectionIndex + 1}
                  </span>
                  <span className="detail-section-label">{section.name}</span>
                  <span className="detail-section-count">{countLabel}</span>
                </span>
              </summary>
              {section.exercises.length === 0 || section.quantities !== undefined ? (
                <div className="training-step training-step--standalone">
                  {section.notes !== undefined && section.notes.length > 0 ? (
                    <span className="step-description">{section.notes}</span>
                  ) : null}
                  <TrainingActivityQuantities activity={section} />
                </div>
              ) : section.notes !== undefined && section.notes.length > 0 ? (
                <p className="step-description">{section.notes}</p>
              ) : null}
              {section.exercises.length > 0 ? (
                <ol className="training-step-list">
                  {section.exercises.map((exercise, exerciseIndex) => (
                    <li className="training-step" key={exercise.id}>
                      <span className="step-number" aria-hidden="true">
                        {exerciseIndex + 1}
                      </span>
                      <div className="step-copy">
                        <span className="step-label">{exercise.name}</span>
                        {exercise.notes !== undefined && exercise.notes.length > 0 ? (
                          <span className="step-description">{exercise.notes}</span>
                        ) : null}
                      </div>
                      <TrainingActivityQuantities activity={exercise} />
                    </li>
                  ))}
                </ol>
              ) : null}
            </details>
          );
        })}
      </div>
    </>
  );
}
