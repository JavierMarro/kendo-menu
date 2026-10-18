---
name: kendomenu-api-feature
description: Implement or review KendoMenu Elysia routes, managed-identity authorization, PostgreSQL adapters, or Drizzle migrations. Not frontend-only or deployment work.
---

# KendoMenu API Feature

Keep the backend slice within the assigned job. Use `AGENTS.md` and the approved transition handoff;
do not turn API work into an auth rewrite, a production rollout, or an offline synchronization engine.

## Locate the affected contract

- Read the relevant route, contract, caller, and nearby tests in `apps/api`. Use
  `docs/ARCHITECTURE.md` for dependency direction and `docs/MANAGED_AUTH_TRANSITION.md` during the
  replacement. Read only the relevant sections of older account/dashboard handoffs for legacy coupling.
- Keep Elysia request handling in `src/app.ts` and HTTP composition, SQL behind
  `src/persistence/postgres`, schema in `src/persistence/schema.ts`, and explicit database commands in
  `src/database`. Reuse domain codecs from `packages/domain`; do not duplicate transport validation.
- Preserve the listener-free application and thin Node/Vercel adapters. Import/build/health checks
  must not connect to PostgreSQL. Repeated `Set-Cookie` headers must survive actual Node transport.

## Authorization and writes

- Consume the established server-verified identity interface. Neon-managed subjects are not Google
  `sub` values or internal-user UUIDs; map the configured issuer/subject to an internal account.
  Never authorize or automatically link accounts by email, client IDs, or an empty dashboard.
- Keep managed auth/JWT verification in its dedicated module using supported SDK/library behavior.
  Do not issue application tokens, invent revocation promises, or maintain a second session system.
  Old custom-session SQL locks are legacy coupling to adapt deliberately, not rules to copy blindly.
- Bound and validate untrusted requests before writes. Derive ownership server-side; preserve the
  request's expected-account/revision guards, applicable replay protection, and complete-dashboard
  validation. The one-time guest copy has no durable pending/recovery requirement; ordinary save
  semantics remain separate. Never change guest LocalStorage from an API implementation.
- Run atomic mutations on one checked-out client. Keep lock order consistent with actual callers,
  roll back pre-commit failures, and acknowledge only a successful commit. A lost COMMIT response is
  an uncertain outcome, not proof of rollback. Never log tokens, connection URLs, or identity payloads.

## PostgreSQL and migrations — only when affected

- Use the existing Drizzle/pg foundation. Inspect schema and generated SQL, journal, and snapshots
  together. Add forward migrations; preserve applied history. Do not use schema push, runtime
  migrations, shared-schema resets, or direct edits of Neon's managed `neon_auth` tables.
- `pnpm db:generate` writes migration artifacts; review them. `pnpm db:check` checks metadata without
  a database. Neither establishes that a migration works against PostgreSQL.
- `pnpm test:api:integration` requires private `TEST_DATABASE_URL` configuration for the guarded
  local `kendomenu_test` harness. It creates/removes uniquely owned schemas. Missing configuration
  must fail explicitly; never bypass the guard or substitute a remote Neon/development database.
- `pnpm db:migrate` consumes `MIGRATION_DATABASE_URL` and mutates its target. Test-harness migration
  is contained; manual migration of another target needs the owner's explicit authorization.
  Follow documented environment loading; the existing API scripts do not auto-load `.env.local`.

## Verification and handoff

Run `pnpm check:api` and targeted HTTP/authorization tests for API changes. For SQL/schema behavior,
also run the real integration suite and `pnpm db:check`; use `pnpm check` for a cross-package slice.
Keep suites sequential and reuse current evidence. Test through public contracts; transaction mocks
do not prove locks, concurrency, ownership, rollback, or migrations against PostgreSQL.

Obtain the independent review required by `AGENTS.md` for security/persistence changes. Report exact
commands, results, limitations, and live provider checks as observed or not run. Do not stage,
commit, deploy, or change remote configuration.
