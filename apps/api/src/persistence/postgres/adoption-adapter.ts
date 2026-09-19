/**
 * PostgreSQL adoption capability and terminal receipt persistence.
 *
 * Account writes use the same lock order as dashboard writes: account row,
 * current session, adoption row, then dashboard/receipt rows. Pending state is
 * normalized only by authenticated mutations; session inspection remains
 * read-only and computes eligibility from the creating session and revision.
 */
import { and, eq } from 'drizzle-orm';

import { SESSION_IDLE_LIFETIME_MS } from '../../auth/contracts.js';
import {
  type AdoptionDecisionInput,
  type AdoptionDecisionOutcome,
  type AdoptionStatus,
  type AdoptionStatusInput,
  PersistenceError,
  type PersistenceClock,
  type Sha256Hash,
} from '../contracts.js';
import {
  MAX_DASHBOARD_REQUEST_BYTES,
  MAX_REVISION,
  type DashboardWriteAcknowledgement,
  type NonZeroRevision,
  type Revision,
  type Timestamp,
} from '../../dashboard/contracts.js';
import { hashCanonicalJson } from '../../dashboard/canonicalization.js';
import {
  createDashboardCatalogue,
  isAccountWorkspaceId,
  isNonZeroRevision,
  isRequestId,
  isRevision,
  isTimestamp,
  type ValidatedDashboardWrite,
} from '../../dashboard/validation.js';
import { parseStrictJsonText } from '../../dashboard/request-body.js';
import { parseDashboardPersistenceV10 } from '@kendo-menu/domain/dashboard-persistence';

import {
  accountAdoptions,
  applicationSessions,
  cloudDashboards,
  dashboardWriteReceipts,
  users,
} from '../schema.js';
import { validateDate, validateSha256Hash, validateUuid } from '../validation.js';
import type { PersistenceDatabase, PersistenceTransactionRunner } from './session-sql.js';
import { touchSessionInDatabase } from './session-sql.js';

const ADOPTION_TRANSPORT_VERSION = 1;
const MAX_REVISION_BIGINT = BigInt(MAX_REVISION);
const defaultDashboardCatalogue = createDashboardCatalogue();

type AdoptionRow = typeof accountAdoptions.$inferSelect;
type SessionRow = typeof applicationSessions.$inferSelect;
type DashboardRow = typeof cloudDashboards.$inferSelect;

class AdoptionAuthorizationFailure extends Error {
  constructor() {
    super('Adoption authorization failed');
    this.name = 'AdoptionAuthorizationFailure';
  }
}

class AdoptionWorkspaceMismatch extends Error {
  constructor() {
    super('Adoption workspace does not match');
    this.name = 'AdoptionWorkspaceMismatch';
  }
}

interface ProofValues {
  readonly userId: string;
  readonly sessionId: string;
  readonly sessionTokenHash: string;
  readonly csrfTokenHash?: string;
}

function ownValue(value: object, property: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, property);
  if (descriptor === undefined || !('value' in descriptor)) return undefined;
  return descriptor.value;
}

function proofValues(proof: unknown, requireCsrf: boolean): ProofValues {
  if (typeof proof !== 'object' || proof === null) {
    throw new AdoptionAuthorizationFailure();
  }
  try {
    const userId = validateUuid(ownValue(proof, 'userId'));
    const sessionId = validateUuid(ownValue(proof, 'sessionId'));
    const sessionTokenHash = validateSha256Hash(ownValue(proof, 'sessionTokenHash'));
    const csrfValue = ownValue(proof, 'csrfTokenHash');
    if (requireCsrf && csrfValue === undefined) throw new AdoptionAuthorizationFailure();
    const csrfTokenHash = csrfValue === undefined ? undefined : validateSha256Hash(csrfValue);
    return {
      userId,
      sessionId,
      sessionTokenHash,
      ...(csrfTokenHash === undefined ? {} : { csrfTokenHash }),
    };
  } catch (error) {
    if (error instanceof AdoptionAuthorizationFailure) throw error;
    throw new AdoptionAuthorizationFailure();
  }
}

