import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';
import { encodeDashboardPersistenceV10 } from '@kendo-menu/domain/dashboard-persistence';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountApiError, type AccountApiClient, type DashboardWriteRequest } from './account-api';
import { createAccountDraftController } from './account-draft';

const ACCOUNT = '01234567-89ab-4cde-8fab-0123456789ab';
const OTHER = '01234567-89ab-4cde-8fab-0123456789ac';
const REQUEST = '01234567-89ab-4cde-8fab-0123456789ad';
const OPPORTUNITY = '01234567-89ab-4cde-8fab-0123456789ae';
const account = { accountId: ACCOUNT, email: 'practitioner@example.test' };
const catalogue = 'a'.repeat(64);
const declineRequest = () => ({
  transportVersion: 1 as const,
  decision: 'no' as const,
  expectedAccountWorkspaceId: ACCOUNT,
  copyOpportunityId: OPPORTUNITY,
  requestId: REQUEST,
});
function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (error: Error) => reject?.(error),
  };
}
function fixture() {
  const api = {
    getAccount: vi.fn<AccountApiClient['getAccount']>().mockResolvedValue(account),
    initializeAccount: vi
      .fn<AccountApiClient['initializeAccount']>()
      .mockResolvedValue({ ...account, created: false }),
    getDashboard: vi.fn<AccountApiClient['getDashboard']>().mockResolvedValue({
      transportVersion: 1,
      accountWorkspaceId: ACCOUNT,
      catalogueVersion: catalogue,
      revision: '0',
      dashboard: null,
      updatedAt: null,
    }),
    putDashboard: vi
      .fn<AccountApiClient['putDashboard']>()
      .mockImplementation((_accountId, request) =>
        Promise.resolve({
          transportVersion: 1,
          accountWorkspaceId: ACCOUNT,
          requestId: request.requestId,
          revision: String(BigInt(request.expectedRevision) + 1n),
          updatedAt: '2026-10-07T10:00:00.000Z',
        }),
      ),
    postAdoption: vi
      .fn<AccountApiClient['postAdoption']>()
      .mockImplementation((_accountId, request) =>
        Promise.resolve(
          request.decision === 'no'
            ? {
                status: 'declined',
                completion: { decision: 'no', requestId: request.requestId },
              }
            : {
                status: 'accepted',
                completion: {
                  decision: 'yes',
                  requestId: request.requestId,
                  acknowledgedRevision: '1',
                  timestamp: '2026-10-07T10:00:00.000Z',
                },
                acknowledgement: {
                  transportVersion: 1,
                  accountWorkspaceId: ACCOUNT,
                  requestId: request.requestId,
                  revision: '1',
                  updatedAt: '2026-10-07T10:00:00.000Z',
                },
              },
        ),
      ),
  };
  const rejected = vi.fn();
  const changed = vi.fn();
  const controller = createAccountDraftController({
    account,
    api,
    initialization: { ...account, created: true, copyOpportunityId: OPPORTUNITY },
    onAuthenticationRejected: rejected,
    onIdentityChanged: changed,
    createRequestId: () => REQUEST,
  });
  const add = () => {
    const trainingSet = DEFAULT_TRAINING_SETS[0];
    const store = controller.getSnapshot().store;
    if (trainingSet === undefined || store === null) throw new Error('Expected ready fixture.');
    return store.getState().addToDashboard(trainingSet.id);
  };
  return { api, controller, add, rejected, changed };
}
afterEach(() => vi.restoreAllMocks());

