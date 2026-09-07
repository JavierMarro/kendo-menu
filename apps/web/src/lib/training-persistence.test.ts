import {
  DEFAULT_TRAINING_SETS,
  getTrainingSetActivities,
  type DashboardEntry,
} from '@kendo-menu/domain';
import {
  parsePersistedTrainingStateV10,
  TRAINING_STORE_PERSISTENCE_VERSION,
} from '@kendo-menu/store';
import { describe, expect, it, vi } from 'vitest';

import {
  createBrowserTrainingStorage,
  downloadCurrentTrainingBackup,
  inspectBrowserTrainingStorage,
  resetBrowserTrainingStorage,
  TRAINING_STORAGE_KEY,
} from './training-persistence';

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
