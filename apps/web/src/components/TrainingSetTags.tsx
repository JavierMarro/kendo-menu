import { getTrainingSetTags, type TrainingSet } from '@kendo-menu/domain';

import { formatTrainingSetTag, getTrainingSetTagVariant } from '../lib/training-data';

interface TrainingSetTagsProps {
  readonly trainingSet: Pick<TrainingSet, 'category' | 'customIntensity'>;
  readonly className?: string;
}

export function TrainingSetTags({ trainingSet, className = '' }: TrainingSetTagsProps) {
  const tags = getTrainingSetTags(trainingSet);
  const groupClassName =
    className.length > 0 ? `training-set-tags ${className}` : 'training-set-tags';

  return (
    <div className={groupClassName} aria-label="Session tags">
      {tags.map((tag) => (
        <span
          className="category-pill"
          data-category-variant={getTrainingSetTagVariant(tag)}
          key={tag}
        >
          {formatTrainingSetTag(tag)}
        </span>
      ))}
    </div>
  );
}
