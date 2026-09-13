import { describe, expect, it, vi } from 'vitest';

import { createSessionAuthorization } from './auth/session-authorization.js';
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME, type Authentication } from './auth/contracts.js';
import { sha256 } from './auth/security.js';
import { createApp } from './app.js';
import type { DashboardPersistence } from './persistence/dashboard-contracts.js';
import type {
  KendoPersistence,
  SessionLookupInput,
  SessionRecord,
} from './persistence/contracts.js';
import { createDashboard } from './dashboard/dashboard.js';
import {
  createDashboardCatalogue,
  isAccountWorkspaceId,
  validateDashboardAcknowledgement,
} from './dashboard/validation.js';
import { MAX_DASHBOARD_REQUEST_BYTES } from './dashboard/contracts.js';

const ORIGIN = 'https://app.example.test';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-000000000002';
const REQUEST_ID = '00000000-0000-4000-8000-000000000003';
const TOKEN = Buffer.alloc(32, 1).toString('base64url');
const CSRF = Buffer.alloc(32, 2).toString('base64url');
const NOW = new Date('2026-09-12T05:00:00.000Z');
const CATALOGUE = createDashboardCatalogue();

interface StreamedRequest {
  readonly request: Request;
  readonly pulls: () => number;
}

function authenticationThatMustNotRun(): Authentication {
  const unexpected = (): Promise<Response> => Promise.reject(new Error('UNEXPECTED_AUTH_ROUTE'));
  return {
    start: unexpected,
    callback: unexpected,
    getSession: unexpected,
    logout: unexpected,
  };
}

function activeSession(): SessionRecord {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    createdAt: NOW,
    lastActivityAt: NOW,
    idleExpiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1_000),
    absoluteExpiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1_000),
    revokedAt: null,
  };
}

function persistenceHarness() {
  const session = activeSession();
  const sessionLookup = vi.fn((input: SessionLookupInput) => {
    if (
      input.sessionTokenHash !== sha256(TOKEN) ||
      (input.csrfTokenHash !== undefined && input.csrfTokenHash !== sha256(CSRF))
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(session);
  });
  const unexpectedPersistenceCall = (): Promise<never> =>
    Promise.reject(new Error('UNEXPECTED_PERSISTENCE_CALL'));
  const persistence: KendoPersistence = {
    users: {
      findPublicById: unexpectedPersistenceCall,
      resolveByGoogleSubject: unexpectedPersistenceCall,
    },
    loginTransactions: {
      create: unexpectedPersistenceCall,
      consume: unexpectedPersistenceCall,
      cleanupExpired: unexpectedPersistenceCall,
    },
    sessions: {
      create: unexpectedPersistenceCall,
      replace: unexpectedPersistenceCall,
      findActiveByTokenHash: sessionLookup,
      touch: unexpectedPersistenceCall,
      revoke: unexpectedPersistenceCall,
    },
  };

  const read = vi.fn<DashboardPersistence['read']>((proof) => {
    if (!isAccountWorkspaceId(proof.userId)) throw new Error('BAD_PROOF');
    return Promise.resolve({
      status: 'read',
      response: {
        transportVersion: 1,
        accountWorkspaceId: proof.userId,
        catalogueVersion: CATALOGUE.version,
        revision: '0',
        dashboard: null,
        updatedAt: null,
      },
    });
  });
  const compareAndWrite = vi.fn<DashboardPersistence['compareAndWrite']>((proof, intent) => {
    if (!isAccountWorkspaceId(proof.userId)) throw new Error('BAD_PROOF');
    const acknowledgement = validateDashboardAcknowledgement(
      {
        transportVersion: 1,
        accountWorkspaceId: proof.userId,
        requestId: intent.request.requestId,
        revision: '1',
        updatedAt: NOW.toISOString(),
      },
      intent,
    );
    if (acknowledgement === null) throw new Error('BAD_ACKNOWLEDGEMENT');
    return Promise.resolve({ status: 'written', acknowledgement });
  });
  const dashboardPersistence: DashboardPersistence = { read, compareAndWrite };
  const authorization = createSessionAuthorization({
    persistence,
    getAppOrigin: () => ORIGIN,
    clock: () => new Date(NOW.getTime()),
  });
  const dashboardHandler = createDashboard({
    authorization,
    persistence: dashboardPersistence,
    catalogue: CATALOGUE,
  });
  const observedBodyUsed: boolean[] = [];
  const dashboard = {
    handle: async (request: Request): Promise<Response> => {
      observedBodyUsed.push(request.bodyUsed);
      return dashboardHandler.handle(request);
    },
  };
  const app = createApp({
    authentication: authenticationThatMustNotRun(),
    dashboard,
  });
  return { app, dashboardPersistence, read, compareAndWrite, sessionLookup, observedBodyUsed };
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    transportVersion: 1,
    expectedAccountWorkspaceId: USER_ID,
    expectedRevision: '0',
    requestId: REQUEST_ID,
    catalogueVersion: CATALOGUE.version,
    dashboard: { version: 10, state: { dashboardEntries: [] } },
    ...overrides,
  };
}

function cookies(): string {
  return `${SESSION_COOKIE_NAME}=${TOKEN}; ${CSRF_COOKIE_NAME}=${CSRF}`;
}

function requestHeaders(patch: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: cookies(),
    origin: ORIGIN,
    'x-csrf-token': CSRF,
    'content-type': 'application/json',
    ...patch,
  };
}

function request(
  method: string,
  body?: string,
  headers: Record<string, string> = requestHeaders(),
): Request {
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
  };
  if (body !== undefined) {
    init.body = body;
  }
  return new Request(`${ORIGIN}/api/dashboard`, init);
}

