import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { createTrainingStore } from '@kendo-menu/store';

import { PersistenceContext } from './persistence-context';
import {
  createBrowserTrainingStorage,
  createMemoryTrainingStorage,
  downloadRawTrainingBackup,
  inspectBrowserTrainingStorage,
  resetBrowserTrainingStorage,
  TRAINING_STORAGE_KEY,
  type PersistenceInspection,
} from '../../lib/training-persistence';
import { TrainingStoreProvider } from '../../lib/training-store-provider';

// Compatibility exports keep existing provider test utilities stable while the context lives separately.
/* eslint-disable-next-line react-refresh/only-export-components */
export { PersistenceContext, usePersistenceStatus } from './persistence-context';
export type { PersistenceContextValue } from './persistence-context';

type TrainingStoreHook = ReturnType<typeof createTrainingStore>;

interface PersistenceGateProps {
  readonly children: ReactNode;
}

export function PersistenceGate({ children }: PersistenceGateProps) {
  const [inspection, setInspection] = useState<PersistenceInspection>(() =>
    inspectBrowserTrainingStorage(TRAINING_STORAGE_KEY),
  );
  const [sessionOnly, setSessionOnly] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  const [runtimeUnavailable, setRuntimeUnavailable] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const onWriteError = useCallback(() => {
    setWriteFailed(true);
  }, []);
  const onReadError = useCallback(() => {
    window.setTimeout(() => {
      const nextInspection = inspectBrowserTrainingStorage(TRAINING_STORAGE_KEY);
      setInspection(nextInspection);
      setRuntimeUnavailable(nextInspection.status === 'empty' || nextInspection.status === 'ready');
    }, 0);
  }, []);

  const store = useMemo<TrainingStoreHook | null>(() => {
    if (sessionOnly || inspection.status === 'empty' || inspection.status === 'ready') {
      try {
        const storage = sessionOnly
          ? createMemoryTrainingStorage()
          : createBrowserTrainingStorage({ onReadError, onWriteError });

        return createTrainingStore({
          storage,
          storageKey: TRAINING_STORAGE_KEY,
          onHydrationError: onReadError,
        });
      } catch {
        onReadError();
        return null;
      }
    }

    return null;
  }, [inspection, onReadError, onWriteError, sessionOnly]);

  const retry = useCallback(() => {
    setBackupError(null);
    setResetError(null);
    setWriteFailed(false);
    setRuntimeUnavailable(false);
    setSessionOnly(false);
    setInspection(inspectBrowserTrainingStorage(TRAINING_STORAGE_KEY));
  }, []);

  const continueWithoutSaving = useCallback(() => {
    setBackupError(null);
    setResetError(null);
    setWriteFailed(false);
    setRuntimeUnavailable(false);
    setSessionOnly(true);
  }, []);

  const resetLocalData = useCallback(() => {
    try {
      resetBrowserTrainingStorage(TRAINING_STORAGE_KEY);
      setConfirmReset(false);
      setBackupError(null);
      setResetError(null);
      setSessionOnly(false);
      setRuntimeUnavailable(false);
      setInspection(inspectBrowserTrainingStorage(TRAINING_STORAGE_KEY));
    } catch {
      setConfirmReset(false);
      setResetError('KendoMenu could not remove the local data. Nothing was changed.');
    }
  }, []);

  const downloadBackup = useCallback(() => {
    setBackupError(null);
    if (!('raw' in inspection)) {
      return;
    }

    try {
      downloadRawTrainingBackup(inspection.raw);
    } catch {
      setBackupError(
        'KendoMenu could not download the backup. Your local data has not been changed.',
      );
    }
  }, [inspection]);

  if (store !== null && !runtimeUnavailable) {
    return (
      <PersistenceContext.Provider value={{ mode: sessionOnly ? 'session' : 'local', writeFailed }}>
        <TrainingStoreProvider store={store}>{children}</TrainingStoreProvider>
      </PersistenceContext.Provider>
    );
  }

  return (
    <PersistenceRecovery
      inspection={
        runtimeUnavailable
          ? { status: 'unavailable', reason: 'The browser did not allow local data access.' }
          : inspection
      }
      confirmReset={confirmReset}
      backupError={backupError}
      resetError={resetError}
      onConfirmReset={() => setConfirmReset(true)}
      onCancelReset={() => setConfirmReset(false)}
      onDownload={downloadBackup}
      onReset={resetLocalData}
      onRetry={retry}
      onContinueWithoutSaving={continueWithoutSaving}
    />
  );
}

