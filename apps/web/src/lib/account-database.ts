import { classifyTrainingStorageValue } from '@kendo-menu/store';

const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function isAccountId(value: string): boolean {
  return ACCOUNT_ID_PATTERN.test(value);
}

const DATABASE_NAME = 'kendo-menu-account-storage';
const DATABASE_VERSION = 1;
const STORE_NAME = 'records';
export const ACCOUNT_METADATA_MAX_BYTES = 4_096;
export const ACCOUNT_RECOVERY_MAX_CHARACTERS = 3_145_728;
export const ACCOUNT_PAYLOAD_MAX_BYTES = 6_291_456;

export type AccountMetadataKind = 'ack';
export type AccountPayloadKind = 'pending-request' | 'active-conflict';

export interface AccountCacheVersion {
  readonly identity: string;
  readonly generation: number;
}

export interface AccountCacheRecord extends AccountCacheVersion {
  readonly version: 1;
  readonly accountId: string;
  readonly cacheValue: string;
}

export interface AccountRecoveryRecord {
  readonly version: 1;
  readonly accountId: string;
  readonly recoveryId: string;
  readonly rawValue: string;
  readonly createdAt: number;
}

export interface AccountPayloadRecord {
  readonly version: 1;
  readonly accountId: string;
  readonly kind: AccountPayloadKind;
  readonly payload: string;
  readonly updatedAt: number;
}

export type AccountCompareAndSwapResult =
  | { readonly status: 'committed'; readonly record: AccountCacheRecord | null }
  | { readonly status: 'conflict'; readonly record: AccountCacheRecord | null };

/** Small storage boundary that keeps IndexedDB transaction details out of the Zustand adapter. */
export interface AccountDatabase {
  readCache(accountId: string): Promise<AccountCacheRecord | null>;
  migrateCacheIfAbsent(accountId: string, cacheValue: string): Promise<AccountCacheRecord>;
  compareAndSwapCache(
    accountId: string,
    expected: AccountCacheVersion | null,
    value: string | null,
  ): Promise<AccountCompareAndSwapResult>;
  writeRecovery(accountId: string, rawValue: string): Promise<AccountRecoveryRecord>;
  readMetadata(accountId: string, kind: AccountMetadataKind): Promise<unknown>;
  writeMetadata(accountId: string, kind: AccountMetadataKind, value: unknown): Promise<void>;
  readPayload(accountId: string, kind: AccountPayloadKind): Promise<AccountPayloadRecord | null>;
  writePayload(
    accountId: string,
    kind: AccountPayloadKind,
    payload: string,
  ): Promise<AccountPayloadRecord>;
}

type StoredCache = AccountCacheRecord & { readonly key: string; readonly kind: 'cache' };
type StoredMetadata = {
  readonly key: string;
  readonly kind: AccountMetadataKind;
  readonly accountId: string;
  readonly value: unknown;
};
type StoredRecovery = AccountRecoveryRecord & { readonly key: string; readonly kind: 'recovery' };
type StoredPayload = AccountPayloadRecord & {
  readonly key: string;
  readonly recordType: 'payload';
};
type StoredRecord = StoredCache | StoredMetadata | StoredRecovery | StoredPayload;

function cacheKey(accountId: string): string {
  return `${accountId}:cache`;
}

function metadataKey(accountId: string, kind: AccountMetadataKind): string {
  return `${accountId}:${kind}`;
}

function recoveryKey(accountId: string, recoveryId: string): string {
  return `${accountId}:recovery:${recoveryId}`;
}

function payloadKey(accountId: string, kind: AccountPayloadKind): string {
  return `${accountId}:${kind}`;
}

function validCacheValue(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const inspection = classifyTrainingStorageValue(value);
  return inspection.status === 'ready';
}

function assertCacheRecord(value: unknown, accountId: string): asserts value is StoredCache {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('IndexedDB account cache record is malformed or unsupported.');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 7 ||
    !Object.hasOwn(record, 'kind') ||
    record['kind'] !== 'cache' ||
    record['accountId'] !== accountId ||
    record['version'] !== 1 ||
    typeof record['identity'] !== 'string' ||
    record['identity'].length < 1 ||
    record['identity'].length > 128 ||
    !Number.isSafeInteger(record['generation']) ||
    (record['generation'] as number) < 0 ||
    !validCacheValue(record['cacheValue'])
  ) {
    throw new Error('IndexedDB account cache record is malformed or unsupported.');
  }
}

