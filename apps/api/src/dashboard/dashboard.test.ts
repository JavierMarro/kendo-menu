import { describe, expect, it, vi } from 'vitest';

import { createSessionAuthorization } from '../auth/session-authorization.js';
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from '../auth/contracts.js';
import type { KendoPersistence, SessionLookupInput } from '../persistence/contracts.js';
import type {
  DashboardPersistence,
  DashboardReadOutcome,
  DashboardWriteOutcome,
} from '../persistence/dashboard-contracts.js';
import { sha256 } from '../auth/security.js';
import { createDashboard, type DashboardLogEntry } from './dashboard.js';
import { MAX_DASHBOARD_REQUEST_BYTES } from './contracts.js';
import {
  createDashboardCatalogue,
  isAccountWorkspaceId,
  isRevision,
  validateDashboardAcknowledgement,
  type ValidatedDashboardWrite,
} from './validation.js';

const ORIGIN = 'https://app.example.test';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const REQUEST_ID = '00000000-0000-4000-8000-000000000002';
const TOKEN = Buffer.alloc(32, 1).toString('base64url');
const CSRF = Buffer.alloc(32, 2).toString('base64url');
const NOW = new Date('2026-09-12T05:00:00.000Z');
const catalogue = createDashboardCatalogue();
function payload() {
  return {
    transportVersion: 1,
    expectedAccountWorkspaceId: USER_ID,
    expectedRevision: '0',
    requestId: REQUEST_ID,
    catalogueVersion: catalogue.version,
    dashboard: { version: 10, state: { dashboardEntries: [] } },
  };
}
function request(
  method = 'PUT',
  body = JSON.stringify(payload()),
  patch: Record<string, string> = {},
) {
  return new Request(`${ORIGIN}/api/dashboard`, {
    method,
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${TOKEN}; ${CSRF_COOKIE_NAME}=${CSRF}`,
      origin: ORIGIN,
      'x-csrf-token': CSRF,
      'content-type': 'application/json',
      ...patch,
    },
    ...(method === 'GET' || method === 'HEAD' ? {} : { body }),
  });
}
function harness() {
  const unexpected = vi.fn((): Promise<never> => Promise.reject(new Error('UNEXPECTED_MUTATION')));
  const lookup = vi.fn(async (input: SessionLookupInput) => {
    await Promise.resolve();
    return input.sessionTokenHash === sha256(TOKEN) &&
      (input.csrfTokenHash === undefined || input.csrfTokenHash === sha256(CSRF))
      ? {
          id: REQUEST_ID,
          userId: USER_ID,
          createdAt: NOW,
          lastActivityAt: NOW,
          idleExpiresAt: new Date(NOW.getTime() + 86_400_000),
          absoluteExpiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
          revokedAt: null,
        }
      : null;
  });
  const authPersistence: KendoPersistence = {
    users: { findPublicById: unexpected, resolveByGoogleSubject: unexpected },
    loginTransactions: { create: unexpected, consume: unexpected, cleanupExpired: unexpected },
    sessions: {
      create: unexpected,
      replace: unexpected,
      findActiveByTokenHash: lookup,
      touch: unexpected,
      revoke: unexpected,
    },
  };
  const authorization = createSessionAuthorization({
    persistence: authPersistence,
    getAppOrigin: () => ORIGIN,
    clock: () => NOW,
  });
  const read = vi.fn<DashboardPersistence['read']>(async (proof) => {
    await Promise.resolve();
    if (proof.userId !== USER_ID || !isAccountWorkspaceId(proof.userId))
      throw new Error('BAD_PROOF');
    return {
      status: 'read',
      response: {
        transportVersion: 1,
        accountWorkspaceId: proof.userId,
        catalogueVersion: catalogue.version,
        revision: '0',
        dashboard: null,
        updatedAt: null,
      },
    };
  });
  const write = vi.fn<DashboardPersistence['compareAndWrite']>(
    async (proof, intent, compatible) => {
      await Promise.resolve();
      if (proof.userId !== USER_ID || proof.csrfTokenHash !== sha256(CSRF))
        throw new Error('BAD_PROOF');
      if (!compatible(intent)) return { status: 'catalogue-incompatible' };
      return { status: 'written', acknowledgement: acknowledgement(intent) };
    },
  );
  const logs: DashboardLogEntry[] = [];
  const persistence = { read, compareAndWrite: write };
  const provider = vi.fn(() => persistence);
  const dashboard = createDashboard({
    authorization,
    persistence: provider,
    catalogue,
    diagnosticId: () => REQUEST_ID,
    logger: { log: (entry) => logs.push(entry) },
  });
  return { dashboard, authorization, read, write, lookup, unexpected, provider, logs };
}
function acknowledgement(intent: ValidatedDashboardWrite) {
  const result = validateDashboardAcknowledgement(
    {
      transportVersion: 1,
      accountWorkspaceId: USER_ID,
      requestId: intent.request.requestId,
      revision: String(BigInt(intent.request.expectedRevision) + 1n),
      updatedAt: NOW.toISOString(),
    },
    intent,
  );
  if (result === null) throw new Error('BAD_ACK_FIXTURE');
  return result;
}
async function expectError(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  await expect(response.json()).resolves.toEqual({ error });
}

describe('unregistered dashboard application', () => {
  it('reads an empty account without mutation and passes server-established identity', async () => {
    const h = harness();
    const response = await h.dashboard.handle(request('GET'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      transportVersion: 1,
      accountWorkspaceId: USER_ID,
      catalogueVersion: catalogue.version,
      revision: '0',
      dashboard: null,
      updatedAt: null,
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(h.read.mock.calls[0]?.[0]).toMatchObject({
      userId: USER_ID,
      sessionTokenHash: sha256(TOKEN),
    });
    expect(h.unexpected).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
  });
  it('sends validated intent and acknowledges saved-empty as a positive revision', async () => {
    const h = harness();
    const response = await h.dashboard.handle(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      transportVersion: 1,
      accountWorkspaceId: USER_ID,
      requestId: REQUEST_ID,
      revision: '1',
      updatedAt: NOW.toISOString(),
    });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(h.write.mock.calls[0]?.[1].canonicalDashboardJson).toBe(
      '{"state":{"dashboardEntries":[]},"version":10}',
    );
    expect(h.unexpected).not.toHaveBeenCalled();
  });
  it.each(['HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'])(
    'rejects %s before auth and returns Allow without cookies',
    async (method) => {
      const h = harness();
      const response = await h.dashboard.handle(request(method, 'INVALID JSON'));
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET, PUT');
      expect(response.headers.getSetCookie()).toEqual([]);
      if (method === 'HEAD') expect(await response.text()).toBe('');
      else expect(await response.json()).toEqual({ error: 'METHOD_NOT_ALLOWED' });
      expect(h.lookup).not.toHaveBeenCalled();
      expect(h.provider).not.toHaveBeenCalled();
    },
  );
  it.each(['GET', 'PUT'])('rejects query selectors before authorization on %s', async (method) => {
    const h = harness();
    await expectError(
      await h.dashboard.handle(
        new Request(`${ORIGIN}/api/dashboard?account=${USER_ID}`, { method }),
      ),
      400,
      'INVALID_DASHBOARD_REQUEST',
    );
    expect(h.lookup).not.toHaveBeenCalled();
  });
  it.each([
    [{ 'content-type': 'text/plain' }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
    [{ 'content-encoding': 'gzip' }, 415, 'UNSUPPORTED_CONTENT_ENCODING'],
    [{ 'content-length': String(MAX_DASHBOARD_REQUEST_BYTES + 1) }, 413, 'REQUEST_TOO_LARGE'],
    [{ cookie: '' }, 401, 'UNAUTHENTICATED'],
    [{ origin: 'https://other.example.test' }, 403, 'FORBIDDEN'],
    [{ 'x-csrf-token': '' }, 403, 'FORBIDDEN'],
  ] as const)('rejects before consuming body: %s', async (patch, status, code) => {
    const h = harness();
    let chunks = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          chunks += 1;
          controller.enqueue(new Uint8Array(MAX_DASHBOARD_REQUEST_BYTES + 1));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const original = request('PUT', '', patch);
    const init: RequestInit & { duplex: 'half' } = { body: stream, duplex: 'half' };
    const streamed = new Request(original, init);
    const response = await h.dashboard.handle(streamed);
    await expectError(response, status, code);
    expect(chunks).toBe(0);
    expect(h.provider).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toHaveLength(status === 401 ? 2 : 0);
  });
  it.each([
    ['not json', 400, 'INVALID_DASHBOARD_REQUEST'],
    ['{"transportVersion":1,"transportVersion":1}', 400, 'INVALID_DASHBOARD_REQUEST'],
    [
      JSON.stringify({ ...payload(), expectedAccountWorkspaceId: REQUEST_ID }),
      403,
      'ACCOUNT_WORKSPACE_MISMATCH',
    ],
    [JSON.stringify({ ...payload(), transportVersion: 2 }), 422, 'UNSUPPORTED_TRANSPORT_VERSION'],
    [
      JSON.stringify({ ...payload(), dashboard: { version: 9, state: {} } }),
      422,
      'UNSUPPORTED_DASHBOARD_VERSION',
    ],
    [
      JSON.stringify({ ...payload(), dashboard: { version: 10, state: {} } }),
      422,
      'INVALID_DASHBOARD',
    ],
    [
      JSON.stringify({ ...payload(), catalogueVersion: 'a'.repeat(64) }),
      422,
      'CATALOGUE_INCOMPATIBLE',
    ],
  ])('maps body validation failures: %s', async (body, status, code) => {
    const h = harness();
    await expectError(await h.dashboard.handle(request('PUT', body)), status, code);
    expect(h.unexpected).not.toHaveBeenCalled();
    if (code !== 'CATALOGUE_INCOMPATIBLE') expect(h.write).not.toHaveBeenCalled();
  });
  it('returns the original retained acknowledgement despite an incompatible current catalogue', async () => {
    const h = harness();
    h.write.mockImplementationOnce(async (_proof, intent) => {
      await Promise.resolve();
      return { status: 'replayed', acknowledgement: acknowledgement(intent) };
    });
    const response = await h.dashboard.handle(
      request('PUT', JSON.stringify({ ...payload(), catalogueVersion: 'a'.repeat(64) })),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      transportVersion: 1,
      accountWorkspaceId: USER_ID,
      requestId: REQUEST_ID,
      revision: '1',
      updatedAt: NOW.toISOString(),
    });
    expect(h.unexpected).not.toHaveBeenCalled();
  });
  it('applies the actual byte limit to the complete authorized envelope before persistence', async () => {
    const h = harness();
    const serialized = JSON.stringify(payload());
    const atLimit =
      serialized + ' '.repeat(MAX_DASHBOARD_REQUEST_BYTES - Buffer.byteLength(serialized));
    expect(
      (await h.dashboard.handle(request('PUT', atLimit, { 'content-length': '1' }))).status,
    ).toBe(200);
    h.write.mockClear();
    h.provider.mockClear();
    await expectError(
      await h.dashboard.handle(request('PUT', atLimit + ' ', { 'content-length': '1' })),
      413,
      'REQUEST_TOO_LARGE',
    );
    expect(h.write).not.toHaveBeenCalled();
    expect(h.provider).not.toHaveBeenCalled();
    expect(h.unexpected).not.toHaveBeenCalled();
  });
  it('maps a revision conflict without number coercion', async () => {
    const h = harness();
    const revision = '9223372036854775807';
    if (!isRevision(revision)) throw new Error('BAD_FIXTURE');
    h.write.mockResolvedValueOnce({ status: 'revision-conflict', currentRevision: revision });
    const response = await h.dashboard.handle(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'REVISION_CONFLICT',
      currentRevision: revision,
    });
  });
  it.each([
    ['request-id-reused', 409, 'REQUEST_ID_REUSED'],
    ['unauthenticated', 401, 'UNAUTHENTICATED'],
    ['auth-unavailable', 503, 'AUTH_UNAVAILABLE'],
    ['unavailable', 503, 'DASHBOARD_UNAVAILABLE'],
    ['workspace-mismatch', 403, 'ACCOUNT_WORKSPACE_MISMATCH'],
  ] as const)('maps protected write outcome %s', async (status, httpStatus, code) => {
    const h = harness();
    const outcome: DashboardWriteOutcome = { status };
    h.write.mockResolvedValueOnce(outcome);
    const response = await h.dashboard.handle(request());
    await expectError(response, httpStatus, code);
    expect(response.headers.getSetCookie()).toHaveLength(httpStatus === 401 ? 2 : 0);
    expect(h.unexpected).not.toHaveBeenCalled();
  });
  it.each(['unauthenticated', 'auth-unavailable', 'unavailable', 'workspace-mismatch'] as const)(
    'maps protected read failure %s',
    async (status) => {
      const h = harness();
      const outcome: DashboardReadOutcome = { status };
      h.read.mockResolvedValueOnce(outcome);
      const response = await h.dashboard.handle(request('GET'));
      expect(response.status).toBe(
        status === 'unauthenticated' ? 401 : status === 'workspace-mismatch' ? 403 : 503,
      );
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    },
  );
  it('sanitizes thrown storage failures and restricts logs to generated identifiers and fixed codes', async () => {
    const h = harness();
    h.write.mockRejectedValueOnce(
      new Error('SELECT secret FROM credentials; private dashboard notes'),
    );
    const response = await h.dashboard.handle(request());
    await expectError(response, 503, 'DASHBOARD_UNAVAILABLE');
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(h.logs).toEqual([{ diagnosticId: REQUEST_ID, code: 'DASHBOARD_PERSISTENCE_FAILED' }]);
  });
  it('fails closed on corrupt stored response, unavailable provider, and thrown authorization', async () => {
    const h = harness();
    h.read.mockImplementationOnce(async () => {
      await Promise.resolve();
      throw new Error('CORRUPT_STORED_DATA');
    });
    await expectError(await h.dashboard.handle(request('GET')), 503, 'DASHBOARD_UNAVAILABLE');
    const broken = createDashboard({
      authorization: h.authorization,
      persistence: () => {
        throw new Error('DATABASE_PASSWORD');
      },
    });
    await expectError(await broken.handle(request()), 503, 'DASHBOARD_UNAVAILABLE');
    const unavailableAuth = createDashboard({
      authorization: {
        authorizeRead: () => Promise.reject(new Error('CONFIG')),
        authorizeWrite: () => Promise.reject(new Error('CONFIG')),
      },
      persistence: h.provider,
    });
    await expectError(await unavailableAuth.handle(request()), 503, 'AUTH_UNAVAILABLE');
  });
});
