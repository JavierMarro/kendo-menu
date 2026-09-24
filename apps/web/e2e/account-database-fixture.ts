import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';
import { createTrainingStore, serializePersistedTrainingStateV10 } from '@kendo-menu/store';

import {
  createIndexedDbAccountDatabase,
  type AccountDashboardReadResponse,
  type AccountDashboardSnapshot,
} from '../src/lib/account-database';

const accountId = '11111111-1111-4111-8111-111111111111';
const raceAccountId = '33333333-3333-4333-8333-333333333333';
const catalogueVersion = 'a'.repeat(64);
const output = document.getElementById('result');
const operationOutput = document.getElementById('operation');
if (output === null || operationOutput === null) throw new Error('Fixture output missing');
const confirmedOperationOutput: HTMLElement = operationOutput;

function snapshot(raw: string): AccountDashboardSnapshot {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || !('state' in value)) {
    throw new Error('Serialized dashboard fixture is invalid');
  }
  return { version: 10, state: value.state };
}

function persisted(store: ReturnType<typeof createTrainingStore>): string {
  return serializePersistedTrainingStateV10({
    dashboardEntries: store.getState().dashboardEntries,
  });
}

function cloud(
  revision: string,
  dashboard: AccountDashboardSnapshot | null,
): AccountDashboardReadResponse {
  return {
    transportVersion: 1,
    accountWorkspaceId: accountId,
    catalogueVersion,
    revision,
    dashboard,
    updatedAt: revision === '0' ? null : '2026-09-23T12:00:00.000Z',
  };
}

async function recoveryKeys(): Promise<string[]> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('kendo-menu-account-storage', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
  try {
    const transaction = database.transaction('records', 'readonly');
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const request = transaction.objectStore('records').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
    });
    return records.flatMap((value) =>
      typeof value === 'object' &&
      value !== null &&
      'kind' in value &&
      value.kind === 'recovery' &&
      'key' in value &&
      typeof value.key === 'string'
        ? [value.key]
        : [],
    );
  } finally {
    database.close();
  }
}

interface RacePreparation {
  readonly accountId: string;
  readonly cacheVersion: { readonly identity: string; readonly generation: number };
  readonly dashboard: AccountDashboardSnapshot;
  readonly requestId: string;
}

function installRaceEvents(
  database: ReturnType<typeof createIndexedDbAccountDatabase>,
  allowSeed: boolean,
): void {
  if (allowSeed) {
    window.addEventListener('e2e-db-seed-race', () => {
      void (async () => {
        const source = await database.readCache(accountId);
        if (source === null) throw new Error('Primary account cache missing');
        const cache = await database.migrateCacheIfAbsent(raceAccountId, source.cacheValue);
        confirmedOperationOutput.textContent = JSON.stringify({
          identity: cache.identity,
          generation: cache.generation,
          dashboard: snapshot(cache.cacheValue),
        });
      })();
    });
  }
  window.addEventListener('e2e-db-prepare-race', (event) => {
    if (!(event instanceof CustomEvent)) return;
    const input = event.detail as RacePreparation;
    void database
      .preparePendingRequest(input.accountId, input.cacheVersion, {
        kind: 'dashboard-put',
        request: {
          transportVersion: 1,
          expectedAccountWorkspaceId: input.accountId,
          expectedRevision: '0',
          requestId: input.requestId,
          catalogueVersion,
          dashboard: input.dashboard,
        },
      })
      .then((result) => {
        confirmedOperationOutput.textContent = JSON.stringify({ status: result.status });
      });
  });
  window.addEventListener('e2e-db-ack-race', (event) => {
    if (!(event instanceof CustomEvent)) return;
    const input = event.detail as { readonly accountId: string; readonly requestId: string };
    void database
      .acknowledgePendingRequest(input.accountId, input.requestId, {
        kind: 'dashboard-ack',
        acknowledgement: {
          transportVersion: 1,
          accountWorkspaceId: input.accountId,
          requestId: input.requestId,
          revision: '1',
          updatedAt: '2026-09-23T12:00:00.000Z',
        },
      })
      .then((result) => {
        confirmedOperationOutput.textContent = JSON.stringify({ status: result.status });
      });
  });
  window.addEventListener('e2e-db-baseline-race', (event) => {
    if (!(event instanceof CustomEvent)) return;
    const input = event.detail as {
      readonly cacheVersion: { readonly identity: string; readonly generation: number };
    };
    void database
      .establishCloudBaseline(raceAccountId, input.cacheVersion, {
        ...cloud('0', null),
        accountWorkspaceId: raceAccountId,
      })
      .then((result) => {
        confirmedOperationOutput.textContent = JSON.stringify({ status: result.status });
      });
  });
}

