/**
 * Protected guest-adoption HTTP orchestration.
 *
 * The handler owns the request boundary and public error mapping. Account and
 * dashboard state are committed by the injected persistence adapter, which is
 * also responsible for serializing capability consumption and terminal replay.
 */
import {
  PersistenceError,
  type AdoptionDecisionOutcome,
  type KendoPersistence,
} from '../persistence/contracts.js';
import type { AuthenticationPersistenceProvider } from '../auth/contracts.js';
import {
  sessionAuthorizationFailureResponse,
  type SessionAuthorization,
} from '../auth/session-authorization.js';
import {
  DashboardRequestError,
  checkDashboardRequestHeaders,
  readDashboardRequestBody,
} from '../dashboard/request-body.js';
import {
  createDashboardCatalogue,
  isAccountWorkspaceId,
  isNonZeroRevision,
  isRequestId,
  isRevision,
  validateDashboardAcknowledgement,
  type DashboardCatalogue,
} from '../dashboard/validation.js';
import type {
  AdoptionCompletion,
  AdoptionCompletionAccepted,
  AdoptionResponse,
  ValidatedAdoptionRequest,
} from './contracts.js';
import { validateAdoptionCompletion, validateAdoptionRequest } from './contracts.js';

const CACHE_CONTROL = 'private, no-store';

export interface AdoptionDependencies {
  readonly authorization: SessionAuthorization;
  readonly persistence: AuthenticationPersistenceProvider;
  readonly catalogue?: DashboardCatalogue;
}

export interface Adoption {
  handle(request: Request): Promise<Response>;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': CACHE_CONTROL },
  });
}

function methodNotAllowed(method: string): Response {
  const headers = { allow: 'POST', 'cache-control': CACHE_CONTROL };
  return method === 'HEAD'
    ? new Response(null, { status: 405, headers })
    : Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers });
}

