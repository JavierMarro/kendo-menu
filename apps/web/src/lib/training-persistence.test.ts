import {
  DEFAULT_TRAINING_SETS,
  getTrainingSetActivities,
  type DashboardEntry,
} from '@kendo-menu/domain';
import {
  parsePersistedTrainingStateV10,
  serializePersistedTrainingStateV10,
  TRAINING_STORE_PERSISTENCE_VERSION,
} from '@kendo-menu/store';
import { describe, expect, it, vi } from 'vitest';

import {
  createBrowserTrainingStorage,
  createMemoryTrainingStorage,
  createTrainingStorageController,
  downloadCurrentTrainingBackup,
  inspectBrowserTrainingStorage,
  resetBrowserTrainingStorage,
  resetBrowserTrainingStorageCoordinated,
  TRAINING_STORAGE_KEY,
} from './training-persistence';
import { createWorkspaceCoordinator, type WorkspaceLockProvider } from './workspace-coordination';

function currentTrainingEntry(): DashboardEntry {
  const trainingSet = DEFAULT_TRAINING_SETS[0];
  if (trainingSet === undefined) {
    throw new Error('Expected a curated training set fixture.');
  }

  const noteActivity = getTrainingSetActivities(trainingSet).find(
    (activity) => activity.allowsSessionNotes === true,
  );
  if (noteActivity === undefined) {
    throw new Error('Expected a session-note activity fixture.');
  }

  return {
    id: 'latest-entry',
    trainingSetId: trainingSet.id,
    trainingSet,
    quantityOverrides: {},
    activityNotes: {
      [noteActivity.id]: 'Latest activity note.',
    },
    notes: 'Latest dashboard note.',
    createdAt: '2026-09-07T10:00:00.000Z',
  };
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Expected the backup Blob to contain text.'));
      }
    });
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('Could not read the backup Blob.'));
    });
    reader.readAsText(blob);
  });
}

