/**
 * Persists each verified account's dashboard cache and synchronization records in IndexedDB.
 * Callers supply the server-issued account ID; every record is bounded and validated again on read.
 * Related cache, acknowledgement, request, and conflict updates share transactions so partial
 * writes cannot imply a false acknowledgement or discard the losing local dashboard.
 */
import { parseDashboardPersistenceV10 } from '@kendo-menu/domain/dashboard-persistence';
import {
  classifyTrainingStorageValue,
  serializePersistedTrainingStateV10,
} from '@kendo-menu/store';
import { MAX_JSON_RESPONSE_BYTES } from './account-api';

const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function isAccountId(value: string): boolean {
  return ACCOUNT_ID_PATTERN.test(value);
}

const DATABASE_NAME = 'kendo-menu-account-storage';
const DATABASE_VERSION = 1;
const STORE_NAME = 'records';
export const ACCOUNT_METADATA_MAX_BYTES = 4_096;
export const ACCOUNT_RECOVERY_MAX_CHARACTERS = 3_145_728;
export const ACCOUNT_PAYLOAD_MAX_BYTES = 6_291_456;

export type AccountMetadataKind = 'ack';
export type AccountPayloadKind = 'pending-request' | 'active-conflict';

export interface AccountDashboardSnapshot {
  readonly version: 10;
  readonly state: unknown;
}

export interface AccountDashboardReadResponse {
  readonly transportVersion: 1;
  readonly accountWorkspaceId: string;
  readonly catalogueVersion: string;
  readonly revision: string;
  readonly dashboard: AccountDashboardSnapshot | null;
  readonly updatedAt: string | null;
}

export interface AccountDashboardWriteRequest {
  readonly transportVersion: 1;
  readonly expectedAccountWorkspaceId: string;
  readonly expectedRevision: string;
  readonly requestId: string;
  readonly catalogueVersion: string;
  readonly dashboard: AccountDashboardSnapshot;
}

export interface AccountDashboardWriteAcknowledgement {
  readonly transportVersion: 1;
  readonly accountWorkspaceId: string;
  readonly requestId: string;
  readonly revision: string;
  readonly updatedAt: string;
}

export type AccountAdoptionRequest =
  | {
      readonly decision: 'no';
      readonly transportVersion: 1;
      readonly expectedAccountWorkspaceId: string;
      readonly requestId: string;
    }
  | {
      readonly decision: 'yes';
      readonly transportVersion: 1;
      readonly expectedAccountWorkspaceId: string;
      readonly expectedRevision: '0';
      readonly requestId: string;
      readonly catalogueVersion: string;
      readonly dashboard: AccountDashboardSnapshot;
    };

export interface PendingDashboardWrite {
  readonly version: 1;
  readonly accountId: string;
  readonly kind: 'dashboard-put';
  readonly cacheVersion: AccountCacheVersion;
  readonly request: AccountDashboardWriteRequest;
  readonly createdAt: number;
}

export interface PendingAdoptionRequest {
  readonly version: 1;
  readonly accountId: string;
  readonly kind: 'adoption';
  readonly cacheVersion: AccountCacheVersion;
  readonly request: AccountAdoptionRequest;
  readonly createdAt: number;
}

export type PendingAccountRequest = PendingDashboardWrite | PendingAdoptionRequest;

export interface ActiveAccountConflict {
  readonly version: 1;
  readonly accountId: string;
  readonly conflictId: string;
  readonly localCacheVersion: AccountCacheVersion;
  readonly cloud: AccountDashboardReadResponse;
  readonly createdAt: number;
}

export type AccountAcknowledgement =
  | { readonly version: 1; readonly status: 'unknown'; readonly provenance?: 'new-empty' }
  | {
      readonly version: 1;
      readonly status: 'acknowledged';
      readonly accountWorkspaceId: string;
      readonly revision: string;
      readonly requestId: string | null;
      readonly cacheIdentity: string;
      readonly generation: number;
      readonly updatedAt: string | null;
    }
  | {
      readonly version: 1;
      readonly status: 'adoption-declined';
      readonly accountWorkspaceId: string;
      readonly requestId: string;
      readonly cacheIdentity: string;
      readonly generation: number;
    };

export interface AccountSyncState {
  readonly cache: AccountCacheRecord | null;
  readonly acknowledgement: AccountAcknowledgement;
  readonly pendingRequest: PendingAccountRequest | null;
  readonly activeConflict: ActiveAccountConflict | null;
}

export type PendingRequestIntent =
  | { readonly kind: 'dashboard-put'; readonly request: AccountDashboardWriteRequest }
  | { readonly kind: 'adoption'; readonly request: AccountAdoptionRequest };

export type PendingCompletion =
  | {
      readonly kind: 'dashboard-ack';
      readonly acknowledgement: AccountDashboardWriteAcknowledgement;
    }
  | { readonly kind: 'adoption-declined'; readonly requestId: string };

export type AccountSyncMutationResult =
  | { readonly status: 'committed'; readonly state: AccountSyncState }
  | { readonly status: 'conflict'; readonly state: AccountSyncState }
  | { readonly status: 'mismatch'; readonly state: AccountSyncState };

export interface AccountCacheVersion {
  readonly identity: string;
  readonly generation: number;
}

export interface AccountCacheRecord extends AccountCacheVersion {
  readonly version: 1;
  readonly accountId: string;
  readonly cacheValue: string;
}

export interface AccountRecoveryRecord {
  readonly version: 1;
  readonly accountId: string;
  readonly recoveryId: string;
  readonly rawValue: string;
  readonly createdAt: number;
}

export interface AccountPayloadRecord {
  readonly version: 1;
  readonly accountId: string;
  readonly kind: AccountPayloadKind;
  readonly payload: string;
  readonly updatedAt: number;
}

export type AccountCompareAndSwapResult =
  | { readonly status: 'committed'; readonly record: AccountCacheRecord | null }
  | { readonly status: 'conflict'; readonly record: AccountCacheRecord | null };

/** Small storage boundary that keeps IndexedDB transaction details out of the Zustand adapter. */
export interface AccountDatabase {
  readCache(accountId: string): Promise<AccountCacheRecord | null>;
  migrateCacheIfAbsent(accountId: string, cacheValue: string): Promise<AccountCacheRecord>;
  compareAndSwapCache(
    accountId: string,
    expected: AccountCacheVersion | null,
    value: string | null,
  ): Promise<AccountCompareAndSwapResult>;
  writeRecovery(accountId: string, rawValue: string): Promise<AccountRecoveryRecord>;
  readMetadata(accountId: string, kind: AccountMetadataKind): Promise<unknown>;
  writeMetadata(accountId: string, kind: AccountMetadataKind, value: unknown): Promise<void>;
  readPayload(accountId: string, kind: AccountPayloadKind): Promise<AccountPayloadRecord | null>;
  writePayload(
    accountId: string,
    kind: AccountPayloadKind,
    payload: string,
  ): Promise<AccountPayloadRecord>;
}

export interface AccountSynchronizationDatabase extends AccountDatabase {
  readSyncState(accountId: string): Promise<AccountSyncState>;
  establishCloudBaseline(
    accountId: string,
    expected: AccountCacheVersion | null,
    cloud: AccountDashboardReadResponse,
  ): Promise<AccountSyncMutationResult>;
  fastForwardCleanCache(
    accountId: string,
    expected: AccountCacheVersion,
    expectedAcknowledgedRevision: string,
    cloud: AccountDashboardReadResponse,
  ): Promise<AccountSyncMutationResult>;
  preparePendingRequest(
    accountId: string,
    expected: AccountCacheVersion,
    intent: PendingRequestIntent,
  ): Promise<AccountSyncMutationResult>;
  acknowledgePendingRequest(
    accountId: string,
    requestId: string,
    completion: PendingCompletion,
  ): Promise<AccountSyncMutationResult>;
  recordActiveConflict(
    accountId: string,
    expected: AccountCacheVersion,
    cloud: AccountDashboardReadResponse,
    pendingRequestId?: string,
  ): Promise<AccountSyncMutationResult>;
  resolveConflictUsingCloud(
    accountId: string,
    conflictId: string,
    latestCloud: AccountDashboardReadResponse,
  ): Promise<AccountSyncMutationResult>;
  resolveConflictUsingLocal(
    accountId: string,
    conflictId: string,
    latestCloud: AccountDashboardReadResponse,
    requestId: string,
  ): Promise<AccountSyncMutationResult>;
}

