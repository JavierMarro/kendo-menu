import { randomUUID } from 'node:crypto';

import {
  sessionAuthorizationFailureResponse,
  type SessionAuthorization,
} from '../auth/session-authorization.js';
import type {
  DashboardPersistenceFailure,
  DashboardPersistenceProvider,
} from '../persistence/dashboard-contracts.js';
import {
  DashboardRequestError,
  checkDashboardRequestHeaders,
  readDashboardRequestBody,
} from './request-body.js';
import {
  createDashboardCatalogue,
  isAccountWorkspaceId,
  isRequestId,
  isRevision,
  validateDashboardAcknowledgement,
  validateDashboardWrite,
  type DashboardCatalogue,
} from './validation.js';

export interface DashboardLogEntry {
  readonly diagnosticId: string;
  readonly code: 'DASHBOARD_PERSISTENCE_FAILED';
}

export interface DashboardDependencies {
  readonly authorization: SessionAuthorization;
  readonly persistence: DashboardPersistenceProvider;
  readonly catalogue?: DashboardCatalogue;
  readonly diagnosticId?: () => string;
  readonly logger?: { log(entry: DashboardLogEntry): void };
}

export interface Dashboard {
  handle(request: Request): Promise<Response>;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
}

function failure(outcome: DashboardPersistenceFailure): Response {
  switch (outcome.status) {
    case 'unauthenticated':
      return sessionAuthorizationFailureResponse('UNAUTHENTICATED');
    case 'auth-unavailable':
      return sessionAuthorizationFailureResponse('AUTH_UNAVAILABLE');
    case 'workspace-mismatch':
      return json(403, { error: 'ACCOUNT_WORKSPACE_MISMATCH' });
    case 'unavailable':
      return json(503, { error: 'DASHBOARD_UNAVAILABLE' });
  }
}

/**
 * Unregistered Request/Response application foundation. Job 5B can register this same handle
 * for GET/PUT/HEAD and other methods; PUT MUST use Elysia parse: 'none'. No runtime provider,
 * database implementation, session touch, or production route is installed by this module.
 */
export function createDashboard(dependencies: DashboardDependencies): Dashboard {
  const catalogue = dependencies.catalogue ?? createDashboardCatalogue();
  const generateDiagnosticId = dependencies.diagnosticId ?? randomUUID;

  function unavailable(): Response {
    try {
      const diagnosticId = generateDiagnosticId();
      if (isRequestId(diagnosticId))
        dependencies.logger?.log({ diagnosticId, code: 'DASHBOARD_PERSISTENCE_FAILED' });
    } catch {
      // Diagnostics cannot change the fixed failure response or receive an exception/input.
    }
    return json(503, { error: 'DASHBOARD_UNAVAILABLE' });
  }

  return {
    async handle(request: Request): Promise<Response> {
      // Method and query rejection happens before headers, authorization, and any body read.
      if (request.method !== 'GET' && request.method !== 'PUT') {
        const headers = { allow: 'GET, PUT', 'cache-control': 'private, no-store' };
        return request.method === 'HEAD'
          ? new Response(null, { status: 405, headers })
          : Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers });
      }
      try {
        if (new URL(request.url).search !== '')
          return json(400, { error: 'INVALID_DASHBOARD_REQUEST' });
      } catch {
        return json(400, { error: 'INVALID_DASHBOARD_REQUEST' });
      }
      if (request.method === 'PUT') {
        const headerError = checkDashboardRequestHeaders(request);
        if (headerError !== null) {
          const error = new DashboardRequestError(headerError);
          return json(error.status, { error: error.code });
        }
      }

      let authorized;
      try {
        authorized =
          request.method === 'GET'
            ? await dependencies.authorization.authorizeRead(request)
            : await dependencies.authorization.authorizeWrite(request);
      } catch {
        return sessionAuthorizationFailureResponse('AUTH_UNAVAILABLE');
      }
      if (authorized.status === 'rejected') return authorized.response;
      const proof = authorized.proof;
      if (!isAccountWorkspaceId(proof.userId))
        return sessionAuthorizationFailureResponse('AUTH_UNAVAILABLE');

      if (request.method === 'GET') {
        try {
          const persistence =
            typeof dependencies.persistence === 'function'
              ? await dependencies.persistence()
              : dependencies.persistence;
          const outcome = await persistence.read(proof);
          if (outcome.status !== 'read') return failure(outcome);
          const response = catalogue.validateRead(outcome.response, proof.userId);
          return response === null ? unavailable() : json(200, response);
        } catch {
          return unavailable();
        }
      }

      let value: unknown;
      try {
        value = await readDashboardRequestBody(request);
      } catch (error) {
        return error instanceof DashboardRequestError
          ? json(error.status, { error: error.code })
          : json(400, { error: 'INVALID_DASHBOARD_REQUEST' });
      }
      const validation = validateDashboardWrite(value, proof.userId);
      if (validation.status === 'invalid') {
        const status =
          validation.error === 'INVALID_DASHBOARD_REQUEST'
            ? 400
            : validation.error === 'ACCOUNT_WORKSPACE_MISMATCH'
              ? 403
              : 422;
        return json(status, { error: validation.error });
      }
      try {
        const persistence =
          typeof dependencies.persistence === 'function'
            ? await dependencies.persistence()
            : dependencies.persistence;
        const outcome = await persistence.compareAndWrite(proof, validation.intent, (intent) =>
          catalogue.isCompatible(intent),
        );
        switch (outcome.status) {
          case 'written':
          case 'replayed': {
            const acknowledgement = validateDashboardAcknowledgement(
              outcome.acknowledgement,
              validation.intent,
            );
            return acknowledgement === null ? unavailable() : json(200, acknowledgement);
          }
          case 'revision-conflict':
            return isRevision(outcome.currentRevision)
              ? json(409, { error: 'REVISION_CONFLICT', currentRevision: outcome.currentRevision })
              : unavailable();
          case 'request-id-reused':
            return json(409, { error: 'REQUEST_ID_REUSED' });
          case 'catalogue-incompatible':
            return json(422, { error: 'CATALOGUE_INCOMPATIBLE' });
          case 'unauthenticated':
          case 'auth-unavailable':
          case 'workspace-mismatch':
          case 'unavailable':
            return failure(outcome);
          default:
            return unavailable();
        }
      } catch {
        return unavailable();
      }
    },
  };
}
