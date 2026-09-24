/**
 * PostgreSQL implementation of the protected dashboard persistence seam.
 *
 * Authentication and dashboard operations receive the same pool and the same
 * checked-out client transaction runner from the composition adapter. This
 * module owns dashboard SQL, receipt retention and proof revalidation so the
 * authentication adapter remains focused on its established tables.
 */
import { and, eq, lte, sql } from 'drizzle-orm';

import { SESSION_IDLE_LIFETIME_MS } from '../../auth/contracts.js';
import type { SessionAuthorizationProof } from '../../auth/session-authorization.js';
import {
  createDashboardCatalogue,
  isAccountWorkspaceId,
  isCatalogueVersion,
  isNonZeroRevision,
  isRequestId,
  isRevision,
  isTimestamp,
} from '../../dashboard/validation.js';
import {
  DASHBOARD_RECEIPT_CLEANUP_AGE_MS,
  MAX_DASHBOARD_RECEIPTS_PER_ACCOUNT,
  MAX_DASHBOARD_REQUEST_BYTES,
  MAX_REVISION,
  type CatalogueVersion,
  type DashboardReadResponse,
  type DashboardSnapshot,
  type DashboardWriteAcknowledgement,
  type Revision,
} from '../../dashboard/contracts.js';
import { canonicalizeJson } from '../../dashboard/canonicalization.js';
import { parseStrictJsonText } from '../../dashboard/request-body.js';
import type { ValidatedDashboardWrite } from '../../dashboard/validation.js';
import { parseDashboardPersistenceV10 } from '@kendo-menu/domain/dashboard-persistence';

import { PersistenceError, type PersistenceClock } from '../contracts.js';
import type {
  DashboardPersistence,
  DashboardReadOutcome,
  DashboardWriteOutcome,
} from '../dashboard-contracts.js';
import { validateDate, validateSha256Hash, validateUuid } from '../validation.js';
import {
  accountAdoptions,
  applicationSessions,
  cloudDashboards,
  dashboardWriteReceipts,
  users,
} from '../schema.js';
import {
  type PersistenceDatabase,
  type PersistenceTransactionRunner,
  touchSessionInDatabase,
} from './session-sql.js';

const DASHBOARD_TRANSPORT_VERSION = 1;
const MAX_REVISION_BIGINT = BigInt(MAX_REVISION);
const defaultCatalogue = createDashboardCatalogue();

type CloudDashboardRow = typeof cloudDashboards.$inferSelect;
type DashboardWriteReceiptRow = typeof dashboardWriteReceipts.$inferSelect;
type SessionRow = typeof applicationSessions.$inferSelect;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class DashboardAuthorizationFailure extends Error {
  readonly status = 'unauthenticated' as const;

  constructor() {
    super('Dashboard authorization failed');
    this.name = 'DashboardAuthorizationFailure';
  }
}

class DashboardWorkspaceMismatch extends Error {
  readonly status = 'workspace-mismatch' as const;

  constructor() {
    super('Dashboard workspace does not match');
    this.name = 'DashboardWorkspaceMismatch';
  }
}

interface DashboardProofValues {
  readonly userId: string;
  readonly sessionId: string;
  readonly sessionTokenHash: string;
  readonly csrfTokenHash?: string;
}

function readOwnDataProperty(value: object, property: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, property);
  if (descriptor === undefined || !('value' in descriptor)) {
    return undefined;
  }
  return descriptor.value;
}

function dashboardProofValues(proof: unknown, requireCsrfToken: boolean): DashboardProofValues {
  try {
    if (typeof proof !== 'object' || proof === null) {
      throw new DashboardAuthorizationFailure();
    }
    const userId = validateUuid(readOwnDataProperty(proof, 'userId'));
    const sessionId = validateUuid(readOwnDataProperty(proof, 'sessionId'));
    const sessionTokenHash = validateSha256Hash(readOwnDataProperty(proof, 'sessionTokenHash'));
    const csrfValue = readOwnDataProperty(proof, 'csrfTokenHash');
    if (requireCsrfToken && csrfValue === undefined) {
      throw new DashboardAuthorizationFailure();
    }
    const csrfTokenHash = csrfValue === undefined ? undefined : validateSha256Hash(csrfValue);
    return {
      userId,
      sessionId,
      sessionTokenHash,
      ...(csrfTokenHash === undefined ? {} : { csrfTokenHash }),
    };
  } catch (error) {
    if (error instanceof DashboardAuthorizationFailure) {
      throw error;
    }
    throw new DashboardAuthorizationFailure();
  }
}

