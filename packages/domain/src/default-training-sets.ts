import {
  asTrainingSetId,
  type TrainingSection,
  type TrainingSet,
  type TrainingStep,
} from './types';

function createStep(id: string, label: string, description?: string): TrainingStep {
  const step: TrainingStep = {
    id,
    label,
    defaultReps: null,
    repUnit: 'repetitions',
  };
  return description === undefined ? Object.freeze(step) : Object.freeze({ ...step, description });
}

function createSection(id: string, label: string, steps: readonly TrainingStep[]): TrainingSection {
  return Object.freeze({ id, label, steps: Object.freeze(steps) });
}

const HIGH_SCHOOL_ONLY =
  'HS-only qualification: practise this technique under qualified instruction.';

const HIGH_SCHOOL_KENDO_CLUB_DRILL: TrainingSet = Object.freeze({
  id: asTrainingSetId('high-school-kendo-club-drill'),
  name: 'High School Kendo Club Drill',
  description: 'A supplied high-school club training menu with independently editable exercises.',
  category: 'mixed',
  sections: Object.freeze([
    createSection('high-school-warm-up', 'Warm-up', [
      createStep('warm-up-stretch', 'stretch'),
      createStep('warm-up-ladder-training', 'ladder training'),
    ]),
    createSection('high-school-suburi', 'Suburi', [
      createStep('suburi-jogeburi', 'jogeburi'),
      createStep('suburi-shomen', 'shomen'),
      createStep('suburi-sayu-men', 'sayu-men'),
      createStep('suburi-matawari', 'matawari'),
      createStep('suburi-ikkyodo-one-hand', 'ikkyodo (one-hand)'),
    ]),
    createSection('high-school-footwork', 'Footwork', [
      createStep('footwork-big-step-forward-back', 'Big step (forward and backward)'),
      createStep('footwork-short-step-forward-back', 'Short step (forward and backward)'),
      createStep('footwork-hopping-left', 'Hopping on left'),
    ]),
    createSection('high-school-kihon', 'Kihon', [
      createStep('kihon-kirikaeshi-suri-ashi', 'Kirikaeshi — suri-ashi version'),
      createStep('kihon-kirikaeshi-one-breath', 'Kirikaeshi — one-breath version'),
      createStep('kihon-kirikaeshi-mutual', 'Kirikaeshi — mutual version'),
      createStep('kihon-kirikaeshi-do', 'Kirikaeshi — do-kirikaeshi version'),
      createStep('kihon-men', 'Men'),
      createStep('kihon-sashi-men', 'sashi-men'),
      createStep('kihon-kote', 'kote'),
      createStep('kihon-do', 'do'),
      createStep('kihon-morote-tsuki', 'morote-tsuki', HIGH_SCHOOL_ONLY),
      createStep('kihon-gyaku-do', 'gyaku-do'),
      createStep('kihon-kote-men', 'kote-men'),
      createStep('kihon-hiki-men', 'hiki-men'),
      createStep('kihon-katsugi', 'katsugi'),
      createStep('kihon-hiki-kote', 'hiki-kote'),
      createStep('kihon-hiki-do', 'hiki-do'),
      createStep('kihon-hiki-gyaku-do', 'hiki-gyaku-do'),
    ]),
    createSection('high-school-waza-geiko', 'Waza-geiko', [
      createStep('waza-geiko-debana-men', 'debana-men'),
      createStep('waza-geiko-debana-kote', 'debana-kote'),
      createStep('waza-geiko-men-nuki-do', 'men-nuki-do'),
      createStep('waza-geiko-men-suriage-men', 'men-suriage-men'),
      createStep('waza-geiko-ai-kote-men', 'ai-kote-men'),
      createStep('waza-geiko-kote-kaeshi-men', 'kote-kaeshi-men'),
      createStep('waza-geiko-oji-vs-kote-men', 'oji-waza vs. kote-men'),
      createStep('waza-geiko-oji-vs-hiki-men', 'oji-waza vs. hiki-men'),
      createStep('waza-geiko-oji-vs-hiki-do', 'oji-waza vs. hiki-do'),
    ]),
    createSection('high-school-oikomi-geiko', 'Oikomi-geiko', [
      createStep('oikomi-geiko-big-men', 'big men'),
      createStep('oikomi-geiko-small-men', 'small men'),
      createStep('oikomi-geiko-small-kote-men', 'small kote-men'),
      createStep('oikomi-geiko-hiki-men', 'hiki-men'),
      createStep('oikomi-geiko-kosa-men', 'kosa-men'),
      createStep('oikomi-geiko-kote-men-do-kote-men', 'kote-men-do-kote-men'),
    ]),
    createSection('high-school-ji-geiko', 'Ji-geiko', [createStep('ji-geiko', 'ji-geiko')]),
    createSection('high-school-kakari-geiko', 'Kakari-geiko', [
      createStep('kakari-geiko', 'kakari-geiko'),
    ]),
  ]),
  isBuiltIn: true,
});

/** The only curated set currently supplied for the first milestone. */
export const DEFAULT_TRAINING_SETS: readonly TrainingSet[] = Object.freeze([
  HIGH_SCHOOL_KENDO_CLUB_DRILL,
]);
