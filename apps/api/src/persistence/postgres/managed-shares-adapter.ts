/** PostgreSQL storage for immutable, note-free custom-menu links. */
import { randomBytes } from 'node:crypto';

import { createSharedMenuV1, parseSharedMenuV1 } from '@kendo-menu/domain/menu-sharing';
import {
  asTrainingSetId,
  validateTrainingSet,
  type DashboardEntry,
  type TrainingSet,
} from '@kendo-menu/domain';
import {
  isDashboardCatalogueCompatible,
  parseDashboardPersistenceV10,
  parseDashboardPersistenceV11,
  type PersistedCustomTrainingSet,
  type PersistedTrainingWireStateV11,
} from '@kendo-menu/domain/dashboard-persistence';
import { and, eq } from 'drizzle-orm';

import type { AccountAuthorizationProof } from '../../auth/account-authorization.js';
import { createDashboardCatalogue, isRevision } from '../../dashboard/validation.js';
import type { Revision } from '../../dashboard/contracts.js';
import { canonicalizeJson, hashCanonicalJson } from '../../dashboard/canonicalization.js';
import { parseStrictJsonText } from '../../dashboard/request-body.js';
import { PersistenceError, type PersistenceClock } from '../contracts.js';
import type { ManagedSharesPersistence } from '../shares-contracts.js';
import { validateDate, validateUuid } from '../validation.js';
import { cloudDashboards, menuShares, users } from '../schema.js';
import type { PersistenceDatabase, PersistenceTransactionRunner } from './transaction.js';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PAYLOAD_VERSION = 1;
const MAX_SHARE_SNAPSHOT_BYTES = 2_097_152;
const catalogueVersion = createDashboardCatalogue().version;

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

function readProof(value: unknown): ProofValues {
  if (typeof value !== 'object' || value === null) throw new Unauthorized();
  const accountId = validateUuid(own(value, 'accountId'));
  const provider = own(value, 'provider');
  const issuer = own(value, 'issuer');
  const subject = own(value, 'subject');
  const expiresAt = own(value, 'expiresAt');
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
    values.expiresAt <= Math.floor(at.getTime() / 1_000)
  )
    throw new Unauthorized();
}

function customTrainingSet(value: PersistedCustomTrainingSet): TrainingSet {
  const validation = validateTrainingSet({
    id: asTrainingSetId(value.id),
    name: value.name,
    ...(value.description === undefined ? {} : { description: value.description }),
    category: 'custom',
    ...(value.customIntensity === undefined ? {} : { customIntensity: value.customIntensity }),
    activities: value.sections.map((section) => ({
      id: section.id,
      name: section.name,
      ...(section.quantities === undefined ? {} : { quantities: section.quantities }),
      ...(section.notes === undefined ? {} : { notes: section.notes }),
      children: section.exercises.map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        ...(exercise.quantities === undefined ? {} : { quantities: exercise.quantities }),
        ...(exercise.notes === undefined ? {} : { notes: exercise.notes }),
        children: [],
      })),
    })),
    isBuiltIn: false,
  });
  if (!validation.success || validation.value.isBuiltIn || validation.value.category !== 'custom')
    throw new PersistenceError('FAILED');
  return validation.value;
}