interface PersistenceRecoveryProps {
  readonly inspection: PersistenceInspection;
  readonly confirmReset: boolean;
  readonly backupError: string | null;
  readonly resetError: string | null;
  readonly onConfirmReset: () => void;
  readonly onCancelReset: () => void;
  readonly onDownload: () => void;
  readonly onReset: () => void;
  readonly onRetry: () => void;
  readonly onContinueWithoutSaving: () => void;
}

function PersistenceRecovery({
  inspection,
  confirmReset,
  backupError,
  resetError,
  onConfirmReset,
  onCancelReset,
  onDownload,
  onReset,
  onRetry,
  onContinueWithoutSaving,
}: PersistenceRecoveryProps) {
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const resetDialogRef = useRef<HTMLDialogElement>(null);
  const cancelResetRef = useRef<HTMLButtonElement>(null);
  const hadOpenResetDialog = useRef(false);
  const hasRawBackup = 'raw' in inspection;
  const isUnavailable = inspection.status === 'unavailable';
  const isFuture = inspection.status === 'future-version';

  useEffect(() => {
    if (confirmReset) {
      const dialog = resetDialogRef.current;
      if (dialog !== null && !dialog.open) {
        if (typeof dialog.showModal === 'function') {
          dialog.showModal();
        } else {
          dialog.setAttribute('open', '');
        }
      }
      hadOpenResetDialog.current = true;
      cancelResetRef.current?.focus();
      return;
    }

    const dialog = resetDialogRef.current;
    if (dialog?.open) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    }
    if (hadOpenResetDialog.current) {
      resetTriggerRef.current?.focus();
      hadOpenResetDialog.current = false;
    }
  }, [confirmReset]);

  return (
    <main className="recovery-page" aria-labelledby="persistence-title">
      <section className="recovery-card">
        <p className="eyebrow">Local data check</p>
        <h1 id="persistence-title">
          {isUnavailable
            ? 'KendoMenu cannot access local data.'
            : isFuture
              ? 'This local data needs a newer KendoMenu.'
              : 'We couldn’t read your local KendoMenu data.'}
        </h1>

        {isUnavailable ? (
          <p>
            The browser did not allow KendoMenu to read or save local data. Try again, or continue
            for this session without saving changes.
          </p>
        ) : isFuture ? (
          <p>
            This data was saved by a newer version of KendoMenu. It has not been changed. Update
            KendoMenu and try again before resetting anything.
          </p>
        ) : (
          <p>
            The stored data may be damaged. Your stored data has not been changed, and KendoMenu
            will not replace it silently.
          </p>
        )}

        {inspection.status === 'corrupt' ? (
          <p className="recovery-detail">Reason: {inspection.reason}</p>
        ) : null}
        {inspection.status === 'future-version' ? (
          <p className="recovery-detail">Stored version: {inspection.version}</p>
        ) : null}
        {backupError !== null ? (
          <p className="form-error" role="alert">
            {backupError}
          </p>
        ) : null}
        {resetError !== null ? (
          <p className="form-error" role="alert">
            {resetError}
          </p>
        ) : null}

        <div className="recovery-actions">
          {hasRawBackup ? (
            <button className="secondary-button" type="button" onClick={onDownload}>
              Download raw backup
            </button>
          ) : null}
          <button className="primary-button" type="button" onClick={onRetry}>
            Try again
          </button>
          {isUnavailable ? (
            <button className="secondary-button" type="button" onClick={onContinueWithoutSaving}>
              Continue without saving
            </button>
          ) : (
            <button
              ref={resetTriggerRef}
              className="text-button destructive-button"
              type="button"
              onClick={onConfirmReset}
            >
              Reset local data
            </button>
          )}
        </div>

        {confirmReset ? (
          <dialog
            ref={resetDialogRef}
            className="confirmation-dialog"
            role="alertdialog"
            aria-labelledby="reset-title"
            aria-describedby="reset-description"
            aria-modal="true"
            onCancel={(event) => {
              event.preventDefault();
              onCancelReset();
            }}
          >
            <h2 id="reset-title">Reset local data?</h2>
            <p id="reset-description">
              This permanently removes dashboard selections, quantity values, notes, and custom
              drills from this browser. Built-in drills will remain available.
            </p>
            <div className="dialog-actions">
              <button
                ref={cancelResetRef}
                className="secondary-button"
                type="button"
                onClick={onCancelReset}
              >
                Keep my data
              </button>
              <button className="primary-button destructive-button" type="button" onClick={onReset}>
                Reset local data
              </button>
            </div>
          </dialog>
        ) : null}
      </section>
    </main>
  );
}