type StoredCache = AccountCacheRecord & { readonly key: string; readonly kind: 'cache' };
type StoredMetadata = {
  readonly key: string;
  readonly kind: AccountMetadataKind;
  readonly accountId: string;
  readonly value: unknown;
};
type StoredRecovery = AccountRecoveryRecord & { readonly key: string; readonly kind: 'recovery' };
type StoredPayload = AccountPayloadRecord & {
  readonly key: string;
  readonly recordType: 'payload';
};
type StoredRecord = StoredCache | StoredMetadata | StoredRecovery | StoredPayload;

function cacheKey(accountId: string): string {
  return `${accountId}:cache`;
}

function metadataKey(accountId: string, kind: AccountMetadataKind): string {
  return `${accountId}:${kind}`;
}

function recoveryKey(accountId: string, recoveryId: string): string {
  return `${accountId}:recovery:${recoveryId}`;
}

function payloadKey(accountId: string, kind: AccountPayloadKind): string {
  return `${accountId}:${kind}`;
}

function validCacheValue(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const inspection = classifyTrainingStorageValue(value);
  return inspection.status === 'ready';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function isWorkspaceId(value: unknown): value is string {
  return isAccountId(typeof value === 'string' ? value : '');
}

function isRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
  );
}

function isRevision(value: unknown): value is string {
  const maxRevision = '9223372036854775807';
  return (
    typeof value === 'string' &&
    /^(?:0|[1-9][0-9]{0,18})$/u.test(value) &&
    (value.length < maxRevision.length || value <= maxRevision)
  );
}

function isCatalogueVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function parseDashboardSnapshot(value: unknown): AccountDashboardSnapshot | null {
  if (!isRecord(value) || !hasExactKeys(value, ['version', 'state']) || value['version'] !== 10)
    return null;
  const state = parseDashboardPersistenceV10(value['state']);
  return state === null ? null : { version: 10, state };
}

function parseDashboardReadResponse(value: unknown): AccountDashboardReadResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'transportVersion',
      'accountWorkspaceId',
      'catalogueVersion',
      'revision',
      'dashboard',
      'updatedAt',
    ]) ||
    value['transportVersion'] !== 1 ||
    !isWorkspaceId(value['accountWorkspaceId']) ||
    !isCatalogueVersion(value['catalogueVersion']) ||
    !isRevision(value['revision']) ||
    (value['updatedAt'] !== null && !isTimestamp(value['updatedAt']))
  )
    return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_JSON_RESPONSE_BYTES)
      return null;
  } catch {
    return null;
  }
  const dashboard = value['dashboard'] === null ? null : parseDashboardSnapshot(value['dashboard']);
  if (value['dashboard'] !== null && dashboard === null) return null;
  if (
    (value['revision'] === '0' && (dashboard !== null || value['updatedAt'] !== null)) ||
    (value['revision'] !== '0' && (dashboard === null || value['updatedAt'] === null))
  )
    return null;
  return {
    transportVersion: 1,
    accountWorkspaceId: value['accountWorkspaceId'],
    catalogueVersion: value['catalogueVersion'],
    revision: value['revision'],
    dashboard,
    updatedAt: value['updatedAt'],
  };
}

function cacheValueFromCloud(cloud: AccountDashboardReadResponse): string {
  const raw =
    cloud.dashboard === null
      ? serializePersistedTrainingStateV10({ dashboardEntries: [] })
      : JSON.stringify({ version: 10, state: cloud.dashboard.state });
  const canonical = canonicalCacheValue(raw);
  if (canonical === null)
    throw new Error('Cloud dashboard did not produce a valid canonical v10 cache.');
  return canonical;
}

function canonicalCacheValue(value: string): string | null {
  const inspection = classifyTrainingStorageValue(value);
  return inspection.status === 'ready'
    ? serializePersistedTrainingStateV10(inspection.state)
    : null;
}

function cacheValueFromSnapshot(snapshot: AccountDashboardSnapshot): string {
  const state = parseDashboardPersistenceV10(snapshot.state);
  if (state === null) throw new Error('Dashboard snapshot is invalid.');
  return JSON.stringify({ version: 10, state });
}

function cacheValuesEqual(left: string, right: string): boolean {
  const canonicalLeft = canonicalCacheValue(left);
  return canonicalLeft !== null && canonicalLeft === canonicalCacheValue(right);
}

function requestWithinCloudLimit(value: unknown): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 2_097_152;
  } catch {
    return false;
  }
}

function parseDashboardWriteRequest(value: unknown): AccountDashboardWriteRequest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'transportVersion',
      'expectedAccountWorkspaceId',
      'expectedRevision',
      'requestId',
      'catalogueVersion',
      'dashboard',
    ]) ||
    value['transportVersion'] !== 1 ||
    !isWorkspaceId(value['expectedAccountWorkspaceId']) ||
    !isRevision(value['expectedRevision']) ||
    !isRequestId(value['requestId']) ||
    !isCatalogueVersion(value['catalogueVersion'])
  )
    return null;
  const dashboard = parseDashboardSnapshot(value['dashboard']);
  return dashboard === null
    ? null
    : {
        transportVersion: 1,
        expectedAccountWorkspaceId: value['expectedAccountWorkspaceId'],
        expectedRevision: value['expectedRevision'],
        requestId: value['requestId'],
        catalogueVersion: value['catalogueVersion'],
        dashboard,
      };
}

function isNonEmptyDashboard(snapshot: AccountDashboardSnapshot): boolean {
  const empty = serializePersistedTrainingStateV10({ dashboardEntries: [] });
  return !cacheValuesEqual(cacheValueFromSnapshot(snapshot), empty);
}

function parseAdoptionRequest(value: unknown): AccountAdoptionRequest | null {
  if (
    !isRecord(value) ||
    value['transportVersion'] !== 1 ||
    !isWorkspaceId(value['expectedAccountWorkspaceId']) ||
    !isRequestId(value['requestId'])
  )
    return null;
  if (value['decision'] === 'no') {
    return hasExactKeys(value, [
      'decision',
      'transportVersion',
      'expectedAccountWorkspaceId',
      'requestId',
    ])
      ? {
          decision: 'no',
          transportVersion: 1,
          expectedAccountWorkspaceId: value['expectedAccountWorkspaceId'],
          requestId: value['requestId'],
        }
      : null;
  }
  if (
    value['decision'] !== 'yes' ||
    !hasExactKeys(value, [
      'decision',
      'transportVersion',
      'expectedAccountWorkspaceId',
      'expectedRevision',
      'requestId',
      'catalogueVersion',
      'dashboard',
    ]) ||
    value['expectedRevision'] !== '0' ||
    !isCatalogueVersion(value['catalogueVersion'])
  )
    return null;
  const dashboard = parseDashboardSnapshot(value['dashboard']);
  return dashboard === null || !isNonEmptyDashboard(dashboard)
    ? null
    : {
        decision: 'yes',
        transportVersion: 1,
        expectedAccountWorkspaceId: value['expectedAccountWorkspaceId'],
        expectedRevision: '0',
        requestId: value['requestId'],
        catalogueVersion: value['catalogueVersion'],
        dashboard,
      };
}

function parseCacheVersion(value: unknown): AccountCacheVersion | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['identity', 'generation']) ||
    typeof value['identity'] !== 'string' ||
    value['identity'].length < 1 ||
    value['identity'].length > 128 ||
    !Number.isSafeInteger(value['generation']) ||
    (value['generation'] as number) < 0
  )
    return null;
  return { identity: value['identity'], generation: value['generation'] as number };
}

// Pending requests are replayable promises, not merely UI state. Reject malformed persisted
// envelopes before they can supply a request ID or dashboard to the network controller.
function parsePendingRequest(value: unknown, accountId: string): PendingAccountRequest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'version',
      'accountId',
      'kind',
      'cacheVersion',
      'request',
      'createdAt',
    ]) ||
    value['version'] !== 1 ||
    value['accountId'] !== accountId ||
    !Number.isSafeInteger(value['createdAt']) ||
    (value['createdAt'] as number) < 0
  )
    return null;
  const cacheVersion = parseCacheVersion(value['cacheVersion']);
  if (cacheVersion === null) return null;
  if (value['kind'] === 'dashboard-put') {
    const request = parseDashboardWriteRequest(value['request']);
    return request === null || !requestWithinCloudLimit(request)
      ? null
      : {
          version: 1,
          accountId,
          kind: 'dashboard-put',
          cacheVersion,
          request,
          createdAt: value['createdAt'] as number,
        };
  }
  if (value['kind'] === 'adoption') {
    const request = parseAdoptionRequest(value['request']);
    return request === null || !requestWithinCloudLimit(request)
      ? null
      : {
          version: 1,
          accountId,
          kind: 'adoption',
          cacheVersion,
          request,
          createdAt: value['createdAt'] as number,
        };
  }
  return null;
}

