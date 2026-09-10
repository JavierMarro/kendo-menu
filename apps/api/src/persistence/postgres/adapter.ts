import { asc, and, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import {
  PersistenceError,
  type ConsumeLoginTransactionInput,
  type ConsumeLoginTransactionResult,
  type KendoPersistence,
  type LoginTransactionCleanupInput,
  type LoginTransactionCreationInput,
  type LoginTransactionReceipt,
  type PersistenceClock,
  type ResolveGoogleUserInput,
  type SessionActivityInput,
  type SessionCreationInput,
  type SessionLookupInput,
  type SessionRecord,
  type SessionReplacementInput,
  type SessionRevocationInput,
  type UserRecord,
} from '../contracts.js';
import {
  LOGIN_TRANSACTION_CLEANUP_GRACE_MS,
  validateCleanupLimit,
  validateDate,
  validateGoogleSub,
  validateLoginTransactionTimes,
  validatePkceCodeVerifier,
  validateReturnPath,
  validateSchemaIdentifier,
  validateSessionTimes,
  validateSha256Hash,
  validateUuid,
  validateVerifiedGoogleEmail,
  validateClock,
} from '../validation.js';
import { applicationSessions, loginTransactions, users } from '../schema.js';

export interface PostgresPersistence extends KendoPersistence {
  /** Close the module's pool at a process or test lifecycle boundary. */
  close(): Promise<void>;
}

export interface PostgresPersistenceOptions {
  readonly connectionString: string;
  readonly schema?: string;
  readonly clock?: PersistenceClock;
}

const DEFAULT_SCHEMA = 'public';
const DEFAULT_CLEANUP_LIMIT = 100;
const POOL_MAX_CONNECTIONS = 5;
const POOL_IDLE_TIMEOUT_MS = 5_000;
const POOL_CONNECTION_TIMEOUT_MS = 5_000;

const schema = {
  applicationSessions,
  loginTransactions,
  users,
};

type UserRow = typeof users.$inferSelect;
type LoginTransactionRow = typeof loginTransactions.$inferSelect;
type SessionRow = typeof applicationSessions.$inferSelect;

type ConsumeLoginTransactionRow = {
  readonly transaction_id: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly consumed_at: string | null;
  readonly browser_binding_hash: string | null;
  readonly nonce_hash: string | null;
  readonly pkce_code_verifier: string | null;
  readonly return_path: string | null;
  readonly consumption_succeeded: boolean;
};

const unavailableDriverCodes = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '57P01',
  '57P02',
  '57P03',
  '53300',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

const hasProperty = (value: object, property: string): boolean => property in value;

function readErrorProperty(value: unknown, property: string): unknown {
  if (typeof value !== 'object' || value === null || !hasProperty(value, property)) {
    return undefined;
  }

  return Object.getOwnPropertyDescriptor(value, property)?.value;
}

function readDriverCode(error: unknown): string | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < 3; depth += 1) {
    const code = readErrorProperty(current, 'code');
    if (typeof code === 'string') {
      return code;
    }

    current = readErrorProperty(current, 'cause');
  }

  return undefined;
}

function toPersistenceError(error: unknown): PersistenceError {
  if (error instanceof PersistenceError) {
    return error;
  }

  const code = readDriverCode(error);
  if (code === '23505') {
    return new PersistenceError('CONFLICT');
  }

  if (code === '23503' || code === '23514' || code === '22P02' || code === '22001') {
    return new PersistenceError('INVALID_INPUT');
  }

  if (code !== undefined && unavailableDriverCodes.has(code)) {
    return new PersistenceError('UNAVAILABLE');
  }

  return new PersistenceError('FAILED');
}

async function safeOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toPersistenceError(error);
  }
}

function cloneDate(value: Date): Date {
  return new Date(value.getTime());
}

function parseDatabaseTimestamp(value: string): Date {
  return validateDate(new Date(value));
}

function currentTime(clock: PersistenceClock): Date {
  return validateClock(clock);
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    googleSub: row.googleSub,
    verifiedGoogleEmail: row.verifiedGoogleEmail,
    createdAt: cloneDate(row.createdAt),
    updatedAt: cloneDate(row.updatedAt),
  };
}

