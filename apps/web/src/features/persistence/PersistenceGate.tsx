import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { createTrainingStore } from '@kendo-menu/store';

import { PersistenceContext } from './persistence-context';
import {
  createBrowserTrainingStorage,
  createMemoryTrainingStorage,
  createTrainingStorageController,
  downloadCurrentTrainingBackup,
  downloadRawTrainingBackup,
  inspectBrowserTrainingStorage,
  resetBrowserTrainingStorage,
  TRAINING_STORAGE_KEY,
  type TrainingStorageController,
  type PersistenceInspection,
} from '../../lib/training-persistence';
import { TrainingStoreProvider } from '../../lib/training-store-provider';

// Compatibility exports keep existing provider test utilities stable while the context lives separately.
/* eslint-disable-next-line react-refresh/only-export-components */
export { PersistenceContext, usePersistenceStatus } from './persistence-context';
export type { PersistenceContextValue } from './persistence-context';

type TrainingStoreHook = ReturnType<typeof createTrainingStore>;

interface TrainingStoreBundle {
  readonly store: TrainingStoreHook;
  readonly storage: TrainingStorageController;
}

interface PersistenceGateProps {
  readonly children: ReactNode;
  readonly recoveryRequested?: boolean;
  readonly onRecoveryComplete?: () => void;
}

