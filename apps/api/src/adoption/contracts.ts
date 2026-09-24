/**
 * Adoption transport and public-response contracts.
 *
 * Adoption deliberately reuses the complete-dashboard wire payload for a Yes
 * decision. The account/session proof is supplied by the authentication
 * boundary; the expected account identifier remains a mismatch guard only.
 */
import type { DashboardWriteAcknowledgement, Timestamp } from '../dashboard/contracts.js';
import { hashCanonicalJson } from '../dashboard/canonicalization.js';
import {
  isAccountWorkspaceId,
  isCatalogueVersion,
  isNonZeroRevision,
  isRequestId,
  isRevision,
  isTimestamp,
  validateDashboardWrite,
} from '../dashboard/validation.js';
import type { ValidatedDashboardWrite } from '../dashboard/validation.js';
import type {
  AccountWorkspaceId,
  CatalogueVersion,
  NonZeroRevision,
  RequestId,
} from '../dashboard/contracts.js';

export type AdoptionDecision = 'yes' | 'no';

export interface AdoptionCompletionAccepted {
  readonly decision: 'yes';
  readonly requestId: RequestId;
  readonly acknowledgedRevision: NonZeroRevision;
  readonly timestamp: Timestamp;
}

export interface AdoptionCompletionDeclined {
  readonly decision: 'no';
  readonly requestId: RequestId;
}

export type AdoptionCompletion = AdoptionCompletionAccepted | AdoptionCompletionDeclined;

/** Public state returned as part of the authenticated session response. */
export type AdoptionStatus =
  | { readonly status: 'pending' | 'unavailable'; readonly capability: boolean }
  | {
      readonly status: 'accepted';
      readonly capability: false;
      readonly completion: AdoptionCompletionAccepted;
    }
  | {
      readonly status: 'declined';
      readonly capability: false;
      readonly completion: AdoptionCompletionDeclined;
    };

export interface AdoptionNoRequest {
  readonly decision: 'no';
  readonly transportVersion: 1;
  readonly expectedAccountWorkspaceId: AccountWorkspaceId;
  readonly requestId: RequestId;
}

export interface AdoptionYesRequest {
  readonly decision: 'yes';
  readonly transportVersion: 1;
  readonly expectedAccountWorkspaceId: AccountWorkspaceId;
  readonly expectedRevision: '0';
  readonly requestId: RequestId;
  readonly catalogueVersion: CatalogueVersion;
  readonly dashboard: {
    readonly version: 10;
    readonly state: unknown;
  };
}

export type AdoptionRequest = AdoptionYesRequest | AdoptionNoRequest;

/** The structural result after strict JSON and dashboard validation. */
export interface ValidatedAdoptionRequest {
  readonly request: AdoptionRequest;
  /** SHA-256 of the complete canonical adoption envelope, including decision. */
  readonly requestDigest: string;
  /** Present only for a Yes request, and already validated for this account. */
  readonly dashboardIntent?: ValidatedDashboardWrite;
}

export type AdoptionValidationError =
  | 'INVALID_ADOPTION_REQUEST'
  | 'ACCOUNT_WORKSPACE_MISMATCH'
  | 'UNSUPPORTED_TRANSPORT_VERSION'
  | 'UNSUPPORTED_DASHBOARD_VERSION'
  | 'INVALID_DASHBOARD'
  | 'ADOPTION_REVISION_REQUIRED';

export type AdoptionRequestValidation =
  | { readonly status: 'valid'; readonly intent: ValidatedAdoptionRequest }
  | { readonly status: 'invalid'; readonly error: AdoptionValidationError };

