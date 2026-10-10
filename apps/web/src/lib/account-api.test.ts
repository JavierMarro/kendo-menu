import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';
import { encodeDashboardPersistenceV10 } from '@kendo-menu/domain/dashboard-persistence';
import { describe, expect, it, vi } from 'vitest';

import {
  AccountApiError,
  createAccountApiClient,
  MAX_DASHBOARD_REQUEST_BYTES,
  MAX_JSON_RESPONSE_BYTES,
  type DashboardReadResponse,
  type DashboardWriteRequest,
} from './account-api';

const ACCOUNT = '01234567-89ab-4cde-8fab-0123456789ab';
const OTHER = '01234567-89ab-4cde-8fab-0123456789ac';
const REQUEST = '01234567-89ab-4cde-8fab-0123456789ad';
const CATALOGUE = 'a'.repeat(64);
const token = () => Promise.resolve({ status: 'token', token: 'synthetic-bearer' } as const);
const account = { accountId: ACCOUNT, email: 'practitioner@example.test' };
const read = (): DashboardReadResponse => ({
  transportVersion: 1,
  accountWorkspaceId: ACCOUNT,
  catalogueVersion: CATALOGUE,
  revision: '0',
  dashboard: null,
  updatedAt: null,
});
const write = (): DashboardWriteRequest => ({
  transportVersion: 1,
  expectedAccountWorkspaceId: ACCOUNT,
  expectedRevision: '0',
  requestId: REQUEST,
  catalogueVersion: CATALOGUE,
  dashboard: { version: 10, state: { dashboardEntries: [] } },
});
function client(body: unknown, status = 200) {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));
  return { transport, api: createAccountApiClient({ fetch: transport, getToken: token }) };
}

