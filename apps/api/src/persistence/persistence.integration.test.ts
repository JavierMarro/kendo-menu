import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { readMigrationFiles } from 'drizzle-orm/migrator';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../database/migrate.js';
import { createTestDatabase, type TestDatabase } from '../database/test-database.js';
import { PersistenceError } from './contracts.js';
import type { SessionCreationInput, UserRecord } from './contracts.js';
import { createPostgresPersistence, type PostgresPersistence } from './postgres/adapter.js';

const BASE_TIME = Date.parse('2026-01-01T12:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SAFE_PERSISTENCE_MESSAGES = new Set([
  'Persistence operation failed',
  'Persistence input is invalid',
  'Persistence conflict',
  'Persistence storage is unavailable',
]);

const clockMilliseconds = BASE_TIME;
let sequence = 0;
let database: TestDatabase | undefined;

function now(): Date {
  return new Date(clockMilliseconds);
}

function at(offsetMilliseconds: number): Date {
  return new Date(BASE_TIME + offsetMilliseconds);
}

function uniqueName(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function pkce(value: string): string {
  return `${value}-pkce-code-verifier`.padEnd(43, 'v');
}

function persistence(): PostgresPersistence {
  if (!database) {
    throw new Error('TEST_DATABASE_NOT_INITIALIZED');
  }
  return database.persistence;
}

function currentClient() {
  if (!database) {
    throw new Error('TEST_DATABASE_NOT_INITIALIZED');
  }
  return database.client;
}

async function createUser(
  googleSub = uniqueName('google-sub'),
  verifiedGoogleEmail?: string,
): Promise<UserRecord> {
  const input =
    verifiedGoogleEmail === undefined ? { googleSub } : { googleSub, verifiedGoogleEmail };
  return persistence().users.resolveByGoogleSubject(input);
}

function sessionInput(userId: string, label = uniqueName('session')): SessionCreationInput {
  return {
    userId,
    sessionTokenHash: sha256(`${label}-session-token`),
    csrfTokenHash: sha256(`${label}-csrf-token`),
    createdAt: at(0),
    lastActivityAt: at(0),
    idleExpiresAt: at(7 * DAY),
    absoluteExpiresAt: at(30 * DAY),
  };
}

async function storedRows(table: 'users' | 'login_transactions' | 'application_sessions') {
  const result = await currentClient().query<{ row_json: string }>(
    `SELECT to_jsonb(row)::text AS row_json FROM ${table} AS row`,
  );
  return result.rows.map((row) => row.row_json);
}

function driverCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}

async function expectSqlState(operation: Promise<unknown>, code: string): Promise<void> {
  let observedCode: string | undefined;
  try {
    await operation;
  } catch (error) {
    observedCode = driverCode(error);
  }
  expect(observedCode).toBe(code);
}

async function expectPersistenceCode<T>(
  operation: Promise<T>,
  code: PersistenceError['code'],
): Promise<void> {
  let failure: unknown;
  try {
    await operation;
  } catch (error) {
    failure = error;
  }
  const isSafePersistenceError =
    failure instanceof PersistenceError &&
    failure.name === 'PersistenceError' &&
    SAFE_PERSISTENCE_MESSAGES.has(failure.message) &&
    !('cause' in failure);
  expect(isSafePersistenceError).toBe(true);
  if (failure instanceof PersistenceError) {
    expect(failure.code).toBe(code);
  }
}

beforeEach(async () => {
  database = await createTestDatabase({ clock: now });
});

afterEach(async () => {
  if (database) {
    const currentDatabase = database;
    database = undefined;
    await currentDatabase.close();
  }
});

describe('isolated PostgreSQL migrations', () => {
  it('applies all migrations to an empty schema and is safe to apply again', async () => {
    const connectionString = process.env['TEST_DATABASE_URL'];
    if (!connectionString || !database) {
      throw new Error('TEST_DATABASE_URL_REQUIRED');
    }
    const expectedMigrations = readMigrationFiles({
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    }).length;
    const before = await currentClient().query<{ count: string }>(
      'SELECT count(*)::text AS count FROM "__drizzle_migrations"',
    );
    expect(Number(before.rows[0]?.count)).toBe(expectedMigrations);

    await expect(
      migrateDatabase({ connectionString, schema: database.schema }),
    ).resolves.toBeUndefined();

    const journal = await currentClient().query<{ count: string }>(
      'SELECT count(*)::text AS count FROM "__drizzle_migrations"',
    );
    expect(Number(journal.rows[0]?.count)).toBe(expectedMigrations);
  });

  it('confirms the harness is connected to the designated test database', async () => {
    const result = await currentClient().query<{ database_name: string }>(
      'SELECT current_database() AS database_name',
    );
    expect(result.rows[0]?.database_name).toBe('kendomenu_test');
  });

  it('records the PostgreSQL server version without exposing connection details', async () => {
    const result = await currentClient().query<{ server_version: string }>('SHOW server_version');
    expect(result.rows[0]?.server_version).toMatch(/^\d+(?:\.\d+){0,2}/);
  });
});

