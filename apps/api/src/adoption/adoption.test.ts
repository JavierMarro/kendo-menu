import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME, type Authentication } from '../auth/contracts.js';
import { createSessionAuthorization } from '../auth/session-authorization.js';
import { sha256 } from '../auth/security.js';
import type { KendoPersistence, SessionLookupInput } from '../persistence/contracts.js';
import { MAX_DASHBOARD_REQUEST_BYTES } from '../dashboard/contracts.js';
import {
  createDashboardCatalogue,
  validateDashboardAcknowledgement,
  type ValidatedDashboardWrite,
} from '../dashboard/validation.js';
import { createAdoption } from './adoption.js';

const ORIGIN = 'https://app.example.test';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-000000000002';
const REQUEST_ID = '00000000-0000-4000-8000-000000000003';
const TOKEN = Buffer.alloc(32, 1).toString('base64url');
const CSRF = Buffer.alloc(32, 2).toString('base64url');
const OTHER = Buffer.alloc(32, 3).toString('base64url');
const NOW = new Date('2026-09-12T05:00:00.000Z');
const catalogue = createDashboardCatalogue();

function yesPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decision: 'yes',
    transportVersion: 1,
    expectedAccountWorkspaceId: USER_ID,
    expectedRevision: '0',
    requestId: REQUEST_ID,
    catalogueVersion: catalogue.version,
    dashboard: { version: 10, state: { dashboardEntries: [] } },
    ...overrides,
  };
}

function noPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decision: 'no',
    transportVersion: 1,
    expectedAccountWorkspaceId: USER_ID,
    requestId: REQUEST_ID,
    ...overrides,
  };
}

function headers(patch: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: `${SESSION_COOKIE_NAME}=${TOKEN}; ${CSRF_COOKIE_NAME}=${CSRF}`,
    origin: ORIGIN,
    'x-csrf-token': CSRF,
    'content-type': 'application/json',
    ...patch,
  };
}

function request(
  method: string,
  body: string | undefined = JSON.stringify(yesPayload()),
  patch: Record<string, string> = {},
): Request {
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers: headers(patch),
  };
  if (body !== undefined) init.body = body;
  return new Request(`${ORIGIN}/api/dashboard/adoption`, init);
}

function withoutProperty(
  value: Record<string, unknown>,
  property: string,
): Record<string, unknown> {
  const copy = { ...value };
  delete copy[property];
  return copy;
}

function bodyMustNotBeRead(value: Request): Request {
  Object.defineProperty(value, 'body', {
    configurable: true,
    get() {
      throw new Error('BODY_ACCESSED');
    },
  });
  return value;
}

function activeSession() {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    createdAt: NOW,
    lastActivityAt: NOW,
    idleExpiresAt: new Date(NOW.getTime() + 86_400_000),
    absoluteExpiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
    revokedAt: null,
  };
}

function acknowledgement(intent: ValidatedDashboardWrite) {
  const value = validateDashboardAcknowledgement(
    {
      transportVersion: 1,
      accountWorkspaceId: USER_ID,
      requestId: REQUEST_ID,
      revision: '1',
      updatedAt: NOW.toISOString(),
    },
    intent,
  );
  if (value === null) throw new Error('BAD_ACKNOWLEDGEMENT_FIXTURE');
  return value;
}

function harness() {
  const lookup = vi.fn((input: SessionLookupInput) =>
    Promise.resolve(
      input.sessionTokenHash === sha256(TOKEN) &&
        (input.csrfTokenHash === undefined || input.csrfTokenHash === sha256(CSRF))
        ? activeSession()
        : null,
    ),
  );
  const unexpected = vi.fn((): Promise<never> =>
    Promise.reject(new Error('UNEXPECTED_PERSISTENCE_OPERATION')),
  );
  const decide = vi.fn<KendoPersistence['adoptions']['decide']>();
  const persistence: KendoPersistence = {
    accounts: { completeGoogleLogin: unexpected },
    users: { findPublicById: unexpected, resolveByGoogleSubject: unexpected },
    loginTransactions: { create: unexpected, consume: unexpected, cleanupExpired: unexpected },
    sessions: {
      create: unexpected,
      replace: unexpected,
      findActiveByTokenHash: lookup,
      touch: unexpected,
      revoke: unexpected,
    },
    adoptions: {
      getStatus: unexpected,
      decide,
    },
  };
  const authorization = createSessionAuthorization({
    persistence,
    getAppOrigin: () => ORIGIN,
    clock: () => NOW,
  });
  const adoption = createAdoption({ authorization, persistence, catalogue });
  return { adoption, decide, lookup, unexpected };
}

