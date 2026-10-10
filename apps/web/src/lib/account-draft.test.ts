import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountApiError, type AccountApiClient, type DashboardWriteRequest } from './account-api';
import { createAccountDraftController } from './account-draft';

const ACCOUNT = '01234567-89ab-4cde-8fab-0123456789ab';
const OTHER = '01234567-89ab-4cde-8fab-0123456789ac';
const REQUEST = '01234567-89ab-4cde-8fab-0123456789ad';
const OPPORTUNITY = '01234567-89ab-4cde-8fab-0123456789ae';
const account = { accountId: ACCOUNT, email: 'practitioner@example.test' };
const catalogue = 'a'.repeat(64);
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
