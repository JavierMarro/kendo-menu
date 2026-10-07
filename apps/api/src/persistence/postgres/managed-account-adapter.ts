import { eq, sql } from 'drizzle-orm';

import type { AccountAuthorizationProof } from '../../auth/account-authorization.js';
import { hasControlCharacters, type ManagedIdentity } from '../../auth/managed-identity.js';
import { PersistenceError } from '../contracts.js';
import type {
  AccountInitializationOutcome,
  ManagedAccountPersistence,
} from '../managed-account-contracts.js';
import { accountCopyOpportunities, users } from '../schema.js';
import type { PersistenceClock } from '../contracts.js';
import type { PersistenceDatabase, PersistenceTransactionRunner } from './transaction.js';

function identityValues(identity: ManagedIdentity) {
  if (
    identity.provider !== 'neon' ||
    typeof identity.issuer !== 'string' ||
    identity.issuer.length === 0 ||
    identity.issuer.length > 512 ||
    hasControlCharacters(identity.issuer) ||
    typeof identity.subject !== 'string' ||
    identity.subject.length === 0 ||
    identity.subject.length > 255 ||
    hasControlCharacters(identity.subject) ||
    !Number.isSafeInteger(identity.expiresAt)
  ) {
    throw new PersistenceError('INVALID_INPUT');
  }
  if (
    identity.verifiedEmail !== null &&
    (identity.verifiedEmail.length === 0 ||
      identity.verifiedEmail.length > 320 ||
      hasControlCharacters(identity.verifiedEmail))
  ) {
    throw new PersistenceError('INVALID_INPUT');
  }
  return identity;
}

function assertCurrent(
  identity: Pick<ManagedIdentity, 'expiresAt'>,
  clock: PersistenceClock,
): void {
  if (identity.expiresAt <= Math.floor(clock().getTime() / 1000)) {
    throw new PersistenceError('CONFLICT');
  }
}

function proofValues(proof: AccountAuthorizationProof, clock: PersistenceClock) {
  if (
    typeof proof.accountId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(proof.accountId) ||
    proof.provider !== 'neon' ||
    typeof proof.issuer !== 'string' ||
    proof.issuer.length === 0 ||
    proof.issuer.length > 512 ||
    typeof proof.subject !== 'string' ||
    proof.subject.length === 0 ||
    proof.subject.length > 255 ||
    !Number.isSafeInteger(proof.expiresAt)
  ) {
    throw new PersistenceError('INVALID_INPUT');
  }
  assertCurrent(proof, clock);
  return proof;
}

function unavailable(): AccountInitializationOutcome {
  return { status: 'unavailable' };
}

export function createPostgresManagedAccountPersistence(dependencies: {
  readonly database: PersistenceDatabase;
  readonly runTransaction: PersistenceTransactionRunner;
  readonly clock: PersistenceClock;
}): ManagedAccountPersistence {
  const { database, runTransaction, clock } = dependencies;

  return {
    findManagedAccount: async (rawIdentity) => {
      try {
        const identity = identityValues(rawIdentity);
        assertCurrent(identity, clock);
        const rows = await database
          .select({ accountId: users.id })
          .from(users)
          .where(
            sql`${users.managedProvider} = ${identity.provider} AND ${users.managedIssuer} = ${identity.issuer} AND ${users.managedSubject} = ${identity.subject}`,
          )
          .limit(1);
        assertCurrent(identity, clock);
        const row = rows[0];
        return row === undefined ? null : { accountId: row.accountId };
      } catch (error) {
        if (error instanceof PersistenceError) throw error;
        throw new PersistenceError('FAILED');
      }
    },

    initializeManagedAccount: async (rawIdentity) => {
      let identity: ManagedIdentity;
      try {
        identity = identityValues(rawIdentity);
        assertCurrent(identity, clock);
      } catch {
        return { status: 'unauthenticated' };
      }
      try {
        const account = await runTransaction(async (transaction) => {
          // Serialize only identical managed identities before deciding who creates
          // the internal user and its one-time opportunity.
          const lockKey = JSON.stringify([identity.provider, identity.issuer, identity.subject]);
          await transaction.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
          );
          assertCurrent(identity, clock);
          const rows = await transaction
            .select({
              accountId: users.id,
              email: users.verifiedGoogleEmail,
            })
            .from(users)
            .where(
              sql`${users.managedProvider} = ${identity.provider} AND ${users.managedIssuer} = ${identity.issuer} AND ${users.managedSubject} = ${identity.subject}`,
            )
            .limit(1);
          assertCurrent(identity, clock);
          const existing = rows[0];
          if (existing !== undefined) {
            const email = identity.verifiedEmail ?? existing.email;
            if (identity.verifiedEmail !== null && existing.email !== email) {
              await transaction
                .update(users)
                .set({ verifiedGoogleEmail: email, updatedAt: clock() })
                .where(eq(users.id, existing.accountId));
            }
            assertCurrent(identity, clock);
            return { accountId: existing.accountId, email, created: false as const };
          }

          const createdAt = clock();
          assertCurrent(identity, clock);
          const insertedUsers = await transaction
            .insert(users)
            .values({
              createdAt,
              updatedAt: createdAt,
              managedProvider: identity.provider,
              managedIssuer: identity.issuer,
              managedSubject: identity.subject,
              verifiedGoogleEmail: identity.verifiedEmail,
            })
            .returning({ accountId: users.id });
          const inserted = insertedUsers[0];
          if (inserted === undefined) throw new PersistenceError('FAILED');
          const opportunities = await transaction
            .insert(accountCopyOpportunities)
            .values({ userId: inserted.accountId, createdAt })
            .returning({ opportunityId: accountCopyOpportunities.opportunityId });
          const opportunity = opportunities[0];
          if (opportunity === undefined) throw new PersistenceError('FAILED');
          assertCurrent(identity, clock);
          return {
            accountId: inserted.accountId,
            email: identity.verifiedEmail,
            created: true as const,
            copyOpportunityId: opportunity.opportunityId,
          };
        });
        return { status: 'initialized', account };
      } catch (error) {
        if (error instanceof PersistenceError && error.code === 'CONFLICT') {
          return { status: 'unauthenticated' };
        }
        return unavailable();
      }
    },

    readAccount: async (rawProof) => {
      try {
        const proof = proofValues(rawProof, clock);
        const rows = await database
          .select({ accountId: users.id, email: users.verifiedGoogleEmail })
          .from(users)
          .where(
            sql`${users.id} = ${proof.accountId} AND ${users.managedProvider} = ${proof.provider} AND ${users.managedIssuer} = ${proof.issuer} AND ${users.managedSubject} = ${proof.subject}`,
          )
          .limit(1);
        assertCurrent(proof, clock);
        const row = rows[0];
        return row === undefined
          ? { status: 'unauthenticated' as const }
          : { accountId: row.accountId, email: row.email };
      } catch (error) {
        if (error instanceof PersistenceError && error.code === 'CONFLICT') {
          return { status: 'unauthenticated' };
        }
        return { status: 'unavailable' };
      }
    },
  };
}