function assertMetadataRecord(
  value: unknown,
  accountId: string,
  kind: AccountMetadataKind,
): asserts value is StoredMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('IndexedDB account metadata record is malformed.');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 4 ||
    record['kind'] !== kind ||
    record['accountId'] !== accountId
  ) {
    throw new Error('IndexedDB account metadata record is malformed.');
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(record['value']);
  } catch (error) {
    throw new Error('IndexedDB account metadata cannot be serialized.', { cause: error });
  }
  if (
    serialized === undefined ||
    new TextEncoder().encode(serialized).byteLength > ACCOUNT_METADATA_MAX_BYTES
  ) {
    throw new Error('IndexedDB account metadata exceeds its bounded size.');
  }
  if (kind === 'ack') {
    const ack = record['value'];
    if (typeof ack !== 'object' || ack === null || Array.isArray(ack)) {
      throw new Error('IndexedDB acknowledgement metadata is malformed.');
    }
    const ackRecord = ack as Record<string, unknown>;
    if (
      !Object.hasOwn(ackRecord, 'version') ||
      !Object.hasOwn(ackRecord, 'status') ||
      Object.keys(ackRecord).length !== 2 ||
      ackRecord['version'] !== 1 ||
      ackRecord['status'] !== 'unknown'
    ) {
      throw new Error('IndexedDB acknowledgement metadata is malformed.');
    }
  }
}

function assertPayloadRecord(
  value: unknown,
  accountId: string,
  kind: AccountPayloadKind,
): asserts value is StoredPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('IndexedDB account payload record is malformed.');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 7 ||
    record['recordType'] !== 'payload' ||
    record['version'] !== 1 ||
    record['accountId'] !== accountId ||
    record['kind'] !== kind ||
    typeof record['payload'] !== 'string' ||
    !Number.isSafeInteger(record['updatedAt'])
  )
    throw new Error('IndexedDB account payload record is malformed.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(record['payload']);
  } catch (error) {
    throw new Error('IndexedDB account payload is not valid JSON.', { cause: error });
  }
  if (
    new TextEncoder().encode(record['payload']).byteLength > ACCOUNT_PAYLOAD_MAX_BYTES ||
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  )
    throw new Error('IndexedDB account payload exceeds its bound or has an invalid shape.');
}

function recoveryDigest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${value.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

function assertRecoveryRecord(value: unknown, accountId: string): asserts value is StoredRecovery {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('IndexedDB account recovery record is malformed or oversized.');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 7 ||
    record['kind'] !== 'recovery' ||
    record['accountId'] !== accountId ||
    record['version'] !== 1 ||
    typeof record['recoveryId'] !== 'string' ||
    record['recoveryId'].length < 1 ||
    typeof record['rawValue'] !== 'string' ||
    record['rawValue'].length > ACCOUNT_RECOVERY_MAX_CHARACTERS ||
    !Number.isSafeInteger(record['createdAt']) ||
    !validCacheValue(record['rawValue'])
  ) {
    throw new Error('IndexedDB account recovery record is malformed or oversized.');
  }
}