describe('managed bearer account API boundary', () => {
  it('uses token-only bearer authorization, omit/no-store/redirect rejection and bodyless creation', async () => {
    const { api, transport } = client(account);
    expect(await api.getAccount()).toEqual(account);
    expect(transport).toHaveBeenCalledWith(
      '/api/account',
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: { accept: 'application/json', authorization: 'Bearer synthetic-bearer' },
      }),
    );
    transport.mockResolvedValue(
      Response.json({ ...account, created: true, copyOpportunityId: REQUEST }),
    );
    expect(await api.initializeAccount()).toEqual({
      ...account,
      created: true,
      copyOpportunityId: REQUEST,
    });
    expect(transport.mock.calls[1]?.[1]).not.toHaveProperty('body');
    expect(transport.mock.calls[1]?.[1]?.headers).not.toHaveProperty('x-csrf-token');
  });

  it.each([
    { ...account, accountId: 'browser-subject' },
    { ...account, email: 'secret\nvalue' },
    { ...account, unknown: true },
    { ...account, created: false },
  ])('rejects invalid inspection metadata without exposing it', async (body) => {
    await expect(client(body).api.getAccount()).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it.each([
    { ...account, created: false, copyOpportunityId: REQUEST },
    { ...account, created: true, copyOpportunityId: 'invalid' },
    { ...account, created: 'yes' },
  ])('rejects invalid creation handoffs', async (body) => {
    await expect(client(body).api.initializeAccount()).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('preserves the genuinely empty account and accepts a complete catalogue-compatible dashboard', async () => {
    const { api, transport } = client(read());
    expect(await api.getDashboard(ACCOUNT)).toEqual(read());
    const trainingSet = DEFAULT_TRAINING_SETS[0];
    if (trainingSet === undefined) throw new Error('Expected curated fixture.');
    const dashboard = {
      version: 10,
      state: encodeDashboardPersistenceV10({
        dashboardEntries: [
          {
            id: 'entry-1',
            trainingSetId: trainingSet.id,
            quantityOverrides: {},
            activityNotes: {},
            notes: 'Practice',
            createdAt: '2026-10-07T10:00:00.000Z',
          },
        ],
      }),
    };
    transport.mockResolvedValue(
      Response.json({ ...read(), revision: '1', dashboard, updatedAt: '2026-10-07T10:00:00.000Z' }),
    );
    expect((await api.getDashboard(ACCOUNT)).dashboard).toEqual(dashboard);
  });

  it.each([
    { accountWorkspaceId: OTHER },
    { revision: '00' },
    { revision: '9223372036854775808' },
    { revision: '1' },
    { updatedAt: '2026-10-07T10:00:00.000Z' },
    { dashboard: { version: 9, state: { dashboardEntries: [] } } },
    { extra: true },
    { catalogueVersion: 'not-a-digest' },
  ])('rejects invalid dashboard envelopes before hydration', async (patch) => {
    await expect(client({ ...read(), ...patch }).api.getDashboard(ACCOUNT)).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('accepts only acknowledgements bound to the submitted account/request/next revision', async () => {
    const acknowledgement = {
      transportVersion: 1,
      accountWorkspaceId: ACCOUNT,
      requestId: REQUEST,
      revision: '1',
      updatedAt: '2026-10-07T10:00:00.000Z',
    };
    const { api, transport } = client(acknowledgement);
    expect(await api.putDashboard(ACCOUNT, write())).toEqual(acknowledgement);
    const init = transport.mock.calls[0]?.[1];
    expect(init?.body).toBe(JSON.stringify(write()));
    expect(init?.credentials).toBe('omit');
    for (const patch of [
      { accountWorkspaceId: OTHER },
      { requestId: OTHER },
      { revision: '2' },
      { updatedAt: 'invalid' },
    ]) {
      transport.mockResolvedValue(Response.json({ ...acknowledgement, ...patch }));
      await expect(api.putDashboard(ACCOUNT, write())).rejects.toMatchObject({
        kind: 'invalid-response',
      });
    }
  });

  it('recognizes B revision conflicts with currentRevision without changing the request', async () => {
    await expect(
      client({ error: 'REVISION_CONFLICT', currentRevision: '4' }, 409).api.putDashboard(
        ACCOUNT,
        write(),
      ),
    ).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' });
    await expect(
      client({ error: 'REVISION_CONFLICT', currentRevision: 'bad' }, 409).api.putDashboard(
        ACCOUNT,
        write(),
      ),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
    await expect(
      client({ error: 'ACCOUNT_NOT_INITIALIZED' }, 409).api.getAccount(),
    ).rejects.toMatchObject({ status: 409, code: 'ACCOUNT_NOT_INITIALIZED' });
  });

  it('fences every 401 even if the response is HTML or malformed', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<private>', { status: 401 }));
    const api = createAccountApiClient({ fetch: transport, getToken: token });
    await expect(api.getAccount()).rejects.toMatchObject({ status: 401 });
    await expect(api.getDashboard(ACCOUNT)).rejects.toMatchObject({ status: 401 });
    await expect(api.putDashboard(ACCOUNT, write())).rejects.toMatchObject({ status: 401 });
  });

  it.each([
    ['text/html', JSON.stringify(read()), 'content-type'],
    ['application/json', '{"transportVersion":1,"transportVersion":1}', 'malformed-json'],
    ['application/json', '{"private":', 'malformed-json'],
  ])('rejects unsafe transport syntax and types', async (contentType, text, kind) => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(text, { headers: { 'content-type': contentType } }));
    await expect(
      createAccountApiClient({ fetch: transport, getToken: token }).getDashboard(ACCOUNT),
    ).rejects.toMatchObject({ kind });
  });

  it('bounds streamed UTF-8 response bytes before parsing', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array(MAX_JSON_RESPONSE_BYTES + 1), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(
      createAccountApiClient({ fetch: transport, getToken: token }).getDashboard(ACCOUNT),
    ).rejects.toMatchObject({ kind: 'oversized' });
  });

  it('rejects incompatible activity references instead of letting guest hydration repair them', async () => {
    const trainingSet = DEFAULT_TRAINING_SETS[0];
    if (trainingSet === undefined) throw new Error('Expected curated fixture.');
    const state = encodeDashboardPersistenceV10({
      dashboardEntries: [
        {
          id: 'entry-1',
          trainingSetId: trainingSet.id,
          quantityOverrides: {},
          activityNotes: {},
          notes: '',
          createdAt: '2026-10-07T10:00:00.000Z',
        },
      ],
    });
    const entry = state.dashboardEntries[0];
    if (entry === undefined) throw new Error('Expected dashboard entry.');
    const invalid = {
      ...state,
      dashboardEntries: [{ ...entry, activityNotes: { 'foreign-activity': 'note' } }],
    };
    await expect(
      client({
        ...read(),
        revision: '1',
        dashboard: { version: 10, state: invalid },
        updatedAt: '2026-10-07T10:00:00.000Z',
      }).api.getDashboard(ACCOUNT),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('does not send invalid or cloud-oversized envelopes', () => {
    const { api, transport } = client({});
    expect(() => api.putDashboard(OTHER, write())).toThrow(AccountApiError);
    const trainingSet = DEFAULT_TRAINING_SETS[0];
    const activity = trainingSet?.activities[0];
    if (trainingSet === undefined || activity === undefined)
      throw new Error('Expected curated fixture.');
    const state = encodeDashboardPersistenceV10({
      dashboardEntries: Array.from({ length: 128 }, (_, index) => ({
        id: `entry-${index}`,
        trainingSetId: trainingSet.id,
        quantityOverrides: {},
        activityNotes: { [activity.id]: '界'.repeat(8000) },
        notes: '界'.repeat(8000),
        createdAt: '2026-10-07T10:00:00.000Z',
      })),
    });
    const oversized = { ...write(), dashboard: { version: 10, state } } as const;
    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBeGreaterThan(
      MAX_DASHBOARD_REQUEST_BYTES,
    );
    expect(() => api.putDashboard(ACCOUNT, oversized)).toThrow(AccountApiError);
    expect(transport).not.toHaveBeenCalled();
  });

  it('never sends a token after cancellation and bounds transports that ignore AbortSignal', async () => {
    const transport = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    const api = createAccountApiClient({ fetch: transport, getToken: token, requestTimeoutMs: 5 });
    await expect(api.getAccount()).rejects.toMatchObject({ kind: 'network' });
    const abort = new AbortController();
    abort.abort();
    const fresh = vi.fn<typeof fetch>();
    await expect(
      createAccountApiClient({ fetch: fresh, getToken: token }).getAccount(abort.signal),
    ).rejects.toMatchObject({ kind: 'aborted' });
    expect(fresh).not.toHaveBeenCalled();
  });
});
