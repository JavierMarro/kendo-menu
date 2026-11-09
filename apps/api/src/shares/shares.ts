/** Public preview and authenticated creation/recipient reads for custom-menu links. */
import {
  accountAuthorizationFailureResponse,
  type AccountAuthorization,
} from '../auth/account-authorization.js';
import type { AccountWorkspaceId } from '../dashboard/contracts.js';
import {
  checkDashboardRequestHeaders,
  DashboardRequestError,
  readDashboardRequestBody,
} from '../dashboard/request-body.js';
import { isAccountWorkspaceId, isRevision } from '../dashboard/validation.js';
import type { Revision } from '../dashboard/contracts.js';
import type {
  ManagedSharesPersistence,
  RecipientShareReadOutcome,
  ShareCreateOutcome,
  ShareReadOutcome,
} from '../persistence/shares-contracts.js';
import { TRAINING_DATA_LIMITS } from '@kendo-menu/domain';

export interface Shares {
  handle(request: Request): Promise<Response>;
}

export interface SharesDependencies {
  readonly authorization: AccountAuthorization;
  readonly persistence: ManagedSharesPersistence | (() => Promise<ManagedSharesPersistence>);
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function parseCreateRequest(value: unknown): {
  readonly expectedAccountWorkspaceId: AccountWorkspaceId;
  readonly expectedRevision: Revision;
  readonly entryId: string;
} | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['expectedAccountWorkspaceId', 'expectedRevision', 'entryId']) ||
    !isAccountWorkspaceId(value['expectedAccountWorkspaceId']) ||
    !isRevision(value['expectedRevision']) ||
    typeof value['entryId'] !== 'string' ||
    value['entryId'].trim().length === 0 ||
    value['entryId'].length > TRAINING_DATA_LIMITS.identifierCharacters
  )
    return null;
  return {
    expectedAccountWorkspaceId: value['expectedAccountWorkspaceId'],
    expectedRevision: value['expectedRevision'],
    entryId: value['entryId'],
  };
}

function shareResponse(outcome: ShareReadOutcome): Response {
  switch (outcome.status) {
    case 'found':
      return json(200, { snapshot: outcome.snapshot });
    case 'not-found':
      return json(404, { error: 'SHARE_NOT_FOUND' });
    case 'unavailable':
      return json(503, { error: 'SHARE_UNAVAILABLE' });
  }
}

function recipientResponse(
  outcome: RecipientShareReadOutcome,
  accountWorkspaceId: AccountWorkspaceId,
): Response {
  switch (outcome.status) {
    case 'found':
      return json(200, {
        snapshot: outcome.snapshot,
        isSender: outcome.isSender,
        accountWorkspaceId,
      });
    case 'not-found':
      return json(404, { error: 'SHARE_NOT_FOUND' });
    case 'unauthenticated':
      return accountAuthorizationFailureResponse('unauthenticated');
    case 'unavailable':
      return json(503, { error: 'SHARE_UNAVAILABLE' });
  }
}

function createResponse(
  outcome: ShareCreateOutcome,
  accountWorkspaceId: AccountWorkspaceId,
): Response {
  switch (outcome.status) {
    case 'created':
      return json(200, {
        token: outcome.token,
        sourceRevision: outcome.sourceRevision,
        accountWorkspaceId,
      });
    case 'revision-conflict':
      return json(409, { error: 'REVISION_CONFLICT', currentRevision: outcome.currentRevision });
    case 'not-shareable':
      return json(404, { error: 'SHARE_NOT_AVAILABLE' });
    case 'unauthenticated':
      return accountAuthorizationFailureResponse('unauthenticated');
    case 'unavailable':
      return json(503, { error: 'SHARE_UNAVAILABLE' });
  }
}

async function getPersistence(
  persistence: SharesDependencies['persistence'],
): Promise<ManagedSharesPersistence> {
  return typeof persistence === 'function' ? persistence() : persistence;
}

