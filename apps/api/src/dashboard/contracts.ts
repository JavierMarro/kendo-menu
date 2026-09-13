import type { PersistedTrainingWireStateV10 } from '@kendo-menu/domain/dashboard-persistence';

declare const accountWorkspaceIdBrand: unique symbol;
declare const requestIdBrand: unique symbol;
declare const revisionBrand: unique symbol;
declare const nonZeroRevisionBrand: unique symbol;
declare const catalogueVersionBrand: unique symbol;
declare const timestampBrand: unique symbol;

export type AccountWorkspaceId = string & { readonly [accountWorkspaceIdBrand]: true };
export type RequestId = string & { readonly [requestIdBrand]: true };
export type Revision = string & { readonly [revisionBrand]: true };
export type NonZeroRevision = Revision & { readonly [nonZeroRevisionBrand]: true };
export type CatalogueVersion = string & { readonly [catalogueVersionBrand]: true };
export type Timestamp = string & { readonly [timestampBrand]: true };

export interface DashboardSnapshot {
  readonly version: 10;
  readonly state: PersistedTrainingWireStateV10;
}

export interface DashboardWriteRequest {
  readonly transportVersion: 1;
  readonly expectedAccountWorkspaceId: AccountWorkspaceId;
  readonly expectedRevision: Revision;
  readonly requestId: RequestId;
  readonly catalogueVersion: CatalogueVersion;
  readonly dashboard: DashboardSnapshot;
}

export interface DashboardReadBase {
  readonly transportVersion: 1;
  readonly accountWorkspaceId: AccountWorkspaceId;
  readonly catalogueVersion: CatalogueVersion;
}

export type DashboardReadResponse = DashboardReadBase &
  (
    | { readonly revision: '0'; readonly dashboard: null; readonly updatedAt: null }
    | {
        readonly revision: NonZeroRevision;
        readonly dashboard: DashboardSnapshot;
        readonly updatedAt: Timestamp;
      }
  );

export interface DashboardWriteAcknowledgement {
  readonly transportVersion: 1;
  readonly accountWorkspaceId: AccountWorkspaceId;
  readonly requestId: RequestId;
  readonly revision: NonZeroRevision;
  readonly updatedAt: Timestamp;
}

/** Application-level limits; receipt policies are obligations for the later SQL adapter. */
export const MAX_DASHBOARD_REQUEST_BYTES = 2_097_152;
export const MAX_DASHBOARD_RECEIPTS_PER_ACCOUNT = 1_024;
export const DASHBOARD_RECEIPT_CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_REVISION = '9223372036854775807';
