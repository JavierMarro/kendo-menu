declare const trainingSetIdBrand: unique symbol;

export type TrainingSetId = string & {
  readonly [trainingSetIdBrand]: true;
};

export type DrillCategory = 'kihon' | 'kirikaeshi' | 'uchikomi' | 'kakari' | 'jigeiko' | 'custom';

export type RepUnit = 'repetitions' | 'sets' | 'minutes' | 'rounds' | 'custom';

export interface TrainingStep {
  readonly id: string;
  readonly label: string;
  readonly defaultReps: number;
  readonly repUnit: RepUnit;
  readonly description?: string;
}

export interface TrainingSet {
  readonly id: TrainingSetId;
  readonly name: string;
  readonly description: string;
  readonly category: DrillCategory;
  readonly steps: readonly TrainingStep[];
  readonly isBuiltIn: boolean;
}

export type TrainingSetInput = Omit<TrainingSet, 'id' | 'isBuiltIn'>;

export interface DashboardEntry {
  readonly id: string;
  readonly trainingSetId: TrainingSetId;
  readonly repOverrides: Readonly<Record<string, number>>;
  readonly notes: string;
  readonly createdAt: string;
}

export function asTrainingSetId(value: string): TrainingSetId {
  return value as TrainingSetId;
}
