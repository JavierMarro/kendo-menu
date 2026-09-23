import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';
import { encodeDashboardPersistenceV10 } from '@kendo-menu/domain/dashboard-persistence';
import { describe, expect, it, vi } from 'vitest';

import {
  CSRF_COOKIE_NAME,
  MAX_DASHBOARD_REQUEST_BYTES,
  MAX_JSON_RESPONSE_BYTES,
  createAccountApiClient,
  type AccountApiError,
  type DashboardReadResponse,
  type DashboardWriteRequest,
} from './account-api';

const ACCOUNT_ID = '01234567-89ab-4cde-8fab-0123456789ab';
const OTHER_ACCOUNT_ID = '01234567-89ab-4cde-8fab-0123456789ac';
const REQUEST_ID = '01234567-89ab-4cde-8fab-0123456789ac';
const CATALOGUE_VERSION = 'a'.repeat(64);
const CSRF_TOKEN = 'A'.repeat(43);

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sessionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: ACCOUNT_ID,
    verifiedGoogleEmail: 'practitioner@example.test',
    adoption: { status: 'pending', capability: false },
    ...overrides,
  };
}

function dashboardRead(overrides: Partial<DashboardReadResponse> = {}): DashboardReadResponse {
  return {
    transportVersion: 1,
    accountWorkspaceId: ACCOUNT_ID,
    catalogueVersion: CATALOGUE_VERSION,
    revision: '0',
    dashboard: null,
    updatedAt: null,
    ...overrides,
  };
}

function dashboardWrite(): DashboardWriteRequest {
  return {
    transportVersion: 1,
    expectedAccountWorkspaceId: ACCOUNT_ID,
    expectedRevision: '0',
    requestId: REQUEST_ID,
    catalogueVersion: CATALOGUE_VERSION,
    dashboard: { version: 10, state: { dashboardEntries: [] } },
  };
}

function nearLimitDashboardRead(): DashboardReadResponse {
  const trainingSet = DEFAULT_TRAINING_SETS[0];
  const activity = trainingSet?.activities[0];
  if (trainingSet === undefined || activity === undefined) {
    throw new Error('Expected a domain fixture with one activity.');
  }
  const note = 'n'.repeat(8_000);
  const state = encodeDashboardPersistenceV10({
    dashboardEntries: Array.from({ length: 128 }, (_, index) => ({
      id: `entry-${index}`,
      trainingSetId: trainingSet.id,
      quantityOverrides: {},
      activityNotes: { [activity.id]: note },
      notes: note,
      createdAt: '2026-09-20T10:00:00.000Z',
    })),
  });
  return dashboardRead({
    revision: '1',
    dashboard: { version: 10, state },
    updatedAt: '2026-09-20T10:00:00.000Z',
  });
}

function expectAccountError(
  promise: Promise<unknown>,
  kind: AccountApiError['kind'],
): Promise<void> {
  return expect(promise).rejects.toMatchObject({ name: 'AccountApiError', kind });
}

