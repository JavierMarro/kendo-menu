import { useState } from 'react';
import { Link } from 'react-router-dom';

import type { TrainingActivity, TrainingSet } from '@kendo-menu/domain';

import {
  formatTrainingQuantity,
  getMissingTrainingQuantityLabel,
  getSpecifiedTrainingQuantities,
  getTrainingSetActivityCount,
  getTrainingSetDescription,
} from '../../lib/training-data';
import { useTrainingStore } from '../../lib/training-store-context';
import { TrainingSetTags } from '../../components/TrainingSetTags';
import { TrainingActivityList } from '../training-activities/TrainingActivityList';
import type { TrainingActivityRenderContext } from '../training-activities/TrainingActivityTree';

interface DrillDetailContentProps {
  readonly titleId: string;
  readonly trainingSet: TrainingSet;
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

function renderLibraryActivityAside(context: TrainingActivityRenderContext) {
  const { activity, parentActivity, isLeaf } = context;
  if (!isLeaf && getSpecifiedTrainingQuantities(activity).length === 0) {
    return null;
  }

  return (
    <TrainingActivityQuantities
      activity={activity}
      {...(parentActivity === undefined ? {} : { parentActivity })}
    />
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
          <TrainingSetTags trainingSet={trainingSet} className="drill-detail-category" />
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
        <TrainingActivityList
          activities={trainingSet.activities}
          titleId={titleId}
          renderActivityAside={renderLibraryActivityAside}
        />
      </div>
    </div>
  );
}
