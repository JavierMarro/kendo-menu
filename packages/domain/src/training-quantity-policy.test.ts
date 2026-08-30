import { describe, expect, it } from 'vitest';

import {
  getTrainingQuantityPolicy,
  type TrainingActivity,
  type TrainingQuantityUnit,
} from './index';

interface FallbackPolicyCase {
  readonly label: string;
  readonly activity: TrainingActivity;
  readonly parentActivity?: TrainingActivity;
  readonly expectedUnit: TrainingQuantityUnit;
}

function activity(name: string, children: readonly TrainingActivity[] = []): TrainingActivity {
  return { id: name, name, children };
}

const FALLBACK_POLICY_CASES: readonly FallbackPolicyCase[] = [
  { label: 'warm-up', activity: activity('Warm-up'), expectedUnit: 'minutes' },
  { label: 'Suburi', activity: activity('Suburi'), expectedUnit: 'minutes' },
  { label: 'ashi sabaki', activity: activity('Ashi sabaki'), expectedUnit: 'minutes' },
  { label: 'suriashi', activity: activity('Suriashi'), expectedUnit: 'minutes' },
  { label: 'footwork', activity: activity('Footwork'), expectedUnit: 'minutes' },
  { label: 'jigeiko', activity: activity('Jigeiko'), expectedUnit: 'minutes' },
  { label: 'shiaigeiko', activity: activity('Shiaigeiko'), expectedUnit: 'minutes' },
  { label: 'kakarigeiko', activity: activity('Ai kakari-geiko'), expectedUnit: 'seconds' },
  { label: 'butsukarigeiko', activity: activity('Butsukarigeiko'), expectedUnit: 'seconds' },
  { label: 'ordinary activity', activity: activity('Kirikaeshi'), expectedUnit: 'repetitions' },
  {
    label: 'child of Suburi',
    activity: activity('Kakarigeiko'),
    parentActivity: activity('Suburi'),
    expectedUnit: 'repetitions',
  },
  {
    label: 'child of a timed parent',
    activity: activity('Men'),
    parentActivity: activity('Warm-up'),
    expectedUnit: 'minutes',
  },
];

describe('training quantity policy', () => {
  it.each(FALLBACK_POLICY_CASES)(
    'preserves the legacy fallback for $label',
    ({ activity: currentActivity, parentActivity, expectedUnit }) => {
      expect(getTrainingQuantityPolicy(currentActivity, parentActivity)).toEqual({
        primaryUnit: expectedUnit,
        editableUnits: [expectedUnit],
      });
    },
  );

  it('gives configured units precedence over the fallback', () => {
    const configured: TrainingActivity = {
      id: 'configured-warm-up',
      name: 'Warm-up',
      quantities: { repetitions: 20, sets: 2 },
      editableQuantityUnits: ['minutes'],
      children: [],
    };

    expect(getTrainingQuantityPolicy(configured, undefined, { rounds: 3 })).toEqual({
      primaryUnit: 'repetitions',
      editableUnits: ['repetitions', 'sets', 'minutes', 'rounds'],
    });
  });

  it('uses editable metadata before the fallback when no quantity is configured', () => {
    const metadataActivity: TrainingActivity = {
      id: 'metadata-warm-up',
      name: 'Warm-up',
      editableQuantityUnits: ['seconds'],
      children: [],
    };

    expect(getTrainingQuantityPolicy(metadataActivity)).toEqual({
      primaryUnit: 'seconds',
      editableUnits: ['seconds'],
    });
  });

  it('keeps an unspecified container non-editable even when its name or overrides imply a unit', () => {
    const container = activity('Kakarigeiko', [activity('Men')]);

    expect(getTrainingQuantityPolicy(container, undefined, { seconds: 30 })).toEqual({
      primaryUnit: 'seconds',
      editableUnits: [],
    });
  });

  it('retains an existing override and appends the fallback for an unspecified leaf', () => {
    expect(getTrainingQuantityPolicy(activity('Men'), undefined, { seconds: 30 })).toEqual({
      primaryUnit: 'repetitions',
      editableUnits: ['seconds', 'repetitions'],
    });
  });
});
