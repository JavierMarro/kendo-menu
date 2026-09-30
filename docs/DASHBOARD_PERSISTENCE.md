# Job 5B PostgreSQL dashboard persistence

Job 5B starts from owner commit `07dbace0c557c32ae54cc68c77688d31ec65ed5c` on
`codex/account-sync-integration`. The initial worktree and diff were clean. That commit contains
the reviewed Job 5A interfaces, direct tests and review handoff in
[DASHBOARD_FOUNDATION.md](DASHBOARD_FOUNDATION.md). Job 5B consumes its authorization, transport,
strict codec, canonicalization, bounded reader and HTTP handler directly.

## Runtime and storage

The registered `/api/dashboard` route uses the established GET/PUT application handler, explicit
HEAD/method rejection and `parse: 'none'`. `createRuntimeServices()` shares one lazy persistence
provider between authentication and dashboards; root Vercel composition attaches its pool once.
The existing Node Response mapping preserves repeated Set-Cookie fields. No database is needed
for imports, health or builds.

`cloud_dashboards` stores an internal-user UUID primary/foreign key, positive bigint revision,
transport version, catalogue digest, complete canonical snapshot text and created/updated times.
`dashboard_write_receipts` stores the per-user request ID, SHA-256 request digest, positive
acknowledged revision, original acknowledgement time and receipt creation time. Both user foreign
keys use RESTRICT. Receipt keys are account-scoped. The unique PostgreSQL btree
`dashboard_write_receipts_user_revision_key` enforces per-account revision uniqueness and supports
revision-ordered receipt eviction; no separate non-unique index is needed. Checks bound bytes and
validate versions, digests, identifiers, finite timestamps and ordering.

Writes revalidate all proof credentials against a locked session, including a mandatory CSRF hash.
They derive the account from that session, check the workspace guard, lock the user row and refresh
the clock after waits. Retained receipts precede catalogue/revision checks and cleanup. A new
success commits the dashboard, acknowledgement, seven-day/capacity cleanup and final session touch
together. Receipts remain replayable until removed by a later successful write. Old evicted
requests conflict on their stale revision; a forgotten ID with a current revision is a new request.
An uncertain commit returns fixed 503 without claiming rollback or retrying on the server.

## Migration guidance

`0001_dashboard_persistence.sql`, `meta/0001_snapshot.json` and `meta/_journal.json` are generated
with Drizzle Kit. `0000_auth_persistence.sql` and its snapshot remain unchanged. Review the SQL and
metadata together; use `pnpm db:check` and repeat `pnpm db:generate` to detect unexplained deltas.
The explicit `pnpm db:migrate` command uses a dedicated connection and is never invoked at runtime.
Do not use schema push, automatic migration, shared-schema reset or production migration here.
Reviewed foreign-key references follow the migration connection's search path, matching Job 4A
and keeping the isolated harness independent of shared `public` tables.

Integration tests use only the existing `TEST_DATABASE_URL` harness: local `kendomenu_test`, a
uniquely generated schema per fixture, and cleanup limited to that fixture. Upgrade tests
reconstruct the preceding schema within the owned fixture, preserve authentication rows, apply the
real migration command and repeat it. A deliberately conflicting owned table verifies transactional
DDL rollback and unchanged migration bookkeeping. No development or production database is touched.

## Primary documentation and installed versions

Checked on 2026-09-12 against installed `pg` 8.23.0, Drizzle ORM 0.45.2, Drizzle Kit 0.31.10,
Elysia 1.4.30, `@elysia/node` 1.4.6 and `@vercel/functions` 3.9.7; dependencies are unchanged.