function parseActiveConflict(value: unknown, accountId: string): ActiveAccountConflict | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'version',
      'accountId',
      'conflictId',
      'localCacheVersion',
      'cloud',
      'createdAt',
    ]) ||
    value['version'] !== 1 ||
    value['accountId'] !== accountId ||
    !isRequestId(value['conflictId']) ||
    !Number.isSafeInteger(value['createdAt']) ||
    (value['createdAt'] as number) < 0
  )
    return null;
  const localCacheVersion = parseCacheVersion(value['localCacheVersion']);
  const cloud = parseDashboardReadResponse(value['cloud']);
  return localCacheVersion === null || cloud === null
    ? null
    : {
        version: 1,
        accountId,
        conflictId: value['conflictId'],
        localCacheVersion,
        cloud,
        createdAt: value['createdAt'] as number,
      };
}

function parseAcknowledgement(value: unknown): AccountAcknowledgement | null {
  if (!isRecord(value) || value['version'] !== 1 || typeof value['status'] !== 'string')
    return null;
  if (value['status'] === 'unknown') {
    if (hasExactKeys(value, ['version', 'status'])) return { version: 1, status: 'unknown' };
    return hasExactKeys(value, ['version', 'status', 'provenance']) &&
      value['provenance'] === 'new-empty'
      ? { version: 1, status: 'unknown', provenance: 'new-empty' }
      : null;
  }
  if (value['status'] === 'acknowledged') {
    if (
      !hasExactKeys(value, [
        'version',
        'status',
        'accountWorkspaceId',
        'revision',
        'requestId',
        'cacheIdentity',
        'generation',
        'updatedAt',
      ]) ||
      !isWorkspaceId(value['accountWorkspaceId']) ||
      !isRevision(value['revision']) ||
      (value['revision'] === '0') !== (value['updatedAt'] === null) ||
      (value['requestId'] !== null && !isRequestId(value['requestId'])) ||
      typeof value['cacheIdentity'] !== 'string' ||
      value['cacheIdentity'].length < 1 ||
      value['cacheIdentity'].length > 128 ||
      !Number.isSafeInteger(value['generation']) ||
      (value['generation'] as number) < 0 ||
      (value['updatedAt'] !== null && !isTimestamp(value['updatedAt']))
    )
      return null;
    return {
      version: 1,
      status: 'acknowledged',
      accountWorkspaceId: value['accountWorkspaceId'],
      revision: value['revision'],
      requestId: value['requestId'],
      cacheIdentity: value['cacheIdentity'],
      generation: value['generation'] as number,
      updatedAt: value['updatedAt'],
    };
  }
  if (
    value['status'] === 'adoption-declined' &&
    hasExactKeys(value, [
      'version',
      'status',
      'accountWorkspaceId',
      'requestId',
      'cacheIdentity',
      'generation',
    ]) &&
    isWorkspaceId(value['accountWorkspaceId']) &&
    isRequestId(value['requestId']) &&
    typeof value['cacheIdentity'] === 'string' &&
    value['cacheIdentity'].length > 0 &&
    value['cacheIdentity'].length <= 128 &&
    Number.isSafeInteger(value['generation']) &&
    (value['generation'] as number) >= 0
  ) {
    return {
      version: 1,
      status: 'adoption-declined',
      accountWorkspaceId: value['accountWorkspaceId'],
      requestId: value['requestId'],
      cacheIdentity: value['cacheIdentity'],
      generation: value['generation'] as number,
    };
  }
  return null;
}

function parseDashboardWriteAcknowledgement(
  value: unknown,
): AccountDashboardWriteAcknowledgement | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'transportVersion',
      'accountWorkspaceId',
      'requestId',
      'revision',
      'updatedAt',
    ]) ||
    value['transportVersion'] !== 1 ||
    !isWorkspaceId(value['accountWorkspaceId']) ||
    !isRequestId(value['requestId']) ||
    !isRevision(value['revision']) ||
    value['revision'] === '0' ||
    !isTimestamp(value['updatedAt'])
  )
    return null;
  return {
    transportVersion: 1,
    accountWorkspaceId: value['accountWorkspaceId'],
    requestId: value['requestId'],
    revision: value['revision'],
    updatedAt: value['updatedAt'],
  };
}

function assertCacheRecord(value: unknown, accountId: string): asserts value is StoredCache {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('IndexedDB account cache record is malformed or unsupported.');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 7 ||
    !Object.hasOwn(record, 'kind') ||
    record['kind'] !== 'cache' ||
    record['accountId'] !== accountId ||
    record['version'] !== 1 ||
    typeof record['identity'] !== 'string' ||
    record['identity'].length < 1 ||
    record['identity'].length > 128 ||
    !Number.isSafeInteger(record['generation']) ||
    (record['generation'] as number) < 0 ||
    !validCacheValue(record['cacheValue'])
  ) {
    throw new Error('IndexedDB account cache record is malformed or unsupported.');
  }
}

function assertMetadataRecord(
  value: unknown,
  accountId: string,
  kind: AccountMetadataKind,
): asserts value is StoredMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('IndexedDB account metadata record is malformed.');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 4 ||
    record['kind'] !== kind ||
    record['accountId'] !== accountId
  ) {
    throw new Error('IndexedDB account metadata record is malformed.');
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(record['value']);
  } catch (error) {
    throw new Error('IndexedDB account metadata cannot be serialized.', { cause: error });
  }
  if (
    serialized === undefined ||
    new TextEncoder().encode(serialized).byteLength > ACCOUNT_METADATA_MAX_BYTES
  ) {
    throw new Error('IndexedDB account metadata exceeds its bounded size.');
  }
  if (kind === 'ack') {
    if (parseAcknowledgement(record['value']) === null) {
      throw new Error('IndexedDB acknowledgement metadata is malformed.');
    }
  }
}

function assertPayloadRecord(
  value: unknown,
  accountId: string,
  kind: AccountPayloadKind,
): asserts value is StoredPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('IndexedDB account payload record is malformed.');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 7 ||
    record['recordType'] !== 'payload' ||
    record['version'] !== 1 ||
    record['accountId'] !== accountId ||
    record['kind'] !== kind ||
    typeof record['payload'] !== 'string' ||
    !Number.isSafeInteger(record['updatedAt'])
  )
    throw new Error('IndexedDB account payload record is malformed.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(record['payload']);
  } catch (error) {
    throw new Error('IndexedDB account payload is not valid JSON.', { cause: error });
  }
  if (
    new TextEncoder().encode(record['payload']).byteLength > ACCOUNT_PAYLOAD_MAX_BYTES ||
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  )
    throw new Error('IndexedDB account payload exceeds its bound or has an invalid shape.');
}

function recoveryDigest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${value.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

function assertRecoveryRecord(value: unknown, accountId: string): asserts value is StoredRecovery {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('IndexedDB account recovery record is malformed or oversized.');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 7 ||
    record['kind'] !== 'recovery' ||
    record['accountId'] !== accountId ||
    record['version'] !== 1 ||
    typeof record['recoveryId'] !== 'string' ||
    record['recoveryId'].length < 1 ||
    typeof record['rawValue'] !== 'string' ||
    record['rawValue'].length > ACCOUNT_RECOVERY_MAX_CHARACTERS ||
    !Number.isSafeInteger(record['createdAt']) ||
    !validCacheValue(record['rawValue'])
  ) {
    throw new Error('IndexedDB account recovery record is malformed or oversized.');
  }
}

