import { describe, expect, it } from 'vitest';

import researchedDrillsSource from '../data/researched-drills.json';
import separateSchemaDocument from '../schema/training-set.schema.json';
import { DEFAULT_TRAINING_SETS, type TrainingQuantityUnit, type TrainingStep } from './index';

interface SourceExercise {
  readonly name: string;
  readonly description?: string;
  readonly reps?: number;
  readonly sets?: number;
  readonly durationSeconds?: number;
  readonly rounds?: number;
}

interface SourceSection {
  readonly name: string;
  readonly exercises: readonly SourceExercise[];
}

interface SourceDrill {
  readonly name: string;
  readonly description?: string;
  readonly sections: readonly SourceSection[];
}

function getQuantity(step: TrainingStep, unit: TrainingQuantityUnit): number | null {
  const quantity = step.quantities.find((candidate) => candidate.unit === unit);
  if (quantity === undefined) {
    throw new Error(`Exercise ${step.id} is missing its ${unit} quantity.`);
  }
  return quantity.value;
}

function projectExercise(step: TrainingStep): SourceExercise {
  const repetitions = getQuantity(step, 'repetitions');
  const sets = getQuantity(step, 'sets');
  const minutes = getQuantity(step, 'minutes');
  const rounds = getQuantity(step, 'rounds');
  return {
    name: step.label,
    ...(step.description === undefined ? {} : { description: step.description }),
    ...(repetitions === null ? {} : { reps: repetitions }),
    ...(sets === null ? {} : { sets }),
    ...(minutes === null ? {} : { durationSeconds: minutes * 60 }),
    ...(rounds === null ? {} : { rounds }),
  };
}

function projectDrills(): readonly SourceDrill[] {
  return DEFAULT_TRAINING_SETS.map((trainingSet) => ({
    name: trainingSet.name,
    ...(trainingSet.description.length === 0 ? {} : { description: trainingSet.description }),
    sections: trainingSet.sections.map((section) => ({
      name: section.label,
      exercises: section.steps.map(projectExercise),
    })),
  }));
}

describe('researched drill source normalization', () => {
  it('classifies the supplied document as both a per-drill schema and 11 drill records', () => {
    expect(Object.keys(researchedDrillsSource).sort()).toEqual(['drills', 'schema']);
    expect(researchedDrillsSource.schema).toMatchObject({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['name', 'sections'],
      additionalProperties: false,
    });
    expect(researchedDrillsSource.drills).toHaveLength(11);
  });

  it('recognizes the separate document as the Draft-07 meta-schema, not a training-set schema', () => {
    expect(separateSchemaDocument).toMatchObject({
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'http://json-schema.org/draft-07/schema#',
      title: 'Core schema meta-schema',
      type: ['object', 'boolean'],
    });
  });

  it('mechanically round-trips every source term, description, and quantity', () => {
    expect(projectDrills()).toEqual(researchedDrillsSource.drills);
  });
});
