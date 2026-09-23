import { createContext, useContext } from 'react';

export interface PersistenceContextValue {
  readonly mode: 'local' | 'session';
  readonly writeFailed: boolean;
  readonly pending: boolean;
  readonly flush: () => Promise<void>;
}

export const PersistenceContext = createContext<PersistenceContextValue | null>(null);

type PersistenceStatusSnapshot = Pick<PersistenceContextValue, 'mode' | 'writeFailed' | 'pending'>;

export function getPersistenceStatusLabel({
  mode,
  writeFailed,
  pending,
}: PersistenceStatusSnapshot): string {
  if (writeFailed) {
    return 'Changes are not being saved';
  }
  if (pending) {
    return 'Saving changes';
  }

  return mode === 'session' ? 'Session only' : 'Saved on this device';
}

export function getPersistenceUpdateLabel({
  writeFailed,
  pending,
}: Pick<PersistenceContextValue, 'writeFailed' | 'pending'>): string {
  if (writeFailed) {
    return 'Not saved to this device.';
  }
  return pending ? 'Saving…' : 'Updated.';
}

export function getExplicitPersistenceUpdateLabel({
  mode,
  writeFailed,
  pending,
}: PersistenceStatusSnapshot): string {
  if (writeFailed) {
    return 'Changes are not being saved to this device.';
  }
  if (pending) {
    return 'Saving changes…';
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