function createIdentity(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to a non-secret local identity; it is only a CAS token.
  }
  return `cache-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createRequestIdentity(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch {
    throw new Error('Secure randomness is required for synchronization request IDs.');
  }
  throw new Error('Secure randomness is required for synchronization request IDs.');
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function storedRecordRequest(
  store: IDBObjectStore,
  key: string,
): Promise<StoredRecord | undefined> {
  return requestResult(store.get(key) as IDBRequest<StoredRecord | undefined>);
}

function cacheRecordFromStored(
  value: StoredRecord | undefined,
  accountId: string,
): AccountCacheRecord | null {
  if (value === undefined) return null;
  assertCacheRecord(value, accountId);
  return {
    version: 1,
    accountId,
    cacheValue: value.cacheValue,
    identity: value.identity,
    generation: value.generation,
  };
}

function parseStoredPayload<T>(
  value: StoredRecord | undefined,
  accountId: string,
  kind: AccountPayloadKind,
  parse: (value: unknown, accountId: string) => T | null,
): T | null {
  if (value === undefined) return null;
  assertPayloadRecord(value, accountId, kind);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.payload);
  } catch (error) {
    throw new Error('IndexedDB account payload is not valid JSON.', { cause: error });
  }
  const result = parse(parsed, accountId);
  if (result === null) throw new Error(`IndexedDB ${kind} payload is invalid.`);
  return result;
}

// Read the related records in one transaction. Cross-record checks prevent a cache from being
// treated as acknowledged by metadata or a pending request belonging to another account/version.
async function readSyncStateFromStore(
  store: IDBObjectStore,
  accountId: string,
): Promise<AccountSyncState> {
  const [cacheValue, acknowledgementValue, pendingValue, conflictValue] = await Promise.all([
    storedRecordRequest(store, cacheKey(accountId)),
    storedRecordRequest(store, metadataKey(accountId, 'ack')),
    storedRecordRequest(store, payloadKey(accountId, 'pending-request')),
    storedRecordRequest(store, payloadKey(accountId, 'active-conflict')),
  ]);
  const cache = cacheRecordFromStored(cacheValue, accountId);
  let acknowledgement: AccountAcknowledgement = { version: 1, status: 'unknown' };
  if (acknowledgementValue !== undefined) {
    assertMetadataRecord(acknowledgementValue, accountId, 'ack');
    const parsedAcknowledgement = parseAcknowledgement(acknowledgementValue.value);
    if (parsedAcknowledgement === null)
      throw new Error('IndexedDB acknowledgement metadata is malformed.');
    acknowledgement = parsedAcknowledgement;
    if (acknowledgement.status !== 'unknown' && acknowledgement.accountWorkspaceId !== accountId)
      throw new Error('IndexedDB acknowledgement belongs to another account.');
  }
  const pendingRequest = parseStoredPayload(
    pendingValue,
    accountId,
    'pending-request',
    parsePendingRequest,
  );
  const activeConflict = parseStoredPayload(
    conflictValue,
    accountId,
    'active-conflict',
    parseActiveConflict,
  );
  if (pendingRequest !== null && pendingRequest.request.expectedAccountWorkspaceId !== accountId) {
    throw new Error('IndexedDB pending request belongs to another account workspace.');
  }
  if (activeConflict !== null && activeConflict.cloud.accountWorkspaceId !== accountId) {
    throw new Error('IndexedDB active conflict belongs to another account workspace.');
  }
  if (
    activeConflict !== null &&
    cache !== null &&
    !cacheVersionMatches(cache, activeConflict.localCacheVersion)
  ) {
    throw new Error('IndexedDB active conflict is not bound to the current local cache.');
  }
  if (pendingRequest !== null && activeConflict !== null) {
    throw new Error('IndexedDB pending request and active conflict cannot coexist.');
  }
  if (
    cache !== null &&
    acknowledgement.status !== 'unknown' &&
    (acknowledgement.cacheIdentity !== cache.identity ||
      acknowledgement.generation > cache.generation)
  )
    throw new Error('IndexedDB acknowledgement is not bound to the current account cache.');
  if (
    pendingRequest !== null &&
    cache !== null &&
    (pendingRequest.cacheVersion.identity !== cache.identity ||
      pendingRequest.cacheVersion.generation > cache.generation)
  )
    throw new Error('IndexedDB pending request is not bound to the current account cache.');
  if (cache === null && (pendingRequest !== null || activeConflict !== null)) {
    throw new Error('IndexedDB synchronization records have no owning account cache.');
  }
  return { cache, acknowledgement, pendingRequest, activeConflict };
}

function cacheVersionMatches(
  cache: AccountCacheRecord | null,
  expected: AccountCacheVersion | null,
): boolean {
  return expected === null
    ? cache === null
    : cache !== null &&
        cache.identity === expected.identity &&
        cache.generation === expected.generation;
}

function makeStoredPayload(
  accountId: string,
  kind: AccountPayloadKind,
  value: PendingAccountRequest | ActiveAccountConflict,
): StoredPayload {
  const record: StoredPayload = {
    key: payloadKey(accountId, kind),
    recordType: 'payload',
    version: 1,
    accountId,
    kind,
    payload: JSON.stringify(value),
    updatedAt: Date.now(),
  };
  assertPayloadRecord(record, accountId, kind);
  return record;
}

function nextCacheRecord(
  accountId: string,
  current: AccountCacheRecord | null,
  value: string,
): StoredCache {
  if (current?.generation === Number.MAX_SAFE_INTEGER)
    throw new Error('IndexedDB account cache generation is exhausted.');
  return {
    key: cacheKey(accountId),
    kind: 'cache',
    version: 1,
    accountId,
    cacheValue: value,
    identity: current?.identity ?? createIdentity(),
    generation: (current?.generation ?? -1) + 1,
  };
}

function acknowledgementMetadata(accountId: string, value: AccountAcknowledgement): StoredMetadata {
  const record: StoredMetadata = {
    key: metadataKey(accountId, 'ack'),
    kind: 'ack',
    accountId,
    value,
  };
  assertMetadataRecord(record, accountId, 'ack');
  return record;
}

// The losing local dashboard must be readable inside the same transaction that replaces it.
// A quota or readback failure aborts the replacement rather than leaving only the cloud copy.
async function writeRecoveryInTransaction(
  store: IDBObjectStore,
  accountId: string,
  rawValue: string,
): Promise<void> {
  if (!validCacheValue(rawValue) || rawValue.length > ACCOUNT_RECOVERY_MAX_CHARACTERS) {
    throw new Error('Cannot retain an invalid or oversized losing local copy.');
  }
  const digest = recoveryDigest(rawValue);
  let collision = 0;
  let recoveryId = digest;
  let key = recoveryKey(accountId, recoveryId);
  let existing = await storedRecordRequest(store, key);
  while (existing !== undefined) {
    assertRecoveryRecord(existing, accountId);
    if (existing.rawValue === rawValue) return;
    collision += 1;
    recoveryId = `${digest}-${collision}`;
    key = recoveryKey(accountId, recoveryId);
    existing = await storedRecordRequest(store, key);
  }
  const record: StoredRecovery = {
    key,
    kind: 'recovery',
    version: 1,
    accountId,
    recoveryId,
    rawValue,
    createdAt: Date.now(),
  };
  assertRecoveryRecord(record, accountId);
  try {
    store.put(record);
    const readback = await storedRecordRequest(store, key);
    if (readback === undefined) throw new Error('Losing local recovery copy did not read back.');
    assertRecoveryRecord(readback, accountId);
    if (readback.rawValue !== rawValue)
      throw new Error('Losing local recovery copy did not match.');
  } catch (error) {
    try {
      store.transaction.abort();
    } catch {
      // A failed transaction may already have aborted itself.
    }
    throw error;
  }
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new DOMException('Transaction aborted.', 'AbortError'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
  // A request can reject before its caller reaches `await done`; keep the transaction's
  // independent failure observable to awaiters without an unhandled rejection.
  void done.catch(() => undefined);
  return done;
}

async function commitTransaction(
  transaction: IDBTransaction,
  done: Promise<void>,
  writes: () => void | Promise<void>,
): Promise<void> {
  try {
    await writes();
    await done;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already have aborted or completed.
    }
    await done.catch(() => undefined);
    throw error;
  }
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Unable to open account IndexedDB.'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Opening account IndexedDB was blocked.'));
    };
  });
}

/** Creates the single versioned IndexedDB account store. Reads validate every returned record. */
export function createIndexedDbAccountDatabase(
  factory?: IDBFactory,
): AccountSynchronizationDatabase {
  const indexedDBFactory = factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
  if (indexedDBFactory === undefined) {
    throw new Error('IndexedDB is unavailable in this browser.');
  }
  let databasePromise: Promise<IDBDatabase> | undefined;
  const db = (): Promise<IDBDatabase> => {
    databasePromise ??= openDatabase(indexedDBFactory);
    return databasePromise;
  };

  const readCache = async (accountId: string): Promise<AccountCacheRecord | null> => {
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const done = transactionDone(transaction);
    const value = await storedRecordRequest(
      transaction.objectStore(STORE_NAME),
      cacheKey(accountId),
    );
    await done;
    if (value === undefined) return null;
    assertCacheRecord(value, accountId);
    return {
      version: value.version,
      accountId,
      cacheValue: value.cacheValue,
      identity: value.identity,
      generation: value.generation,
    };
  };

  // A previously committed IndexedDB cache wins over the older LocalStorage source. A migration
  // retry must never replace edits made by another tab after its first successful cutover.
  const migrateCacheIfAbsent = async (
    accountId: string,
    cacheValue: string,
  ): Promise<AccountCacheRecord> => {
    if (!isAccountId(accountId) || !validCacheValue(cacheValue))
      throw new Error('Cannot migrate invalid account cache data.');
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const existing = await storedRecordRequest(store, cacheKey(accountId));
    if (existing !== undefined) {
      assertCacheRecord(existing, accountId);
      await done;
      return {
        version: 1,
        accountId,
        cacheValue: existing.cacheValue,
        identity: existing.identity,
        generation: existing.generation,
      };
    }
    const record: StoredCache = {
      key: cacheKey(accountId),
      kind: 'cache',
      version: 1,
      accountId,
      cacheValue,
      identity: createIdentity(),
      generation: 0,
    };
    const ackKey = metadataKey(accountId, 'ack');
    const ack = await storedRecordRequest(store, ackKey);
    if (ack !== undefined) {
      assertMetadataRecord(ack, accountId, 'ack');
      const parsed = parseAcknowledgement(ack.value);
      if (parsed?.status !== 'unknown') {
        await done;
        throw new Error('An orphaned acknowledgement prevents account cache migration.');
      }
    }
    const unknownAcknowledgement = acknowledgementMetadata(accountId, {
      version: 1,
      status: 'unknown',
    });
    await commitTransaction(transaction, done, () => {
      store.put(record);
      store.put(unknownAcknowledgement);
    });
    const confirmed = await readCache(accountId);
    if (
      confirmed === null ||
      confirmed.identity !== record.identity ||
      confirmed.generation !== record.generation ||
      confirmed.cacheValue !== cacheValue
    ) {
      throw new Error('IndexedDB account cache migration readback did not match.');
    }
    return confirmed;
  };

  // Zustand writes are optimistic across tabs. Compare identity and generation inside the write
  // transaction, and leave an identical current value unchanged so a reload is not a new edit.
  const compareAndSwapCache = async (
    accountId: string,
    expected: AccountCacheVersion | null,
    value: string | null,
  ): Promise<AccountCompareAndSwapResult> => {
    if (!isAccountId(accountId) || (value !== null && !validCacheValue(value)))
      throw new Error('Cannot store invalid account cache data.');
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const current = await storedRecordRequest(store, cacheKey(accountId));
    if (current !== undefined) assertCacheRecord(current, accountId);
    const matches =
      expected === null
        ? current === undefined
        : current !== undefined &&
          current.identity === expected.identity &&
          current.generation === expected.generation;
    if (!matches) {
      await done;
      return {
        status: 'conflict',
        record:
          current === undefined
            ? null
            : {
                version: current.version,
                accountId,
                cacheValue: current.cacheValue,
                identity: current.identity,
                generation: current.generation,
              },
      };
    }
    if (value !== null && current !== undefined && current.cacheValue === value) {
      await done;
      return {
        status: 'committed',
        record: {
          version: current.version,
          accountId,
          cacheValue: current.cacheValue,
          identity: current.identity,
          generation: current.generation,
        },
      };
    }
    if (value !== null && current?.generation === Number.MAX_SAFE_INTEGER) {
      await done;
      throw new Error('IndexedDB account cache generation is exhausted.');
    }
    let next: StoredCache;
    if (value === null) {
      const [pendingValue, conflictValue] = await Promise.all([
        storedRecordRequest(store, payloadKey(accountId, 'pending-request')),
        storedRecordRequest(store, payloadKey(accountId, 'active-conflict')),
      ]);
      if (pendingValue !== undefined || conflictValue !== undefined) {
        await done;
        return {
          status: 'conflict',
          record:
            current === undefined
              ? null
              : {
                  version: current.version,
                  accountId,
                  cacheValue: current.cacheValue,
                  identity: current.identity,
                  generation: current.generation,
                },
        };
      }
      const unknownAcknowledgement = acknowledgementMetadata(accountId, {
        version: 1,
        status: 'unknown',
      });
      await commitTransaction(transaction, done, () => {
        store.delete(cacheKey(accountId));
        store.put(unknownAcknowledgement);
      });
      return { status: 'committed', record: null };
    } else {
      next = {
        key: cacheKey(accountId),
        kind: 'cache',
        version: 1,
        accountId,
        cacheValue: value,
        identity: current?.identity ?? createIdentity(),
        generation: (current?.generation ?? -1) + 1,
      };
      const nextRecord = next;
      const storedConflict = await storedRecordRequest(
        store,
        payloadKey(accountId, 'active-conflict'),
      );
      let conflictRecord: StoredPayload | null = null;
      if (storedConflict !== undefined) {
        const conflict = parseStoredPayload(
          storedConflict,
          accountId,
          'active-conflict',
          parseActiveConflict,
        );
        if (conflict === null) throw new Error('IndexedDB active conflict is malformed.');
        conflictRecord = makeStoredPayload(accountId, 'active-conflict', {
          ...conflict,
          localCacheVersion: { identity: next.identity, generation: next.generation },
        });
      }
      const ack = await storedRecordRequest(store, metadataKey(accountId, 'ack'));
      let unknownAcknowledgement: StoredMetadata | null = null;
      if (ack !== undefined) assertMetadataRecord(ack, accountId, 'ack');
      const existingAcknowledgement = ack === undefined ? null : parseAcknowledgement(ack.value);
      if (ack !== undefined && existingAcknowledgement === null) {
        throw new Error('IndexedDB acknowledgement metadata is malformed.');
      }
      if (
        current === undefined &&
        existingAcknowledgement !== null &&
        existingAcknowledgement.status !== 'unknown'
      ) {
        throw new Error('An orphaned acknowledgement prevents account cache creation.');
      }
      const freshEmpty =
        current === undefined &&
        cacheValuesEqual(value, serializePersistedTrainingStateV10({ dashboardEntries: [] }));
      if (
        ack === undefined ||
        (existingAcknowledgement?.status === 'unknown' &&
          (existingAcknowledgement.provenance === 'new-empty' || freshEmpty))
      ) {
        unknownAcknowledgement = acknowledgementMetadata(accountId, {
          version: 1,
          status: 'unknown',
          ...(freshEmpty ? { provenance: 'new-empty' as const } : {}),
        });
      }
      await commitTransaction(transaction, done, () => {
        store.put(nextRecord);
        if (conflictRecord !== null) store.put(conflictRecord);
        if (unknownAcknowledgement !== null) store.put(unknownAcknowledgement);
      });
    }
    const readback = await readCache(accountId);
    if (
      readback === null ||
      readback.identity !== next.identity ||
      readback.generation !== next.generation ||
      readback.cacheValue !== value
    )
      throw new Error('IndexedDB account cache compare-and-swap readback did not match.');
    return { status: 'committed', record: readback };
  };

  const readMetadata = async (accountId: string, kind: AccountMetadataKind): Promise<unknown> => {
    if (!isAccountId(accountId)) throw new Error('Invalid account metadata owner.');
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const done = transactionDone(transaction);
    const value = await storedRecordRequest(
      transaction.objectStore(STORE_NAME),
      metadataKey(accountId, kind),
    );
    await done;
    if (value === undefined) return null;
    assertMetadataRecord(value, accountId, kind);
    return value.value;
  };

  const writeMetadata = async (
    accountId: string,
    kind: AccountMetadataKind,
    value: unknown,
  ): Promise<void> => {
    if (!isAccountId(accountId)) throw new Error('Invalid account metadata owner.');
    if (kind === 'ack' && parseAcknowledgement(value)?.status !== 'unknown') {
      throw new Error('Acknowledgement changes require a synchronization transaction.');
    }
    const record: StoredMetadata = { key: metadataKey(accountId, kind), kind, accountId, value };
    assertMetadataRecord(record, accountId, kind);
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).put(record);
    await done;
    const confirmed = await readMetadata(accountId, kind);
    if (JSON.stringify(confirmed) !== JSON.stringify(value))
      throw new Error('IndexedDB account metadata readback did not match.');
  };

  const writeRecovery = async (
    accountId: string,
    rawValue: string,
  ): Promise<AccountRecoveryRecord> => {
    if (
      !isAccountId(accountId) ||
      !validCacheValue(rawValue) ||
      rawValue.length > ACCOUNT_RECOVERY_MAX_CHARACTERS
    )
      throw new Error('Cannot retain invalid or oversized legacy account data.');
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const digest = recoveryDigest(rawValue);
    let collision = 0;
    let recoveryId = digest;
    let key = recoveryKey(accountId, recoveryId);
    let existing = await storedRecordRequest(store, key);
    while (existing !== undefined) {
      assertRecoveryRecord(existing, accountId);
      if (existing.rawValue === rawValue) {
        await done;
        return {
          version: 1,
          accountId,
          recoveryId: existing.recoveryId,
          rawValue,
          createdAt: existing.createdAt,
        };
      }
      collision += 1;
      recoveryId = `${digest}-${collision}`;
      key = recoveryKey(accountId, recoveryId);
      existing = await storedRecordRequest(store, key);
    }
    const recovery: StoredRecovery = {
      key,
      kind: 'recovery',
      version: 1,
      accountId,
      recoveryId,
      rawValue,
      createdAt: Date.now(),
    };
    assertRecoveryRecord(recovery, accountId);
    store.put(recovery);
    await done;
    const readTransaction = database.transaction(STORE_NAME, 'readonly');
    const readDone = transactionDone(readTransaction);
    const readback = await storedRecordRequest(
      readTransaction.objectStore(STORE_NAME),
      recovery.key,
    );
    await readDone;
    if (readback === undefined) throw new Error('IndexedDB recovery copy was not retained.');
    assertRecoveryRecord(readback, accountId);
    if (readback.rawValue !== rawValue)
      throw new Error('IndexedDB recovery copy readback did not match.');
    return { version: 1, accountId, recoveryId, rawValue, createdAt: readback.createdAt };
  };

  const readPayload = async (
    accountId: string,
    kind: AccountPayloadKind,
  ): Promise<AccountPayloadRecord | null> => {
    if (!isAccountId(accountId)) throw new Error('Invalid account payload owner.');
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const done = transactionDone(transaction);
    const value = await storedRecordRequest(
      transaction.objectStore(STORE_NAME),
      payloadKey(accountId, kind),
    );
    await done;
    if (value === undefined) return null;
    assertPayloadRecord(value, accountId, kind);
    if (kind === 'pending-request') {
      const pending = parseStoredPayload(value, accountId, kind, parsePendingRequest);
      if (pending === null || pending.request.expectedAccountWorkspaceId !== accountId) {
        throw new Error('IndexedDB pending request is invalid or belongs to another workspace.');
      }
    } else {
      const conflict = parseStoredPayload(value, accountId, kind, parseActiveConflict);
      if (conflict === null || conflict.cloud.accountWorkspaceId !== accountId) {
        throw new Error('IndexedDB active conflict is invalid or belongs to another workspace.');
      }
    }
    return {
      version: value.version,
      accountId,
      kind,
      payload: value.payload,
      updatedAt: value.updatedAt,
    };
  };

  const writePayload = async (
    accountId: string,
    kind: AccountPayloadKind,
    payload: string,
  ): Promise<AccountPayloadRecord> => {
    if (!isAccountId(accountId)) throw new Error('Invalid account payload owner.');
    const record: StoredPayload = {
      key: payloadKey(accountId, kind),
      recordType: 'payload',
      version: 1,
      accountId,
      kind,
      payload,
      updatedAt: Date.now(),
    };
    assertPayloadRecord(record, accountId, kind);
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (error) {
      throw new Error('IndexedDB account payload is not valid JSON.', { cause: error });
    }
    if (kind === 'pending-request') {
      const pending = parsePendingRequest(parsed, accountId);
      if (pending === null || pending.request.expectedAccountWorkspaceId !== accountId) {
        throw new Error('IndexedDB pending request is invalid or belongs to another workspace.');
      }
    } else {
      const conflict = parseActiveConflict(parsed, accountId);
      if (conflict === null || conflict.cloud.accountWorkspaceId !== accountId) {
        throw new Error('IndexedDB active conflict is invalid or belongs to another workspace.');
      }
    }
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).put(record);
    await done;
    const confirmed = await readPayload(accountId, kind);
    if (confirmed === null || confirmed.payload !== payload) {
      throw new Error('IndexedDB account payload readback did not match.');
    }
    return confirmed;
  };

  const readSyncState = async (accountId: string): Promise<AccountSyncState> => {
    if (!isAccountId(accountId)) throw new Error('Invalid synchronization-state owner.');
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const done = transactionDone(transaction);
    const state = await readSyncStateFromStore(transaction.objectStore(STORE_NAME), accountId);
    await done;
    return state;
  };

  const syncStateAfterCommit = async (accountId: string): Promise<AccountSyncMutationResult> => ({
    status: 'committed',
    state: await readSyncState(accountId),
  });

  const establishCloudBaseline = async (
    accountId: string,
    expected: AccountCacheVersion | null,
    untrustedCloud: AccountDashboardReadResponse,
  ): Promise<AccountSyncMutationResult> => {
    const cloud = parseDashboardReadResponse(untrustedCloud);
    if (!isAccountId(accountId) || cloud === null || cloud.accountWorkspaceId !== accountId) {
      throw new Error('Cloud dashboard baseline is invalid or belongs to another account.');
    }
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const state = await readSyncStateFromStore(store, accountId);
    if (
      !cacheVersionMatches(state.cache, expected) ||
      state.pendingRequest !== null ||
      state.activeConflict !== null ||
      state.acknowledgement.status !== 'unknown'
    ) {
      await done;
      return { status: 'conflict', state };
    }
    const cloudCacheValue = cacheValueFromCloud(cloud);
    let nextCache = state.cache;
    let cacheRecordToWrite: StoredCache | null = null;
    if (state.cache === null) {
      if (!validCacheValue(cloudCacheValue))
        throw new Error('Cloud baseline did not produce a valid v10 cache.');
      const cacheRecord: StoredCache = {
        key: cacheKey(accountId),
        kind: 'cache',
        version: 1,
        accountId,
        cacheValue: cloudCacheValue,
        identity: createIdentity(),
        generation: 0,
      };
      nextCache = cacheRecord;
      cacheRecordToWrite = cacheRecord;
    } else if (!cacheValuesEqual(state.cache.cacheValue, cloudCacheValue)) {
      const emptyCache = serializePersistedTrainingStateV10({ dashboardEntries: [] });
      if (
        !cacheValuesEqual(state.cache.cacheValue, emptyCache) ||
        state.cache.generation !== 0 ||
        state.acknowledgement.provenance !== 'new-empty'
      ) {
        await done;
        return { status: 'conflict', state };
      }
      if (!validCacheValue(cloudCacheValue))
        throw new Error('Cloud baseline did not produce a valid v10 cache.');
      const cacheRecord = nextCacheRecord(accountId, state.cache, cloudCacheValue);
      nextCache = cacheRecord;
      cacheRecordToWrite = cacheRecord;
    }
    if (nextCache === null) throw new Error('Cloud baseline cache was not established.');
    const acknowledgement = acknowledgementMetadata(accountId, {
      version: 1,
      status: 'acknowledged',
      accountWorkspaceId: cloud.accountWorkspaceId,
      revision: cloud.revision,
      requestId: null,
      cacheIdentity: nextCache.identity,
      generation: nextCache.generation,
      updatedAt: cloud.updatedAt,
    });
    await commitTransaction(transaction, done, () => {
      if (cacheRecordToWrite !== null) store.put(cacheRecordToWrite);
      store.put(acknowledgement);
    });
    return syncStateAfterCommit(accountId);
  };

  const fastForwardCleanCache = async (
    accountId: string,
    expected: AccountCacheVersion,
    expectedAcknowledgedRevision: string,
    untrustedCloud: AccountDashboardReadResponse,
  ): Promise<AccountSyncMutationResult> => {
    const cloud = parseDashboardReadResponse(untrustedCloud);
    if (
      !isAccountId(accountId) ||
      cloud === null ||
      cloud.accountWorkspaceId !== accountId ||
      !isRevision(expectedAcknowledgedRevision)
    ) {
      throw new Error('Cloud fast-forward input is invalid.');
    }
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const state = await readSyncStateFromStore(store, accountId);
    const ack = state.acknowledgement;
    if (
      state.cache === null ||
      !cacheVersionMatches(state.cache, expected) ||
      ack.status !== 'acknowledged' ||
      ack.revision !== expectedAcknowledgedRevision ||
      ack.generation !== state.cache.generation ||
      ack.accountWorkspaceId !== cloud.accountWorkspaceId ||
      ack.cacheIdentity !== state.cache.identity ||
      state.pendingRequest !== null ||
      state.activeConflict !== null ||
      BigInt(cloud.revision) <= BigInt(ack.revision)
    ) {
      await done;
      return { status: 'conflict', state };
    }
    const cloudCacheValue = cacheValueFromCloud(cloud);
    if (!validCacheValue(cloudCacheValue)) throw new Error('Cloud fast-forward cache is invalid.');
    let nextCache: AccountCacheRecord = state.cache;
    let cacheRecordToWrite: StoredCache | null = null;
    if (!cacheValuesEqual(state.cache.cacheValue, cloudCacheValue)) {
      const record = nextCacheRecord(accountId, state.cache, cloudCacheValue);
      nextCache = record;
      cacheRecordToWrite = record;
    }
    const acknowledgement = acknowledgementMetadata(accountId, {
      version: 1,
      status: 'acknowledged',
      accountWorkspaceId: cloud.accountWorkspaceId,
      revision: cloud.revision,
      requestId: null,
      cacheIdentity: nextCache.identity,
      generation: nextCache.generation,
      updatedAt: cloud.updatedAt,
    });
    await commitTransaction(transaction, done, () => {
      if (cacheRecordToWrite !== null) store.put(cacheRecordToWrite);
      store.put(acknowledgement);
    });
    return syncStateAfterCommit(accountId);
  };

  // Persist the exact validated intent before any HTTP call. A newer local generation may coexist
  // with this request, but another request cannot displace it until replay is resolved.
  const preparePendingRequest = async (
    accountId: string,
    expected: AccountCacheVersion,
    intent: PendingRequestIntent,
  ): Promise<AccountSyncMutationResult> => {
    if (!isAccountId(accountId)) throw new Error('Invalid pending-request owner.');
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const state = await readSyncStateFromStore(store, accountId);
    if (
      state.cache === null ||
      !cacheVersionMatches(state.cache, expected) ||
      state.activeConflict !== null
    ) {
      await done;
      return { status: 'conflict', state };
    }
    let pending: PendingAccountRequest;
    let requestId: string;
    if (intent.kind === 'dashboard-put') {
      const request = parseDashboardWriteRequest(intent.request);
      if (
        request === null ||
        request.expectedAccountWorkspaceId !== accountId ||
        !requestWithinCloudLimit(request)
      ) {
        await done;
        return { status: 'mismatch', state };
      }
      requestId = request.requestId;
      const ack = state.acknowledgement;
      if (
        (ack.status === 'acknowledged' &&
          (ack.accountWorkspaceId !== request.expectedAccountWorkspaceId ||
            ack.cacheIdentity !== state.cache.identity ||
            ack.revision !== request.expectedRevision)) ||
        ((ack.status === 'unknown' || ack.status === 'adoption-declined') &&
          request.expectedRevision !== '0') ||
        (ack.status === 'adoption-declined' &&
          (ack.accountWorkspaceId !== request.expectedAccountWorkspaceId ||
            ack.cacheIdentity !== state.cache.identity)) ||
        !cacheValuesEqual(cacheValueFromSnapshot(request.dashboard), state.cache.cacheValue)
      ) {
        await done;
        return { status: 'mismatch', state };
      }
      pending = {
        version: 1,
        accountId,
        kind: 'dashboard-put',
        cacheVersion: { identity: state.cache.identity, generation: state.cache.generation },
        request,
        createdAt: Date.now(),
      };
    } else {
      const request = parseAdoptionRequest(intent.request);
      if (
        request === null ||
        request.expectedAccountWorkspaceId !== accountId ||
        !requestWithinCloudLimit(request)
      ) {
        await done;
        return { status: 'mismatch', state };
      }
      requestId = request.requestId;
      if (request.decision === 'yes') {
        const ack = state.acknowledgement;
        if (
          (ack.status === 'acknowledged' &&
            (ack.accountWorkspaceId !== request.expectedAccountWorkspaceId ||
              ack.cacheIdentity !== state.cache.identity ||
              ack.revision !== '0')) ||
          ack.status === 'adoption-declined' ||
          request.expectedRevision !== '0' ||
          state.cache.generation !== 0 ||
          !cacheValuesEqual(
            state.cache.cacheValue,
            serializePersistedTrainingStateV10({ dashboardEntries: [] }),
          )
        ) {
          await done;
          return { status: 'mismatch', state };
        }
      }
      pending = {
        version: 1,
        accountId,
        kind: 'adoption',
        cacheVersion: { identity: state.cache.identity, generation: state.cache.generation },
        request,
        createdAt: Date.now(),
      };
    }
    if (state.pendingRequest !== null) {
      await done;
      return state.pendingRequest.kind === pending.kind &&
        JSON.stringify(state.pendingRequest.request) === JSON.stringify(pending.request)
        ? { status: 'committed', state }
        : { status: 'conflict', state };
    }
    await commitTransaction(transaction, done, () => {
      store.put(makeStoredPayload(accountId, 'pending-request', pending));
    });
    const confirmed = await readSyncState(accountId);
    if (confirmed.pendingRequest?.request.requestId !== requestId)
      throw new Error('Pending request readback did not match.');
    return { status: 'committed', state: confirmed };
  };

  // The acknowledgement and pending deletion commit together. A lost response can therefore
  // replay the original ID, while a newer cache generation remains dirty after acknowledgement.
  const acknowledgePendingRequest = async (
    accountId: string,
    requestId: string,
    completion: PendingCompletion,
  ): Promise<AccountSyncMutationResult> => {
    if (!isAccountId(accountId) || !isRequestId(requestId))
      throw new Error('Pending acknowledgement identity is invalid.');
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const state = await readSyncStateFromStore(store, accountId);
    const pending = state.pendingRequest;
    if (pending === null || pending.request.requestId !== requestId) {
      await done;
      return { status: 'mismatch', state };
    }
    let acknowledgement: AccountAcknowledgement;
    if (completion.kind === 'adoption-declined') {
      if (
        pending.kind !== 'adoption' ||
        pending.request.decision !== 'no' ||
        completion.requestId !== requestId
      ) {
        await done;
        return { status: 'mismatch', state };
      }
      acknowledgement = {
        version: 1,
        status: 'adoption-declined',
        accountWorkspaceId: pending.request.expectedAccountWorkspaceId,
        requestId,
        cacheIdentity: pending.cacheVersion.identity,
        generation: pending.cacheVersion.generation,
      };
    } else {
      const ack = parseDashboardWriteAcknowledgement(completion.acknowledgement);
      if (
        pending.kind !== 'dashboard-put' ||
        ack === null ||
        ack.requestId !== requestId ||
        ack.accountWorkspaceId !== pending.request.expectedAccountWorkspaceId ||
        BigInt(ack.revision) !== BigInt(pending.request.expectedRevision) + 1n
      ) {
        await done;
        return { status: 'mismatch', state };
      }
      acknowledgement = {
        version: 1,
        status: 'acknowledged',
        accountWorkspaceId: ack.accountWorkspaceId,
        revision: ack.revision,
        requestId,
        cacheIdentity: pending.cacheVersion.identity,
        generation: pending.cacheVersion.generation,
        updatedAt: ack.updatedAt,
      };
    }
    const ackRecord = acknowledgementMetadata(accountId, acknowledgement);
    await commitTransaction(transaction, done, () => {
      store.put(ackRecord);
      store.delete(payloadKey(accountId, 'pending-request'));
    });
    const confirmed = await readSyncState(accountId);
    if (
      confirmed.pendingRequest !== null ||
      JSON.stringify(confirmed.acknowledgement) !== JSON.stringify(acknowledgement)
    ) {
      throw new Error('Pending acknowledgement transaction readback did not match.');
    }
    return { status: 'committed', state: confirmed };
  };

  const recordActiveConflict = async (
    accountId: string,
    expected: AccountCacheVersion,
    untrustedCloud: AccountDashboardReadResponse,
    pendingRequestId?: string,
  ): Promise<AccountSyncMutationResult> => {
    const cloud = parseDashboardReadResponse(untrustedCloud);
    if (
      !isAccountId(accountId) ||
      cloud === null ||
      cloud.accountWorkspaceId !== accountId ||
      (pendingRequestId !== undefined && !isRequestId(pendingRequestId))
    ) {
      throw new Error('Active conflict input is invalid.');
    }
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const state = await readSyncStateFromStore(store, accountId);
    if (state.cache === null || state.activeConflict !== null) {
      await done;
      return { status: 'conflict', state };
    }
    if (
      (state.pendingRequest !== null &&
        pendingRequestId !== state.pendingRequest.request.requestId) ||
      (pendingRequestId !== undefined &&
        state.pendingRequest?.request.requestId !== pendingRequestId)
    ) {
      await done;
      return { status: 'mismatch', state };
    }
    let localVersion: AccountCacheVersion;
    if (cacheVersionMatches(state.cache, expected)) {
      localVersion = { identity: expected.identity, generation: expected.generation };
    } else if (
      pendingRequestId !== undefined &&
      state.pendingRequest?.request.requestId === pendingRequestId &&
      state.pendingRequest.cacheVersion.identity === expected.identity &&
      state.pendingRequest.cacheVersion.generation === expected.generation
    )
      localVersion = { identity: state.cache.identity, generation: state.cache.generation };
    else {
      await done;
      return { status: 'conflict', state };
    }
    if (
      pendingRequestId !== undefined &&
      state.pendingRequest?.request.requestId !== pendingRequestId
    ) {
      await done;
      return { status: 'mismatch', state };
    }
    const cloudCacheValue = cacheValueFromCloud(cloud);
    if (!validCacheValue(cloudCacheValue))
      throw new Error('Conflict cloud dashboard cache is invalid.');
    if (cacheValuesEqual(state.cache.cacheValue, cloudCacheValue)) {
      const acknowledgement = acknowledgementMetadata(accountId, {
        version: 1,
        status: 'acknowledged',
        accountWorkspaceId: cloud.accountWorkspaceId,
        revision: cloud.revision,
        requestId: null,
        generation: state.cache.generation,
        updatedAt: cloud.updatedAt,
        cacheIdentity: state.cache.identity,
      });
      await commitTransaction(transaction, done, () => {
        store.put(acknowledgement);
        if (pendingRequestId !== undefined) store.delete(payloadKey(accountId, 'pending-request'));
        if (state.activeConflict !== null) store.delete(payloadKey(accountId, 'active-conflict'));
      });
    } else {
      const conflict: ActiveAccountConflict = {
        version: 1,
        accountId,
        conflictId: createRequestIdentity(),
        localCacheVersion: localVersion,
        cloud,
        createdAt: Date.now(),
      };
      const conflictRecord = makeStoredPayload(accountId, 'active-conflict', conflict);
      await commitTransaction(transaction, done, () => {
        store.put(conflictRecord);
        if (pendingRequestId !== undefined) store.delete(payloadKey(accountId, 'pending-request'));
      });
    }
    const confirmed = await readSyncState(accountId);
    if (
      !cacheValuesEqual(state.cache.cacheValue, cloudCacheValue) &&
      confirmed.activeConflict === null
    ) {
      throw new Error('Active conflict record did not read back.');
    }
    return { status: 'committed', state: confirmed };
  };

  // The server's newly read revision is the version chosen here, not the snapshot captured when
  // conflict was first noticed. Save the losing local cache atomically before clearing the choice.
  const resolveConflictUsingCloud = async (
    accountId: string,
    conflictId: string,
    untrustedLatestCloud: AccountDashboardReadResponse,
  ): Promise<AccountSyncMutationResult> => {
    const latestCloud = parseDashboardReadResponse(untrustedLatestCloud);
    if (
      !isAccountId(accountId) ||
      !isRequestId(conflictId) ||
      latestCloud === null ||
      latestCloud.accountWorkspaceId !== accountId
    )
      throw new Error('Conflict identity is invalid.');
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const state = await readSyncStateFromStore(store, accountId);
    const conflict = state.activeConflict;
    if (
      state.cache === null ||
      conflict === null ||
      conflict.conflictId !== conflictId ||
      BigInt(latestCloud.revision) < BigInt(conflict.cloud.revision) ||
      !cacheVersionMatches(state.cache, conflict.localCacheVersion) ||
      state.pendingRequest !== null
    ) {
      await done;
      return { status: 'conflict', state };
    }
    const cloudCacheValue = cacheValueFromCloud(latestCloud);
    if (!validCacheValue(cloudCacheValue)) throw new Error('Conflict cloud cache is invalid.');
    const currentCache = state.cache;
    const next = nextCacheRecord(accountId, currentCache, cloudCacheValue);
    const acknowledgement = acknowledgementMetadata(accountId, {
      version: 1,
      status: 'acknowledged',
      accountWorkspaceId: latestCloud.accountWorkspaceId,
      revision: latestCloud.revision,
      requestId: null,
      generation: next.generation,
      updatedAt: latestCloud.updatedAt,
      cacheIdentity: next.identity,
    });
    await commitTransaction(transaction, done, async () => {
      await writeRecoveryInTransaction(store, accountId, currentCache.cacheValue);
      store.put(next);
      store.put(acknowledgement);
      store.delete(payloadKey(accountId, 'active-conflict'));
    });
    const confirmed = await readSyncState(accountId);
    if (confirmed.activeConflict !== null || confirmed.cache?.cacheValue !== cloudCacheValue) {
      throw new Error('Use-cloud conflict resolution readback did not match.');
    }
    return { status: 'committed', state: confirmed };
  };

  const resolveConflictUsingLocal = async (
    accountId: string,
    conflictId: string,
    untrustedLatestCloud: AccountDashboardReadResponse,
    requestId: string,
  ): Promise<AccountSyncMutationResult> => {
    const latestCloud = parseDashboardReadResponse(untrustedLatestCloud);
    if (
      !isAccountId(accountId) ||
      !isRequestId(conflictId) ||
      !isRequestId(requestId) ||
      latestCloud === null ||
      latestCloud.accountWorkspaceId !== accountId
    ) {
      throw new Error('Use-local conflict resolution input is invalid.');
    }
    const database = await db();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const state = await readSyncStateFromStore(store, accountId);
    const conflict = state.activeConflict;
    if (
      state.cache === null ||
      conflict === null ||
      conflict.conflictId !== conflictId ||
      !cacheVersionMatches(state.cache, conflict.localCacheVersion) ||
      state.pendingRequest !== null ||
      conflict.cloud.accountWorkspaceId !== latestCloud.accountWorkspaceId
    ) {
      await done;
      return { status: 'conflict', state };
    }
    const parsedCache: unknown = JSON.parse(state.cache.cacheValue);
    if (!isRecord(parsedCache) || parsedCache['version'] !== 10)
      throw new Error('Current account cache is malformed.');
    const dashboard = parseDashboardSnapshot({ version: 10, state: parsedCache['state'] });
    if (dashboard === null) throw new Error('Current account dashboard is invalid.');
    const request: AccountDashboardWriteRequest = {
      transportVersion: 1,
      expectedAccountWorkspaceId: latestCloud.accountWorkspaceId,
      expectedRevision: latestCloud.revision,
      requestId,
      catalogueVersion: latestCloud.catalogueVersion,
      dashboard,
    };
    if (!requestWithinCloudLimit(request)) {
      await done;
      return { status: 'mismatch', state };
    }
    const pending: PendingDashboardWrite = {
      version: 1,
      accountId,
      kind: 'dashboard-put',
      cacheVersion: { identity: state.cache.identity, generation: state.cache.generation },
      request,
      createdAt: Date.now(),
    };
    const pendingRecord = makeStoredPayload(accountId, 'pending-request', pending);
    await commitTransaction(transaction, done, () => {
      store.put(pendingRecord);
      store.delete(payloadKey(accountId, 'active-conflict'));
    });
    const confirmed = await readSyncState(accountId);
    if (
      confirmed.activeConflict !== null ||
      confirmed.pendingRequest?.request.requestId !== requestId
    ) {
      throw new Error('Use-local conflict resolution readback did not match.');
    }
    return { status: 'committed', state: confirmed };
  };

  return {
    readCache,
    migrateCacheIfAbsent,
    compareAndSwapCache,
    writeRecovery,
    readMetadata,
    writeMetadata,
    readPayload,
    writePayload,
    readSyncState,
    establishCloudBaseline,
    fastForwardCleanCache,
    preparePendingRequest,
    acknowledgePendingRequest,
    recordActiveConflict,
    resolveConflictUsingCloud,
    resolveConflictUsingLocal,
  };
}
