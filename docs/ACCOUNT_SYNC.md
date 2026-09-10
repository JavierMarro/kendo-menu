# Accounts and synchronization

Documentation baseline: 2026-09-10. **No operational authentication or synchronization exists.**
Job 4A adds local PostgreSQL authentication persistence; it is not connected to HTTP requests.
The owner separately authorized the Job 3 local API scaffold and accepted the stack below.
This does not authorize provider provisioning, credentials, production configuration, or deployment.

The owner-supplied **KendoMenu cloud-readiness decision memo — 8 September 2026** is discovery
evidence, not an accepted architecture. Its recommendation to defer a backend was superseded by
the owner's later account/synchronization decisions. Its findings about validation, character versus
byte limits, cache isolation, and operational responsibility still apply. The memo was supplied as
an attachment; no private attachment path or new product-demand claim is published here.

Current facts come from [production architecture](ARCHITECTURE.md),
[store persistence](../packages/store/src/persistence.ts),
[store construction](../packages/store/src/index.ts), and
[browser storage](../apps/web/src/lib/training-persistence.ts). Today the browser uses the `kendo-menu`
key, bounded v10 validation/migration, and whole-dashboard writes, without cloud revisions or
acknowledgements. Custom snapshots have a two-level stored shape; built-ins are canonicalized from
the current catalogue. Recovery downloads exist, but an ordinary backup import workflow does not.
The [deployment runbook](runbooks/DEPLOYMENT.md) remains authoritative about repository-declared,
independently observed, owner-reported, and unverified deployment facts.

## 1. Approved decisions

The product decisions below and the Job 3 technical stack are owner accepted. Product and
operational recommendations remain unapproved until the jobs that implement them.

- Anonymous use remains fully supported and free. Google is the sole identity provider.
- KendoMenu owns an opaque server-side application session. Session credentials use Secure,
  HttpOnly cookies and never LocalStorage.
- Application sessions use seven-day idle expiry and 30-day absolute expiry; fresh authentication
  starts a new lifetime. Job 4B owns policy enforcement and credential generation/delivery.
- Google subject is the unique identity. A supplied verified Google email may replace nullable
  display metadata; missing or unverified email leaves existing metadata unchanged. First login
  without verified email stores null. Email is never unique identity; no name/photo is stored.
- Guest and authenticated workspaces remain separate.
- A blocking Yes/No adoption choice appears only when **a new KendoMenu account has an empty cloud
  dashboard and the browser contains an eligible, non-empty guest workspace**. No dismiss action
  is included. Exact eligibility for returning empty accounts remains unresolved.
- **Yes:** upload the complete validated guest dashboard, create the account cache, and delete the
  guest workspace only after server acknowledgement. **No:** preserve the hidden guest workspace;
  it reappears after logout.
- Signed-in dashboards use local-first, whole-dashboard synchronization. Cloud writes use optimistic
  revisions and never silently apply last-write-wins.
- No realtime connections, CRDTs, automatic field merging, collaboration, paid tiers, or public sharing.

See accepted ADRs [0002](adr/0002-identity-application-sessions.md),
[0003](adr/0003-workspaces-guest-adoption.md), and [0004](adr/0004-whole-dashboard-sync.md).
These are target decisions, not descriptions of current production functionality.

### Owner-accepted technical stack — Job 3

- Retain one TypeScript pnpm monorepo and the root lockfile; align backend and intended Vercel
  runtime with Node 24 LTS.
- Implement Elysia in `apps/api`, with a standalone Node entry using `@elysia/node` and a separate
  minimal root Vercel Function adapter using standard Request/Response handling.
- Keep `/api/*` in the existing Vercel project and origin, dispatched ahead of the SPA fallback.
- Later persistence uses Neon managed PostgreSQL, Drizzle's node-postgres integration and `pg`,
  with reviewed Drizzle SQL migrations. No database dependency, connection, or migration in Job 3.
- Later server-side Google authorization-code OIDC uses `google-auth-library`. KendoMenu opaque
  application sessions are stored as token hashes in PostgreSQL. Neither is implemented in Job 3.

