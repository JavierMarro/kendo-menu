# Accounts and synchronization

Documentation baseline: 2026-09-09. **No account or synchronization implementation exists.**
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
`@vercel/functions` and `attachDatabasePool` remain **provisional** until the database job verifies
exact stable-version, Node 24, and Vercel execution-mode compatibility. Local HTTPS tooling and
all product/operational recommendations below remain unapproved.

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
Node version or a local Node 24 test run.

### Application module and deployment seam

The local scaffold in `apps/api` exposes `createApp()` and its Request-handling interface without
starting a listener. It contains only fixed health behavior and JSON error responses, with
`Cache-Control: private, no-store`. The standalone entry supplies `@elysia/node`; the root Vercel
adapter delegates the original Request and Response without Node adapter or platform pool hooks.
No speculative authentication, database, repository, or synchronization interfaces are introduced.
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

## 2. Recommendations awaiting confirmation

### One database connection strategy

The accepted driver direction is PostgreSQL via **`pg` everywhere**, with Drizzle's node-postgres
integration. The following operational details remain recommendations for the database job:

- Runtime requests use Neon's pooled endpoint. Create a bounded `pg.Pool` once per warm function
  instance, not per request; start with a small pool (maximum 5, idle timeout 5 seconds).
- The Vercel adapter provisionally attaches that pool once with `attachDatabasePool`. Verify its
  exact stable package version against Node 24 and the project's function execution mode before
  installation. Do not silently substitute Neon HTTP/WebSocket lifecycle rules if verification fails.
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
These support the strategy, not an assertion that exact package versions were compatibility-tested.

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
| Application-session lifetime | Seven-day idle expiry and 30-day absolute expiry; fresh authentication starts a new lifetime                                                                    | Balances repeated sign-in against exposure from a retained device session.                                                                                                     |
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
- [ ] Application-session lifetime, account deletion, retention, remaining device copies, and
      encryption expectations.
- [ ] Provider/API regions, operational responsibility, budget, recovery requirements, and processor
      terms/jurisdiction assessment. Recommendations do not establish provider guarantees.

### Engineering feasibility gates — evidence, not owner votes

Before each later job installs dependencies, verify exact stable versions, engines and peers
against Node 24. In the database job, **`@vercel/functions` and `attachDatabasePool` are provisional**:
verify the chosen stable version's compatibility and execution-mode requirements; this task has not
tested or approved a version. Confirm the proposed `pg` transaction/pooling strategy and compatible
PostgreSQL major version for Neon and disposable tests. Do not mix in a Neon-driver alternative.

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
