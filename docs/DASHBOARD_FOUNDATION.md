# Job 5A dashboard application foundation

This is an unregistered, locally tested application foundation. `/api/dashboard` still returns
the production application's JSON 404. No dashboard table, migration, PostgreSQL adapter, route,
or runtime composition is added. The source of truth for transport types is
[`dashboard/contracts.ts`](../apps/api/src/dashboard/contracts.ts); protected persistence is
[`persistence/dashboard-contracts.ts`](../apps/api/src/persistence/dashboard-contracts.ts).

## Composition and trust boundary

`createSessionAuthorization({ persistence, getAppOrigin, clock, randomBytes, logger })` provides
`authorizeRead(request)` and `authorizeWrite(request)`. Success carries a frozen, internally
branded `SessionAuthorizationProof` containing the server-derived user/session IDs and credential
hashes. Read authorization never touches activity or renews cookies. Write authorization first
establishes an active session, then checks exact configured Origin and equal CSRF cookie/header
values bound to that session. Missing/invalid sessions clear both application cookies; CSRF/Origin
failures and indeterminate configuration/storage failures preserve otherwise valid cookies.
Session GET and logout reuse this module; logout now requires the CSRF cookie as well as its header.

`createDashboard({ authorization, persistence, catalogue?, diagnosticId?, logger? }).handle(request)`
is the stable Request/Response application interface. Authorization and persistence are injected;
the default catalogue is the immutable domain catalogue. The clock belongs to injected session
authorization and future transactional persistence, not to client timestamps. A lazy persistence
provider is accepted, but no default runtime provider or production fake exists.

The handler rejects unsupported methods, then query parameters. PUT checks media type/encoding
and optional Content-Length before authorization. Only authorized requests acquire the bounded
body reader. Strict UTF-8 and lexical JSON validation precede v10 structural validation and hashing.
Only then can the handler call protected persistence. The session user is the sole authorization
source; `expectedAccountWorkspaceId` is only a mismatch guard.

Job 5B must register this handler with Elysia automatic PUT parsing disabled (`parse: 'none'`).
It must preserve explicit bodyless HEAD 405 and pre-authorization method rejection. Job 5A's
Request/Response tests do not prove registered dashboard routes or a Node dashboard listener.

## Wire and canonical representation

The complete write envelope has exactly `transportVersion`, `expectedAccountWorkspaceId`,
`expectedRevision`, `requestId`, `catalogueVersion`, and `dashboard`. The snapshot is exactly
`{ version: 10, state: PersistedTrainingWireStateV10 }`. Unknown properties are rejected throughout.
Workspace IDs are canonical lowercase internal-user UUIDs; request IDs are lowercase UUIDv4.
Revisions are unsigned decimal strings without leading zeroes, bounded at `9223372036854775807`.
Server acknowledgement timestamps have UTC millisecond precision. The catalogue version is the
lowercase SHA-256 digest of the complete canonical ordered runtime built-in catalogue.

The maximum complete incoming envelope is **2,097,152 UTF-8 bytes**, including JSON escapes,
whitespace and metadata. Content-Length never replaces actual byte counting. Accept only
`application/json` with an optional UTF-8 charset and absent/`identity` content encoding.
Malformed UTF-8, a leading BOM, duplicate decoded JSON properties, negative zero, numerically
lossy spellings, and container nesting beyond 32 are rejected. Domain limits apply afterward.
An unauthorized oversized stream may return 401 without discovering its actual size.

Canonical JSON sorts object keys by UTF-16 code-unit order and preserves array order, string
contents, optional-field absence, and explicit zero. It does not trim or normalize Unicode.
Equivalent JSON whitespace, escape spellings and losslessly equivalent decimal spellings have
the same representation. Unpaired surrogates become lowercase `\uXXXX` JSON escapes before UTF-8
encoding; valid pairs remain scalar values. Thus lone surrogates never collapse to U+FFFD in hashes.
The request digest includes every envelope field and excludes credentials, Origin and CSRF values.

