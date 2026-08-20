import {
  classifyTrainingStorageValue,
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
        reason: inspection.reason,
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
      try {
        window.localStorage.setItem(name, value);
      } catch {
        options.onWriteError?.();
      }
    },
    removeItem: (name) => {
      try {
        window.localStorage.removeItem(name);
      } catch {
        options.onWriteError?.();
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

export function downloadRawTrainingBackup(raw: string): void {
  const blob = new Blob([raw], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = `kendomenu-local-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function resetBrowserTrainingStorage(storageKey: string = TRAINING_STORAGE_KEY): void {
  window.localStorage.removeItem(storageKey);

  if (window.localStorage.getItem(storageKey) !== null) {
    throw new Error('KendoMenu local data could not be removed.');
  }
}