export function PersistenceGate({
  children,
  recoveryRequested = false,
  onRecoveryComplete,
}: PersistenceGateProps) {
  const [inspection, setInspection] = useState<PersistenceInspection>(() =>
    inspectBrowserTrainingStorage(TRAINING_STORAGE_KEY),
  );
  const [sessionOnly, setSessionOnly] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  const [runtimeUnavailable, setRuntimeUnavailable] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [localRecoveryRequested, setLocalRecoveryRequested] = useState(false);
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

  const createStoreBundle = useCallback((): TrainingStoreBundle => {
    const storage = createTrainingStorageController(
      sessionOnly
        ? createMemoryTrainingStorage()
        : createBrowserTrainingStorage({ onReadError, onWriteError }),
    );
    const store = createTrainingStore({
      storage,
      storageKey: TRAINING_STORAGE_KEY,
      onHydrationError: onReadError,
    });
    return { store, storage };
  }, [onReadError, onWriteError, sessionOnly]);

  const [storeBundle, setStoreBundle] = useState<TrainingStoreBundle | null>(() => {
    if (sessionOnly || inspection.status === 'empty' || inspection.status === 'ready') {
      try {
        return createStoreBundle();
      } catch {
        onReadError();
      }
    }
    return null;
  });

  useEffect(() => {
    if (
      storeBundle !== null ||
      (!sessionOnly && inspection.status !== 'empty' && inspection.status !== 'ready')
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      try {
        setStoreBundle(createStoreBundle());
      } catch {
        onReadError();
      }
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [createStoreBundle, inspection.status, onReadError, sessionOnly, storeBundle]);

  const store = storeBundle?.store ?? null;

  const recoveryIsRequested = recoveryRequested || localRecoveryRequested;

  const persistCurrentStateWith = useCallback(
    (storage: ReturnType<typeof createMemoryTrainingStorage>) => {
      const storageController = storeBundle?.storage;
      if (store === null || storageController === undefined) {
        return;
      }

      const dashboardEntries = store.getState().dashboardEntries;
      storageController.replace(storage);
      store.setState({ dashboardEntries });
    },
    [store, storeBundle],
  );

  const completeRecovery = useCallback(() => {
    setLocalRecoveryRequested(false);
    onRecoveryComplete?.();
  }, [onRecoveryComplete]);

  const retry = useCallback(() => {
    setBackupError(null);
    setResetError(null);
    setRuntimeUnavailable(false);
    setSessionOnly(false);
    const nextInspection = inspectBrowserTrainingStorage(TRAINING_STORAGE_KEY);
    setInspection(nextInspection);

    if (
      store !== null &&
      (nextInspection.status === 'empty' || nextInspection.status === 'ready')
    ) {
      setWriteFailed(false);
      try {
        persistCurrentStateWith(createBrowserTrainingStorage({ onReadError, onWriteError }));
      } catch {
        setWriteFailed(true);
      }
    } else if (nextInspection.status === 'unavailable') {
      setRuntimeUnavailable(true);
    }

    completeRecovery();
  }, [completeRecovery, onReadError, onWriteError, persistCurrentStateWith, store]);

  const continueWithoutSaving = useCallback(() => {
    setBackupError(null);
    setResetError(null);
    setWriteFailed(false);
    setRuntimeUnavailable(false);
    setSessionOnly(true);
    try {
      persistCurrentStateWith(createMemoryTrainingStorage());
    } catch {
      setBackupError(
        'KendoMenu could not start session-only mode. Your local data was not changed.',
      );
    }
    completeRecovery();
  }, [completeRecovery, persistCurrentStateWith]);

  const resetLocalData = useCallback(() => {
    try {
      resetBrowserTrainingStorage(TRAINING_STORAGE_KEY);
      const storageController = storeBundle?.storage;
      if (store !== null && storageController !== undefined) {
        const memoryStorage = createMemoryTrainingStorage();
        storageController.replace(memoryStorage);
        store.setState({ dashboardEntries: [] });
        storageController.replace(createBrowserTrainingStorage({ onReadError, onWriteError }));
      }
      setConfirmReset(false);
      setBackupError(null);
      setResetError(null);
      setWriteFailed(false);
      setSessionOnly(false);
      setRuntimeUnavailable(false);
      setInspection(inspectBrowserTrainingStorage(TRAINING_STORAGE_KEY));
      completeRecovery();
    } catch {
      setConfirmReset(false);
      setResetError('KendoMenu could not remove the local data. Nothing was changed.');
    }
  }, [completeRecovery, onReadError, onWriteError, store, storeBundle]);

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

  const downloadCurrentBackup = useCallback(() => {
    setBackupError(null);
    if (store === null) {
      return;
    }

    try {
      downloadCurrentTrainingBackup(store.getState().dashboardEntries);
    } catch {
      setBackupError(
        'KendoMenu could not download the current backup. Your local data has not been changed.',
      );
    }
  }, [store]);

  if (
    store !== null &&
    !runtimeUnavailable &&
    (sessionOnly || inspection.status === 'empty' || inspection.status === 'ready') &&
    !recoveryIsRequested
  ) {
    return (
      <PersistenceContext.Provider value={{ mode: sessionOnly ? 'session' : 'local', writeFailed }}>
        <TrainingStoreProvider store={store}>
          {writeFailed ? (
            <PersistenceWriteFailureNotice
              backupError={backupError}
              onDownload={downloadCurrentBackup}
              onOpenRecovery={() => setLocalRecoveryRequested(true)}
            />
          ) : null}
          {children}
        </TrainingStoreProvider>
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
      writeFailed={writeFailed}
      currentBackupAvailable={store !== null}
      onConfirmReset={() => setConfirmReset(true)}
      onCancelReset={() => setConfirmReset(false)}
      onDownload={downloadBackup}
      onDownloadCurrentBackup={downloadCurrentBackup}
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
  readonly writeFailed: boolean;
  readonly currentBackupAvailable: boolean;
  readonly onConfirmReset: () => void;
  readonly onCancelReset: () => void;
  readonly onDownload: () => void;
  readonly onDownloadCurrentBackup: () => void;
  readonly onReset: () => void;
  readonly onRetry: () => void;
  readonly onContinueWithoutSaving: () => void;
}

interface PersistenceWriteFailureNoticeProps {
  readonly backupError: string | null;
  readonly onDownload: () => void;
  readonly onOpenRecovery: () => void;
}

function PersistenceWriteFailureNotice({
  backupError,
  onDownload,
  onOpenRecovery,
}: PersistenceWriteFailureNoticeProps) {
  return (
    <aside className="persistence-warning" role="alert" aria-labelledby="persistence-warning-title">
      <p className="eyebrow">Local data warning</p>
      <h2 id="persistence-warning-title">Changes are not saved</h2>
      <p>
        KendoMenu could not save a recent change on this device. Your current session remains
        available, but it will be lost if you reload unless you download a backup.
      </p>
      <p>
        This user-initiated backup contains your menu content and notes. It stays on your device.
      </p>
      {backupError !== null ? (
        <p className="form-error" role="alert">
          {backupError}
        </p>
      ) : null}
      <div className="recovery-actions">
        <button className="secondary-button" type="button" onClick={onDownload}>
          Download current backup
        </button>
        <button className="text-button" type="button" onClick={onOpenRecovery}>
          Open recovery options
        </button>
      </div>
    </aside>
  );
}

function PersistenceRecovery({
  inspection,
  confirmReset,
  backupError,
  resetError,
  writeFailed,
  currentBackupAvailable,
  onConfirmReset,
  onCancelReset,
  onDownload,
  onDownloadCurrentBackup,
  onReset,
  onRetry,
  onContinueWithoutSaving,
}: PersistenceRecoveryProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const resetDialogRef = useRef<HTMLDialogElement>(null);
  const cancelResetRef = useRef<HTMLButtonElement>(null);
  const hadOpenResetDialog = useRef(false);
  const hasRawBackup = 'raw' in inspection;
  const isUnavailable = inspection.status === 'unavailable';
  const isFuture = inspection.status === 'future-version';
  const isReadyStorage = inspection.status === 'empty' || inspection.status === 'ready';

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

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
        <h1 id="persistence-title" ref={headingRef} tabIndex={-1}>
          {writeFailed
            ? 'Your recent changes are not saved.'
            : isUnavailable
              ? 'KendoMenu cannot access local data.'
              : isFuture
                ? 'This local data needs a newer KendoMenu.'
                : isReadyStorage
                  ? 'KendoMenu recovery options.'
                  : 'We couldn’t read your local KendoMenu data.'}
        </h1>

        {writeFailed ? (
          <>
            <p>
              KendoMenu could not save changes to this device. Your current session is still
              available, but changes will be lost if you reload unless you download a backup.
            </p>
          </>
        ) : isUnavailable ? (
          <p>
            The browser did not allow KendoMenu to read or save local data. Try again, or continue
            for this session without saving changes.
          </p>
        ) : isFuture ? (
          <p>
            This data was saved by a newer version of KendoMenu. It has not been changed. Update
            KendoMenu and try again before resetting anything.
          </p>
        ) : isReadyStorage ? (
          <>
            <p>
              Your current session is still available. Try again to return to KendoMenu, or download
              a validated backup before continuing.
            </p>
          </>
        ) : (
          <p>
            The stored data may be damaged. Your stored data has not been changed, and KendoMenu
            will not replace it silently.
          </p>
        )}

        {currentBackupAvailable ? (
          <p>
            The current backup contains your menu content and notes. Downloading it does not change
            your stored data.
          </p>
        ) : null}

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
          {currentBackupAvailable ? (
            <button className="secondary-button" type="button" onClick={onDownloadCurrentBackup}>
              Download current backup
            </button>
          ) : null}
          {hasRawBackup ? (
            <button className="secondary-button" type="button" onClick={onDownload}>
              Download raw backup
            </button>
          ) : null}
          <button className="primary-button" type="button" onClick={onRetry}>
            Try again
          </button>
          {isUnavailable || currentBackupAvailable ? (
            <button className="secondary-button" type="button" onClick={onContinueWithoutSaving}>
              Continue without saving
            </button>
          ) : null}
          {!isUnavailable ? (
            <button
              ref={resetTriggerRef}
              className="text-button destructive-button"
              type="button"
              onClick={onConfirmReset}
            >
              Reset local data
            </button>
          ) : null}
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
              training sessions from this browser. Built-in sessions will remain available.
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
