import { Fragment } from 'react';
/**
 * Displays tags derived from the domain training-set category and optional custom intensity.
 * Labels and visual variants come from the same presentation adapter used by dashboard filters.
 */
import { getTrainingSetTags, type TrainingSet } from '@kendo-menu/domain';

import { formatTrainingSetTag, getTrainingSetTagVariant } from '../lib/training-data';

interface TrainingSetTagsProps {
  readonly trainingSet: Pick<TrainingSet, 'category' | 'customIntensity'>;
  readonly className?: string;
  readonly receivedViaShare?: boolean;
}

export function TrainingSetTags({
  trainingSet,
  className = '',
  receivedViaShare = false,
}: TrainingSetTagsProps) {
  const tags = getTrainingSetTags(trainingSet);
  const groupClassName =
    className.length > 0 ? `training-set-tags ${className}` : 'training-set-tags';

  return (
    <div className={groupClassName} aria-label="Session tags">
      {tags.map((tag) => (
        <Fragment key={tag}>
          <span className="category-pill" data-category-variant={getTrainingSetTagVariant(tag)}>
            {formatTrainingSetTag(tag)}
          </span>
          {receivedViaShare && tag === 'custom' ? (
            <span className="category-pill" data-category-variant="shared">
              Shared
            </span>
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}
