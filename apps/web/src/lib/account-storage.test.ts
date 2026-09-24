import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';
import {
  createTrainingStoreAsync,
  serializePersistedTrainingStateV10,
  type StateStorage,
} from '@kendo-menu/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_SYNC_METADATA_VERSION,
  AccountStorageError,
  createAccountStorage as createAccountStorageAdapter,
  deriveAccountStorageKey,
  deriveAccountSyncStorageKey,
  parseAccountSyncMetadata,
} from './account-storage';
import type {
  AccountCacheRecord,
  AccountCacheVersion,
  AccountDatabase,
  AccountMetadataKind,
  AccountPayloadKind,
  AccountPayloadRecord,
  AccountRecoveryRecord,
} from './account-storage';

const ACCOUNT_A = '00000000-0000-4000-8000-000000000001';
const ACCOUNT_B = '00000000-0000-4000-8000-000000000002';
const EMPTY_CACHE = serializePersistedTrainingStateV10({ dashboardEntries: [] });

class MemoryStorage implements StateStorage {
  readonly values = new Map<string, string>();

  getItem(name: string): string | null {
    return this.values.get(name) ?? null;
  }

  setItem(name: string, value: string): void {
    this.values.set(name, value);
  }

  removeItem(name: string): void {
    this.values.delete(name);
  }
}

class MemoryAccountDatabase implements AccountDatabase {
  readonly caches = new Map<string, AccountCacheRecord>();
  readonly metadata = new Map<string, unknown>();
  readonly payloads = new Map<string, AccountPayloadRecord>();
  readonly recoveries: AccountRecoveryRecord[] = [];
  private nextIdentity = 0;

  clear(): void {
    this.caches.clear();
    this.metadata.clear();
    this.payloads.clear();
    this.recoveries.length = 0;
    this.nextIdentity = 0;
  }

  readCache(accountId: string): Promise<AccountCacheRecord | null> {
    return Promise.resolve(this.caches.get(accountId) ?? null);
  }

  migrateCacheIfAbsent(accountId: string, cacheValue: string): Promise<AccountCacheRecord> {
    const existing = this.caches.get(accountId);
    if (existing !== undefined) return Promise.resolve(existing);
    const record = {
      version: 1 as const,
      accountId,
      cacheValue,
      identity: `identity-${++this.nextIdentity}`,
      generation: 0,
    };
    this.caches.set(accountId, record);
    return Promise.resolve(record);
  }

  compareAndSwapCache(
    accountId: string,
    expected: AccountCacheVersion | null,
    value: string | null,
  ): Promise<{
    readonly status: 'committed' | 'conflict';
    readonly record: AccountCacheRecord | null;
  }> {
    const current = this.caches.get(accountId) ?? null;
    const matches =
      expected === null
        ? current === null
        : current !== null &&
          current.identity === expected.identity &&
          current.generation === expected.generation;
    if (!matches) return Promise.resolve({ status: 'conflict', record: current });
    if (value !== null && current?.cacheValue === value)
      return Promise.resolve({ status: 'committed', record: current });
    if (value === null) {
      this.caches.delete(accountId);
      return Promise.resolve({ status: 'committed', record: null });
    }
    const record = {
      version: 1 as const,
      accountId,
      cacheValue: value,
      identity: current?.identity ?? `identity-${++this.nextIdentity}`,
      generation: (current?.generation ?? -1) + 1,
    };
    this.caches.set(accountId, record);
    return Promise.resolve({ status: 'committed', record });
  }

  writeRecovery(accountId: string, rawValue: string): Promise<AccountRecoveryRecord> {
    const existing = this.recoveries.find(
      (record) => record.accountId === accountId && record.rawValue === rawValue,
    );
    if (existing !== undefined) return Promise.resolve(existing);
    const record = {
      version: 1 as const,
      accountId,
      recoveryId: `recovery-${this.recoveries.length + 1}`,
      rawValue,
      createdAt: Date.now(),
    };
    this.recoveries.push(record);
    return Promise.resolve(record);
  }

  readMetadata(accountId: string, kind: AccountMetadataKind): Promise<unknown> {
    return Promise.resolve(this.metadata.get(`${accountId}:${kind}`) ?? null);
  }