describe('memory-only account draft lifecycle', () => {
  it('releases the creation handoff once a decline is dispatched and reloads the authoritative dashboard', async () => {
    const { controller, api } = fixture();
    await controller.load();
    controller.setEditingBlocked(true);
    expect(controller.getSnapshot().canEdit).toBe(false);
    expect(await controller.submitAdoption(declineRequest())).toBe('declined');
    expect(api.postAdoption).toHaveBeenCalledTimes(1);
    expect(api.postAdoption.mock.calls[0]?.[1]).toEqual(declineRequest());
    expect(api.getDashboard).toHaveBeenCalledTimes(2);
    expect(controller.getCreationHandoff()).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', canEdit: false });
    controller.setEditingBlocked(false);
    expect(controller.getSnapshot().canEdit).toBe(true);
    expect(await controller.submitAdoption(declineRequest())).toBe('stale');
    expect(api.postAdoption).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('does not replay an unconfirmed copy attempt and still refreshes the cloud dashboard', async () => {
    const { controller, api, add } = fixture();
    await controller.load();
    const serverEntryId = add();
    const serverEntries = controller.getSnapshot().store?.getState().dashboardEntries;
    if (serverEntries === undefined) throw new Error('Expected a server fixture entry.');
    const latest = encodeDashboardPersistenceV10({ dashboardEntries: serverEntries });
    api.postAdoption.mockRejectedValueOnce(new AccountApiError('network', 'Unavailable'));
    api.getDashboard.mockResolvedValueOnce({
      transportVersion: 1,
      accountWorkspaceId: ACCOUNT,
      catalogueVersion: catalogue,
      revision: '4',
      dashboard: { version: 10, state: latest },
      updatedAt: '2026-10-07T10:00:00.000Z',
    });
    expect(await controller.submitAdoption(declineRequest())).toBe('unconfirmed');
    expect(api.postAdoption).toHaveBeenCalledTimes(1);
    expect(api.getDashboard).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toMatchObject({ revision: '4', status: 'ready' });
    expect(controller.getSnapshot().store?.getState().dashboardEntries[0]?.id).toBe(serverEntryId);
    expect(controller.getCreationHandoff()).toBeNull();
    expect(await controller.submitAdoption(declineRequest())).toBe('stale');
    expect(api.postAdoption).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('fences a late adoption acknowledgement after identity uncertainty', async () => {
    const { controller, api, changed } = fixture();
    await controller.load();
    const response = deferred<Awaited<ReturnType<AccountApiClient['postAdoption']>>>();
    api.postAdoption.mockReturnValueOnce(response.promise);
    const attempt = controller.submitAdoption(declineRequest());
    await vi.waitFor(() => expect(api.postAdoption).toHaveBeenCalledTimes(1));
    expect(controller.getSnapshot()).toMatchObject({
      status: 'loading',
      store: null,
      canEdit: false,
    });
    expect(await controller.submitAdoption(declineRequest())).toBe('stale');
    expect(api.postAdoption).toHaveBeenCalledTimes(1);
    controller.hideForIdentityUncertainty();
    response.resolve({
      status: 'declined',
      completion: { decision: 'no', requestId: REQUEST },
    });
    expect(await attempt).toBe('stale');
    expect(controller.getSnapshot().status).toBe('auth-hidden');
    expect(api.getDashboard).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('releases the offer when verified identity changes before the decision is sent', async () => {
    const { controller, api, changed } = fixture();
    await controller.load();
    api.getAccount.mockResolvedValueOnce({ accountId: OTHER, email: null });
    expect(await controller.submitAdoption(declineRequest())).toBe('abandoned');
    expect(api.postAdoption).not.toHaveBeenCalled();
    expect(controller.getCreationHandoff()).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('releases the offer when identity uncertainty cancels pre-dispatch verification', async () => {
    const { controller, api } = fixture();
    await controller.load();
    const identity = deferred<Awaited<ReturnType<AccountApiClient['getAccount']>>>();
    api.getAccount.mockReturnValueOnce(identity.promise);
    const attempt = controller.submitAdoption(declineRequest());
    await vi.waitFor(() => expect(api.getAccount).toHaveBeenCalledTimes(2));
    controller.hideForIdentityUncertainty();
    identity.resolve(account);
    expect(await attempt).toBe('abandoned');
    expect(api.postAdoption).not.toHaveBeenCalled();
    expect(controller.getCreationHandoff()).toBeNull();
    expect(controller.getSnapshot().status).toBe('auth-hidden');
    expect(controller.revealForVerifiedAccount(account)).toBe(true);
    expect(controller.getCreationHandoff()).toBeNull();
    controller.dispose();
  });

  it('keeps editing blocked after authoritative load failure until an ordinary reload succeeds', async () => {
    const { controller, api } = fixture();
    await controller.load();
    controller.setEditingBlocked(true);
    api.getDashboard.mockRejectedValueOnce(new AccountApiError('network', 'Unavailable'));
    expect(await controller.submitAdoption(declineRequest())).toBe('declined');
    expect(controller.getSnapshot()).toMatchObject({ status: 'load-error', canEdit: false });
    await controller.loadAuthoritativeDashboard();
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', canEdit: false });
    controller.setEditingBlocked(false);
    expect(controller.getSnapshot().canEdit).toBe(true);
    controller.dispose();
  });

  it('installs the authoritative dashboard after a failed adoption refresh and same-account verification', async () => {
    const { controller, api, add } = fixture();
    await controller.load();
    add();
    api.getDashboard.mockRejectedValueOnce(new AccountApiError('network', 'Unavailable'));
    expect(await controller.submitAdoption(declineRequest())).toBe('declined');
    expect(controller.getSnapshot()).toMatchObject({ status: 'load-error', revision: '0' });

    controller.hideForIdentityUncertainty();
    expect(controller.revealForVerifiedAccount(account)).toBe(false);
    expect(controller.getSnapshot().canEdit).toBe(false);
    api.getDashboard.mockResolvedValueOnce({
      transportVersion: 1,
      accountWorkspaceId: ACCOUNT,
      catalogueVersion: catalogue,
      revision: '5',
      dashboard: { version: 10, state: { dashboardEntries: [] } },
      updatedAt: '2026-10-07T10:00:00.000Z',
    });
    await controller.checkAvailability();

    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      revision: '5',
      dirty: false,
      canEdit: true,
    });
    expect(controller.getSnapshot().store?.getState().dashboardEntries).toEqual([]);
    expect(api.getDashboard).toHaveBeenCalledTimes(3);
    controller.dispose();
  });

  it('keeps the post-decision load gate closed across repeated failures and unconfirmed decisions', async () => {
    const { controller, api } = fixture();
    await controller.load();
    api.postAdoption.mockRejectedValueOnce(new AccountApiError('network', 'Unavailable'));
    api.getDashboard.mockRejectedValueOnce(new AccountApiError('network', 'Unavailable'));
    expect(await controller.submitAdoption(declineRequest())).toBe('unconfirmed');
    expect(api.postAdoption).toHaveBeenCalledTimes(1);

    controller.hideForIdentityUncertainty();
    expect(controller.revealForVerifiedAccount(account)).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'load-error',
      store: null,
      canEdit: false,
    });
    controller.setOnline(false);
    expect(controller.getSnapshot()).toMatchObject({ status: 'load-error', canEdit: false });
    controller.setOnline(true);
    expect(controller.getSnapshot()).toMatchObject({ status: 'load-error', canEdit: false });
    api.getDashboard.mockRejectedValueOnce(new AccountApiError('network', 'Unavailable'));
    await controller.checkAvailability();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'load-error',
      store: null,
      canEdit: false,
    });
    api.getDashboard.mockResolvedValueOnce({
      transportVersion: 1,
      accountWorkspaceId: ACCOUNT,
      catalogueVersion: catalogue,
      revision: '0',
      dashboard: null,
      updatedAt: null,
    });
    await controller.checkAvailability();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      revision: '0',
      dirty: false,
      canEdit: true,
    });
    expect(controller.getSnapshot().store?.getState().dashboardEntries).toEqual([]);
    expect(api.postAdoption).toHaveBeenCalledTimes(1);
    expect(api.getDashboard).toHaveBeenCalledTimes(4);
    controller.dispose();
  });

  it('does not let a canceled authoritative response overwrite a newer dashboard draft', async () => {
    const { controller, api, add } = fixture();
    await controller.load();
    add();
    api.getDashboard.mockRejectedValueOnce(new AccountApiError('network', 'Unavailable'));
    expect(await controller.submitAdoption(declineRequest())).toBe('declined');

    const lateResponse = deferred<Awaited<ReturnType<AccountApiClient['getDashboard']>>>();
    api.getDashboard.mockReturnValueOnce(lateResponse.promise);
    const retry = controller.checkAvailability();
    await vi.waitFor(() => expect(api.getDashboard).toHaveBeenCalledTimes(3));
    controller.hideForIdentityUncertainty();
    expect(controller.revealForVerifiedAccount(account)).toBe(false);
    api.getDashboard.mockResolvedValueOnce({
      transportVersion: 1,
      accountWorkspaceId: ACCOUNT,
      catalogueVersion: catalogue,
      revision: '9',
      dashboard: { version: 10, state: { dashboardEntries: [] } },
      updatedAt: '2026-10-07T10:00:00.000Z',
    });
    await controller.checkAvailability();
    const currentStore = controller.getSnapshot().store;
    if (currentStore === null) throw new Error('Expected the current dashboard.');
    const trainingSet = DEFAULT_TRAINING_SETS[0];
    if (trainingSet === undefined) throw new Error('Expected a training set fixture.');
    const currentEntry = currentStore.getState().addToDashboard(trainingSet.id);
    currentStore.getState().updateDashboardEntry(currentEntry, { notes: 'new draft' });
    lateResponse.resolve({
      transportVersion: 1,
      accountWorkspaceId: ACCOUNT,
      catalogueVersion: catalogue,
      revision: '8',
      dashboard: { version: 10, state: { dashboardEntries: [] } },
      updatedAt: '2026-10-07T10:00:00.000Z',
    });
    await retry;
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      canEdit: true,
      revision: '9',
      dirty: true,
    });
    expect(controller.getSnapshot().store?.getState().dashboardEntries[0]?.notes).toBe('new draft');
    controller.dispose();
  });

  it('installs accepted-copy contents and their actual later revision', async () => {
    const { controller, api, add } = fixture();
    await controller.load();
    const entry = add();
    controller
      .getSnapshot()
      .store?.getState()
      .updateDashboardEntry(entry, { notes: 'stale local content' });
    const current = controller.getSnapshot().store?.getState().dashboardEntries;
    if (current === undefined) throw new Error('Expected a dashboard fixture.');
    const server = encodeDashboardPersistenceV10({
      dashboardEntries: current.map((item) => ({ ...item, notes: 'accepted copy content' })),
    });
    api.getDashboard.mockResolvedValueOnce({
      transportVersion: 1,
      accountWorkspaceId: ACCOUNT,
      catalogueVersion: catalogue,
      revision: '7',
      dashboard: { version: 10, state: server },
      updatedAt: '2026-10-07T10:00:00.000Z',
    });
    expect(
      await controller.submitAdoption({
        ...declineRequest(),
        decision: 'yes',
        expectedRevision: '0',
        catalogueVersion: catalogue,
        dashboard: { version: 10, state: server },
      }),
    ).toBe('accepted');
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', revision: '7' });
    expect(controller.getSnapshot().store?.getState().dashboardEntries[0]?.notes).toBe(
      'accepted copy content',
    );
    controller.dispose();
  });

  it('loads an empty account without inventing menus, writing browser storage or saving automatically', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    const { controller, api } = fixture();
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      revision: '0',
      dirty: false,
      canEdit: true,
    });
    expect(controller.getSnapshot().store?.getState().dashboardEntries).toEqual([]);
    expect(api.initializeAccount).not.toHaveBeenCalled();
    expect(api.putDashboard).not.toHaveBeenCalled();
    expect(local).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('restarts an interrupted initial load after same-account verification and fences the old response', async () => {
    const { controller, api } = fixture();
    const firstRead = deferred<Awaited<ReturnType<AccountApiClient['getDashboard']>>>();
    api.getDashboard.mockReturnValueOnce(firstRead.promise);
    const firstLoad = controller.load();
    await vi.waitFor(() => expect(api.getDashboard).toHaveBeenCalledTimes(1));
    controller.hideForIdentityUncertainty();
    expect(controller.getSnapshot().store).toBeNull();
    controller.revealForVerifiedAccount(account);
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('ready'));
    expect(api.getDashboard).toHaveBeenCalledTimes(2);
    firstRead.resolve({
      transportVersion: 1,
      accountWorkspaceId: ACCOUNT,
      catalogueVersion: catalogue,
      revision: '19',
      dashboard: { version: 10, state: { dashboardEntries: [] } },
      updatedAt: '2026-10-07T10:00:00.000Z',
    });
    await firstLoad;
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', revision: '0' });
    controller.dispose();
  });

  it('acknowledges only the submitted snapshot while later edits remain dirty', async () => {
    const { controller, api, add } = fixture();
    await controller.load();
    const entry = add();
    const waiting = deferred<Awaited<ReturnType<AccountApiClient['putDashboard']>>>();
    api.putDashboard.mockReturnValueOnce(waiting.promise);
    const saving = controller.save();
    await vi.waitFor(() => expect(api.putDashboard).toHaveBeenCalledTimes(1));
    const request = api.putDashboard.mock.calls[0]?.[1];
    if (request === undefined) throw new Error('Expected submitted snapshot.');
    expect(Object.isFrozen(request.dashboard.state.dashboardEntries)).toBe(true);
    controller.getSnapshot().store?.getState().updateDashboardEntry(entry, { notes: 'Later edit' });
    waiting.resolve({
      transportVersion: 1,
      accountWorkspaceId: ACCOUNT,
      requestId: REQUEST,
      revision: '1',
      updatedAt: '2026-10-07T10:00:00.000Z',
    });
    await saving;
    expect(controller.getSnapshot()).toMatchObject({
      revision: '1',
      dirty: true,
      saveState: 'saved',
    });
    expect(request.dashboard.state.dashboardEntries[0]?.notes).toBe('');
    expect(controller.getSnapshot().store?.getState().dashboardEntries[0]?.notes).toBe(
      'Later edit',
    );
    controller.dispose();
  });

  it('retries an ambiguous Save with identical request ID/envelope despite later edits', async () => {
    const { controller, api, add } = fixture();
    await controller.load();
    const entry = add();
    api.putDashboard.mockRejectedValueOnce(new AccountApiError('network', 'Unavailable'));
    await controller.save();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'unavailable',
      saveState: 'uncertain',
      dirty: true,
      canEdit: false,
    });
    const first = JSON.stringify(api.putDashboard.mock.calls[0]?.[1]);
    expect(controller.getCreationHandoff()).toBeNull();
    await controller.checkAvailability();
    controller
      .getSnapshot()
      .store?.getState()
      .updateDashboardEntry(entry, { notes: 'Unsubmitted edit' });
    await controller.save();
    expect(api.putDashboard).toHaveBeenCalledTimes(1);
    await controller.retrySave();
    expect(JSON.stringify(api.putDashboard.mock.calls[1]?.[1])).toBe(first);
    expect(controller.getSnapshot()).toMatchObject({ revision: '1', dirty: true });
    controller.dispose();
  });

  it('preserves conflict drafts and original revision until successful explicit reload', async () => {
    const { controller, api, add } = fixture();
    await controller.load();
    add();
    api.putDashboard.mockRejectedValueOnce(
      new AccountApiError('http', 'Conflict', { status: 409, code: 'REVISION_CONFLICT' }),
    );
    await controller.save();
    expect(controller.getSnapshot()).toMatchObject({
      saveState: 'conflict',
      revision: '0',
      dirty: true,
    });
    expect(controller.getCreationHandoff()).toBeNull();
    await controller.save();
    expect(api.putDashboard).toHaveBeenCalledTimes(1);
    api.getDashboard.mockRejectedValueOnce(new AccountApiError('network', 'Unavailable'));
    await controller.reload();
    expect(controller.getSnapshot().store?.getState().dashboardEntries).toHaveLength(1);
    expect(controller.getSnapshot().dirty).toBe(true);
    await controller.reload();
    expect(controller.getSnapshot()).toMatchObject({
      revision: '0',
      dirty: false,
      saveState: 'idle',
    });
    expect(controller.getSnapshot().store?.getState().dashboardEntries).toHaveLength(0);
    controller.dispose();
  });

  it('hides a retained draft when reload cannot verify identity, without replacing it', async () => {
    const { controller, api, add } = fixture();
    await controller.load();
    add();
    api.getAccount.mockRejectedValueOnce(new AccountApiError('network', 'Unavailable'));
    await controller.reload();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'auth-hidden',
      store: null,
      dirty: true,
      revision: '0',
      canEdit: false,
    });
    expect(api.getDashboard).toHaveBeenCalledTimes(1);
    await controller.checkAvailability();
    expect(controller.getSnapshot().store?.getState().dashboardEntries).toHaveLength(1);
    expect(controller.getSnapshot().dirty).toBe(true);
    controller.dispose();
  });

  it('hides a 401 draft and reveals only the same verified account with its revision and retry envelope', async () => {
    const { controller, api, add, rejected } = fixture();
    await controller.load();
    add();
    api.putDashboard.mockRejectedValueOnce(
      new AccountApiError('http', 'Unauthorized', { status: 401 }),
    );
    await controller.save();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'auth-hidden',
      store: null,
      dirty: true,
      revision: '0',
    });
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(() => controller.download()).toThrow();
    expect(controller.revealForVerifiedAccount({ ...account, accountId: OTHER })).toBe(false);
    expect(controller.getSnapshot().store).toBeNull();
    expect(controller.revealForVerifiedAccount(account)).toBe(true);
    await controller.retrySave();
    expect(api.putDashboard.mock.calls[1]?.[1]).toEqual(api.putDashboard.mock.calls[0]?.[1]);
    expect(controller.getSnapshot()).toMatchObject({ revision: '1', dirty: false });
    controller.dispose();
  });

  it('fences ignored aborts and late acknowledgements after sign-out without changing another account', async () => {
    const { controller, api, add } = fixture();
    await controller.load();
    add();
    const waiting = deferred<Awaited<ReturnType<AccountApiClient['putDashboard']>>>();
    api.putDashboard.mockReturnValueOnce(waiting.promise);
    const saving = controller.save();
    await vi.waitFor(() => expect(api.putDashboard).toHaveBeenCalledTimes(1));
    controller.discard();
    waiting.resolve({
      transportVersion: 1,
      accountWorkspaceId: ACCOUNT,
      requestId: REQUEST,
      revision: '1',
      updatedAt: '2026-10-07T10:00:00.000Z',
    });
    await saving;
    expect(controller.getSnapshot()).toMatchObject({
      status: 'disposed',
      store: null,
      dirty: false,
      revision: '0',
    });
    expect(controller.getCreationHandoff()).toBeNull();
  });

  it('rejects stale captured mutations while unavailable and never resumes editing merely on an online event', async () => {
    const { controller, api, add } = fixture();
    await controller.load();
    add();
    const remove = controller.getSnapshot().store?.getState().removeFromDashboard;
    const entry = controller.getSnapshot().store?.getState().dashboardEntries[0];
    if (remove === undefined || entry === undefined) throw new Error('Expected captured action.');
    controller.setOnline(false);
    expect(() => remove(entry.id)).toThrow('Account editing is unavailable');
    controller.setOnline(true);
    expect(controller.getSnapshot().canEdit).toBe(false);
    expect(api.putDashboard).not.toHaveBeenCalled();
    await controller.checkAvailability();
    expect(controller.getSnapshot().canEdit).toBe(true);
    controller.dispose();
  });

  it('fences a captured custom-menu edit action while offline, hidden, or disposed', async () => {
    const { controller } = fixture();
    await controller.load();
    const store = controller.getSnapshot().store;
    if (store === null) throw new Error('Expected a ready account store.');
    const created = store.getState().createCustomTrainingSetAndAddToDashboard({
      name: 'Account custom menu',
      category: 'custom',
      sections: [
        {
          name: 'Main practice',
          exercises: [{ name: 'Men', quantities: { repetitions: 12 } }],
        },
      ],
    });
    const original = store
      .getState()
      .dashboardEntries.find((entry) => entry.id === created.dashboardEntryId);
    const section = created.trainingSet.activities[0];
    const exercise = section?.children[0];
    if (original === undefined || section === undefined || exercise === undefined) {
      throw new Error('Expected the custom menu fixture.');
    }
    const edit = store.getState().updateCustomTrainingSet;
    const input = {
      name: 'Changed account menu',
      category: 'custom' as const,
      sections: [{ name: 'Main practice', exercises: [{ name: 'Men' }] }],
    };
    const identities = {
      sections: [{ id: section.id, exercises: [{ id: exercise.id }] }],
    };
    const before = store.getState().dashboardEntries;

    controller.setOnline(false);
    expect(() => edit(original.id, input, identities)).toThrow('Account editing is unavailable.');
    expect(store.getState().dashboardEntries).toEqual(before);
    controller.setOnline(true);
    expect(controller.getSnapshot().canEdit).toBe(false);
    await controller.checkAvailability();
    expect(controller.getSnapshot().canEdit).toBe(true);

    controller.hideForIdentityUncertainty();
    expect(() => edit(original.id, input, identities)).toThrow('Account editing is unavailable.');
    controller.dispose();
    expect(() => edit(original.id, input, identities)).toThrow('Account editing is unavailable.');
    expect(store.getState().dashboardEntries).toEqual(before);
  });

  it('keeps failed-service drafts read-only until a dashboard probe succeeds without replacing them', async () => {
    const { controller, api, add } = fixture();
    await controller.load();
    add();
    api.putDashboard.mockRejectedValueOnce(new AccountApiError('network', 'Unavailable'));
    await controller.save();
    controller.hideForIdentityUncertainty();
    controller.revealForVerifiedAccount(account);
    expect(controller.getSnapshot().canEdit).toBe(false);
    api.getDashboard.mockRejectedValueOnce(new AccountApiError('network', 'Unavailable'));
    await controller.checkAvailability();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'unavailable',
      canEdit: false,
      dirty: true,
    });
    await controller.checkAvailability();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      canEdit: true,
      revision: '0',
      dirty: true,
      saveState: 'uncertain',
    });
    expect(controller.getSnapshot().store?.getState().dashboardEntries).toHaveLength(1);
    await controller.retrySave();
    expect(api.putDashboard.mock.calls[1]?.[1]).toEqual(api.putDashboard.mock.calls[0]?.[1]);
    controller.dispose();
  });

  it('detects a different verified account before submitting any Save', async () => {
    const { controller, api, add, changed } = fixture();
    await controller.load();
    add();
    api.getAccount.mockResolvedValueOnce({ ...account, accountId: OTHER });
    await controller.save();
    expect(controller.getSnapshot()).toMatchObject({ status: 'auth-hidden', store: null });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(api.putDashboard).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('drops a creation handoff if the initial validated dashboard already has a committed revision', async () => {
    const { controller, api } = fixture();
    api.getDashboard.mockResolvedValueOnce({
      transportVersion: 1,
      accountWorkspaceId: ACCOUNT,
      catalogueVersion: catalogue,
      revision: '1',
      dashboard: { version: 10, state: { dashboardEntries: [] } },
      updatedAt: '2026-10-07T10:00:00.000Z',
    });
    await controller.load();
    expect(controller.getCreationHandoff()).toBeNull();
    expect(controller.getSnapshot().revision).toBe('1');
    controller.dispose();
  });

  it('clears the memory-only creation opportunity after acknowledged ordinary Save', async () => {
    const { controller, add } = fixture();
    await controller.load();
    expect(controller.getCreationHandoff()?.copyOpportunityId).toBe(OPPORTUNITY);
    add();
    await controller.save();
    expect(controller.getCreationHandoff()).toBeNull();
    controller.dispose();
  });

  it('can Save the complete empty snapshot after deleting the last menu', async () => {
    const { controller, api, add } = fixture();
    await controller.load();
    const entry = add();
    await controller.save();
    controller.getSnapshot().store?.getState().removeFromDashboard(entry);
    await controller.save();
    const request: DashboardWriteRequest | undefined = api.putDashboard.mock.calls[1]?.[1];
    expect(request?.expectedRevision).toBe('1');
    expect(request?.dashboard.state.dashboardEntries).toEqual([]);
    expect(controller.getSnapshot().dirty).toBe(false);
    controller.dispose();
  });
});