function timestamp(value: Date): string {
  try {
    const serialized = value.toISOString();
    if (isTimestamp(serialized)) {
      return serialized;
    }
  } catch {
    // Fall through to the fixed persistence error.
  }
  throw new PersistenceError('FAILED');
}

function dashboardRevision(value: bigint): Revision {
  if (value <= 0n || value > MAX_REVISION_BIGINT) {
    throw new PersistenceError('FAILED');
  }
  const serialized = String(value);
  if (!isRevision(serialized)) {
    throw new PersistenceError('FAILED');
  }
  return serialized;
}

function storedDashboardSnapshot(value: string): DashboardSnapshot {
  // Canonical text is an integrity boundary as well as a storage format. Parsing,
  // domain validation, and byte-for-byte re-canonicalization detect malformed or
  // non-canonical rows without rewriting potentially recoverable data.
  if (Buffer.byteLength(value, 'utf8') > MAX_DASHBOARD_REQUEST_BYTES) {
    throw new PersistenceError('FAILED');
  }
  let parsed: unknown;
  try {
    parsed = parseStrictJsonText(value);
  } catch {
    throw new PersistenceError('FAILED');
  }
  if (
    !isRecord(parsed) ||
    !Object.hasOwn(parsed, 'version') ||
    !Object.hasOwn(parsed, 'state') ||
    parsed['version'] !== 10
  ) {
    throw new PersistenceError('FAILED');
  }
  const state = parseDashboardPersistenceV10(parsed['state']);
  if (state === null) {
    throw new PersistenceError('FAILED');
  }
  const snapshot = Object.freeze({ version: 10 as const, state });
  try {
    if (canonicalizeJson(snapshot) !== value) {
      throw new PersistenceError('FAILED');
    }
  } catch (error) {
    if (error instanceof PersistenceError) {
      throw error;
    }
    throw new PersistenceError('FAILED');
  }
  return snapshot;
}

function validateCloudDashboardRow(
  row: CloudDashboardRow,
  userId: string,
): {
  readonly revision: bigint;
  readonly catalogueDigest: CatalogueVersion;
  readonly dashboard: DashboardSnapshot;
  readonly createdAt: Date;
  readonly updatedAt: Date;
} {
  if (
    row.userId !== userId ||
    row.transportVersion !== DASHBOARD_TRANSPORT_VERSION ||
    typeof row.revision !== 'bigint' ||
    row.revision <= 0n ||
    row.revision > MAX_REVISION_BIGINT ||
    !isCatalogueVersion(row.catalogueDigest)
  ) {
    throw new PersistenceError('FAILED');
  }
  const createdAt = validateDate(row.createdAt);
  const updatedAt = validateDate(row.updatedAt);
  if (updatedAt.getTime() < createdAt.getTime()) {
    throw new PersistenceError('FAILED');
  }
  const dashboard = storedDashboardSnapshot(row.dashboardJson);
  return {
    revision: row.revision,
    catalogueDigest: row.catalogueDigest,
    dashboard,
    createdAt,
    updatedAt,
  };
}

function validateReceiptRow(
  row: DashboardWriteReceiptRow,
  userId: string,
  requestId: string,
): {
  readonly requestDigest: string;
  readonly revision: Revision;
  readonly acknowledgedAt: string;
} {
  if (
    row.userId !== userId ||
    row.requestId !== requestId ||
    !/^[0-9a-f]{64}$/u.test(row.requestDigest) ||
    typeof row.acknowledgedRevision !== 'bigint' ||
    row.acknowledgedRevision <= 0n ||
    row.acknowledgedRevision > MAX_REVISION_BIGINT
  ) {
    throw new PersistenceError('FAILED');
  }
  const acknowledgedAt = validateDate(row.acknowledgedAt);
  const createdAt = validateDate(row.createdAt);
  if (acknowledgedAt.getTime() < createdAt.getTime()) {
    throw new PersistenceError('FAILED');
  }
  return {
    requestDigest: row.requestDigest,
    revision: dashboardRevision(row.acknowledgedRevision),
    acknowledgedAt: timestamp(acknowledgedAt),
  };
}

