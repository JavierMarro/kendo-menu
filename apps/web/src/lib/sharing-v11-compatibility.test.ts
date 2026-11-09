import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TrainingSetInput } from '@kendo-menu/domain';
import { createTrainingStore, serializePersistedTrainingStateV11 } from '@kendo-menu/store';

import {
  serializeDashboardWriteRequest,
  type AccountApiClient,
  type DashboardWriteRequest,
} from './account-api';
import { createGuestCopyRequest, readGuestCopySnapshot } from './account-adoption';
import { createAccountDraftController } from './account-draft';
import { TRAINING_STORAGE_KEY } from './training-persistence';
import type { WorkspaceLockProvider } from './workspace-coordination';

const ACCOUNT = '01234567-89ab-4cde-8fab-0123456789ab';
const OPPORTUNITY = '01234567-89ab-4cde-8fab-0123456789ac';
const REQUEST = '01234567-89ab-4cde-8fab-0123456789ad';
const CATALOGUE = 'a'.repeat(64);
const account = { accountId: ACCOUNT, email: 'owner@example.test' };
const CUSTOM_INPUT = {
  name: 'Shared menu',
  category: 'custom',
  sections: [{ name: 'Main work', exercises: [{ name: 'Men', quantities: { repetitions: 40 } }] }],
} satisfies TrainingSetInput;

function accountApi() {
  return {
    getSharedMenu: vi.fn<AccountApiClient['getSharedMenu']>(),
    getSharedMenuForRecipient: vi.fn<AccountApiClient['getSharedMenuForRecipient']>(),
    createMenuShare: vi.fn<AccountApiClient['createMenuShare']>(),
    getAccount: vi.fn<AccountApiClient['getAccount']>().mockResolvedValue(account),
    initializeAccount: vi
      .fn<AccountApiClient['initializeAccount']>()
      .mockResolvedValue({ ...account, created: false }),
    getDashboard: vi.fn<AccountApiClient['getDashboard']>().mockResolvedValue({
      transportVersion: 1,
      accountWorkspaceId: ACCOUNT,
      catalogueVersion: CATALOGUE,
      revision: '0',
      dashboard: null,
      updatedAt: null,
    }),
    putDashboard: vi.fn<AccountApiClient['putDashboard']>().mockImplementation((_id, request) =>
      Promise.resolve({
        transportVersion: 1,
        accountWorkspaceId: ACCOUNT,
        requestId: request.requestId,
        revision: '1',
        updatedAt: '2026-11-08T10:00:00.000Z',
      }),
    ),
    postAdoption: vi.fn<AccountApiClient['postAdoption']>(),
  };
}

beforeEach(() => {
  localStorage.clear();
  const locks: WorkspaceLockProvider = {
    request: async (name, callback) => callback({ name, mode: 'exclusive' }),
  };
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('browser v11 sharing compatibility', () => {
  it('saves account drafts as v11 and includes received provenance in the request body', async () => {
    const api = accountApi();
    const controller = createAccountDraftController({
      account,
      api,
      createRequestId: () => REQUEST,
    });
    await controller.load();
    const store = controller.getSnapshot().store;
    if (store === null) throw new Error('Expected a loaded account draft.');
    const received = store.getState().createCustomTrainingSetAndAddToDashboard(CUSTOM_INPUT, true);

    await controller.save();

    const request: DashboardWriteRequest | undefined = vi.mocked(api.putDashboard).mock
      .calls[0]?.[1];
    expect(request?.dashboard.version).toBe(11);
    expect(request?.dashboard.state.dashboardEntries[0]).toMatchObject({
      id: received.dashboardEntryId,
      receivedViaShare: true,
    });
    if (request === undefined) throw new Error('Expected the account Save request.');
    const body: unknown = JSON.parse(serializeDashboardWriteRequest(ACCOUNT, request));
    expect(body).toMatchObject({
      dashboard: {
        version: 11,
        state: { dashboardEntries: [{ receivedViaShare: true }] },
      },
    });
    controller.dispose();
  });

  it('copies a v11 guest snapshot without changing the guest source bytes', async () => {
    const store = createTrainingStore({
      storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    });
    store.getState().createCustomTrainingSetAndAddToDashboard(CUSTOM_INPUT, true);
    const raw = serializePersistedTrainingStateV11({
      dashboardEntries: store.getState().dashboardEntries,
    });
    localStorage.setItem(TRAINING_STORAGE_KEY, raw);
    const writes = vi.spyOn(localStorage, 'setItem');
    const removes = vi.spyOn(localStorage, 'removeItem');

    const snapshot = await readGuestCopySnapshot();
    expect(snapshot?.raw).toBe(raw);
    expect(snapshot?.dashboard.version).toBe(11);
    expect(snapshot?.dashboard.state.dashboardEntries[0]?.receivedViaShare).toBe(true);
    if (snapshot === null || snapshot === undefined) throw new Error('Expected valid guest data.');
    const request = createGuestCopyRequest({
      accountId: ACCOUNT,
      handoff: { ...account, created: true, copyOpportunityId: OPPORTUNITY },
      catalogueVersion: CATALOGUE,
      snapshot,
      requestId: REQUEST,
    });
    expect(request?.dashboard?.version).toBe(11);
    expect(localStorage.getItem(TRAINING_STORAGE_KEY)).toBe(raw);
    expect(writes).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
  });
});
