import { useState, type KeyboardEvent } from 'react';
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
import {
  TrainingActivityTree,
  type TrainingActivityRenderContext,
} from '../training-activities/TrainingActivityTree';

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

function hasVisibleParentDetails(activity: TrainingActivity): boolean {
  return hasText(activity.notes) || getSpecifiedTrainingQuantities(activity).length > 0;
}

function getChildCountLabel(activity: TrainingActivity, childCount: number): string {
  const containsContainer = activity.children.some((child) => child.children.length > 0);
  if (containsContainer) {
    return `${childCount} activit${childCount === 1 ? 'y' : 'ies'}`;
  }
  return `${childCount} exercis${childCount === 1 ? 'e' : 'es'}`;
}

function toggleDisclosureWithKeyboard(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  const details = event.currentTarget.parentElement;
  if (!(details instanceof HTMLDetailsElement)) {
    return;
  }

  event.preventDefault();
  details.open = !details.open;
}

interface LibraryActivityRenderOptions {
  readonly titleId: string;
}

function renderLibraryActivity(
  context: TrainingActivityRenderContext,
  { titleId }: LibraryActivityRenderOptions,
) {
  const { activity, parentActivity, depth, index, childCount, isLeaf, children } = context;
  const activityNumber = index + 1;
  const activityHeadingId = `${titleId}-activity-${activity.id}`;
  const activityDataAttributes = { 'data-activity-id': activity.id };

  if (isLeaf) {
    if (depth === 0) {
      return (
        <section
          className="detail-section detail-standalone-activity"
          aria-labelledby={activityHeadingId}
          {...activityDataAttributes}
        >
          <span className="section-number" aria-hidden="true">
            {activityNumber}
          </span>
          <div className="detail-standalone-copy">
            <h2 className="detail-section-label" id={activityHeadingId}>
              {activity.name}
            </h2>
            {hasText(activity.notes) ? <p className="step-description">{activity.notes}</p> : null}
          </div>
          <TrainingActivityQuantities activity={activity} />
        </section>
      );
    }

    return (
      <li className="training-step" {...activityDataAttributes}>
        <span className="step-number" aria-hidden="true">
          {activityNumber}
        </span>
        <div className="step-copy">
          <span className="step-label">{activity.name}</span>
          {hasText(activity.notes) ? (
            <span className="step-description">{activity.notes}</span>
          ) : null}
        </div>
        <TrainingActivityQuantities
          activity={activity}
          {...(parentActivity === undefined ? {} : { parentActivity })}
        />
      </li>
    );
  }

  const summary = (
    <summary className="detail-section-summary" onKeyDown={toggleDisclosureWithKeyboard}>
      <span className="detail-section-summary-content">
        <span className="detail-section-indicator" aria-hidden="true" />
        <span className="section-number" aria-hidden="true">
          {activityNumber}
        </span>
        <span className="detail-section-label">{activity.name}</span>
        <span className="detail-section-count">{getChildCountLabel(activity, childCount)}</span>
      </span>
    </summary>
  );
  const detailContent = (
    <>
      {hasVisibleParentDetails(activity) ? (
        <div className="detail-section-parent">
          {hasText(activity.notes) ? <p className="step-description">{activity.notes}</p> : null}
          {getSpecifiedTrainingQuantities(activity).length > 0 ? (
            <TrainingActivityQuantities activity={activity} />
          ) : null}
        </div>
      ) : null}
      <ol className="training-step-list">{children}</ol>
    </>
  );

  if (depth === 0) {
    return (
      <details className="detail-section" {...activityDataAttributes}>
        {summary}
        {detailContent}
      </details>
    );
  }

  return (
    <li className="training-step training-step--nested-container" {...activityDataAttributes}>
      <details className="detail-section detail-section--nested">
        {summary}
        {detailContent}
      </details>
    </li>
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
        <TrainingActivityTree
          activities={trainingSet.activities}
          renderActivity={(context) => renderLibraryActivity(context, { titleId })}
        />
      </div>
    </div>
  );
}
