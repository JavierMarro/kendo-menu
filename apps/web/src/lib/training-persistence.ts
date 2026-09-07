import {
  classifyTrainingStorageValue,
  serializePersistedTrainingStateV10,
  type StateStorage,
  type TrainingStorageInspection,
} from '@kendo-menu/store';

export const TRAINING_STORAGE_KEY = 'kendo-menu';

export type PersistenceInspection =
  | { readonly status: 'empty' }
  | { readonly status: 'ready'; readonly raw: string }
  | { readonly status: 'corrupt'; readonly raw: string; readonly reason: string }
  | { readonly status: 'future-version'; readonly raw: string; readonly version: number }
  | { readonly status: 'unavailable'; readonly reason: string };

export interface BrowserStorageOptions {
  readonly onReadError?: () => void;
  readonly onWriteError?: () => void;
}

export interface TrainingStorageController extends StateStorage {
  readonly replace: (storage: StateStorage) => void;
}

function mapStorageInspection(
  inspection: TrainingStorageInspection,
  raw: string | null,
): PersistenceInspection {
  switch (inspection.status) {
    case 'empty':
      return { status: 'empty' };
    case 'ready':
    case 'migrated':
      return raw === null ? { status: 'empty' } : { status: 'ready', raw };
    case 'corrupt':
      return {
        status: 'corrupt',
        raw: raw ?? '',
        reason:
          inspection.reason === 'override-migration-conflict'
            ? inspection.detail
            : inspection.reason,
      };
    case 'unsupported-future':
      return { status: 'future-version', raw: raw ?? '', version: inspection.version };
    case 'unavailable':
      return { status: 'unavailable', reason: 'The browser did not allow local data access.' };
  }
}

export function inspectBrowserTrainingStorage(
  storageKey: string = TRAINING_STORAGE_KEY,
): PersistenceInspection {
  if (typeof window === 'undefined') {
    return {
      status: 'unavailable',
      reason: 'Browser storage is unavailable during server rendering.',
    };
  }

  let raw: string | null;

  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    return {
      status: 'unavailable',
      reason: 'The browser did not allow KendoMenu to read local data.',
    };
  }

  if (raw === null) {
    return { status: 'empty' };
  }

  return mapStorageInspection(classifyTrainingStorageValue(raw), raw);
}

export function createBrowserTrainingStorage(options: BrowserStorageOptions = {}): StateStorage {
  let writeFailed = false;

  const markWriteFailed = () => {
    writeFailed = true;
    options.onWriteError?.();
  };

  return {
    getItem: (name) => {
      try {
        return window.localStorage.getItem(name);
      } catch (error) {
        options.onReadError?.();
        throw error;
      }
    },
    setItem: (name, value) => {
      if (writeFailed) {
        return;
      }

      try {
        window.localStorage.setItem(name, value);
      } catch {
        markWriteFailed();
      }
    },
    removeItem: (name) => {
      if (writeFailed) {
        return;
      }

      try {
        window.localStorage.removeItem(name);
      } catch {
        markWriteFailed();
      }
    },
  } satisfies StateStorage;
}

export function createMemoryTrainingStorage(): StateStorage {
  const values = new Map<string, string>();

  return {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      values.set(name, value);
    },
    removeItem: (name) => {
      values.delete(name);
    },
  } satisfies StateStorage;
}

/**
 * Keep the store's injected storage identity stable while explicitly replacing its backing
 * adapter after a user chooses recovery or session-only mode.
 */
export function createTrainingStorageController(storage: StateStorage): TrainingStorageController {
  let activeStorage = storage;

  return {
    getItem: (name) => activeStorage.getItem(name),
    setItem: (name, value) => activeStorage.setItem(name, value),
    removeItem: (name) => activeStorage.removeItem(name),
    replace: (nextStorage) => {
      activeStorage = nextStorage;
    },
  } satisfies TrainingStorageController;
}

export function downloadRawTrainingBackup(raw: string): void {
  downloadTrainingBackupPayload(
    raw,
    `kendomenu-local-backup-${new Date().toISOString().slice(0, 10)}.json`,
  );
}

/**
 * Download the current validated v10 state held by the store.
 *
 * The state is encoded through the same serializer used by browser persistence so this backup
 * always carries the current persistence version and never reads stale or failed storage bytes.
 */
export function downloadCurrentTrainingBackup(dashboardEntries: unknown): void {
  const raw = serializePersistedTrainingStateV10({ dashboardEntries });
  downloadTrainingBackupPayload(
    raw,
    `kendomenu-current-backup-${new Date().toISOString().slice(0, 10)}.json`,
  );
}

function downloadTrainingBackupPayload(raw: string, filename: string): void {
  let url: string | null = null;

  try {
    const blob = new Blob([raw], { type: 'application/json' });
    url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    if (url !== null) {
      URL.revokeObjectURL(url);
    }
  }
}

export function resetBrowserTrainingStorage(storageKey: string = TRAINING_STORAGE_KEY): void {
  // LocalStorage removal is atomic. A later read failure must not turn a completed reset into
  // a reported failure; the gate independently inspects whether storage is available afterward.
  window.localStorage.removeItem(storageKey);
}
