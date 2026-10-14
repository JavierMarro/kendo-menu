/**
 * PostgreSQL adapter for protected canonical dashboard snapshots and idempotent writes.
 * It revalidates the account proof and stored v10 data, then locks the account before changing
 * receipts or dashboard state.
 * Retained receipts are checked before revision and catalogue state so valid retries keep their
 * original acknowledgement.
 */
import { and, eq, isNull, lte, sql } from 'drizzle-orm';

import type { AccountAuthorizationProof } from '../../auth/account-authorization.js';
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
import { validateDate, validateUuid } from '../validation.js';
import {
  accountCopyOpportunities,
  cloudDashboards,
  dashboardWriteReceipts,
  users,
} from '../schema.js';
import type { PersistenceDatabase, PersistenceTransactionRunner } from './transaction.js';

const TRANSPORT_VERSION = 1;
const MAX_REVISION_BIGINT = BigInt(MAX_REVISION);
const catalogue = createDashboardCatalogue();
type SnapshotRow = typeof cloudDashboards.$inferSelect;
type ReceiptRow = typeof dashboardWriteReceipts.$inferSelect;

interface ProofValues {
  readonly accountId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly expiresAt: number;
}

class Unauthorized extends Error {}
class WorkspaceMismatch extends Error {}

function readOwn(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function proofValues(value: unknown): ProofValues {
  if (typeof value !== 'object' || value === null) throw new Unauthorized();
  const accountId = validateUuid(readOwn(value, 'accountId'));
  const provider = readOwn(value, 'provider');
  const issuer = readOwn(value, 'issuer');
  const subject = readOwn(value, 'subject');
  const expiresAt = readOwn(value, 'expiresAt');
  if (
    provider !== 'neon' ||
    typeof issuer !== 'string' ||
    issuer.length === 0 ||
    issuer.length > 512 ||
    typeof subject !== 'string' ||
    subject.length === 0 ||
    subject.length > 255 ||
    typeof expiresAt !== 'number' ||
    !Number.isSafeInteger(expiresAt)
  )
    throw new Unauthorized();
  return { accountId, issuer, subject, expiresAt };
}

function verifyAccount(
  values: ProofValues,
  row: typeof users.$inferSelect | undefined,
  at: Date,
): void {
  if (
    row === undefined ||
    row.id !== values.accountId ||
    row.managedProvider !== 'neon' ||
    row.managedIssuer !== values.issuer ||
    row.managedSubject !== values.subject ||
    values.expiresAt <= Math.floor(at.getTime() / 1000)
  )
    throw new Unauthorized();
}

function revision(value: bigint): Revision {
  if (value < 0n || value > MAX_REVISION_BIGINT) throw new PersistenceError('FAILED');
  const result = String(value);
  if (!isRevision(result)) throw new PersistenceError('FAILED');
  return result;
}

function storedSnapshot(value: string): DashboardSnapshot {
  if (Buffer.byteLength(value, 'utf8') > MAX_DASHBOARD_REQUEST_BYTES)
    throw new PersistenceError('FAILED');
  let parsed: unknown;
  try {
    parsed = parseStrictJsonText(value);
  } catch {
    throw new PersistenceError('FAILED');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new PersistenceError('FAILED');
  const row = parsed as Record<string, unknown>;
  if (row['version'] !== 10 || !Object.hasOwn(row, 'state')) throw new PersistenceError('FAILED');
  const state = parseDashboardPersistenceV10(row['state']);
  if (state === null) throw new PersistenceError('FAILED');
  const snapshot: DashboardSnapshot = Object.freeze({ version: 10, state });
  if (canonicalizeJson(snapshot) !== value) throw new PersistenceError('FAILED');
  return snapshot;
}

function readResponse(accountId: string, row: SnapshotRow | undefined): DashboardReadResponse {
  if (!isAccountWorkspaceId(accountId)) throw new PersistenceError('FAILED');
  if (row === undefined)
    return {
      transportVersion: TRANSPORT_VERSION,
      accountWorkspaceId: accountId,
      catalogueVersion: catalogue.version,
      revision: '0',
      dashboard: null,
      updatedAt: null,
    };
  const updatedAt = validateDate(row.updatedAt).toISOString();
  if (
    row.userId !== accountId ||
    row.transportVersion !== TRANSPORT_VERSION ||
    typeof row.revision !== 'bigint' ||
    row.revision <= 0n ||
    row.revision > MAX_REVISION_BIGINT ||
    !isCatalogueVersion(row.catalogueDigest) ||
    !isTimestamp(updatedAt) ||
    validateDate(row.createdAt).getTime() > Date.parse(updatedAt)
  )
    throw new PersistenceError('FAILED');
  const result = catalogue.validateRead(
    {
      transportVersion: TRANSPORT_VERSION,
      accountWorkspaceId: accountId,
      catalogueVersion: row.catalogueDigest,
      revision: revision(row.revision),
      dashboard: storedSnapshot(row.dashboardJson),
      updatedAt,
    },
    accountId,
  );
  if (result === null) throw new PersistenceError('FAILED');
  return result;
}

function acknowledgement(
  accountId: string,
  requestId: string,
  value: bigint,
  at: Date,
): DashboardWriteAcknowledgement {
  const nextRevision = revision(value);
  const updatedAt = validateDate(at).toISOString();
  if (
    !isAccountWorkspaceId(accountId) ||
    !isRequestId(requestId) ||
    !isNonZeroRevision(nextRevision) ||
    !isTimestamp(updatedAt)
  ) {
    throw new PersistenceError('FAILED');
  }
  return {
    transportVersion: TRANSPORT_VERSION,
    accountWorkspaceId: accountId,
    requestId,
    revision: nextRevision,
    updatedAt,
  };
}

function validateReceipt(
  row: ReceiptRow,
  values: ProofValues,
  intent: ValidatedDashboardWrite,
): DashboardWriteAcknowledgement {
  if (
    row.userId !== values.accountId ||
    row.requestId !== intent.request.requestId ||
    row.requestDigest !== intent.requestDigest ||
    typeof row.acknowledgedRevision !== 'bigint' ||
    row.acknowledgedRevision <= 0n ||
    row.acknowledgedRevision > MAX_REVISION_BIGINT
  )
    throw new PersistenceError('FAILED');
  return acknowledgement(
    values.accountId,
    row.requestId,
    row.acknowledgedRevision,
    row.acknowledgedAt,
  );
}

function readFailure(error: unknown): DashboardReadOutcome {
  return error instanceof Unauthorized ? { status: 'unauthenticated' } : { status: 'unavailable' };
}

function writeFailure(error: unknown): DashboardWriteOutcome {
  if (error instanceof Unauthorized) return { status: 'unauthenticated' };
  if (error instanceof WorkspaceMismatch) return { status: 'workspace-mismatch' };
  return { status: 'unavailable' };
}

export function createPostgresManagedDashboardPersistence(dependencies: {
  readonly database: PersistenceDatabase;
  readonly clock: PersistenceClock;
  readonly runTransaction: PersistenceTransactionRunner;
}): DashboardPersistence {
  const { database, clock, runTransaction } = dependencies;
  return {
    read: async (proof: AccountAuthorizationProof) => {
      try {
        const values = proofValues(proof);
        const accounts = await database
          .select()
          .from(users)
          .where(eq(users.id, values.accountId))
          .limit(1);
        verifyAccount(values, accounts[0], validateDate(clock()));
        const dashboards = await database
          .select()
          .from(cloudDashboards)
          .where(eq(cloudDashboards.userId, values.accountId))
          .limit(1);
        verifyAccount(values, accounts[0], validateDate(clock()));
        return { status: 'read', response: readResponse(values.accountId, dashboards[0]) };
      } catch (error) {
        return readFailure(error);
      }
    },

    compareAndWrite: async (
      proof: AccountAuthorizationProof,
      intent: ValidatedDashboardWrite,
      isCatalogueCompatible,
    ) => {
      let values: ProofValues;
      try {
        values = proofValues(proof);
      } catch (error) {
        return writeFailure(error);
      }
      try {
        return await runTransaction(
          async (transaction): Promise<DashboardWriteOutcome> => {
            // Every account mutation takes the same account-first lock.
            const accountRows = await transaction
              .select()
              .from(users)
              .where(eq(users.id, values.accountId))
              .limit(1)
              .for('no key update');
            const account = accountRows[0];
            verifyAccount(values, account, validateDate(clock()));
            if (intent.request.expectedAccountWorkspaceId !== values.accountId)
              throw new WorkspaceMismatch();

            const receiptRows = await transaction
              .select()
              .from(dashboardWriteReceipts)
              .where(
                and(
                  eq(dashboardWriteReceipts.userId, values.accountId),
                  eq(dashboardWriteReceipts.requestId, intent.request.requestId),
                ),
              )
              .limit(1)
              .for('update');
            verifyAccount(values, account, validateDate(clock()));
            const receipt = receiptRows[0];
            if (receipt !== undefined) {
              // Resolve a retry before today's catalogue or revision can change its acknowledgement.
              if (receipt.requestDigest === intent.requestDigest) {
                return {
                  status: 'replayed',
                  acknowledgement: validateReceipt(receipt, values, intent),
                };
              }
              return { status: 'request-id-reused' };
            }

            let compatible: boolean;
            try {
              compatible = isCatalogueCompatible(intent);
            } catch {
              throw new PersistenceError('FAILED');
            }
            if (!compatible) return { status: 'catalogue-incompatible' };

            const dashboardRows = await transaction
              .select()
              .from(cloudDashboards)
              .where(eq(cloudDashboards.userId, values.accountId))
              .limit(1)
              .for('update');
            verifyAccount(values, account, validateDate(clock()));
            const stored = dashboardRows[0];
            const current = stored?.revision ?? 0n;
            if (stored !== undefined) {
              readResponse(values.accountId, stored);
            }
            const expected = BigInt(intent.request.expectedRevision);
            if (current !== expected) {
              const currentRevision = revision(current);
              if (!isRevision(currentRevision)) throw new PersistenceError('FAILED');
              return { status: 'revision-conflict', currentRevision };
            }
            if (current >= MAX_REVISION_BIGINT) throw new PersistenceError('FAILED');
            const mutationAt = validateDate(clock());
            verifyAccount(values, account, mutationAt);
            const next = current + 1n;
            const updatedAt =
              stored === undefined || mutationAt >= stored.updatedAt
                ? mutationAt
                : stored.updatedAt;
            if (stored === undefined) {
              await transaction.insert(cloudDashboards).values({
                userId: values.accountId,
                revision: next,
                transportVersion: TRANSPORT_VERSION,
                catalogueDigest: intent.request.catalogueVersion,
                dashboardJson: intent.canonicalDashboardJson,
                createdAt: updatedAt,
                updatedAt,
              });
            } else {
              const updated = await transaction
                .update(cloudDashboards)
                .set({
                  revision: sql`${cloudDashboards.revision} + 1`,
                  transportVersion: TRANSPORT_VERSION,
                  catalogueDigest: intent.request.catalogueVersion,
                  dashboardJson: intent.canonicalDashboardJson,
                  updatedAt,
                })
                .where(
                  and(
                    eq(cloudDashboards.userId, values.accountId),
                    eq(cloudDashboards.revision, expected),
                  ),
                )
                .returning({ revision: cloudDashboards.revision });
              if (updated.length !== 1 || typeof updated[0]?.revision !== 'bigint')
                throw new PersistenceError('CONFLICT');
            }
            await transaction.insert(dashboardWriteReceipts).values({
              userId: values.accountId,
              requestId: intent.request.requestId,
              requestDigest: intent.requestDigest,
              acknowledgedRevision: next,
              acknowledgedAt: updatedAt,
              createdAt: updatedAt,
            });
            await transaction
              .update(accountCopyOpportunities)
              .set({
                consumedAt: mutationAt,
                outcome: 'saved',
              })
              .where(
                and(
                  eq(accountCopyOpportunities.userId, values.accountId),
                  isNull(accountCopyOpportunities.consumedAt),
                ),
              );
            // Pruning belongs to a new write; replay and failure paths leave receipts untouched.
            const cleanupAt = validateDate(clock());
            const cutoff = new Date(cleanupAt.getTime() - DASHBOARD_RECEIPT_CLEANUP_AGE_MS);
            await transaction
              .delete(dashboardWriteReceipts)
              .where(
                and(
                  eq(dashboardWriteReceipts.userId, values.accountId),
                  lte(dashboardWriteReceipts.createdAt, cutoff),
                ),
              );
            await transaction.execute(sql`
            WITH excess AS (
              SELECT ${dashboardWriteReceipts.requestId}
              FROM ${dashboardWriteReceipts}
              WHERE ${dashboardWriteReceipts.userId} = ${values.accountId}
              ORDER BY ${dashboardWriteReceipts.acknowledgedRevision} DESC, ${dashboardWriteReceipts.requestId} DESC
              OFFSET ${MAX_DASHBOARD_RECEIPTS_PER_ACCOUNT}
            )
            DELETE FROM ${dashboardWriteReceipts} AS receipts
            USING excess
            WHERE receipts.user_id = ${values.accountId} AND receipts.request_id = excess.request_id
          `);
            verifyAccount(values, account, validateDate(clock()));
            return {
              status: 'written',
              acknowledgement: acknowledgement(
                values.accountId,
                intent.request.requestId,
                next,
                updatedAt,
              ),
            };
          },
          { dashboardWrite: true },
        );
      } catch (error) {
        return writeFailure(error);
      }
    },
  };
}
