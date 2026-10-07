import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { persistenceSchema } from '../schema.js';

export type PersistenceDatabase = NodePgDatabase<typeof persistenceSchema>;

export interface PersistenceTransactionOptions {
  readonly dashboardWrite?: boolean;
  /** Test-only lost-response seam invoked after PostgreSQL has accepted COMMIT. */
  readonly afterCommitResponse?: () => Promise<void>;
}

export type PersistenceTransactionRunner = <T>(
  callback: (transaction: PersistenceDatabase) => Promise<T>,
  options?: PersistenceTransactionOptions,
) => Promise<T>;