  writeMetadata(accountId: string, kind: AccountMetadataKind, value: unknown): Promise<void> {
    this.metadata.set(`${accountId}:${kind}`, value);
    return Promise.resolve();
  }

  readPayload(accountId: string, kind: AccountPayloadKind): Promise<AccountPayloadRecord | null> {
    return Promise.resolve(this.payloads.get(`${accountId}:${kind}`) ?? null);
  }

  writePayload(
    accountId: string,
    kind: AccountPayloadKind,
    payload: string,
  ): Promise<AccountPayloadRecord> {
    const record: AccountPayloadRecord = {
      version: 1,
      accountId,
      kind,
      payload,
      updatedAt: Date.now(),
    };
    this.payloads.set(`${accountId}:${kind}`, record);
    return Promise.resolve(record);
  }
}

const testDatabase = new MemoryAccountDatabase();

function databaseWith(overrides: Partial<AccountDatabase>): AccountDatabase {
  return {
    readCache: overrides.readCache ?? ((accountId) => testDatabase.readCache(accountId)),
    migrateCacheIfAbsent:
      overrides.migrateCacheIfAbsent ??
      ((accountId, value) => testDatabase.migrateCacheIfAbsent(accountId, value)),
    compareAndSwapCache:
      overrides.compareAndSwapCache ??
      ((accountId, expected, value) =>
        testDatabase.compareAndSwapCache(accountId, expected, value)),
    writeRecovery:
      overrides.writeRecovery ??
      ((accountId, value) => testDatabase.writeRecovery(accountId, value)),
    readMetadata:
      overrides.readMetadata ?? ((accountId, kind) => testDatabase.readMetadata(accountId, kind)),
    writeMetadata:
      overrides.writeMetadata ??
      ((accountId, kind, value) => testDatabase.writeMetadata(accountId, kind, value)),
    readPayload:
      overrides.readPayload ?? ((accountId, kind) => testDatabase.readPayload(accountId, kind)),
    writePayload:
      overrides.writePayload ??
      ((accountId, kind, payload) => testDatabase.writePayload(accountId, kind, payload)),
  };
}

function createAccountStorage(
  options: Omit<Parameters<typeof createAccountStorageAdapter>[0], 'database'> & {
    readonly database?: AccountDatabase;
  },
) {
  return createAccountStorageAdapter({ ...options, database: options.database ?? testDatabase });
}

function expectStorageError(error: unknown, code: AccountStorageError['code']): void {
  expect(error).toBeInstanceOf(AccountStorageError);
  expect(error).toMatchObject({ code });
}

