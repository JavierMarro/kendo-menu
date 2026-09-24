import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';
import { createTrainingStore, serializePersistedTrainingStateV10 } from '@kendo-menu/store';

import { createAccountApiClient } from '../src/lib/account-api';
import { createIndexedDbAccountDatabase } from '../src/lib/account-database';
import { createAccountWorkspaceController } from '../src/lib/account-workspace';
import { createWorkspaceCoordinator } from '../src/lib/workspace-coordination';

const accountId = '11111111-1111-4111-8111-111111111111';
const switchedAccountId = '22222222-2222-4222-8222-222222222222';
const catalogueVersion = 'a'.repeat(64);
const cloudKey = 'e2e:account-cloud';
const putCountKey = 'e2e:account-put-count';
const guestMode = new URLSearchParams(location.search).get('guest');
const loseFirstAcknowledgement = new URLSearchParams(location.search).get('loseAck') === '1';
const resultOutput = document.getElementById('result');
const operationOutput = document.getElementById('operation');
if (resultOutput === null || operationOutput === null) throw new Error('Fixture output missing');

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloudState(): {
  readonly revision: string;
  readonly dashboard: unknown;
  readonly updatedAt: string | null;
  readonly requestId: string | null;
} {
  const raw = localStorage.getItem(cloudKey);
  if (raw === null) return { revision: '0', dashboard: null, updatedAt: null, requestId: null };
  const parsed: unknown = JSON.parse(raw);
  if (
    !record(parsed) ||
    typeof parsed['revision'] !== 'string' ||
    (parsed['updatedAt'] !== null && typeof parsed['updatedAt'] !== 'string') ||
    typeof parsed['requestId'] !== 'string'
  ) {
    throw new Error('Fixture cloud state invalid');
  }
  return {
    revision: parsed['revision'],
    dashboard: parsed['dashboard'],
    updatedAt: parsed['updatedAt'],
    requestId: parsed['requestId'],
  };
}