const observerMode = new URLSearchParams(location.search).get('observer') === '1';
if (observerMode) {
  const database = createIndexedDbAccountDatabase();
  output.textContent = 'observer';
  installRaceEvents(database, false);
} else
  try {
    const database = createIndexedDbAccountDatabase();
    const emptyStore = createTrainingStore({ storage: localStorage });
    const emptyRaw = persisted(emptyStore);
    const seeded = await database.migrateCacheIfAbsent(accountId, emptyRaw);
    await database.establishCloudBaseline(accountId, seeded, cloud('0', null));

    const store = createTrainingStore({ storage: localStorage });
    const firstSet = DEFAULT_TRAINING_SETS[0];
    const secondSet = DEFAULT_TRAINING_SETS[1];
    if (firstSet === undefined || secondSet === undefined)
      throw new Error('Training fixture missing');
    store.getState().addToDashboard(firstSet.id);
    const firstRaw = persisted(store);
    const firstWrite = await database.compareAndSwapCache(
      accountId,
      { identity: seeded.identity, generation: seeded.generation },
      firstRaw,
    );
    if (firstWrite.status !== 'committed' || firstWrite.record === null)
      throw new Error('Fixture cache write failed');
    const requestId = '22222222-2222-4222-8222-222222222222';
    const dashboard = snapshot(firstRaw);
    const prepared = await database.preparePendingRequest(accountId, firstWrite.record, {
      kind: 'dashboard-put',
      request: {
        transportVersion: 1,
        expectedAccountWorkspaceId: accountId,
        expectedRevision: '0',
        requestId,
        catalogueVersion,
        dashboard,
      },
    });
    if (prepared.status !== 'committed') throw new Error('Fixture pending request failed');
    const acknowledged = await database.acknowledgePendingRequest(accountId, requestId, {
      kind: 'dashboard-ack',
      acknowledgement: {
        transportVersion: 1,
        accountWorkspaceId: accountId,
        requestId,
        revision: '1',
        updatedAt: '2026-09-23T12:00:00.000Z',
      },
    });
    if (acknowledged.status !== 'committed' || acknowledged.state.pendingRequest !== null) {
      throw new Error('Fixture acknowledgement failed');
    }

    store.getState().addToDashboard(secondSet.id);
    const secondRaw = persisted(store);
    const secondWrite = await database.compareAndSwapCache(
      accountId,
      { identity: firstWrite.record.identity, generation: firstWrite.record.generation },
      secondRaw,
    );
    if (secondWrite.status !== 'committed' || secondWrite.record === null)
      throw new Error('Fixture second cache write failed');
    const conflict = await database.recordActiveConflict(
      accountId,
      { identity: secondWrite.record.identity, generation: secondWrite.record.generation },
      cloud('2', dashboard),
    );
    if (conflict.status !== 'committed' || conflict.state.activeConflict === null) {
      throw new Error('Fixture conflict creation failed');
    }
    output.textContent = 'ready';
    installRaceEvents(database, true);

    window.addEventListener('e2e-db-abort-cloud', () => {
      void (async () => {
        const conflictId = (await database.readSyncState(accountId)).activeConflict?.conflictId;
        const conflict = (await database.readSyncState(accountId)).activeConflict;
        if (conflictId === undefined || conflict === null)
          throw new Error('Fixture conflict missing');
        const prototype = IDBObjectStore.prototype;
        // Keep the native method for this one fault-injection test and restore it in finally.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const originalPut = prototype.put;
        prototype.put = function (
          this: IDBObjectStore,
          value: unknown,
          key?: IDBValidKey,
        ): IDBRequest<IDBValidKey> {
          if (
            typeof value === 'object' &&
            value !== null &&
            'key' in value &&
            value.key === `${accountId}:cache`
          ) {
            throw new DOMException('Injected quota failure', 'QuotaExceededError');
          }
          return originalPut.call(this, value, key);
        };
        let errorName = 'none';
        try {
          await database.resolveConflictUsingCloud(accountId, conflictId, conflict.cloud);
        } catch (error) {
          errorName = error instanceof DOMException ? error.name : 'Error';
        } finally {
          prototype.put = originalPut;
        }
        const state = await database.readSyncState(accountId);
        operationOutput.textContent = JSON.stringify({
          errorName,
          conflictRetained: state.activeConflict?.conflictId === conflictId,
          recoveryCount: (await recoveryKeys()).length,
          cacheGeneration: state.cache?.generation ?? null,
        });
      })();
    });

    window.addEventListener('e2e-db-resolve-cloud', () => {
      void (async () => {
        const before = await database.readSyncState(accountId);
        const conflictId = before.activeConflict?.conflictId;
        const conflict = before.activeConflict;
        if (conflictId === undefined || conflict === null)
          throw new Error('Fixture conflict missing');
        const result = await database.resolveConflictUsingCloud(
          accountId,
          conflictId,
          conflict.cloud,
        );
        const state = await database.readSyncState(accountId);
        operationOutput.textContent = JSON.stringify({
          status: result.status,
          conflictCleared: state.activeConflict === null,
          cacheMatchesCloud: state.cache?.cacheValue === firstRaw,
          recoveryCount: (await recoveryKeys()).length,
        });
      })();
    });
  } catch (error) {
    output.textContent = error instanceof Error ? `failed: ${error.message}` : 'failed';
  }
