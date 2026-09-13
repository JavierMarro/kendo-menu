import { DEFAULT_TRAINING_SETS, type TrainingSet } from '@kendo-menu/domain';
import {
  isDashboardCatalogueCompatible,
  parseDashboardPersistenceV10,
} from '@kendo-menu/domain/dashboard-persistence';

import { canonicalizeJson, hashCanonicalJson } from './canonicalization.js';
import {
  MAX_REVISION,
  type AccountWorkspaceId,
  type CatalogueVersion,
  type DashboardReadResponse,
  type DashboardWriteAcknowledgement,
  type DashboardWriteRequest,
  type NonZeroRevision,
  type RequestId,
  type Revision,
  type Timestamp,
} from './contracts.js';

export function isAccountWorkspaceId(value: unknown): value is AccountWorkspaceId {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)
  );
}

export function isRequestId(value: unknown): value is RequestId {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
  );
}

export function isRevision(value: unknown): value is Revision {
  return (
    typeof value === 'string' &&
    /^(?:0|[1-9][0-9]{0,18})$/u.test(value) &&
    (value.length < MAX_REVISION.length || value <= MAX_REVISION)
  );
}

export function isNonZeroRevision(value: unknown): value is NonZeroRevision {
  return isRevision(value) && value !== '0';
}

export function isCatalogueVersion(value: unknown): value is CatalogueVersion {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

export function isTimestamp(value: unknown): value is Timestamp {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

export type DashboardValidationError =
  | 'INVALID_DASHBOARD_REQUEST'
  | 'UNSUPPORTED_TRANSPORT_VERSION'
  | 'UNSUPPORTED_DASHBOARD_VERSION'
  | 'INVALID_DASHBOARD'
  | 'ACCOUNT_WORKSPACE_MISMATCH';

declare const validatedWriteBrand: unique symbol;

/** Constructed only after strict JSON and structural validation, never from client types alone. */
export interface ValidatedDashboardWrite {
  readonly [validatedWriteBrand]: true;
  readonly request: DashboardWriteRequest;
  readonly canonicalRequestJson: string;
  readonly requestDigest: string;
  readonly canonicalDashboardJson: string;
}

export type DashboardWriteValidation =
  | { readonly status: 'valid'; readonly intent: ValidatedDashboardWrite }
  | { readonly status: 'invalid'; readonly error: DashboardValidationError };

// The private concrete class makes the validation boundary explicit without type assertions.
class ValidatedWrite implements ValidatedDashboardWrite {
  declare readonly [validatedWriteBrand]: true;
  readonly canonicalRequestJson: string;
  readonly requestDigest: string;
  readonly canonicalDashboardJson: string;

  constructor(readonly request: DashboardWriteRequest) {
    this.canonicalRequestJson = canonicalizeJson(request);
    this.requestDigest = hashCanonicalJson(request);
    this.canonicalDashboardJson = canonicalizeJson(request.dashboard);
    Object.freeze(this);
  }
}

/** Structural validation precedes receipt lookup; current catalogue checks deliberately do not. */
export function validateDashboardWrite(
  value: unknown,
  accountWorkspaceId: AccountWorkspaceId,
): DashboardWriteValidation {
  const invalid = (error: DashboardValidationError): DashboardWriteValidation => ({
    status: 'invalid',
    error,
  });
  try {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        'transportVersion',
        'expectedAccountWorkspaceId',
        'expectedRevision',
        'requestId',
        'catalogueVersion',
        'dashboard',
      ])
    )
      return invalid('INVALID_DASHBOARD_REQUEST');
    if (
      typeof value['transportVersion'] !== 'number' ||
      !Number.isSafeInteger(value['transportVersion']) ||
      value['transportVersion'] < 0
    )
      return invalid('INVALID_DASHBOARD_REQUEST');
    if (value['transportVersion'] !== 1) return invalid('UNSUPPORTED_TRANSPORT_VERSION');
    const expectedAccountWorkspaceId = value['expectedAccountWorkspaceId'];
    const expectedRevision = value['expectedRevision'];
    const requestId = value['requestId'];
    const catalogueVersion = value['catalogueVersion'];
    const dashboard = value['dashboard'];
    if (
      !isAccountWorkspaceId(expectedAccountWorkspaceId) ||
      !isRevision(expectedRevision) ||
      !isRequestId(requestId) ||
      !isCatalogueVersion(catalogueVersion) ||
      !isRecord(dashboard) ||
      !hasExactKeys(dashboard, ['version', 'state'])
    )
      return invalid('INVALID_DASHBOARD_REQUEST');
    if (
      typeof dashboard['version'] !== 'number' ||
      !Number.isSafeInteger(dashboard['version']) ||
      dashboard['version'] < 0
    )
      return invalid('INVALID_DASHBOARD_REQUEST');
    if (dashboard['version'] !== 10) return invalid('UNSUPPORTED_DASHBOARD_VERSION');
    if (expectedAccountWorkspaceId !== accountWorkspaceId)
      return invalid('ACCOUNT_WORKSPACE_MISMATCH');
    const state = parseDashboardPersistenceV10(dashboard['state']);
    if (state === null) return invalid('INVALID_DASHBOARD');
    const request: DashboardWriteRequest = Object.freeze({
      transportVersion: 1,
      expectedAccountWorkspaceId,
      expectedRevision,
      requestId,
      catalogueVersion,
      dashboard: Object.freeze({ version: 10, state }),
    });
    return { status: 'valid', intent: new ValidatedWrite(request) };
  } catch {
    return invalid('INVALID_DASHBOARD');
  }
}

