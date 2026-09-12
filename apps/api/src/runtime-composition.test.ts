import { Pool } from 'pg';
import type * as VercelFunctions from '@vercel/functions';
import { afterEach, describe, expect, it, vi } from 'vitest';

const attach = vi.hoisted(() => vi.fn());
vi.mock('@vercel/functions', async (importOriginal) => {
  const actual = await importOriginal<typeof VercelFunctions>();
  return {
    ...actual,
    attachDatabasePool: attach.mockImplementation(actual.attachDatabasePool),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  attach.mockClear();
});

async function loadAdapter() {
  vi.resetModules();
  const { default: adapter } = await import('../../../api/[...path].js');
  return adapter;
}

const sessionCookie = `__Host-kendomenu-session=${Buffer.alloc(32, 1).toString('base64url')}`;

function sessionRequest(): Request {
  return new Request('https://app.example.test/api/session', {
    headers: { cookie: sessionCookie },
  });
}

describe('root Vercel pool composition', () => {
  it('does not attach or connect during import, health, or configuration failures', async () => {
    vi.stubEnv('DATABASE_URL', undefined);
    const connect = vi.spyOn(Pool.prototype, 'connect');
    const adapter = await loadAdapter();
    expect((await adapter.fetch(new Request('https://app.example.test/api/health'))).status).toBe(
      200,
    );
    const response = await adapter.fetch(sessionRequest());
    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(attach).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('attaches the actual pg pool once and preserves credentials on unavailable queries', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://127.0.0.1:1/kendomenu_dev');
    // Reject at the socket boundary: the runtime still creates and attaches its actual pg pool.
    vi.spyOn(Pool.prototype, 'connect').mockImplementation(() => {
      throw new Error('PRIVATE_DATABASE_FAILURE');
    });
    const adapter = await loadAdapter();
    try {
      const responses = await Promise.all([
        adapter.fetch(sessionRequest()),
        adapter.fetch(sessionRequest()),
      ]);
      expect(attach).toHaveBeenCalledTimes(1);
      expect(attach).toHaveBeenCalledWith(expect.any(Pool));
      for (const response of responses) {
        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.getSetCookie()).toEqual([]);
        expect(await response.text()).toBe('{"error":"AUTH_UNAVAILABLE"}');
      }
    } finally {
      const pool: unknown = attach.mock.calls[0]?.[0];
      if (pool instanceof Pool) await pool.end();
    }
  });

  it('returns safe 503 after attachment failure, closes the pool, and retries on the next request', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://127.0.0.1:1/kendomenu_dev');
    vi.spyOn(Pool.prototype, 'connect').mockImplementation(() => {
      throw new Error('PRIVATE_DATABASE_FAILURE');
    });
    const end = vi.spyOn(Pool.prototype, 'end');
    attach.mockImplementationOnce(() => {
      throw new Error('PRIVATE_ATTACHMENT_FAILURE');
    });
    const adapter = await loadAdapter();
    const failed = await adapter.fetch(sessionRequest());
    expect(failed.status).toBe(503);
    expect(failed.headers.getSetCookie()).toEqual([]);
    expect(await failed.text()).toBe('{"error":"AUTH_UNAVAILABLE"}');
    expect(end).toHaveBeenCalledTimes(1);
    const next = await adapter.fetch(sessionRequest());
    expect(next.status).toBe(503);
    expect(attach).toHaveBeenCalledTimes(2);
    const secondPool: unknown = attach.mock.calls[1]?.[0];
    if (!(secondPool instanceof Pool)) throw new Error('TEST_POOL_MISSING');
    await secondPool.end();
  });
});
