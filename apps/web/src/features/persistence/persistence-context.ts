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
  readonly confirmExit?: () => Promise<void>;
  readonly exitConfirmed?: boolean;
  readonly setExitConfirmed?: (confirmed: boolean) => void;
  readonly builderDirty?: boolean;
  readonly onBuilderDirtyChange?: (dirty: boolean) => void;
  readonly canEdit?: boolean;
  readonly dirty?: boolean;
  readonly saveState?: string;
  readonly save?: () => Promise<void>;
  readonly retry?: () => Promise<void>;
  readonly reload?: () => Promise<void>;
  readonly download?: () => void;
  readonly downloadAllowed?: boolean;
  readonly error?: string | null;
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
    return mode === 'account' ? 'Account save needs attention' : 'Changes are not being saved';
  }
  if (pending) {
    return mode === 'account' ? 'Saving to account' : 'Saving changes';
  }

  if (mode === 'account') return 'Account draft';
  return mode === 'session' ? 'Session only' : 'Saved on this device';
}

export function getPersistenceUpdateLabel({
  mode,
  writeFailed,
  pending,
}: Pick<PersistenceContextValue, 'mode' | 'writeFailed' | 'pending'>): string {
  if (writeFailed) {
    return mode === 'account' ? 'Account draft needs attention.' : 'Not saved to this device.';
  }
  return pending
    ? mode === 'account'
      ? 'Saving to account…'
      : 'Saving…'
    : mode === 'account'
      ? 'Account draft updated. Choose Save to account.'
      : 'Updated.';
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

  if (mode === 'account') return 'Account draft is ready. Choose Save to account to keep it.';
  return mode === 'session' ? 'Changes saved for this session.' : 'Changes saved on this device.';
}

export function usePersistenceStatus(): PersistenceContextValue {
  const value = useContext(PersistenceContext);

  if (value === null) {
    throw new Error('usePersistenceStatus must be used inside PersistenceGate.');
  }

  return value;
}

export function useOptionalPersistenceStatus(): PersistenceContextValue | null {
  return useContext(PersistenceContext);
}
