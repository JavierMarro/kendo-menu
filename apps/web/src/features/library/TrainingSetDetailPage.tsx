import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';

import { useTrainingStore } from '../../lib/training-store-context';
import {
  findTrainingSet,
  formatCategory,
  getAllTrainingSets,
  getTrainingSetStepCount,
} from '../../lib/training-data';

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
          <p className="page-intro">{trainingSet.description}</p>
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

      <p className="detail-meta">{getTrainingSetStepCount(trainingSet)} exercises in this drill.</p>
      <p className="sr-only" role="status" aria-live="polite">
        {statusMessage}
      </p>
      {statusMessage.length > 0 ? (
        <p className="inline-confirmation" role="status">
          {statusMessage} <Link to="/app/dashboard">View dashboard</Link>
        </p>
      ) : null}

      <div className="detail-sections">
        {trainingSet.sections.map((section, sectionIndex) => (
          <section
            className="detail-section"
            key={section.id}
            aria-labelledby={`detail-${section.id}`}
          >
            <div className="training-section-heading">
              <span className="section-number" aria-hidden="true">
                {sectionIndex + 1}
              </span>
              <h2 id={`detail-${section.id}`}>{section.label}</h2>
            </div>
            <ol className="training-step-list">
              {section.steps.map((step, stepIndex) => (
                <li className="training-step" key={step.id}>
                  <span className="step-number" aria-hidden="true">
                    {stepIndex + 1}
                  </span>
                  <div className="step-copy">
                    <span className="step-label">{step.label}</span>
                    {step.description ? (
                      <span className="step-description">{step.description}</span>
                    ) : null}
                  </div>
                  <span className="detail-reps">
                    {step.defaultReps === null ? 'Set reps' : `${step.defaultReps} reps`}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </>
  );
}
