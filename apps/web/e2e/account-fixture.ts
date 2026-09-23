import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';
import { createTrainingStore } from '@kendo-menu/store';

import { createAccountApiClient } from '../src/lib/account-api';
import { createAccountWorkspaceController } from '../src/lib/account-workspace';
import { createWorkspaceCoordinator } from '../src/lib/workspace-coordination';

// Vite development-only fixture, absent from the production entry graph. Browser storage and
// Web Locks are real; the HTTP boundary is injected and never reaches a backend/provider.
const accountId = '11111111-1111-4111-8111-111111111111';
const output = document.getElementById('result');
if (output === null) throw new Error('Fixture output missing');

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
  const coordination = createWorkspaceCoordinator();
  const controller = createAccountWorkspaceController({
    guestStore,
    storage: localStorage,
    api,
    coordination,
  });
  const bootstrap = await controller.bootstrap();
  const first = controller.getSnapshot();
  if (first.mode !== 'account') throw new Error('Expected authenticated workspace');
  first.store.getState().addToDashboard(trainingSet.id);
  const hidden = await controller.hideLocally();
  const oldReleased = first.store.getState().dashboardEntries.length === 0;
  await controller.bootstrap();
  const second = controller.getSnapshot();
  const reopened =
    second.mode === 'account' && second.store.getState().dashboardEntries.length === 1;
  controller.dispose();
  coordination.dispose();
  output.textContent = JSON.stringify({
    bootstrap: bootstrap.status,
    hidden: hidden.status,
    oldReleased,
    reopened,
    guestPreserved: localStorage.getItem('kendo-menu') === guest,
    coordination: first.coordination,
    calls,
  });
} catch {
  output.textContent = 'failed';
}