The domain subpath `@kendo-menu/domain/dashboard-persistence` owns v10 wire DTOs and the strict
codec. Its output is a cloned, deeply frozen value. Store compatibility aliases retain existing
imports; historical migrations, local serialization and the local 2,097,152 UTF-16-code-unit
ceiling are unchanged. Some locally valid Unicode-heavy dashboards are cloud-ineligible. No
truncation or guest-adoption behavior is implemented.

## Protected persistence handoff

`validateDashboardWrite` produces `ValidatedDashboardWrite`: the immutable request, completed
canonical request JSON, request SHA-256 digest, and canonical snapshot JSON. It performs structural
validation before any receipt lookup. The current catalogue check remains separately callable.

`DashboardPersistence.read(proof)` returns a discriminated read/failure outcome.
`compareAndWrite(proof, intent, isCatalogueCompatible)` returns a written/replayed acknowledgement,
revision conflict, reused-ID conflict, catalogue rejection, or fixed authorization/storage failure.
Neither interface exposes SQL clients or transactions. Read responses and acknowledgements are
validated again before HTTP serialization, including identity and revision constraints.

The future adapter must revalidate and lock the authenticated session, serialize account writes,
and look up a retained request ID **before** revision comparison, compatibility or cleanup. An
identical retained digest returns its original acknowledgement unchanged; different valid content
conflicts. Only a new identifier invokes the supplied catalogue-compatibility predicate.

No row means revision `"0"`, dashboard `null`, timestamp `null`. A first new successful write expects
`"0"` and creates `"1"`. Every new success increments even for identical or empty dashboards; saved
empty dashboards retain positive revisions. Use database bigint arithmetic, never JavaScript
numbers or sequences. Exhaustion must fail atomically without wrapping or reusing revisions.

Only a genuinely new successful write may remove receipts aged at least seven days and then evict
oldest acknowledged revisions to at most 1,024 receipts per account. Seven days is cleanup
eligibility, not a replay deadline. Dashboard, receipt, cleanup and final session touch must commit
atomically. Reads, HEAD, failures and retained replays must not update activity. Ambiguous commits
return fixed 503; an unchanged request ID is the recovery mechanism, not a server-side retry.
These are adapter obligations, **not database guarantees established by the fake-adapter tests**.

## HTTP outcomes

All responses use `Cache-Control: private, no-store`. Errors expose no inputs, SQL, credentials,
or exception details. Optional dashboard logging accepts only generated UUIDv4 diagnostic IDs
and the fixed `DASHBOARD_PERSISTENCE_FAILED` code; logger failures do not change responses.

| Status | Body                                                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 200    | `DashboardReadResponse` or original `DashboardWriteAcknowledgement`                                                                                                |
| 400    | `{"error":"INVALID_DASHBOARD_REQUEST"}`                                                                                                                            |
| 401    | `{"error":"UNAUTHENTICATED"}`; clear application cookies                                                                                                           |
| 403    | `{"error":"FORBIDDEN"}` or `{"error":"ACCOUNT_WORKSPACE_MISMATCH"}`                                                                                                |
| 405    | `{"error":"METHOD_NOT_ALLOWED"}`; HEAD is bodyless; `Allow: GET, PUT`                                                                                              |
| 409    | `{"error":"REVISION_CONFLICT","currentRevision":Revision}` or `{"error":"REQUEST_ID_REUSED"}`                                                                      |
| 413    | `{"error":"REQUEST_TOO_LARGE"}`                                                                                                                                    |
| 415    | `{"error":"UNSUPPORTED_MEDIA_TYPE"}` or `{"error":"UNSUPPORTED_CONTENT_ENCODING"}`                                                                                 |
| 422    | `{"error":"UNSUPPORTED_TRANSPORT_VERSION"}`, `{"error":"UNSUPPORTED_DASHBOARD_VERSION"}`, `{"error":"INVALID_DASHBOARD"}`, or `{"error":"CATALOGUE_INCOMPATIBLE"}` |
| 503    | `{"error":"AUTH_UNAVAILABLE"}` or `{"error":"DASHBOARD_UNAVAILABLE"}`                                                                                              |

