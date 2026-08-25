import {
  asTrainingSetId,
  createTrainingQuantities,
  type TrainingQuantities,
  type TrainingQuantityUnit,
  type TrainingQuantityValues,
  type TrainingSection,
  type TrainingSet,
  type TrainingStep,
} from './types';

type CuratedQuantityValues = Readonly<Partial<Record<TrainingQuantityUnit, number>>>;

interface CuratedStepInput {
  readonly id: string;
  readonly label: string;
  readonly quantities?: CuratedQuantityValues;
  readonly description?: string;
}

interface CuratedSectionInput {
  readonly id: string;
  readonly label: string;
  readonly steps: readonly CuratedStepInput[];
}

interface CuratedTrainingSetInput {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly sections: readonly CuratedSectionInput[];
}

function createCuratedQuantities(values: CuratedQuantityValues = {}): TrainingQuantities {
  const completeValues: TrainingQuantityValues = {
    repetitions: values.repetitions ?? null,
    sets: values.sets ?? null,
    minutes: values.minutes ?? null,
    rounds: values.rounds ?? null,
  };
  return Object.freeze(
    createTrainingQuantities(completeValues).map((quantity) => Object.freeze(quantity)),
  );
}

function createStep(sectionId: string, input: CuratedStepInput): TrainingStep {
  const step: TrainingStep = {
    id: `${sectionId}-${input.id}`,
    label: input.label,
    defaultReps: input.quantities?.repetitions ?? null,
    repUnit: 'repetitions',
    quantities: createCuratedQuantities(input.quantities),
  };
  return input.description === undefined
    ? Object.freeze(step)
    : Object.freeze({ ...step, description: input.description });
}

function createSection(trainingSetId: string, input: CuratedSectionInput): TrainingSection {
  const sectionId = `${trainingSetId}-${input.id}`;
  return Object.freeze({
    id: sectionId,
    label: input.label,
    steps: Object.freeze(input.steps.map((step) => createStep(sectionId, step))),
  });
}

function createTrainingSet(input: CuratedTrainingSetInput): TrainingSet {
  return Object.freeze({
    id: asTrainingSetId(input.id),
    name: input.name,
    description: input.description,
    category: 'unspecified',
    sections: Object.freeze(input.sections.map((section) => createSection(input.id, section))),
    isBuiltIn: true,
  });
}

