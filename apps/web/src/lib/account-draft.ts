import { encodeDashboardPersistenceV10 } from '@kendo-menu/domain/dashboard-persistence';
import {
  createTrainingStore,
  serializePersistedTrainingStateV10,
  type TrainingStoreApi,
} from '@kendo-menu/store';

import {
  AccountApiError,
  serializeDashboardWriteRequest,
  type AccountApiClient,
  type DashboardWriteRequest,
  type ManagedAccountInitialization,
  type ManagedAccountRecord,
} from './account-api';
import { createMemoryTrainingStorage, downloadCurrentTrainingBackup } from './training-persistence';

export interface AccountDraftSnapshot {
  readonly status: 'loading' | 'ready' | 'unavailable' | 'auth-hidden' | 'load-error' | 'disposed';
  readonly accountId: string;
  readonly email: string | null;
  readonly revision: string;
  readonly catalogueVersion: string | null;
  readonly store: TrainingStoreApi | null;
  readonly dirty: boolean;
  readonly saveState: 'idle' | 'saving' | 'uncertain' | 'conflict' | 'blocked' | 'saved';
  readonly canEdit: boolean;
  readonly error: string | null;
}

export interface AccountDraftController {
  getSnapshot(): AccountDraftSnapshot;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  save(): Promise<void>;
  retrySave(): Promise<void>;
  reload(): Promise<void>;
  checkAvailability(): Promise<void>;
  hideForIdentityUncertainty(): void;
  revealForVerifiedAccount(account: ManagedAccountRecord): boolean;
  setOnline(online: boolean): void;
  discard(): void;
  dispose(): void;
  download(): void;
  getCreationHandoff(): ManagedAccountInitialization | null;
}

interface FrozenSave {
  readonly request: DashboardWriteRequest;
  readonly submittedRaw: string;
}

function freezeSnapshot(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
  for (const item of Object.values(value)) freezeSnapshot(item);
  Object.freeze(value);
}

