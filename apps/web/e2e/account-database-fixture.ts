import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';
import { parseDashboardPersistenceV10 } from '@kendo-menu/domain/dashboard-persistence';
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
  const state = parseDashboardPersistenceV10(value.state);
  if (state === null) throw new Error('Serialized dashboard fixture state is invalid');
  return { version: 10, state };
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

function installAdoptionCompletionEvent(
  database: ReturnType<typeof createIndexedDbAccountDatabase>,
): void {
  window.addEventListener('e2e-db-complete-adoption', () => {
    void (async () => {
      const acceptedAccountId = '66666666-6666-4666-8666-666666666666';
      const divergentAccountId = '77777777-7777-4777-8777-777777777777';
      const acceptedRequestId = '88888888-8888-4888-8888-888888888888';
      const divergentRequestId = '99999999-9999-4999-8999-999999999999';
      const declinedAccountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const divergentDeclineAccountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const declinedRequestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const divergentDeclineRequestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const firstSet = DEFAULT_TRAINING_SETS[0];
      if (firstSet === undefined) throw new Error('Training fixture missing');
      const guestStore = createTrainingStore({
        storage: localStorage,
        storageKey: 'e2e-adoption-guest',
      });
      guestStore.getState().addToDashboard(firstSet.id);
      const guestRaw = persisted(guestStore);
      const guestDashboard = snapshot(guestRaw);
      const emptyRaw = serializePersistedTrainingStateV10({ dashboardEntries: [] });
      const timestamp = '2026-09-30T10:00:00.000Z';

      const prepare = async (targetAccountId: string, requestId: string) => {
        const cache = await database.migrateCacheIfAbsent(targetAccountId, emptyRaw);
        const prepared = await database.preparePendingRequest(targetAccountId, cache, {
          kind: 'adoption',
          request: {
            decision: 'yes',
            transportVersion: 1,
            expectedAccountWorkspaceId: targetAccountId,
            expectedRevision: '0',
            requestId,
            catalogueVersion,
            dashboard: guestDashboard,
          },
        });
        if (prepared.status !== 'committed') throw new Error('Adoption fixture preparation failed');
        return cache;
      };

      await prepare(acceptedAccountId, acceptedRequestId);
      const accepted = await database.completeAcceptedAdoption(
        acceptedAccountId,
        acceptedRequestId,
        '1',
        timestamp,
      );
      const divergentCache = await prepare(divergentAccountId, divergentRequestId);
      const changed = await database.compareAndSwapCache(
        divergentAccountId,
        divergentCache,
        guestRaw,
      );
      if (changed.status !== 'committed') throw new Error('Divergent fixture cache write failed');
      const divergent = await database.completeAcceptedAdoption(
        divergentAccountId,
        divergentRequestId,
        '1',
        timestamp,
      );

      const prepareNo = async (targetAccountId: string, requestId: string) => {
        const cache = await database.migrateCacheIfAbsent(targetAccountId, emptyRaw);
        const prepared = await database.preparePendingRequest(targetAccountId, cache, {
          kind: 'adoption',
          request: {
            decision: 'no',
            transportVersion: 1,
            expectedAccountWorkspaceId: targetAccountId,
            requestId,
          },
        });
        if (prepared.status !== 'committed') throw new Error('Decline fixture preparation failed');
        return cache;
      };
      await prepareNo(declinedAccountId, declinedRequestId);
      const declined = await database.acknowledgePendingRequest(
        declinedAccountId,
        declinedRequestId,
        { kind: 'adoption-declined', requestId: declinedRequestId },
      );
      const divergentDeclineCache = await prepareNo(
        divergentDeclineAccountId,
        divergentDeclineRequestId,
      );
      const changedDecline = await database.compareAndSwapCache(
        divergentDeclineAccountId,
        divergentDeclineCache,
        guestRaw,
      );
      if (changedDecline.status !== 'committed')
        throw new Error('Divergent decline fixture cache write failed');
      const divergentDecline = await database.acknowledgePendingRequest(
        divergentDeclineAccountId,
        divergentDeclineRequestId,
        { kind: 'adoption-declined', requestId: divergentDeclineRequestId },
      );
      confirmedOperationOutput.textContent = JSON.stringify({
        guestRaw,
        emptyRaw,
        accepted: {
          status: accepted.status,
          cacheValue: accepted.state.cache?.cacheValue ?? null,
          acknowledgement: accepted.state.acknowledgement,
          pending: accepted.state.pendingRequest,
        },
        divergent: {
          status: divergent.status,
          cacheValue: divergent.state.cache?.cacheValue ?? null,
          pending: divergent.state.pendingRequest,
        },
        declined: {
          status: declined.status,
          cacheValue: declined.state.cache?.cacheValue ?? null,
          acknowledgement: declined.state.acknowledgement,
          pending: declined.state.pendingRequest,
        },
        divergentDecline: {
          status: divergentDecline.status,
          cacheValue: divergentDecline.state.cache?.cacheValue ?? null,
          pending: divergentDecline.state.pendingRequest,
        },
      });
    })();
  });
}

