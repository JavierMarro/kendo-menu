import type { KeyboardEvent, ReactNode } from 'react';

import type { TrainingActivity } from '@kendo-menu/domain';

import { TrainingActivityTree, type TrainingActivityRenderContext } from './TrainingActivityTree';

interface TrainingActivityListProps {
  readonly activities: readonly TrainingActivity[];
  readonly titleId: string;
  readonly renderActivityAside: (context: TrainingActivityRenderContext) => ReactNode;
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
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

interface TrainingActivityNodeOptions {
  readonly titleId: string;
  readonly renderActivityAside: (context: TrainingActivityRenderContext) => ReactNode;
}

function renderTrainingActivityNode(
  context: TrainingActivityRenderContext,
  { titleId, renderActivityAside }: TrainingActivityNodeOptions,
): ReactNode {
  const { activity, depth, index, childCount, isLeaf, children } = context;
  const activityNumber = index + 1;
  const activityHeadingId = `${titleId}-activity-${activity.id}`;
  const activityDataAttributes = { 'data-activity-id': activity.id };
  const aside = renderActivityAside(context);

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
          {aside}
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
        {aside}
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
      {hasText(activity.notes) || aside !== null ? (
        <div className="detail-section-parent">
          {hasText(activity.notes) ? <p className="step-description">{activity.notes}</p> : null}
          {aside}
        </div>
      ) : null}
      <ol className="training-step-list">{children}</ol>
    </>
  );
  const detailSectionClassName =
    aside === null ? 'detail-section' : 'detail-section detail-section--has-aside';

  if (depth === 0) {
    return (
      <details className={detailSectionClassName} {...activityDataAttributes}>
        {summary}
        {detailContent}
      </details>
    );
  }

  return (
    <li className="training-step training-step--nested-container" {...activityDataAttributes}>
      <details className={`${detailSectionClassName} detail-section--nested`}>
        {summary}
        {detailContent}
      </details>
    </li>
  );
}

export function TrainingActivityList({
  activities,
  titleId,
  renderActivityAside,
}: TrainingActivityListProps) {
  return (
    <TrainingActivityTree
      activities={activities}
      renderActivity={(context) =>
        renderTrainingActivityNode(context, { titleId, renderActivityAside })
      }
    />
  );
}