describe('account scoped persistence', () => {
  beforeEach(() => testDatabase.clear());
  it('rejects legacy envelopes on writes while preserving the current cache', async () => {
    const storage = new MemoryStorage();
    const account = createAccountStorage({ accountId: ACCOUNT_A, storage });
    await account.setItem(account.cacheKey, EMPTY_CACHE);
    expect(() =>
      account.setItem(
        account.cacheKey,
        JSON.stringify({
          version: 9,
          state: { dashboardEntries: [] },
        }),
      ),
    ).toThrow(AccountStorageError);
    expect(storage.getItem(account.cacheKey)).toBeNull();
  });
  it('serializes asynchronous local writes even when cross-tab coordination is unavailable', async () => {
    const storage = new MemoryStorage();
    const account = createAccountStorage({
      accountId: ACCOUNT_A,
      storage,
    });
    const store = await createTrainingStoreAsync({
      storage: account,
      storageKey: account.cacheKey,
    });
    const training = DEFAULT_TRAINING_SETS[0];
    if (training === undefined) throw new Error('fixture missing');
    store.getState().addToDashboard(training.id);
    store.getState().addToDashboard(training.id);
    await account.flush();
    expect(account.coordinationAvailability).toBe('unavailable');
    const reopened = await createTrainingStoreAsync({
      storage: createAccountStorage({ accountId: ACCOUNT_A, storage }),
      storageKey: account.cacheKey,
    });
    expect(reopened.getState().dashboardEntries).toHaveLength(2);
  });
  it('derives exact UUID scoped keys and rejects email or malformed identities', () => {
    expect(deriveAccountStorageKey(ACCOUNT_A)).toBe(`kendo-menu:account:${ACCOUNT_A}`);
    expect(deriveAccountSyncStorageKey(ACCOUNT_A)).toBe(`kendo-menu:account:${ACCOUNT_A}:sync`);

    for (const invalid of [
      'person@example.com',
      'abcdef00-0000-4000-8000-000000000001'.toUpperCase(),
      '00000000-0000-4000-8000-00000000001',
      '00000000-0000-4000-8000-000000000001\n',
    ]) {
      expect(() => deriveAccountStorageKey(invalid)).toThrow(AccountStorageError);
    }
  });

  it('isolates account A and B while preserving the guest key outside both scopes', async () => {
    const storage = new MemoryStorage();
    storage.setItem('kendo-menu', EMPTY_CACHE);
    const accountA = createAccountStorage({ accountId: ACCOUNT_A, storage });
    const accountB = createAccountStorage({ accountId: ACCOUNT_B, storage });

    await accountA.setItem(accountA.cacheKey, EMPTY_CACHE);
    expect(await accountA.getItem(accountA.cacheKey)).toBe(EMPTY_CACHE);
    expect(await accountB.getItem(accountB.cacheKey)).toBeNull();
    expect(storage.getItem('kendo-menu')).toBe(EMPTY_CACHE);

    await accountA.initializeSyncMetadata();
    expect(await accountB.readSyncMetadata()).toBeNull();
    expect(storage.getItem(accountA.metadataKey)).toBeNull();
  });

  it('migrates and reads back a verified legacy cache while retaining its source without a lock', async () => {
    const storage = new MemoryStorage();
    storage.setItem(deriveAccountStorageKey(ACCOUNT_A), EMPTY_CACHE);
    const account = createAccountStorage({ accountId: ACCOUNT_A, storage });

    await account.migrateLegacy();
    expect((await testDatabase.readCache(ACCOUNT_A))?.cacheValue).toBe(EMPTY_CACHE);
    expect(storage.getItem(account.cacheKey)).toBe(EMPTY_CACHE);
    expect(await testDatabase.readMetadata(ACCOUNT_A, 'ack')).toEqual({
      version: 1,
      status: 'unknown',
    });

    storage.setItem(account.cacheKey, EMPTY_CACHE);
    await account.migrateLegacy();
    expect(storage.getItem(account.cacheKey)).toBe(EMPTY_CACHE);
    expect(testDatabase.recoveries).toHaveLength(0);
  });

  it('retains legacy source data when migration cannot be confirmed', async () => {
    const storage = new MemoryStorage();
    storage.setItem(deriveAccountStorageKey(ACCOUNT_A), EMPTY_CACHE);
    const failingDb = databaseWith({
      readCache: () => Promise.reject(new DOMException('quota', 'QuotaExceededError')),
    });
    const account = createAccountStorage({ accountId: ACCOUNT_A, storage, database: failingDb });

    await expect(account.migrateLegacy()).rejects.toMatchObject({ code: 'quota' });
    expect(storage.getItem(account.cacheKey)).toBe(EMPTY_CACHE);
  });

  it('recovers a stale write that arrives between migration readback and legacy cleanup', async () => {
    const storage = new MemoryStorage();
    const legacyValue = EMPTY_CACHE;
    const training = DEFAULT_TRAINING_SETS[0];
    if (training === undefined) throw new Error('fixture missing');
    const local = await createTrainingStoreAsync({
      storage: new MemoryStorage(),
      storageKey: 'temporary',
    });
    local.getState().addToDashboard(training.id);
    const newerLegacy = serializePersistedTrainingStateV10({
      dashboardEntries: local.getState().dashboardEntries,
    });
    storage.setItem(deriveAccountStorageKey(ACCOUNT_A), legacyValue);
    const changingDb = databaseWith({
      migrateCacheIfAbsent: (accountId, value) => {
        const migration = testDatabase.migrateCacheIfAbsent(accountId, value);
        storage.setItem(deriveAccountStorageKey(accountId), newerLegacy);
        return migration;
      },
    });
    const account = createAccountStorage({ accountId: ACCOUNT_A, storage, database: changingDb });

    await account.migrateLegacy();
    expect((await testDatabase.readCache(ACCOUNT_A))?.cacheValue).toBe(legacyValue);
    expect(storage.getItem(account.cacheKey)).toBe(newerLegacy);
    expect(testDatabase.recoveries.map(({ rawValue }) => rawValue)).toEqual([newerLegacy]);
  });

  it('leaves the changed legacy source intact when retaining it exceeds quota', async () => {
    const storage = new MemoryStorage();
    const training = DEFAULT_TRAINING_SETS[0];
    if (training === undefined) throw new Error('fixture missing');
    const local = await createTrainingStoreAsync({
      storage: new MemoryStorage(),
      storageKey: 'temporary',
    });
    local.getState().addToDashboard(training.id);
    const newerLegacy = serializePersistedTrainingStateV10({
      dashboardEntries: local.getState().dashboardEntries,
    });
    storage.setItem(deriveAccountStorageKey(ACCOUNT_A), EMPTY_CACHE);
    const quotaDb = databaseWith({
      migrateCacheIfAbsent: (accountId, value) => {
        const migration = testDatabase.migrateCacheIfAbsent(accountId, value);
        storage.setItem(deriveAccountStorageKey(accountId), newerLegacy);
        return migration;
      },
      writeRecovery: () => Promise.reject(new DOMException('quota', 'QuotaExceededError')),
    });
    const account = createAccountStorage({ accountId: ACCOUNT_A, storage, database: quotaDb });

    await expect(account.migrateLegacy()).rejects.toMatchObject({ code: 'quota' });
    expect(storage.getItem(account.cacheKey)).toBe(newerLegacy);
    expect((await testDatabase.readCache(ACCOUNT_A))?.cacheValue).toBe(EMPTY_CACHE);
  });

  it('retains a divergent stale-tab cache as a recovery copy without overwriting IndexedDB', async () => {
    const storage = new MemoryStorage();
    const legacyValue = serializePersistedTrainingStateV10({ dashboardEntries: [] });
    const training = DEFAULT_TRAINING_SETS[0];
    if (training === undefined) throw new Error('fixture missing');
    const local = await createTrainingStoreAsync({
      storage: new MemoryStorage(),
      storageKey: 'temporary',
    });
    local.getState().addToDashboard(training.id);
    const accountValue = serializePersistedTrainingStateV10({
      dashboardEntries: local.getState().dashboardEntries,
    });
    await testDatabase.migrateCacheIfAbsent(ACCOUNT_A, accountValue);
    storage.setItem(deriveAccountStorageKey(ACCOUNT_A), legacyValue);
    const account = createAccountStorage({ accountId: ACCOUNT_A, storage });

    await account.preserveLegacyDivergence();
    await account.preserveLegacyDivergence();
    expect((await testDatabase.readCache(ACCOUNT_A))?.cacheValue).toBe(accountValue);
    expect(storage.getItem(account.cacheKey)).toBe(legacyValue);
    expect(testDatabase.recoveries.map(({ rawValue }) => rawValue)).toEqual([legacyValue]);
  });

  it('surfaces an invalid stale legacy value while keeping the validated IndexedDB cache usable', async () => {
    const storage = new MemoryStorage();
    await testDatabase.migrateCacheIfAbsent(ACCOUNT_A, EMPTY_CACHE);
    storage.setItem(deriveAccountStorageKey(ACCOUNT_A), '{corrupt');
    const account = createAccountStorage({ accountId: ACCOUNT_A, storage });

    await account.migrateLegacy();
    expect(storage.getItem(account.cacheKey)).toBe('{corrupt');
    expect(account.lastRecoveryFailure).toMatchObject({ code: 'invalid-persisted-value' });
    expect(await account.getItem(account.cacheKey)).toBe(EMPTY_CACHE);
  });

  it('hydrates distinct real Zustand stores from their own account caches', async () => {
    const storage = new MemoryStorage();
    const accountA = createAccountStorage({ accountId: ACCOUNT_A, storage });
    const accountB = createAccountStorage({ accountId: ACCOUNT_B, storage });
    const storeA = await createTrainingStoreAsync({
      storage: accountA,
      storageKey: accountA.cacheKey,
    });
    const curated = DEFAULT_TRAINING_SETS[0];
    if (curated === undefined) {
      throw new Error('Expected a curated training set fixture.');
    }
    storeA.getState().addToDashboard(curated.id);
    await accountA.flush();

    const storeB = await createTrainingStoreAsync({
      storage: accountB,
      storageKey: accountB.cacheKey,
    });
    const reopenedAStorage = createAccountStorage({ accountId: ACCOUNT_A, storage });
    const reopenedA = await createTrainingStoreAsync({
      storage: reopenedAStorage,
      storageKey: reopenedAStorage.cacheKey,
    });

    expect(storeA).not.toBe(storeB);
    expect(storeB.getState().dashboardEntries).toHaveLength(0);
    expect(reopenedA.getState().dashboardEntries).toHaveLength(1);
  });

  it('does not create a legacy marker when there is no stored marker', async () => {
    const storage = new MemoryStorage();
    const account = createAccountStorage({ accountId: ACCOUNT_A, storage });
    const metadata = await account.initializeSyncMetadata();

    expect(metadata).toEqual({ version: ACCOUNT_SYNC_METADATA_VERSION, accountId: ACCOUNT_A });
    expect(storage.getItem(account.metadataKey)).toBeNull();
    storage.setItem(account.metadataKey, JSON.stringify(metadata));
    expect(parseAccountSyncMetadata(storage.getItem(account.metadataKey))).toEqual(metadata);
  });

  it('rejects partial, unsupported, mismatched, and oversized metadata', async () => {
    const storage = new MemoryStorage();
    const account = createAccountStorage({ accountId: ACCOUNT_A, storage });
    const cases: readonly [string, AccountStorageError['code']][] = [
      ['{"version":1}', 'malformed-metadata'],
      [`{"version":2,"accountId":"${ACCOUNT_A}"}`, 'unsupported-metadata-version'],
      [`{"version":1,"accountId":"${ACCOUNT_B}"}`, 'malformed-metadata'],
      [`{"version":1,"accountId":"${ACCOUNT_A}","extra":true}`, 'malformed-metadata'],
      [
        `{"version":1,"accountId":"${ACCOUNT_A}","padding":"${'x'.repeat(600)}"}`,
        'malformed-metadata',
      ],
    ];

    for (const [raw, code] of cases) {
      storage.setItem(account.metadataKey, raw);
      try {
        await account.readSyncMetadata();
        throw new Error(`Expected ${code}.`);
      } catch (error) {
        expectStorageError(error, code);
      }
      storage.removeItem(account.metadataKey);
    }
  });

  it('validates the v10 cache before hydration and rejects malformed or future values', async () => {
    const storage = new MemoryStorage();
    const account = createAccountStorage({ accountId: ACCOUNT_A, storage });
    for (const value of ['{broken', JSON.stringify({ version: 11, state: {} })]) {
      storage.setItem(account.cacheKey, value);
      await expect(account.migrateLegacy()).rejects.toMatchObject({
        code: 'invalid-persisted-value',
      });
      storage.removeItem(account.cacheKey);
    }
  });

  it('confirms exact read-back and reports quota, unavailable, and altered storage', async () => {
    const altered = databaseWith({
      readCache: () =>
        Promise.resolve({
          version: 1,
          accountId: ACCOUNT_A,
          cacheValue: EMPTY_CACHE,
          identity: 'other',
          generation: 2,
        }),
      compareAndSwapCache: () =>
        Promise.resolve({
          status: 'committed',
          record: {
            version: 1,
            accountId: ACCOUNT_A,
            cacheValue: 'altered',
            identity: 'other',
            generation: 2,
          },
        }),
    });
    const alteredAccount = createAccountStorage({
      accountId: ACCOUNT_A,
      storage: new MemoryStorage(),
      database: altered,
    });
    try {
      await alteredAccount.setItem(alteredAccount.cacheKey, EMPTY_CACHE);
      throw new Error('Expected altered read-back to fail.');
    } catch (error) {
      expectStorageError(error, 'malformed-readback');
    }

    const quotaDb = databaseWith({
      compareAndSwapCache: () => Promise.reject(new DOMException('quota', 'QuotaExceededError')),
    });
    const quota = createAccountStorage({
      accountId: ACCOUNT_A,
      storage: new MemoryStorage(),
      database: quotaDb,
    });
    await expect(
      Promise.resolve().then(() => quota.setItem(quota.cacheKey, EMPTY_CACHE)),
    ).rejects.toMatchObject({
      code: 'quota',
    });

    const unavailableDb = databaseWith({
      readCache: () => Promise.reject(new Error('blocked')),
    });
    const unavailable = createAccountStorage({
      accountId: ACCOUNT_A,
      storage: new MemoryStorage(),
      database: unavailableDb,
    });
    await expect(
      Promise.resolve().then(() => unavailable.getItem(unavailable.cacheKey)),
    ).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('rejects a stale hydrated writer instead of replacing another tab cache', async () => {
    const storage = new MemoryStorage();
    const first = createAccountStorage({ accountId: ACCOUNT_A, storage });
    const second = createAccountStorage({ accountId: ACCOUNT_A, storage });
    await first.getItem(first.cacheKey);
    await second.getItem(second.cacheKey);
    await first.setItem(first.cacheKey, EMPTY_CACHE);
    await expect(
      Promise.resolve().then(() => second.setItem(second.cacheKey, EMPTY_CACHE)),
    ).rejects.toMatchObject({ code: 'interrupted' });
    expect((await testDatabase.readCache(ACCOUNT_A))?.cacheValue).toBe(EMPTY_CACHE);
    await expect(second.flush()).rejects.toMatchObject({ code: 'interrupted' });
  });

  it('keeps the confirmed generation for identical writes but rejects stale expectations', async () => {
    const storage = new MemoryStorage();
    const first = createAccountStorage({ accountId: ACCOUNT_A, storage });
    await first.setItem(first.cacheKey, EMPTY_CACHE);
    const original = await testDatabase.readCache(ACCOUNT_A);
    if (original === null) throw new Error('Expected committed cache');

    await first.setItem(first.cacheKey, EMPTY_CACHE);
    expect(await testDatabase.readCache(ACCOUNT_A)).toEqual(original);

    const changed = await testDatabase.compareAndSwapCache(
      ACCOUNT_A,
      { identity: original.identity, generation: original.generation },
      JSON.stringify(JSON.parse(EMPTY_CACHE), null, 2),
    );
    expect(changed.status).toBe('committed');
    if (changed.record === null) throw new Error('Expected updated cache');
    const restored = await testDatabase.compareAndSwapCache(
      ACCOUNT_A,
      { identity: changed.record.identity, generation: changed.record.generation },
      EMPTY_CACHE,
    );
    expect(restored.status).toBe('committed');
    expect(restored.record?.cacheValue).toBe(EMPTY_CACHE);

    const stale = await testDatabase.compareAndSwapCache(
      ACCOUNT_A,
      { identity: original.identity, generation: original.generation },
      EMPTY_CACHE,
    );
    expect(stale).toEqual({ status: 'conflict', record: restored.record });
    expect(await testDatabase.readCache(ACCOUNT_A)).toEqual(restored.record);
  });

  it('latches asynchronous failures, exposes flush, and disables stale writers safely', async () => {
    let rejectWrite: ((error: unknown) => void) | undefined;
    const onWriteFailure = vi.fn();
    const delayedDb = databaseWith({
      compareAndSwapCache: () =>
        new Promise((_resolve, reject) => {
          rejectWrite = reject;
        }),
    });
    const account = createAccountStorage({
      accountId: ACCOUNT_A,
      storage: new MemoryStorage(),
      database: delayedDb,
      onWriteFailure,
    });
    const write = account.setItem(account.cacheKey, EMPTY_CACHE);
    account.disable();
    rejectWrite?.(new DOMException('cancelled', 'AbortError'));

    await expect(Promise.resolve(write)).rejects.toMatchObject({ code: 'interrupted' });
    await expect(account.flush()).rejects.toMatchObject({ code: 'interrupted' });
    expect(onWriteFailure).toHaveBeenCalledOnce();
    expect(() => account.setItem(account.cacheKey, EMPTY_CACHE)).not.toThrow();
    await expect(
      Promise.resolve().then(() => account.confirmCurrentValue(EMPTY_CACHE)),
    ).rejects.toMatchObject({
      code: 'interrupted',
    });
  });

  it('does not permit an account adapter to read another key', () => {
    const account = createAccountStorage({ accountId: ACCOUNT_A, storage: new MemoryStorage() });
    expect(() => account.getItem(`kendo-menu:account:${ACCOUNT_B}`)).toThrow(AccountStorageError);
    expect(() => account.getItem('kendo-menu')).toThrow(AccountStorageError);
  });
});
