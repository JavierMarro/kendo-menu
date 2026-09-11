import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersistenceError } from './contracts.js';
import {
  closeRuntimePersistence,
  createRuntimePersistence,
  getRuntimePersistence,
} from './runtime.js';
import { createPostgresPersistence } from './postgres/adapter.js';

let previousDatabaseUrl: string | undefined;

beforeEach(() => {
  previousDatabaseUrl = process.env['DATABASE_URL'];
  delete process.env['DATABASE_URL'];
});

afterEach(async () => {
  await closeRuntimePersistence();
  if (previousDatabaseUrl === undefined) {
    delete process.env['DATABASE_URL'];
  } else {
    process.env['DATABASE_URL'] = previousDatabaseUrl;
  }
  vi.restoreAllMocks();
});

describe('runtime persistence lifecycle', () => {
  it('reports a fixed unavailable error when runtime configuration is absent', async () => {
    await expect(getRuntimePersistence()).rejects.toThrowError(PersistenceError);
    try {
      await getRuntimePersistence();
    } catch (error) {
      expect(error).toBeInstanceOf(PersistenceError);
      if (error instanceof PersistenceError) {
        expect(error.code).toBe('UNAVAILABLE');
        expect(error.message).toBe('Persistence storage is unavailable');
      }
    }
  });

  it('creates the warm-process pool lazily and caches the application interface', async () => {
    process.env['DATABASE_URL'] = 'postgresql://127.0.0.1:1/kendomenu_dev';
    const connect = vi.spyOn(pg.Pool.prototype, 'connect');

    const first = await getRuntimePersistence();
    const second = await getRuntimePersistence();

    expect(first).toBe(second);
    expect(connect).not.toHaveBeenCalled();
    await closeRuntimePersistence();
  });

  it('attaches exactly once for concurrent requests and never opens a connection', async () => {
    const hook = vi.fn();
    const connect = vi.spyOn(pg.Pool.prototype, 'connect');
    const runtime = createRuntimePersistence({
      connectionString: () => 'postgresql://127.0.0.1:1/kendomenu_dev',
      onPoolCreated: hook,
    });
    expect(hook).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([runtime.get(), runtime.get()]);
    expect(first).toBe(second);
    expect(hook).toHaveBeenCalledExactlyOnceWith(expect.any(pg.Pool));
    expect(connect).not.toHaveBeenCalled();
    await runtime.close();
  });

  it.each([false, true])(
    'closes an unattached pool and retries even if cleanup fails: %s',
    async (cleanupFails) => {
      const hook = vi.fn().mockImplementationOnce(() => {
        throw new Error('SENSITIVE_HOOK_FAILURE');
      });
      const end = vi.spyOn(pg.Pool.prototype, 'end');
      if (cleanupFails) end.mockRejectedValueOnce(new Error('SENSITIVE_CLEANUP_FAILURE'));
      const runtime = createRuntimePersistence({
        connectionString: () => 'postgresql://127.0.0.1:1/kendomenu_dev',
        onPoolCreated: hook,
      });
      const results = await Promise.allSettled([runtime.get(), runtime.get()]);
      for (const result of results) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
          expect(result.reason).toEqual(new PersistenceError('UNAVAILABLE'));
        }
      }
      expect(hook).toHaveBeenCalledTimes(1);
      expect(end).toHaveBeenCalledTimes(1);
      const next = await runtime.get();
      expect(await runtime.get()).toBe(next);
      expect(hook).toHaveBeenCalledTimes(2);
      await runtime.close();
      expect(end).toHaveBeenCalledTimes(2);
    },
  );

  it('sanitizes factory configuration failures without retaining connection details', () => {
    const connectionString = 'postgresql://127.0.0.1:1/kendomenu_dev';

    expect(() =>
      createPostgresPersistence({
        connectionString,
        schema: 'invalid-schema-name;',
      }),
    ).toThrowError(PersistenceError);
    try {
      createPostgresPersistence({
        connectionString,
        schema: 'invalid-schema-name;',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(PersistenceError);
      if (error instanceof PersistenceError) {
        expect(error.message).not.toContain(connectionString);
      }
    }
  });
});
