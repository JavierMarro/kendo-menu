/**
 * HTTP boundary for the one-use guest-copy decision on a managed account.
 * Authorization binds the request to the server-mapped account before its bounded payload is read.
 * A Yes acknowledgement is returned only after the copied snapshot commits.
 */
import {
  accountAuthorizationFailureResponse,
  type AccountAuthorization,
} from '../auth/account-authorization.js';
import type { ManagedCopyPersistence } from '../persistence/managed-copy-contracts.js';
import {
  DashboardRequestError,
  checkDashboardRequestHeaders,
  readDashboardRequestBody,
} from '../dashboard/request-body.js';
import { createDashboardCatalogue, isAccountWorkspaceId } from '../dashboard/validation.js';
import type { DashboardCatalogue } from '../dashboard/validation.js';
import { validateAdoptionRequest } from './contracts.js';

export interface Adoption {
  handle(request: Request): Promise<Response>;
}

function json(status: number, value: unknown): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'private, no-store' } });
}

export function createAdoption(dependencies: {
  readonly authorization: AccountAuthorization;
  readonly persistence:
    ManagedCopyPersistence | (() => ManagedCopyPersistence | Promise<ManagedCopyPersistence>);
  readonly catalogue?: DashboardCatalogue;
}): Adoption {
  const catalogue = dependencies.catalogue ?? createDashboardCatalogue();

  return {
    async handle(request) {
      if (request.method !== 'POST') {
        const headers = { allow: 'POST', 'cache-control': 'private, no-store' };
        return request.method === 'HEAD'
          ? new Response(null, { status: 405, headers })
          : Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers });
      }
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        return json(400, { error: 'INVALID_ADOPTION_REQUEST' });
      }
      if (url.search !== '') return json(400, { error: 'INVALID_ADOPTION_REQUEST' });

      const headerError = checkDashboardRequestHeaders(request);
      if (headerError !== null) {
        const error = new DashboardRequestError(headerError);
        return json(error.status, { error: error.code });
      }

      let authorized;
      try {
        authorized = await dependencies.authorization.authorizeWrite(request);
      } catch {
        return accountAuthorizationFailureResponse('unavailable');
      }
      if (authorized.status !== 'authorized') {
        return accountAuthorizationFailureResponse(authorized.status);
      }
      const proof = authorized.proof;
      if (!isAccountWorkspaceId(proof.accountId))
        return accountAuthorizationFailureResponse('unavailable');

      let body: unknown;
      // Read the bounded dashboard snapshot only after the bearer maps to an account.
      try {
        body = await readDashboardRequestBody(request);
      } catch (error) {
        return error instanceof DashboardRequestError
          ? json(error.status, { error: error.code })
          : json(400, { error: 'INVALID_ADOPTION_REQUEST' });
      }
      const validated = validateAdoptionRequest(body, proof.accountId);
      if (validated.status === 'invalid') {
        const status =
          validated.error === 'INVALID_ADOPTION_REQUEST'
            ? 400
            : validated.error === 'ACCOUNT_WORKSPACE_MISMATCH'
              ? 403
              : 422;
        return json(status, { error: validated.error });
      }

      try {
        const persistence =
          typeof dependencies.persistence === 'function'
            ? await dependencies.persistence()
            : dependencies.persistence;
        const outcome = await persistence.consumeOpportunity(proof, validated.intent, (intent) =>
          catalogue.isCompatible(intent),
        );
        switch (outcome.status) {
          case 'accepted':
            return json(200, {
              status: 'accepted',
              completion: {
                decision: 'yes',
                requestId: validated.intent.request.requestId,
                acknowledgedRevision: outcome.acknowledgement.revision,
                timestamp: outcome.acknowledgement.updatedAt,
              },
              acknowledgement: outcome.acknowledgement,
            });
          case 'declined':
            return json(200, {
              status: 'declined',
              completion: { decision: 'no', requestId: validated.intent.request.requestId },
            });
          case 'capability-unavailable':
            return json(409, { error: 'COPY_OPPORTUNITY_UNAVAILABLE' });
          case 'revision-conflict':
            return json(409, { error: 'REVISION_CONFLICT' });
          case 'catalogue-incompatible':
            return json(422, { error: 'CATALOGUE_INCOMPATIBLE' });
          case 'account-not-initialized':
            return json(409, { error: 'ACCOUNT_NOT_INITIALIZED' });
          case 'unauthenticated':
            return accountAuthorizationFailureResponse('unauthenticated');
          case 'unavailable':
            return json(503, { error: 'ADOPTION_UNAVAILABLE' });
        }
      } catch {
        return json(503, { error: 'ADOPTION_UNAVAILABLE' });
      }
    },
  };
}