function streamedRequest(
  method: string,
  body: string,
  headers: Record<string, string> = requestHeaders(),
): StreamedRequest {
  const bytes = new TextEncoder().encode(body);
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls += 1;
        controller.enqueue(bytes);
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const init: RequestInit & { duplex: 'half' } = {
    method,
    headers,
    body: stream,
    duplex: 'half',
  };
  return {
    request: new Request(`${ORIGIN}/api/dashboard`, init),
    pulls: () => pulls,
  };
}

async function expectJsonError(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  await expect(response.json()).resolves.toEqual({ error });
}

describe('registered dashboard HTTP routes', () => {
  it('dispatches GET and PUT through the injected dashboard and leaves PUT parsing to it', async () => {
    const harness = persistenceHarness();
    const read = await harness.app.handle(
      new Request(`${ORIGIN}/api/dashboard`, {
        method: 'GET',
        headers: { cookie: `${SESSION_COOKIE_NAME}=${TOKEN}` },
      }),
    );
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ revision: '0', dashboard: null });
    expect(harness.read).toHaveBeenCalledTimes(1);

    const write = await harness.app.handle(
      request('PUT', JSON.stringify(payload()), requestHeaders()),
    );
    expect(write.status).toBe(200);
    await expect(write.json()).resolves.toMatchObject({ requestId: REQUEST_ID, revision: '1' });
    expect(harness.compareAndWrite).toHaveBeenCalledTimes(1);

    await expectJsonError(
      await harness.app.handle(request('PUT', 'not valid json')),
      400,
      'INVALID_DASHBOARD_REQUEST',
    );
    expect(harness.compareAndWrite).toHaveBeenCalledTimes(1);
  });

  it('registers HEAD and every other method with safe method handling before auth or body reads', async () => {
    for (const method of ['HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS']) {
      const harness = persistenceHarness();
      const streamed =
        method === 'HEAD'
          ? { request: request(method), pulls: () => 0 }
          : streamedRequest(method, 'not valid json');
      const response = await harness.app.handle(streamed.request);
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET, PUT');
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(harness.observedBodyUsed).toEqual([false]);
      if (method !== 'HEAD') expect(streamed.pulls()).toBe(0);
      expect(harness.sessionLookup).not.toHaveBeenCalled();
      if (method === 'HEAD') {
        await expect(response.text()).resolves.toBe('');
      } else {
        await expect(response.json()).resolves.toEqual({ error: 'METHOD_NOT_ALLOWED' });
      }
    }
  });

  it.each([
    [{ cookie: '' }, 401, 'UNAUTHENTICATED'],
    [{ origin: 'https://other.example.test' }, 403, 'FORBIDDEN'],
    [{ 'x-csrf-token': '' }, 403, 'FORBIDDEN'],
    [{ 'content-type': 'text/plain' }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
    [{ 'content-encoding': 'gzip' }, 415, 'UNSUPPORTED_CONTENT_ENCODING'],
    [{ 'content-length': String(MAX_DASHBOARD_REQUEST_BYTES + 1) }, 413, 'REQUEST_TOO_LARGE'],
  ] as const)(
    'rejects %s before the registered route consumes body chunks',
    async (patch, status, code) => {
      const harness = persistenceHarness();
      const streamed = streamedRequest('PUT', JSON.stringify(payload()), {
        ...requestHeaders(),
        ...patch,
      });
      const response = await harness.app.handle(streamed.request);
      await expectJsonError(response, status, code);
      expect(harness.observedBodyUsed).toEqual([false]);
      expect(streamed.pulls()).toBe(0);
      expect(harness.compareAndWrite).not.toHaveBeenCalled();
      expect(response.headers.getSetCookie()).toHaveLength(status === 401 ? 2 : 0);
    },
  );

  it('counts actual UTF-8 bytes through the registered route and ignores misleading Content-Length', async () => {
    const harness = persistenceHarness();
    const serialized = JSON.stringify(payload());
    const atLimit = `${serialized}${' '.repeat(
      MAX_DASHBOARD_REQUEST_BYTES - new TextEncoder().encode(serialized).byteLength,
    )}`;
    const valid = streamedRequest('PUT', atLimit, {
      ...requestHeaders(),
      'content-length': '1',
    });
    const validResponse = await harness.app.handle(valid.request);
    expect(validResponse.status).toBe(200);
    expect(valid.pulls()).toBeGreaterThan(0);

    const overLimit = new TextDecoder().decode(
      new Uint8Array(MAX_DASHBOARD_REQUEST_BYTES + 1).fill(0x20),
    );
    const over = streamedRequest('PUT', overLimit, {
      ...requestHeaders(),
      'content-length': '1',
    });
    await expectJsonError(await harness.app.handle(over.request), 413, 'REQUEST_TOO_LARGE');
    expect(over.pulls()).toBeGreaterThan(0);
    expect(harness.compareAndWrite).toHaveBeenCalledTimes(1);
  });

  it('keeps route responses private and preserves the two-cookie authorization failure', async () => {
    const harness = persistenceHarness();
    const response = await harness.app.handle(
      request('GET', undefined, {
        cookie: `${SESSION_COOKIE_NAME}=malformed; ${SESSION_COOKIE_NAME}=malformed`,
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^__Host-kendomenu-session=;.*Max-Age=0;.*HttpOnly$/u),
      expect.stringMatching(/^__Host-kendomenu-csrf=;.*Max-Age=0;.*Secure$/u),
    ]);
    await expect(response.json()).resolves.toEqual({ error: 'UNAUTHENTICATED' });
    expect(harness.read).not.toHaveBeenCalled();
  });
});
