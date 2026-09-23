import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';
import {
  createTrainingStoreAsync,
  serializePersistedTrainingStateV10,
  type StateStorage,
} from '@kendo-menu/store';
import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_SYNC_METADATA_VERSION,
  AccountStorageError,
  createAccountStorage,
  createAccountSyncMetadata,
  deriveAccountStorageKey,
  deriveAccountSyncStorageKey,
  parseAccountSyncMetadata,
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

function expectStorageError(error: unknown, code: AccountStorageError['code']): void {
  expect(error).toBeInstanceOf(AccountStorageError);
  expect(error).toMatchObject({ code });
}

describe('account scoped persistence', () => {
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
    expect(storage.getItem(account.cacheKey)).toBe(EMPTY_CACHE);
  });
  it('serializes asynchronous local writes even when cross-tab coordination is unavailable', async () => {
    const storage = new MemoryStorage();
    let writing = 0;
    let maximumConcurrent = 0;
    const account = createAccountStorage({
      accountId: ACCOUNT_A,
      storage: {
        getItem: (key) => storage.getItem(key),
        removeItem: (key) => storage.removeItem(key),
        setItem: async (key, value) => {
          writing += 1;
          maximumConcurrent = Math.max(maximumConcurrent, writing);
          await Promise.resolve();
          storage.setItem(key, value);
          writing -= 1;
        },
      },
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
    expect(maximumConcurrent).toBe(1);
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
    expect(storage.getItem(accountA.metadataKey)).toBe(
      JSON.stringify(createAccountSyncMetadata(ACCOUNT_A)),
    );
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

  it('initializes only the tiny versioned metadata envelope', async () => {
    const storage = new MemoryStorage();
    const account = createAccountStorage({ accountId: ACCOUNT_A, storage });
    const metadata = await account.initializeSyncMetadata();

    expect(metadata).toEqual({ version: ACCOUNT_SYNC_METADATA_VERSION, accountId: ACCOUNT_A });
    expect(storage.getItem(account.metadataKey)?.length).toBeLessThan(512);
    expect(storage.getItem(account.metadataKey)).not.toContain('dashboardEntries');
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
      await expect(
        Promise.resolve().then(() => account.getItem(account.cacheKey)),
      ).rejects.toMatchObject({
        code: 'invalid-persisted-value',
      });
      storage.removeItem(account.cacheKey);
    }
  });

  it('confirms exact read-back and reports quota, unavailable, and altered storage', async () => {
    let wrote = false;
    const altered: StateStorage = {
      getItem: () => (wrote ? 'altered' : null),
      setItem: () => {
        wrote = true;
      },
      removeItem: () => undefined,
    };
    const alteredAccount = createAccountStorage({ accountId: ACCOUNT_A, storage: altered });
    try {
      await alteredAccount.setItem(alteredAccount.cacheKey, EMPTY_CACHE);
      throw new Error('Expected altered read-back to fail.');
    } catch (error) {
      expectStorageError(error, 'malformed-readback');
    }

    const quota = createAccountStorage({
      accountId: ACCOUNT_A,
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException('quota', 'QuotaExceededError');
        },
        removeItem: () => undefined,
      },
    });
    await expect(
      Promise.resolve().then(() => quota.setItem(quota.cacheKey, EMPTY_CACHE)),
    ).rejects.toMatchObject({
      code: 'quota',
    });

    const unavailable = createAccountStorage({
      accountId: ACCOUNT_A,
      storage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => undefined,
        removeItem: () => undefined,
      },
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
    expect(storage.getItem(first.cacheKey)).toBe(EMPTY_CACHE);
    await expect(second.flush()).rejects.toMatchObject({ code: 'interrupted' });
  });

  it('latches asynchronous failures, exposes flush, and disables stale writers safely', async () => {
    let rejectWrite: ((error: unknown) => void) | undefined;
    const onWriteFailure = vi.fn();
    const storage: StateStorage = {
      getItem: () => EMPTY_CACHE,
      setItem: () =>
        new Promise<void>((_resolve, reject) => {
          rejectWrite = reject;
        }),
      removeItem: () => undefined,
    };
    const account = createAccountStorage({ accountId: ACCOUNT_A, storage, onWriteFailure });
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