Application size/error guarantees cover requests reaching application handling. Platform request
limits may reject requests before that point with a platform-specific response.

## Completion boundary

Job 5B remains blocked until the owner commits the independently reviewed Job 5A state on
`codex/account-sync-integration`. No commit, push, deployment, provisioning, production migration,
environment file, or external configuration change is included. Real Google, HTTPS cookies, Neon,
Vercel routing and Fluid Compute remain separate live-integration gates. The external Google-start
rate limit remains a production gate. Frontend accounts, workspace switching, adoption, automatic
sync/retries, conflict UI and every other Job 5A exclusion remain unimplemented.

## Independent review and corrections

The independent security/correctness review inspected the actual Job 5A changes, including
untracked modules, the trust pipeline, strict JSON/canonicalization, codec boundaries and protected
persistence interface. It reported two confirmed findings:

- **High:** the runtime encoder could discard altered built-in snapshot content by reducing it to
  an ID reference. The encoder now validates the snapshot and compares it exactly with the canonical
  catalogue before using a reference. Tests reject altered and unknown-property snapshots and retain
  legitimate canonical built-in round trips.
- **Medium:** duplicate CSRF cookies could incorrectly yield 401 and clear a valid session. Focused
  session-cookie parsing now records CSRF ambiguity separately; reads can authenticate the session,
  while writes return 403 and preserve cookies. Unit and real PostgreSQL logout tests verify this.

A bounded independent re-review of those two corrections returned **PASS**, with no remaining
concrete issue in that scope. It reused source inspection and passing verification evidence rather
than claiming a second full audit or any dashboard SQL guarantees.

Implementation review also moved custom activity-reference/notes losses into structural rejection,
removed an unnecessary authorization-provider cache, and hardened body buffering and exact numeric
comparison. Regressions cover reused stream buffers, hanging cancellation, misleading lengths,
UTF-8 boundaries, integer precision loss, compensated long numeric spellings, and lone-surrogate
keys/values distinct from U+FFFD. The final checks below include these corrections.

### External review: protected-cookie isolation

A subsequent external review found that protected authorization still applied the per-cookie limit
to unrelated cookies and rejected duplicate login-transaction cookies. This could return 401 and
clear an otherwise valid session. The bounded correction identifies protected credential names
before applying per-cookie validation. Login cookies and unrelated names/values, including long
values and malformed unrelated fragments, are ignored within the unchanged total-header bound.
The Google start/callback `parseCookies()` implementation is unchanged by this correction.

Malformed protected names, including a missing `=` or whitespace-separated trailing name material,
remain fail-closed: session fragments reject before persistence with 401 and clear both application
cookies; CSRF fragments remain ambiguous, allowing authenticated reads but rejecting writes with
403, no cookie clearing and no CSRF-bound second lookup. Duplicate and overlong protected cookies
retain these same distinctions. Total-header length and control-character violations still reject
the complete header before persistence.

Direct tests use real Request headers and `createSessionAuthorization()` with injected persistence,
without manufacturing authorization proofs. The targeted session-authorization/security run passed
127 tests under Node 24.12.0. This correction touches only `auth/security.ts`, its public
authorization test file, this handoff and the existing eight-line Job 5A session record. PostgreSQL
tests were not rerun for this parser-only correction; the earlier 44-test result below remains
historical evidence, not a new database claim.

The correction-only independent source review returned **PASS**, with no findings. Final Node 24
checks passed: `pnpm check:api` (387 tests), `pnpm check` (694 tests plus types, lint, formatting
and build), `pnpm session:check`, `git diff --check`, and focused unsafe-type, skipped-test, debug-log,
secret-shaped and generated-artifact scans. A before/after snapshot confirmed only the four scoped
files changed and the Google parser/shared header helpers remained byte-identical.

## Verification evidence

