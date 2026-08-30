import { createContext, useContext } from 'react';

export interface PersistenceContextValue {
  readonly mode: 'local' | 'session';
  readonly writeFailed: boolean;
}

export const PersistenceContext = createContext<PersistenceContextValue | null>(null);

export function getPersistenceStatusLabel({ mode, writeFailed }: PersistenceContextValue): string {
  if (writeFailed) {
    return 'Changes are not being saved';
  }

  return mode === 'session' ? 'Session only' : 'Saved on this device';
}

export function getPersistenceUpdateLabel({ writeFailed }: PersistenceContextValue): string {
  return writeFailed ? 'Not saved to this device.' : 'Updated.';
}

export function getExplicitPersistenceUpdateLabel({
  mode,
  writeFailed,
}: PersistenceContextValue): string {
  if (writeFailed) {
    return 'Changes are not being saved to this device.';
  }

  return mode === 'session' ? 'Changes saved for this session.' : 'Changes saved on this device.';
}

export function usePersistenceStatus(): PersistenceContextValue {
  const value = useContext(PersistenceContext);

  if (value === null) {
    throw new Error('usePersistenceStatus must be used inside PersistenceGate.');
  }

  return value;
}