const CURATED_TRAINING_SET_INPUTS = [
  {
    id: 'international-dojo-2-hour-session',
    name: 'International dojo (2 hour session)',
    description: '',
    sections: [
      {
        id: 'warm-up',
        label: 'Warm-up',
        steps: [{ id: 'warm-up', label: 'Warm-up', quantities: { minutes: 600 / 60 } }],
      },
      {
        id: 'suburi',
        label: 'Suburi',
        steps: [{ id: 'suburi', label: 'Suburi', quantities: { minutes: 900 / 60 } }],
      },
      {
        id: 'ashi-sabaki',
        label: 'Ashi sabaki',
        steps: [{ id: 'ashi-sabaki', label: 'Ashi sabaki', quantities: { minutes: 600 / 60 } }],
      },
      {
        id: 'kirikaeshi',
        label: 'Kirikaeshi',
        steps: [{ id: 'kirikaeshi', label: 'Kirikaeshi', quantities: { repetitions: 5 } }],
      },
      {
        id: 'kihon-waza',
        label: 'Kihon-waza',
        steps: [
          { id: 'men', label: 'men', quantities: { repetitions: 4 } },
          { id: 'kote', label: 'kote', quantities: { repetitions: 4 } },
          { id: 'do', label: 'do', quantities: { repetitions: 4 } },
          { id: 'tsuki', label: 'tsuki', quantities: { repetitions: 4 } },
        ],
      },
      {
        id: 'uchikomi',
        label: 'Uchikomi',
        steps: [
          { id: 'men-1', label: 'men', quantities: { repetitions: 5 } },
          { id: 'kote', label: 'kote', quantities: { repetitions: 5 } },
          { id: 'kote-men', label: 'kote-men', quantities: { repetitions: 5 } },
          { id: 'men-2', label: 'men', quantities: { repetitions: 5 } },
        ],
      },
      {
        id: 'shikake-waza',
        label: 'Shikake-waza',
        steps: [
          { id: 'men', label: 'men', quantities: { repetitions: 3 } },
          { id: 'kote', label: 'kote', quantities: { repetitions: 3 } },
          { id: 'do', label: 'do', quantities: { repetitions: 3 } },
        ],
      },
      {
        id: 'oji-waza',
        label: 'Oji-waza',
        steps: [
          { id: 'kaeshi-do', label: 'kaeshi do', quantities: { repetitions: 3 } },
          { id: 'kaeshi-men', label: 'kaeshi men', quantities: { repetitions: 3 } },
        ],
      },
      {
        id: 'hiki-waza',
        label: 'Hiki-waza',
        steps: [
          { id: 'hiki-men', label: 'hiki men', quantities: { repetitions: 3 } },
          { id: 'hiki-kote', label: 'hiki kote', quantities: { repetitions: 3 } },
          { id: 'hiki-do', label: 'hiki do', quantities: { repetitions: 3 } },
        ],
      },
      {
        id: 'butsukarigeiko',
        label: 'Butsukarigeiko',
        steps: [
          {
            id: 'butsukarigeiko',
            label: 'Butsukarigeiko',
            quantities: { minutes: 300 / 60 },
          },
        ],
      },
      {
        id: 'kakarigeiko',
        label: 'Kakarigeiko',
        steps: [
          {
            id: 'kakarigeiko',
            label: 'Kakarigeiko',
            quantities: { minutes: 60 / 60, rounds: 10 },
          },
        ],
      },
      {
        id: 'jigeiko',
        label: 'Jigeiko',
        steps: [
          {
            id: 'jigeiko',
            label: 'Jigeiko',
            quantities: { minutes: 120 / 60, rounds: 10 },
          },
        ],
      },
    ],
  },
  {
    id: 'japanese-school-club',
    name: 'Japanese school club',
    description: '',
    sections: [
      { id: 'warm-up', label: 'warm-up', steps: [{ id: 'warm-up', label: 'warm-up' }] },
      {
        id: 'suburi',
        label: 'suburi',
        steps: [
          { id: 'joge', label: 'jōge' },
          { id: 'shomen', label: 'shōmen' },
          { id: 'sayu-men', label: 'sayū-men' },
          { id: 'haya', label: 'haya' },
        ],
      },
      {
        id: 'ashi-sabaki',
        label: 'Ashi sabaki',
        steps: [{ id: 'ashi-sabaki', label: 'Ashi sabaki' }],
      },
      {
        id: 'kirikaeshi-1',
        label: 'Kirikaeshi',
        steps: [{ id: 'kirikaeshi', label: 'Kirikaeshi' }],
      },
      {
        id: 'kihon-waza',
        label: 'Kihon-waza',
        steps: [{ id: 'kihon-waza', label: 'Kihon-waza' }],
      },
      {
        id: 'oji-waza',
        label: 'Oji-waza',
        steps: [
          { id: 'ai-men', label: 'ai-men' },
          { id: 'men-suriage-men', label: 'men-suriage-men' },
          { id: 'debana-kote', label: 'debana kote' },
          { id: 'nuki-do', label: 'nuki-dō' },
          { id: 'kaeshi-do', label: 'kaeshi-dō' },
          { id: 'kote-suriage-men', label: 'kote-suriage-men' },
          { id: 'kote-kaeshi-men', label: 'kote-kaeshi-men' },
          { id: 'ai-kote-men', label: 'ai-kote-men' },
          { id: 'kote-nuki-men', label: 'kote-nuki-men' },
        ],
      },
      { id: 'jigeiko', label: 'jigeiko', steps: [{ id: 'jigeiko', label: 'jigeiko' }] },
      {
        id: 'hikiwaza',
        label: 'hikiwaza',
        steps: [
          { id: 'hiki-men', label: 'hiki men' },
          { id: 'hiki-kote', label: 'hiki kote' },
          { id: 'hiki-do', label: 'hiki do' },
        ],
      },
      {
        id: 'kakarigeiko',
        label: 'kakarigeiko',
        steps: [{ id: 'kakarigeiko', label: 'kakarigeiko' }],
      },
      {
        id: 'ai-kakarigeiko',
        label: 'ai kakarigeiko',
        steps: [{ id: 'ai-kakarigeiko', label: 'ai kakarigeiko' }],
      },
      {
        id: 'kirikaeshi-2',
        label: 'kirikaeshi',
        steps: [{ id: 'kirikaeshi', label: 'kirikaeshi' }],
      },
    ],
  },
  {
    id: 'junior-high-kendo-club',
    name: 'Junior-high kendo club',
    description: '',
    sections: [
      {
        id: 'suburi',
        label: 'Suburi',
        steps: [
          { id: 'joge', label: 'jōge', quantities: { repetitions: 50 } },
          { id: 'shomen', label: 'shōmen', quantities: { repetitions: 50 } },
          { id: 'fumikomi', label: 'fumikomi', quantities: { repetitions: 50 } },
          { id: 'sayu-men', label: 'sayū-men', quantities: { repetitions: 50 } },
          { id: 'taisabaki-joge', label: 'taisabaki-jōge', quantities: { repetitions: 50 } },
          { id: 'haya', label: 'haya', quantities: { repetitions: 100, sets: 2 } },
        ],
      },
      {
        id: 'men-kirikaeshi',
        label: 'Men-kirikaeshi',
        steps: [{ id: 'men-kirikaeshi', label: 'Men-kirikaeshi', quantities: { repetitions: 3 } }],
      },
      {
        id: 'do-kirikaeshi',
        label: 'dō-kirikaeshi',
        steps: [{ id: 'do-kirikaeshi', label: 'dō-kirikaeshi', quantities: { repetitions: 3 } }],
      },
      {
        id: 'ai-kirikaeshi',
        label: 'ai kirikaeshi',
        steps: [{ id: 'ai-kirikaeshi', label: 'ai kirikaeshi', quantities: { repetitions: 3 } }],
      },
      {
        id: 'kihon-waza',
        label: 'Kihon-waza',
        steps: [
          { id: 'big-men', label: 'big men', quantities: { repetitions: 5, sets: 4 } },
          {
            id: 'big-kote-men',
            label: 'big kote-men',
            quantities: { repetitions: 5, sets: 4 },
          },
        ],
      },
      {
        id: 'match-speed-strikes',
        label: 'Match-speed strikes',
        steps: [
          { id: 'men', label: 'men', quantities: { repetitions: 5, sets: 2 } },
          { id: 'kote', label: 'kote', quantities: { repetitions: 5, sets: 2 } },
          { id: 'do', label: 'dō', quantities: { repetitions: 5, sets: 2 } },
          { id: 'kote-men', label: 'kote-men', quantities: { repetitions: 5, sets: 2 } },
          { id: 'kote-do', label: 'kote-dō', quantities: { repetitions: 5, sets: 2 } },
        ],
      },
      {
        id: 'kakarigeiko',
        label: 'Kakarigeiko',
        steps: [
          {
            id: 'kakarigeiko',
            label: 'Kakarigeiko',
            quantities: { minutes: 20 / 60, rounds: 30 },
          },
        ],
      },
      {
        id: 'jigeiko',
        label: 'Jigeiko',
        steps: [{ id: 'jigeiko', label: 'Jigeiko', quantities: { minutes: 180 / 60 } }],
      },
    ],
  },
  {
    id: 'official-znkr-ajkf',
    name: 'Official ZNKR/AJKF',
    description:
      'Officially published by the All Japan Kendo Federation in 2001, for nidan and below, focused on basics.',
    sections: [
      { id: 'warm-up', label: 'Warm-up', steps: [{ id: 'warm-up', label: 'Warm-up' }] },
      {
        id: 'kihon-waza',
        label: 'Kihon-waza',
        steps: [
          { id: 'men', label: 'Men' },
          { id: 'kote', label: 'Kote' },
          { id: 'do', label: 'Dō' },
          { id: 'tsuki', label: 'Tsuki' },
        ],
      },
      {
        id: 'renzoku-waza',
        label: 'Renzoku-waza',
        steps: [{ id: 'kote-men', label: 'Kote-men' }],
      },
      {
        id: 'shikake-waza',
        label: 'Shikake-waza',
        steps: [
          { id: 'harai-men', label: 'Harai-men' },
          { id: 'debana-kote', label: 'Debana-kote' },
        ],
      },
      { id: 'hiki-waza', label: 'Hiki-waza', steps: [{ id: 'hiki-do', label: 'Hiki-dō' }] },
      {
        id: 'oji-waza',
        label: 'Oji-waza',
        steps: [
          { id: 'men-nuki-do', label: 'Men-nuki-dō' },
          { id: 'kote-suriage-men', label: 'Kote-suriage-men' },
          { id: 'men-kaeshi-do', label: 'Men-kaeshi-dō' },
          { id: 'do-uchiotoshi-men', label: 'Dō-uchiotoshi-men' },
        ],
      },
    ],
  },
  {
    id: 'police-dojo-asageiko',
    name: 'Police dojo asageiko',
    description: 'Practiced with mostly 5th–8th dan practitioners',
    sections: [
      {
        id: 'warm-up',
        label: 'Warm-up',
        steps: [{ id: 'warm-up', label: 'Warm-up', quantities: { minutes: 600 / 60 } }],
      },
      {
        id: 'kirikaeshi-1',
        label: 'Kirikaeshi',
        steps: [{ id: 'kirikaeshi', label: 'Kirikaeshi', quantities: { repetitions: 5 } }],
      },
      {
        id: 'kihon-waza',
        label: 'Kihon-waza',
        steps: [
          { id: 'men', label: 'Men', quantities: { repetitions: 3, sets: 3 } },
          { id: 'kote', label: 'Kote', quantities: { repetitions: 3, sets: 3 } },
          { id: 'kote-men', label: 'Kote-men', quantities: { repetitions: 3, sets: 3 } },
          {
            id: 'moshiawase-kakarite-s-choice',
            label: "Moshiawase (kakarite's choice)",
            quantities: { repetitions: 3, sets: 3 },
          },
        ],
      },
      {
        id: 'uchikomi',
        label: 'Uchikomi',
        steps: [{ id: 'men', label: 'Men', quantities: { repetitions: 5, sets: 2 } }],
      },
      {
        id: 'kirikaeshi-2',
        label: 'Kirikaeshi',
        steps: [{ id: 'kirikaeshi', label: 'Kirikaeshi', quantities: { repetitions: 1 } }],
      },
    ],
  },
  {
    id: 'police-dojo-asageiko-version-2',
    name: 'Police dojo asageiko version 2',
    description: '',
    sections: [
      {
        id: 'kirikaeshi-1',
        label: 'Kirikaeshi',
        steps: [
          {
            id: 'kirikaeshi',
            label: 'Kirikaeshi',
            quantities: { sets: 3 },
            description: '3 men + 1 full kirikaeshi',
          },
        ],
      },
      {
        id: 'renzoku-waza',
        label: 'Renzoku-waza',
        steps: [
          { id: 'big-men', label: 'big men', quantities: { repetitions: 3, sets: 3 } },
          { id: 'small-men', label: 'small men', quantities: { repetitions: 3, sets: 3 } },
        ],
      },
      {
        id: 'kihon-waza',
        label: 'Kihon-waza',
        steps: [
          {
            id: 'small-men-1',
            label: 'small men',
            quantities: { repetitions: 3, sets: 3 },
            description: 'Motodachi steps back, kakarite steps in and strikes',
          },
          {
            id: 'small-men-2',
            label: 'Small men',
            quantities: { repetitions: 3, sets: 3 },
          },
          {
            id: 'small-men-3',
            label: 'small men',
            quantities: { repetitions: 3, sets: 3 },
            description: 'Motodachi steps in, kakarite strikes immediately',
          },
          { id: 'kote', label: 'Kote', quantities: { repetitions: 3, sets: 2 } },
          { id: 'kote-men', label: 'Kote-men', quantities: { repetitions: 3, sets: 2 } },
          {
            id: 'katate-kote-morote-men',
            label: 'katate-kote → morote-men',
            quantities: { repetitions: 3, sets: 1 },
            description: 'From jodan',
          },
        ],
      },
      {
        id: 'moshiawase-oji-waza',
        label: 'Moshiawase oji-waza',
        steps: [
          { id: 'men', label: 'Men', quantities: { repetitions: 3, sets: 2 } },
          { id: 'kote', label: 'Kote', quantities: { repetitions: 3, sets: 2 } },
          {
            id: 'men-oji-waza-vs-jodan',
            label: 'Men oji-waza vs. jodan',
            quantities: { repetitions: 3, sets: 2 },
          },
          {
            id: 'kote-oji-waza-vs-jodan',
            label: 'Kote oji-waza vs. jodan',
            quantities: { repetitions: 3, sets: 2 },
          },
        ],
      },
      {
        id: 'mawari-geiko',
        label: 'Mawari-geiko',
        steps: [{ id: 'mawari-geiko', label: 'Mawari-geiko' }],
      },
      {
        id: 'kirikaeshi-2',
        label: 'Kirikaeshi',
        steps: [{ id: 'kirikaeshi', label: 'Kirikaeshi' }],
      },
    ],
  },
  {
    id: 'senior-high-school-kendo-club',
    name: 'Senior High School kendo club',
    description: '',
    sections: [
      {
        id: 'warm-up',
        label: 'Warm-up',
        steps: [
          { id: 'stretch', label: 'stretch' },
          { id: 'ladder-training', label: 'ladder training' },
        ],
      },
      {
        id: 'suburi',
        label: 'Suburi',
        steps: [
          { id: 'joge', label: 'joge' },
          { id: 'shomen', label: 'shomen' },
          { id: 'sayu-men', label: 'sayu-men' },
          { id: 'matawari', label: 'matawari' },
          { id: 'fumikomi', label: 'fumikomi' },
          { id: 'ikkyodo-one-hand', label: 'ikkyodo (one-hand)' },
        ],
      },
      {
        id: 'ashi-sabaki',
        label: 'Ashi sabaki',
        steps: [
          {
            id: 'suri-ashi-drills',
            label: 'suri-ashi drills',
            description: 'with and without shinai',
          },
        ],
      },
      {
        id: 'suri-ash-kirikaeshi',
        label: 'Suri-ash-kirikaeshi',
        steps: [{ id: 'suri-ash-kirikaeshi', label: 'Suri-ash-kirikaeshi' }],
      },
      {
        id: 'one-breath-kirikaeshi',
        label: 'one-breath-kirikaeshi',
        steps: [{ id: 'one-breath-kirikaeshi', label: 'one-breath-kirikaeshi' }],
      },
      {
        id: 'ai-kirikaeshi',
        label: 'ai kirikaeshi',
        steps: [{ id: 'ai-kirikaeshi', label: 'ai kirikaeshi' }],
      },
      {
        id: 'do-kirikaeshi',
        label: 'do-kirikaeshi',
        steps: [{ id: 'do-kirikaeshi', label: 'do-kirikaeshi' }],
      },
      {
        id: 'kihon-waza',
        label: 'Kihon-waza',
        steps: [
          { id: 'men', label: 'Men' },
          { id: 'sashi-men', label: 'sashi-men' },
          { id: 'kote', label: 'kote' },
          { id: 'do', label: 'do' },
          { id: 'morote-tsuki', label: 'morote-tsuki' },
          { id: 'gyaku-do', label: 'gyaku-do' },
          { id: 'kote-men', label: 'kote-men' },
        ],
      },
      {
        id: 'hiki-waza',
        label: 'Hiki-waza',
        steps: [
          { id: 'hiki-men', label: 'hiki-men' },
          { id: 'hiki-kote', label: 'hiki-kote' },
          { id: 'hiki-do', label: 'hiki-do' },
          { id: 'hiki-gyaku-do', label: 'hiki-gyaku-do' },
        ],
      },
      {
        id: 'waza-geiko',
        label: 'Waza-geiko',
        steps: [
          { id: 'debana-men', label: 'debana-men' },
          { id: 'debana-kote', label: 'debana-kote' },
          { id: 'men-nuki-do', label: 'men-nuki-do' },
          { id: 'men-suriage-men', label: 'men-suriage-men' },
          { id: 'ai-kote-men', label: 'ai-kote-men' },
          { id: 'kote-kaeshi-men', label: 'kote-kaeshi-men' },
        ],
      },
      {
        id: 'oikomi-geiko',
        label: 'Oikomi-geiko',
        steps: [
          { id: 'big-men', label: 'big men' },
          { id: 'small-men', label: 'small men' },
          { id: 'kote-men', label: 'kote-men' },
          { id: 'hiki-men', label: 'hiki-men' },
          { id: 'kote-men-do-kote-men', label: 'kote-men-do-kote-men' },
        ],
      },
      {
        id: 'pattern-geiko',
        label: 'Pattern-geiko',
        steps: [{ id: 'pattern-geiko', label: 'Pattern-geiko' }],
      },
      {
        id: 'jigeiko',
        label: 'jigeiko',
        steps: [{ id: 'jigeiko', label: 'jigeiko', quantities: { minutes: 180 / 60 } }],
      },
      {
        id: 'kakarigeiko',
        label: 'kakarigeiko',
        steps: [{ id: 'kakarigeiko', label: 'kakarigeiko' }],
      },
      {
        id: 'core-strength-training',
        label: 'Core/strength training',
        steps: [
          {
            id: 'core-strength-training',
            label: 'Core/strength training',
            description: 'seasonal',
          },
        ],
      },
    ],
  },
  {
    id: 'university-high-school',
    name: 'University High School',
    description:
      "Weekly rotation: Monday is cleaning and self-directed practice; Tuesday centers on their own muscle circuit training ('Ken-tore') with bogu on; Wednesday is a no-bogu day of running/stair sprints plus suburi and suri-ashi in the dojo; Thursday is kihon and waza-geiko plus ji-geiko; Friday is kihon plus match-simulation practice; weekends are tournaments or practice matches, defaulting to normal kihon/waza/Ken-tore when there are none.",
    sections: [
      {
        id: 'kirikaeshi',
        label: 'Kirikaeshi',
        steps: [
          { id: '5-men-kirikaeshi', label: '5-men + kirikaeshi' },
          { id: '5-tsuki-kirikaeshi', label: '5-tsuki+kirikaeshi' },
          { id: 'fast-kirikaeshi', label: 'fast kirikaeshi' },
          { id: 'one-breath-kirikaeshi', label: 'one-breath kirikaeshi' },
          { id: 'ai-kirikaeshi', label: 'ai kirikaeshi' },
        ],
      },
      {
        id: 'kihon-waza',
        label: 'Kihon waza',
        steps: [
          { id: 'big-men', label: 'big men' },
          { id: 'small-men', label: 'small men' },
          { id: 'seme-ashi-men', label: 'seme ashi men' },
          { id: 'seme-men', label: 'seme men' },
          { id: 'kote', label: 'kote', description: 'above/below/omote/ura' },
          { id: 'tsuki', label: 'tsuki', description: 'omote/ura' },
          { id: 'do', label: 'do' },
          { id: 'gyaku-do', label: 'gyaku-do' },
        ],
      },
      {
        id: 'renzoku-waza',
        label: 'Renzoku-waza',
        steps: [
          { id: 'kote-men', label: 'kote-men' },
          { id: 'kote-do', label: 'kote-do' },
          { id: 'tsuki-men', label: 'tsuki-men' },
          { id: 'tsuki-kote', label: 'tsuki-kote' },
        ],
      },
      {
        id: 'ken-tore-circuit',
        label: 'Ken-tore circuit',
        steps: [
          {
            id: 'kirikaeshi',
            label: 'kirikaeshi',
            quantities: { sets: 3, minutes: 30 / 60 },
          },
          {
            id: 'hayasuburi',
            label: 'hayasuburi',
            quantities: { sets: 3, minutes: 30 / 60 },
          },
          {
            id: 'stationary-kote-men',
            label: 'stationary kote-men',
            quantities: { sets: 3, minutes: 30 / 60 },
          },
          {
            id: 'left-right-do-kirikaeshi',
            label: 'left-right do-kirikaeshi',
            quantities: { sets: 3, minutes: 30 / 60 },
          },
          { id: 'men', label: 'men', quantities: { sets: 3, minutes: 30 / 60 } },
          { id: 'kote', label: 'kote', quantities: { sets: 3, minutes: 30 / 60 } },
          { id: 'kote-men', label: 'kote-men', quantities: { sets: 3, minutes: 30 / 60 } },
          { id: 'do', label: 'do', quantities: { sets: 3, minutes: 30 / 60 } },
        ],
      },
    ],
  },
  {
    id: 'junior-high-school-version-2',
    name: 'Junior High School version 2',
    description: '',
    sections: [
      { id: 'warm-up', label: 'warm-up', steps: [{ id: 'warm-up', label: 'warm-up' }] },
      {
        id: 'suburi',
        label: 'Suburi',
        steps: [
          { id: 'sankyodo-shomen', label: 'sankyodo-shomen', quantities: { repetitions: 100 } },
          { id: 'sayu-men', label: 'sayu-men', quantities: { repetitions: 100 } },
          {
            id: 'shomen-2-step-4-directions',
            label: 'shomen 2-step 4-directions',
            quantities: { repetitions: 100 },
          },
          {
            id: 'sayu-2-step-8-directions',
            label: 'sayu 2-step 8-directions',
            quantities: { repetitions: 100 },
          },
          {
            id: 'zenshin-kotae-shomen',
            label: 'zenshin-kotae shomen',
            quantities: { repetitions: 100 },
          },
          {
            id: 'hayasuburi',
            label: 'hayasuburi',
            quantities: { repetitions: 100, sets: 3 },
          },
        ],
      },
      {
        id: 'ashi-sabaki',
        label: 'Ashi sabaki',
        steps: [
          { id: 'one-step-advances', label: 'one-step advances' },
          { id: 'position-swap-suri-ashi', label: 'position-swap suri-ashi' },
          { id: 'one-leg-suburi', label: 'one-leg suburi' },
          { id: '3-direction-fumikomi', label: '3-direction fumikomi' },
          { id: 'fumikomi-into-strike-drills', label: 'fumikomi-into-strike drills' },
        ],
      },
      {
        id: 'mawarigeiko',
        label: 'Mawarigeiko',
        steps: [{ id: 'mawarigeiko', label: 'Mawarigeiko' }],
      },
    ],
  },
  {
    id: 'university-version-2',
    name: 'University version 2',
    description: '',
    sections: [
      { id: 'warm-up', label: 'Warm-up', steps: [{ id: 'warm-up', label: 'Warm-up' }] },
      { id: 'suburi', label: 'Suburi', steps: [{ id: 'suburi', label: 'Suburi' }] },
      {
        id: 'ashi-sabaki',
        label: 'Ashi sabaki',
        steps: [{ id: 'ashi-sabaki', label: 'Ashi sabaki' }],
      },
      {
        id: 'dojo-length-drills',
        label: 'Dojo-length drills',
        steps: [
          { id: 'slow-kirikaeshi', label: 'slow kirikaeshi', quantities: { repetitions: 2 } },
          { id: 'kirikaeshi', label: 'kirikaeshi', quantities: { repetitions: 2 } },
          {
            id: 'kirikaeshi-suriashi',
            label: 'kirikaeshi + suriashi',
            quantities: { repetitions: 2 },
          },
        ],
      },
      {
        id: 'oikomi-geiko',
        label: 'Oikomi-geiko',
        steps: [
          { id: 'men', label: 'men', quantities: { repetitions: 3 } },
          { id: 'kote-men', label: 'kote-men', quantities: { repetitions: 3 } },
        ],
      },
      {
        id: 'kihon-waza',
        label: 'kihon-waza',
        steps: [
          { id: 'men', label: 'men' },
          { id: 'kote', label: 'kote' },
          { id: 'do', label: 'do' },
          { id: 'tsuki', label: 'tsuki' },
        ],
      },
      {
        id: 'shikake-waza',
        label: 'shikake-waza',
        steps: [
          { id: 'men', label: 'men', quantities: { repetitions: 2 } },
          { id: 'kote', label: 'kote', quantities: { repetitions: 2 } },
          { id: 'do', label: 'do', quantities: { repetitions: 2 } },
        ],
      },
      {
        id: 'debana-waza',
        label: 'debana-waza',
        steps: [
          { id: 'debana-men', label: 'debana men', quantities: { repetitions: 3 } },
          { id: 'debana-kote', label: 'debana kote', quantities: { repetitions: 3 } },
        ],
      },
      {
        id: 'hiki-waza',
        label: 'hiki-waza',
        steps: [
          { id: 'hiki-men', label: 'hiki men', quantities: { repetitions: 4 } },
          { id: 'hiki-kote', label: 'hiki kote', quantities: { repetitions: 4 } },
          { id: 'hiki-do', label: 'hiki do', quantities: { repetitions: 4 } },
        ],
      },
      {
        id: 'jigeiko',
        label: 'jigeiko',
        steps: [{ id: 'jigeiko', label: 'jigeiko', quantities: { minutes: 600 / 60 } }],
      },
      {
        id: 'kakarigeijo',
        label: 'kakarigeijo',
        steps: [{ id: 'kakarigeijo', label: 'kakarigeijo', quantities: { minutes: 300 / 60 } }],
      },
      {
        id: 'shiaigeiko',
        label: 'shiaigeiko',
        steps: [{ id: 'shiaigeiko', label: 'shiaigeiko', quantities: { minutes: 600 / 60 } }],
      },
    ],
  },
  {
    id: 'top-university',
    name: 'Top university',
    description: '',
    sections: [
      { id: 'warm-up', label: 'Warm-up', steps: [{ id: 'warm-up', label: 'Warm-up' }] },
      {
        id: 'sandan-geiko',
        label: 'Sandan geiko',
        steps: [
          {
            id: 'kirikaeshi',
            label: 'Kirikaeshi',
            description: '50/40/30 pattern or 100/100/100 pattern',
          },
        ],
      },
      {
        id: 'yakusoku-geiko',
        label: 'Yakusoku-geiko',
        steps: [
          { id: 'men-kote', label: 'Men → Kote' },
          {
            id: 'men-kukan-datotsu-men',
            label: 'Men → Kukan-datotsu-men',
            description: 'striking through empty space',
          },
          {
            id: 'men-kote-men-taiatari',
            label: 'Men → Kote-Men → Taiatari',
            description: 'body contact',
          },
          {
            id: 'hiki-do-men-kirikaeshi',
            label: 'Hiki-dō → Men → Kirikaeshi',
            description: '50 or 100',
          },
        ],
      },
      {
        id: 'fee-version',
        label: 'Fee version',
        steps: [
          {
            id: 'uchikomi-geiko',
            label: 'Uchikomi-geiko',
            description:
              'A method of keiko in which one learns basic striking techniques by responding to striking opportunities provided by the motodachi (instructor). Motodachi-focused.',
          },
          {
            id: 'kakari-geiko',
            label: 'Kakari-geiko',
            description:
              'A method in which the trainee, for a short time, strikes the motodachi with full energy using all techniques learned, without hesitation or concern about being struck. Kakarite-focused.',
          },
        ],
      },
      {
        id: 'kubun-geiko',
        label: 'Kubun-geiko',
        steps: [
          {
            id: 'uchikomi-men-only',
            label: 'Uchikomi (Men only)',
            description: '1st person, 30/60 seconds',
          },
          {
            id: 'kakari-geiko',
            label: 'Kakari-geiko',
            description: '2nd person, 30/60 seconds',
          },
          {
            id: 'kirikaeshi',
            label: 'Kirikaeshi',
            description: '3rd person, 30/60 seconds',
          },
        ],
      },
      {
        id: 'jigeiko',
        label: 'Jigeiko',
        steps: [{ id: 'jigeiko', label: 'Jigeiko', quantities: { minutes: 120 / 60 } }],
      },
      {
        id: 'kakarigeiko',
        label: 'Kakarigeiko',
        steps: [{ id: 'kakarigeiko', label: 'Kakarigeiko' }],
      },
    ],
  },
] as const satisfies readonly CuratedTrainingSetInput[];

export const DEFAULT_TRAINING_SETS: readonly TrainingSet[] = Object.freeze(
  CURATED_TRAINING_SET_INPUTS.map(createTrainingSet),
);