/** Authentication happens before an untrusted POST body is acquired. */
export function createShares(dependencies: SharesDependencies): Shares {
  return {
    async handle(request: Request): Promise<Response> {
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        return json(400, { error: 'INVALID_SHARE_REQUEST' });
      }
      const createPath = url.pathname === '/api/shares';
      const recipientPath = /^\/api\/shares\/[^/]+\/recipient$/u.test(url.pathname);
      const publicSharePath = /^\/api\/shares\/[^/]+$/u.test(url.pathname);
      if (!createPath && !recipientPath && !publicSharePath)
        return request.method === 'HEAD'
          ? new Response(null, { status: 404, headers: { 'cache-control': 'private, no-store' } })
          : json(404, { error: 'NOT_FOUND' });

      const allow = createPath ? 'POST' : 'GET';
      if (request.method !== allow) {
        const headers = { allow, 'cache-control': 'private, no-store' };
        return request.method === 'HEAD'
          ? new Response(null, { status: 405, headers })
          : Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers });
      }
      if (url.search !== '') return json(400, { error: 'INVALID_SHARE_REQUEST' });

      if (request.method === 'GET') {
        const recipient = /^\/api\/shares\/([A-Za-z0-9_-]{43})\/recipient$/u.exec(url.pathname);
        if (recipient?.[1] !== undefined) {
          const authorized = await dependencies.authorization.authorizeRead(request);
          if (authorized.status !== 'authorized')
            return accountAuthorizationFailureResponse(authorized.status);
          if (!isAccountWorkspaceId(authorized.proof.accountId))
            return accountAuthorizationFailureResponse('unavailable');
          try {
            const persistence = await getPersistence(dependencies.persistence);
            const outcome = await persistence.readForRecipient(authorized.proof, recipient[1]);
            return recipientResponse(outcome, authorized.proof.accountId);
          } catch {
            return json(503, { error: 'SHARE_UNAVAILABLE' });
          }
        }

        const publicShare = /^\/api\/shares\/([A-Za-z0-9_-]{43})$/u.exec(url.pathname);
        if (publicShare?.[1] !== undefined) {
          try {
            const persistence = await getPersistence(dependencies.persistence);
            return shareResponse(await persistence.read(publicShare[1]));
          } catch {
            return json(503, { error: 'SHARE_UNAVAILABLE' });
          }
        }
        return json(404, { error: 'NOT_FOUND' });
      }
      if (request.method !== 'POST') return json(404, { error: 'NOT_FOUND' });

      const headerError = checkDashboardRequestHeaders(request);
      if (headerError !== null) {
        const error = new DashboardRequestError(headerError);
        return json(error.status, { error: error.code });
      }
      const authorized = await dependencies.authorization.authorizeWrite(request);
      if (authorized.status !== 'authorized')
        return accountAuthorizationFailureResponse(authorized.status);
      if (!isAccountWorkspaceId(authorized.proof.accountId))
        return accountAuthorizationFailureResponse('unavailable');

      let body: unknown;
      try {
        body = await readDashboardRequestBody(request);
      } catch (error) {
        return error instanceof DashboardRequestError
          ? json(error.status, { error: error.code })
          : json(400, { error: 'INVALID_SHARE_REQUEST' });
      }
      const parsed = parseCreateRequest(body);
      if (parsed === null) return json(400, { error: 'INVALID_SHARE_REQUEST' });
      if (parsed.expectedAccountWorkspaceId !== authorized.proof.accountId)
        return json(403, { error: 'ACCOUNT_WORKSPACE_MISMATCH' });
      try {
        const persistence = await getPersistence(dependencies.persistence);
        const outcome = await persistence.create(
          authorized.proof,
          parsed.expectedRevision,
          parsed.entryId,
        );
        return createResponse(outcome, authorized.proof.accountId);
      } catch {
        return json(503, { error: 'SHARE_UNAVAILABLE' });
      }
    },
  };
}
