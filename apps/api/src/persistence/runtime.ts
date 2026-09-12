/**
 * Owns the lazily initialized PostgreSQL adapter used by runtime requests.
 * Concurrent first requests share one initialization promise; a failed attempt
 * is evicted so a later request can recover after configuration or storage does.
 */
import type { Pool } from 'pg';

import { PersistenceError, type KendoPersistence } from './contracts.js';
import { createPostgresPersistence, type PostgresPersistence } from './postgres/adapter.js';

export interface RuntimePersistenceOptions {
  readonly onPoolCreated?: (pool: Pool) => void | Promise<void>;
  readonly connectionString?: () => string | undefined;
}

/** Each runtime composition owns one lazy pool, including initialization failure cleanup. */
export function createRuntimePersistence(options: RuntimePersistenceOptions = {}) {
  let cached: Promise<PostgresPersistence> | undefined;

  async function initialize(): Promise<PostgresPersistence> {
    // Read DATABASE_URL only when persistence is first requested. Importing the
    // API remains side-effect free, and health/non-auth routes do not create a
    // database pool merely because the process started.
    const connectionString = options.connectionString
      ? options.connectionString()
      : process.env['DATABASE_URL'];
    if (connectionString === undefined || connectionString.trim().length === 0) {
      throw new PersistenceError('UNAVAILABLE');
    }
    let persistence: PostgresPersistence | undefined;
    try {
      persistence = createPostgresPersistence({ connectionString });
      await options.onPoolCreated?.(persistence.pool);
      return persistence;
    } catch {
      if (persistence !== undefined) {
        try {
          await persistence.close();
        } catch {
          // Cleanup was attempted; neither initialization nor cleanup details are public.
        }
      }
      throw new PersistenceError('UNAVAILABLE');
    }
  }

  return {
    get: (): Promise<KendoPersistence> => {
      if (cached === undefined) {
        // Cache the in-flight promise, not only the finished adapter, so a burst
        // of first requests cannot create parallel pools in one process.
        cached = initialize().catch(() => {
          cached = undefined;
          throw new PersistenceError('UNAVAILABLE');
        });
      }
      return cached;
    },
    close: async (): Promise<void> => {
      // Capture the exact pending instance so close cannot clear a newer cache
      // value installed by a later lifecycle transition.
      const pending = cached;
      if (pending === undefined) return;
      try {
        const persistence = await pending;
        await persistence.close();
      } finally {
        if (cached === pending) cached = undefined;
      }
    },
  };
}

const runtimePersistence = createRuntimePersistence();

export const getRuntimePersistence = runtimePersistence.get;
export const closeRuntimePersistence = runtimePersistence.close;
