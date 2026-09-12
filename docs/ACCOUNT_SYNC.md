# Accounts and synchronization

Documentation baseline: 2026-09-11. **No production authentication or synchronization exists.**
Job 4B connects local Google OIDC and opaque-session HTTP behavior to Job 4A PostgreSQL persistence;
real Google, Neon, HTTPS-browser, and Vercel integration remain unverified.
Job 5A adds an unregistered protected dashboard application foundation and shared authorization;
it does not add dashboard SQL persistence or reachable dashboard endpoints.
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
- Job 5A accepts a complete cloud-write limit of 2,097,152 UTF-8 bytes, including metadata,
  whitespace and JSON escapes. Locally valid Unicode-heavy dashboards may exceed that limit.
  Retain at most 1,024 successful-write receipts per account; seven days is cleanup eligibility,
  not a hard replay deadline. Check retained IDs before cleanup; only new successful writes clean up.
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
Job 4B installs `@vercel/functions` and attaches the lazy database pool at root Vercel composition.
Actual Fluid Compute lifecycle remains a live-integration gate. Local HTTPS tooling and the remaining
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
Node 24 types; the lockfile records the resolved inventory. Later dependency additions are recorded
under their implementing jobs below.

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

The application in `apps/api` exposes `createApp({ authentication })` and its Request-handling
interface without starting a listener. Job 4B adds authentication/session routes behind an injected
module, preserving fixed health and JSON errors with `Cache-Control: private, no-store`. The
standalone entry supplies `@elysia/node`; the root Vercel adapter delegates the same application
behavior and supplies its pool attachment hook. Runtime configuration and database pools remain lazy.
[Vercel Node function formats](https://vercel.com/docs/functions/runtimes/node-js)

The checked-in configuration retains `apps/web/dist` and the SPA fallback, adding API dispatch
before that fallback. `GET /api/health` returns `{"status":"ok"}`; unknown API paths return JSON
404s. The frontend does not call the API. This is implemented local backend behavior, **not deployed
production functionality**.

**Deployment verification gate:** direct application/adapter tests and Vite browser tests do not
prove Vercel function discovery, workspace bundling, or combined API-before-SPA routing. No Vercel
CLI is installed locally, and the documented build workflow uses locally cached project settings
from `vercel pull`; no authentication, linking, settings/env download, or deployment is authorized.
Keep combined function artifact inspection, API health/404/cache behavior, static assets, and SPA
deep links as an explicit Preview gate for later authorized verification.
[Vercel local build](https://vercel.com/docs/cli/build)

Live auth callbacks and browser cookie forwarding remain integration gates. Request-based tests do
not prove browser HTTPS or provider behavior; never infer those from health tests or auto-detection.

## 2. Connection strategy and remaining recommendations

### One database connection strategy

The accepted driver direction is PostgreSQL via **`pg` everywhere**, with Drizzle's node-postgres
integration. Job 4A implements the local pool, transaction, and migration foundation. Neon
endpoints, adoption, and Vercel execution remain later-job work:

- The local adapter caches a bounded `pg.Pool` per warm module instance (maximum 5, idle timeout
  5 seconds). A Neon pooled endpoint remains the later runtime target; no request uses Neon yet.
- Job 4B attaches the lazy pg pool exactly once at root Vercel composition; actual Fluid Compute
  suspension/idle-connection behavior remains a Preview or live-integration gate.
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
| Region                       | Colocate API and database in an EU region offered by both providers                                                                                             | Reduces regional latency and unnecessary transfers, but does not establish legal jurisdiction or compliance.                                                                   |
| Operating owner and cost     | Repository owner operates it; start a non-production evaluation on available free allocations with no automatic paid upgrade                                    | Keeps a personal project proportionate; free quotas and durability may not meet production recovery needs. Approve a numeric spending ceiling before provisioning.             |
| Recovery and retention       | Keep the current cloud dashboard; daily recoverable database backup, seven-day backup retention, 24-hour recovery-point and 48-hour recovery-time targets       | No user-facing historical versions; provider plan capabilities and cost must be checked rather than promised.                                                                  |
| Account deletion             | Immediate access revocation and primary account/dashboard deletion; expire backups through the approved retention window, no grace period                       | Simpler lifecycle with limited undo; offline copies cannot be remotely guaranteed erased and are removed on next verified contact.                                             |
| Encryption                   | TLS and provider-managed encryption at rest, without application end-to-end encryption                                                                          | Simpler recovery and validation; the provider/operator may access stored data.                                                                                                 |

The local serializer limits `.length` to 2,097,152 UTF-16 code units and permits 128 dashboard
entries. This is not a 2 MiB network-byte guarantee: Unicode JSON can exceed the accepted byte budget
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

At the end of Job 4A, `@vercel/functions` was uninstalled. Official [Vercel pooling guidance](https://vercel.com/kb/guide/connection-pooling-with-functions)
describes pg with Fluid compute, but `attachDatabasePool` integration and actual lifecycle testing
remain deferred until a database-backed Vercel request path exists. No package version or platform
compatibility is asserted here. Neon is neither provisioned nor connected. Local HTTPS, Google
credentials/verification, callbacks, state/nonce/PKCE generation, cookies, CSRF delivery, session
HTTP endpoints, provider-log redaction, and production verification were deferred to Job 4B or later gates; current implementation evidence is recorded below.

## Job 4B — local Google OIDC and opaque application sessions

The backend exposes Google start/callback and session GET/DELETE through one injected authentication
module. There is no frontend authentication UI or synchronization. The Google adapter uses the
official library for authorization URL creation, PKCE code exchange, and signature verification;
only validated subject and nullable verified email leave that adapter. Provider tokens are never
application credentials and are not stored, returned, or logged. Minimum scopes are `openid email`;
offline access and profile data are not requested.

Start defaults an absent `returnPath` to `/`. A supplied parameter must occur once and decode once
to `/` (`%2F` is accepted); malformed, double-encoded, duplicate, empty, and other destinations fail
before persistence. State, nonce, browser binding, PKCE, session, and CSRF values each use 32 secure
random bytes. Login transactions expire after ten minutes and are consumed before exchange. Stored
return paths are revalidated. Each start request first performs bounded cleanup of old transactions;
production exposure still requires an external request-rate limit because cleanup is not burst
control. The authorization URL and all returned security parameters are validated before callback
secrets are persisted. Claims require the configured audience, permitted Google issuer,
finite integer `iat`/`exp` with `iat < exp`, strict expiration at `now >= exp`, issuance no more than
300 seconds in the future, valid ASCII subject, and hashed nonce equality. Only literal boolean
`email_verified === true` permits bounded email metadata.

Fresh authentication creates new credentials and seven-day idle/30-day absolute deadlines. A
malformed optional predecessor is treated as absent so a valid login can overwrite unusable browser
credentials. An
active same-user predecessor is replaced atomically; an active other-user predecessor produces
`ACCOUNT_SWITCH_REQUIRES_LOGOUT` without changing that session. GET returns only internal `userId`
and nullable `verifiedGoogleEmail`, never updates activity, and never renews a cookie. Explicit touch
remains reserved for later authenticated writes. Logout requires the exact configured Origin and
`X-CSRF-Token`, matches both credential hashes to one active session, and revokes before clearing.
Indeterminate storage failures return fixed 503 errors and preserve potentially valid application
cookies. Invalid sessions return 401 and clear both application cookies; Origin/CSRF failures use 403.

| Cookie                     | Attributes                                            | Lifetime                  |
| -------------------------- | ----------------------------------------------------- | ------------------------- |
| `__Host-kendomenu-login`   | Secure, HttpOnly, SameSite=Lax, Path=/, no Domain     | At most ten minutes       |
| `__Host-kendomenu-session` | Secure, HttpOnly, SameSite=Lax, Path=/, no Domain     | Absolute session deadline |
| `__Host-kendomenu-csrf`    | Secure, not HttpOnly, SameSite=Lax, Path=/, no Domain | Absolute session deadline |

Issued cookies use the exact absolute `Expires` deadline without positive `Max-Age`, so response
transit cannot restart a relative lifetime. Clearing preserves matching attributes and supplies
`Max-Age=0` plus an expired `Expires`. Every
terminal callback clears the login cookie. All authentication responses, including errors and
redirects, use `Cache-Control: private, no-store`; callbacks also use `Referrer-Policy: no-referrer`.
Application logs contain only generated non-sensitive request IDs and fixed internal error codes.
Explicit `HEAD` handlers reject all authentication routes with 405 and no cookie mutation; this
prevents the framework's automatic GET fallback from clearing credentials.

### Configuration, dependencies, and runtime

The empty `.env.example` placeholders add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI`, and `APP_ORIGIN`. Configuration is server-only and evaluated per operation:
start/callback need all four values plus persistence, GET needs persistence only, and DELETE needs
persistence plus `APP_ORIGIN`. Google configuration outages do not invalidate existing sessions.
Configured URLs must be exact HTTPS values. The Google callback must use the exact `APP_ORIGIN`, its
path must be `/api/auth/google/callback`, and both start and callback requests must arrive on that
origin. No request header defines a trusted origin or callback URI, and no command automatically
loads environment files.

Exact additions are `google-auth-library` **11.0.2** (API dependency, Node `>=22`) and
`@vercel/functions` **3.9.7** (root dependency, Node `>=20`). The inspected published engine ranges
permit Node 24; execution evidence is recorded separately. pnpm added exact release-age exceptions
for `@vercel/functions@3.9.7` and its `@vercel/oidc@3.8.7` and `@vercel/cli-config@0.2.6`
dependencies. These are package-specific exceptions, not a global policy relaxation. Optional AWS
and websocket peers are not added as new direct dependencies. The Job 4B dependency audit reports
only the previously documented moderate development-only esbuild advisory; no high or critical
advisories were reported.

Primary evidence: [Google package metadata](https://registry.npmjs.org/google-auth-library/11.0.2),
[Google library documentation](https://github.com/googleapis/google-cloud-node/tree/main/core/packages/google-auth-library-nodejs),
[Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect),
[Vercel package metadata](https://registry.npmjs.org/@vercel%2ffunctions/3.9.7),
[Vercel Functions API](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package),
and [Vercel pool guidance](https://vercel.com/kb/guide/connection-pooling-with-functions).

Root Vercel composition supplies `attachDatabasePool`; lazy initialization caches one pending
initialization for concurrent requests and attaches once per pool. Hook failure attempts pool close,
leaves it uncached, and returns a fixed unavailable failure; later requests may retry. Health,
imports, and builds never need a database connection. The authentication contract sees only
`KendoPersistence`; the concrete PostgreSQL runtime exposes its pool solely for composition.
The migration remains unchanged. A read-only public-user lookup supplies session metadata.

The pinned Node adapter's response-header conversion drops repeated `Set-Cookie` fields. Node
composition therefore retains `@elysia/node` transport/listening and uses Elysia's standard response
mapping. Tests assert all callback and clearing cookies through the Node composition and an actual
loopback listener; no dependency upgrade or framework change is introduced.

### Local verification

Verification ran under Node 24.12.0 with pnpm dependency auto-repair disabled. `pnpm check:api`
passed 224 tests plus API/root composition TypeScript and lint checks. `pnpm check` passed all 520
workspace tests, typechecking, lint, formatting, session-history validation, and the production web
build. `pnpm test:api:integration` passed 44 tests against the configured local `kendomenu_test`, using
unique harness-owned schemas. Running that command without `TEST_DATABASE_URL` failed explicitly
with `TEST_DATABASE_URL_REQUIRED_LOCAL_KENDOMENU_TEST`; no database tests were skipped.
`pnpm db:check` passed with no migration change. `pnpm audit --prod` found no known production
dependency vulnerabilities; the full audit retained only the documented moderate development-only
esbuild advisory. Changed-file scans found no debug logging,
unsafe type escapes, skipped tests, secret-shaped material, or generated artifacts; the only
changed environment file is the empty-placeholder `.env.example`.

Independent review identified unsafe automatic HEAD handling, malformed-predecessor recovery,
missing production cleanup use, origin coupling, incomplete expiry-boundary coverage, and the
listener-level cookie gap. These were corrected with regression coverage. Additional audit
hardening validates every security-bearing authorization URL parameter before persistence. Google
library request logging interceptors are disabled, token expiry is checked against the clock after
verification, and repeated Node response cookies are preserved.
Browser E2E/release suites were not run for this backend-only slice; real environment gates remain
below.

### Remaining live-integration gates

Local deterministic Google tests and Request/Response cookie assertions do not prove real Google
login or HTTPS browser delivery. Later separately authorized integration must verify isolated Google
callback registration, provider/hosting log redaction, consent and real ID-token verification,
Secure cookie forwarding/clearing, same-origin CSRF behavior, and combined Vercel API/static/SPA
routing and headers. Neon endpoint/version/region compatibility, connection behavior, and actual
Fluid Compute suspension/idle-pool lifecycle remain unverified. No Neon resource, Vercel setting,
real credential, production state, or shared database schema is changed by this job.
Apply an external request-rate limit to the public Google start route before production credentials
make it reachable; bounded expired-row cleanup limits retention but is deliberately not a burst-rate
control.

## Job 5A — protected dashboard application foundation

The [foundation handoff](DASHBOARD_FOUNDATION.md) records the established transport types, strict
codec, canonical representation, HTTP outcomes and protected persistence obligations. The API
consumes a domain workspace dependency, with no new third-party package. Historical store
migrations and the local character ceiling remain unchanged. The complete request envelope is
byte-bounded after authorization, decoded as strict UTF-8 and lexically checked before JSON.parse.
Canonicalization preserves unpaired surrogates as escapes before UTF-8 hashing.

Session GET and logout now use shared read/write authorization. Logout additionally requires the
CSRF cookie to equal the header, with both bound to the authenticated session. No authorization
read or retained-replay application path touches activity. The handler passes a server-established
proof and validated immutable intent to injected persistence; catalogue checks for new writes remain
separate from structural validation so the later adapter can recover retained acknowledgements.

`/api/dashboard` remains JSON 404 in the production application and runtime adapters. No dashboard
schema, migration `0001`, PostgreSQL dashboard adapter, or runtime composition is included. Job 5B
requires the owner-committed, independently reviewed Job 5A state. Fake-persistence tests establish
HTTP behavior, not database transaction/revision/receipt guarantees. Local authentication database
tests retain their existing isolated-schema harness; no production migration is run.

## 3. Remaining gates for later jobs

### Owner decisions

Confirm or revise the remaining recommendations before their implementation:

- [x] Elysia/Neon/Drizzle/Google library selection, Node 24 alignment, and same-project hosting
      accepted in Job 3; later libraries are not installed or implemented by the health scaffold.
- [ ] Local HTTPS tooling before real browser/provider integration; Fluid Compute lifecycle remains unverified.
- [x] Cloud byte limit and consequences for locally valid oversized dashboards accepted in Job 5A.
- [ ] Guest eligibility (including returning empty accounts); preserve the approved blocking Yes/No interaction.
- [ ] Conflict interaction, synchronization triggers, offline account access, cache retention,
      unsynchronized logout, and account-switch behavior.
- [x] Application-session lifetime and verified-email metadata policy accepted in Job 4A.
- [ ] Account deletion, retention, remaining device copies, and encryption expectations.
- [ ] Provider/API regions, operational responsibility, budget, recovery requirements, and processor
      terms/jurisdiction assessment. Recommendations do not establish provider guarantees.

### Engineering feasibility gates — evidence, not owner votes

Before each later job installs dependencies, verify exact stable versions, engines and peers
against Node 24. Job 4B pins `@vercel/functions` 3.9.7 and implements the local attachment seam.
Actual Fluid Compute execution-mode behavior remains unverified. Local pg/Drizzle behavior is tested on PostgreSQL 17.11; Neon endpoint,
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