describe('browser training persistence adapter', () => {
  function coordinatorWith(lockNames: string[]): ReturnType<typeof createWorkspaceCoordinator> {
    const locks: WorkspaceLockProvider = {
      request: (name, callback) => {
        lockNames.push(name);
        return Promise.resolve().then(() => callback({ name, mode: 'exclusive' }));
      },
    };
    return createWorkspaceCoordinator({ locks, events: null });
  }

  it.each([
    ['synchronous write error', new Error('write blocked')],
    ['quota write error', new DOMException('quota exceeded', 'QuotaExceededError')],
  ])('surfaces and latches a %s', (_label, error) => {
    const onWriteError = vi.fn();
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw error;
    });
    const removeItem = vi.spyOn(window.localStorage, 'removeItem');
    const storage = createBrowserTrainingStorage({ onWriteError });

    storage.setItem(TRAINING_STORAGE_KEY, 'first attempt');
    storage.setItem(TRAINING_STORAGE_KEY, 'second attempt');
    storage.removeItem(TRAINING_STORAGE_KEY);

    expect(onWriteError).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(TRAINING_STORAGE_KEY, 'first attempt');
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('surfaces a failing localStorage accessor and does not access it again after latching', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    if (descriptor === undefined) {
      throw new Error('Expected a configurable localStorage property fixture.');
    }

    const onWriteError = vi.fn();
    let accessorReads = 0;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        accessorReads += 1;
        throw new Error('storage access blocked');
      },
    });

    try {
      const storage = createBrowserTrainingStorage({ onWriteError });
      storage.setItem(TRAINING_STORAGE_KEY, 'first attempt');
      storage.setItem(TRAINING_STORAGE_KEY, 'second attempt');
      storage.removeItem(TRAINING_STORAGE_KEY);

      expect(onWriteError).toHaveBeenCalledExactlyOnceWith();
      expect(accessorReads).toBe(1);
    } finally {
      Object.defineProperty(window, 'localStorage', descriptor);
    }
  });

  it('serializes current guest writes and cleanup through the canonical guest lock', async () => {
    const lockNames: string[] = [];
    const coordination = coordinatorWith(lockNames);
    const storage = createBrowserTrainingStorage({ coordination });

    storage.setItem(TRAINING_STORAGE_KEY, 'guest-value');
    await storage.flush();
    await resetBrowserTrainingStorageCoordinated(TRAINING_STORAGE_KEY, { coordination });

    expect(lockNames).toEqual(['kendo-menu:guest', 'kendo-menu:guest']);
    expect(window.localStorage.getItem(TRAINING_STORAGE_KEY)).toBeNull();
    coordination.dispose();
  });

  it('keeps a guest write local when lock acquisition fails before the callback', async () => {
    let value: string | null = null;
    const coordination = createWorkspaceCoordinator({
      locks: {
        request: () => Promise.reject(new Error('lock provider unavailable')),
      },
      events: null,
    });
    const storage = createBrowserTrainingStorage({
      coordination,
      storage: {
        getItem: () => value,
        setItem: (_name, next) => {
          value = next;
        },
        removeItem: () => {
          value = null;
        },
      },
    });

    storage.setItem(TRAINING_STORAGE_KEY, 'guest-value');
    await storage.flush();

    expect(value).toBe('guest-value');
    expect(coordination.isAvailable).toBe(false);
  });

  it('reports an unconfirmed coordinated guest cleanup', () => {
    let removeCalls = 0;
    const storage = {
      getItem: () => 'still-present',
      setItem: () => undefined,
      removeItem: () => {
        removeCalls += 1;
      },
    };

    let failure: unknown;
    try {
      void resetBrowserTrainingStorageCoordinated(TRAINING_STORAGE_KEY, { storage });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: 'BrowserStorageError',
      code: 'malformed-readback',
      operation: 'remove',
    });
    expect(removeCalls).toBe(1);
  });

  it('reports altered guest read-back without replacing the live adapter silently', async () => {
    let value: string | null = null;
    const storage = createBrowserTrainingStorage({
      storage: {
        getItem: () => value,
        setItem: (_name, next) => {
          value = `${next}-altered`;
        },
        removeItem: () => {
          value = null;
        },
      },
    });

    storage.setItem(TRAINING_STORAGE_KEY, 'guest-value');
    await expect(storage.flush()).rejects.toMatchObject({
      name: 'BrowserStorageError',
      code: 'malformed-readback',
    });
    expect(storage.lastFailure?.code).toBe('malformed-readback');
    expect(storage.isEnabled()).toBe(true);
  });

  it('does not start a queued guest write after an earlier write has failed', async () => {
    let active = false;
    const queued: Array<() => void> = [];
    const locks: WorkspaceLockProvider = {
      request: (name, callback) => {
        expect(name).toBe('kendo-menu:guest');
        return new Promise((resolve, reject) => {
          const run = () => {
            active = true;
            Promise.resolve()
              .then(() => callback({ name, mode: 'exclusive' }))
              .then(resolve, reject)
              .finally(() => {
                active = false;
                queued.shift();
                queued[0]?.();
              });
          };
          queued.push(run);
          if (!active && queued.length === 1) {
            run();
          }
        });
      },
    };
    let writes = 0;
    const storage = createBrowserTrainingStorage({
      coordination: createWorkspaceCoordinator({ locks, events: null }),
      storage: {
        getItem: () => null,
        setItem: () => {
          writes += 1;
          return Promise.reject(new Error('write blocked'));
        },
        removeItem: () => undefined,
      },
    });

    storage.setItem(TRAINING_STORAGE_KEY, 'first');
    storage.setItem(TRAINING_STORAGE_KEY, 'second');

    await expect(storage.flush()).rejects.toMatchObject({ code: 'unavailable' });
    expect(writes).toBe(1);
  });

  it('rejects a stale guest writer after another tab changes the hydrated value', async () => {
    let value: string | null = 'hydrated-value';
    const storage = createBrowserTrainingStorage({
      storage: {
        getItem: () => value,
        setItem: (_name, next) => {
          value = next;
        },
        removeItem: () => {
          value = null;
        },
      },
    });

    expect(storage.getItem(TRAINING_STORAGE_KEY)).toBe('hydrated-value');
    value = 'another-tab-value';
    storage.setItem(TRAINING_STORAGE_KEY, 'stale-tab-value');

    await expect(storage.flush()).rejects.toMatchObject({ code: 'interrupted' });
    expect(value).toBe('another-tab-value');
  });

  it.each(['empty', 'populated'] as const)(
    'keeps the inspected %s guest baseline when storage changes before replacement writes',
    async (scenario) => {
      const emptyValue = serializePersistedTrainingStateV10({ dashboardEntries: [] });
      const populatedValue = serializePersistedTrainingStateV10({
        dashboardEntries: [currentTrainingEntry()],
      });
      const inspectedValue = scenario === 'empty' ? null : populatedValue;
      const concurrentValue = scenario === 'empty' ? populatedValue : emptyValue;
      let value: string | null = inspectedValue;
      const storage = createBrowserTrainingStorage({
        initialValues: { [TRAINING_STORAGE_KEY]: inspectedValue },
        storage: {
          getItem: () => value,
          setItem: (_name, next) => {
            value = next;
          },
          removeItem: () => {
            value = null;
          },
        },
      });

      value = concurrentValue;
      storage.setItem(TRAINING_STORAGE_KEY, emptyValue);

      await expect(storage.flush()).rejects.toMatchObject({ code: 'interrupted' });
      expect(value).toBe(concurrentValue);
    },
  );

  it('disables queued guest writers before recovery replaces their backing storage', async () => {
    const lockNames: string[] = [];
    const coordination = coordinatorWith(lockNames);
    const browserStorage = createBrowserTrainingStorage({ coordination });
    const controller = createTrainingStorageController(browserStorage);

    controller.setItem(TRAINING_STORAGE_KEY, 'stale-guest-value');
    controller.replace(createMemoryTrainingStorage());
    await browserStorage.flush();
    await controller.flush();

    expect(window.localStorage.getItem(TRAINING_STORAGE_KEY)).toBeNull();
    expect(controller.isEnabled()).toBe(true);
    coordination.dispose();
  });

  it('exports the current v10 state, including the latest dashboard and activity notes', async () => {
    let capturedBlob: Blob | undefined;
    const objectUrl = 'blob:kendo-menu-current-backup';
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (blob instanceof Blob) {
        capturedBlob = blob;
      }
      return objectUrl;
    });
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const latestEntry = currentTrainingEntry();

    downloadCurrentTrainingBackup([latestEntry]);

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(objectUrl);
    if (capturedBlob === undefined) {
      throw new Error('Expected the current backup Blob to be created.');
    }

    const raw = await readBlobText(capturedBlob);
    const exported: unknown = JSON.parse(raw);
    expect(exported).toMatchObject({ version: TRAINING_STORE_PERSISTENCE_VERSION });
    if (typeof exported !== 'object' || exported === null || !('state' in exported)) {
      throw new Error('Expected the current backup to contain a state envelope.');
    }
    const parsed = parsePersistedTrainingStateV10(exported.state);
    expect(parsed?.dashboardEntries[0]).toMatchObject({
      notes: 'Latest dashboard note.',
      activityNotes: {
        [Object.keys(latestEntry.activityNotes)[0] ?? 'missing-activity']: 'Latest activity note.',
      },
    });
  });

  it('rejects invalid current state before creating a backup or touching storage', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const setItem = vi.spyOn(window.localStorage, 'setItem');
    const invalidState: unknown = [
      {
        ...currentTrainingEntry(),
        notes: 42,
      },
    ];

    expect(() => downloadCurrentTrainingBackup(invalidState)).toThrow();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('propagates Blob construction failures without creating or revoking an object URL', () => {
    const blob = vi.spyOn(globalThis, 'Blob').mockImplementation(() => {
      throw new Error('Blob construction blocked');
    });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');

    expect(() => downloadCurrentTrainingBackup([currentTrainingEntry()])).toThrow(
      'Blob construction blocked',
    );
    expect(blob).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('propagates object URL creation failures without revoking an uncreated URL', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('object URL blocked');
    });
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');

    expect(() => downloadCurrentTrainingBackup([currentTrainingEntry()])).toThrow(
      'object URL blocked',
    );
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('revokes an object URL when anchor creation fails', () => {
    const objectUrl = 'blob:kendo-menu-anchor-creation';
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue(objectUrl);
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const createElement = vi.spyOn(document, 'createElement').mockImplementation(() => {
      throw new Error('anchor creation blocked');
    });

    expect(() => downloadCurrentTrainingBackup([currentTrainingEntry()])).toThrow(
      'anchor creation blocked',
    );
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(createElement).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(objectUrl);
  });

  it('revokes an object URL when anchor activation fails', () => {
    const objectUrl = 'blob:kendo-menu-click';
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue(objectUrl);
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('download activation blocked');
    });

    expect(() => downloadCurrentTrainingBackup([currentTrainingEntry()])).toThrow(
      'download activation blocked',
    );
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(objectUrl);
  });

  it('completes an explicit reset without a fallible post-delete read', () => {
    window.localStorage.setItem(TRAINING_STORAGE_KEY, '{corrupt');
    const read = window.localStorage.getItem.bind(window.localStorage);
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('Read blocked after removal');
    });
    expect(() => resetBrowserTrainingStorage()).not.toThrow();
    expect(getItem).not.toHaveBeenCalled();
    expect(read(TRAINING_STORAGE_KEY)).toBeNull();
  });

  it('keeps corrupt and future-version bytes available for inspection without changing them', () => {
    const corruptRaw = '{broken';
    const futureRaw = JSON.stringify({
      version: TRAINING_STORE_PERSISTENCE_VERSION + 1,
      state: {},
    });
    window.localStorage.setItem(TRAINING_STORAGE_KEY, corruptRaw);
    expect(inspectBrowserTrainingStorage()).toEqual({
      status: 'corrupt',
      raw: corruptRaw,
      reason: 'malformed-json',
    });
    expect(window.localStorage.getItem(TRAINING_STORAGE_KEY)).toBe(corruptRaw);

    window.localStorage.setItem(TRAINING_STORAGE_KEY, futureRaw);
    expect(inspectBrowserTrainingStorage()).toEqual({
      status: 'future-version',
      raw: futureRaw,
      version: TRAINING_STORE_PERSISTENCE_VERSION + 1,
    });
    expect(window.localStorage.getItem(TRAINING_STORAGE_KEY)).toBe(futureRaw);
  });
});
