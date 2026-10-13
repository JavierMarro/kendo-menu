import { createServer as createNetServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

import { createAccountAuthorization } from '../auth/account-authorization.js';
import type { ManagedIdentity, ManagedIdentityVerifier } from '../auth/managed-identity.js';
import type {
  AccountInitializationOutcome,
  ManagedAccountInitialization,
  ManagedAccountPersistence,
  ManagedAccountRecord,
} from '../persistence/managed-account-contracts.js';
import { createAccount } from './account.js';
import { createNodeApp } from '../node-app.js';

const ORIGIN = 'https://app.example.test';
const TOKEN = 'header.payload.signature';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000002';
const IDENTITY: ManagedIdentity = {
  provider: 'neon',
  issuer: 'https://auth.example.test',
  subject: 'managed-subject-1',
  verifiedEmail: 'kendoka@example.test',
  expiresAt: 2_000_000_000,
};
const NOW = 1_900_000_000;
const ACCOUNT: ManagedAccountRecord = { accountId: ACCOUNT_ID, email: IDENTITY.verifiedEmail };

function makeRequest(
  method = 'GET',
  path = '/api/account',
  options: { readonly body?: BodyInit; readonly origin?: string } = {},
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    },
    ...(options.body === undefined ? {} : { body: options.body }),
    ...(options.body instanceof ReadableStream ? { duplex: 'half' as const } : {}),
  });
}

function harness(initialization: AccountInitializationOutcome) {
  const verify = vi.fn<ManagedIdentityVerifier>(() =>
    Promise.resolve({ status: 'verified', identity: IDENTITY }),
  );
  const lookup = {
    findManagedAccount: vi.fn((_identity: ManagedIdentity) =>
      Promise.resolve({ accountId: ACCOUNT_ID }),
    ),
  };
  const authorization = createAccountAuthorization({
    verify,
    lookup,
    getAppOrigin: () => ORIGIN,
    now: () => NOW,
  });
  const initializeManagedAccount = vi.fn<ManagedAccountPersistence['initializeManagedAccount']>(
    (_identity) => Promise.resolve(initialization),
  );
  const readAccount = vi.fn<ManagedAccountPersistence['readAccount']>(() =>
    Promise.resolve(ACCOUNT),
  );
  const persistence: ManagedAccountPersistence = {
    findManagedAccount: lookup.findManagedAccount,
    initializeManagedAccount,
    readAccount,
  };
  return {
    account: createAccount({ authorization, persistence }),
    initializeManagedAccount,
    lookup,
    readAccount,
    verify,
  };
}

function initialized(account: ManagedAccountInitialization): AccountInitializationOutcome {
  return { status: 'initialized', account };
}

async function withNodeListener<T>(
  account: ReturnType<typeof createAccount>,
  operation: (url: string) => Promise<T>,
): Promise<T> {
  const reservation = createNetServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const address = reservation.address();
  if (address === null || typeof address === 'string') throw new Error('TEST_PORT_UNAVAILABLE');
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  const unused = { handle: () => Promise.resolve(new Response(null, { status: 404 })) };
  const app = createNodeApp({ account, dashboard: unused, adoption: unused });
  let listener: unknown;
  await new Promise<void>((resolve) => {
    app.listen({ hostname: '127.0.0.1', port: address.port }, (server) => {
      listener = server;
      resolve();
    });
  });
  if (typeof listener !== 'object' || listener === null)
    throw new Error('TEST_LISTENER_UNAVAILABLE');
  const stop: unknown = Reflect.get(listener, 'stop');
  if (typeof stop !== 'function') throw new Error('TEST_LISTENER_STOP_UNAVAILABLE');
  try {
    return await operation(`http://127.0.0.1:${address.port}/api/account`);
  } finally {
    Reflect.apply(stop, listener, [true]);
  }
}