try {
  let dashboardGetCount = 0;
  let sessionSignedOut = false;
  let networkOffline = false;
  let releaseLogout: (() => void) | undefined;
  let releaseRetrySession: (() => void) | undefined;
  let releaseSwitchSession: (() => void) | undefined;
  let rejectNextDashboardRequest = false;
  let rejectNextDashboardMalformed = false;
  let rejectNextDashboardPut = false;
  let forcePutConflictThenRejectGet = false;
  let rejectConflictFollowupGet = false;
  let sessionRequestCount = 0;
  const api = createAccountApiClient({
    readCookie: () => `__Host-kendomenu-csrf=${'A'.repeat(43)}`,
    fetch: (input, init) => {
      const path =
        typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (path === '/api/session' && init?.method === 'GET') {
        sessionRequestCount += 1;
        localStorage.setItem('e2e:account-session-count', String(sessionRequestCount));
        if (networkOffline) return Promise.reject(new TypeError('Fixture is offline'));
        if (
          sessionRequestCount > 1 &&
          new URLSearchParams(location.search).get('holdSwitchSession') !== null
        ) {
          localStorage.setItem('e2e:switch-session-held', '1');
          return new Promise<Response>((resolve, reject) => {
            releaseSwitchSession = () => {
              if (new URLSearchParams(location.search).get('holdSwitchSession') === 'offline') {
                reject(new TypeError('Fixture is offline'));
              } else {
                resolve(
                  new Response(
                    JSON.stringify({
                      userId: switchedAccountId,
                      verifiedGoogleEmail: null,
                      adoption: { status: 'unavailable', capability: false },
                    }),
                    { headers: { 'content-type': 'application/json' } },
                  ),
                );
              }
            };
          });
        }
        if (
          sessionRequestCount > 1 &&
          new URLSearchParams(location.search).get('holdRetrySession') === '1'
        ) {
          localStorage.setItem('e2e:retry-session-held', '1');
          return new Promise<Response>((resolve) => {
            releaseRetrySession = () =>
              resolve(
                new Response(
                  JSON.stringify({
                    userId: accountId,
                    verifiedGoogleEmail: null,
                    adoption: { status: 'unavailable', capability: false },
                  }),
                  { headers: { 'content-type': 'application/json' } },
                ),
              );
          });
        }
        if (
          sessionSignedOut ||
          (sessionRequestCount > 1 &&
            new URLSearchParams(location.search).get('sessionSignedOutAfter401') === '1')
        ) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), {
              status: 401,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              userId: accountId,
              verifiedGoogleEmail: null,
              adoption:
                guestMode === null
                  ? { status: 'unavailable', capability: false }
                  : { status: 'pending', capability: true },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (path === '/api/session' && init?.method === 'DELETE') {
        const logoutCount = Number(localStorage.getItem('e2e:account-logout-count') ?? '0') + 1;
        localStorage.setItem('e2e:account-logout-count', String(logoutCount));
        if (
          logoutCount === 1 &&
          new URLSearchParams(location.search).get('failFirstLogout') === '1'
        ) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'TEMPORARY_FAILURE' }), {
              status: 503,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        if (new URLSearchParams(location.search).get('holdLogout') === '1') {
          localStorage.setItem('e2e:logout-held', '1');
          return new Promise<Response>((resolve) => {
            releaseLogout = () => {
              sessionSignedOut = true;
              resolve(new Response(null, { status: 204 }));
            };
          });
        }
        sessionSignedOut = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (path === '/api/dashboard' && init?.method === 'GET') {
        dashboardGetCount += 1;
        localStorage.setItem('e2e:account-dashboard-get-count', String(dashboardGetCount));
        if (networkOffline) return Promise.reject(new TypeError('Fixture is offline'));
        if (rejectNextDashboardMalformed) {
          rejectNextDashboardMalformed = false;
          return Promise.resolve(new Response('malformed', { status: 401 }));
        }
        if (
          rejectNextDashboardRequest ||
          rejectConflictFollowupGet ||
          new URLSearchParams(location.search).get('persistentDashboard401') === '1'
        ) {
          rejectNextDashboardRequest = false;
          rejectConflictFollowupGet = false;
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), {
              status: 401,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        if (guestMode === 'appears' && dashboardGetCount === 3) {
          const set = DEFAULT_TRAINING_SETS[0];
          if (set === undefined) throw new Error('Training set fixture missing');
          guestStore.getState().addToDashboard(set.id);
        }
        const { revision, dashboard, updatedAt } = cloudState();
        return Promise.resolve(
          new Response(
            JSON.stringify({
              transportVersion: 1,
              accountWorkspaceId: accountId,
              catalogueVersion,
              revision,
              dashboard,
              updatedAt,
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (path === '/api/dashboard' && init?.method === 'PUT') {
        if (networkOffline) return Promise.reject(new TypeError('Fixture is offline'));
        if (typeof init.body !== 'string') throw new Error('Fixture PUT body missing');
        const value: unknown = JSON.parse(init.body);
        if (
          !record(value) ||
          typeof value['requestId'] !== 'string' ||
          typeof value['expectedRevision'] !== 'string' ||
          !record(value['dashboard'])
        ) {
          throw new Error('Fixture PUT shape invalid');
        }
        if (rejectNextDashboardPut) {
          rejectNextDashboardPut = false;
          return Promise.resolve(new Response('malformed', { status: 401 }));
        }
        if (forcePutConflictThenRejectGet) {
          forcePutConflictThenRejectGet = false;
          rejectConflictFollowupGet = true;
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'REVISION_CONFLICT' }), {
              status: 409,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        const current = cloudState();
        if (current.requestId === value['requestId']) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                transportVersion: 1,
                accountWorkspaceId: accountId,
                requestId: value['requestId'],
                revision: current.revision,
                updatedAt: current.updatedAt,
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        if (value['expectedRevision'] !== current.revision) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'REVISION_CONFLICT' }), {
              status: 409,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        const revision = (BigInt(current.revision) + 1n).toString();
        const updatedAt = '2026-09-23T12:00:00.000Z';
        localStorage.setItem(
          cloudKey,
          JSON.stringify({
            revision,
            dashboard: value['dashboard'],
            updatedAt,
            requestId: value['requestId'],
          }),
        );
        localStorage.setItem(
          putCountKey,
          String(Number(localStorage.getItem(putCountKey) ?? '0') + 1),
        );
        if (loseFirstAcknowledgement && localStorage.getItem('e2e:account-ack-lost') !== '1') {
          localStorage.setItem('e2e:account-ack-lost', '1');
          return new Promise<Response>(() => undefined);
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              transportVersion: 1,
              accountWorkspaceId: accountId,
              requestId: value['requestId'],
              revision,
              updatedAt,
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      throw new Error(`Unexpected fixture request: ${path}`);
    },
  });
  const database = createIndexedDbAccountDatabase();
  const raceUseCloud = new URLSearchParams(location.search).get('raceUseCloud') === '1';
  const raceFastForward = new URLSearchParams(location.search).get('raceFastForward') === '1';
  const holdReplacement = new URLSearchParams(location.search).get('holdReplacement') === '1';
  const failReplacement = new URLSearchParams(location.search).get('failReplacement') === '1';
  const offlineAfterReplacement =
    new URLSearchParams(location.search).get('offlineAfterReplacement') === '1';
  const holdLocalRehydration =
    new URLSearchParams(location.search).get('holdLocalRehydration') === '1';
  let releaseReplacement: (() => void) | undefined;
  let releaseLocalRead: (() => void) | undefined;
  let holdNextLocalRead = false;
  const tryPostCommitEdit = () => {
    const workspace = controller.getSnapshot();
    const laterSet = DEFAULT_TRAINING_SETS[1];
    if (workspace.mode !== 'account' || laterSet === undefined) {
      localStorage.setItem('e2e:late-edit', 'blocked');
      return;
    }
    workspace.store.getState().addToDashboard(laterSet.id);
    localStorage.setItem('e2e:late-edit', 'accepted');
  };
  const synchronizationDatabase =
    raceUseCloud ||
    raceFastForward ||
    holdReplacement ||
    failReplacement ||
    offlineAfterReplacement ||
    holdLocalRehydration
      ? {
          ...database,
          ...(holdLocalRehydration
            ? {
                readCache: async (...args: Parameters<typeof database.readCache>) => {
                  if (holdNextLocalRead) {
                    holdNextLocalRead = false;
                    localStorage.setItem('e2e:local-rehydration-held', '1');
                    await new Promise<void>((resolve) => {
                      releaseLocalRead = resolve;
                    });
                  }
                  return database.readCache(...args);
                },
              }
            : {}),
          ...(raceUseCloud ||
          holdReplacement ||
          failReplacement ||
          offlineAfterReplacement ||
          holdLocalRehydration
            ? {
                resolveConflictUsingCloud: async (
                  ...args: Parameters<typeof database.resolveConflictUsingCloud>
                ) => {
                  if (holdReplacement) {
                    localStorage.setItem('e2e:replacement-held', '1');
                    await new Promise<void>((resolve) => {
                      releaseReplacement = resolve;
                    });
                  }
                  if (failReplacement) {
                    throw new DOMException('Quota exhausted', 'QuotaExceededError');
                  }
                  const result = await database.resolveConflictUsingCloud(...args);
                  if (raceUseCloud) tryPostCommitEdit();
                  if (offlineAfterReplacement && result.status === 'committed') {
                    networkOffline = true;
                    localStorage.setItem('e2e:offline-after-replacement', '1');
                  }
                  if (holdLocalRehydration && result.status === 'committed') {
                    holdNextLocalRead = true;
                  }
                  return result;
                },
              }
            : {}),
          ...(raceFastForward
            ? {
                fastForwardCleanCache: async (
                  ...args: Parameters<typeof database.fastForwardCleanCache>
                ) => {
                  const result = await database.fastForwardCleanCache(...args);
                  tryPostCommitEdit();
                  return result;
                },
              }
            : {}),
          ...(raceUseCloud || raceFastForward
            ? {
                writeRecovery: () => {
                  localStorage.setItem('e2e:late-recovery-attempt', '1');
                  return Promise.reject(new DOMException('Quota exhausted', 'QuotaExceededError'));
                },
              }
            : {}),
        }
      : database;
  const guestStore = createTrainingStore({ storage: localStorage });
  if (new URLSearchParams(location.search).get('cloud') === 'existing') {
    const remoteStore = createTrainingStore({ storage: localStorage, storageKey: 'e2e:remote' });
    const remoteSet = DEFAULT_TRAINING_SETS[1];
    if (remoteSet === undefined) throw new Error('Remote training fixture missing');
    remoteStore.getState().addToDashboard(remoteSet.id);
    const raw: unknown = JSON.parse(
      serializePersistedTrainingStateV10({
        dashboardEntries: remoteStore.getState().dashboardEntries,
      }),
    );
    if (!record(raw)) throw new Error('Remote fixture cache invalid');
    localStorage.setItem(
      cloudKey,
      JSON.stringify({
        revision: '1',
        dashboard: { version: 10, state: raw['state'] },
        updatedAt: '2026-09-23T12:00:00.000Z',
        requestId: '22222222-2222-4222-8222-222222222222',
      }),
    );
  }
  if (new URLSearchParams(location.search).get('legacyEmpty') === '1') {
    localStorage.setItem(
      `kendo-menu:account:${accountId}`,
      serializePersistedTrainingStateV10({ dashboardEntries: [] }),
    );
  }
  if (guestMode === 'eligible') {
    const set = DEFAULT_TRAINING_SETS[0];
    if (set === undefined) throw new Error('Training set fixture missing');
    guestStore.getState().addToDashboard(set.id);
  } else if (guestMode === 'invalid') {
    localStorage.setItem('kendo-menu', '{broken');
  }
  const controller = createAccountWorkspaceController({
    guestStore,
    storage: localStorage,
    api,
    coordination: createWorkspaceCoordinator(),
    synchronization: {
      api,
      database: synchronizationDatabase,
      ...(new URLSearchParams(location.search).get('noSyncLock') === '1' ? { locks: null } : {}),
    },
  });
  const bootstrap = await controller.bootstrap();
  resultOutput.textContent = bootstrap.status;

  window.addEventListener('e2e-sync-edit', () => {
    void (async () => {
      const workspace = controller.getSnapshot();
      const set = DEFAULT_TRAINING_SETS[0];
      if (workspace.mode !== 'account' || set === undefined) throw new Error('Account not active');
      workspace.store.getState().addToDashboard(set.id);
      const result = await controller.checkSynchronization();
      operationOutput.textContent = result.status;
    })();
  });
  window.addEventListener('e2e-sync-reject-next-dashboard', () => {
    rejectNextDashboardRequest = true;
  });
  window.addEventListener('e2e-sync-reject-next-dashboard-malformed', () => {
    rejectNextDashboardMalformed = true;
  });
  window.addEventListener('e2e-sync-reject-next-put', () => {
    rejectNextDashboardPut = true;
  });
  window.addEventListener('e2e-sync-conflict-then-reject-get', () => {
    forcePutConflictThenRejectGet = true;
  });
  window.addEventListener('e2e-sync-retry', () => {
    void controller.retrySynchronization().then((result) => {
      operationOutput.textContent = result.status;
    });
  });
  window.addEventListener('e2e-sync-edit-second', () => {
    const workspace = controller.getSnapshot();
    const set = DEFAULT_TRAINING_SETS[1];
    if (workspace.mode !== 'account' || set === undefined) throw new Error('Account not active');
    workspace.store.getState().addToDashboard(set.id);
  });
  window.addEventListener('e2e-sync-clear', () => {
    void (async () => {
      const workspace = controller.getSnapshot();
      if (workspace.mode !== 'account') throw new Error('Account not active');
      for (const entry of workspace.store.getState().dashboardEntries) {
        workspace.store.getState().removeFromDashboard(entry.id);
      }
      const result = await controller.checkSynchronization();
      operationOutput.textContent = result.status;
    })();
  });
  const stageRemoteCloud = () => {
    const remoteStore = createTrainingStore({ storage: localStorage, storageKey: 'e2e:remote' });
    const remoteSet = DEFAULT_TRAINING_SETS[1];
    if (remoteSet === undefined) throw new Error('Remote training fixture missing');
    remoteStore.getState().addToDashboard(remoteSet.id);
    const remoteRaw = serializePersistedTrainingStateV10({
      dashboardEntries: remoteStore.getState().dashboardEntries,
    });
    const remoteValue: unknown = JSON.parse(remoteRaw);
    if (!record(remoteValue)) throw new Error('Remote fixture cache invalid');
    localStorage.setItem(
      cloudKey,
      JSON.stringify({
        revision: '1',
        dashboard: { version: 10, state: remoteValue['state'] },
        updatedAt: '2026-09-23T12:00:00.000Z',
        requestId: '22222222-2222-4222-8222-222222222222',
      }),
    );
  };
  window.addEventListener('e2e-sync-advance-cloud', () => {
    const remoteStore = createTrainingStore({
      storage: localStorage,
      storageKey: 'e2e:newer-remote',
    });
    const remoteSet = DEFAULT_TRAINING_SETS[2];
    if (remoteSet === undefined) throw new Error('Newer remote training fixture missing');
    remoteStore.getState().addToDashboard(remoteSet.id);
    const remoteRaw = serializePersistedTrainingStateV10({
      dashboardEntries: remoteStore.getState().dashboardEntries,
    });
    const remoteValue: unknown = JSON.parse(remoteRaw);
    if (!record(remoteValue)) throw new Error('Newer remote fixture cache invalid');
    localStorage.setItem('e2e:newer-cloud-raw', remoteRaw);
    localStorage.setItem(
      cloudKey,
      JSON.stringify({
        revision: '2',
        dashboard: { version: 10, state: remoteValue['state'] },
        updatedAt: '2026-09-24T12:00:00.000Z',
        requestId: '33333333-3333-4333-8333-333333333333',
      }),
    );
    operationOutput.textContent = 'advanced';
  });
  window.addEventListener('e2e-sync-stage-conflict', () => {
    void (async () => {
      const workspace = controller.getSnapshot();
      const localSet = DEFAULT_TRAINING_SETS[0];
      if (workspace.mode !== 'account' || localSet === undefined) {
        throw new Error('Conflict fixture is unavailable');
      }
      workspace.store.getState().addToDashboard(localSet.id);
      stageRemoteCloud();
      const result = await controller.checkSynchronization();
      operationOutput.textContent = result.status;
    })();
  });
  window.addEventListener('e2e-sync-stage-remote', () => {
    void (async () => {
      stageRemoteCloud();
      const result = await controller.checkSynchronization();
      operationOutput.textContent = result.status;
    })();
  });
  window.addEventListener('e2e-sync-use-cloud', () => {
    void (async () => {
      const state = await controller.readSynchronizationState();
      if (state?.activeConflict === null || state?.activeConflict === undefined) {
        throw new Error('Conflict fixture has no active conflict');
      }
      const result = await controller.useCloudVersion(state.activeConflict.conflictId);
      operationOutput.textContent = result.status;
    })();
  });
  window.addEventListener('e2e-sync-use-local', () => {
    void (async () => {
      const state = await controller.readSynchronizationState();
      if (state?.activeConflict === null || state?.activeConflict === undefined) {
        throw new Error('Conflict fixture has no active conflict');
      }
      const result = await controller.useLocalVersion(state.activeConflict.conflictId);
      operationOutput.textContent = result.status;
    })();
  });
  window.addEventListener('e2e-sync-read-mode', () => {
    operationOutput.textContent = controller.getSnapshot().mode;
  });
  window.addEventListener('e2e-sync-read-user', () => {
    const workspace = controller.getSnapshot();
    operationOutput.textContent = workspace.mode === 'account' ? workspace.userId : 'guest';
  });
  window.addEventListener('e2e-sync-bootstrap', () => {
    void controller.bootstrap().then((result) => {
      localStorage.setItem('e2e:bootstrap-result', result.status);
    });
  });
  window.addEventListener('e2e-sync-hide', () => {
    void controller.hideLocally().then((result) => {
      localStorage.setItem('e2e:hide-result', result.status);
    });
  });
  window.addEventListener('e2e-sync-logout', () => {
    void controller.logout().then((result) => {
      localStorage.setItem('e2e:logout-result', result.status);
    });
  });
  window.addEventListener('e2e-sync-release-replacement', () => releaseReplacement?.());
  window.addEventListener('e2e-sync-release-logout', () => releaseLogout?.());
  window.addEventListener('e2e-sync-release-retry-session', () => releaseRetrySession?.());
  window.addEventListener('e2e-sync-release-switch-session', () => releaseSwitchSession?.());
  window.addEventListener('e2e-sync-release-local-rehydration', () => releaseLocalRead?.());
} catch {
  resultOutput.textContent = 'failed';
}