function acknowledgementFromReceipt(
  proof: DashboardProofValues,
  requestId: string,
  receipt: DashboardWriteReceiptRow,
): DashboardWriteAcknowledgement {
  if (!isAccountWorkspaceId(proof.userId) || !isRequestId(requestId)) {
    throw new PersistenceError('FAILED');
  }
  const validated = validateReceiptRow(receipt, proof.userId, requestId);
  if (!isNonZeroRevision(validated.revision) || !isTimestamp(validated.acknowledgedAt)) {
    throw new PersistenceError('FAILED');
  }
  return {
    transportVersion: DASHBOARD_TRANSPORT_VERSION,
    accountWorkspaceId: proof.userId,
    requestId,
    revision: validated.revision,
    updatedAt: validated.acknowledgedAt,
  };
}

function acknowledgement(
  proof: DashboardProofValues,
  requestId: string,
  revision: bigint,
  at: Date,
): DashboardWriteAcknowledgement {
  if (!isAccountWorkspaceId(proof.userId) || !isRequestId(requestId)) {
    throw new PersistenceError('FAILED');
  }
  const validatedRevision = dashboardRevision(revision);
  const updatedAt = timestamp(at);
  if (!isNonZeroRevision(validatedRevision) || !isTimestamp(updatedAt)) {
    throw new PersistenceError('FAILED');
  }
  return {
    transportVersion: DASHBOARD_TRANSPORT_VERSION,
    accountWorkspaceId: proof.userId,
    requestId,
    revision: validatedRevision,
    updatedAt,
  };
}

function dashboardReadResponse(
  proof: DashboardProofValues,
  row: CloudDashboardRow | undefined,
): DashboardReadResponse {
  if (!isAccountWorkspaceId(proof.userId)) {
    throw new PersistenceError('FAILED');
  }
  if (row === undefined) {
    return {
      transportVersion: DASHBOARD_TRANSPORT_VERSION,
      accountWorkspaceId: proof.userId,
      catalogueVersion: defaultCatalogue.version,
      revision: '0',
      dashboard: null,
      updatedAt: null,
    };
  }
  const validated = validateCloudDashboardRow(row, proof.userId);
  const revision = dashboardRevision(validated.revision);
  const updatedAt = timestamp(validated.updatedAt);
  if (!isNonZeroRevision(revision) || !isTimestamp(updatedAt)) {
    throw new PersistenceError('FAILED');
  }
  const response = defaultCatalogue.validateRead(
    {
      transportVersion: DASHBOARD_TRANSPORT_VERSION,
      accountWorkspaceId: proof.userId,
      catalogueVersion: validated.catalogueDigest,
      revision,
      dashboard: validated.dashboard,
      updatedAt,
    },
    proof.userId,
  );
  if (response === null) throw new PersistenceError('FAILED');
  return response;
}

function assertActiveSession(row: SessionRow, at: Date): void {
  if (
    row.createdAt.getTime() > at.getTime() ||
    row.revokedAt !== null ||
    row.idleExpiresAt.getTime() <= at.getTime() ||
    row.absoluteExpiresAt.getTime() <= at.getTime()
  ) {
    throw new DashboardAuthorizationFailure();
  }
}

function nextIdleDeadline(at: Date, absoluteExpiresAt: Date): Date {
  const deadline = Math.min(at.getTime() + SESSION_IDLE_LIFETIME_MS, absoluteExpiresAt.getTime());
  return new Date(deadline);
}

function zeroRevision(): Revision {
  const value = '0';
  if (isRevision(value)) {
    return value;
  }
  throw new PersistenceError('FAILED');
}

function dashboardReadFailure(error: unknown): DashboardReadOutcome {
  if (error instanceof DashboardAuthorizationFailure) {
    return { status: 'unauthenticated' };
  }
  return { status: 'unavailable' };
}