function readOwn(value: object, property: string): unknown {
  try {
    return Object.getOwnPropertyDescriptor(value, property)?.value;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function invalidValidationResponse(error: string): Response {
  const status =
    error === 'INVALID_ADOPTION_REQUEST' ? 400 : error === 'ACCOUNT_WORKSPACE_MISMATCH' ? 403 : 422;
  return json(status, { error });
}

function adoptionPersistenceFailure(outcome: string): Response {
  switch (outcome) {
    case 'unauthenticated':
      return sessionAuthorizationFailureResponse('UNAUTHENTICATED');
    case 'auth-unavailable':
      return sessionAuthorizationFailureResponse('AUTH_UNAVAILABLE');
    case 'workspace-mismatch':
      return json(403, { error: 'ACCOUNT_WORKSPACE_MISMATCH' });
    case 'revision-conflict':
      // The caller validates the revision before using this branch.
      return json(409, { error: 'REVISION_CONFLICT' });
    case 'request-id-reused':
      return json(409, { error: 'REQUEST_ID_REUSED' });
    case 'decision-conflict':
      return json(409, { error: 'DECISION_CONFLICT' });
    case 'catalogue-incompatible':
      return json(422, { error: 'CATALOGUE_INCOMPATIBLE' });
    case 'ineligible':
    case 'capability-unavailable':
      return json(409, { error: 'ADOPTION_UNAVAILABLE' });
    case 'unavailable':
    default:
      return json(503, { error: 'ADOPTION_UNAVAILABLE' });
  }
}

function completionFromAcknowledgement(
  requestId: unknown,
  acknowledgement: unknown,
): AdoptionCompletionAccepted | null {
  if (!isRequestId(requestId) || !isRecord(acknowledgement)) return null;
  const revision = readOwn(acknowledgement, 'revision');
  const timestamp = readOwn(acknowledgement, 'updatedAt');
  if (!isNonZeroRevision(revision) || typeof timestamp !== 'string') return null;
  const completion = validateAdoptionCompletion({
    decision: 'yes',
    requestId,
    acknowledgedRevision: revision,
    timestamp,
  });
  return completion?.decision === 'yes' ? completion : null;
}

function publicCompletion(value: unknown): AdoptionCompletion | null {
  if (!isRecord(value)) return null;
  const decision = readOwn(value, 'decision');
  const requestId = readOwn(value, 'requestId');
  if (decision === 'no') {
    if (!hasExactKeys(value, ['decision', 'requestId'])) return null;
    return validateAdoptionCompletion({ decision, requestId });
  }
  if (decision !== 'yes') return null;
  if (!hasExactKeys(value, ['decision', 'requestId', 'acknowledgedRevision', 'timestamp'])) {
    return null;
  }
  const acknowledgedRevision = readOwn(value, 'acknowledgedRevision');
  const timestampValue = readOwn(value, 'timestamp');
  let timestamp: string;
  if (timestampValue instanceof Date) {
    try {
      timestamp = Date.prototype.toISOString.call(timestampValue);
    } catch {
      return null;
    }
  } else {
    return null;
  }
  return validateAdoptionCompletion({
    decision,
    requestId,
    acknowledgedRevision,
    timestamp,
  });
}

function acceptedResponse(
  intent: ValidatedAdoptionRequest,
  outcome: Extract<AdoptionDecisionOutcome, { status: 'accepted' | 'replayed' }>,
): Response {
  if (intent.request.decision !== 'yes' || intent.dashboardIntent === undefined) {
    return json(503, { error: 'ADOPTION_UNAVAILABLE' });
  }

  const acknowledgement = validateDashboardAcknowledgement(
    outcome.acknowledgement,
    intent.dashboardIntent,
  );
  if (acknowledgement === null || !isAccountWorkspaceId(acknowledgement.accountWorkspaceId)) {
    return json(503, { error: 'ADOPTION_UNAVAILABLE' });
  }

  const rawCompletion = isRecord(outcome) ? readOwn(outcome, 'completion') : undefined;
  const completion =
    rawCompletion === undefined && outcome.status === 'replayed'
      ? completionFromAcknowledgement(intent.request.requestId, acknowledgement)
      : rawCompletion === undefined
        ? null
        : publicCompletion(rawCompletion);
  if (
    completion === null ||
    completion.decision !== 'yes' ||
    completion.requestId !== intent.request.requestId ||
    completion.acknowledgedRevision !== acknowledgement.revision ||
    completion.timestamp !== acknowledgement.updatedAt
  ) {
    return json(503, { error: 'ADOPTION_UNAVAILABLE' });
  }

  const response: AdoptionResponse = {
    status: outcome.status,
    completion,
    acknowledgement,
  };
  return json(200, response);
}

function declinedResponse(
  intent: ValidatedAdoptionRequest,
  outcome: Extract<AdoptionDecisionOutcome, { status: 'declined' | 'replayed-declined' }>,
): Response {
  if (intent.request.decision !== 'no') {
    return json(503, { error: 'ADOPTION_UNAVAILABLE' });
  }
  const rawCompletion = readOwn(outcome, 'completion');
  const completion = publicCompletion(rawCompletion);
  if (
    completion === null ||
    completion.decision !== 'no' ||
    completion.requestId !== intent.request.requestId
  ) {
    return json(503, { error: 'ADOPTION_UNAVAILABLE' });
  }
  const response: AdoptionResponse = {
    status: outcome.status === 'declined' ? 'declined' : 'replayed',
    completion,
  };
  return json(200, response);
}

function responseForOutcome(
  intent: ValidatedAdoptionRequest,
  outcome: AdoptionDecisionOutcome,
): Response {
  switch (outcome.status) {
    case 'accepted':
    case 'replayed':
      return acceptedResponse(intent, outcome);
    case 'declined':
    case 'replayed-declined':
      return declinedResponse(intent, outcome);
    case 'revision-conflict':
      return isRevision(outcome.currentRevision)
        ? json(409, {
            error: 'REVISION_CONFLICT',
            currentRevision: outcome.currentRevision,
          })
        : json(503, { error: 'ADOPTION_UNAVAILABLE' });
    case 'request-id-reused':
    case 'decision-conflict':
    case 'catalogue-incompatible':
    case 'ineligible':
    case 'capability-unavailable':
    case 'workspace-mismatch':
    case 'unauthenticated':
    case 'auth-unavailable':
    case 'unavailable':
      return adoptionPersistenceFailure(outcome.status);
    default:
      return json(503, { error: 'ADOPTION_UNAVAILABLE' });
  }
}

/** Create the transport-neutral adoption route handler. */
export function createAdoption(dependencies: AdoptionDependencies): Adoption {
  const catalogue = dependencies.catalogue ?? createDashboardCatalogue();

  return {
    async handle(request: Request): Promise<Response> {
      // Unsupported methods are handled before URL, header, authentication, or
      // body access. This matters for streamed bodies and HEAD responses.
      if (request.method !== 'POST') return methodNotAllowed(request.method);

      try {
        if (new URL(request.url).search !== '') {
          return json(400, { error: 'INVALID_ADOPTION_REQUEST' });
        }
      } catch {
        return json(400, { error: 'INVALID_ADOPTION_REQUEST' });
      }

      const headerError = checkDashboardRequestHeaders(request);
      if (headerError !== null) {
        const error = new DashboardRequestError(headerError);
        return json(error.status, { error: error.code });
      }

      let authorized;
      try {
        authorized = await dependencies.authorization.authorizeWrite(request);
      } catch {
        return sessionAuthorizationFailureResponse('AUTH_UNAVAILABLE');
      }
      if (authorized.status === 'rejected') return authorized.response;
      const proof = authorized.proof;
      if (!isAccountWorkspaceId(proof.userId)) {
        return sessionAuthorizationFailureResponse('AUTH_UNAVAILABLE');
      }
      if (proof.csrfTokenHash === undefined) {
        return sessionAuthorizationFailureResponse('AUTH_UNAVAILABLE');
      }

      let value: unknown;
      try {
        value = await readDashboardRequestBody(request);
      } catch (error) {
        return error instanceof DashboardRequestError
          ? json(error.status, { error: error.code })
          : json(400, { error: 'INVALID_ADOPTION_REQUEST' });
      }

      const validation = validateAdoptionRequest(value, proof.userId);
      if (validation.status === 'invalid') {
        return invalidValidationResponse(validation.error);
      }
      const intent = validation.intent;

      let persistence: KendoPersistence;
      try {
        persistence =
          typeof dependencies.persistence === 'function'
            ? await dependencies.persistence()
            : dependencies.persistence;
        if (typeof persistence !== 'object' || persistence === null) {
          throw new PersistenceError('UNAVAILABLE');
        }
      } catch {
        return json(503, { error: 'ADOPTION_UNAVAILABLE' });
      }

      const proofInput = {
        userId: proof.userId,
        sessionId: proof.sessionId,
        sessionTokenHash: proof.sessionTokenHash,
        csrfTokenHash: proof.csrfTokenHash,
      };
      try {
        const outcome =
          intent.request.decision === 'yes'
            ? intent.dashboardIntent === undefined
              ? undefined
              : await persistence.adoptions.decide(
                  {
                    ...proofInput,
                    decision: 'yes',
                    expectedAccountWorkspaceId: proof.userId,
                    intent: intent.dashboardIntent,
                  },
                  (candidate) => catalogue.isCompatible(candidate),
                )
            : await persistence.adoptions.decide({
                ...proofInput,
                decision: 'no',
                expectedAccountWorkspaceId: proof.userId,
                requestId: intent.request.requestId,
                requestDigest: intent.requestDigest,
              });
        if (outcome === undefined) return json(503, { error: 'ADOPTION_UNAVAILABLE' });
        return responseForOutcome(intent, outcome);
      } catch {
        return json(503, { error: 'ADOPTION_UNAVAILABLE' });
      }
    },
  };
}