function createIdentity(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to a non-secret local identity; it is only a CAS token.
  }
  return `cache-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function storedRecordRequest(
  store: IDBObjectStore,
  key: string,
): Promise<StoredRecord | undefined> {
  return requestResult(store.get(key) as IDBRequest<StoredRecord | undefined>);
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new DOMException('Transaction aborted.', 'AbortError'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
  // A request can reject before its caller reaches `await done`; keep the transaction's
  // independent failure observable to awaiters without an unhandled rejection.
  void done.catch(() => undefined);
  return done;
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Unable to open account IndexedDB.'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Opening account IndexedDB was blocked.'));
    };
  });
}

/** Creates the single versioned IndexedDB account store. Reads validate every returned record. */
export function createIndexedDbAccountDatabase(factory?: IDBFactory): AccountDatabase {
  const indexedDBFactory = factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
  if (indexedDBFactory === undefined) {
    throw new Error('IndexedDB is unavailable in this browser.');
  }
  let databasePromise: Promise<IDBDatabase> | undefined;
  const db = (): Promise<IDBDatabase> => {
    databasePromise ??= openDatabase(indexedDBFactory);
    return databasePromise;
  };

  const readCache = async (accountId: string): Promise<AccountCacheRecord | null> => {
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const done = transactionDone(transaction);
    const value = await storedRecordRequest(
      transaction.objectStore(STORE_NAME),
      cacheKey(accountId),
    );
    await done;
    if (value === undefined) return null;
    assertCacheRecord(value, accountId);
    return {
      version: value.version,
      accountId,
      cacheValue: value.cacheValue,
      identity: value.identity,
      generation: value.generation,
    };
  };

  const migrateCacheIfAbsent = async (
    accountId: string,
    cacheValue: string,
  ): Promise<AccountCacheRecord> => {
    if (!isAccountId(accountId) || !validCacheValue(cacheValue))
      throw new Error('Cannot migrate invalid account cache data.');
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const existing = await storedRecordRequest(store, cacheKey(accountId));
    if (existing !== undefined) {
      assertCacheRecord(existing, accountId);
      await done;
      return {
        version: 1,
        accountId,
        cacheValue: existing.cacheValue,
        identity: existing.identity,
        generation: existing.generation,
      };
    }
    const record: StoredCache = {
      key: cacheKey(accountId),
      kind: 'cache',
      version: 1,
      accountId,
      cacheValue,
      identity: createIdentity(),
      generation: 0,
    };
    store.put(record);
    const ackKey = metadataKey(accountId, 'ack');
    const ack = await storedRecordRequest(store, ackKey);
    if (ack === undefined)
      store.put({
        key: ackKey,
        kind: 'ack',
        accountId,
        value: { version: 1, status: 'unknown' },
      } satisfies StoredMetadata);
    await done;
    const confirmed = await readCache(accountId);
    if (
      confirmed === null ||
      confirmed.identity !== record.identity ||
      confirmed.generation !== record.generation ||
      confirmed.cacheValue !== cacheValue
    ) {
      throw new Error('IndexedDB account cache migration readback did not match.');
    }
    return confirmed;
  };

  const compareAndSwapCache = async (
    accountId: string,
    expected: AccountCacheVersion | null,
    value: string | null,
  ): Promise<AccountCompareAndSwapResult> => {
    if (!isAccountId(accountId) || (value !== null && !validCacheValue(value)))
      throw new Error('Cannot store invalid account cache data.');
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const current = await storedRecordRequest(store, cacheKey(accountId));
    if (current !== undefined) assertCacheRecord(current, accountId);
    const matches =
      expected === null
        ? current === undefined
        : current !== undefined &&
          current.identity === expected.identity &&
          current.generation === expected.generation;
    if (!matches) {
      await done;
      return {
        status: 'conflict',
        record:
          current === undefined
            ? null
            : {
                version: current.version,
                accountId,
                cacheValue: current.cacheValue,
                identity: current.identity,
                generation: current.generation,
              },
      };
    }
    if (value !== null && current !== undefined && current.cacheValue === value) {
      await done;
      return {
        status: 'committed',
        record: {
          version: current.version,
          accountId,
          cacheValue: current.cacheValue,
          identity: current.identity,
          generation: current.generation,
        },
      };
    }
    if (value !== null && current?.generation === Number.MAX_SAFE_INTEGER) {
      await done;
      throw new Error('IndexedDB account cache generation is exhausted.');
    }
    let next: StoredCache | null = null;
    if (value === null) store.delete(cacheKey(accountId));
    else {
      next = {
        key: cacheKey(accountId),
        kind: 'cache',
        version: 1,
        accountId,
        cacheValue: value,
        identity: current?.identity ?? createIdentity(),
        generation: (current?.generation ?? -1) + 1,
      };
      store.put(next);
      const ack = await storedRecordRequest(store, metadataKey(accountId, 'ack'));
      if (ack === undefined) {
        store.put({
          key: metadataKey(accountId, 'ack'),
          kind: 'ack',
          accountId,
          value: { version: 1, status: 'unknown' },
        } satisfies StoredMetadata);
      }
    }
    await done;
    const readback = await readCache(accountId);
    if (
      (next === null && readback !== null) ||
      (next !== null &&
        (readback === null ||
          readback.identity !== next.identity ||
          readback.generation !== next.generation ||
          readback.cacheValue !== value))
    )
      throw new Error('IndexedDB account cache compare-and-swap readback did not match.');
    return { status: 'committed', record: readback };
  };

  const readMetadata = async (accountId: string, kind: AccountMetadataKind): Promise<unknown> => {
    if (!isAccountId(accountId)) throw new Error('Invalid account metadata owner.');
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const done = transactionDone(transaction);
    const value = await storedRecordRequest(
      transaction.objectStore(STORE_NAME),
      metadataKey(accountId, kind),
    );
    await done;
    if (value === undefined) return null;
    assertMetadataRecord(value, accountId, kind);
    return value.value;
  };

  const writeMetadata = async (
    accountId: string,
    kind: AccountMetadataKind,
    value: unknown,
  ): Promise<void> => {
    if (!isAccountId(accountId)) throw new Error('Invalid account metadata owner.');
    const record: StoredMetadata = { key: metadataKey(accountId, kind), kind, accountId, value };
    assertMetadataRecord(record, accountId, kind);
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).put(record);
    await done;
    const confirmed = await readMetadata(accountId, kind);
    if (JSON.stringify(confirmed) !== JSON.stringify(value))
      throw new Error('IndexedDB account metadata readback did not match.');
  };

  const writeRecovery = async (
    accountId: string,
    rawValue: string,
  ): Promise<AccountRecoveryRecord> => {
    if (
      !isAccountId(accountId) ||
      !validCacheValue(rawValue) ||
      rawValue.length > ACCOUNT_RECOVERY_MAX_CHARACTERS
    )
      throw new Error('Cannot retain invalid or oversized legacy account data.');
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const digest = recoveryDigest(rawValue);
    let collision = 0;
    let recoveryId = digest;
    let key = recoveryKey(accountId, recoveryId);
    let existing = await storedRecordRequest(store, key);
    while (existing !== undefined) {
      assertRecoveryRecord(existing, accountId);
      if (existing.rawValue === rawValue) {
        await done;
        return {
          version: 1,
          accountId,
          recoveryId: existing.recoveryId,
          rawValue,
          createdAt: existing.createdAt,
        };
      }
      collision += 1;
      recoveryId = `${digest}-${collision}`;
      key = recoveryKey(accountId, recoveryId);
      existing = await storedRecordRequest(store, key);
    }
    const recovery: StoredRecovery = {
      key,
      kind: 'recovery',
      version: 1,
      accountId,
      recoveryId,
      rawValue,
      createdAt: Date.now(),
    };
    assertRecoveryRecord(recovery, accountId);
    store.put(recovery);
    await done;
    const readTransaction = database.transaction(STORE_NAME, 'readonly');
    const readDone = transactionDone(readTransaction);
    const readback = await storedRecordRequest(
      readTransaction.objectStore(STORE_NAME),
      recovery.key,
    );
    await readDone;
    if (readback === undefined) throw new Error('IndexedDB recovery copy was not retained.');
    assertRecoveryRecord(readback, accountId);
    if (readback.rawValue !== rawValue)
      throw new Error('IndexedDB recovery copy readback did not match.');
    return { version: 1, accountId, recoveryId, rawValue, createdAt: readback.createdAt };
  };

  const readPayload = async (
    accountId: string,
    kind: AccountPayloadKind,
  ): Promise<AccountPayloadRecord | null> => {
    if (!isAccountId(accountId)) throw new Error('Invalid account payload owner.');
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const done = transactionDone(transaction);
    const value = await storedRecordRequest(
      transaction.objectStore(STORE_NAME),
      payloadKey(accountId, kind),
    );
    await done;
    if (value === undefined) return null;
    assertPayloadRecord(value, accountId, kind);
    return {
      version: value.version,
      accountId,
      kind,
      payload: value.payload,
      updatedAt: value.updatedAt,
    };
  };

  const writePayload = async (
    accountId: string,
    kind: AccountPayloadKind,
    payload: string,
  ): Promise<AccountPayloadRecord> => {
    if (!isAccountId(accountId)) throw new Error('Invalid account payload owner.');
    const record: StoredPayload = {
      key: payloadKey(accountId, kind),
      recordType: 'payload',
      version: 1,
      accountId,
      kind,
      payload,
      updatedAt: Date.now(),
    };
    assertPayloadRecord(record, accountId, kind);
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).put(record);
    await done;
    const confirmed = await readPayload(accountId, kind);
    if (confirmed === null || confirmed.payload !== payload) {
      throw new Error('IndexedDB account payload readback did not match.');
    }
    return confirmed;
  };

  return {
    readCache,
    migrateCacheIfAbsent,
    compareAndSwapCache,
    writeRecovery,
    readMetadata,
    writeMetadata,
    readPayload,
    writePayload,
  };
}