Checks ran under Node **24.12.0**, using the existing temporary runtime and
`pnpm_config_verify_deps_before_run=false` to avoid dependency auto-repair while changing runtime
context. No check was disabled. The workspace dependency was linked offline; the lockfile delta
contains only that local link. Local cache, IPC/PostgreSQL sockets and registry audit access needed
sandbox escalation. No credentials or environment values were printed or written.

| Command/check                                                                                       | Result                                                                                                                     |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Targeted authorization, dashboard, domain codec and actual store compatibility tests                | PASS; direct interface regressions retained                                                                                |
| `pnpm check:api`                                                                                    | PASS; 387 API tests, strict API/root types and lint                                                                        |
| `pnpm test:api:integration`                                                                         | PASS; 44 real local PostgreSQL authentication tests, including missing/duplicate-CSRF logout rejection without revocation  |
| `env -u TEST_DATABASE_URL pnpm test:api:integration`                                                | Expected exit 1 with `TEST_DATABASE_URL_REQUIRED_LOCAL_KENDOMENU_TEST`; no silent skip                                     |
| `pnpm db:check`                                                                                     | PASS; existing migration metadata chain, no schema/migration diff                                                          |
| `pnpm check`                                                                                        | PASS; 694 tests (73 domain, 69 store, 387 API, 165 web), types, ESLint, Prettier, session history and production web build |
| `pnpm session:check`                                                                                | PASS; 59 entries, each at most eight lines                                                                                 |
| Scoped debug/unsafe-type/secret-shaped/skipped-test/generated-artifact scans and `git diff --check` | PASS; no prohibited scope changes                                                                                          |
| Affected foundation documentation links                                                             | PASS                                                                                                                       |
| `pnpm audit --json`                                                                                 | WARN; only the existing moderate development-only esbuild advisory through Drizzle Kit; no high/critical advisories        |

The advisory is the already documented `GHSA-67mh-4wv8-2f99` in esbuild 0.18.20. No package version
was changed and no development server was exposed by this work. Browser E2E/PWA and release suites
were not run for this backend foundation; a web production build does not establish live backend
or provider behavior. Dashboard transaction, revision, receipt cleanup and database race guarantees
remain unimplemented and unverified until Job 5B.

## Changed files

- `apps/api/package.json`
- `apps/api/src/app.test.ts`
- `apps/api/src/auth-http.integration.test.ts`
- `apps/api/src/auth-rejections.test.ts`
- `apps/api/src/auth/authentication.test.ts`
- `apps/api/src/auth/authentication.ts`
- `apps/api/src/auth/security.ts`
- `apps/api/src/auth/session-authorization.test.ts`
- `apps/api/src/auth/session-authorization.ts`
- `apps/api/src/dashboard/canonicalization.test.ts`
- `apps/api/src/dashboard/canonicalization.ts`
- `apps/api/src/dashboard/contracts.ts`
- `apps/api/src/dashboard/dashboard.test.ts`
- `apps/api/src/dashboard/dashboard.ts`
- `apps/api/src/dashboard/request-body.test.ts`
- `apps/api/src/dashboard/request-body.ts`
- `apps/api/src/dashboard/validation.test.ts`
- `apps/api/src/dashboard/validation.ts`
- `apps/api/src/persistence/dashboard-contracts.ts`
- `docs/ACCOUNT_SYNC.md`
- `docs/ARCHITECTURE.md`
- `docs/DASHBOARD_FOUNDATION.md`
- `docs/work-sessions/2026-09-12-dashboard-foundation.md`
- `docs/work-sessions/README.md`
- `packages/domain/package.json`
- `packages/domain/src/dashboard-persistence.test.ts`
- `packages/domain/src/dashboard-persistence.ts`
- `packages/domain/src/default-training-sets.ts`
- `packages/domain/src/index.ts`
- `packages/domain/src/training-quantity-policy.ts`
- `packages/store/src/dashboard-persistence-compatibility.test.ts`
- `packages/store/src/persistence.ts`
- `pnpm-lock.yaml`
