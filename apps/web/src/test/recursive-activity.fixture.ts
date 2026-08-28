import { asTrainingSetId, type TrainingSet } from '@kendo-menu/domain';

/**
 * A deliberately synthetic tree used by web tests until the curated source
 * data grows nested activity groups. It exercises both a three-level branch
 * (Station A → exercise) and a four-level branch (Sandan → Yakusoku/Free →
 * exercise) without changing the canonical catalogue.
 */
export const RECURSIVE_TRAINING_SET = {
  id: asTrainingSetId('synthetic-recursive-keiko'),
  name: 'Synthetic recursive keiko',
  description: 'A test-only activity tree.',
  category: 'custom',
  isBuiltIn: false,
  activities: [
    {
      id: 'synthetic-root',
      name: 'Recursive keiko',
      notes: 'Start with posture and intent.',
      quantities: { duration: { unit: 'minutes', value: 30 } },
      children: [
        {
          id: 'synthetic-station-a',
          name: 'Station A',
          children: [
            {
              id: 'synthetic-station-a-exercise',
              name: 'Station A exercise',
              notes: 'Keep the left hand quiet.',
              quantities: { repetitions: 12 },
              children: [],
            },
          ],
        },
        {
          id: 'synthetic-sandan-geiko',
          name: 'Sandan-geiko',
          notes: 'Move through each variation deliberately.',
          quantities: { rounds: 2 },
          children: [
            {
              id: 'synthetic-yakusoku-geiko',
              name: 'Yakusoku-geiko',
              notes: 'Keep the sequence connected.',
              children: [
                {
                  id: 'synthetic-yakusoku-men',
                  name: 'Yakusoku men',
                  notes: 'Finish each strike cleanly.',
                  quantities: { repetitions: 6 },
                  children: [],
                },
              ],
            },
            {
              id: 'synthetic-free-version',
              name: 'Free version',
              children: [
                {
                  id: 'synthetic-free-timed',
                  name: 'Free version footwork',
                  editableQuantityUnits: ['seconds'],
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
} satisfies TrainingSet;
