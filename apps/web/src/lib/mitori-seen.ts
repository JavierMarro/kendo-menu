export const MITORI_SEEN_STORAGE_KEY = 'kendo-menu-mitori-seen';

const MAX_SERIALIZED_LENGTH = 2_048;

export interface MitoriSeenState {
  readonly seenVideoIds: ReadonlySet<string>;
  readonly canPersist: boolean;
}

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readMitoriSeenState(
  getStorage: () => ReadableStorage,
  knownVideoIds: ReadonlySet<string>,
): MitoriSeenState {
  try {
    const raw = getStorage().getItem(MITORI_SEEN_STORAGE_KEY);
    if (raw === null) {
      return { seenVideoIds: new Set(), canPersist: true };
    }
    if (raw.length > MAX_SERIALIZED_LENGTH) {
      return { seenVideoIds: new Set(), canPersist: false };
    }

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return { seenVideoIds: new Set(), canPersist: true };
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      value.version !== 1
    ) {
      return { seenVideoIds: new Set(), canPersist: false };
    }
    if (!('seenVideoIds' in value) || !Array.isArray(value.seenVideoIds)) {
      return { seenVideoIds: new Set(), canPersist: true };
    }

    const seenVideoIds = new Set(
      value.seenVideoIds.filter(
        (id): id is string => typeof id === 'string' && knownVideoIds.has(id),
      ),
    );
    return { seenVideoIds, canPersist: true };
  } catch {
    return { seenVideoIds: new Set(), canPersist: false };
  }
}

export function persistMitoriSeenIds(
  getStorage: () => WritableStorage,
  seenVideoIds: ReadonlySet<string>,
  knownVideoIds: ReadonlySet<string>,
): boolean {
  if (
    seenVideoIds.size > knownVideoIds.size ||
    [...seenVideoIds].some((id) => !knownVideoIds.has(id))
  ) {
    return false;
  }

  const serialized = JSON.stringify({ version: 1, seenVideoIds: [...seenVideoIds] });
  if (serialized.length > MAX_SERIALIZED_LENGTH) {
    return false;
  }

  try {
    const storage = getStorage();
    if (!readMitoriSeenState(() => storage, knownVideoIds).canPersist) {
      return false;
    }

    storage.setItem(MITORI_SEEN_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}