function mapLoginReceipt(row: LoginTransactionRow): LoginTransactionReceipt {
  const returnPath = row.returnPath;
  if (returnPath === null) {
    throw new PersistenceError('FAILED');
  }

  return {
    id: row.id,
    returnPath,
    createdAt: cloneDate(row.createdAt),
    expiresAt: cloneDate(row.expiresAt),
  };
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    createdAt: cloneDate(row.createdAt),
    lastActivityAt: cloneDate(row.lastActivityAt),
    idleExpiresAt: cloneDate(row.idleExpiresAt),
    absoluteExpiresAt: cloneDate(row.absoluteExpiresAt),
    revokedAt: row.revokedAt === null ? null : cloneDate(row.revokedAt),
  };
}

function validateConnectionString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PersistenceError('INVALID_INPUT');
  }

  return value;
}

function validateNow(clock: PersistenceClock, at: Date | undefined): Date {
  return at === undefined ? currentTime(clock) : validateDate(at);
}

function validateLoginCreationInput(
  input: LoginTransactionCreationInput,
  clock: PersistenceClock,
): {
  readonly stateHash: string;
  readonly browserBindingHash: string;
  readonly nonceHash: string;
  readonly pkceCodeVerifier: string;
  readonly returnPath: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
} {
  const createdAt =
    input.createdAt === undefined ? currentTime(clock) : validateDate(input.createdAt);
  const expiresAt = validateDate(input.expiresAt);
  validateLoginTransactionTimes(createdAt, expiresAt);

  return {
    stateHash: validateSha256Hash(input.stateHash),
    browserBindingHash: validateSha256Hash(input.browserBindingHash),
    nonceHash: validateSha256Hash(input.nonceHash),
    pkceCodeVerifier: validatePkceCodeVerifier(input.pkceCodeVerifier),
    returnPath: validateReturnPath(input.returnPath),
    createdAt,
    expiresAt,
  };
}

function validateSessionCreationInput(
  input: SessionCreationInput,
  clock: PersistenceClock,
  fallbackCreatedAt?: Date,
): {
  readonly userId: string;
  readonly sessionTokenHash: string;
  readonly csrfTokenHash: string;
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
} {
  const createdAt =
    input.createdAt === undefined
      ? fallbackCreatedAt === undefined
        ? currentTime(clock)
        : validateDate(fallbackCreatedAt)
      : validateDate(input.createdAt);
  const lastActivityAt =
    input.lastActivityAt === undefined ? cloneDate(createdAt) : validateDate(input.lastActivityAt);
  const idleExpiresAt = validateDate(input.idleExpiresAt);
  const absoluteExpiresAt = validateDate(input.absoluteExpiresAt);
  validateSessionTimes(createdAt, lastActivityAt, idleExpiresAt, absoluteExpiresAt);

  return {
    userId: validateUuid(input.userId),
    sessionTokenHash: validateSha256Hash(input.sessionTokenHash),
    csrfTokenHash: validateSha256Hash(input.csrfTokenHash),
    createdAt,
    lastActivityAt,
    idleExpiresAt,
    absoluteExpiresAt,
  };
}

function assertActiveSession(row: SessionRow, at: Date): void {
  if (
    row.createdAt.getTime() > at.getTime() ||
    row.revokedAt !== null ||
    row.idleExpiresAt.getTime() <= at.getTime() ||
    row.absoluteExpiresAt.getTime() <= at.getTime()
  ) {
    throw new PersistenceError('CONFLICT');
  }
}