/** One active tab owns one draft and one unresolved complete Save; no browser cache exists. */
export function createAccountDraftController(options: {
  readonly account: ManagedAccountRecord;
  readonly api: AccountApiClient;
  readonly initialization?: ManagedAccountInitialization;
  readonly onAuthenticationRejected?: () => void;
  readonly onIdentityChanged?: () => void;
  readonly createRequestId?: () => string;
}): AccountDraftController {
  let account = options.account;
  let store: TrainingStoreApi | null = null;
  let unsubscribeStore: (() => void) | undefined;
  let baseline: string | null = null;
  let pending: FrozenSave | null = null;
  let handoff = options.initialization ?? null;
  let online = typeof navigator === 'undefined' || navigator.onLine;
  let serviceAvailable = online;
  let epoch = 0;
  let activeRequest: AbortController | null = null;
  let snapshot: AccountDraftSnapshot = {
    status: 'loading',
    accountId: account.accountId,
    email: account.email,
    revision: '0',
    catalogueVersion: null,
    store: null,
    dirty: false,
    saveState: 'idle',
    canEdit: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  const currentRaw = () =>
    store === null
      ? null
      : serializePersistedTrainingStateV10({ dashboardEntries: store.getState().dashboardEntries });

  function update(patch: Partial<AccountDraftSnapshot> = {}): void {
    const next = { ...snapshot, ...patch };
    const visible = next.status === 'ready' || next.status === 'unavailable';
    snapshot = {
      ...next,
      accountId: account.accountId,
      email: account.email,
      store: visible ? store : null,
      dirty: store !== null && currentRaw() !== baseline,
      canEdit: next.status === 'ready' && online && serviceAvailable,
    };
    for (const listener of listeners) listener();
  }

  function cancel(): void {
    epoch += 1;
    activeRequest?.abort();
    activeRequest = null;
  }

  function hide(): void {
    if (snapshot.status === 'disposed') return;
    cancel();
    update({
      status: 'auth-hidden',
      saveState: pending === null ? snapshot.saveState : 'uncertain',
      error: 'Your account is hidden until its identity is verified again.',
    });
  }

  function assertWritable(): void {
    if (!snapshot.canEdit) throw new Error('Account editing is unavailable.');
  }

  function installStore(raw: string | null): void {
    const memory = createMemoryTrainingStorage();
    if (raw !== null) memory.setItem('account-draft', raw);
    const next = createTrainingStore({ storage: memory, storageKey: 'account-draft' });
    // Guard captured action callbacks as well as disabled UI controls after availability/auth changes.
    const actions = next.getState();
    next.setState({
      addToDashboard: (...args) => {
        assertWritable();
        return actions.addToDashboard(...args);
      },
      updateDashboardEntry: (...args) => {
        assertWritable();
        actions.updateDashboardEntry(...args);
      },
      setQuantityOverride: (...args) => {
        assertWritable();
        actions.setQuantityOverride(...args);
      },
      clearQuantityOverride: (...args) => {
        assertWritable();
        actions.clearQuantityOverride(...args);
      },
      setActivityNote: (...args) => {
        assertWritable();
        actions.setActivityNote(...args);
      },
      removeFromDashboard: (...args) => {
        assertWritable();
        return actions.removeFromDashboard(...args);
      },
      restoreDashboardEntry: (...args) => {
        assertWritable();
        actions.restoreDashboardEntry(...args);
      },
      undoRemoveFromDashboard: (...args) => {
        assertWritable();
        actions.undoRemoveFromDashboard(...args);
      },
      createCustomTrainingSetAndAddToDashboard: (...args) => {
        assertWritable();
        return actions.createCustomTrainingSetAndAddToDashboard(...args);
      },
    });
    unsubscribeStore?.();
    store = next;
    baseline = currentRaw();
    unsubscribeStore = next.subscribe(() =>
      update({ saveState: snapshot.saveState === 'saved' ? 'idle' : snapshot.saveState }),
    );
  }

  async function verify(signal: AbortSignal, expectedEpoch: number): Promise<boolean> {
    const verified = await options.api.getAccount(signal);
    if (epoch !== expectedEpoch || signal.aborted) return false;
    if (verified.accountId !== account.accountId) {
      hide();
      options.onIdentityChanged?.();
      return false;
    }
    account = verified;
    return true;
  }

  function authenticationFailure(error: unknown): boolean {
    if (
      error instanceof AccountApiError &&
      (error.status === 401 || error.code === 'ACCOUNT_WORKSPACE_MISMATCH')
    ) {
      hide();
      options.onAuthenticationRejected?.();
      return true;
    }
    return false;
  }

  async function load(): Promise<void> {
    if (snapshot.status === 'disposed' || activeRequest !== null) return;
    const request = new AbortController();
    activeRequest = request;
    const expectedEpoch = epoch;
    let verified = false;
    update({ status: 'loading', error: null });
    try {
      verified = await verify(request.signal, expectedEpoch);
      if (!verified) return;
      const cloud = await options.api.getDashboard(account.accountId, request.signal);
      if (epoch !== expectedEpoch || request.signal.aborted) return;
      const raw =
        cloud.dashboard === null
          ? null
          : JSON.stringify({ state: cloud.dashboard.state, version: 10 });
      installStore(raw);
      pending = null;
      if (cloud.revision !== '0') handoff = null;
      serviceAvailable = online;
      update({
        status: online ? 'ready' : 'unavailable',
        revision: cloud.revision,
        catalogueVersion: cloud.catalogueVersion,
        saveState: 'idle',
        error: online
          ? null
          : 'Account editing requires a connection. This draft is only in this tab.',
      });
    } catch (error) {
      if (epoch !== expectedEpoch || request.signal.aborted) return;
      if (!authenticationFailure(error) && store !== null && !verified) {
        hide();
      } else if (snapshot.status !== 'auth-hidden') {
        serviceAvailable = false;
        update({
          status: store === null ? 'load-error' : 'unavailable',
          error:
            'The account dashboard could not be loaded. Retry; your current draft has not been replaced.',
        });
      }
    } finally {
      if (activeRequest === request) activeRequest = null;
    }
  }

  async function send(): Promise<void> {
    if (
      pending === null ||
      activeRequest !== null ||
      snapshot.status === 'auth-hidden' ||
      snapshot.status === 'disposed' ||
      !online
    )
      return;
    const operation = pending;
    const request = new AbortController();
    activeRequest = request;
    const expectedEpoch = epoch;
    let verified = false;
    update({ saveState: 'saving', error: null });
    try {
      verified = await verify(request.signal, expectedEpoch);
      if (!verified) return;
      const acknowledgement = await options.api.putDashboard(
        account.accountId,
        operation.request,
        request.signal,
      );
      if (epoch !== expectedEpoch || request.signal.aborted || pending !== operation) return;
      baseline = operation.submittedRaw;
      pending = null;
      handoff = null;
      serviceAvailable = online;
      update({
        status: online ? 'ready' : 'unavailable',
        revision: acknowledgement.revision,
        saveState: 'saved',
        error: null,
      });
    } catch (error) {
      if (epoch !== expectedEpoch || request.signal.aborted) return;
      if (authenticationFailure(error)) return;
      if (!verified) {
        hide();
        update({
          error: 'Account identity could not be verified. Retry to reveal this tab’s draft.',
        });
      } else if (error instanceof AccountApiError && error.code === 'REVISION_CONFLICT') {
        pending = null;
        handoff = null;
        update({
          status: 'ready',
          saveState: 'conflict',
          error:
            'The account changed elsewhere. Download your draft or explicitly reload the account. Nothing was overwritten.',
        });
      } else if (
        error instanceof AccountApiError &&
        (error.code === 'CATALOGUE_INCOMPATIBLE' ||
          error.code === 'REQUEST_ID_REUSED' ||
          (error.status !== undefined && error.status >= 400 && error.status < 500))
      ) {
        pending = null;
        update({
          status: 'ready',
          saveState: 'blocked',
          error:
            'This draft could not be saved. Download it before explicitly reloading the account.',
        });
      } else {
        serviceAvailable = false;
        update({
          status: 'unavailable',
          saveState: 'uncertain',
          error:
            'Save was not confirmed. Keep this tab open. Retry the same Save or download your draft; reloading or closing can lose it.',
        });
      }
    } finally {
      if (activeRequest === request) activeRequest = null;
    }
  }

  async function checkAvailability(): Promise<void> {
    if (activeRequest !== null || snapshot.status === 'disposed') return;
    const request = new AbortController();
    activeRequest = request;
    const expectedEpoch = epoch;
    let verified = false;
    try {
      verified = await verify(request.signal, expectedEpoch);
      if (!verified) return;
      if (store === null) {
        activeRequest = null;
        await load();
      } else {
        // Probe the dashboard service without replacing this tab's draft or expected revision.
        await options.api.getDashboard(account.accountId, request.signal);
        if (epoch !== expectedEpoch || request.signal.aborted) return;
        serviceAvailable = online;
        update({
          status: online ? 'ready' : 'unavailable',
          error: online ? null : 'Account editing requires a connection.',
        });
      }
    } catch (error) {
      if (epoch !== expectedEpoch || request.signal.aborted) return;
      if (!authenticationFailure(error)) {
        if (!verified) hide();
        else {
          serviceAvailable = false;
          update({
            status: 'unavailable',
            error:
              'The dashboard service is still unavailable. Keep this tab open or download your draft.',
          });
        }
      }
    } finally {
      if (activeRequest === request) activeRequest = null;
    }
  }

  function discard(): void {
    cancel();
    unsubscribeStore?.();
    unsubscribeStore = undefined;
    store = null;
    baseline = null;
    pending = null;
    handoff = null;
    update({ status: 'disposed', saveState: 'idle', error: null });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    save: async () => {
      if (
        pending !== null ||
        !snapshot.canEdit ||
        store === null ||
        !snapshot.dirty ||
        snapshot.saveState === 'conflict' ||
        snapshot.saveState === 'blocked' ||
        snapshot.catalogueVersion === null
      )
        return;
      try {
        const request: DashboardWriteRequest = {
          transportVersion: 1,
          expectedAccountWorkspaceId: account.accountId,
          expectedRevision: snapshot.revision,
          requestId: options.createRequestId?.() ?? crypto.randomUUID(),
          catalogueVersion: snapshot.catalogueVersion,
          dashboard: {
            version: 10,
            state: encodeDashboardPersistenceV10({
              dashboardEntries: store.getState().dashboardEntries,
            }),
          },
        };
        serializeDashboardWriteRequest(account.accountId, request);
        freezeSnapshot(request);
        const submittedRaw = currentRaw();
        if (submittedRaw === null) return;
        pending = Object.freeze({ request, submittedRaw });
      } catch {
        update({
          error:
            'The complete draft exceeds account limits or cannot be encoded. Adjust it or download it; no Save was sent.',
        });
        return;
      }
      await send();
    },
    retrySave: send,
    reload: load,
    checkAvailability,
    hideForIdentityUncertainty: hide,
    revealForVerifiedAccount: (verified) => {
      if (snapshot.status === 'disposed') return false;
      if (verified.accountId !== account.accountId) {
        hide();
        return false;
      }
      account = verified;
      if (store !== null)
        update({ status: online && serviceAvailable ? 'ready' : 'unavailable', error: null });
      else void load();
      return store !== null;
    },
    setOnline: (value) => {
      online = value;
      if (
        store === null ||
        snapshot.status === 'auth-hidden' ||
        snapshot.status === 'disposed' ||
        snapshot.status === 'loading'
      )
        return;
      // Becoming online only offers explicit retry; it neither writes nor proves service availability.
      if (!online) {
        serviceAvailable = false;
        update({
          status: 'unavailable',
          error: 'Account editing requires a connection. Download this tab’s draft before leaving.',
        });
      } else update();
    },
    discard,
    dispose: () => {
      discard();
      listeners.clear();
    },
    download: () => {
      if (store === null || snapshot.status === 'auth-hidden' || snapshot.status === 'disposed')
        throw new Error('Account download requires verified identity.');
      downloadCurrentTrainingBackup(store.getState().dashboardEntries);
    },
    getCreationHandoff: () =>
      pending === null && snapshot.status !== 'auth-hidden' && snapshot.status !== 'disposed'
        ? handoff
        : null,
  };
}
