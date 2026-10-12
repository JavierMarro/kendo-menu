/**
 * Guest-copy transport contracts reuse the complete-dashboard wire payload for a Yes decision.
 * Authorization supplies a proof bound to verified managed identity; the expected account
 * identifier remains a mismatch guard only.
 */
import {
  isAccountWorkspaceId,
  isCatalogueVersion,
  isRequestId,
  isRevision,
  validateDashboardWrite,
} from '../dashboard/validation.js';
import type { ValidatedDashboardWrite } from '../dashboard/validation.js';
import type { AccountWorkspaceId, CatalogueVersion, RequestId } from '../dashboard/contracts.js';

export interface AdoptionNoRequest {
  readonly decision: 'no';
  readonly transportVersion: 1;
  readonly expectedAccountWorkspaceId: AccountWorkspaceId;
  readonly copyOpportunityId: string;
  readonly requestId: RequestId;
}
export interface AdoptionYesRequest {
  readonly decision: 'yes';
  readonly transportVersion: 1;
  readonly expectedAccountWorkspaceId: AccountWorkspaceId;
  readonly copyOpportunityId: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
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
          'copyOpportunityId',
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
      const copyOpportunityId = value['copyOpportunityId'];
      if (
        !isAccountWorkspaceId(expectedAccountWorkspaceId) ||
        !isRequestId(requestId) ||
        !isAccountWorkspaceId(copyOpportunityId)
      ) {
        return invalid('INVALID_ADOPTION_REQUEST');
      }
      if (expectedAccountWorkspaceId !== accountWorkspaceId) {
        return invalid('ACCOUNT_WORKSPACE_MISMATCH');
      }
      const request: AdoptionNoRequest = Object.freeze({
        decision: 'no',
        transportVersion: 1,
        expectedAccountWorkspaceId,
        copyOpportunityId,
        requestId,
      });
      return {
        status: 'valid',
        intent: Object.freeze({
          request,
        }),
      };
    }

    if (decision !== 'yes') return invalid('INVALID_ADOPTION_REQUEST');
    if (
      !hasExactKeys(value, [
        'decision',
        'transportVersion',
        'expectedAccountWorkspaceId',
        'copyOpportunityId',
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
    const copyOpportunityId = value['copyOpportunityId'];
    const catalogueVersion = value['catalogueVersion'];
    if (
      !isAccountWorkspaceId(expectedAccountWorkspaceId) ||
      !isRevision(expectedRevision) ||
      !isRequestId(requestId) ||
      !isAccountWorkspaceId(copyOpportunityId) ||
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
    const dashboardState = dashboardIntent.request.dashboard.state;
    if (
      !isRecord(dashboardState) ||
      !Array.isArray(dashboardState['dashboardEntries']) ||
      dashboardState['dashboardEntries'].length === 0
    ) {
      return invalid('INVALID_DASHBOARD');
    }
    const request: AdoptionYesRequest = Object.freeze({
      decision: 'yes',
      transportVersion: 1,
      expectedAccountWorkspaceId,
      copyOpportunityId,
      expectedRevision: '0',
      requestId,
      catalogueVersion,
      dashboard: dashboardIntent.request.dashboard,
    });
    return {
      status: 'valid',
      intent: Object.freeze({
        request,
        dashboardIntent,
      }),
    };
  } catch {
    return invalid('INVALID_ADOPTION_REQUEST');
  }
}
