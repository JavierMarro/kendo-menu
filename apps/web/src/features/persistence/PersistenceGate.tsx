/**
 * Selects a validated guest store and presents recovery when browser persistence is unsafe.
 * The store remains usable in memory while the gate reports write failures or pending saves.
 * Explicit recovery choices replace the storage adapter rather than replacing live UI state.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { createTrainingStore } from '@kendo-menu/store';

import { PersistenceContext } from './persistence-context';
import {
  createBrowserTrainingStorage,
  createMemoryTrainingStorage,
  createTrainingStorageController,
  downloadCurrentTrainingBackup,
  downloadRawTrainingBackup,
  inspectBrowserTrainingStorage,
  resetBrowserTrainingStorageAsync,
  TRAINING_STORAGE_KEY,
  type TrainingStorageController,
  type PersistenceInspection,
} from '../../lib/training-persistence';
import { TrainingStoreProvider } from '../../lib/training-store-provider';
import { createWorkspaceCoordinator } from '../../lib/workspace-coordination';

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
  const [pendingWriterIds, setPendingWriterIds] = useState<ReadonlySet<object>>(() => new Set());
  const [runtimeUnavailable, setRuntimeUnavailable] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const resetPendingRef = useRef(false);
  const [localRecoveryRequested, setLocalRecoveryRequested] = useState(false);
  // Guest persistence only needs the lock boundary. Storage events are intentionally disabled
  // here because this provider does not consume invalidation notifications, and constructing an
  // event-owning coordinator during render is unsafe under React StrictMode's discarded renders.
  const coordination = useMemo(() => createWorkspaceCoordinator({ events: null }), []);

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

  const updatePendingWriter = useCallback((writerId: object, pending: boolean) => {
    // A replaced writer may settle after the new one starts. Track identities, not just a
    // boolean, so the old completion cannot clear the new writer's pending warning.
    queueMicrotask(() => {
      setPendingWriterIds((current) => {
        if (pending && current.has(writerId)) {
          return current;
        }
        if (!pending && !current.has(writerId)) {
          return current;
        }
        const next = new Set(current);
        if (pending) {
          next.add(writerId);
        } else {
          next.delete(writerId);
        }
        return next;
      });
    });
  }, []);

  const createBrowserStorage = useCallback(
    (initialValue?: string | null) => {
      const writerId = {};
      return createBrowserTrainingStorage({
        coordination,
        ...(initialValue === undefined
          ? {}
          : { initialValues: { [TRAINING_STORAGE_KEY]: initialValue } }),
        onPendingChange: (pending) => updatePendingWriter(writerId, pending),
        onReadError,
        onWriteError,
      });
    },
    [coordination, onReadError, onWriteError, updatePendingWriter],
  );

  const createStoreBundle = useCallback(
    (initialValue?: string | null): TrainingStoreBundle => {
      const storage = createTrainingStorageController(
        sessionOnly ? createMemoryTrainingStorage() : createBrowserStorage(initialValue),
      );
      const store = createTrainingStore({
        storage,
        storageKey: TRAINING_STORAGE_KEY,
        onHydrationError: onReadError,
      });
      return { store, storage };
    },
    [createBrowserStorage, onReadError, sessionOnly],
  );

  const inspectedGuestValue = (value: PersistenceInspection): string | null =>
    value.status === 'ready' ? value.raw : null;

  const [storeBundle, setStoreBundle] = useState<TrainingStoreBundle | null>(() => {
    if (sessionOnly || inspection.status === 'empty' || inspection.status === 'ready') {
      try {
        return createStoreBundle(inspectedGuestValue(inspection));
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
        setStoreBundle(createStoreBundle(inspectedGuestValue(inspection)));
      } catch {
        onReadError();
      }
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [createStoreBundle, inspection, onReadError, sessionOnly, storeBundle]);

  const store = storeBundle?.store ?? null;
  const writePending = pendingWriterIds.size > 0;

  const flushPersistence = useCallback(async () => {
    await storeBundle?.storage.flush();
  }, [storeBundle]);

  useEffect(() => {
    if (!writePending) {
      return undefined;
    }

    // A queued browser write is not yet confirmed; warn before closing the tab even though
    // Zustand has already rendered the edited state.
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [writePending]);

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
        persistCurrentStateWith(createBrowserStorage(inspectedGuestValue(nextInspection)));
      } catch {
        setWriteFailed(true);
      }
    } else if (nextInspection.status === 'unavailable') {
      setRuntimeUnavailable(true);
    }

    completeRecovery();
  }, [completeRecovery, createBrowserStorage, persistCurrentStateWith, store]);

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

  const resetLocalData = useCallback(async () => {
    if (resetPendingRef.current) {
      return;
    }
    resetPendingRef.current = true;
    setResetPending(true);
    try {
      const storageController = storeBundle?.storage;
      storageController?.disable();
      await resetBrowserTrainingStorageAsync(TRAINING_STORAGE_KEY, { coordination });
      if (store !== null && storageController !== undefined) {
        const memoryStorage = createMemoryTrainingStorage();
        storageController.replace(memoryStorage);
        store.setState({ dashboardEntries: [] });
        storageController.replace(createBrowserStorage(null));
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
      const nextInspection = inspectBrowserTrainingStorage(TRAINING_STORAGE_KEY);
      setInspection(nextInspection);
      setRuntimeUnavailable(nextInspection.status === 'unavailable');
      setResetError(
        store === null
          ? 'KendoMenu could not confirm local data removal. Try again before leaving this page.'
          : 'KendoMenu could not confirm local data removal. Your current session remains available; try again before leaving this page.',
      );
    } finally {
      resetPendingRef.current = false;
      setResetPending(false);
    }
  }, [completeRecovery, coordination, createBrowserStorage, store, storeBundle]);

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
      <PersistenceContext.Provider
        value={{
          mode: sessionOnly ? 'session' : 'local',
          writeFailed,
          pending: writePending,
          flush: flushPersistence,
        }}
      >
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
      resetPending={resetPending}
      writeFailed={writeFailed}
      currentBackupAvailable={store !== null}
      onConfirmReset={() => {
        if (!resetPendingRef.current) {
          setConfirmReset(true);
        }
      }}
      onCancelReset={() => {
        if (!resetPendingRef.current) {
          setConfirmReset(false);
        }
      }}
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
  readonly resetPending: boolean;
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
  resetPending,
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
      <meta name="robots" content="noindex, nofollow" />
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
            <button
              className="secondary-button"
              type="button"
              onClick={onDownloadCurrentBackup}
              disabled={resetPending}
            >
              Download current backup
            </button>
          ) : null}
          {hasRawBackup ? (
            <button
              className="secondary-button"
              type="button"
              onClick={onDownload}
              disabled={resetPending}
            >
              Download raw backup
            </button>
          ) : null}
          <button
            className="primary-button"
            type="button"
            onClick={onRetry}
            disabled={resetPending}
          >
            Try again
          </button>
          {isUnavailable || currentBackupAvailable ? (
            <button
              className="secondary-button"
              type="button"
              onClick={onContinueWithoutSaving}
              disabled={resetPending}
            >
              Continue without saving
            </button>
          ) : null}
          {!isUnavailable ? (
            <button
              ref={resetTriggerRef}
              className="text-button destructive-button"
              type="button"
              onClick={onConfirmReset}
              disabled={resetPending}
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
            aria-busy={resetPending}
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
                disabled={resetPending}
              >
                Keep my data
              </button>
              <button
                className="primary-button destructive-button"
                type="button"
                onClick={onReset}
                disabled={resetPending}
              >
                Reset local data
              </button>
            </div>
          </dialog>
        ) : null}
      </section>
    </main>
  );
}
