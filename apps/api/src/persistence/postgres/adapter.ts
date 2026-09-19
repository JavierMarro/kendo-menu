/**
 * PostgreSQL composition adapter for authentication and protected dashboards.
 *
 * It validates every caller input, owns a bounded pool, maps driver failures to
 * fixed application errors, and shares one pool plus checked-out-client transaction runner.
 * Feature adapters own their SQL without duplicating connection or commit semantics.
 */
import { asc, and, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import {
  type CompleteGoogleLoginInput,
  type CompleteGoogleLoginResult,
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
import {
  accountAdoptions,
  applicationSessions,
  loginTransactions,
  persistenceSchema,
  users,
} from '../schema.js';
import {
  createPostgresAdoptionPersistence,
  type PostgresAdoptionPersistenceDependencies,
} from './adoption-adapter.js';
import { createPostgresDashboardPersistence } from './dashboard-adapter.js';
import type { PersistenceDatabase, PersistenceTransactionOptions } from './session-sql.js';
import { touchSessionInDatabase } from './session-sql.js';

export interface PostgresPersistence extends KendoPersistence {
  /** Concrete runtime composition only; never exposed through KendoPersistence. */
  readonly pool: pg.Pool;
  /** Protected dashboard persistence backed by this adapter's same pool. */
  readonly dashboards: ReturnType<typeof createPostgresDashboardPersistence>;
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
const DASHBOARD_LOCK_TIMEOUT = '5s';
const DASHBOARD_STATEMENT_TIMEOUT = '15s';

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

  // Only the driver code crosses this inspection. Messages, SQL text, details,
  // and connection information are deliberately discarded.
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
  // Every public adapter operation passes through the same error translation.
  // This prevents one less-common driver path from leaking SQL or connection
  // details simply because its caller forgot a local catch block.
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

function activeSession(row: SessionRow, at: Date): boolean {
  return (
    row.createdAt.getTime() <= at.getTime() &&
    row.revokedAt === null &&
    row.idleExpiresAt.getTime() > at.getTime() &&
    row.absoluteExpiresAt.getTime() > at.getTime()
  );
}

class AccountSwitchConflict extends Error {
  constructor() {
    super('Account switch requires logout');
    this.name = 'AccountSwitchConflict';
  }
}

interface CompleteGoogleLoginValues {
  readonly googleSub: string;
  readonly verifiedGoogleEmail?: string;
  readonly at: Date;
  readonly session: {
    readonly userId: string;
    readonly sessionTokenHash: string;
    readonly csrfTokenHash: string;
    readonly createdAt: Date;
    readonly lastActivityAt: Date;
    readonly idleExpiresAt: Date;
    readonly absoluteExpiresAt: Date;
  };
  readonly predecessorSessionTokenHash?: string;
}

function validateCompleteGoogleLoginInput(
  input: CompleteGoogleLoginInput,
  clock: PersistenceClock,
): CompleteGoogleLoginValues {
  const at = validateNow(clock, input.at);
  const googleSub = validateGoogleSub(input.googleSub);
  const verifiedGoogleEmail =
    input.verifiedGoogleEmail === undefined || input.verifiedGoogleEmail === null
      ? undefined
      : validateVerifiedGoogleEmail(input.verifiedGoogleEmail);
  const session = validateSessionCreationInput(
    {
      userId: '00000000-0000-4000-8000-000000000000',
      sessionTokenHash: input.sessionTokenHash,
      csrfTokenHash: input.csrfTokenHash,
      idleExpiresAt: input.idleExpiresAt,
      absoluteExpiresAt: input.absoluteExpiresAt,
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      ...(input.lastActivityAt === undefined ? {} : { lastActivityAt: input.lastActivityAt }),
    },
    clock,
    at,
  );
  if (
    session.createdAt.getTime() > at.getTime() ||
    session.lastActivityAt.getTime() > at.getTime()
  ) {
    throw new PersistenceError('INVALID_INPUT');
  }
  const predecessorSessionTokenHash =
    input.predecessorSessionTokenHash === undefined
      ? undefined
      : validateSha256Hash(input.predecessorSessionTokenHash);
  return {
    googleSub,
    ...(verifiedGoogleEmail === undefined ? {} : { verifiedGoogleEmail }),
    at,
    session,
    ...(predecessorSessionTokenHash === undefined ? {} : { predecessorSessionTokenHash }),
  };
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
    // A small pool matches the serverless workload and limits database pressure
    // when several function instances start together. Short idle and connection
    // timeouts keep unavailable storage from tying up resources indefinitely.
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

  const database: PersistenceDatabase = drizzle({ client: pool, schema: persistenceSchema });
  const runTransaction = async <T>(
    callback: (transaction: PersistenceDatabase) => Promise<T>,
    options: PersistenceTransactionOptions = {},
  ): Promise<T> => {
    const client = await pool.connect();
    let destroyClient = false;
    let commitAttempted = false;
    try {
      await client.query('BEGIN');
      await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      if (options.dashboardWrite === true) {
        await client.query(`SET LOCAL lock_timeout = '${DASHBOARD_LOCK_TIMEOUT}'`);
        await client.query(`SET LOCAL statement_timeout = '${DASHBOARD_STATEMENT_TIMEOUT}'`);
      }
      const transactionDatabase: PersistenceDatabase = drizzle({
        client,
        schema: persistenceSchema,
      });
      const result = await callback(transactionDatabase);
      // Once COMMIT is sent, a connection failure leaves the outcome
      // indeterminate. Do not issue ROLLBACK in that state or return the client
      // to the pool; callers receive a fixed unavailable result.
      commitAttempted = true;
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (commitAttempted) {
        destroyClient = true;
      } else {
        try {
          await client.query('ROLLBACK');
        } catch {
          // A client with uncertain transaction state must not return to the pool.
          destroyClient = true;
        }
      }
      throw error;
    } finally {
      client.release(destroyClient);
    }
  };
  let closePromise: Promise<void> | undefined;
  const dashboards = createPostgresDashboardPersistence({
    database,
    clock,
    runTransaction,
  });
  const adoptionDependencies: PostgresAdoptionPersistenceDependencies = {
    database,
    clock,
    runTransaction,
  };
  const adoptions = createPostgresAdoptionPersistence(adoptionDependencies);

  const implementation: KendoPersistence = {
    accounts: {
      completeGoogleLogin: (input: CompleteGoogleLoginInput) =>
        safeOperation(async (): Promise<CompleteGoogleLoginResult> => {
          const values = validateCompleteGoogleLoginInput(input, clock);
          try {
            return await runTransaction(async (transaction) => {
              // Account-keyed operations all take the user lock first. This is
              // the first lock in dashboard writes and adoption mutations too,
              // preventing a user/session cycle during callback races.
              const insertedUsers = await transaction
                .insert(users)
                .values({
                  googleSub: values.googleSub,
                  verifiedGoogleEmail: values.verifiedGoogleEmail ?? null,
                  createdAt: values.at,
                  updatedAt: values.at,
                })
                .onConflictDoNothing({ target: users.googleSub })
                .returning();
              let user: UserRow;
              let newAccount = false;
              const insertedUser = insertedUsers[0];
              if (insertedUser !== undefined) {
                user = insertedUser;
                newAccount = true;
              } else {
                const existingUsers = await transaction
                  .select()
                  .from(users)
                  .where(eq(users.googleSub, values.googleSub))
                  .limit(1)
                  .for('update');
                const existingUser = existingUsers[0];
                if (existingUser === undefined) throw new PersistenceError('CONFLICT');
                const updatedUsers = await transaction
                  .update(users)
                  .set({
                    ...(values.verifiedGoogleEmail === undefined
                      ? {}
                      : { verifiedGoogleEmail: values.verifiedGoogleEmail }),
                    updatedAt: values.at,
                  })
                  .where(eq(users.id, existingUser.id))
                  .returning();
                const updatedUser = updatedUsers[0];
                if (updatedUser === undefined) throw new PersistenceError('FAILED');
                user = updatedUser;
              }

              const sessionValues = {
                ...values.session,
                userId: user.id,
              };
              let predecessor: SessionRow | undefined;
              if (values.predecessorSessionTokenHash !== undefined) {
                const predecessorRows = await transaction
                  .select()
                  .from(applicationSessions)
                  .where(
                    eq(applicationSessions.sessionTokenHash, values.predecessorSessionTokenHash),
                  )
                  .limit(1)
                  .for('update');
                predecessor = predecessorRows[0];
                if (predecessor !== undefined && predecessor.revokedAt !== null) {
                  // A consumed predecessor cannot be silently treated as an
                  // absent cookie: concurrent replacement must fail closed so
                  // exactly one callback receives the fresh session.
                  throw new PersistenceError('CONFLICT');
                }
                if (
                  predecessor !== undefined &&
                  activeSession(predecessor, values.at) &&
                  predecessor.userId !== user.id
                ) {
                  throw new AccountSwitchConflict();
                }
              }

              if (predecessor !== undefined && activeSession(predecessor, values.at)) {
                const revoked = await transaction
                  .update(applicationSessions)
                  .set({ revokedAt: values.at })
                  .where(
                    and(
                      eq(applicationSessions.id, predecessor.id),
                      eq(applicationSessions.userId, user.id),
                      isNull(applicationSessions.revokedAt),
                    ),
                  )
                  .returning({ id: applicationSessions.id });
                if (revoked.length !== 1) throw new PersistenceError('CONFLICT');
              }
              const createdSessions = await transaction
                .insert(applicationSessions)
                .values(sessionValues)
                .returning();
              const createdSession = createdSessions[0];
              if (createdSession === undefined) throw new PersistenceError('FAILED');
              const sessionRow: SessionRow = createdSession;

              if (predecessor !== undefined && activeSession(predecessor, values.at)) {
                // Callback-driven same-account replacement consumes a pending
                // capability just like the public sessions.replace operation.
                // Terminal adoption receipts remain account-level recovery data.
                await transaction
                  .update(accountAdoptions)
                  .set({ state: 'unavailable', creatingSessionId: null, updatedAt: values.at })
                  .where(
                    and(
                      eq(accountAdoptions.userId, user.id),
                      eq(accountAdoptions.state, 'pending'),
                      eq(accountAdoptions.creatingSessionId, predecessor.id),
                    ),
                  );
              }

              if (newAccount) {
                const adoptionRows = await transaction
                  .insert(accountAdoptions)
                  .values({
                    userId: user.id,
                    state: 'pending',
                    creatingSessionId: sessionRow.id,
                    createdAt: values.at,
                    updatedAt: values.at,
                  })
                  .returning({ userId: accountAdoptions.userId });
                if (adoptionRows.length !== 1) throw new PersistenceError('FAILED');
              }
              return { status: 'completed', user: mapUser(user), session: mapSession(sessionRow) };
            });
          } catch (error) {
            if (error instanceof AccountSwitchConflict) return { status: 'account-switch' };
            throw error;
          }
        }),
    },
    users: {
      findPublicById: (userId: string) =>
        safeOperation(async () => {
          const id = validateUuid(userId);
          const rows = await database
            .select({ id: users.id, verifiedGoogleEmail: users.verifiedGoogleEmail })
            .from(users)
            .where(eq(users.id, id))
            .limit(1);
          return rows[0] ?? null;
        }),
      resolveByGoogleSubject: (input: ResolveGoogleUserInput) =>
        safeOperation(async () => {
          const googleSub = validateGoogleSub(input.googleSub);
          const hasVerifiedEmail =
            input.verifiedGoogleEmail !== undefined && input.verifiedGoogleEmail !== null;
          const verifiedGoogleEmail = hasVerifiedEmail
            ? validateVerifiedGoogleEmail(input.verifiedGoogleEmail)
            : undefined;
          const now = currentTime(clock);

          // One PostgreSQL upsert handles two simultaneous first logins without
          // creating duplicate accounts. Missing/unverified email never erases a
          // previously verified value; Google `sub` remains the conflict key.
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

          // One statement locks the attempt, conditionally consumes it, clears
          // callback secrets, and returns enough pre-update state to distinguish
          // replay, expiry, and browser-binding mismatch without a race window.
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
            // SKIP LOCKED lets concurrent bounded cleanups make progress without
            // waiting on a callback that is currently consuming the same row.
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
            // Account-keyed mutation order is user, predecessor session,
            // adoption. Dashboard and adoption writes take the same order.
            const lockedUsers = await transaction
              .select({ id: users.id })
              .from(users)
              .where(eq(users.id, userId))
              .limit(1)
              .for('no key update');
            if (lockedUsers.length !== 1) throw new PersistenceError('CONFLICT');
            // Locking the predecessor makes revoke-plus-insert one indivisible
            // fixation-prevention operation. Any failure rolls both changes back.
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

            // Replacing the creating session consumes the one-time capability.
            // Keep terminal receipts untouched; only pending state is normalized.
            await transaction
              .update(accountAdoptions)
              .set({ state: 'unavailable', creatingSessionId: null, updatedAt: at })
              .where(
                and(
                  eq(accountAdoptions.userId, userId),
                  eq(accountAdoptions.state, 'pending'),
                  eq(accountAdoptions.creatingSessionId, predecessorSessionId),
                ),
              );

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

          // Activity and absolute expiry are enforced in the query, not after
          // returning the row. A revoked or expired credential therefore never
          // leaves this adapter as an apparently active session.
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

          // Out-of-order requests may finish late. The shared helper uses
          // GREATEST/LEAST to keep activity monotonic and cap idle expiry.
          const row = await touchSessionInDatabase(database, {
            sessionId,
            userId,
            at,
            idleExpiresAt,
          });
          return row === null ? null : mapSession(row);
        }),
      revoke: (input: SessionRevocationInput) =>
        safeOperation(async () => {
          const sessionId = validateUuid(input.sessionId);
          const userId = validateUuid(input.userId);
          const at = validateNow(clock, input.at);
          return runTransaction(async (transaction) => {
            const lockedUsers = await transaction
              .select({ id: users.id })
              .from(users)
              .where(eq(users.id, userId))
              .limit(1)
              .for('no key update');
            if (lockedUsers.length !== 1) return false;
            const rows = await transaction
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
            if (rows.length !== 1) return false;
            await transaction
              .update(accountAdoptions)
              .set({ state: 'unavailable', creatingSessionId: null, updatedAt: at })
              .where(
                and(
                  eq(accountAdoptions.userId, userId),
                  eq(accountAdoptions.state, 'pending'),
                  eq(accountAdoptions.creatingSessionId, sessionId),
                ),
              );
            return true;
          });
        }),
    },
    adoptions,
  };

  return {
    ...implementation,
    dashboards,
    pool,
    close: () => {
      // Share one close promise across repeated lifecycle signals. Pool shutdown
      // is attempted once, and every caller observes the same sanitized result.
      closePromise ??= safeOperation(async () => {
        await pool.end();
      });
      return closePromise;
    },
  };
}
