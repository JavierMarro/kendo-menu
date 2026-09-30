import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';
import { createTrainingStore } from '@kendo-menu/store';

import { createAccountApiClient } from '../src/lib/account-api';
import { createIndexedDbAccountDatabase } from '../src/lib/account-database';
import { deriveAccountStorageKey } from '../src/lib/account-storage';
import { createAccountWorkspaceController } from '../src/lib/account-workspace';
import { createWorkspaceCoordinator } from '../src/lib/workspace-coordination';

// Vite development-only fixture, absent from the production entry graph. Browser storage and
// Web Locks are real; the HTTP boundary is injected and never reaches a backend/provider.
const accountId = '11111111-1111-4111-8111-111111111111';
const legacyKey = deriveAccountStorageKey(accountId);
const emptyCache = JSON.stringify({ state: { dashboardEntries: [] }, version: 10 });
const output = document.getElementById('result');
if (output === null) throw new Error('Fixture output missing');
const operationOutput = document.getElementById('operation');
if (operationOutput === null) throw new Error('Fixture operation output missing');

try {
  const calls: string[] = [];
  const api = createAccountApiClient({
    fetch: (_input, init) => {
      calls.push(init?.method ?? 'GET');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            userId: accountId,
            verifiedGoogleEmail: null,
            adoption: { status: 'unavailable', capability: false },
          }),
          {
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    },
  });
  const guestStore = createTrainingStore({ storage: localStorage });
  const trainingSet = DEFAULT_TRAINING_SETS[0];
  if (trainingSet === undefined) throw new Error('Training fixture missing');
  guestStore.getState().addToDashboard(trainingSet.id);
  const guest = localStorage.getItem('kendo-menu');
  localStorage.setItem(legacyKey, emptyCache);
  const coordination = createWorkspaceCoordinator();
  const controller = createAccountWorkspaceController({
    guestStore,
    storage: localStorage,
    api,
    coordination,
  });
  const bootstrap = await controller.bootstrap();
  const database = createIndexedDbAccountDatabase();
  const migrated = (await database.readCache(accountId))?.cacheValue === emptyCache;
  const legacyRemoved = localStorage.getItem(legacyKey) === null;
  const acknowledgement = await database.readMetadata(accountId, 'ack');
  const ackUnknown =
    JSON.stringify(acknowledgement) === JSON.stringify({ version: 1, status: 'unknown' });
  const first = controller.getSnapshot();
  if (first.mode !== 'account') throw new Error('Expected authenticated workspace');
  if (new URLSearchParams(location.search).get('openOnly') !== '1') {
    first.store.getState().addToDashboard(trainingSet.id);
  }
  const hidden = await controller.hideLocally();
  const oldReleased = first.store.getState().dashboardEntries.length === 0;
  await controller.bootstrap();
  const second = controller.getSnapshot();
  const reopened =
    second.mode === 'account' && second.store.getState().dashboardEntries.length === 1;
  output.textContent = JSON.stringify({
    bootstrap: bootstrap.status,
    hidden: hidden.status,
    oldReleased,
    reopened,
    migrated,
    legacyRemoved,
    ackUnknown,
    guestPreserved: localStorage.getItem('kendo-menu') === guest,
    coordination: first.coordination,
    calls,
  });
  window.addEventListener('e2e-account-edit', () => {
    void (async () => {
      const workspace = controller.getSnapshot();
      if (workspace.mode !== 'account') throw new Error('Account fixture is not active');
      workspace.store.getState().addToDashboard(trainingSet.id);
      const result = await controller.hideLocally();
      const after = controller.getSnapshot();
      operationOutput.textContent = JSON.stringify({
        result: result.status,
        failure: after.mode === 'account' ? after.persistenceFailure : null,
      });
    })();
  });
} catch {
  output.textContent = 'failed';
}