function validTimestamp(value: Date): Timestamp {
  const result = value.toISOString();
  if (!isTimestamp(result)) throw new PersistenceError('FAILED');
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validRevision(value: bigint): NonZeroRevision {
  if (value <= 0n || value > MAX_REVISION_BIGINT) throw new PersistenceError('FAILED');
  const revision = String(value);
  if (!isNonZeroRevision(revision)) throw new PersistenceError('FAILED');
  return revision;
}

function zeroOrPositiveRevision(value: bigint): Revision {
  if (value < 0n || value > MAX_REVISION_BIGINT) throw new PersistenceError('FAILED');
  const revision = String(value);
  if (!isRevision(revision)) throw new PersistenceError('FAILED');
  return revision;
}

function assertActiveSession(row: SessionRow, at: Date): void {
  if (
    row.createdAt.getTime() > at.getTime() ||
    row.revokedAt !== null ||
    row.idleExpiresAt.getTime() <= at.getTime() ||
    row.absoluteExpiresAt.getTime() <= at.getTime()
  ) {
    throw new AdoptionAuthorizationFailure();
  }
}

function nextIdleDeadline(at: Date, absoluteExpiresAt: Date): Date {
  return new Date(Math.min(at.getTime() + SESSION_IDLE_LIFETIME_MS, absoluteExpiresAt.getTime()));
}

function mapTerminalStatus(row: AdoptionRow): AdoptionStatus {
  const createdAt = validateDate(row.createdAt);
  const updatedAt = validateDate(row.updatedAt);
  if (updatedAt.getTime() < createdAt.getTime()) throw new PersistenceError('FAILED');
  if (row.state === 'accepted') {
    if (
      row.creatingSessionId !== null ||
      row.decision !== 'yes' ||
      row.requestId === null ||
      !isRequestId(row.requestId) ||
      row.requestDigest === null ||
      !/^[0-9a-f]{64}$/u.test(row.requestDigest) ||
      row.acknowledgedRevision === null ||
      typeof row.acknowledgedRevision !== 'bigint' ||
      row.acknowledgedAt === null
    ) {
      throw new PersistenceError('FAILED');
    }
    const revision = validRevision(row.acknowledgedRevision);
    const timestamp = validateDate(row.acknowledgedAt);
    return {
      status: 'accepted',
      capability: false,
      completion: {
        decision: 'yes',
        requestId: row.requestId,
        acknowledgedRevision: revision,
        timestamp,
      },
    };
  }
  if (row.state === 'declined') {
    if (
      row.creatingSessionId !== null ||
      row.decision !== 'no' ||
      row.requestId === null ||
      !isRequestId(row.requestId) ||
      row.requestDigest === null ||
      !/^[0-9a-f]{64}$/u.test(row.requestDigest) ||
      row.acknowledgedRevision !== null ||
      row.acknowledgedAt !== null
    ) {
      throw new PersistenceError('FAILED');
    }
    return {
      status: 'declined',
      capability: false,
      completion: { decision: 'no', requestId: row.requestId },
    };
  }
  if (row.state !== 'pending' && row.state !== 'unavailable') {
    throw new PersistenceError('FAILED');
  }
  if (
    row.decision !== null ||
    row.requestId !== null ||
    row.requestDigest !== null ||
    row.acknowledgedRevision !== null ||
    row.acknowledgedAt !== null
  ) {
    throw new PersistenceError('FAILED');
  }
  if (row.state === 'pending' && row.creatingSessionId === null) {
    throw new PersistenceError('FAILED');
  }
  if (row.state === 'unavailable' && row.creatingSessionId !== null) {
    throw new PersistenceError('FAILED');
  }
  return { status: row.state, capability: false };
}

function dashboardRevision(row: DashboardRow): bigint {
  if (
    row.transportVersion !== ADOPTION_TRANSPORT_VERSION ||
    typeof row.revision !== 'bigint' ||
    row.revision <= 0n ||
    row.revision > MAX_REVISION_BIGINT ||
    !/^[0-9a-f]{64}$/u.test(row.catalogueDigest) ||
    Buffer.byteLength(row.dashboardJson, 'utf8') > MAX_DASHBOARD_REQUEST_BYTES
  ) {
    throw new PersistenceError('FAILED');
  }
  try {
    const parsed = parseStrictJsonText(row.dashboardJson);
    const record = isRecord(parsed) ? parsed : undefined;
    if (
      record === undefined ||
      !Object.hasOwn(record, 'version') ||
      !Object.hasOwn(record, 'state') ||
      record['version'] !== 10 ||
      parseDashboardPersistenceV10(record['state']) === null
    ) {
      throw new PersistenceError('FAILED');
    }
  } catch (error) {
    if (error instanceof PersistenceError) throw error;
    throw new PersistenceError('FAILED');
  }
  return row.revision;
}

function requestDigestForYes(intent: ValidatedDashboardWrite): Sha256Hash {
  const digest = hashCanonicalJson({ decision: 'yes', ...intent.request });
  if (!/^[0-9a-f]{64}$/u.test(digest)) throw new PersistenceError('FAILED');
  return digest;
}

function acknowledgement(
  userId: string,
  requestId: string,
  revision: bigint,
  at: Date,
): DashboardWriteAcknowledgement {
  if (!isAccountWorkspaceId(userId) || !isRequestId(requestId)) {
    throw new PersistenceError('FAILED');
  }
  const validatedRevision = validRevision(revision);
  const updatedAt = validTimestamp(at);
  return {
    transportVersion: ADOPTION_TRANSPORT_VERSION,
    accountWorkspaceId: userId,
    requestId,
    revision: validatedRevision,
    updatedAt,
  };
}

function terminalAcknowledgement(userId: string, row: AdoptionRow): DashboardWriteAcknowledgement {
  if (row.requestId === null || row.acknowledgedRevision === null || row.acknowledgedAt === null) {
    throw new PersistenceError('FAILED');
  }
  return acknowledgement(
    userId,
    row.requestId,
    row.acknowledgedRevision,
    validateDate(row.acknowledgedAt),
  );
}

function normalizePending(
  transaction: PersistenceDatabase,
  userId: string,
  row: AdoptionRow,
  at: Date,
): Promise<void> {
  const updatedAt = new Date(Math.max(at.getTime(), row.updatedAt.getTime()));
  return transaction
    .update(accountAdoptions)
    .set({ state: 'unavailable', creatingSessionId: null, updatedAt })
    .where(and(eq(accountAdoptions.userId, userId), eq(accountAdoptions.state, 'pending')))
    .returning({ userId: accountAdoptions.userId })
    .then((rows) => {
      if (rows.length !== 1) throw new PersistenceError('CONFLICT');
    });
}

function adoptionFailure(error: unknown): AdoptionDecisionOutcome {
  if (error instanceof AdoptionAuthorizationFailure) return { status: 'unauthenticated' };
  if (error instanceof AdoptionWorkspaceMismatch) return { status: 'workspace-mismatch' };
  if (error instanceof PersistenceError && error.code === 'UNAVAILABLE') {
    return { status: 'unavailable' };
  }
  return { status: 'unavailable' };
}

export interface PostgresAdoptionPersistenceDependencies {
  readonly database: PersistenceDatabase;
  readonly clock: PersistenceClock;
  readonly runTransaction: PersistenceTransactionRunner;
}

export function createPostgresAdoptionPersistence(
  dependencies: PostgresAdoptionPersistenceDependencies,
): {
  getStatus(input: AdoptionStatusInput): Promise<AdoptionStatus>;
  decide(input: AdoptionDecisionInput & AdoptionStatusInput): Promise<AdoptionDecisionOutcome>;
} {
  const { database, clock, runTransaction } = dependencies;

  return {
    getStatus: async (input): Promise<AdoptionStatus> => {
      try {
        const userId = validateUuid(input.userId);
        const sessionId = validateUuid(input.sessionId);
        const sessionTokenHash = validateSha256Hash(input.sessionTokenHash);
        const rows = await database
          .select()
          .from(accountAdoptions)
          .where(eq(accountAdoptions.userId, userId))
          .limit(1);
        const row = rows[0];
        if (row === undefined) return { status: 'unavailable', capability: false };
        const state = mapTerminalStatus(row);
        if (state.status !== 'pending') return state;
        if (row.creatingSessionId === null) throw new PersistenceError('FAILED');
        const creatingRows = await database
          .select()
          .from(applicationSessions)
          .where(
            and(
              eq(applicationSessions.id, row.creatingSessionId),
              eq(applicationSessions.userId, userId),
            ),
          )
          .limit(1);
        const creatingSession = creatingRows[0];
        if (creatingSession === undefined) return { status: 'unavailable', capability: false };

        const dashboards = await database
          .select()
          .from(cloudDashboards)
          .where(eq(cloudDashboards.userId, userId))
          .limit(1);
        const stored = dashboards[0];
        if (stored !== undefined) {
          dashboardRevision(stored);
          return { status: 'unavailable', capability: false };
        }
        // Reads remain side-effect free, but expiry is evaluated after all
        // database round trips so waiting cannot expose an expired capability.
        const at = validateDate(clock());
        const sessionActive =
          creatingSession.createdAt.getTime() <= at.getTime() &&
          creatingSession.revokedAt === null &&
          creatingSession.idleExpiresAt.getTime() > at.getTime() &&
          creatingSession.absoluteExpiresAt.getTime() > at.getTime();
        if (!sessionActive) return { status: 'unavailable', capability: false };

        const capability =
          creatingSession.id === sessionId && creatingSession.sessionTokenHash === sessionTokenHash;
        return { status: 'pending', capability };
      } catch (error) {
        if (error instanceof PersistenceError) throw error;
        throw new PersistenceError('FAILED');
      }
    },

    decide: async (
      input,
      isCatalogueCompatible = (intent: ValidatedDashboardWrite) =>
        defaultDashboardCatalogue.isCompatible(intent),
    ): Promise<AdoptionDecisionOutcome> => {
      let values: ProofValues;
      try {
        values = proofValues(input, true);
        const expectedWorkspace = validateUuid(input.expectedAccountWorkspaceId);
        if (expectedWorkspace !== values.userId) throw new AdoptionWorkspaceMismatch();
      } catch (error) {
        return adoptionFailure(error);
      }
      const csrfTokenHash = values.csrfTokenHash;
      if (csrfTokenHash === undefined) return { status: 'unauthenticated' };

      let requestId: string;
      let requestDigest: Sha256Hash;
      let dashboardIntent: ValidatedDashboardWrite | undefined;
      try {
        if (input.decision === 'yes') {
          requestId = input.intent.request.requestId;
          requestDigest = requestDigestForYes(input.intent);
          dashboardIntent = input.intent;
          if (
            input.intent.request.expectedAccountWorkspaceId !== values.userId ||
            input.intent.request.expectedRevision !== '0'
          ) {
            throw new AdoptionWorkspaceMismatch();
          }
        } else {
          requestId = input.requestId;
          requestDigest = validateSha256Hash(input.requestDigest);
        }
        if (!isRequestId(requestId)) throw new PersistenceError('INVALID_INPUT');
      } catch (error) {
        return adoptionFailure(error);
      }

      try {
        return await runTransaction(
          async (transaction): Promise<AdoptionDecisionOutcome> => {
            const lockedUsers = await transaction
              .select()
              .from(users)
              .where(eq(users.id, values.userId))
              .limit(1)
              .for('no key update');
            if (lockedUsers[0] === undefined) throw new AdoptionAuthorizationFailure();

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
            if (session === undefined) throw new AdoptionAuthorizationFailure();
            const at = validateDate(clock());
            assertActiveSession(session, at);

            const adoptionRows = await transaction
              .select()
              .from(accountAdoptions)
              .where(eq(accountAdoptions.userId, values.userId))
              .limit(1)
              .for('update');
            assertActiveSession(session, validateDate(clock()));
            const adoption = adoptionRows[0];
            if (adoption === undefined) return { status: 'ineligible' };
            const currentStatus = mapTerminalStatus(adoption);

            if (currentStatus.status === 'accepted' || currentStatus.status === 'declined') {
              if (adoption.requestId === requestId) {
                if (adoption.requestDigest !== requestDigest)
                  return { status: 'request-id-reused' };
                if (currentStatus.status === 'accepted' && input.decision === 'yes') {
                  return {
                    status: 'replayed',
                    completion: {
                      ...currentStatus.completion,
                      timestamp: new Date(currentStatus.completion.timestamp.getTime()),
                    },
                    acknowledgement: terminalAcknowledgement(values.userId, adoption),
                  };
                }
                if (currentStatus.status === 'declined' && input.decision === 'no') {
                  return {
                    status: 'replayed-declined',
                    completion: { decision: 'no', requestId },
                  };
                }
                return { status: 'request-id-reused' };
              }
              return { status: 'decision-conflict' };
            }
            if (currentStatus.status === 'unavailable') return { status: 'ineligible' };
            if (adoption.creatingSessionId === null) throw new PersistenceError('FAILED');

            let creatingSession = session;
            if (adoption.creatingSessionId !== session.id) {
              const rows = await transaction
                .select()
                .from(applicationSessions)
                .where(
                  and(
                    eq(applicationSessions.id, adoption.creatingSessionId),
                    eq(applicationSessions.userId, values.userId),
                  ),
                )
                .limit(1)
                .for('update');
              const row = rows[0];
              if (row === undefined) {
                await normalizePending(transaction, values.userId, adoption, at);
                return { status: 'capability-unavailable' };
              }
              creatingSession = row;
            }
            const creatingActive =
              creatingSession.createdAt.getTime() <= at.getTime() &&
              creatingSession.revokedAt === null &&
              creatingSession.idleExpiresAt.getTime() > at.getTime() &&
              creatingSession.absoluteExpiresAt.getTime() > at.getTime();
            if (!creatingActive || creatingSession.id !== session.id) {
              if (!creatingActive) await normalizePending(transaction, values.userId, adoption, at);
              return { status: 'capability-unavailable' };
            }

            const dashboards = await transaction
              .select()
              .from(cloudDashboards)
              .where(eq(cloudDashboards.userId, values.userId))
              .limit(1)
              .for('update');
            const storedDashboard = dashboards[0];
            if (storedDashboard !== undefined) {
              const currentRevision = dashboardRevision(storedDashboard);
              await normalizePending(transaction, values.userId, adoption, at);
              return {
                status: 'revision-conflict',
                currentRevision: zeroOrPositiveRevision(currentRevision),
              };
            }

            if (input.decision === 'yes') {
              if (dashboardIntent === undefined) throw new PersistenceError('FAILED');
              let compatible: boolean;
              try {
                // The callback is intentionally invoked only after receipt and
                // capability checks, matching ordinary dashboard writes.
                compatible = isCatalogueCompatible(dashboardIntent);
              } catch {
                throw new PersistenceError('FAILED');
              }
              if (!compatible) return { status: 'catalogue-incompatible' };
              const mutationAt = validateDate(clock());
              assertActiveSession(session, mutationAt);
              const inserted = await transaction
                .insert(cloudDashboards)
                .values({
                  userId: values.userId,
                  revision: 1n,
                  transportVersion: ADOPTION_TRANSPORT_VERSION,
                  catalogueDigest: dashboardIntent.request.catalogueVersion,
                  dashboardJson: dashboardIntent.canonicalDashboardJson,
                  createdAt: mutationAt,
                  updatedAt: mutationAt,
                })
                .returning({ userId: cloudDashboards.userId });
              if (inserted.length !== 1) throw new PersistenceError('FAILED');
              await transaction.insert(dashboardWriteReceipts).values({
                userId: values.userId,
                requestId,
                requestDigest,
                acknowledgedRevision: 1n,
                acknowledgedAt: mutationAt,
                createdAt: mutationAt,
              });
              const updated = await transaction
                .update(accountAdoptions)
                .set({
                  state: 'accepted',
                  creatingSessionId: null,
                  decision: 'yes',
                  requestId,
                  requestDigest,
                  acknowledgedRevision: 1n,
                  acknowledgedAt: mutationAt,
                  updatedAt: mutationAt,
                })
                .where(eq(accountAdoptions.userId, values.userId))
                .returning({ userId: accountAdoptions.userId });
              if (updated.length !== 1) throw new PersistenceError('FAILED');
              const touchAt = validateDate(clock());
              assertActiveSession(session, touchAt);
              const touched = await touchSessionInDatabase(transaction, {
                sessionId: session.id,
                userId: values.userId,
                at: touchAt,
                idleExpiresAt: nextIdleDeadline(touchAt, session.absoluteExpiresAt),
              });
              if (touched === null) throw new AdoptionAuthorizationFailure();
              assertActiveSession(touched, validateDate(clock()));
              return {
                status: 'accepted',
                completion: {
                  decision: 'yes',
                  requestId,
                  acknowledgedRevision: validRevision(1n),
                  timestamp: new Date(mutationAt.getTime()),
                },
                acknowledgement: acknowledgement(values.userId, requestId, 1n, mutationAt),
              };
            }

            const mutationAt = validateDate(clock());
            assertActiveSession(session, mutationAt);
            const updated = await transaction
              .update(accountAdoptions)
              .set({
                state: 'declined',
                creatingSessionId: null,
                decision: 'no',
                requestId,
                requestDigest,
                acknowledgedRevision: null,
                acknowledgedAt: null,
                updatedAt: mutationAt,
              })
              .where(eq(accountAdoptions.userId, values.userId))
              .returning({ userId: accountAdoptions.userId });
            if (updated.length !== 1) throw new PersistenceError('FAILED');
            const touchAt = validateDate(clock());
            assertActiveSession(session, touchAt);
            const touched = await touchSessionInDatabase(transaction, {
              sessionId: session.id,
              userId: values.userId,
              at: touchAt,
              idleExpiresAt: nextIdleDeadline(touchAt, session.absoluteExpiresAt),
            });
            if (touched === null) throw new AdoptionAuthorizationFailure();
            assertActiveSession(touched, validateDate(clock()));
            return { status: 'declined', completion: { decision: 'no', requestId } };
          },
          { dashboardWrite: true },
        );
      } catch (error) {
        return adoptionFailure(error);
      }
    },
  };
}