describe('users', () => {
  it('creates a user by Google subject and keeps the subject as identity', async () => {
    const googleSub = uniqueName('subject');
    const created = await createUser(googleSub, 'first@example.test');

    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(created.googleSub).toBe(googleSub);
    expect(created.verifiedGoogleEmail).toBe('first@example.test');
    expect(created.createdAt).toEqual(created.updatedAt);

    const unchanged = await createUser(googleSub);
    expect(unchanged.id).toBe(created.id);
    expect(unchanged.googleSub).toBe(googleSub);
    expect(unchanged.verifiedGoogleEmail).toBe('first@example.test');

    const changed = await createUser(googleSub, 'new@example.test');
    expect(changed.id).toBe(created.id);
    expect(changed.verifiedGoogleEmail).toBe('new@example.test');
    expect(changed.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it('stores null on first login without email and preserves metadata when email is absent', async () => {
    const googleSub = uniqueName('emailless-subject');
    const first = await createUser(googleSub);
    expect(first.verifiedGoogleEmail).toBeNull();

    const withEmail = await createUser(googleSub, 'verified@example.test');
    expect(withEmail.verifiedGoogleEmail).toBe('verified@example.test');

    const absentAgain = await createUser(googleSub);
    expect(absentAgain.verifiedGoogleEmail).toBe('verified@example.test');

    // An unverified provider result is represented at this boundary by omission;
    // the persistence layer never receives an email it has not already validated.
    const rows = await storedRows('users');
    expect(rows.some((row) => row.includes('verified@example.test'))).toBe(true);
  });

  it('allows shared display emails while keeping different Google subjects isolated', async () => {
    const email = 'shared@example.test';
    const first = await createUser(uniqueName('subject-a'), email);
    const second = await createUser(uniqueName('subject-b'), email);

    expect(second.id).not.toBe(first.id);
    expect(second.googleSub).not.toBe(first.googleSub);
    expect(second.verifiedGoogleEmail).toBe(email);
  });

  it('resolves concurrent first logins to one user', async () => {
    const googleSub = uniqueName('concurrent-subject');
    const results = await Promise.all(
      Array.from({ length: 12 }, () => createUser(googleSub, 'concurrent@example.test')),
    );
    const ids = new Set(results.map((result) => result.id));

    expect(ids.size).toBe(1);
    expect(results.every((result) => result.googleSub === googleSub)).toBe(true);
    const count = await currentClient().query<{ count: string }>(
      'SELECT count(*)::text AS count FROM users WHERE google_sub = $1',
      [googleSub],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('enforces identity and foreign-key constraints in PostgreSQL', async () => {
    const user = await createUser(uniqueName('immutable-subject'));

    await expectSqlState(
      currentClient().query('UPDATE users SET google_sub = $1 WHERE id = $2', [
        uniqueName('replacement-subject'),
        user.id,
      ]),
      '23514',
    );

    await expectPersistenceCode(
      persistence().sessions.create(sessionInput('00000000-0000-0000-0000-000000000000')),
      'INVALID_INPUT',
    );
  });
});

describe('login transactions', () => {
  it('creates a transaction with a bounded default return path and consumes it once', async () => {
    const state = 'state-default-return';
    const browser = 'browser-default-return';
    const nonce = 'nonce-default-return';
    const input = {
      stateHash: sha256(state),
      browserBindingHash: sha256(browser),
      nonceHash: sha256(nonce),
      pkceCodeVerifier: pkce('default-return'),
      expiresAt: at(9 * MINUTE),
      createdAt: at(0),
    };
    const receipt = await persistence().loginTransactions.create(input);

    expect(receipt.returnPath).toBe('/');
    expect(receipt.expiresAt).toEqual(input.expiresAt);
    const beforeRows = await storedRows('login_transactions');
    expect(beforeRows.some((row) => row.includes(state))).toBe(false);
    expect(beforeRows.some((row) => row.includes(browser))).toBe(false);
    expect(beforeRows.some((row) => row.includes(nonce))).toBe(false);
    expect(beforeRows.some((row) => row.includes(input.pkceCodeVerifier))).toBe(true);

    const consumed = await persistence().loginTransactions.consume({
      stateHash: input.stateHash,
      browserBindingHash: input.browserBindingHash,
      at: at(1 * MINUTE),
    });
    expect(consumed.outcome).toBe('success');
    if (consumed.outcome === 'success') {
      expect(consumed.transaction.pkceCodeVerifier).toBe(input.pkceCodeVerifier);
      expect(consumed.transaction.nonceHash).toBe(input.nonceHash);
      expect(consumed.transaction.returnPath).toBe('/');
    }

    const afterRows = await storedRows('login_transactions');
    expect(afterRows.some((row) => row.includes(input.pkceCodeVerifier))).toBe(false);
    expect(afterRows.some((row) => row.includes(browser))).toBe(false);
    expect(afterRows.some((row) => row.includes(nonce))).toBe(false);

    const replay = await persistence().loginTransactions.consume({
      stateHash: input.stateHash,
      browserBindingHash: input.browserBindingHash,
      at: at(2 * MINUTE),
    });
    expect(replay).toEqual({ outcome: 'consumed' });
  });

  it('persists and returns an application-relative return path', async () => {
    const input = {
      stateHash: sha256('state-return-path'),
      browserBindingHash: sha256('browser-return-path'),
      nonceHash: sha256('nonce-return-path'),
      pkceCodeVerifier: pkce('return-path'),
      returnPath: '/app/dashboard?source=login',
      expiresAt: at(5 * MINUTE),
      createdAt: at(0),
    };
    const receipt = await persistence().loginTransactions.create(input);
    expect(receipt.returnPath).toBe(input.returnPath);

    const result = await persistence().loginTransactions.consume({
      stateHash: input.stateHash,
      browserBindingHash: input.browserBindingHash,
      at: at(1 * MINUTE),
    });
    expect(result.outcome).toBe('success');
    if (result.outcome === 'success') {
      expect(result.transaction.returnPath).toBe(input.returnPath);
    }
  });

  it.each([
    '//external.example',
    'https://external.example',
    '/path\\with-backslash',
    '/path\u0000with-control',
  ])('rejects unsafe return path %s', async (returnPath) => {
    await expectPersistenceCode(
      persistence().loginTransactions.create({
        stateHash: sha256(uniqueName('invalid-state')),
        browserBindingHash: sha256(uniqueName('invalid-browser')),
        nonceHash: sha256(uniqueName('invalid-nonce')),
        pkceCodeVerifier: pkce(uniqueName('invalid-pkce')),
        returnPath,
        expiresAt: at(5 * MINUTE),
        createdAt: at(0),
      }),
      'INVALID_INPUT',
    );
  });

  it('distinguishes missing, expired, and browser-binding mismatch outcomes', async () => {
    const missing = await persistence().loginTransactions.consume({
      stateHash: sha256('missing-state'),
      browserBindingHash: sha256('missing-browser'),
      at: at(1 * MINUTE),
    });
    expect(missing).toEqual({ outcome: 'missing' });

    const expiredInput = {
      stateHash: sha256('expired-state'),
      browserBindingHash: sha256('expired-browser'),
      nonceHash: sha256('expired-nonce'),
      pkceCodeVerifier: pkce('expired'),
      expiresAt: at(1 * MINUTE),
      createdAt: at(0),
    };
    await persistence().loginTransactions.create(expiredInput);
    const expired = await persistence().loginTransactions.consume({
      stateHash: expiredInput.stateHash,
      browserBindingHash: expiredInput.browserBindingHash,
      at: at(2 * MINUTE),
    });
    expect(expired).toEqual({ outcome: 'expired' });

    const bindingInput = {
      stateHash: sha256('binding-state'),
      browserBindingHash: sha256('binding-browser'),
      nonceHash: sha256('binding-nonce'),
      pkceCodeVerifier: pkce('binding'),
      expiresAt: at(5 * MINUTE),
      createdAt: at(0),
    };
    await persistence().loginTransactions.create(bindingInput);
    const mismatch = await persistence().loginTransactions.consume({
      stateHash: bindingInput.stateHash,
      browserBindingHash: sha256('wrong-browser'),
      at: at(1 * MINUTE),
    });
    expect(mismatch).toEqual({ outcome: 'binding-mismatch' });

    const succeedsAfterMismatch = await persistence().loginTransactions.consume({
      stateHash: bindingInput.stateHash,
      browserBindingHash: bindingInput.browserBindingHash,
      at: at(2 * MINUTE),
    });
    expect(succeedsAfterMismatch.outcome).toBe('success');
  });

  it('allows only one concurrent consumer and clears callback material atomically', async () => {
    const state = 'state-concurrent-consumption';
    const browser = 'browser-concurrent-consumption';
    const input = {
      stateHash: sha256(state),
      browserBindingHash: sha256(browser),
      nonceHash: sha256('nonce-concurrent-consumption'),
      pkceCodeVerifier: pkce('concurrent-consumption'),
      expiresAt: at(5 * MINUTE),
      createdAt: at(0),
    };
    await persistence().loginTransactions.create(input);

    const outcomes = await Promise.all(
      Array.from({ length: 16 }, () =>
        persistence().loginTransactions.consume({
          stateHash: input.stateHash,
          browserBindingHash: input.browserBindingHash,
          at: at(1 * MINUTE),
        }),
      ),
    );
    expect(outcomes.filter((result) => result.outcome === 'success')).toHaveLength(1);
    expect(outcomes.filter((result) => result.outcome === 'consumed')).toHaveLength(15);
    const rows = await storedRows('login_transactions');
    expect(rows.some((row) => row.includes(input.pkceCodeVerifier))).toBe(false);
  });

  it('cleans only old transactions, respects the requested bound, and has no background dependency', async () => {
    await Promise.all(
      Array.from({ length: 101 }, (_, index) => {
        const createdAt = at(-31 * MINUTE - index);
        return persistence().loginTransactions.create({
          stateHash: sha256(`cleanup-state-${index}`),
          browserBindingHash: sha256(`cleanup-browser-${index}`),
          nonceHash: sha256(`cleanup-nonce-${index}`),
          pkceCodeVerifier: pkce(`cleanup-${index}`),
          expiresAt: new Date(createdAt.getTime() + MINUTE),
          createdAt,
        });
      }),
    );
    const recent = await persistence().loginTransactions.create({
      stateHash: sha256('cleanup-recent-state'),
      browserBindingHash: sha256('cleanup-recent-browser'),
      nonceHash: sha256('cleanup-recent-nonce'),
      pkceCodeVerifier: pkce('cleanup-recent'),
      expiresAt: at(-5 * MINUTE),
      createdAt: at(-6 * MINUTE),
    });

    const first = await persistence().loginTransactions.cleanupExpired({
      at: at(0),
      limit: 100,
    });
    expect(first.deleted).toBe(100);

    const consumedInput = {
      stateHash: sha256('cleanup-consumed-state'),
      browserBindingHash: sha256('cleanup-consumed-browser'),
      nonceHash: sha256('cleanup-consumed-nonce'),
      pkceCodeVerifier: pkce('cleanup-consumed'),
      expiresAt: at(-20 * MINUTE),
      createdAt: at(-21 * MINUTE),
    };
    await persistence().loginTransactions.create(consumedInput);
    const consumed = await persistence().loginTransactions.consume({
      stateHash: consumedInput.stateHash,
      browserBindingHash: consumedInput.browserBindingHash,
      at: at(-20 * MINUTE - 30_000),
    });
    expect(consumed.outcome).toBe('success');

    const second = await persistence().loginTransactions.cleanupExpired({
      at: at(0),
      limit: 100,
    });
    expect(second.deleted).toBe(2);

    const deleted = await persistence().loginTransactions.consume({
      stateHash: sha256('cleanup-state-0'),
      browserBindingHash: sha256('cleanup-browser-0'),
      at: at(0),
    });
    expect(deleted.outcome).toBe('missing');
    const consumedDeleted = await persistence().loginTransactions.consume({
      stateHash: consumedInput.stateHash,
      browserBindingHash: consumedInput.browserBindingHash,
      at: at(0),
    });
    expect(consumedDeleted.outcome).toBe('missing');
    const recentResult = await persistence().loginTransactions.consume({
      stateHash: sha256('cleanup-recent-state'),
      browserBindingHash: sha256('cleanup-recent-browser'),
      at: at(0),
    });
    expect(recentResult.outcome).toBe('expired');
    expect(recent.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('retains a consumed marker through expiry plus the cleanup grace period', async () => {
    const input = {
      stateHash: sha256('cleanup-retention-state'),
      browserBindingHash: sha256('cleanup-retention-browser'),
      nonceHash: sha256('cleanup-retention-nonce'),
      pkceCodeVerifier: pkce('cleanup-retention'),
      expiresAt: at(9 * MINUTE),
      createdAt: at(0),
    };
    await persistence().loginTransactions.create(input);
    const consumed = await persistence().loginTransactions.consume({
      stateHash: input.stateHash,
      browserBindingHash: input.browserBindingHash,
      at: at(1 * MINUTE),
    });
    expect(consumed.outcome).toBe('success');

    const beforeGrace = await persistence().loginTransactions.cleanupExpired({
      at: at(18 * MINUTE),
      limit: 100,
    });
    expect(beforeGrace.deleted).toBe(0);
    await expect(
      persistence().loginTransactions.consume({
        stateHash: input.stateHash,
        browserBindingHash: input.browserBindingHash,
        at: at(18 * MINUTE),
      }),
    ).resolves.toEqual({ outcome: 'consumed' });

    const atGrace = await persistence().loginTransactions.cleanupExpired({
      at: at(19 * MINUTE),
      limit: 100,
    });
    expect(atGrace.deleted).toBe(1);
    await expect(
      persistence().loginTransactions.consume({
        stateHash: input.stateHash,
        browserBindingHash: input.browserBindingHash,
        at: at(19 * MINUTE),
      }),
    ).resolves.toEqual({ outcome: 'missing' });
  });

  it('enforces finite timestamps and callback-material consistency in PostgreSQL', async () => {
    const user = await createUser(uniqueName('database-constraint-user'));
    await expectSqlState(
      currentClient().query(
        `INSERT INTO application_sessions
          (user_id, session_token_hash, csrf_token_hash, created_at, last_activity_at, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, $3, 'infinity'::timestamptz, 'infinity'::timestamptz, 'infinity'::timestamptz, 'infinity'::timestamptz)`,
        [user.id, sha256('infinite-session'), sha256('infinite-csrf')],
      ),
      '23514',
    );

    await expectSqlState(
      currentClient().query(
        `INSERT INTO login_transactions
          (state_hash, browser_binding_hash, nonce_hash, pkce_code_verifier, return_path, created_at, expires_at)
         VALUES ($1, $2, $3, $4, '/', 'infinity'::timestamptz, 'infinity'::timestamptz)`,
        [
          sha256('infinite-state'),
          sha256('infinite-browser'),
          sha256('infinite-nonce'),
          pkce('infinite'),
        ],
      ),
      '23514',
    );

    await expectSqlState(
      currentClient().query(
        `INSERT INTO login_transactions
          (state_hash, browser_binding_hash, nonce_hash, pkce_code_verifier, return_path, created_at, expires_at, consumed_at)
         VALUES ($1, $2, $3, $4, '/', $5, $6, $7)`,
        [
          sha256('inconsistent-state'),
          sha256('inconsistent-browser'),
          sha256('inconsistent-nonce'),
          pkce('inconsistent'),
          at(0),
          at(5 * MINUTE),
          at(1 * MINUTE),
        ],
      ),
      '23514',
    );

    await expectSqlState(
      currentClient().query(
        `INSERT INTO application_sessions
          (user_id, session_token_hash, csrf_token_hash, created_at, last_activity_at, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          user.id,
          sha256('invalid-order-session'),
          sha256('invalid-order-csrf'),
          at(0),
          at(1 * MINUTE),
          at(3 * MINUTE),
          at(2 * MINUTE),
        ],
      ),
      '23514',
    );

    await expectSqlState(
      currentClient().query(
        `INSERT INTO application_sessions
          (user_id, session_token_hash, csrf_token_hash, created_at, last_activity_at, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          user.id,
          'not-a-session-hash',
          sha256('invalid-format-csrf'),
          at(0),
          at(0),
          at(1 * MINUTE),
          at(2 * MINUTE),
        ],
      ),
      '23514',
    );

    await expectSqlState(
      currentClient().query(
        `INSERT INTO login_transactions
          (state_hash, browser_binding_hash, nonce_hash, pkce_code_verifier, return_path, created_at, expires_at)
         VALUES ($1, $2, $3, $4, '/', $5, $6)`,
        [
          sha256('invalid-order-login'),
          sha256('invalid-order-browser'),
          sha256('invalid-order-nonce'),
          pkce('invalid-order-login'),
          at(5 * MINUTE),
          at(4 * MINUTE),
        ],
      ),
      '23514',
    );
  });
});

describe('application sessions', () => {
  it('stores only hashes and authenticates an active session by its hash', async () => {
    const user = await createUser();
    const input = sessionInput(user.id, 'active-hash-only');
    const created = await persistence().sessions.create(input);

    expect(created.userId).toBe(user.id);
    expect(created.revokedAt).toBeNull();
    const found = await persistence().sessions.findActiveByTokenHash({
      sessionTokenHash: input.sessionTokenHash,
      csrfTokenHash: input.csrfTokenHash,
      at: at(1 * HOUR),
    });
    expect(found?.id).toBe(created.id);
    expect(
      await persistence().sessions.findActiveByTokenHash({
        sessionTokenHash: sha256('forged-or-unknown-token'),
        at: at(1 * HOUR),
      }),
    ).toBeNull();

    const rows = await storedRows('application_sessions');
    expect(rows.some((row) => row.includes('active-hash-only-session-token'))).toBe(false);
    expect(rows.some((row) => row.includes('active-hash-only-csrf-token'))).toBe(false);
  });

  it('rejects a wrong CSRF hash for a state-changing lookup', async () => {
    const user = await createUser();
    const input = sessionInput(user.id, 'csrf-bound');
    await persistence().sessions.create(input);

    const result = await persistence().sessions.findActiveByTokenHash({
      sessionTokenHash: input.sessionTokenHash,
      csrfTokenHash: sha256('wrong-csrf'),
      at: at(1 * HOUR),
    });
    expect(result).toBeNull();
  });

  it('does not authenticate idle-expired, absolute-expired, or revoked sessions', async () => {
    const user = await createUser();
    const idle = sessionInput(user.id, 'idle-expired');
    await persistence().sessions.create(idle);
    expect(
      await persistence().sessions.findActiveByTokenHash({
        sessionTokenHash: idle.sessionTokenHash,
        at: at(7 * DAY),
      }),
    ).toBeNull();

    const absolute = sessionInput(user.id, 'absolute-expired');
    await persistence().sessions.create(absolute);
    expect(
      await persistence().sessions.findActiveByTokenHash({
        sessionTokenHash: absolute.sessionTokenHash,
        at: at(30 * DAY),
      }),
    ).toBeNull();

    const future = {
      ...sessionInput(user.id, 'future-created'),
      createdAt: at(1 * HOUR),
      lastActivityAt: at(1 * HOUR),
      idleExpiresAt: at(7 * DAY + 1 * HOUR),
      absoluteExpiresAt: at(30 * DAY + 1 * HOUR),
    };
    await persistence().sessions.create(future);
    expect(
      await persistence().sessions.findActiveByTokenHash({
        sessionTokenHash: future.sessionTokenHash,
        at: at(0),
      }),
    ).toBeNull();

    const revoked = sessionInput(user.id, 'revoked');
    const created = await persistence().sessions.create(revoked);
    expect(
      await persistence().sessions.revoke({
        sessionId: created.id,
        userId: user.id,
        at: at(1 * HOUR),
      }),
    ).toBe(true);
    expect(
      await persistence().sessions.findActiveByTokenHash({
        sessionTokenHash: revoked.sessionTokenHash,
        at: at(2 * HOUR),
      }),
    ).toBeNull();
  });

  it('updates activity monotonically without extending beyond absolute expiry', async () => {
    const user = await createUser();
    const input = {
      ...sessionInput(user.id, 'activity-bounds'),
      idleExpiresAt: at(30 * DAY),
    };
    const created = await persistence().sessions.create(input);
    const touched = await persistence().sessions.touch({
      sessionId: created.id,
      userId: user.id,
      at: at(29 * DAY + 23 * HOUR),
      idleExpiresAt: at(30 * DAY),
    });
    expect(touched?.lastActivityAt).toEqual(at(29 * DAY + 23 * HOUR));
    expect(touched?.idleExpiresAt).toEqual(at(30 * DAY));

    const afterAbsolute = await persistence().sessions.touch({
      sessionId: created.id,
      userId: user.id,
      at: at(30 * DAY + 1),
      idleExpiresAt: at(31 * DAY),
    });
    expect(afterAbsolute).toBeNull();

    const stale = await persistence().sessions.touch({
      sessionId: created.id,
      userId: user.id,
      at: at(2 * HOUR),
      idleExpiresAt: at(3 * HOUR),
    });
    expect(stale?.lastActivityAt).toEqual(at(29 * DAY + 23 * HOUR));
    expect(stale?.idleExpiresAt).toEqual(at(30 * DAY));

    const idleExpiredInput = sessionInput(user.id, 'activity-no-revival');
    const idleExpired = await persistence().sessions.create(idleExpiredInput);
    expect(
      await persistence().sessions.touch({
        sessionId: idleExpired.id,
        userId: user.id,
        at: at(7 * DAY + 1),
        idleExpiresAt: at(8 * DAY),
      }),
    ).toBeNull();
  });

  it('isolates ownership for activity updates and revocation', async () => {
    const owner = await createUser();
    const other = await createUser();
    const input = sessionInput(owner.id, 'ownership');
    const created = await persistence().sessions.create(input);

    expect(
      await persistence().sessions.touch({
        sessionId: created.id,
        userId: other.id,
        at: at(1 * HOUR),
        idleExpiresAt: at(2 * DAY),
      }),
    ).toBeNull();
    expect(
      await persistence().sessions.revoke({
        sessionId: created.id,
        userId: other.id,
        at: at(1 * HOUR),
      }),
    ).toBe(false);
    expect(
      await persistence().sessions.findActiveByTokenHash({
        sessionTokenHash: input.sessionTokenHash,
        at: at(1 * HOUR),
      }),
    ).not.toBeNull();
  });

  it('enforces timestamp, hash, and unique constraints with typed failures', async () => {
    const user = await createUser();
    const input = sessionInput(user.id, 'unique-hash');
    await persistence().sessions.create(input);
    await expectPersistenceCode(persistence().sessions.create(input), 'CONFLICT');
    await expectPersistenceCode(
      persistence().sessions.create({
        ...sessionInput(user.id, 'invalid-order'),
        idleExpiresAt: at(31 * DAY),
        absoluteExpiresAt: at(30 * DAY),
      }),
      'INVALID_INPUT',
    );
    await expectPersistenceCode(
      persistence().sessions.create({
        ...sessionInput(user.id, 'invalid-hash'),
        sessionTokenHash: 'not-a-hash',
      }),
      'INVALID_INPUT',
    );
  });

  it('replaces a predecessor atomically for the same account', async () => {
    const user = await createUser();
    const predecessorInput = sessionInput(user.id, 'predecessor');
    const predecessor = await persistence().sessions.create(predecessorInput);
    const replacementInput = sessionInput(user.id, 'replacement');
    const replacement = await persistence().sessions.replace({
      predecessorSessionId: predecessor.id,
      userId: user.id,
      replacement: replacementInput,
      at: at(1 * HOUR),
    });

    expect(replacement.id).not.toBe(predecessor.id);
    expect(replacement.userId).toBe(user.id);
    expect(
      await persistence().sessions.findActiveByTokenHash({
        sessionTokenHash: predecessorInput.sessionTokenHash,
        at: at(1 * HOUR),
      }),
    ).toBeNull();
    expect(
      await persistence().sessions.findActiveByTokenHash({
        sessionTokenHash: replacementInput.sessionTokenHash,
        at: at(1 * HOUR),
      }),
    ).not.toBeNull();
  });

  it('rolls back predecessor revocation when replacement insertion fails', async () => {
    const user = await createUser();
    const other = await createUser();
    const predecessorInput = sessionInput(user.id, 'rollback-predecessor');
    const predecessor = await persistence().sessions.create(predecessorInput);
    const conflicting = sessionInput(other.id, 'rollback-conflict');
    await persistence().sessions.create(conflicting);

    await expectPersistenceCode(
      persistence().sessions.replace({
        predecessorSessionId: predecessor.id,
        userId: user.id,
        replacement: {
          ...sessionInput(user.id, 'rollback-replacement'),
          sessionTokenHash: conflicting.sessionTokenHash,
        },
        at: at(1 * HOUR),
      }),
      'CONFLICT',
    );

    expect(
      await persistence().sessions.findActiveByTokenHash({
        sessionTokenHash: predecessorInput.sessionTokenHash,
        at: at(1 * HOUR),
      }),
    ).not.toBeNull();
    expect(
      await persistence().sessions.findActiveByTokenHash({
        sessionTokenHash: conflicting.sessionTokenHash,
        at: at(1 * HOUR),
      }),
    ).toMatchObject({ userId: other.id });
    const rollbackCounts = await currentClient().query<{
      predecessor_active: string;
      replacement_rows: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE id = $1 AND revoked_at IS NULL)::text AS predecessor_active,
         count(*) FILTER (WHERE user_id = $2 AND session_token_hash = $3)::text AS replacement_rows
       FROM application_sessions`,
      [predecessor.id, user.id, conflicting.sessionTokenHash],
    );
    expect(rollbackCounts.rows[0]?.predecessor_active).toBe('1');
    expect(rollbackCounts.rows[0]?.replacement_rows).toBe('0');
  });

  it('rejects replacement by another account or for a missing predecessor', async () => {
    const owner = await createUser();
    const other = await createUser();
    const predecessor = await persistence().sessions.create(
      sessionInput(owner.id, 'owner-predecessor'),
    );

    await expectPersistenceCode(
      persistence().sessions.replace({
        predecessorSessionId: predecessor.id,
        userId: other.id,
        replacement: sessionInput(other.id, 'wrong-owner-replacement'),
        at: at(1 * HOUR),
      }),
      'CONFLICT',
    );
    await expectPersistenceCode(
      persistence().sessions.replace({
        predecessorSessionId: '00000000-0000-0000-0000-000000000000',
        userId: owner.id,
        replacement: sessionInput(owner.id, 'missing-predecessor-replacement'),
        at: at(1 * HOUR),
      }),
      'CONFLICT',
    );
  });

  it('rejects future or expired replacement inputs at the operation boundary', async () => {
    const owner = await createUser();
    const predecessor = await persistence().sessions.create(
      sessionInput(owner.id, 'replacement-boundary-predecessor'),
    );
    const futureReplacement = {
      ...sessionInput(owner.id, 'future-replacement'),
      createdAt: at(1 * HOUR),
      lastActivityAt: at(1 * HOUR),
      idleExpiresAt: at(7 * DAY + 1 * HOUR),
      absoluteExpiresAt: at(30 * DAY + 1 * HOUR),
    };
    await expectPersistenceCode(
      persistence().sessions.replace({
        predecessorSessionId: predecessor.id,
        userId: owner.id,
        replacement: futureReplacement,
        at: at(0),
      }),
      'INVALID_INPUT',
    );

    const futurePredecessor = await persistence().sessions.create({
      ...sessionInput(owner.id, 'future-predecessor'),
      createdAt: at(1 * HOUR),
      lastActivityAt: at(1 * HOUR),
      idleExpiresAt: at(7 * DAY + 1 * HOUR),
      absoluteExpiresAt: at(30 * DAY + 1 * HOUR),
    });
    await expectPersistenceCode(
      persistence().sessions.replace({
        predecessorSessionId: futurePredecessor.id,
        userId: owner.id,
        replacement: sessionInput(owner.id, 'future-predecessor-replacement'),
        at: at(0),
      }),
      'INVALID_INPUT',
    );

    const expiredPredecessor = await persistence().sessions.create({
      ...sessionInput(owner.id, 'expired-predecessor'),
      createdAt: at(-2 * HOUR),
      lastActivityAt: at(-2 * HOUR),
      idleExpiresAt: at(-1 * MINUTE),
      absoluteExpiresAt: at(30 * DAY),
    });
    await expectPersistenceCode(
      persistence().sessions.replace({
        predecessorSessionId: expiredPredecessor.id,
        userId: owner.id,
        replacement: sessionInput(owner.id, 'expired-predecessor-replacement'),
        at: at(0),
      }),
      'CONFLICT',
    );
  });
});

describe('safe persistence failures', () => {
  it('maps an unavailable database to a fixed typed error without leaking connection details', async () => {
    const unavailable = createPostgresPersistence({
      connectionString: 'postgresql://127.0.0.1:1/kendomenu_test',
      schema: 'km_unavailable',
    });
    try {
      await expectPersistenceCode(
        unavailable.users.resolveByGoogleSubject({ googleSub: 'unavailable-subject' }),
        'UNAVAILABLE',
      );
    } finally {
      await unavailable.close();
    }
  });
});