export function createPostgresPersistence(
  options: PostgresPersistenceOptions,
): PostgresPersistence {
  if (typeof options !== 'object' || options === null) {
    throw new PersistenceError('INVALID_INPUT');
  }

  const connectionString = validateConnectionString(options.connectionString);
  const selectedSchema = validateSchemaIdentifier(options.schema ?? DEFAULT_SCHEMA);
  const clock = options.clock ?? (() => new Date());

  let pool: pg.Pool;
  try {
    pool = new pg.Pool({
      connectionString,
      max: POOL_MAX_CONNECTIONS,
      idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
      options: `-c search_path="${selectedSchema}"`,
    });
    pool.on('error', () => undefined);
  } catch {
    throw new PersistenceError('INVALID_INPUT');
  }

  const database: NodePgDatabase<typeof schema> = drizzle({ client: pool, schema });
  const runTransaction = async <T>(
    callback: (transaction: NodePgDatabase<typeof schema>) => Promise<T>,
  ): Promise<T> => {
    const client = await pool.connect();
    let destroyClient = false;
    try {
      await client.query('BEGIN');
      const transactionDatabase: NodePgDatabase<typeof schema> = drizzle({
        client,
        schema,
      });
      const result = await callback(transactionDatabase);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        destroyClient = true;
      }
      throw error;
    } finally {
      client.release(destroyClient);
    }
  };
  let closePromise: Promise<void> | undefined;

  const implementation: KendoPersistence = {
    users: {
      resolveByGoogleSubject: (input: ResolveGoogleUserInput) =>
        safeOperation(async () => {
          const googleSub = validateGoogleSub(input.googleSub);
          const hasVerifiedEmail =
            input.verifiedGoogleEmail !== undefined && input.verifiedGoogleEmail !== null;
          const verifiedGoogleEmail = hasVerifiedEmail
            ? validateVerifiedGoogleEmail(input.verifiedGoogleEmail)
            : undefined;
          const now = currentTime(clock);

          if (hasVerifiedEmail) {
            const rows = await database
              .insert(users)
              .values({
                googleSub,
                verifiedGoogleEmail,
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: users.googleSub,
                set: {
                  verifiedGoogleEmail,
                  updatedAt: now,
                },
              })
              .returning();
            const row = rows[0];
            if (row === undefined) {
              throw new PersistenceError('FAILED');
            }

            return mapUser(row);
          }

          const rows = await database
            .insert(users)
            .values({
              googleSub,
              verifiedGoogleEmail: null,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: users.googleSub,
              set: {
                updatedAt: now,
              },
            })
            .returning();
          const row = rows[0];
          if (row === undefined) {
            throw new PersistenceError('FAILED');
          }

          return mapUser(row);
        }),
    },
    loginTransactions: {
      create: (input: LoginTransactionCreationInput) =>
        safeOperation(async () => {
          const values = validateLoginCreationInput(input, clock);
          const rows = await database.insert(loginTransactions).values(values).returning();
          const row = rows[0];
          if (row === undefined) {
            throw new PersistenceError('FAILED');
          }

          return mapLoginReceipt(row);
        }),
      consume: (input: ConsumeLoginTransactionInput) =>
        safeOperation(async (): Promise<ConsumeLoginTransactionResult> => {
          const stateHash = validateSha256Hash(input.stateHash);
          const browserBindingHash = validateSha256Hash(input.browserBindingHash);
          const at = validateNow(clock, input.at);

          const result = await database.execute<ConsumeLoginTransactionRow>(sql`
            WITH locked AS MATERIALIZED (
              SELECT
                ${loginTransactions.id} AS transaction_id,
                ${loginTransactions.createdAt} AS created_at,
                ${loginTransactions.expiresAt} AS expires_at,
                ${loginTransactions.consumedAt} AS consumed_at,
                ${loginTransactions.browserBindingHash} AS browser_binding_hash,
                ${loginTransactions.nonceHash} AS nonce_hash,
                ${loginTransactions.pkceCodeVerifier} AS pkce_code_verifier,
                ${loginTransactions.returnPath} AS return_path
              FROM ${loginTransactions}
              WHERE ${loginTransactions.stateHash} = ${stateHash}
              FOR UPDATE
            ),
            consumed AS (
              UPDATE ${loginTransactions}
              SET
                ${sql.identifier('browser_binding_hash')} = NULL,
                ${sql.identifier('nonce_hash')} = NULL,
                ${sql.identifier('pkce_code_verifier')} = NULL,
                ${sql.identifier('return_path')} = NULL,
                ${sql.identifier('consumed_at')} = ${at}
              FROM locked
              WHERE ${loginTransactions.id} = locked.transaction_id
                AND locked.consumed_at IS NULL
                AND locked.created_at <= ${at}
                AND locked.expires_at > ${at}
                AND locked.browser_binding_hash = ${browserBindingHash}
              RETURNING ${sql.identifier('id')} AS transaction_id
            )
            SELECT
              locked.transaction_id,
              locked.created_at,
              locked.expires_at,
              locked.consumed_at,
              locked.browser_binding_hash,
              locked.nonce_hash,
              locked.pkce_code_verifier,
              locked.return_path,
              (consumed.transaction_id IS NOT NULL) AS consumption_succeeded
            FROM locked
            LEFT JOIN consumed USING (transaction_id)
          `);
          const row = result.rows[0];
          if (row === undefined) {
            return { outcome: 'missing' };
          }

          if (row.consumption_succeeded) {
            if (
              row.browser_binding_hash === null ||
              row.nonce_hash === null ||
              row.pkce_code_verifier === null ||
              row.return_path === null
            ) {
              throw new PersistenceError('FAILED');
            }

            return {
              outcome: 'success',
              transaction: {
                pkceCodeVerifier: row.pkce_code_verifier,
                nonceHash: row.nonce_hash,
                returnPath: row.return_path,
                createdAt: parseDatabaseTimestamp(row.created_at),
                expiresAt: parseDatabaseTimestamp(row.expires_at),
              },
            };
          }

          if (row.consumed_at !== null) {
            return { outcome: 'consumed' };
          }

          if (
            parseDatabaseTimestamp(row.created_at).getTime() > at.getTime() ||
            parseDatabaseTimestamp(row.expires_at).getTime() <= at.getTime()
          ) {
            return { outcome: 'expired' };
          }

          if (row.browser_binding_hash !== browserBindingHash) {
            return { outcome: 'binding-mismatch' };
          }

          throw new PersistenceError('FAILED');
        }),
      cleanupExpired: (input: LoginTransactionCleanupInput = {}) =>
        safeOperation(async () => {
          const at = validateNow(clock, input.at);
          const limit =
            input.limit === undefined ? DEFAULT_CLEANUP_LIMIT : validateCleanupLimit(input.limit);
          const cutoff = new Date(at.getTime() - LOGIN_TRANSACTION_CLEANUP_GRACE_MS);

          return runTransaction(async (transaction) => {
            const candidates = await transaction
              .select({ id: loginTransactions.id })
              .from(loginTransactions)
              .where(lte(loginTransactions.expiresAt, cutoff))
              .orderBy(asc(loginTransactions.expiresAt), asc(loginTransactions.id))
              .limit(limit)
              .for('update', { skipLocked: true });
            const candidateIds = candidates.map((candidate) => candidate.id);
            if (candidateIds.length === 0) {
              return { deleted: 0 };
            }

            const deleted = await transaction
              .delete(loginTransactions)
              .where(inArray(loginTransactions.id, candidateIds))
              .returning({ id: loginTransactions.id });

            return { deleted: deleted.length };
          });
        }),
    },
    sessions: {
      create: (input: SessionCreationInput) =>
        safeOperation(async () => {
          const values = validateSessionCreationInput(input, clock);
          const rows = await database.insert(applicationSessions).values(values).returning();
          const row = rows[0];
          if (row === undefined) {
            throw new PersistenceError('FAILED');
          }

          return mapSession(row);
        }),
      replace: (input: SessionReplacementInput) =>
        safeOperation(async () => {
          const predecessorSessionId = validateUuid(input.predecessorSessionId);
          const userId = validateUuid(input.userId);
          const at = validateNow(clock, input.at);
          const replacement = validateSessionCreationInput(input.replacement, clock, at);
          if (replacement.userId !== userId) {
            throw new PersistenceError('INVALID_INPUT');
          }
          if (
            replacement.createdAt.getTime() > at.getTime() ||
            replacement.lastActivityAt.getTime() > at.getTime()
          ) {
            throw new PersistenceError('INVALID_INPUT');
          }

          return runTransaction(async (transaction) => {
            const predecessorRows = await transaction
              .select()
              .from(applicationSessions)
              .where(
                and(
                  eq(applicationSessions.id, predecessorSessionId),
                  eq(applicationSessions.userId, userId),
                ),
              )
              .limit(1)
              .for('update');
            const predecessor = predecessorRows[0];
            if (predecessor === undefined) {
              throw new PersistenceError('CONFLICT');
            }
            if (at.getTime() < predecessor.createdAt.getTime()) {
              throw new PersistenceError('INVALID_INPUT');
            }
            assertActiveSession(predecessor, at);

            const revokedRows = await transaction
              .update(applicationSessions)
              .set({ revokedAt: at })
              .where(
                and(
                  eq(applicationSessions.id, predecessorSessionId),
                  eq(applicationSessions.userId, userId),
                  isNull(applicationSessions.revokedAt),
                ),
              )
              .returning({ id: applicationSessions.id });
            if (revokedRows.length !== 1) {
              throw new PersistenceError('CONFLICT');
            }

            const replacementRows = await transaction
              .insert(applicationSessions)
              .values(replacement)
              .returning();
            const replacementRow = replacementRows[0];
            if (replacementRow === undefined) {
              throw new PersistenceError('FAILED');
            }

            return mapSession(replacementRow);
          });
        }),
      findActiveByTokenHash: (input: SessionLookupInput) =>
        safeOperation(async () => {
          const sessionTokenHash = validateSha256Hash(input.sessionTokenHash);
          const at = validateNow(clock, input.at);
          const predicates = [
            eq(applicationSessions.sessionTokenHash, sessionTokenHash),
            isNull(applicationSessions.revokedAt),
            lte(applicationSessions.createdAt, at),
            gt(applicationSessions.idleExpiresAt, at),
            gt(applicationSessions.absoluteExpiresAt, at),
          ];
          if (input.csrfTokenHash !== undefined) {
            predicates.push(
              eq(applicationSessions.csrfTokenHash, validateSha256Hash(input.csrfTokenHash)),
            );
          }

          const rows = await database
            .select()
            .from(applicationSessions)
            .where(and(...predicates))
            .limit(1);
          const row = rows[0];
          return row === undefined ? null : mapSession(row);
        }),
      touch: (input: SessionActivityInput) =>
        safeOperation(async () => {
          const sessionId = validateUuid(input.sessionId);
          const userId = validateUuid(input.userId);
          const at = validateNow(clock, input.at);
          const idleExpiresAt = validateDate(input.idleExpiresAt);
          if (idleExpiresAt.getTime() < at.getTime()) {
            throw new PersistenceError('INVALID_INPUT');
          }

          const rows = await database
            .update(applicationSessions)
            .set({
              lastActivityAt: sql`GREATEST(${applicationSessions.lastActivityAt}, ${at})`,
              idleExpiresAt: sql`CASE WHEN ${at} >= ${applicationSessions.lastActivityAt} THEN LEAST(GREATEST(${applicationSessions.idleExpiresAt}, ${idleExpiresAt}), ${applicationSessions.absoluteExpiresAt}) ELSE ${applicationSessions.idleExpiresAt} END`,
            })
            .where(
              and(
                eq(applicationSessions.id, sessionId),
                eq(applicationSessions.userId, userId),
                isNull(applicationSessions.revokedAt),
                lte(applicationSessions.createdAt, at),
                gt(applicationSessions.idleExpiresAt, at),
                gt(applicationSessions.absoluteExpiresAt, at),
              ),
            )
            .returning();
          const row = rows[0];
          return row === undefined ? null : mapSession(row);
        }),
      revoke: (input: SessionRevocationInput) =>
        safeOperation(async () => {
          const sessionId = validateUuid(input.sessionId);
          const userId = validateUuid(input.userId);
          const at = validateNow(clock, input.at);
          const rows = await database
            .update(applicationSessions)
            .set({ revokedAt: at })
            .where(
              and(
                eq(applicationSessions.id, sessionId),
                eq(applicationSessions.userId, userId),
                isNull(applicationSessions.revokedAt),
              ),
            )
            .returning({ id: applicationSessions.id });
          return rows.length === 1;
        }),
    },
  };

  return {
    ...implementation,
    close: () => {
      closePromise ??= safeOperation(async () => {
        await pool.end();
      });
      return closePromise;
    },
  };
}
