/**
 * PostgreSQL adapter for one-use guest-copy decisions on managed accounts.
 * Consumption commits before a Yes copy starts, so later failure cannot reopen the opportunity.
 * The copy transaction rechecks ownership and refuses to overwrite a dashboard created by Save.
 */
import { and, eq, isNull } from 'drizzle-orm';

import type { AccountAuthorizationProof } from '../../auth/account-authorization.js';
import type { ValidatedAdoptionRequest } from '../../adoption/contracts.js';
import type { ValidatedDashboardWrite } from '../../dashboard/validation.js';
import {
  isAccountWorkspaceId,
  isNonZeroRevision,
  isTimestamp,
} from '../../dashboard/validation.js';
import { PersistenceError, type PersistenceClock } from '../contracts.js';
import type { ManagedCopyOutcome, ManagedCopyPersistence } from '../managed-copy-contracts.js';
import { accountCopyOpportunities, cloudDashboards, users } from '../schema.js';
import type { PersistenceTransactionRunner } from './transaction.js';
import type { AccountAuthorizationProof as Proof } from '../../auth/account-authorization.js';

interface ProofValues {
  readonly accountId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly expiresAt: number;
}

class Unauthorized extends Error {}

function own(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function proofValues(value: Proof): ProofValues {
  if (typeof value !== 'object' || value === null) throw new Unauthorized();
  const accountId = own(value, 'accountId');
  const provider = own(value, 'provider');
  const issuer = own(value, 'issuer');
  const subject = own(value, 'subject');
  const expiresAt = own(value, 'expiresAt');
  if (
    typeof accountId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(accountId) ||
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

function verify(values: ProofValues, user: typeof users.$inferSelect | undefined, at: Date): void {
  if (
    user === undefined ||
    user.id !== values.accountId ||
    user.managedProvider !== 'neon' ||
    user.managedIssuer !== values.issuer ||
    user.managedSubject !== values.subject ||
    values.expiresAt <= Math.floor(at.getTime() / 1000)
  )
    throw new Unauthorized();
}

export function createPostgresManagedCopyPersistence(dependencies: {
  readonly runTransaction: PersistenceTransactionRunner;
  readonly clock: PersistenceClock;
  /** Deterministic barrier used only by the real PostgreSQL race regression. */
  readonly afterOpportunityConsumed?: () => Promise<void>;
  readonly afterCopyWriteBeforeCommit?: () => Promise<void>;
  readonly afterCopyCommitResponseLost?: () => Promise<void>;
}): ManagedCopyPersistence {
  const { runTransaction, clock } = dependencies;

  return {
    consumeOpportunity: async (
      proof: AccountAuthorizationProof,
      intent: ValidatedAdoptionRequest,
      isCatalogueCompatible: (intent: ValidatedDashboardWrite) => boolean,
    ): Promise<ManagedCopyOutcome> => {
      let values: ProofValues;
      try {
        values = proofValues(proof);
      } catch {
        return { status: 'unauthenticated' };
      }
      const request = intent.request;
      if (request.expectedAccountWorkspaceId !== values.accountId) return { status: 'unavailable' };

      if (request.decision === 'yes') {
        const dashboardIntent = intent.dashboardIntent;
        if (dashboardIntent === undefined || dashboardIntent.request.expectedRevision !== '0') {
          return { status: 'unavailable' };
        }
        let compatible: boolean;
        try {
          compatible = isCatalogueCompatible(dashboardIntent);
        } catch {
          return { status: 'unavailable' };
        }
        if (!compatible) return { status: 'catalogue-incompatible' };
      }

      // Consumption is terminal before the separate Yes-copy transaction begins.
      try {
        await runTransaction(
          async (transaction) => {
            // Save, decline and copy all take the same account-first lock order.
            const accounts = await transaction
              .select()
              .from(users)
              .where(eq(users.id, values.accountId))
              .limit(1)
              .for('no key update');
            const account = accounts[0];
            const at = clock();
            verify(values, account, at);
            const rows = await transaction
              .select()
              .from(accountCopyOpportunities)
              .where(eq(accountCopyOpportunities.userId, values.accountId))
              .limit(1)
              .for('update');
            verify(values, account, clock());
            const opportunity = rows[0];
            if (
              opportunity === undefined ||
              opportunity.opportunityId !== request.copyOpportunityId ||
              opportunity.consumedAt !== null
            )
              throw new OpportunityUnavailable();
            const dashboard = await transaction
              .select({ revision: cloudDashboards.revision })
              .from(cloudDashboards)
              .where(eq(cloudDashboards.userId, values.accountId))
              .limit(1)
              .for('update');
            verify(values, account, clock());
            const stored = dashboard[0];
            if (stored !== undefined) throw new DashboardExists();
            const decisionAt = clock();
            verify(values, account, decisionAt);
            const updated = await transaction
              .update(accountCopyOpportunities)
              .set({
                consumedAt: decisionAt,
                outcome: request.decision === 'yes' ? 'consumed' : 'declined',
              })
              .where(
                and(
                  eq(accountCopyOpportunities.userId, values.accountId),
                  eq(accountCopyOpportunities.opportunityId, request.copyOpportunityId),
                  isNull(accountCopyOpportunities.consumedAt),
                ),
              )
              .returning({ userId: accountCopyOpportunities.userId });
            if (updated.length !== 1) throw new OpportunityUnavailable();
            verify(values, account, clock());
          },
          { dashboardWrite: true },
        );
      } catch (error) {
        if (error instanceof Unauthorized) return { status: 'unauthenticated' };
        if (error instanceof OpportunityUnavailable) return { status: 'capability-unavailable' };
        if (error instanceof DashboardExists) return { status: 'revision-conflict' };
        return { status: 'unavailable' };
      }

      if (request.decision === 'no') return { status: 'declined' };
      const dashboardIntent = intent.dashboardIntent;
      if (dashboardIntent === undefined) return { status: 'unavailable' };
      try {
        await dependencies.afterOpportunityConsumed?.();
        return await runTransaction(
          async (transaction): Promise<ManagedCopyOutcome> => {
            const accounts = await transaction
              .select()
              .from(users)
              .where(eq(users.id, values.accountId))
              .limit(1)
              .for('no key update');
            const account = accounts[0];
            verify(values, account, clock());
            const dashboards = await transaction
              .select()
              .from(cloudDashboards)
              .where(eq(cloudDashboards.userId, values.accountId))
              .limit(1)
              .for('update');
            verify(values, account, clock());
            const existing = dashboards[0];
            // A Save that committed after consumption owns the account. Preserve
            // it and leave the already consumed opportunity terminal.
            if (existing !== undefined) return { status: 'revision-conflict' };
            const copiedAt = clock();
            verify(values, account, copiedAt);
            const inserted = await transaction
              .insert(cloudDashboards)
              .values({
                userId: values.accountId,
                revision: 1n,
                transportVersion: 1,
                catalogueDigest: dashboardIntent.request.catalogueVersion,
                dashboardJson: dashboardIntent.canonicalDashboardJson,
                createdAt: copiedAt,
                updatedAt: copiedAt,
              })
              .returning({ userId: cloudDashboards.userId });
            if (inserted.length !== 1) throw new PersistenceError('FAILED');
            const accepted = await transaction
              .update(accountCopyOpportunities)
              .set({ outcome: 'accepted' })
              .where(
                and(
                  eq(accountCopyOpportunities.userId, values.accountId),
                  eq(accountCopyOpportunities.opportunityId, request.copyOpportunityId),
                  eq(accountCopyOpportunities.outcome, 'consumed'),
                ),
              )
              .returning({ userId: accountCopyOpportunities.userId });
            if (accepted.length !== 1) throw new PersistenceError('FAILED');
            await dependencies.afterCopyWriteBeforeCommit?.();
            verify(values, account, clock());
            const accountWorkspaceId = values.accountId;
            const revision = '1';
            const updatedAt = copiedAt.toISOString();
            if (
              !isAccountWorkspaceId(accountWorkspaceId) ||
              !isNonZeroRevision(revision) ||
              !isTimestamp(updatedAt)
            ) {
              throw new PersistenceError('FAILED');
            }
            return {
              status: 'accepted',
              acknowledgement: {
                transportVersion: 1,
                accountWorkspaceId,
                requestId: request.requestId,
                revision,
                updatedAt,
              },
            };
          },
          {
            dashboardWrite: true,
            ...(dependencies.afterCopyCommitResponseLost === undefined
              ? {}
              : { afterCommitResponse: dependencies.afterCopyCommitResponseLost }),
          },
        );
      } catch (error) {
        return error instanceof Unauthorized
          ? { status: 'unauthenticated' }
          : { status: 'unavailable' };
      }
    },
  };
}

class OpportunityUnavailable extends Error {}
class DashboardExists extends Error {}