describe('account API boundary', () => {
  it('uses same-origin no-store requests and returns a validated session', async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(sessionBody()));
    const readCookie = vi.fn(() => `${CSRF_COOKIE_NAME}=${CSRF_TOKEN}`);
    const client = createAccountApiClient({ fetch: requestFetch, readCookie });

    await expect(client.getSession()).resolves.toEqual({
      status: 'authenticated',
      session: sessionBody(),
    });
    expect(requestFetch).toHaveBeenCalledWith(
      '/api/session',
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      }),
    );
    expect(readCookie).not.toHaveBeenCalled();
  });

  it('turns an exact unauthenticated response into signed-out mode', async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: 'UNAUTHENTICATED' }, 401));
    const client = createAccountApiClient({ fetch: requestFetch });

    await expect(client.getSession()).resolves.toEqual({ status: 'signed-out' });
  });

  it('rejects HTML, malformed JSON, duplicate keys, and redirect responses', async () => {
    const htmlFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      );
    await expectAccountError(
      createAccountApiClient({ fetch: htmlFetch }).getSession(),
      'content-type',
    );

    const malformedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    await expectAccountError(
      createAccountApiClient({ fetch: malformedFetch }).getSession(),
      'malformed-json',
    );

    const duplicateFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"userId":"x","userId":"y"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expectAccountError(
      createAccountApiClient({ fetch: duplicateFetch }).getSession(),
      'malformed-json',
    );

    const redirected = jsonResponse(sessionBody());
    Object.defineProperty(redirected, 'redirected', { value: true });
    const redirectFetch = vi.fn<typeof fetch>().mockResolvedValue(redirected);
    await expectAccountError(
      createAccountApiClient({ fetch: redirectFetch }).getSession(),
      'redirect',
    );
  });

  it('rejects session fields that could disclose or select another account', async () => {
    const cases = [
      sessionBody({ sessionToken: 'secret' }),
      sessionBody({ adoption: { status: 'unavailable', capability: true } }),
      sessionBody({ adoption: { status: 'accepted', capability: false, completion: {} } }),
    ];
    for (const body of cases) {
      const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));
      await expectAccountError(
        createAccountApiClient({ fetch: requestFetch }).getSession(),
        'invalid-response',
      );
    }
  });

  it('validates dashboard account, revision, and sensitive fields', async () => {
    const wrongAccountFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(dashboardRead({ accountWorkspaceId: OTHER_ACCOUNT_ID })));
    await expectAccountError(
      createAccountApiClient({ fetch: wrongAccountFetch }).getDashboard(ACCOUNT_ID),
      'invalid-response',
    );

    const wrongRevisionFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(dashboardRead({ revision: '9223372036854775808' })));
    await expectAccountError(
      createAccountApiClient({ fetch: wrongRevisionFetch }).getDashboard(ACCOUNT_ID),
      'invalid-response',
    );

    const sensitiveResponse = { ...dashboardRead(), sessionToken: 'fixture' };
    const sensitiveFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(sensitiveResponse));
    await expectAccountError(
      createAccountApiClient({ fetch: sensitiveFetch }).getDashboard(ACCOUNT_ID),
      'invalid-response',
    );

    for (const revision of ['-1', '01']) {
      const invalidRevisionFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(dashboardRead({ revision })));
      await expectAccountError(
        createAccountApiClient({ fetch: invalidRevisionFetch }).getDashboard(ACCOUNT_ID),
        'invalid-response',
      );
    }

    const unsupportedTransportFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ ...dashboardRead(), transportVersion: 2 }));
    await expectAccountError(
      createAccountApiClient({ fetch: unsupportedTransportFetch }).getDashboard(ACCOUNT_ID),
      'invalid-response',
    );
  });

  it('allows a valid near-limit read response using the derived envelope allowance', async () => {
    const value = nearLimitDashboardRead();
    const json = JSON.stringify(value);
    const currentBytes = new TextEncoder().encode(json).byteLength;
    expect(currentBytes).toBeGreaterThan(MAX_DASHBOARD_REQUEST_BYTES - 100_000);
    expect(currentBytes).toBeLessThanOrEqual(MAX_JSON_RESPONSE_BYTES);
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(json, { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    const result = await createAccountApiClient({ fetch: requestFetch }).getDashboard(ACCOUNT_ID);
    expect(result).toEqual(value);
    expect(MAX_JSON_RESPONSE_BYTES).toBeGreaterThan(MAX_DASHBOARD_REQUEST_BYTES);
  });

  it('reads the CSRF cookie only for mutations and never sends the session cookie', async () => {
    const readCookie = vi.fn(() => `${CSRF_COOKIE_NAME}=${CSRF_TOKEN}`);
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          transportVersion: 1,
          accountWorkspaceId: ACCOUNT_ID,
          requestId: REQUEST_ID,
          revision: '1',
          updatedAt: '2026-09-20T10:00:00.000Z',
        }),
      );
    const client = createAccountApiClient({ fetch: requestFetch, readCookie });

    await client.logout();
    await client.putDashboard(ACCOUNT_ID, dashboardWrite());
    expect(readCookie).toHaveBeenCalledTimes(2);
    const logoutInit = requestFetch.mock.calls[0]?.[1];
    const writeInit = requestFetch.mock.calls[1]?.[1];
    expect(logoutInit).toMatchObject({ headers: { 'x-csrf-token': CSRF_TOKEN } });
    expect(writeInit).toMatchObject({ headers: { 'x-csrf-token': CSRF_TOKEN } });
    expect(JSON.stringify(logoutInit)).not.toContain('__Host-kendomenu-session');
    expect(JSON.stringify(writeInit)).not.toContain('__Host-kendomenu-session');
  });

  it('rejects wrong-account, wrong-request, wrong-revision, and unsupported acknowledgements', async () => {
    const acknowledgement = {
      transportVersion: 1,
      accountWorkspaceId: ACCOUNT_ID,
      requestId: REQUEST_ID,
      revision: '1',
      updatedAt: '2026-09-20T10:00:00.000Z',
    };
    const cases = [
      { ...acknowledgement, accountWorkspaceId: OTHER_ACCOUNT_ID },
      { ...acknowledgement, requestId: '01234567-89ab-4cde-8fab-0123456789ad' },
      { ...acknowledgement, revision: '2' },
      { ...acknowledgement, transportVersion: 2 },
    ];
    for (const value of cases) {
      const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(value));
      const client = createAccountApiClient({
        fetch: requestFetch,
        readCookie: () => `${CSRF_COOKIE_NAME}=${CSRF_TOKEN}`,
      });
      await expectAccountError(
        client.putDashboard(ACCOUNT_ID, dashboardWrite()),
        'invalid-response',
      );
    }
  });

  it('accepts the strict accepted and declined adoption session unions', async () => {
    const accepted = sessionBody({
      adoption: {
        status: 'accepted',
        capability: false,
        completion: {
          decision: 'yes',
          requestId: REQUEST_ID,
          acknowledgedRevision: '1',
          timestamp: '2026-09-20T10:00:00.000Z',
        },
      },
    });
    const declined = sessionBody({
      adoption: {
        status: 'declined',
        capability: false,
        completion: { decision: 'no', requestId: REQUEST_ID },
      },
    });
    for (const body of [accepted, declined]) {
      const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));
      await expect(
        createAccountApiClient({ fetch: requestFetch }).getSession(),
      ).resolves.toMatchObject({
        status: 'authenticated',
        session: { adoption: body['adoption'] },
      });
    }
  });

  it('rejects missing, duplicate, and malformed CSRF cookies before fetch', async () => {
    const requestFetch = vi.fn<typeof fetch>();
    const attempts = [
      '',
      `${CSRF_COOKIE_NAME}=${CSRF_TOKEN}; ${CSRF_COOKIE_NAME}=${CSRF_TOKEN}`,
      `${CSRF_COOKIE_NAME}=bad`,
      `${CSRF_COOKIE_NAME}; ${CSRF_COOKIE_NAME}=${CSRF_TOKEN}`,
    ];
    for (const cookie of attempts) {
      const client = createAccountApiClient({ fetch: requestFetch, readCookie: () => cookie });
      await expectAccountError(client.logout(), 'csrf');
    }
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8 and a leading BOM before JSON parsing', async () => {
    const invalidUtf8Fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(Uint8Array.from([0xc3, 0x28]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expectAccountError(
      createAccountApiClient({ fetch: invalidUtf8Fetch }).getSession(),
      'malformed-json',
    );

    const bomFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expectAccountError(
      createAccountApiClient({ fetch: bomFetch }).getSession(),
      'malformed-json',
    );
  });

  it('counts streamed response bytes without trusting Content-Length', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_JSON_RESPONSE_BYTES + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    await expectAccountError(
      createAccountApiClient({ fetch: requestFetch }).getDashboard(ACCOUNT_ID),
      'oversized',
    );
    expect(cancelled).toBe(true);
  });

  it('maps transport and oversized failures to typed retryable errors', async () => {
    const networkFetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    await expectAccountError(
      createAccountApiClient({ fetch: networkFetch }).getSession(),
      'network',
    );

    const oversizedFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': String(MAX_JSON_RESPONSE_BYTES + 1),
        },
      }),
    );
    await expectAccountError(
      createAccountApiClient({ fetch: oversizedFetch }).getDashboard(ACCOUNT_ID),
      'oversized',
    );
  });
});