- [PostgreSQL current locking](https://www.postgresql.org/docs/current/explicit-locking.html)
  and [PostgreSQL 17 locking](https://www.postgresql.org/docs/17/explicit-locking.html) describe
  row locks held through transaction completion and the weaker `FOR NO KEY UPDATE` user lock.
  The latter serializes account writes while permitting foreign-key key-share checks.
- [PostgreSQL JSON types](https://www.postgresql.org/docs/current/datatype-json.html) documents
  jsonb's rejection of escaped NUL and invalid surrogate pairs. Canonical escaped text is stored
  without SQL JSON conversion, so an unpaired surrogate remains distinct from U+FFFD.
- [node-postgres transactions](https://node-postgres.com/features/transactions) require all
  transaction queries on one checked-out client. [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
  expose isolation settings, but Job 5B retains the established checked-out-client foundation:
  READ COMMITTED, explicit locks, transaction-local 5-second lock and 15-second statement timeouts.
- [Elysia lifecycle](https://elysiajs.com/essential/life-cycle) documents `parse: 'none'` for handlers
  owning the body reader. Installed 1.4.30's composer recognizes this option; registered-route tests
  verify authorization precedes body acquisition.
- [Vercel pool attachment](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)
  calls for attaching a pool immediately after creation. The installed helper accepts the existing
  pg pool. Local composition tests verify the attachment seam, not platform suspension behavior.

## Verification and review

Checks ran under the existing `/private/tmp/node-v24.12.0-darwin-x64/bin/node` runtime,
Node **24.12.0**, with `pnpm_config_verify_deps_before_run=false`. The initially active runtime was
Node 25.2.1; it was not used as Node 24 verification evidence. A read-only live query confirmed
PostgreSQL **17.11 (Postgres.app)**. Local IPC, PostgreSQL and listener sockets required sandbox
escalation. No environment file or credential was written or printed.

| Command/check                                                                     | Result                                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Targeted authorization and direct dashboard unit tests                            | PASS: 260 tests; Job 5A tests retained                                                                  |
| Registered dashboard HTTP unit tests                                              | PASS: 10 tests, including zero stream pulls on rejection                                                |
| Actual Node listener dashboard tests                                              | PASS: 3 tests with real PostgreSQL, cookies, byte limits and read/write/conflict/replay behavior        |
| `pnpm check:api`                                                                  | PASS: 389 API tests, API/root types and lint                                                            |
| `pnpm test:api:integration`                                                       | PASS: 102 tests across seven files against local PostgreSQL, including actual Node listeners            |
| `env -u TEST_DATABASE_URL pnpm test:api:integration`                              | Expected exit 1: `TEST_DATABASE_URL_REQUIRED_LOCAL_KENDOMENU_TEST`; no silent skip                      |
| `pnpm db:check`                                                                   | PASS: migration metadata chain                                                                          |
| Repeated `pnpm db:generate`                                                       | PASS: five tables, no schema changes and no new migration                                               |
| `pnpm check`                                                                      | PASS: 696 tests (73 domain, 69 store, 389 API, 165 web), types, lint, formatting, history and web build |
| Scoped unsafe-type, skipped-test, debug-log, secret and generated-artifact checks | PASS: no prohibited matches or unexplained artifacts; original migration and dependency files unchanged |
| Dependency audit                                                                  | Not applicable: manifests and lockfile unchanged                                                        |

Final documentation-only updates are checked separately with Prettier, `pnpm session:check`,
relative-link validation and `git diff --check`. Browser E2E/PWA and release verification were not
run for this backend-only change; the successful web build is not live backend/provider evidence.
New/affected links pass. The history index retains two pre-existing broken links to
`2026-08-22-responsive-site-footer.md` and `2026-08-21-landing-page-polish.md`; neither target nor
historical entry was changed by this task. Scoped scans cover all 25 changed files and found no
unsafe casts/suppressions, skipped tests, debug logs, secret-shaped additions or unexpected artifacts.

Real PostgreSQL tests cover migration hashes/snapshot linkage, empty and upgraded schemas,
authentication preservation, repeated migration, failed-DDL rollback and constraints. Persistence
tests cover account isolation, malformed/mismatched proofs, read proofs rejected for writes,
empty/saved-empty dashboards, incompatible/corrupt data and lossless escaped surrogate storage.
Controlled database lock waits verify revocation ordering and expiry after account and receipt
waits. Tests also exercise replacement, monotonic timestamps, absolute-expiry caps, actual lock
and statement timeouts, bigint precision/exhaustion, competing writes/retries, retained replay,
seven-day boundaries and deterministic receipt eviction at capacity.

Seven failure tests use real PostgreSQL transactions, owned SQL triggers and narrowly instrumented
driver calls. They verify rollback after dashboard mutation, receipt insertion, expiry deletion,
capacity eviction and session touch, plus failure before COMMIT and loss of the COMMIT response.
The latter executes COMMIT before injecting the failure, then recovers the original acknowledgement
using the unchanged request. No test substitutes fake persistence for these transaction guarantees.

Independent review inspected the actual code, generated SQL/metadata and committed Job 5A
integration. Two substantive findings were corrected:

- A retained-receipt lock could wait past session expiry. The adapter now refreshes time and
  revalidates expiry immediately after that wait; a controlled PostgreSQL regression verifies an unauthenticated
  persistence outcome without receipt/activity mutation.
- The original COMMIT test instrumentation bound the driver method to its prototype, preventing
  execution of the intended transaction path. It now invokes the original method with the actual
  client, and the tests verify committed state plus unchanged-request recovery.

Independent re-review found both corrections resolved and no remaining substantive defect in the
reviewed production scope. The review also noted two custom-composition limits: this adapter reads
against the default immutable catalogue, and custom applications should inject both authentication
and dashboard services together. The local root Vercel composition already uses the default
catalogue and supplies both services from one provider. No Job 5A contract redesign was required.

## Remaining production gates

Local PostgreSQL and Node tests do not establish real Google login, HTTPS cookie delivery,
Neon compatibility, Vercel routing or Fluid Compute lifecycle behavior. Those remain separate
authorized integration gates, along with the external Google-start rate limit and the existing
development-only esbuild advisory. No deployment, production migration, external Vercel change,
frontend accounts/workspaces, guest adoption, automatic sync/retry or conflict UI is included.

## Changed files

- `api/[...path].ts`
- `apps/api/drizzle/0001_dashboard_persistence.sql`
- `apps/api/drizzle/meta/0001_snapshot.json`
- `apps/api/drizzle/meta/_journal.json`
- `apps/api/src/app.test.ts`
- `apps/api/src/app.ts`
- `apps/api/src/dashboard-http.integration.test.ts`
- `apps/api/src/dashboard-http.test.ts`
- `apps/api/src/index.ts`
- `apps/api/src/persistence/dashboard-concurrency.integration.test.ts`
- `apps/api/src/persistence/dashboard-failures.integration.test.ts`
- `apps/api/src/persistence/dashboard-migrations.integration.test.ts`
- `apps/api/src/persistence/dashboard-persistence.integration.test.ts`
- `apps/api/src/persistence/postgres/adapter.ts`
- `apps/api/src/persistence/postgres/dashboard-adapter.ts`
- `apps/api/src/persistence/postgres/session-sql.ts`
- `apps/api/src/persistence/runtime.ts`
- `apps/api/src/persistence/schema.ts`
- `apps/api/src/runtime-composition.test.ts`
- `apps/api/src/runtime.ts`
- `docs/ACCOUNT_SYNC.md`
- `docs/ARCHITECTURE.md`
- `docs/DASHBOARD_PERSISTENCE.md`
- `docs/work-sessions/2026-09-13-dashboard-postgres-persistence.md`
- `docs/work-sessions/README.md`
