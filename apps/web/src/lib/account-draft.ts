import {
  parseSharedMenuV1,
  sharedMenuV1ToTrainingSetInput,
  type SharedMenuV1,
} from '@kendo-menu/domain/menu-sharing';
import type { DashboardEntry, TrainingQuantityOverrides } from '@kendo-menu/domain';
/**
 * Owns one verified account draft and its store for a route lifetime, using memory-only storage.
 * Frozen pending requests and identity fencing keep stale responses from replacing the draft.
 */
import { encodeDashboardPersistenceV11 } from '@kendo-menu/domain/dashboard-persistence';
import {
  createTrainingStore,
  classifyTrainingStorageValue,
  serializePersistedTrainingStateV11,
  type TrainingStoreApi,
} from '@kendo-menu/store';

import {
  AccountApiError,
  normalizeAdoptionRequest,
  serializeDashboardWriteRequest,
  type AdoptionAcknowledgement,
  type AdoptionDecisionRequest,
  type AccountApiClient,
  type CreatedMenuShare,
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
  importSharedMenu(menu: SharedMenuV1, isSender: boolean): string;
  getSavedEntry(entryId: string): DashboardEntry | null;
  createMenuShare(entryId: string, signal?: AbortSignal): Promise<CreatedMenuShare>;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  save(): Promise<void>;
  retrySave(): Promise<void>;
  reload(): Promise<void>;
  loadAuthoritativeDashboard(): Promise<void>;
  checkAvailability(): Promise<void>;
  hideForIdentityUncertainty(): void;
  revealForVerifiedAccount(account: ManagedAccountRecord): boolean;
  setOnline(online: boolean): void;
  discard(): void;
  dispose(): void;
  download(): void;
  getCreationHandoff(): ManagedAccountInitialization | null;
  releaseCreationHandoff(): void;
  setEditingBlocked(blocked: boolean): void;
  submitAdoption(
    request: AdoptionDecisionRequest,
  ): Promise<'accepted' | 'declined' | 'unconfirmed' | 'abandoned' | 'stale'>;
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
  readonly onCreationHandoffReleased?: () => void;
  readonly createRequestId?: () => string;
}): AccountDraftController {
  let account = options.account;
  let store: TrainingStoreApi | null = null;
  let unsubscribeStore: (() => void) | undefined;
  let baseline: string | null = null;
  let cachedBaseline: string | null = null;
  let savedEntries: readonly DashboardEntry[] = [];
  let pending: FrozenSave | null = null;
  let handoff = options.initialization ?? null;
  let editingBlocked = false;
  let adoptionPending = false;
  // After adoption dispatch, only a fresh validated dashboard may reveal the retained store.
  let authoritativeLoadRequired = false;
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
      : serializePersistedTrainingStateV11({ dashboardEntries: store.getState().dashboardEntries });

  function getSavedEntry(entryId: string): DashboardEntry | null {
    if (snapshot.status !== 'ready' || baseline === null) return null;
    if (baseline !== cachedBaseline) {
      const parsed = classifyTrainingStorageValue(baseline);
      savedEntries =
        parsed.status === 'ready' || parsed.status === 'migrated'
          ? parsed.state.dashboardEntries
          : [];
      freezeSnapshot(savedEntries);
      cachedBaseline = baseline;
    }
    return (
      savedEntries.find(
        (entry) => entry.id === entryId && entry.trainingSet?.isBuiltIn === false,
      ) ?? null
    );
  }

  function update(patch: Partial<AccountDraftSnapshot> = {}): void {
    const next = { ...snapshot, ...patch };
    const visible = next.status === 'ready' || next.status === 'unavailable';
    // The authoritative-load gate takes precedence over otherwise visible service states.
    snapshot = {
      ...next,
      accountId: account.accountId,
      email: account.email,
      store: visible && !authoritativeLoadRequired ? store : null,
      dirty: store !== null && currentRaw() !== baseline,
      canEdit:
        next.status === 'ready' &&
        online &&
        serviceAvailable &&
        !editingBlocked &&
        !adoptionPending &&
        !authoritativeLoadRequired,
    };
    for (const listener of listeners) listener();
  }

  function cancel(): void {
    epoch += 1;
    activeRequest?.abort();
    activeRequest = null;
  }

  function releaseHandoff(): void {
    if (handoff === null) return;
    handoff = null;
    options.onCreationHandoffReleased?.();
    update();
  }

  function hide(): void {
    if (snapshot.status === 'disposed') return;
    // Identity uncertainty fences active work before the in-memory draft is hidden.
    if (adoptionPending) releaseHandoff();
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
      updateCustomTrainingSet: (...args) => {
        assertWritable();
        return actions.updateCustomTrainingSet(...args);
      },
    });
    unsubscribeStore?.();
    store = next;
    baseline = currentRaw();
    authoritativeLoadRequired = false;
    unsubscribeStore = next.subscribe(() =>
      update({ saveState: snapshot.saveState === 'saved' ? 'idle' : snapshot.saveState }),
    );
  }

  async function verify(signal: AbortSignal, expectedEpoch: number): Promise<boolean> {
    // The server check must match this account before dashboard loads or mutations proceed.
    const verified = await options.api.getAccount(signal);
    if (epoch !== expectedEpoch || signal.aborted) return false;
    if (verified.accountId !== account.accountId) {
      releaseHandoff();
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

  async function load(requireAuthoritative = false): Promise<void> {
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
          : JSON.stringify({ state: cloud.dashboard.state, version: cloud.dashboard.version });
      installStore(raw);
      pending = null;
      if (cloud.revision !== '0') releaseHandoff();
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
          status:
            requireAuthoritative || authoritativeLoadRequired || store === null
              ? 'load-error'
              : 'unavailable',
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
      releaseHandoff();
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
        releaseHandoff();
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
    if (authoritativeLoadRequired) {
      await load(true);
      return;
    }
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
    cachedBaseline = null;
    savedEntries = [];
    pending = null;
    releaseHandoff();
    update({ status: 'disposed', saveState: 'idle', error: null });
  }

  return {
    getSnapshot: () => snapshot,
    getSavedEntry,
    importSharedMenu: (menu, isSender) => {
      assertWritable();
      if (store === null || snapshot.catalogueVersion === null)
        throw new Error('Your account dashboard is unavailable.');
      const parsed = parseSharedMenuV1(menu);
      const input = sharedMenuV1ToTrainingSetInput(parsed);
      if (parsed === null || input === null) throw new Error('The shared menu is invalid.');
      // Build privately and preflight the complete UTF-8 Save before changing the live draft.
      const memory = createMemoryTrainingStorage();
      const raw = currentRaw();
      if (raw !== null) memory.setItem('shared-import', raw);
      const candidate = createTrainingStore({ storage: memory, storageKey: 'shared-import' });
      const created = candidate
        .getState()
        .createCustomTrainingSetAndAddToDashboard(input, isSender ? undefined : true);
      const quantityOverrides: Record<string, TrainingQuantityOverrides> = {};
      parsed.sections.forEach((section, index) => {
        const activity = created.trainingSet.activities[index];
        if (activity === undefined) throw new Error('The shared menu activities are invalid.');
        if (section.additionalDuration !== undefined)
          quantityOverrides[activity.id] = {
            [section.additionalDuration.unit]: section.additionalDuration.value,
          };
        section.exercises.forEach((exercise, childIndex) => {
          const child = activity.children[childIndex];
          if (child === undefined) throw new Error('The shared menu exercises are invalid.');
          if (exercise.additionalDuration !== undefined)
            quantityOverrides[child.id] = {
              [exercise.additionalDuration.unit]: exercise.additionalDuration.value,
            };
        });
      });
      candidate.getState().updateDashboardEntry(created.dashboardEntryId, { quantityOverrides });
      const dashboardEntries = candidate.getState().dashboardEntries;
      serializeDashboardWriteRequest(account.accountId, {
        transportVersion: 1,
        expectedAccountWorkspaceId: account.accountId,
        expectedRevision: snapshot.revision,
        requestId: '00000000-0000-4000-8000-000000000000',
        catalogueVersion: snapshot.catalogueVersion,
        dashboard: { version: 11, state: encodeDashboardPersistenceV11({ dashboardEntries }) },
      });
      store.setState({ dashboardEntries });
      return created.dashboardEntryId;
    },
    createMenuShare: async (entryId, signal) => {
      const saved = getSavedEntry(entryId);
      if (
        !snapshot.canEdit ||
        pending !== null ||
        activeRequest !== null ||
        saved === null ||
        snapshot.saveState === 'conflict' ||
        snapshot.saveState === 'blocked'
      )
        throw new Error('Save this menu to your account before sharing.');
      const generation = epoch;
      const revision = snapshot.revision;
      const accountId = account.accountId;
      try {
        const result = await options.api.createMenuShare(accountId, revision, entryId, signal);
        if (
          generation !== epoch ||
          account.accountId !== accountId ||
          snapshot.status !== 'ready' ||
          signal?.aborted
        )
          throw new Error('Sharing was cancelled.');
        return result;
      } catch (error) {
        if (
          generation === epoch &&
          !signal?.aborted &&
          !authenticationFailure(error) &&
          error instanceof AccountApiError &&
          error.code === 'REVISION_CONFLICT' &&
          snapshot.revision === revision &&
          pending === null &&
          activeRequest === null
        ) {
          update({
            saveState: 'conflict',
            error:
              'The account changed elsewhere. Download your draft or explicitly reload the account before sharing. Nothing was overwritten.',
          });
        }
        throw error;
      }
    },
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
            version: 11,
            state: encodeDashboardPersistenceV11({
              dashboardEntries: store.getState().dashboardEntries,
            }),
          },
        };
        serializeDashboardWriteRequest(account.accountId, request);
        freezeSnapshot(request);
        const submittedRaw = currentRaw();
        if (submittedRaw === null) return;
        // Keep the full envelope unchanged so an uncertain retry uses the same request ID and snapshot.
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
    loadAuthoritativeDashboard: () => load(true),
    checkAvailability,
    hideForIdentityUncertainty: hide,
    revealForVerifiedAccount: (verified) => {
      if (snapshot.status === 'disposed') return false;
      if (verified.accountId !== account.accountId) {
        hide();
        return false;
      }
      account = verified;
      if (authoritativeLoadRequired)
        update({
          status: 'load-error',
          error:
            'The account dashboard could not be loaded. Retry; your current draft has not been replaced.',
        });
      else if (store !== null)
        update({ status: online && serviceAvailable ? 'ready' : 'unavailable', error: null });
      else void load();
      return store !== null && !authoritativeLoadRequired;
    },
    setOnline: (value) => {
      online = value;
      if (authoritativeLoadRequired) return;
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
      // React may replay an effect during development; disposal must not consume the parent lease.
      cancel();
      unsubscribeStore?.();
      unsubscribeStore = undefined;
      store = null;
      baseline = null;
      cachedBaseline = null;
      savedEntries = [];
      pending = null;
      handoff = null;
      update({ status: 'disposed', saveState: 'idle', error: null });
      listeners.clear();
    },
    download: () => {
      if (store === null || snapshot.status === 'auth-hidden' || snapshot.status === 'disposed')
        throw new Error('Account download requires verified identity.');
      downloadCurrentTrainingBackup(store.getState().dashboardEntries);
    },
    getCreationHandoff: () =>
      handoff?.created === true &&
      handoff.copyOpportunityId !== undefined &&
      pending === null &&
      snapshot.status !== 'auth-hidden' &&
      snapshot.status !== 'disposed'
        ? handoff
        : null,
    releaseCreationHandoff: releaseHandoff,
    setEditingBlocked: (blocked) => {
      editingBlocked = blocked;
      update();
    },
    submitAdoption: async (input) => {
      const creation = handoff;
      if (
        adoptionPending ||
        activeRequest !== null ||
        creation?.created !== true ||
        creation.copyOpportunityId === undefined ||
        snapshot.status !== 'ready' ||
        input.expectedAccountWorkspaceId !== account.accountId ||
        input.copyOpportunityId !== creation.copyOpportunityId
      ) {
        return 'stale';
      }
      let frozenRequest: AdoptionDecisionRequest;
      try {
        frozenRequest = normalizeAdoptionRequest(account.accountId, input);
      } catch {
        return 'stale';
      }
      freezeSnapshot(frozenRequest);
      const request = new AbortController();
      activeRequest = request;
      const expectedEpoch = epoch;
      let dispatched = false;
      adoptionPending = true;
      update({ saveState: 'saving', error: null });
      let result: 'accepted' | 'declined' | 'unconfirmed';
      const current = () => snapshot;
      const isActive = () => {
        const latest = current();
        return (
          epoch === expectedEpoch &&
          !request.signal.aborted &&
          latest.status !== 'auth-hidden' &&
          latest.status !== 'disposed'
        );
      };
      try {
        const verified = await verify(request.signal, expectedEpoch);
        if (!verified || epoch !== expectedEpoch || request.signal.aborted) {
          releaseHandoff();
          return 'abandoned';
        }
        dispatched = true;
        // From dispatch on, the client cannot replay this choice or expose the pre-decision store.
        authoritativeLoadRequired = true;
        update({ status: 'loading' });
        releaseHandoff();
        const acknowledgement: AdoptionAcknowledgement = await options.api.postAdoption(
          account.accountId,
          frozenRequest,
          request.signal,
        );
        if (epoch !== expectedEpoch || request.signal.aborted) return 'stale';
        result = acknowledgement.status === 'accepted' ? 'accepted' : 'declined';
      } catch (error) {
        if (epoch !== expectedEpoch || request.signal.aborted) {
          if (!dispatched) releaseHandoff();
          return dispatched ? 'stale' : 'abandoned';
        }
        if (authenticationFailure(error)) {
          if (!dispatched) releaseHandoff();
          return dispatched ? 'stale' : 'abandoned';
        }
        releaseHandoff();
        result = 'unconfirmed';
      } finally {
        if (activeRequest === request) activeRequest = null;
        adoptionPending = false;
      }
      if (!isActive()) return 'stale';
      await load(true);
      if (!isActive()) return 'stale';
      update({ saveState: 'idle', error: null });
      return result;
    },
  };
}