describe('managed account endpoint', () => {
  it('returns the one-time copy opportunity only in the newly created account response', async () => {
    const h = harness(
      initialized({
        ...ACCOUNT,
        created: true,
        copyOpportunityId: OPPORTUNITY_ID,
      }),
    );
    const response = await h.account.handle(
      makeRequest('POST', '/api/account', { origin: ORIGIN }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      accountId: ACCOUNT_ID,
      email: IDENTITY.verifiedEmail,
      created: true,
      copyOpportunityId: OPPORTUNITY_ID,
    });
    expect(h.verify).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(h.initializeManagedAccount).toHaveBeenCalledExactlyOnceWith(IDENTITY);
    expect(h.lookup.findManagedAccount).not.toHaveBeenCalled();
  });

  it('omits the copy opportunity when initialization finds an existing account', async () => {
    const h = harness(initialized({ ...ACCOUNT, created: false }));
    const response = await h.account.handle(
      makeRequest('POST', '/api/account', { origin: ORIGIN }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accountId: ACCOUNT_ID,
      email: IDENTITY.verifiedEmail,
      created: false,
    });
  });

  it('inspects the existing account without returning a copy opportunity', async () => {
    const h = harness(initialized({ ...ACCOUNT, created: false }));
    const response = await h.account.handle(makeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(ACCOUNT);
    expect(h.lookup.findManagedAccount).toHaveBeenCalledExactlyOnceWith(IDENTITY);
    expect(h.readAccount).toHaveBeenCalledTimes(1);
    expect(h.initializeManagedAccount).not.toHaveBeenCalled();
  });

  it('rejects a non-empty POST body after authorization but before persistence', async () => {
    const h = harness(
      initialized({ ...ACCOUNT, created: true, copyOpportunityId: OPPORTUNITY_ID }),
    );
    const request = makeRequest('POST', '/api/account', { body: '{}', origin: ORIGIN });
    const response = await h.account.handle(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_ACCOUNT_REQUEST' });
    expect(request.bodyUsed).toBe(true);
    expect(h.verify).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(h.initializeManagedAccount).not.toHaveBeenCalled();
  });

  it('accepts an empty string body and zero-byte chunks ending at EOF', async () => {
    for (const body of [
      '',
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array());
          controller.enqueue(new Uint8Array());
          controller.close();
        },
      }),
    ]) {
      const h = harness(initialized({ ...ACCOUNT, created: false }));
      const response = await h.account.handle(
        makeRequest('POST', '/api/account', { origin: ORIGIN, body }),
      );
      expect(response.status).toBe(200);
      expect(h.initializeManagedAccount).toHaveBeenCalledExactlyOnceWith(IDENTITY);
    }
  });

  it('rejects the first actual byte despite a declared zero length without draining the stream', async () => {
    const h = harness(initialized({ ...ACCOUNT, created: false }));
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      controller.enqueue(Uint8Array.of(0x20));
    });
    const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
    const request = makeRequest('POST', '/api/account', { origin: ORIGIN, body });
    request.headers.set('content-length', '0');
    try {
      const response = await h.account.handle(request);
      expect(response.status).toBe(400);
      expect(pull).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
      expect(h.initializeManagedAccount).not.toHaveBeenCalled();
    } finally {
      await body.cancel();
    }
  });

  it.each(['missing-bearer', 'wrong-origin', 'invalid-identity', 'unavailable-identity'])(
    'rejects %s without accessing the body or persistence',
    async (scenario) => {
      const h = harness(initialized({ ...ACCOUNT, created: false }));
      const request = makeRequest('POST', '/api/account', { origin: ORIGIN });
      let status: number;
      if (scenario === 'missing-bearer') {
        request.headers.delete('authorization');
        status = 401;
      } else if (scenario === 'wrong-origin') {
        request.headers.set('origin', 'https://other.example.test');
        status = 403;
      } else {
        h.verify.mockResolvedValueOnce({
          status: scenario === 'invalid-identity' ? 'invalid' : 'unavailable',
        });
        status = scenario === 'invalid-identity' ? 401 : 503;
      }
      const getBody = vi.fn(() => {
        throw new Error('BODY_MUST_NOT_BE_ACCESSED');
      });
      Object.defineProperty(request, 'body', { get: getBody });
      const response = await h.account.handle(request);
      expect(response.status).toBe(status);
      expect(getBody).not.toHaveBeenCalled();
      expect(h.initializeManagedAccount).not.toHaveBeenCalled();
    },
  );

  it('sanitizes a failing body stream and does not initialize an account', async () => {
    const h = harness(initialized({ ...ACCOUNT, created: false }));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('PRIVATE_BODY_DIAGNOSTIC'));
      },
    });
    const response = await h.account.handle(
      makeRequest('POST', '/api/account', { origin: ORIGIN, body }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_ACCOUNT_REQUEST' });
    expect(body.locked).toBe(false);
    expect(h.initializeManagedAccount).not.toHaveBeenCalled();
  });

  it('rejects a locked body stream without initializing an account', async () => {
    const h = harness(initialized({ ...ACCOUNT, created: false }));
    const body = new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
    const request = makeRequest('POST', '/api/account', { origin: ORIGIN, body });
    const reader = body.getReader();
    try {
      const response = await h.account.handle(request);
      expect(response.status).toBe(400);
      expect(h.initializeManagedAccount).not.toHaveBeenCalled();
    } finally {
      reader.releaseLock();
    }
  });

  it.each(['PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    'rejects unsupported method %s before authorization',
    async (method) => {
      const h = harness(
        initialized({ ...ACCOUNT, created: true, copyOpportunityId: OPPORTUNITY_ID }),
      );
      const request = makeRequest(method, '/api/account', { body: '{}' });
      const response = await h.account.handle(request);

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET, POST');
      expect(request.bodyUsed).toBe(false);
      expect(h.verify).not.toHaveBeenCalled();
      expect(h.lookup.findManagedAccount).not.toHaveBeenCalled();
    },
  );

  it.each(['GET', 'POST'])('rejects query selectors before authorization on %s', async (method) => {
    const h = harness(
      initialized({ ...ACCOUNT, created: true, copyOpportunityId: OPPORTUNITY_ID }),
    );
    const request = makeRequest(method, '/api/account?account=other', {
      ...(method === 'POST' ? { origin: ORIGIN } : {}),
    });
    const response = await h.account.handle(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_ACCOUNT_REQUEST' });
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.lookup.findManagedAccount).not.toHaveBeenCalled();
    expect(h.initializeManagedAccount).not.toHaveBeenCalled();
    expect(h.readAccount).not.toHaveBeenCalled();
  });
});

