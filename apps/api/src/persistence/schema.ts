import { sql } from 'drizzle-orm';
import { check, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

const SHA256_HEX_CHECK = sql`~ '^[0-9a-f]{64}$'`;

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    googleSub: varchar('google_sub', { length: 255 }).notNull(),
    verifiedGoogleEmail: varchar('verified_google_email', { length: 320 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_google_sub_key').on(table.googleSub),
    check(
      'users_google_sub_no_controls',
      sql`(${table.googleSub} <> '' AND ${table.googleSub} !~ '[[:cntrl:]]')`,
    ),
    check(
      'users_verified_google_email_no_controls',
      sql`(${table.verifiedGoogleEmail} IS NULL OR (${table.verifiedGoogleEmail} <> '' AND ${table.verifiedGoogleEmail} !~ '[[:cntrl:]]'))`,
    ),
    check(
      'users_timestamp_order',
      sql`(isfinite(${table.createdAt}) AND isfinite(${table.updatedAt}) AND ${table.updatedAt} >= ${table.createdAt})`,
    ),
  ],
);

export const loginTransactions = pgTable(
  'login_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    stateHash: varchar('state_hash', { length: 64 }).notNull(),
    browserBindingHash: varchar('browser_binding_hash', { length: 64 }),
    nonceHash: varchar('nonce_hash', { length: 64 }),
    pkceCodeVerifier: varchar('pkce_code_verifier', { length: 128 }),
    returnPath: varchar('return_path', { length: 2048 }).default('/'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('login_transactions_state_hash_key').on(table.stateHash),
    index('login_transactions_expiry_idx').on(table.expiresAt, table.consumedAt),
    check(
      'login_transactions_finite_timestamps',
      sql`(isfinite(${table.createdAt}) AND isfinite(${table.expiresAt}) AND (${table.consumedAt} IS NULL OR isfinite(${table.consumedAt})))`,
    ),
    check(
      'login_transactions_callback_material',
      sql`(
      (${table.consumedAt} IS NULL AND ${table.browserBindingHash} IS NOT NULL AND ${table.nonceHash} IS NOT NULL AND ${table.pkceCodeVerifier} IS NOT NULL AND ${table.returnPath} IS NOT NULL)
      OR (${table.consumedAt} IS NOT NULL AND ${table.browserBindingHash} IS NULL AND ${table.nonceHash} IS NULL AND ${table.pkceCodeVerifier} IS NULL AND ${table.returnPath} IS NULL)
    )`,
    ),
    check('login_transactions_state_hash_format', sql`(${table.stateHash} ${SHA256_HEX_CHECK})`),
    check(
      'login_transactions_browser_binding_hash_format',
      sql`(${table.browserBindingHash} IS NULL OR ${table.browserBindingHash} ${SHA256_HEX_CHECK})`,
    ),
    check(
      'login_transactions_nonce_hash_format',
      sql`(${table.nonceHash} IS NULL OR ${table.nonceHash} ${SHA256_HEX_CHECK})`,
    ),
    check(
      'login_transactions_pkce_verifier_format',
      sql`(${table.pkceCodeVerifier} IS NULL OR (${table.pkceCodeVerifier} ~ '^[A-Za-z0-9._~-]{43,128}$'))`,
    ),
    check(
      'login_transactions_return_path_format',
      sql`(${table.returnPath} IS NULL OR (${table.returnPath} <> '' AND ${table.returnPath} LIKE '/%' AND ${table.returnPath} NOT LIKE '//%' AND position(chr(92) in ${table.returnPath}) = 0 AND ${table.returnPath} !~ '[[:cntrl:]]'))`,
    ),
    check(
      'login_transactions_expiry_order',
      sql`(${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + INTERVAL '10 minutes')`,
    ),
    check(
      'login_transactions_consumed_order',
      sql`(${table.consumedAt} IS NULL OR (${table.consumedAt} >= ${table.createdAt} AND ${table.consumedAt} <= ${table.expiresAt}))`,
    ),
  ],
);

export const applicationSessions = pgTable(
  'application_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    sessionTokenHash: varchar('session_token_hash', { length: 64 }).notNull(),
    csrfTokenHash: varchar('csrf_token_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('application_sessions_session_token_hash_key').on(table.sessionTokenHash),
    index('application_sessions_user_id_idx').on(table.userId),
    check(
      'application_sessions_finite_timestamps',
      sql`(isfinite(${table.createdAt}) AND isfinite(${table.lastActivityAt}) AND isfinite(${table.idleExpiresAt}) AND isfinite(${table.absoluteExpiresAt}) AND (${table.revokedAt} IS NULL OR isfinite(${table.revokedAt})))`,
    ),
    index('application_sessions_active_expiry_idx').on(
      table.revokedAt,
      table.idleExpiresAt,
      table.absoluteExpiresAt,
    ),
    check(
      'application_sessions_session_token_hash_format',
      sql`(${table.sessionTokenHash} ${SHA256_HEX_CHECK})`,
    ),
    check(
      'application_sessions_csrf_token_hash_format',
      sql`(${table.csrfTokenHash} ${SHA256_HEX_CHECK})`,
    ),
    check(
      'application_sessions_timestamp_order',
      sql`(${table.createdAt} <= ${table.lastActivityAt} AND ${table.lastActivityAt} <= ${table.idleExpiresAt} AND ${table.idleExpiresAt} <= ${table.absoluteExpiresAt} AND ${table.createdAt} < ${table.absoluteExpiresAt})`,
    ),
    check(
      'application_sessions_revocation_order',
      sql`(${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt})`,
    ),
  ],
);
