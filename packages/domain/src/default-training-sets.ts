import type { TrainingSet } from './types';

/**
 * Curated, built-in training sets belong here so the web and future mobile app consume one source
 * of truth. Keep each set immutable and give every step a stable id; dashboard rep overrides use
 * those step ids.
 */
export const DEFAULT_TRAINING_SETS: readonly TrainingSet[] = [];