function storedDashboard(
  value: string,
  transportVersion: number,
  catalogueDigest: string,
): PersistedTrainingWireStateV11['dashboardEntries'] {
  if (transportVersion !== 1 || catalogueDigest !== catalogueVersion)
    throw new PersistenceError('FAILED');
  if (Buffer.byteLength(value, 'utf8') > MAX_SHARE_SNAPSHOT_BYTES)
    throw new PersistenceError('FAILED');
  let parsed: unknown;
  try {
    parsed = parseStrictJsonText(value);
  } catch {
    throw new PersistenceError('FAILED');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new PersistenceError('FAILED');
  const snapshot = parsed as Record<string, unknown>;
  if (
    (snapshot['version'] !== 10 && snapshot['version'] !== 11) ||
    !Object.hasOwn(snapshot, 'state')
  )
    throw new PersistenceError('FAILED');
  const state =
    snapshot['version'] === 10
      ? parseDashboardPersistenceV10(snapshot['state'])
      : parseDashboardPersistenceV11(snapshot['state']);
  if (
    state === null ||
    !isDashboardCatalogueCompatible(state) ||
    canonicalizeJson({ version: snapshot['version'], state }) !== value
  )
    throw new PersistenceError('FAILED');
  return state.dashboardEntries;
}

function shareSnapshot(entry: PersistedTrainingWireStateV11['dashboardEntries'][number]) {
  if (entry.trainingSet === undefined) return null;
  const runtimeSet = customTrainingSet(entry.trainingSet);
  const runtimeEntry: DashboardEntry = {
    id: entry.id,
    trainingSetId: entry.trainingSetId,
    trainingSet: runtimeSet,
    quantityOverrides: entry.quantityOverrides,
    activityNotes: {},
    notes: '',
    createdAt: entry.createdAt,
  };
  try {
    return createSharedMenuV1(runtimeEntry);
  } catch {
    return null;
  }
}

function readShareRow(row: typeof menuShares.$inferSelect | undefined) {
  if (
    row === undefined ||
    !TOKEN_PATTERN.test(row.token) ||
    row.payloadVersion !== PAYLOAD_VERSION ||
    Buffer.byteLength(row.snapshotJson, 'utf8') > MAX_SHARE_SNAPSHOT_BYTES
  )
    return null;
  let parsed: unknown;
  try {
    parsed = parseStrictJsonText(row.snapshotJson);
  } catch {
    return null;
  }
  const snapshot = parseSharedMenuV1(parsed);
  if (
    snapshot === null ||
    canonicalizeJson(snapshot) !== row.snapshotJson ||
    hashCanonicalJson(snapshot) !== row.snapshotDigest
  )
    return null;
  return { snapshot, ownerId: row.ownerId };
}

function shareFailure(error: unknown): 'unauthenticated' | 'unavailable' {
  return error instanceof Unauthorized ? 'unauthenticated' : 'unavailable';
}

export function createPostgresManagedSharesPersistence(dependencies: {
  readonly database: PersistenceDatabase;
  readonly clock: PersistenceClock;
  readonly runTransaction: PersistenceTransactionRunner;
  readonly afterShareWriteBeforeCommit?: () => Promise<void>;
  readonly afterShareCommitResponseLost?: () => Promise<void>;
}): ManagedSharesPersistence {
  const { database, clock, runTransaction } = dependencies;
  return {
    create: async (
      proof: AccountAuthorizationProof,
      expectedRevision: Revision,
      entryId: string,
    ) => {
      let values: ProofValues;
      try {
        values = readProof(proof);
      } catch (error) {
        return { status: shareFailure(error) };
      }
      try {
        return await runTransaction(
          async (transaction): Promise<Awaited<ReturnType<ManagedSharesPersistence['create']>>> => {
            const accountRows = await transaction
              .select()
              .from(users)
              .where(eq(users.id, values.accountId))
              .limit(1)
              .for('no key update');
            const account = accountRows[0];
            verifyAccount(values, account, validateDate(clock()));
            const dashboardRows = await transaction
              .select()
              .from(cloudDashboards)
              .where(eq(cloudDashboards.userId, values.accountId))
              .limit(1)
              .for('update');
            verifyAccount(values, account, validateDate(clock()));
            const stored = dashboardRows[0];
            if (stored === undefined) {
              const currentRevision = '0';
              if (!isRevision(currentRevision)) throw new PersistenceError('FAILED');
              return expectedRevision === currentRevision
                ? { status: 'not-shareable' }
                : { status: 'revision-conflict', currentRevision };
            }
            if (
              typeof stored.revision !== 'bigint' ||
              stored.revision <= 0n ||
              validateDate(stored.updatedAt).getTime() < validateDate(stored.createdAt).getTime()
            )
              throw new PersistenceError('FAILED');
            const revision = String(stored.revision);
            if (!isRevision(revision)) throw new PersistenceError('FAILED');
            if (revision !== expectedRevision)
              return { status: 'revision-conflict', currentRevision: revision };

            const entries = storedDashboard(
              stored.dashboardJson,
              stored.transportVersion,
              stored.catalogueDigest,
            );
            const entry = entries.find((candidate) => candidate.id === entryId);
            if (entry?.trainingSet === undefined) return { status: 'not-shareable' };
            const snapshot = shareSnapshot(entry);
            if (snapshot === null) return { status: 'not-shareable' };
            const snapshotJson = canonicalizeJson(snapshot);
            if (Buffer.byteLength(snapshotJson, 'utf8') > MAX_SHARE_SNAPSHOT_BYTES)
              return { status: 'unavailable' };
            const snapshotDigest = hashCanonicalJson(snapshot);
            const existing = await transaction
              .select()
              .from(menuShares)
              .where(
                and(
                  eq(menuShares.ownerId, values.accountId),
                  eq(menuShares.sourceEntryId, entryId),
                  eq(menuShares.payloadVersion, PAYLOAD_VERSION),
                  eq(menuShares.snapshotDigest, snapshotDigest),
                ),
              )
              .limit(1);
            const retained = existing[0];
            if (retained !== undefined) {
              const parsed = readShareRow(retained);
              if (parsed === null || canonicalizeJson(parsed.snapshot) !== snapshotJson)
                throw new PersistenceError('FAILED');
              verifyAccount(values, account, validateDate(clock()));
              return { status: 'created', token: retained.token, sourceRevision: revision };
            }

            for (let attempt = 0; attempt < 3; attempt += 1) {
              const token = randomBytes(32).toString('base64url');
              const inserted = await transaction
                .insert(menuShares)
                .values({
                  token,
                  ownerId: values.accountId,
                  sourceEntryId: entryId,
                  payloadVersion: PAYLOAD_VERSION,
                  snapshotJson,
                  snapshotDigest,
                  createdAt: validateDate(clock()),
                })
                .onConflictDoNothing({ target: menuShares.token })
                .returning({ token: menuShares.token });
              if (inserted[0] !== undefined) {
                await dependencies.afterShareWriteBeforeCommit?.();
                verifyAccount(values, account, validateDate(clock()));
                return { status: 'created', token: inserted[0].token, sourceRevision: revision };
              }
            }
            throw new PersistenceError('FAILED');
          },
          {
            dashboardWrite: true,
            ...(dependencies.afterShareCommitResponseLost === undefined
              ? {}
              : { afterCommitResponse: dependencies.afterShareCommitResponseLost }),
          },
        );
      } catch (error) {
        return { status: shareFailure(error) };
      }
    },

    read: async (token: string) => {
      if (!TOKEN_PATTERN.test(token)) return { status: 'not-found' };
      try {
        const rows = await database
          .select()
          .from(menuShares)
          .where(eq(menuShares.token, token))
          .limit(1);
        const share = readShareRow(rows[0]);
        return share === null
          ? { status: 'not-found' }
          : { status: 'found', snapshot: share.snapshot };
      } catch {
        return { status: 'unavailable' };
      }
    },

    readForRecipient: async (proof: AccountAuthorizationProof, token: string) => {
      if (!TOKEN_PATTERN.test(token)) return { status: 'not-found' };
      try {
        const values = readProof(proof);
        const accounts = await database
          .select()
          .from(users)
          .where(eq(users.id, values.accountId))
          .limit(1);
        verifyAccount(values, accounts[0], validateDate(clock()));
        const rows = await database
          .select()
          .from(menuShares)
          .where(eq(menuShares.token, token))
          .limit(1);
        const share = readShareRow(rows[0]);
        verifyAccount(values, accounts[0], validateDate(clock()));
        return share === null
          ? { status: 'not-found' }
          : {
              status: 'found',
              snapshot: share.snapshot,
              isSender: share.ownerId === values.accountId,
            };
      } catch (error) {
        return { status: shareFailure(error) };
      }
    },
  };
}