export interface DashboardCatalogue {
  readonly version: CatalogueVersion;
  /** Called by persistence only for new request IDs, after retained receipt lookup. */
  isCompatible(intent: ValidatedDashboardWrite): boolean;
  validateRead(
    value: unknown,
    accountWorkspaceId: AccountWorkspaceId,
  ): DashboardReadResponse | null;
}

/** The digest covers the complete ordered runtime catalogue, including recursive activity metadata. */
export function createDashboardCatalogue(
  catalogue: readonly TrainingSet[] = DEFAULT_TRAINING_SETS,
): DashboardCatalogue {
  const version = hashCanonicalJson(catalogue);
  if (!isCatalogueVersion(version)) throw new Error('INVALID_CATALOGUE_DIGEST');
  return Object.freeze({
    version,
    isCompatible: (intent: ValidatedDashboardWrite): boolean =>
      intent.request.catalogueVersion === version &&
      isDashboardCatalogueCompatible(intent.request.dashboard.state, catalogue),
    validateRead: (
      value: unknown,
      accountWorkspaceId: AccountWorkspaceId,
    ): DashboardReadResponse | null => {
      try {
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
          value['accountWorkspaceId'] !== accountWorkspaceId ||
          value['catalogueVersion'] !== version
        )
          return null;
        if (value['revision'] === '0') {
          return value['dashboard'] === null && value['updatedAt'] === null
            ? {
                transportVersion: 1,
                accountWorkspaceId,
                catalogueVersion: version,
                revision: '0',
                dashboard: null,
                updatedAt: null,
              }
            : null;
        }
        const revision = value['revision'];
        const updatedAt = value['updatedAt'];
        const dashboard = value['dashboard'];
        if (
          !isNonZeroRevision(revision) ||
          !isTimestamp(updatedAt) ||
          !isRecord(dashboard) ||
          !hasExactKeys(dashboard, ['version', 'state']) ||
          dashboard['version'] !== 10
        )
          return null;
        const state = parseDashboardPersistenceV10(dashboard['state']);
        if (state === null || !isDashboardCatalogueCompatible(state, catalogue)) return null;
        return {
          transportVersion: 1,
          accountWorkspaceId,
          catalogueVersion: version,
          revision,
          updatedAt,
          dashboard: { version: 10, state },
        };
      } catch {
        return null;
      }
    },
  });
}

export function validateDashboardAcknowledgement(
  value: unknown,
  intent: ValidatedDashboardWrite,
): DashboardWriteAcknowledgement | null {
  try {
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
      value['accountWorkspaceId'] !== intent.request.expectedAccountWorkspaceId ||
      value['requestId'] !== intent.request.requestId
    )
      return null;
    const revision = value['revision'];
    const updatedAt = value['updatedAt'];
    if (
      !isNonZeroRevision(revision) ||
      !isTimestamp(updatedAt) ||
      BigInt(revision) !== BigInt(intent.request.expectedRevision) + 1n
    )
      return null;
    return {
      transportVersion: 1,
      accountWorkspaceId: intent.request.expectedAccountWorkspaceId,
      requestId: intent.request.requestId,
      revision,
      updatedAt,
    };
  } catch {
    return null;
  }
}
