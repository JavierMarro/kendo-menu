/**
 * Shares local persistence status and the explicit save-confirmation operation with UI pages.
 * Labels distinguish an in-memory edit from a pending or failed device write; they do not
 * claim that guest data has been uploaded to an account or synchronized elsewhere.
 */
import { createContext, useContext } from 'react';

export interface PersistenceContextValue {
  readonly mode: 'local' | 'session' | 'account';
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
  // Failure wins over pending so a stuck or rejected write cannot look like an ordinary save.
  if (writeFailed) {
    return 'Changes are not being saved';
  }
  if (pending) {
    return 'Saving changes';
  }

  if (mode === 'account') return 'Saved to this account on this device';
  return mode === 'session' ? 'Session only' : 'Saved on this device';
}

export function getPersistenceUpdateLabel({
  mode,
  writeFailed,
  pending,
}: Pick<PersistenceContextValue, 'mode' | 'writeFailed' | 'pending'>): string {
  if (writeFailed) {
    return mode === 'account'
      ? 'Not saved to this account on this device.'
      : 'Not saved to this device.';
  }
  return pending ? 'Saving…' : mode === 'account' ? 'Saved to this account.' : 'Updated.';
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

  if (mode === 'account') return 'Changes saved to this account on this device.';
  return mode === 'session' ? 'Changes saved for this session.' : 'Changes saved on this device.';
}

export function usePersistenceStatus(): PersistenceContextValue {
  const value = useContext(PersistenceContext);

  if (value === null) {
    throw new Error('usePersistenceStatus must be used inside PersistenceGate.');
  }

  return value;
}