function installAuthoritativeReconciliationEvent(
  database: ReturnType<typeof createIndexedDbAccountDatabase>,
): void {
  window.addEventListener('e2e-db-reconcile-adoption', () => {
    void (async () => {
      const acceptedAccountId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      const advancedAccountId = '17171717-1717-4717-8717-171717171717';
      const declinedAccountId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      const failureAccountId = '12121212-1212-4212-8212-121212121212';
      const acceptedReadbackAccountId = '15151515-1515-4515-8515-151515151515';
      const declinedReadbackAccountId = '16161616-1616-4616-8616-161616161616';
      const losingRequestId = '13131313-1313-4313-8313-131313131313';
      const winningRequestId = '14141414-1414-4414-8414-141414141414';
      const timestamp = '2026-09-30T10:00:00.000Z';
      const first = DEFAULT_TRAINING_SETS[0];
      const second = DEFAULT_TRAINING_SETS[1];
      if (first === undefined || second === undefined) throw new Error('Training fixture missing');
      const losingStore = createTrainingStore({ storage: localStorage, storageKey: 'e2e-losing' });
      losingStore.getState().addToDashboard(first.id);
      const cloudStore = createTrainingStore({ storage: localStorage, storageKey: 'e2e-winning' });
      cloudStore.getState().addToDashboard(second.id);
      const losingRaw = persisted(losingStore);
      const winningRaw = persisted(cloudStore);
      const emptyRaw = serializePersistedTrainingStateV10({ dashboardEntries: [] });
      const prepare = async (targetAccountId: string) => {
        const cache = await database.migrateCacheIfAbsent(targetAccountId, emptyRaw);
        const result = await database.preparePendingRequest(targetAccountId, cache, {
          kind: 'adoption',
          request: {
            decision: 'yes',
            transportVersion: 1,
            expectedAccountWorkspaceId: targetAccountId,
            expectedRevision: '0',
            requestId: losingRequestId,
            catalogueVersion,
            dashboard: snapshot(losingRaw),
          },
        });
        if (result.status !== 'committed') throw new Error('Pending fixture preparation failed');
      };
      await prepare(acceptedAccountId);
      await prepare(advancedAccountId);
      await prepare(declinedAccountId);
      await prepare(failureAccountId);
      await prepare(acceptedReadbackAccountId);
      const declinedReadbackCache = await database.migrateCacheIfAbsent(
        declinedReadbackAccountId,
        emptyRaw,
      );
      const declinedReadbackPrepared = await database.preparePendingRequest(
        declinedReadbackAccountId,
        declinedReadbackCache,
        {
          kind: 'adoption',
          request: {
            decision: 'no',
            transportVersion: 1,
            expectedAccountWorkspaceId: declinedReadbackAccountId,
            requestId: losingRequestId,
          },
        },
      );
      if (declinedReadbackPrepared.status !== 'committed')
        throw new Error('Decline readback fixture preparation failed');
      const accepted = await database.reconcileAuthoritativeAdoption(acceptedAccountId, {
        decision: 'yes',
        requestId: winningRequestId,
        acknowledgedRevision: '1',
        timestamp,
        cloud: {
          transportVersion: 1,
          accountWorkspaceId: acceptedAccountId,
          catalogueVersion,
          revision: '1',
          dashboard: snapshot(winningRaw),
          updatedAt: timestamp,
        },
      });
      const advanced = await database.reconcileAuthoritativeAdoption(advancedAccountId, {
        decision: 'yes',
        requestId: winningRequestId,
        acknowledgedRevision: '1',
        timestamp,
        cloud: {
          transportVersion: 1,
          accountWorkspaceId: advancedAccountId,
          catalogueVersion,
          revision: '2',
          dashboard: snapshot(winningRaw),
          updatedAt: '2026-09-30T10:01:00.000Z',
        },
      });
      const declined = await database.reconcileAuthoritativeAdoption(declinedAccountId, {
        decision: 'no',
        requestId: winningRequestId,
      });
      const prototype = IDBObjectStore.prototype;
      // Preserve the native method so this fault affects only the selected ack write.
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
          value.key === `${failureAccountId}:ack`
        ) {
          throw new DOMException('Injected quota failure', 'QuotaExceededError');
        }
        return originalPut.call(this, value, key);
      };
      let failureName = 'none';
      try {
        await database.reconcileAuthoritativeAdoption(failureAccountId, {
          decision: 'no',
          requestId: winningRequestId,
        });
      } catch (error) {
        failureName = error instanceof DOMException ? error.name : 'Error';
      } finally {
        prototype.put = originalPut;
      }
      const failedState = await database.readSyncState(failureAccountId);
      const failReadback = async (targetAccountId: string, action: () => Promise<unknown>) => {
        // Once the acknowledgement is queued, fail the same transaction's readback.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const nativePut = prototype.put;
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const nativeGet = prototype.get;
        let acknowledgementQueued = false;
        prototype.put = function (
          this: IDBObjectStore,
          value: unknown,
          key?: IDBValidKey,
        ): IDBRequest<IDBValidKey> {
          if (
            typeof value === 'object' &&
            value !== null &&
            'key' in value &&
            value.key === `${targetAccountId}:ack`
          )
            acknowledgementQueued = true;
          return nativePut.call(this, value, key);
        };
        prototype.get = function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
          if (acknowledgementQueued && query === `${targetAccountId}:cache`)
            throw new DOMException('Injected readback failure', 'UnknownError');
          return nativeGet.call(this, query);
        };
        let errorName = 'none';
        try {
          await action();
        } catch (error) {
          errorName = error instanceof DOMException ? error.name : 'Error';
        } finally {
          prototype.put = nativePut;
          prototype.get = nativeGet;
        }
        const state = await database.readSyncState(targetAccountId);
        return {
          errorName,
          cacheValue: state.cache?.cacheValue ?? null,
          acknowledgement: state.acknowledgement,
          pending: state.pendingRequest,
        };
      };
      const acceptedReadback = await failReadback(acceptedReadbackAccountId, () =>
        database.completeAcceptedAdoption(
          acceptedReadbackAccountId,
          losingRequestId,
          '1',
          timestamp,
        ),
      );
      const declinedReadback = await failReadback(declinedReadbackAccountId, () =>
        database.acknowledgePendingRequest(declinedReadbackAccountId, losingRequestId, {
          kind: 'adoption-declined',
          requestId: losingRequestId,
        }),
      );
      confirmedOperationOutput.textContent = JSON.stringify({
        losingRaw,
        winningRaw,
        emptyRaw,
        accepted: {
          status: accepted.status,
          cacheValue: accepted.state.cache?.cacheValue ?? null,
          acknowledgement: accepted.state.acknowledgement,
          pending: accepted.state.pendingRequest,
        },
        advanced: {
          status: advanced.status,
          cacheValue: advanced.state.cache?.cacheValue ?? null,
          acknowledgement: advanced.state.acknowledgement,
          pending: advanced.state.pendingRequest,
        },
        declined: {
          status: declined.status,
          cacheValue: declined.state.cache?.cacheValue ?? null,
          acknowledgement: declined.state.acknowledgement,
          pending: declined.state.pendingRequest,
        },
        failure: {
          name: failureName,
          cacheValue: failedState.cache?.cacheValue ?? null,
          acknowledgement: failedState.acknowledgement,
          pending: failedState.pendingRequest,
        },
        acceptedReadback,
        declinedReadback,
      });
    })();
  });
}

const observerMode = new URLSearchParams(location.search).get('observer') === '1';
if (observerMode) {
  const database = createIndexedDbAccountDatabase();
  output.textContent = 'observer';
  installRaceEvents(database, false);
  installAdoptionCompletionEvent(database);
  installAuthoritativeReconciliationEvent(database);
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
    installAdoptionCompletionEvent(database);
    installAuthoritativeReconciliationEvent(database);

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