/** A response intentionally contains only account-scoped public completion data. */
export type AdoptionResponse =
  | {
      readonly status: 'accepted';
      readonly completion: AdoptionCompletionAccepted;
      readonly acknowledgement: DashboardWriteAcknowledgement;
    }
  | { readonly status: 'declined'; readonly completion: AdoptionCompletionDeclined }
  | {
      readonly status: 'replayed';
      readonly completion: AdoptionCompletion;
      readonly acknowledgement?: DashboardWriteAcknowledgement;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

/**
 * Validate the public session adoption union at the authentication boundary.
 * Persistence and adapter results are treated as untrusted values here so a
 * malformed row can never add private fields to the response.
 */
export function validateAdoptionStatus(value: unknown): AdoptionStatus | null {
  if (!isRecord(value)) return null;
  const status = value['status'];
  const capability = value['capability'];
  if (status === 'pending' || status === 'unavailable') {
    if (
      !hasExactKeys(value, ['status', 'capability']) ||
      typeof capability !== 'boolean' ||
      (status === 'unavailable' && capability)
    ) {
      return null;
    }
    return Object.freeze({ status, capability });
  }

  if (status !== 'accepted' && status !== 'declined') return null;
  if (capability !== false || !hasExactKeys(value, ['status', 'capability', 'completion'])) {
    return null;
  }
  const completion = value['completion'];
  if (!isRecord(completion)) return null;

  if (status === 'declined') {
    const decision = completion['decision'];
    const requestId = completion['requestId'];
    if (
      decision !== 'no' ||
      !isRequestId(requestId) ||
      !hasExactKeys(completion, ['decision', 'requestId'])
    ) {
      return null;
    }
    return Object.freeze({
      status,
      capability: false,
      completion: Object.freeze({ decision: 'no', requestId }),
    });
  }

  const decision = completion['decision'];
  const requestId = completion['requestId'];
  const acknowledgedRevision = completion['acknowledgedRevision'];
  const timestamp = completion['timestamp'];
  if (
    decision !== 'yes' ||
    !isRequestId(requestId) ||
    !isNonZeroRevision(acknowledgedRevision) ||
    !isTimestamp(timestamp) ||
    !hasExactKeys(completion, ['decision', 'requestId', 'acknowledgedRevision', 'timestamp'])
  ) {
    return null;
  }
  return Object.freeze({
    status,
    capability: false,
    completion: Object.freeze({
      decision: 'yes',
      requestId,
      acknowledgedRevision,
      timestamp,
    }),
  });
}

/**
 * Strictly validate the complete adoption POST envelope. Yes is deliberately
 * passed through the existing dashboard validator so its recursive state and
 * canonical representation stay identical to ordinary dashboard writes.
 */
export function validateAdoptionRequest(
  value: unknown,
  accountWorkspaceId: AccountWorkspaceId,
): AdoptionRequestValidation {
  const invalid = (error: AdoptionValidationError): AdoptionRequestValidation => ({
    status: 'invalid',
    error,
  });
  try {
    if (!isRecord(value) || typeof value['decision'] !== 'string') {
      return invalid('INVALID_ADOPTION_REQUEST');
    }
    const decision = value['decision'];
    if (decision === 'no') {
      if (
        !hasExactKeys(value, [
          'decision',
          'transportVersion',
          'expectedAccountWorkspaceId',
          'requestId',
        ])
      ) {
        return invalid('INVALID_ADOPTION_REQUEST');
      }
      if (value['transportVersion'] !== 1) {
        return invalid(
          typeof value['transportVersion'] === 'number' &&
            Number.isSafeInteger(value['transportVersion']) &&
            value['transportVersion'] >= 0
            ? 'UNSUPPORTED_TRANSPORT_VERSION'
            : 'INVALID_ADOPTION_REQUEST',
        );
      }
      const expectedAccountWorkspaceId = value['expectedAccountWorkspaceId'];
      const requestId = value['requestId'];
      if (!isAccountWorkspaceId(expectedAccountWorkspaceId) || !isRequestId(requestId)) {
        return invalid('INVALID_ADOPTION_REQUEST');
      }
      if (expectedAccountWorkspaceId !== accountWorkspaceId) {
        return invalid('ACCOUNT_WORKSPACE_MISMATCH');
      }
      const request: AdoptionNoRequest = Object.freeze({
        decision: 'no',
        transportVersion: 1,
        expectedAccountWorkspaceId,
        requestId,
      });
      return {
        status: 'valid',
        intent: Object.freeze({
          request,
          requestDigest: hashCanonicalJson(request),
        }),
      };
    }

    if (decision !== 'yes') return invalid('INVALID_ADOPTION_REQUEST');
    if (
      !hasExactKeys(value, [
        'decision',
        'transportVersion',
        'expectedAccountWorkspaceId',
        'expectedRevision',
        'requestId',
        'catalogueVersion',
        'dashboard',
      ])
    ) {
      return invalid('INVALID_ADOPTION_REQUEST');
    }
    if (value['transportVersion'] !== 1) {
      return invalid(
        typeof value['transportVersion'] === 'number' &&
          Number.isSafeInteger(value['transportVersion']) &&
          value['transportVersion'] >= 0
          ? 'UNSUPPORTED_TRANSPORT_VERSION'
          : 'INVALID_ADOPTION_REQUEST',
      );
    }
    const expectedAccountWorkspaceId = value['expectedAccountWorkspaceId'];
    const expectedRevision = value['expectedRevision'];
    const requestId = value['requestId'];
    const catalogueVersion = value['catalogueVersion'];
    if (
      !isAccountWorkspaceId(expectedAccountWorkspaceId) ||
      !isRevision(expectedRevision) ||
      !isRequestId(requestId) ||
      !isCatalogueVersion(catalogueVersion)
    ) {
      return invalid('INVALID_ADOPTION_REQUEST');
    }
    if (expectedAccountWorkspaceId !== accountWorkspaceId) {
      return invalid('ACCOUNT_WORKSPACE_MISMATCH');
    }
    if (expectedRevision !== '0') return invalid('ADOPTION_REVISION_REQUIRED');
    const dashboardValue = value['dashboard'];
    const dashboardValidation = validateDashboardWrite(
      {
        transportVersion: 1,
        expectedAccountWorkspaceId,
        expectedRevision,
        requestId,
        catalogueVersion,
        dashboard: dashboardValue,
      },
      accountWorkspaceId,
    );
    if (dashboardValidation.status === 'invalid') {
      switch (dashboardValidation.error) {
        case 'UNSUPPORTED_TRANSPORT_VERSION':
          return invalid('UNSUPPORTED_TRANSPORT_VERSION');
        case 'UNSUPPORTED_DASHBOARD_VERSION':
          return invalid('UNSUPPORTED_DASHBOARD_VERSION');
        case 'ACCOUNT_WORKSPACE_MISMATCH':
          return invalid('ACCOUNT_WORKSPACE_MISMATCH');
        case 'INVALID_DASHBOARD':
          return invalid('INVALID_DASHBOARD');
        default:
          return invalid('INVALID_ADOPTION_REQUEST');
      }
    }
    const dashboardIntent = dashboardValidation.intent;
    const request: AdoptionYesRequest = Object.freeze({
      decision: 'yes',
      transportVersion: 1,
      expectedAccountWorkspaceId,
      expectedRevision: '0',
      requestId,
      catalogueVersion,
      dashboard: dashboardIntent.request.dashboard,
    });
    return {
      status: 'valid',
      intent: Object.freeze({
        request,
        requestDigest: hashCanonicalJson(request),
        dashboardIntent,
      }),
    };
  } catch {
    return invalid('INVALID_ADOPTION_REQUEST');
  }
}

/** Build an accepted public completion from a persistence result. */
export function validateAdoptionCompletion(value: unknown): AdoptionCompletion | null {
  if (!isRecord(value)) return null;
  const decision = value['decision'];
  const requestId = value['requestId'];
  if (decision === 'no') {
    if (!hasExactKeys(value, ['decision', 'requestId']) || !isRequestId(requestId)) return null;
    return Object.freeze({ decision: 'no', requestId });
  }
  if (
    decision !== 'yes' ||
    !hasExactKeys(value, ['decision', 'requestId', 'acknowledgedRevision', 'timestamp'])
  ) {
    return null;
  }
  const acknowledgedRevision = value['acknowledgedRevision'];
  const rawTimestamp = value['timestamp'];
  let timestamp: unknown = rawTimestamp;
  if (rawTimestamp instanceof Date) {
    try {
      timestamp = Date.prototype.toISOString.call(rawTimestamp);
    } catch {
      return null;
    }
  }
  if (
    !isRequestId(requestId) ||
    !isNonZeroRevision(acknowledgedRevision) ||
    !isTimestamp(timestamp)
  ) {
    return null;
  }
  return Object.freeze({ decision: 'yes', requestId, acknowledgedRevision, timestamp });
}