See accepted [ADR 0005](adr/0005-node-elysia-api-foundation.md) for alternatives and consequences.
`@vercel/functions` remains uninstalled; `attachDatabasePool` integration is deferred until a
database-backed Vercel request path exists. Local HTTPS tooling and the remaining
product/operational recommendations below remain unapproved.

### Job 3 dependency evidence

The selected stable registry versions are Elysia 1.4.30, `@elysia/node` 1.4.6, and `tsx` 4.23.13.
Elysia requires TypeBox (`>=0.34.0 <1`), `openapi-types` (`>=12`), `file-type` (`>=20`), and
`exact-mirror` (`>=0.0.9`, also listed in Elysia's own dependencies). Explicitly selected peers are
TypeBox 0.34.52, `openapi-types` 12.1.3, `file-type` 22.0.2, and `exact-mirror` 0.2.7. The latter
matches Elysia's own range and requires TypeBox `^0.34.15`, avoiding an unnecessary second major. Optional Bun types are not required.
`@elysia/node` requires Elysia `>=1.4.0`. Elysia and its Node adapter publish no engine range;
`tsx` requires Node `>=18`, and `file-type` requires Node `>=22`. These metadata checks support
Node 24 selection but do not prove execution under Node 24. Reuse existing TypeScript/Vitest and
Node 24 types; the lockfile records the resolved inventory. Do not install later-job libraries.

Primary evidence: [Elysia Node adapter](https://elysiajs.com/integrations/node),
[Elysia Vercel/pnpm guidance](https://elysiajs.com/integrations/vercel),
[Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions),
[Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql),
[Drizzle migrations](https://orm.drizzle.team/docs/migrations),
[Google's maintained Node authentication library](https://github.com/googleapis/google-cloud-node-core/tree/main/packages/google-auth-library-nodejs),
[Supabase PostgreSQL](https://supabase.com/docs/guides/database/overview). Repository engines declare
`24.x`; local inspection observed `v25.2.1`, while CI declares `24.12.0`. Neither proves the deployed
Node version or a local Node 24 test run at the time of Job 3. Job 4A local Node 24 evidence is
recorded separately below.

### Application module and deployment seam

The local scaffold in `apps/api` exposes `createApp()` and its Request-handling interface without
starting a listener. It contains only fixed health behavior and JSON error responses, with
`Cache-Control: private, no-store`. The standalone entry supplies `@elysia/node`; the root Vercel
adapter delegates the original Request and Response without Node adapter or platform pool hooks.
Job 4A adds the separate persistence boundary described below; the HTTP scaffold still has no
authentication or database-backed request path.
[Vercel Node function formats](https://vercel.com/docs/functions/runtimes/node-js)

The checked-in configuration retains `apps/web/dist` and the SPA fallback, adding API dispatch
before that fallback. `GET /api/health` returns `{"status":"ok"}`; unknown API paths return JSON
404s. The frontend does not call the API. This is an implemented local scaffold, **not deployed
production functionality**.

**Deployment verification gate:** direct application/adapter tests and Vite browser tests do not
prove Vercel function discovery, workspace bundling, or combined API-before-SPA routing. No Vercel
CLI is installed locally, and the documented build workflow uses locally cached project settings
from `vercel pull`; no authentication, linking, settings/env download, or deployment is authorized.
Keep combined function artifact inspection, API health/404/cache behavior, static assets, and SPA
deep links as an explicit Preview gate for later authorized verification.
[Vercel local build](https://vercel.com/docs/cli/build)

Auth callbacks and cookie forwarding are separate later authentication-job gates. Never infer their
correctness from health tests or standalone Elysia auto-detection.

## 2. Connection strategy and remaining recommendations

### One database connection strategy

The accepted driver direction is PostgreSQL via **`pg` everywhere**, with Drizzle's node-postgres
integration. Job 4A implements the local pool, transaction, and migration foundation. Neon
endpoints, adoption, and Vercel execution remain later-job work:

- The local adapter caches a bounded `pg.Pool` per warm module instance (maximum 5, idle timeout
  5 seconds). A Neon pooled endpoint remains the later runtime target; no HTTP request uses it yet.
- The Vercel adapter does not attach a database pool. Defer `attachDatabasePool` until a
  database-backed request path exists, then verify its stable version and execution mode. Do not
  substitute a Neon HTTP/WebSocket driver.
- Conditional writes and adoption use real SQL transactions on the same checked-out connection.
  Release borrowed clients in `finally`; never run a transaction across independent `pool.query`
  calls. Do not call `pool.end()` per request or depend on connection-local state across requests.
- Migration execution uses a direct, non-pooled database endpoint, outside request handling, and
  closes its connection afterward. No application-start migration or automatic production schema push.
- Disposable local PostgreSQL uses the same `pg` driver, Drizzle queries, migrations, and transaction
  tests with a direct local endpoint. Pool lifecycle hooks are adapter-specific; tests close pools
  during teardown and do not need Neon accounts.

Evidence: [Neon pooling](https://neon.com/docs/connect/connection-pooling),
[node-postgres transactions](https://node-postgres.com/features/transactions), and
[Vercel connection lifecycle](https://vercel.com/kb/guide/connection-pooling-with-functions).
These support the strategy; the Job 4A evidence below separately records exact locally tested
versions without claiming Neon or Vercel compatibility.

### Product and operational defaults

**Owner confirmation required before the jobs implementing these behaviors**, not before the
isolated Job 3 health scaffold. Every row below remains a recommendation.

| Decision                     | Recommended default                                                                                                                                             | Main trade-off                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guest eligibility            | Non-empty guest data accepted by existing validation/migration and approved cloud byte bounds                                                                   | Reject corrupt, future-version, migration-conflicting, or oversized data without alteration; eligibility cannot silently shrink the approved complete-adoption promise.        |
| Returning empty accounts     | Do not automatically offer adoption                                                                                                                             | Avoid accidental reuse of another device/browser's guest dashboard; the exact eligibility policy still needs approval.                                                         |
| Synchronization triggers     | Debounce saved edits for one second; also check on reconnect/focus and explicit retry                                                                           | Simple foreground continuity without persistent connections or background-worker synchronization.                                                                              |
| Conflict interaction         | Pause uploads; explicit choice of local or cloud whole dashboard, with export/preservation before discarding the losing local copy                              | More visible friction, but no silent loss or field merging.                                                                                                                    |
| Account cache/offline access | Retain account-scoped data hidden on logout; reopen only after reauthentication; an already-open account workspace remains editable offline with uploads paused | Supports continuity but retains readable data on a shared browser; a fresh uncached device cannot load cloud data offline.                                                     |
| Logout/account switching     | Preserve pending account-scoped edits, stop uploads, hide account data, and reveal the guest workspace; disclose unsynchronized work                            | Prioritizes local work retention over clearing all account data on logout. Offline logout remains locally immediate, with revocation completed before later authenticated use. |
| Cloud payload budget         | Maximum 2 MiB UTF-8 for the complete request envelope; reject whole requests over it                                                                            | Some currently valid guest dashboards may not be eligible; owner acceptance is required before narrowing cloud eligibility.                                                    |
| Region                       | Colocate API and database in an EU region offered by both providers                                                                                             | Reduces regional latency and unnecessary transfers, but does not establish legal jurisdiction or compliance.                                                                   |
| Operating owner and cost     | Repository owner operates it; start a non-production evaluation on available free allocations with no automatic paid upgrade                                    | Keeps a personal project proportionate; free quotas and durability may not meet production recovery needs. Approve a numeric spending ceiling before provisioning.             |
| Recovery and retention       | Keep the current cloud dashboard; daily recoverable database backup, seven-day backup retention, 24-hour recovery-point and 48-hour recovery-time targets       | No user-facing historical versions; provider plan capabilities and cost must be checked rather than promised.                                                                  |
| Account deletion             | Immediate access revocation and primary account/dashboard deletion; expire backups through the approved retention window, no grace period                       | Simpler lifecycle with limited undo; offline copies cannot be remotely guaranteed erased and are removed on next verified contact.                                             |
| Encryption                   | TLS and provider-managed encryption at rest, without application end-to-end encryption                                                                          | Simpler recovery and validation; the provider/operator may access stored data.                                                                                                 |

The local serializer limits `.length` to 2,097,152 UTF-16 code units and permits 128 dashboard
entries. This is not a 2 MiB network-byte guarantee: Unicode JSON can exceed the proposed byte budget
and [Vercel's 4.5 MB request/response limit](https://vercel.com/docs/functions/limitations).
Measure actual UTF-8 bytes including metadata. Never truncate, upload a subset, or remove the guest
workspace to fit. If the owner requires every locally valid dashboard to be adoptable, the byte cap
and transport/hosting recommendation must be revised before implementation.

### Implementation requirements — not separate owner decisions

These are routine security and correctness obligations. They are not additional accepted ADR
choices or individual permission questions; apply them when the relevant implementation is authorized.

**Authentication controls**

- Use server-side authorization-code OIDC with minimal identity scopes. Generate unpredictable,
  single-use OAuth state, OIDC nonce, and PKCE S256; bind them to the initiating browser's short-lived
  login transaction (ten-minute maximum) and consume it once. Reject missing, expired, or mismatched
  values and replay. Verify signature, issuer, audience, expiry, and nonce; map identity by Google
  subject, not mutable email. Do not retain Google refresh tokens or unnecessary access tokens.
- Use exact configured callback allowlists per environment and allowlisted application-relative
  return paths. Reject arbitrary absolute/protocol-relative redirects; never derive trusted origins
  from unchecked Host/forwarded headers. No wildcard preview callback registration.
- Require a session-bound CSRF token in a custom header plus exact Origin validation for
  state-changing cookie-authenticated requests; reject missing/invalid checks. Ordinary dashboard
  and authenticated API GETs must not mutate state. The OAuth callback is the explicit
  state-changing GET that creates the application session, protected by its single-use browser-bound
  state, nonce, and PKCE login-transaction controls.
  SameSite is defense in depth, not the sole CSRF control. Keep CSRF tokens out of URLs/logs.
- Generate a fresh high-entropy opaque application-session identifier after authentication and
  invalidate the preceding identifier. Store only its hash server-side; enforce revocation and
  expiry on every authenticated operation. Authorize every dashboard operation for the account
  established by the session, not a client-supplied account identifier.
- Production and preview session cookies are host-only `__Host-` cookies with Secure, HttpOnly,
  SameSite=Lax, and Path=/, without Domain. Use local HTTPS and equivalent attributes for development
  and browser integration tests; do not silently turn Secure off for HTTP. Provider login secrets,
  codes, tokens, or session credentials never enter LocalStorage, dashboard data, or client bundles.
- Application logs use fixed error codes and non-sensitive request identifiers, not request/response
  dumps. Exclude Cookie/Authorization/Set-Cookie headers, credentials, codes, tokens, callback query
  values, and dashboard contents from logs, traces, and analytics. Disable or redact provider access
  logging that captures sensitive callback queries; inspect that behavior before live authentication.
  Keep the callback free of third-party content and use a no-referrer policy. Existing third-party
  script access to authenticated pages requires review; HttpOnly does not protect dashboard data
  or prevent injected JavaScript from issuing authenticated requests.

References: [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect),
[OWASP CSRF controls](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html),
[OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

**Workspace, adoption, and synchronization correctness**

- Put workspace selection, account-specific storage keys, and adoption recovery behind one workspace
  module. Put revision checks, acknowledgement tracking, pending snapshots, and retries behind a
  synchronization module. Inject storage/transport/identity/database/clock dependencies at testable
  seams; do not replace Zustand storage with network storage or spread reconciliation through JSX.
- Preserve the guest key/data during migration. An account cache is data, not proof of authentication.
  Switching accounts resets in-memory state and ignores late responses belonging to the previous
  account. Coordinate tabs so shared cookies cannot upload account A's edits into account B; every
  write also carries its expected workspace identity, which the server must match to the
  session-authenticated account. This is a mismatch guard, never an authorization source.
- Keep local schema version, transport version, cloud revision, and local edit generation distinct.
  A proposed read returns a validated dashboard plus revision; a write supplies the full validated
  snapshot, expected revision, and stable request identifier. Success acknowledges the committed
  revision/request; a conflict does not mutate cloud or discard local state.
- Validate server-side independently, preserving IDs, custom snapshots, order, notes, quantities,
  and the distinction between absent overrides and zero. Reject unsupported shapes/catalogue
  compatibility rather than silently dropping content; do not promise historical built-in text.
- Perform compare-and-write and acknowledgement/idempotency recording atomically. Repeating the
  same account/request identifier with the same payload returns the original result; reusing it for
  different content fails. One in-flight write and a coalesced newer pending snapshot prevent an old
  acknowledgement from marking newer edits clean. Bound retries with backoff; stop on conflicts,
  validation failures, or expired authentication instead of looping.
- Adoption requires the server to atomically check that the cloud dashboard is still empty and
  accept the complete validated snapshot. A concurrent cloud write must not be overwritten. Persist
  the acknowledged account cache and recoverable adoption progress before guest deletion. Delete
  only the guest snapshot actually adopted; concurrent guest edits remain protected. LocalStorage
  does not provide a multi-key transaction, so interrupted transitions must resume idempotently.
- Lost responses, server rejection, storage quota errors, and cache-write failure keep the guest
  data recoverable. Do not report adoption complete or delete guest data before acknowledgement and
  successful account-cache persistence. The blocking choice remains Yes/No, with no invented dismiss.
- Deletion-versus-edit and stale tabs must yield revision conflicts rather than silently resurrecting
  entries. Revalidate the latest revision before a user-confirmed whole-dashboard replacement.
- Authenticated responses, session/bootstrap responses, and callbacks use private/no-store caching;
  neither the CDN nor service worker caches them. Network failures must not produce a cached
  authenticated response from another account or a successful SPA HTML response to an API request.

## Job 4A — local authentication persistence

The API persistence boundary owns three PostgreSQL tables: users identified by immutable unique
Google subject; single-use browser-bound login transactions; and application sessions linked to an
internal user UUID. Email is nullable mutable metadata with no uniqueness constraint. Session and
CSRF values enter persistence only as SHA-256 hashes. Google name/photo, provider tokens,
authorization codes, ID tokens, and dashboard data are absent.

Login transactions store hashes of state/browser binding/nonce, the callback's required PKCE
verifier, and a bounded application-relative return path defaulting to `/`. Job 4B validates return
paths against its allowlist before persistence. Transactions last at most ten minutes. Atomic
consumption distinguishes missing, expired, consumed, and binding-mismatch outcomes and clears
callback material on success. Explicit cleanup removes at most 100 rows per call after their expiry
is at least ten minutes past; replay classification is available while the marker remains. There is
no timer or background service. PKCE verifier storage is the intentional callback-secret exception;
raw state, nonce, browser binding, session tokens, and CSRF tokens are never persisted.

Session lookup excludes revoked and expired records without recording activity. Explicit activity
updates remain monotonic and cap idle expiry at absolute expiry. Timestamp ordering and validity
are constrained in SQL; seven-day/30-day duration policy belongs to Job 4B's session module, not
permanent SQL constraints. Explicit session replacement validates and locks the expected same-user
active predecessor, inserts its replacement, and revokes the predecessor in one transaction;
failure rolls back everything. CSRF generation and delivery also belong to Job 4B.

### Local commands and environment

All backend commands inherit exported process environment variables. Vite does not load backend
variables, and these commands do not automatically read environment files. The tracked root
`.env.example` contains comments and empty placeholders only. Supply credentials privately through
the process environment; never place connection strings in command arguments, chat, logs, or docs.

- `DATABASE_URL`: lazy runtime persistence connection; unnecessary for health or unit tests.
- `MIGRATION_DATABASE_URL`: direct connection used only by `pnpm db:migrate`.
- `TEST_DATABASE_URL`: local `kendomenu_test` connection required by `pnpm test:api:integration`.
- `pnpm db:generate`: generate SQL and Drizzle metadata after schema edits; review generated SQL,
  including search-path-safe references, before applying. No connection is needed.
- `pnpm db:check`: validate the migration metadata chain without a database.
- `pnpm db:migrate`: apply reviewed migration files on a dedicated connection, closing it afterward.
  Migrations never run on import, startup, or requests. Do not use schema push as migration strategy.
- `pnpm test:api:persistence`: database-independent unit tests.
- `pnpm test:api:integration`: real PostgreSQL migrations, queries, constraints, and transactions.
  Missing configuration fails explicitly. The harness accepts only a local test database, confirms
  its identity, creates unique schemas for tables and migration bookkeeping, and removes only
  run-owned resources. It never resets the database or shared public schema.

Runtime pools are lazy and cached per module instance, with maximum five connections and a
five-second idle timeout. Checked-out clients are released in finally blocks; transaction operations
share one client. Shutdown belongs to process/test lifecycle, never an individual request.

### Locally verified — Job 4A, 2026-09-10

Node 24.12.0 executed the API and persistence checks using the official checksum-verified temporary
runtime; no installed Node configuration changed. PostgreSQL was **17.11 (Postgres.app)** in the
owner-created `kendomenu_test` database. No development, Neon, Vercel, or production database was
migrated. Each real integration test uses a fresh uniquely named schema and checks normal teardown.

| Command                                              | Result                                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:api:persistence`                          | PASS: 12 database-independent tests                                                                                                       |
| `pnpm test:api:integration`                          | PASS: 30 real PostgreSQL tests, including migration from empty schemas, repeat migration, concurrency, constraints, rollback, and cleanup |
| `env -u TEST_DATABASE_URL pnpm test:api:integration` | Expected exit 1 with a fixed configuration error; no silent skip                                                                          |
| `pnpm db:generate`                                   | PASS: initial reviewed SQL/metadata generated; repeat reports no schema changes                                                           |
| `pnpm db:check`                                      | PASS: migration metadata chain                                                                                                            |
| `pnpm check:api`                                     | PASS: strict types, lint, 47 API/unit tests, root adapter checks                                                                          |
| `pnpm check`                                         | PASS: 343 unit tests, types, lint, formatting, and production web build                                                                   |

These pnpm runs set `pnpm_config_verify_deps_before_run=false` to prevent pnpm 11 from automatically
reinstalling dependencies when switching runtime/store context, and prepend the temporary Node 24
binary directory to PATH. This changes dependency-repair behavior only; no test/check is bypassed.
Local socket permission was required for tsx IPC and PostgreSQL. Earlier integration fixture failures
were corrected: an idle-expired session cannot be revived, and cleanup assertions need isolated
fixtures. Node 25.2.1 review checks provide separate useful evidence, not Node 24 verification.

Independent review covered schema/migrations, concurrency/rollback, secrets/error leakage, pool and
client lifecycle, test validity, and scope. Findings about stale activity, replacement timestamps,
client-close error reporting, and documentation were resolved. The final technical review found no
remaining defects. Session history, targeted formatting, diff, and secret/debug/unsafe-type/artifact
scans passed. A documentation-link scan found two pre-existing broken history-index links, left
unchanged: `2026-08-22-responsive-site-footer.md` and `2026-08-21-landing-page-polish.md`.

The approved dependency set has now executed locally under Node 24; deployed Node compatibility and
Vercel lifecycle behavior remain unverified. `pnpm db:migrate` was not run against a shared schema:
the integration suite exercises the same dedicated-connection migration function in isolated schemas.

### Dependency evidence and remaining gates

Selected exact versions: `drizzle-orm` 0.45.2, `drizzle-kit` 0.31.10, `pg` 8.23.0, and `@types/pg`
8.23.1. Published metadata accepts `pg >=8` for Drizzle; pg's Node `>=16` engine permits Node 24 but
does not prove compatibility. ORM and Kit publish no Node engine range. Optional alternative
drivers are not installed. Local Node 25 results are useful evidence, not Node 24 verification.
Primary sources: [ORM metadata](https://registry.npmjs.org/drizzle-orm/0.45.2),
[Kit metadata](https://registry.npmjs.org/drizzle-kit/0.31.10),
[pg metadata](https://registry.npmjs.org/pg/8.23.0),
[types metadata](https://registry.npmjs.org/@types%2fpg/8.23.1),
[Drizzle node-postgres integration](https://orm.drizzle.team/docs/get-started-postgresql), and
[Drizzle migrations](https://orm.drizzle.team/docs/migrations).

Dependency audit: the selected Kit dependency tree includes development-only esbuild 0.18.20
through `@esbuild-kit/esm-loader` and `@esbuild-kit/core-utils`. `pnpm audit` reports the moderate
[esbuild development-server advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99).
This job runs migration generation/checking, not esbuild's serve feature; no development server is
exposed by these commands. The approved versions remain pinned without an unreviewed override.
The audit finding remains recorded for a later compatible tooling update.

`@vercel/functions` remains uninstalled. Official [Vercel pooling guidance](https://vercel.com/kb/guide/connection-pooling-with-functions)
describes pg with Fluid compute, but `attachDatabasePool` integration and actual lifecycle testing
remain deferred until a database-backed Vercel request path exists. No package version or platform
compatibility is asserted here. Neon is neither provisioned nor connected. Local HTTPS, Google
credentials/verification, callbacks, state/nonce/PKCE generation, cookies, CSRF delivery, session
HTTP endpoints, provider-log redaction, and production verification remain Job 4B or later gates.

## 3. Remaining gates for later jobs

### Owner decisions

Confirm or revise the remaining recommendations before their implementation:

- [x] Elysia/Neon/Drizzle/Google library selection, Node 24 alignment, and same-project hosting
      accepted in Job 3; later libraries are not installed or implemented by the health scaffold.
- [ ] Local HTTPS tooling before authentication development; pool tooling remains provisional.
- [ ] Guest eligibility (including returning empty accounts), cloud byte limits, and consequences
      for locally valid but oversized guest data; preserve the approved blocking Yes/No interaction.
- [ ] Conflict interaction, synchronization triggers, offline account access, cache retention,
      unsynchronized logout, and account-switch behavior.
- [x] Application-session lifetime and verified-email metadata policy accepted in Job 4A.
- [ ] Account deletion, retention, remaining device copies, and encryption expectations.
- [ ] Provider/API regions, operational responsibility, budget, recovery requirements, and processor
      terms/jurisdiction assessment. Recommendations do not establish provider guarantees.

### Engineering feasibility gates — evidence, not owner votes

Before each later job installs dependencies, verify exact stable versions, engines and peers
against Node 24. `@vercel/functions` is uninstalled and no version is asserted here. When a
database-backed Vercel request path exists, verify `attachDatabasePool` compatibility and actual
execution-mode behavior. Local pg/Drizzle behavior is tested on PostgreSQL 17.11; Neon endpoint,
major-version, region, and lifecycle compatibility remain unverified. Do not mix in another driver.

Before declaring the deployment seam ready, complete the Preview gate above. In the later
authentication job, additionally test auth callbacks, cookie forwarding, and no-cache behavior.
No infrastructure or production changes are authorized by this document. Confirm Google callback
environment isolation and provider log redaction before real credentials or users; if either cannot
be demonstrated, stop that integration.

### Required future tests and Job 2 validation

Future implementation acceptance covers:

- Eligibility matrix: new/returning account, empty/non-empty cloud, empty/eligible/invalid guest;
  the corrected new-account condition and keyboard-accessible blocking Yes/No interaction.
- Adoption Yes/No, lost acknowledgement, duplicate retries, cache failure, crash between local
  steps, concurrent guest edits, and another device making the cloud dashboard non-empty.
- Two devices writing one revision, deletion versus stale edits, explicit conflict resolution,
  acknowledgement arriving after newer local edits, offline/reconnect, and expired sessions.
- Cross-account/tab isolation, unsynchronized logout, inaccessible hidden caches, and no automatic
  guest combination. Test approved cache/offline policy once selected.
- OAuth state/nonce/PKCE mismatch and replay, redirect rejection, CSRF, fixation/rotation,
  revocation/expiry, production-equivalent HTTPS cookies, and absence of secrets/content in logs.
- Real disposable PostgreSQL migration/transaction rollback and concurrency; identical `pg` queries
  across local and Neon adapters. Routine tests fake Google at the identity seam, not dashboard SQL.
- Unicode byte limits, v10 migration/future-version rejection, whole-dashboard round trips, API
  response semantics versus SPA fallback, and authenticated-response no-cache rules.

Job 2 validates documentation only: independently review decision status and safety; check relative
links, ADR numbering, terminology, and owner-decision coverage; run targeted Prettier,
`git diff --check`, and `pnpm session:check`. Disable pnpm's automatic dependency repair for these
commands if needed. Finish with an at-most-eight-line work-session entry and history index.
No implementation tests, provider provisioning, live authentication, or deployment are claimed.