function dashboardWriteFailure(error: unknown): DashboardWriteOutcome {
  if (error instanceof DashboardAuthorizationFailure) {
    return { status: 'unauthenticated' };
  }
  if (error instanceof DashboardWorkspaceMismatch) {
    return { status: 'workspace-mismatch' };
  }
  return { status: 'unavailable' };
}

export interface PostgresDashboardPersistenceDependencies {
  readonly database: PersistenceDatabase;
  readonly clock: PersistenceClock;
  readonly runTransaction: PersistenceTransactionRunner;
}

export function createPostgresDashboardPersistence(
  dependencies: PostgresDashboardPersistenceDependencies,
): DashboardPersistence {
  const { database, clock, runTransaction } = dependencies;

  return {
    read: async (proof: SessionAuthorizationProof): Promise<DashboardReadOutcome> => {
      try {
        const values = dashboardProofValues(proof, false);
        const sessions = await database
          .select()
          .from(applicationSessions)
          .where(
            and(
              eq(applicationSessions.id, values.sessionId),
              eq(applicationSessions.userId, values.userId),
              eq(applicationSessions.sessionTokenHash, values.sessionTokenHash),
            ),
          )
          .limit(1);
        const session = sessions[0];
        if (session === undefined) {
          throw new DashboardAuthorizationFailure();
        }
        // Reads never touch activity, but they revalidate after their database
        // round trip so a session cannot expire while the query is waiting.
        assertActiveSession(session, validateDate(clock()));
        const dashboardsForUser = await database
          .select()
          .from(cloudDashboards)
          .where(eq(cloudDashboards.userId, values.userId))
          .limit(1);
        return {
          status: 'read',
          response: dashboardReadResponse(values, dashboardsForUser[0]),
        };
      } catch (error) {
        return dashboardReadFailure(error);
      }
    },

    compareAndWrite: async (
      proof: SessionAuthorizationProof,
      intent: ValidatedDashboardWrite,
      isCatalogueCompatible: (value: ValidatedDashboardWrite) => boolean,
    ): Promise<DashboardWriteOutcome> => {
      let values: DashboardProofValues;
      let validatedIntent: ValidatedDashboardWrite;
      try {
        values = dashboardProofValues(proof, true);
        // ValidatedDashboardWrite is the strict transport-codec boundary. Consume
        // its canonical fields directly; SQL does not reimplement that codec.
        validatedIntent = intent;
      } catch (error) {
        return dashboardWriteFailure(error);
      }
      const csrfTokenHash = values.csrfTokenHash;
      if (csrfTokenHash === undefined) {
        return { status: 'unauthenticated' };
      }

      try {
        return await runTransaction(
          async (transaction): Promise<DashboardWriteOutcome> => {
            // All account mutations lock the user before sessions and adoption.
            // That shared first lock serializes this account's dashboard and
            // receipt work with adoption and callback mutations.
            const lockedUsers = await transaction
              .select()
              .from(users)
              .where(eq(users.id, values.userId))
              .limit(1)
              .for('no key update');
            const user = lockedUsers[0];
            if (user === undefined || user.id !== values.userId) {
              throw new DashboardAuthorizationFailure();
            }
            const lockedSessions = await transaction
              .select()
              .from(applicationSessions)
              .where(
                and(
                  eq(applicationSessions.id, values.sessionId),
                  eq(applicationSessions.userId, values.userId),
                  eq(applicationSessions.sessionTokenHash, values.sessionTokenHash),
                  eq(applicationSessions.csrfTokenHash, csrfTokenHash),
                ),
              )
              .limit(1)
              .for('update');
            const session = lockedSessions[0];
            if (session === undefined) {
              throw new DashboardAuthorizationFailure();
            }
            // Clock reads after each lock close the expiry window introduced by
            // waiting for the account and session rows.
            assertActiveSession(session, validateDate(clock()));
            if (validatedIntent.request.expectedAccountWorkspaceId !== session.userId) {
              throw new DashboardWorkspaceMismatch();
            }

            const adoptionRows = await transaction
              .select()
              .from(accountAdoptions)
              .where(eq(accountAdoptions.userId, user.id))
              .limit(1)
              .for('update');
            const adoption = adoptionRows[0];
            let pendingAdoption = adoption?.state === 'pending';
            const normalizeAdoption = async (at: Date): Promise<void> => {
              if (!pendingAdoption || adoption === undefined) return;
              const updatedAt = new Date(Math.max(at.getTime(), adoption.updatedAt.getTime()));
              const normalized = await transaction
                .update(accountAdoptions)
                .set({ state: 'unavailable', creatingSessionId: null, updatedAt })
                .where(
                  and(eq(accountAdoptions.userId, user.id), eq(accountAdoptions.state, 'pending')),
                )
                .returning({ userId: accountAdoptions.userId });
              if (normalized.length !== 1) throw new PersistenceError('CONFLICT');
              pendingAdoption = false;
            };
            if (
              pendingAdoption &&
              adoption?.creatingSessionId !== undefined &&
              adoption.creatingSessionId !== null
            ) {
              const creators = await transaction
                .select()
                .from(applicationSessions)
                .where(
                  and(
                    eq(applicationSessions.id, adoption.creatingSessionId),
                    eq(applicationSessions.userId, user.id),
                  ),
                )
                .limit(1);
              const creator = creators[0];
              const existingCloud = await transaction
                .select({ userId: cloudDashboards.userId })
                .from(cloudDashboards)
                .where(eq(cloudDashboards.userId, user.id))
                .limit(1);
              const at = validateDate(clock());
              // Normalize expired/revoked capability even if this mutation is
              // later rejected. A still-eligible capability is consumed only
              // together with a successful ordinary dashboard write.
              if (
                existingCloud[0] !== undefined ||
                creator === undefined ||
                creator.revokedAt !== null ||
                creator.createdAt > at ||
                creator.idleExpiresAt <= at ||
                creator.absoluteExpiresAt <= at
              ) {
                await normalizeAdoption(at);
              }
            }

            // Request IDs are looked up before revision comparison and cleanup.
            const retainedReceipts = await transaction
              .select()
              .from(dashboardWriteReceipts)
              .where(
                and(
                  eq(dashboardWriteReceipts.userId, user.id),
                  eq(dashboardWriteReceipts.requestId, validatedIntent.request.requestId),
                ),
              )
              .limit(1)
              .for('update');
            const retainedReceipt = retainedReceipts[0];
            // Receipt locks can also wait. Replays have no final activity touch,
            // so revalidate expiry here before any retained-receipt outcome.
            assertActiveSession(session, validateDate(clock()));
            if (retainedReceipt !== undefined) {
              const receipt = validateReceiptRow(
                retainedReceipt,
                user.id,
                validatedIntent.request.requestId,
              );
              if (receipt.requestDigest === validatedIntent.requestDigest) {
                return {
                  status: 'replayed',
                  acknowledgement: acknowledgementFromReceipt(
                    values,
                    validatedIntent.request.requestId,
                    retainedReceipt,
                  ),
                };
              }
              return { status: 'request-id-reused' };
            }

            let compatible: boolean;
            try {
              compatible = isCatalogueCompatible(validatedIntent);
            } catch {
              throw new PersistenceError('FAILED');
            }
            if (!compatible) {
              return { status: 'catalogue-incompatible' };
            }

            const storedDashboards = await transaction
              .select()
              .from(cloudDashboards)
              .where(eq(cloudDashboards.userId, user.id))
              .limit(1)
              .for('update');
            const storedDashboard = storedDashboards[0];
            const validatedStored =
              storedDashboard === undefined
                ? undefined
                : validateCloudDashboardRow(storedDashboard, user.id);
            const currentRevision = validatedStored?.revision ?? 0n;
            if (currentRevision > 0n) await normalizeAdoption(validateDate(clock()));
            const expectedRevision = BigInt(validatedIntent.request.expectedRevision);
            if (currentRevision !== expectedRevision) {
              const current =
                currentRevision === 0n ? zeroRevision() : dashboardRevision(currentRevision);
              return { status: 'revision-conflict', currentRevision: current };
            }
            if (currentRevision >= MAX_REVISION_BIGINT) {
              throw new PersistenceError('FAILED');
            }
            let nextRevision: bigint;

            // The compatibility callback is application code and may be slow;
            // revalidate the locked session immediately before mutation.
            const mutationAt = validateDate(clock());
            assertActiveSession(session, mutationAt);
            const updatedAt =
              validatedStored === undefined ||
              mutationAt.getTime() >= validatedStored.updatedAt.getTime()
                ? mutationAt
                : validatedStored.updatedAt;

            if (storedDashboard === undefined) {
              nextRevision = 1n;
              const inserted = await transaction
                .insert(cloudDashboards)
                .values({
                  userId: user.id,
                  revision: nextRevision,
                  transportVersion: DASHBOARD_TRANSPORT_VERSION,
                  catalogueDigest: validatedIntent.request.catalogueVersion,
                  dashboardJson: validatedIntent.canonicalDashboardJson,
                  createdAt: updatedAt,
                  updatedAt,
                })
                .returning({ userId: cloudDashboards.userId });
              if (inserted.length !== 1) {
                throw new PersistenceError('FAILED');
              }
            } else {
              const updated = await transaction
                .update(cloudDashboards)
                .set({
                  // Keep the increment in PostgreSQL's bigint domain. The
                  // checked current revision is used only for the compare
                  // predicate; JavaScript never narrows it to a number.
                  revision: sql`${cloudDashboards.revision} + 1`,
                  transportVersion: DASHBOARD_TRANSPORT_VERSION,
                  catalogueDigest: validatedIntent.request.catalogueVersion,
                  dashboardJson: validatedIntent.canonicalDashboardJson,
                  updatedAt,
                })
                .where(
                  and(
                    eq(cloudDashboards.userId, user.id),
                    eq(cloudDashboards.revision, expectedRevision),
                  ),
                )
                .returning({
                  userId: cloudDashboards.userId,
                  revision: cloudDashboards.revision,
                });
              if (updated.length !== 1) {
                throw new PersistenceError('CONFLICT');
              }
              const updatedRow = updated[0];
              if (updatedRow === undefined || typeof updatedRow.revision !== 'bigint') {
                throw new PersistenceError('FAILED');
              }
              nextRevision = updatedRow.revision;
            }

            await normalizeAdoption(mutationAt);

            await transaction.insert(dashboardWriteReceipts).values({
              userId: user.id,
              requestId: validatedIntent.request.requestId,
              requestDigest: validatedIntent.requestDigest,
              acknowledgedRevision: nextRevision,
              acknowledgedAt: updatedAt,
              createdAt: updatedAt,
            });

            const cleanupAt = validateDate(clock());
            const cleanupCutoff = new Date(cleanupAt.getTime() - DASHBOARD_RECEIPT_CLEANUP_AGE_MS);
            await transaction
              .delete(dashboardWriteReceipts)
              .where(
                and(
                  eq(dashboardWriteReceipts.userId, user.id),
                  lte(dashboardWriteReceipts.createdAt, cleanupCutoff),
                ),
              );

            // Keep the newest 1,024 revisions. The user lock and deterministic
            // ordering make concurrent capacity writes serial and stable.
            await transaction.execute(sql`
              WITH excess AS (
                SELECT ${dashboardWriteReceipts.requestId}
                FROM ${dashboardWriteReceipts}
                WHERE ${dashboardWriteReceipts.userId} = ${user.id}
                ORDER BY ${dashboardWriteReceipts.acknowledgedRevision} DESC,
                  ${dashboardWriteReceipts.requestId} DESC
                OFFSET ${MAX_DASHBOARD_RECEIPTS_PER_ACCOUNT}
              )
              DELETE FROM ${dashboardWriteReceipts} AS receipts
              USING excess
              WHERE receipts.user_id = ${user.id}
                AND receipts.request_id = excess.request_id
            `);

            const touchAt = validateDate(clock());
            assertActiveSession(session, touchAt);
            const idleExpiresAt = nextIdleDeadline(touchAt, session.absoluteExpiresAt);
            const touched = await touchSessionInDatabase(transaction, {
              sessionId: session.id,
              userId: user.id,
              at: touchAt,
              idleExpiresAt,
            });
            if (touched === null) {
              throw new DashboardAuthorizationFailure();
            }

            return {
              status: 'written',
              acknowledgement: acknowledgement(
                values,
                validatedIntent.request.requestId,
                nextRevision,
                updatedAt,
              ),
            };
          },
          { dashboardWrite: true },
        );
      } catch (error) {
        return dashboardWriteFailure(error);
      }
    },
  };
}
