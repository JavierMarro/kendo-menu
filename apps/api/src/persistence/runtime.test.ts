import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersistenceError } from './contracts.js';
import { closeRuntimePersistence, getRuntimePersistence } from './runtime.js';
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
  it('reports a fixed unavailable error when runtime configuration is absent', () => {
    expect(() => getRuntimePersistence()).toThrowError(PersistenceError);
    try {
      getRuntimePersistence();
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

    const first = getRuntimePersistence();
    const second = getRuntimePersistence();

    expect(first).toBe(second);
    expect(connect).not.toHaveBeenCalled();
    await closeRuntimePersistence();
  });

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
