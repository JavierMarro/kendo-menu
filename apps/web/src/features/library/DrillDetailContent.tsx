import { useState } from 'react';
import { Link } from 'react-router-dom';

import type { TrainingActivity, TrainingSet } from '@kendo-menu/domain';

import {
  formatCategory,
  formatTrainingQuantity,
  getCategoryBadgeVariant,
  getMissingTrainingQuantityLabel,
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

interface TrainingActivityQuantitiesProps {
  readonly activity: TrainingActivity;
  readonly parentActivity?: TrainingActivity;
}

function TrainingActivityQuantities({ activity, parentActivity }: TrainingActivityQuantitiesProps) {
  const quantities = getSpecifiedTrainingQuantities(activity);

  return quantities.length === 0 ? (
    <span className="quantity-not-specified">
      {getMissingTrainingQuantityLabel(activity, parentActivity)}
    </span>
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
          <span
            className="category-pill drill-detail-category"
            data-category-variant={getCategoryBadgeVariant(trainingSet.category)}
          >
            {formatCategory(trainingSet.category)}
          </span>
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
        {getTrainingSetActivityCount(trainingSet)} activities in this session.
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
        {trainingSet.activities.map((activity, activityIndex) => {
          const activityNumber = activityIndex + 1;
          const activityHeadingId = `${titleId}-activity-${activity.id}`;

          if (activity.children.length === 0) {
            return (
              <section
                className="detail-section detail-standalone-activity"
                aria-labelledby={activityHeadingId}
                key={activity.id}
              >
                <span className="section-number" aria-hidden="true">
                  {activityNumber}
                </span>
                <div className="detail-standalone-copy">
                  <h2 className="detail-section-label" id={activityHeadingId}>
                    {activity.name}
                  </h2>
                  {hasText(activity.notes) ? (
                    <p className="step-description">{activity.notes}</p>
                  ) : null}
                </div>
                <TrainingActivityQuantities activity={activity} />
              </section>
            );
          }

          const childCount = activity.children.length;
          const hasParentActivity = activity.quantities !== undefined;

          return (
            <details className="detail-section" key={activity.id}>
              <summary className="detail-section-summary">
                <span className="detail-section-summary-content">
                  <span className="detail-section-indicator" aria-hidden="true" />
                  <span className="section-number" aria-hidden="true">
                    {activityNumber}
                  </span>
                  <span className="detail-section-label">{activity.name}</span>
                  <span className="detail-section-count">
                    {childCount} {childCount === 1 ? 'exercise' : 'exercises'}
                  </span>
                </span>
              </summary>
              {hasText(activity.notes) || hasParentActivity ? (
                <div className="detail-section-parent">
                  {hasText(activity.notes) ? (
                    <p className="step-description">{activity.notes}</p>
                  ) : null}
                  {hasParentActivity ? <TrainingActivityQuantities activity={activity} /> : null}
                </div>
              ) : null}
              <ol className="training-step-list">
                {activity.children.map((child, childIndex) => (
                  <li className="training-step" key={child.id}>
                    <span className="step-number" aria-hidden="true">
                      {childIndex + 1}
                    </span>
                    <div className="step-copy">
                      <span className="step-label">{child.name}</span>
                      {hasText(child.notes) ? (
                        <span className="step-description">{child.notes}</span>
                      ) : null}
                    </div>
                    <TrainingActivityQuantities activity={child} parentActivity={activity} />
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
