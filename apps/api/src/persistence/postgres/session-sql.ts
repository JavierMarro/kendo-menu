/**
 * Shared PostgreSQL session SQL used by authentication and protected dashboard
 * persistence. Keeping this helper at the database boundary makes both callers
 * use the same monotonic activity and absolute-expiry policy.
 */
import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';

import { applicationSessions } from '../schema.js';
import type { persistenceSchema } from '../schema.js';

export type PersistenceDatabase = NodePgDatabase<typeof persistenceSchema>;

export interface PersistenceTransactionOptions {
  readonly dashboardWrite?: boolean;
}

export type PersistenceTransactionRunner = <T>(
  callback: (transaction: PersistenceDatabase) => Promise<T>,
  options?: PersistenceTransactionOptions,
) => Promise<T>;

export interface SessionTouchQuery {
  readonly sessionId: string;
  readonly userId: string;
  readonly at: Date;
  readonly idleExpiresAt: Date;
}

export type SessionRow = typeof applicationSessions.$inferSelect;

/**
 * Update activity monotonically without reviving a revoked or expired session.
 * Dashboard writes call this with their checked-out transaction client, so a failed touch rolls
 * back the dashboard and receipt rather than committing data under an invalid session.
 */
export async function touchSessionInDatabase(
  database: PersistenceDatabase,
  input: SessionTouchQuery,
): Promise<SessionRow | null> {
  const rows = await database
    .update(applicationSessions)
    .set({
      lastActivityAt: sql`GREATEST(${applicationSessions.lastActivityAt}, ${input.at})`,
      idleExpiresAt: sql`CASE WHEN ${input.at} >= ${applicationSessions.lastActivityAt} THEN LEAST(GREATEST(${applicationSessions.idleExpiresAt}, ${input.idleExpiresAt}), ${applicationSessions.absoluteExpiresAt}) ELSE ${applicationSessions.idleExpiresAt} END`,
    })
    .where(
      and(
        eq(applicationSessions.id, input.sessionId),
        eq(applicationSessions.userId, input.userId),
        isNull(applicationSessions.revokedAt),
        lte(applicationSessions.createdAt, input.at),
        gt(applicationSessions.idleExpiresAt, input.at),
        gt(applicationSessions.absoluteExpiresAt, input.at),
      ),
    )
    .returning();
  return rows[0] ?? null;
}
