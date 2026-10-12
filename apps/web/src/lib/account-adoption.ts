import {
  encodeDashboardPersistenceV10,
  isDashboardCatalogueCompatible,
  parseDashboardPersistenceV10,
} from '@kendo-menu/domain/dashboard-persistence';
import { classifyTrainingStorageValue, TRAINING_STORE_RAW_JSON_LIMIT } from '@kendo-menu/store';

import {
  serializeAdoptionRequest,
  type AdoptionDecisionRequest,
  type DashboardSnapshot,
  type ManagedAccountInitialization,
} from './account-api';
import { TRAINING_STORAGE_KEY } from './training-persistence';
import { createWorkspaceCoordinator } from './workspace-coordination';

const SIZE_CHECK_REQUEST_ID = '00000000-0000-4000-8000-000000000000';

export interface GuestCopySnapshot {
  readonly raw: string;
  readonly dashboard: DashboardSnapshot;
  readonly entryCount: number;
}

/** Reads only a complete, valid guest snapshot while holding the existing guest workspace lock. */
export async function readGuestCopySnapshot(): Promise<GuestCopySnapshot | null> {
  const coordination = createWorkspaceCoordinator();
  try {
    return await coordination.withLock(() => {
      const raw = window.localStorage.getItem(TRAINING_STORAGE_KEY);
      if (raw === null || raw.length > TRAINING_STORE_RAW_JSON_LIMIT) return null;
      const inspection = classifyTrainingStorageValue(raw);
      if (
        (inspection.status !== 'ready' && inspection.status !== 'migrated') ||
        inspection.state.dashboardEntries.length === 0
      ) {
        return null;
      }
      let envelope: unknown;
      try {
        envelope = JSON.parse(raw);
      } catch {
        return null;
      }
      const currentWireState =
        typeof envelope === 'object' &&
        envelope !== null &&
        !Array.isArray(envelope) &&
        Object.hasOwn(envelope, 'version') &&
        Reflect.get(envelope, 'version') === 10
          ? parseDashboardPersistenceV10(Reflect.get(envelope, 'state'))
          : null;
      const state =
        currentWireState !== null
          ? isDashboardCatalogueCompatible(currentWireState)
            ? currentWireState
            : null
          : inspection.status === 'migrated'
            ? encodeDashboardPersistenceV10(inspection.state)
            : null;
      if (state === null || state.dashboardEntries.length === 0) return null;
      return {
        raw,
        dashboard: { version: 10, state },
        entryCount: inspection.state.dashboardEntries.length,
      };
    });
  } catch {
    return null;
  } finally {
    coordination.dispose();
  }
}

export function createGuestCopyRequest(options: {
  readonly accountId: string;
  readonly handoff: ManagedAccountInitialization;
  readonly catalogueVersion: string;
  readonly snapshot: GuestCopySnapshot;
  readonly requestId: string;
}): AdoptionDecisionRequest | null {
  const opportunity = options.handoff.copyOpportunityId;
  if (
    !options.handoff.created ||
    options.handoff.accountId !== options.accountId ||
    opportunity === undefined
  ) {
    return null;
  }
  const request: AdoptionDecisionRequest = {
    transportVersion: 1,
    decision: 'yes',
    expectedAccountWorkspaceId: options.accountId,
    copyOpportunityId: opportunity,
    requestId: options.requestId,
    expectedRevision: '0',
    catalogueVersion: options.catalogueVersion,
    dashboard: options.snapshot.dashboard,
  };
  try {
    serializeAdoptionRequest(options.accountId, request);
    return request;
  } catch {
    return null;
  }
}

export function guestCopyFitsRequestLimit(options: {
  readonly accountId: string;
  readonly handoff: ManagedAccountInitialization;
  readonly catalogueVersion: string;
  readonly snapshot: GuestCopySnapshot;
}): boolean {
  return createGuestCopyRequest({ ...options, requestId: SIZE_CHECK_REQUEST_ID }) !== null;
}