async function expectError(response: Response, status: number, error: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  await expect(response.json()).resolves.toEqual({ error });
}

describe('adoption HTTP boundary', () => {
  it('authenticates before reading a valid Yes body and returns only the public completion', async () => {
    const h = harness();
    h.decide.mockImplementationOnce((input) => {
      if (input.decision !== 'yes') return Promise.reject(new Error('WRONG_DECISION'));
      const ack = acknowledgement(input.intent);
      return Promise.resolve({
        status: 'accepted',
        completion: {
          decision: 'yes',
          requestId: REQUEST_ID,
          acknowledgedRevision: ack.revision,
          timestamp: new Date(ack.updatedAt),
        },
        acknowledgement: ack,
      });
    });

    const response = await h.adoption.handle(request('POST'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'accepted',
      completion: {
        decision: 'yes',
        requestId: REQUEST_ID,
        acknowledgedRevision: '1',
        timestamp: NOW.toISOString(),
      },
      acknowledgement: {
        transportVersion: 1,
        accountWorkspaceId: USER_ID,
        requestId: REQUEST_ID,
        revision: '1',
        updatedAt: NOW.toISOString(),
      },
    });
    expect(h.decide).toHaveBeenCalledOnce();
    expect(h.decide.mock.calls[0]?.[0]).toMatchObject({
      decision: 'yes',
      expectedAccountWorkspaceId: USER_ID,
      userId: USER_ID,
      sessionId: SESSION_ID,
      csrfTokenHash: sha256(CSRF),
    });
  });

  it('records and returns a declined decision without a dashboard representation', async () => {
    const h = harness();
    h.decide.mockResolvedValueOnce({
      status: 'declined',
      completion: { decision: 'no', requestId: REQUEST_ID },
    });
    const response = await h.adoption.handle(request('POST', JSON.stringify(noPayload())));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'declined',
      completion: { decision: 'no', requestId: REQUEST_ID },
    });
    expect(h.decide.mock.calls[0]?.[0]).toMatchObject({
      decision: 'no',
      expectedAccountWorkspaceId: USER_ID,
      requestId: REQUEST_ID,
    });
    expect(h.decide.mock.calls[0]?.[0]).not.toHaveProperty('intent');
  });

  it.each([
    [
      'unknown discriminant',
      { ...yesPayload(), decision: 'maybe' },
      400,
      'INVALID_ADOPTION_REQUEST',
    ],
    [
      'No with a dashboard field',
      { ...noPayload(), dashboard: { version: 10, state: { dashboardEntries: [] } } },
      400,
      'INVALID_ADOPTION_REQUEST',
    ],
    [
      'No with an expected revision field',
      { ...noPayload(), expectedRevision: '0' },
      400,
      'INVALID_ADOPTION_REQUEST',
    ],
    [
      'Yes without a dashboard field',
      withoutProperty(yesPayload(), 'dashboard'),
      400,
      'INVALID_ADOPTION_REQUEST',
    ],
    [
      'Yes with an unknown field',
      { ...yesPayload(), extra: true },
      400,
      'INVALID_ADOPTION_REQUEST',
    ],
    [
      'Yes with a non-zero revision',
      { ...yesPayload(), expectedRevision: '1' },
      422,
      'ADOPTION_REVISION_REQUIRED',
    ],
    [
      'invalid account identifier',
      { ...yesPayload(), expectedAccountWorkspaceId: 'not-a-uuid' },
      400,
      'INVALID_ADOPTION_REQUEST',
    ],
    [
      'invalid request identifier',
      { ...yesPayload(), requestId: 'not-a-v4-uuid' },
      400,
      'INVALID_ADOPTION_REQUEST',
    ],
    [
      'invalid catalogue digest',
      { ...yesPayload(), catalogueVersion: 'not-a-digest' },
      400,
      'INVALID_ADOPTION_REQUEST',
    ],
    [
      'unsupported transport version',
      { ...yesPayload(), transportVersion: 2 },
      422,
      'UNSUPPORTED_TRANSPORT_VERSION',
    ],
    [
      'unsupported dashboard version',
      { ...yesPayload(), dashboard: { version: 9, state: { dashboardEntries: [] } } },
      422,
      'UNSUPPORTED_DASHBOARD_VERSION',
    ],
  ] as const)('rejects strict envelope violations: %s', async (_name, value, status, error) => {
    const h = harness();
    await expectError(
      await h.adoption.handle(request('POST', JSON.stringify(value))),
      status,
      error,
    );
    expect(h.decide).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', JSON.stringify(noPayload()).slice(0, -1), 'INVALID_DASHBOARD_REQUEST'],
    [
      'duplicate JSON key',
      JSON.stringify(noPayload()).replace('"decision":"no"', '"decision":"no","decision":"no"'),
      'INVALID_DASHBOARD_REQUEST',
    ],
    ['top-level array', '[]', 'INVALID_ADOPTION_REQUEST'],
  ] as const)('rejects %s before persistence', async (_name, body, error) => {
    const h = harness();
    await expectError(await h.adoption.handle(request('POST', body)), 400, error);
    expect(h.decide).not.toHaveBeenCalled();
  });

  it.each([
    'application/json; charset=latin1',
    'application/json; charset=utf-8; profile=extra',
    'application/json; profile=extra',
    '',
  ])('rejects malformed JSON content type %s before auth', async (contentType) => {
    const h = harness();
    await expectError(
      await h.adoption.handle(
        request('POST', JSON.stringify(noPayload()), { 'content-type': contentType }),
      ),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
    expect(h.lookup).not.toHaveBeenCalled();
    expect(h.decide).not.toHaveBeenCalled();
  });

  it('returns the original terminal completion for a replay and maps conflicts safely', async () => {
    const h = harness();
    h.decide.mockImplementationOnce((input) => {
      if (input.decision !== 'yes') return Promise.reject(new Error('WRONG_DECISION'));
      const ack = acknowledgement(input.intent);
      return Promise.resolve({
        status: 'replayed',
        completion: {
          decision: 'yes',
          requestId: REQUEST_ID,
          acknowledgedRevision: ack.revision,
          timestamp: new Date(ack.updatedAt),
        },
        acknowledgement: ack,
      });
    });
    await expect(h.adoption.handle(request('POST'))).resolves.toHaveProperty('status', 200);

    h.decide.mockResolvedValueOnce({ status: 'decision-conflict' });
    await expectError(await h.adoption.handle(request('POST')), 409, 'DECISION_CONFLICT');
    h.decide.mockResolvedValueOnce({ status: 'request-id-reused' });
    await expectError(await h.adoption.handle(request('POST')), 409, 'REQUEST_ID_REUSED');
  });

  it('returns a replayed declined completion without exposing storage details', async () => {
    const h = harness();
    h.decide.mockResolvedValueOnce({
      status: 'replayed-declined',
      completion: { decision: 'no', requestId: REQUEST_ID },
    });
    const response = await h.adoption.handle(request('POST', JSON.stringify(noPayload())));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'replayed',
      completion: { decision: 'no', requestId: REQUEST_ID },
    });
  });

  it.each([
    ['catalogue-incompatible', 422, 'CATALOGUE_INCOMPATIBLE'],
    ['ineligible', 409, 'ADOPTION_UNAVAILABLE'],
    ['capability-unavailable', 409, 'ADOPTION_UNAVAILABLE'],
    ['workspace-mismatch', 403, 'ACCOUNT_WORKSPACE_MISMATCH'],
    ['unauthenticated', 401, 'UNAUTHENTICATED'],
    ['auth-unavailable', 503, 'AUTH_UNAVAILABLE'],
    ['unavailable', 503, 'ADOPTION_UNAVAILABLE'],
  ] as const)('maps terminal outcome %s', async (status, httpStatus, error) => {
    const h = harness();
    h.decide.mockResolvedValueOnce({ status });
    const response = await h.adoption.handle(request('POST'));
    await expectError(response, httpStatus, error);
    if (status === 'unauthenticated') {
      expect(response.headers.getSetCookie()).toHaveLength(2);
    } else {
      expect(response.headers.getSetCookie()).toHaveLength(0);
    }
  });

  it('maps a valid revision conflict without coercing the revision', async () => {
    const h = harness();
    h.decide.mockImplementationOnce((input) => {
      if (input.decision !== 'yes') return Promise.reject(new Error('WRONG_DECISION'));
      return Promise.resolve({
        status: 'revision-conflict',
        currentRevision: acknowledgement(input.intent).revision,
      });
    });
    const response = await h.adoption.handle(request('POST'));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'REVISION_CONFLICT',
      currentRevision: '1',
    });
  });

  it.each(['identity', 'timestamp'] as const)(
    'fails closed when the persistence acknowledgement has a malformed %s',
    async (field) => {
      const h = harness();
      h.decide.mockImplementationOnce((input) => {
        if (input.decision !== 'yes') return Promise.reject(new Error('WRONG_DECISION'));
        const ack = acknowledgement(input.intent);
        const malformed =
          field === 'identity'
            ? Object.assign({}, ack, { accountWorkspaceId: REQUEST_ID })
            : Object.assign({}, ack, { updatedAt: 'not-a-timestamp' });
        return Promise.resolve({
          status: 'accepted',
          completion: {
            decision: 'yes' as const,
            requestId: REQUEST_ID,
            acknowledgedRevision: ack.revision,
            timestamp: new Date(ack.updatedAt),
          },
          acknowledgement: malformed,
        });
      });
      await expectError(await h.adoption.handle(request('POST')), 503, 'ADOPTION_UNAVAILABLE');
    },
  );

  it('does not acquire unsupported method bodies or authenticate them', async () => {
    const h = harness();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(new TextEncoder().encode('not json'));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const streamedInit: RequestInit & { duplex: 'half' } = {
      method: 'PATCH',
      headers: headers(),
      body: stream,
      duplex: 'half',
    };
    const streamed = new Request(`${ORIGIN}/api/dashboard/adoption`, streamedInit);
    const response = await h.adoption.handle(streamed);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    await expect(response.json()).resolves.toEqual({ error: 'METHOD_NOT_ALLOWED' });
    expect(streamed.bodyUsed).toBe(false);
    expect(pulls).toBe(0);
    expect(h.lookup).not.toHaveBeenCalled();
  });

  it('returns an empty HEAD response with the POST allow-list', async () => {
    const h = harness();
    const response = await h.adoption.handle(
      new Request(`${ORIGIN}/api/dashboard/adoption`, { method: 'HEAD' }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    await expect(response.text()).resolves.toBe('');
    expect(h.lookup).not.toHaveBeenCalled();
  });

  it('rejects query parameters, headers, and CSRF before reading a stream body', async () => {
    for (const [patch, status, code] of [
      [{ 'content-type': 'text/plain' }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
      [{ 'content-encoding': 'gzip' }, 415, 'UNSUPPORTED_CONTENT_ENCODING'],
      [{ 'x-csrf-token': '' }, 403, 'FORBIDDEN'],
    ] as const) {
      const h = harness();
      let pulls = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls += 1;
            controller.enqueue(new TextEncoder().encode('not json'));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      const original = request('POST', undefined, patch);
      const streamedInit: RequestInit & { duplex: 'half' } = {
        body: stream,
        duplex: 'half',
      };
      const streamed = new Request(original, streamedInit);
      await expectError(await h.adoption.handle(streamed), status, code);
      expect(pulls).toBe(0);
      if (code !== 'FORBIDDEN') expect(h.lookup).not.toHaveBeenCalled();
    }

    const h = harness();
    let queryPulls = 0;
    const queryStream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          queryPulls += 1;
          controller.enqueue(new TextEncoder().encode('not json'));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const queryInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: headers(),
      body: queryStream,
      duplex: 'half',
    };
    const queryRequest = new Request(`${ORIGIN}/api/dashboard/adoption?probe=1`, queryInit);
    await expectError(await h.adoption.handle(queryRequest), 400, 'INVALID_ADOPTION_REQUEST');
    expect(queryPulls).toBe(0);
    expect(h.lookup).not.toHaveBeenCalled();
  });

  it.each([
    ['missing session cookie', { cookie: '' }, 401, 'UNAUTHENTICATED'],
    [
      'forged session cookie',
      { cookie: `${SESSION_COOKIE_NAME}=${OTHER}; ${CSRF_COOKIE_NAME}=${CSRF}` },
      401,
      'UNAUTHENTICATED',
    ],
    ['wrong Origin', { origin: 'https://other.example.test' }, 403, 'FORBIDDEN'],
    ['wrong CSRF proof', { 'x-csrf-token': OTHER }, 403, 'FORBIDDEN'],
  ] as const)('rejects %s without acquiring the body', async (_name, patch, status, error) => {
    const h = harness();
    const guarded = bodyMustNotBeRead(request('POST', JSON.stringify(yesPayload()), patch));
    await expectError(await h.adoption.handle(guarded), status, error);
    expect(h.decide).not.toHaveBeenCalled();
  });

  it('enforces the UTF-8 byte boundary after authentication', async () => {
    const h = harness();
    h.decide.mockImplementation((input) => {
      if (input.decision !== 'yes') return Promise.reject(new Error('WRONG_DECISION'));
      const ack = acknowledgement(input.intent);
      return Promise.resolve({
        status: 'accepted',
        completion: {
          decision: 'yes',
          requestId: REQUEST_ID,
          acknowledgedRevision: ack.revision,
          timestamp: new Date(ack.updatedAt),
        },
        acknowledgement: ack,
      });
    });
    const unicodePayload = yesPayload({
      dashboard: {
        version: 10,
        state: {
          dashboardEntries: [
            {
              id: 'entry-😀',
              trainingSetId: 'catalogue-set',
              quantityOverrides: {},
              activityNotes: {},
              notes: '😀',
              createdAt: NOW.toISOString(),
            },
          ],
        },
      },
    });
    const serialized = JSON.stringify(unicodePayload);
    const serializedBytes = Buffer.byteLength(serialized, 'utf8');
    expect(serializedBytes).toBeGreaterThan(serialized.length);
    const padding = ' '.repeat(MAX_DASHBOARD_REQUEST_BYTES - serializedBytes);
    expect((await h.adoption.handle(request('POST', serialized + padding))).status).toBe(200);
    expect(h.decide).toHaveBeenCalledOnce();
    const over = await h.adoption.handle(request('POST', serialized + padding + ' '));
    await expectError(over, 413, 'REQUEST_TOO_LARGE');
    expect(h.decide).toHaveBeenCalledOnce();
  });

  it('fails closed when the persistence result contains private or malformed completion data', async () => {
    const h = harness();
    h.decide.mockImplementationOnce((input) => {
      if (input.decision !== 'yes') return Promise.reject(new Error('WRONG_DECISION'));
      const ack = acknowledgement(input.intent);
      const completion = Object.assign(
        {
          decision: 'yes' as const,
          requestId: REQUEST_ID,
          acknowledgedRevision: ack.revision,
          timestamp: new Date(ack.updatedAt),
        },
        { requestDigest: 'private' },
      );
      return Promise.resolve({ status: 'accepted', completion, acknowledgement: ack });
    });
    await expectError(await h.adoption.handle(request('POST')), 503, 'ADOPTION_UNAVAILABLE');
  });

  it('registers POST and preserves the route boundary through Elysia', async () => {
    const h = harness();
    h.decide.mockResolvedValueOnce({
      status: 'declined',
      completion: { decision: 'no', requestId: REQUEST_ID },
    });
    const unexpectedAuthentication: Authentication = {
      start: () => Promise.reject(new Error('UNEXPECTED_AUTH')),
      callback: () => Promise.reject(new Error('UNEXPECTED_AUTH')),
      getSession: () => Promise.reject(new Error('UNEXPECTED_AUTH')),
      logout: () => Promise.reject(new Error('UNEXPECTED_AUTH')),
    };
    const unexpectedDashboard = { handle: () => Promise.reject(new Error('UNEXPECTED_DASHBOARD')) };
    const observedBodyUsed: boolean[] = [];
    const routedAdoption = {
      handle: (incoming: Request) => {
        observedBodyUsed.push(incoming.bodyUsed);
        return h.adoption.handle(incoming);
      },
    };
    const app = createApp({
      authentication: unexpectedAuthentication,
      dashboard: unexpectedDashboard,
      adoption: routedAdoption,
    });
    const response = await app.handle(request('POST', JSON.stringify(noPayload())));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'declined',
      completion: { decision: 'no', requestId: REQUEST_ID },
    });
    expect(observedBodyUsed).toEqual([false]);
  });
});