describe('managed account initialization through Node HTTP', () => {
  it.each([undefined, ''])('accepts a genuinely empty POST: %s', async (body) => {
    const h = harness(
      initialized({ ...ACCOUNT, created: true, copyOpportunityId: OPPORTUNITY_ID }),
    );
    await withNodeListener(h.account, async (url) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
        ...(body === undefined ? {} : { body }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ...ACCOUNT,
        created: true,
        copyOpportunityId: OPPORTUNITY_ID,
      });
      expect(h.verify).toHaveBeenCalledExactlyOnceWith(TOKEN);
      expect(h.initializeManagedAccount).toHaveBeenCalledExactlyOnceWith(IDENTITY);
    });
  });

  it('rejects a non-empty POST without creating an account', async () => {
    const h = harness(initialized({ ...ACCOUNT, created: false }));
    await withNodeListener(h.account, async (url) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
        body: '{}',
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'INVALID_ACCOUNT_REQUEST' });
      expect(h.initializeManagedAccount).not.toHaveBeenCalled();
    });
  });

  it.each([
    { headers: { origin: ORIGIN }, status: 401 },
    {
      headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://other.example.test' },
      status: 403,
    },
  ])('authorizes before inspecting a Node POST body: $status', async ({ headers, status }) => {
    const h = harness(initialized({ ...ACCOUNT, created: false }));
    await withNodeListener(h.account, async (url) => {
      const response = await fetch(url, { method: 'POST', headers, body: '{}' });
      expect(response.status).toBe(status);
      expect(h.initializeManagedAccount).not.toHaveBeenCalled();
    });
  });
});
