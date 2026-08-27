import { useState } from 'react';
import { Link } from 'react-router-dom';

import type { TrainingActivity, TrainingSet } from '@kendo-menu/domain';

import {
  formatCategory,
  formatTrainingQuantity,
  getSpecifiedTrainingQuantities,
  getTrainingSetActivityCount,
  getTrainingSetDescription,
} from '../../lib/training-data';
import { useTrainingStore } from '../../lib/training-store-context';

interface DrillDetailContentProps {
  readonly titleId: string;
  readonly trainingSet: TrainingSet;
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function TrainingActivityQuantities({ activity }: { readonly activity: TrainingActivity }) {
  const quantities = getSpecifiedTrainingQuantities(activity);

  return quantities.length === 0 ? (
    <span className="quantity-not-specified">Not set</span>
  ) : (
    <ul className="quantity-list" aria-label={`Quantities for ${activity.name}`}>
      {quantities.map((quantity) => (
        <li key={quantity.unit}>{formatTrainingQuantity(quantity)}</li>
      ))}
    </ul>
  );
}

export function DrillDetailContent({ titleId, trainingSet }: DrillDetailContentProps) {
  const addToDashboard = useTrainingStore((state) => state.addToDashboard);
  const [statusMessage, setStatusMessage] = useState('');
  const description = getTrainingSetDescription(trainingSet);

  return (
    <div className="drill-detail-content">
      <header className="page-header detail-header drill-detail-header">
        <div>
          <p className="eyebrow">{formatCategory(trainingSet.category)}</p>
          <h1 id={titleId}>{trainingSet.name}</h1>
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
        <p className="inline-confirmation">
          {statusMessage} <Link to="/app/dashboard">View dashboard</Link>
        </p>
      ) : null}

      <div className="detail-sections">
        {trainingSet.sections.map((section, sectionIndex) => {
          const sectionNumber = sectionIndex + 1;
          const sectionHeadingId = `${titleId}-section-${section.id}`;

          if (section.exercises.length === 0) {
            return (
              <section
                className="detail-section detail-standalone-activity"
                aria-labelledby={sectionHeadingId}
                key={section.id}
              >
                <div className="detail-standalone-heading">
                  <span className="section-number" aria-hidden="true">
                    {sectionNumber}
                  </span>
                  <h2 className="detail-section-label" id={sectionHeadingId}>
                    {section.name}
                  </h2>
                </div>
                <div className="training-step training-step--standalone">
                  {hasText(section.notes) ? (
                    <span className="step-description">{section.notes}</span>
                  ) : null}
                  <TrainingActivityQuantities activity={section} />
                </div>
              </section>
            );
          }

          const exerciseCount = section.exercises.length;
          const hasSectionActivity = section.quantities !== undefined;

          return (
            <details className="detail-section" key={section.id}>
              <summary className="detail-section-summary">
                <span className="detail-section-summary-content">
                  <span className="section-number" aria-hidden="true">
                    {sectionNumber}
                  </span>
                  <span className="detail-section-label">{section.name}</span>
                  <span className="detail-section-count">
                    {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}
                  </span>
                </span>
              </summary>
              {hasText(section.notes) || hasSectionActivity ? (
                <div className="detail-section-parent">
                  {hasText(section.notes) ? (
                    <p className="step-description">{section.notes}</p>
                  ) : null}
                  {hasSectionActivity ? <TrainingActivityQuantities activity={section} /> : null}
                </div>
              ) : null}
              <ol className="training-step-list">
                {section.exercises.map((exercise, exerciseIndex) => (
                  <li className="training-step" key={exercise.id}>
                    <span className="step-number" aria-hidden="true">
                      {exerciseIndex + 1}
                    </span>
                    <div className="step-copy">
                      <span className="step-label">{exercise.name}</span>
                      {hasText(exercise.notes) ? (
                        <span className="step-description">{exercise.notes}</span>
                      ) : null}
                    </div>
                    <TrainingActivityQuantities activity={exercise} />
                  </li>
                ))}
              </ol>
            </details>
          );
        })}
      </div>
    </div>
  );
}
