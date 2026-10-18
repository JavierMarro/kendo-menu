/**
 * Composes the managed PostgreSQL ports around one bounded connection pool.
 * Writes use an explicit transaction runner; a failed response after COMMIT is ambiguous, so its
 * client is discarded.
 * Pool close is repeatable and reports failures through the fixed persistence error surface.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { PersistenceError, type PersistenceClock } from '../contracts.js';
import { persistenceSchema } from '../schema.js';
import { createPostgresManagedAccountPersistence } from './managed-account-adapter.js';
import { createPostgresManagedCopyPersistence } from './managed-copy-adapter.js';
import { createPostgresManagedDashboardPersistence } from './managed-dashboard-adapter.js';
import type { PersistenceDatabase, PersistenceTransactionOptions } from './transaction.js';

export interface PostgresPersistence {
  readonly pool: pg.Pool;
  readonly dashboards: ReturnType<typeof createPostgresManagedDashboardPersistence>;
  readonly managedAccounts: ReturnType<typeof createPostgresManagedAccountPersistence>;
  readonly managedCopy: ReturnType<typeof createPostgresManagedCopyPersistence>;
  close(): Promise<void>;
}

export interface PostgresPersistenceOptions {
  readonly connectionString: string;
  readonly schema?: string;
  readonly clock?: PersistenceClock;
  /** Real PostgreSQL race-test seam, absent from production composition. */
  readonly afterCopyOpportunityConsumed?: () => Promise<void>;
  readonly afterCopyWriteBeforeCommit?: () => Promise<void>;
  readonly afterCopyCommitResponseLost?: () => Promise<void>;
}

const DASHBOARD_LOCK_TIMEOUT = '5s';
const DASHBOARD_STATEMENT_TIMEOUT = '15s';

export function createPostgresPersistence(
  options: PostgresPersistenceOptions,
): PostgresPersistence {
  if (typeof options.connectionString !== 'string' || options.connectionString.trim() === '') {
    throw new PersistenceError('INVALID_INPUT');
  }
  const schema = options.schema ?? 'public';
  if (!/^[a-z_][a-z0-9_]{0,62}$/u.test(schema)) throw new PersistenceError('INVALID_INPUT');
  const clock = options.clock ?? (() => new Date());

  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: 5,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    // Avoid startup search_path on the pooled public runtime; use the role's default path.
    // Keep direct local test schemas explicit so their data cannot fall back to public.
    ...(schema === 'public' ? {} : { options: `-c search_path="${schema}"` }),
  });
  pool.on('error', () => undefined);
  const database: PersistenceDatabase = drizzle({ client: pool, schema: persistenceSchema });
  const runTransaction = async <T>(
    callback: (transaction: PersistenceDatabase) => Promise<T>,
    transactionOptions: PersistenceTransactionOptions = {},
  ): Promise<T> => {
    const client = await pool.connect();
    let destroyClient = false;
    let commitAttempted = false;
    try {
      await client.query('BEGIN');
      await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      if (transactionOptions.dashboardWrite === true) {
        // Bound lock waits and statements for account mutations without changing read transactions.
        await client.query(`SET LOCAL lock_timeout = '${DASHBOARD_LOCK_TIMEOUT}'`);
        await client.query(`SET LOCAL statement_timeout = '${DASHBOARD_STATEMENT_TIMEOUT}'`);
      }
      const tx: PersistenceDatabase = drizzle({ client, schema: persistenceSchema });
      const result = await callback(tx);
      commitAttempted = true;
      await client.query('COMMIT');
      await transactionOptions.afterCommitResponse?.();
      return result;
    } catch (error) {
      if (commitAttempted) {
        // A failed COMMIT response is ambiguous, so this client is unsafe to reuse.
        destroyClient = true;
      } else {
        try {
          await client.query('ROLLBACK');
        } catch {
          destroyClient = true;
        }
      }
      throw error;
    } finally {
      client.release(destroyClient);
    }
  };

  const dashboards = createPostgresManagedDashboardPersistence({ database, clock, runTransaction });
  const managedAccounts = createPostgresManagedAccountPersistence({
    database,
    clock,
    runTransaction,
  });
  const managedCopy = createPostgresManagedCopyPersistence({
    clock,
    runTransaction,
    ...(options.afterCopyOpportunityConsumed === undefined
      ? {}
      : { afterOpportunityConsumed: options.afterCopyOpportunityConsumed }),
    ...(options.afterCopyWriteBeforeCommit === undefined
      ? {}
      : { afterCopyWriteBeforeCommit: options.afterCopyWriteBeforeCommit }),
    ...(options.afterCopyCommitResponseLost === undefined
      ? {}
      : { afterCopyCommitResponseLost: options.afterCopyCommitResponseLost }),
  });
  let closePromise: Promise<void> | undefined;
  return {
    pool,
    dashboards,
    managedAccounts,
    managedCopy,
    close: () => {
      closePromise ??= pool.end().catch(() => {
        throw new PersistenceError('UNAVAILABLE');
      });
      return closePromise;
    },
  };
}
