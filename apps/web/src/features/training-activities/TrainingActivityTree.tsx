import type { ReactNode } from 'react';

import type { TrainingActivity } from '@kendo-menu/domain';

/**
 * The information a presentation adapter needs for one activity in the tree.
 *
 * The tree owns recursion and ordering. Adapters only decide how one node and
 * the already-rendered children are presented, so library and dashboard stay
 * in step when another level is added to the catalogue.
 */
export interface TrainingActivityRenderContext {
  readonly activity: TrainingActivity;
  readonly parentActivity?: TrainingActivity;
  readonly depth: number;
  readonly index: number;
  readonly childCount: number;
  readonly isLeaf: boolean;
  readonly children: ReactNode;
}

export interface TrainingActivityTreeProps {
  readonly activities: readonly TrainingActivity[];
  readonly renderActivity: (context: TrainingActivityRenderContext) => ReactNode;
  readonly parentActivity?: TrainingActivity;
  readonly depth?: number;
}

/**
 * Render activities in stable depth-first preorder. The callback receives one
 * node at a time and may place `children` inside its own semantic wrapper.
 * Activity ids are the React keys at every level.
 */
export function TrainingActivityTree({
  activities,
  renderActivity,
  parentActivity,
  depth = 0,
}: TrainingActivityTreeProps) {
  return (
    <>
      {activities.map((activity, index) => (
        <TrainingActivityTreeNode
          key={activity.id}
          activity={activity}
          {...(parentActivity === undefined ? {} : { parentActivity })}
          depth={depth}
          index={index}
          renderActivity={renderActivity}
        />
      ))}
    </>
  );
}

interface TrainingActivityTreeNodeProps {
  readonly activity: TrainingActivity;
  readonly parentActivity?: TrainingActivity;
  readonly depth: number;
  readonly index: number;
  readonly renderActivity: (context: TrainingActivityRenderContext) => ReactNode;
}

function TrainingActivityTreeNode({
  activity,
  parentActivity,
  depth,
  index,
  renderActivity,
}: TrainingActivityTreeNodeProps) {
  const childCount = activity.children.length;
  const children = (
    <TrainingActivityTree
      activities={activity.children}
      renderActivity={renderActivity}
      parentActivity={activity}
      depth={depth + 1}
    />
  );

  return renderActivity({
    activity,
    ...(parentActivity === undefined ? {} : { parentActivity }),
    depth,
    index,
    childCount,
    isLeaf: childCount === 0,
    children,
  });
}
