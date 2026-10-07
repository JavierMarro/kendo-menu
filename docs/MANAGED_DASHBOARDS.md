# Migration B — managed accounts and protected dashboards

Migration B replaces the API's custom OAuth/application-session runtime with Migration A's
branch-bound Neon JWT verifier. It preserves generated internal account UUIDs, legacy rows,
guest LocalStorage and ordinary dashboard Save contracts. Production browser account integration,
route changes and retirement of browser account caches belong to Migrations C/D. The preserved
browser client still expects `/api/session` and custom CSRF cookies and cannot consume B's API.
No deployment, remote migration or external configuration change is part of this implementation.

## Authorization and frontend contract

Each account/dashboard request sends an explicit `Authorization: Bearer <Neon JWT>` header.
Managed cookies, legacy application cookies, browser IDs and email never authorize the API.
Retrieve tokens through Migration A's documented token-only lifecycle; keep credentials and the
creation response's copy opportunity in memory. Account initialization is independent of Google's
callback URL or whether the cloud dashboard is empty.

| Operation                      | Successful response / behavior                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/account`            | `{ accountId, email, created, copyOpportunityId? }`; the opportunity appears only in the winning new-account response.                                |
| `GET /api/account`             | `{ accountId, email }`; inspect an existing mapping without creating it or reissuing an opportunity.                                                  |
| `GET /api/dashboard`           | Existing transport-v1 account UUID, catalogue digest, revision and complete v10 snapshot; absent dashboard has revision `"0"` and null snapshot/time. |
| `PUT /api/dashboard`           | Existing complete envelope, expected workspace/revision and UUIDv4 request ID; acknowledged only after commit.                                        |
| `POST /api/dashboard/adoption` | Existing strict Yes/No envelope plus `copyOpportunityId`; Yes also requires revision `"0"`, current catalogue and a complete non-empty dashboard.     |

`email` is nullable verified metadata. `accountId` is the internal UUID used as the dashboard
`expectedAccountWorkspaceId` mismatch guard; the server derives ownership from verified managed
provider/issuer/subject. Email never links an old account. Owner-confirmed legacy accounts contain
development/test data only; those rows remain preserved without linking or transfer machinery.

Mutations require the exact configured `APP_ORIGIN`. HTTPS origins are allowed; HTTP is allowed
only for loopback development hosts. No application session or CSRF cookie is required or issued.
All responses are private/no-store. Invalid identity receives sanitized 401; verification or
persistence unavailability receives sanitized 503. A valid managed identity with no initialized
account receives `409 ACCOUNT_NOT_INITIALIZED` on existing-account operations.
Unsupported methods reject without body consumption. Dashboard/adoption bounded parsing follows
authorization; the complete JSON envelope is limited to 2,097,152 UTF-8 bytes and uses the existing
strict lexical JSON and domain validation.

JWT expiry is checked at entry, after database waits and before completing mutations. As in A,
issued bearer credentials may remain usable until expiry after managed sign-out. Neon documents
[15-minute JWTs](https://github.com/neondatabase/website/blob/main/content/docs/auth/guides/plugins/jwt.md);
this API does not promise instant revocation or create another application-session system.

## Persistence and the one-time guest copy

Forward migrations keep applied SQL history and legacy auth/adoption records. New managed mappings
are unique by provider/issuer/subject, complete or entirely absent, and immutable. New accounts can
have no legacy Google subject. Verified email is metadata. Creating the account and its random,
account-keyed copy opportunity is atomic; concurrent initialization has one creation winner.
Inspection and returning-account initialization do not disclose that opportunity. A lost creation
response or reload can therefore lose the browser's only opportunity ID.

Before consumption, validate identity, ownership, Origin, opportunity eligibility, the entire
envelope, catalogue, byte bounds and revision-zero requirements. Rejected requests consume nothing.
Mutations lock the account first. One transaction claims and commits consumption; concurrent
decisions have one winner. No records a permanent decline without copying. Yes then starts another
transaction, reacquires the account lock, and checks again that no dashboard exists and revision
remains zero. An ordinary Save between transactions wins: copying aborts without overwriting the
dashboard, receipt or revision. Otherwise the complete snapshot and accepted outcome commit
atomically before success is acknowledged. No dashboard payload or recovery journal is stored in
the opportunity row.

Failure or an uncertain Yes commit leaves consumption final and ordinary account use available.
Guest storage never changes. There is no adoption replay, creating-session restriction, durable
pending copy or interrupted-copy recovery. A successful ordinary Save makes an unused opportunity
unavailable. Save receipts remain separate: retry an uncertain ordinary Save with the identical
request ID/envelope to recover its original acknowledgement; conflicting reuse remains an error.

## Local verification

All required checks passed under Node 24.21.0 on 5 October 2026:

| Command                     | Observed result                                                     |
| --------------------------- | ------------------------------------------------------------------- |
| `pnpm check:api`            | PASS; 153 tests plus API/root adapter type and lint checks.         |
| `pnpm test:api:integration` | PASS; 67 tests against guarded local `kendomenu_test` only.         |
| `pnpm db:check`             | PASS; migration metadata consistency.                               |
| `pnpm check`                | PASS; 637 tests plus session/type/lint/format and production build. |

The integration command explicitly loaded ignored private configuration without displaying it.
Sandbox socket denials required approved complete reruns. The frozen install passed; pnpm's
dependency-status check reported an `enableGlobalVirtualStore` setting mismatch, so checks
used `pnpm_config_verify_deps_before_run=warn` without changing the lockfile or configuration.
Existing web lint warnings, the API test listener warning and Vite build warnings were non-blocking.
Independent auth/persistence review and review of the corrections passed. These are internal B
checks; browser E2E, PWA and live Neon dashboard checks were not run for B.

## Owner-run non-production migration

This is a procedure for a separately authorized owner action, not evidence that Neon was migrated.
Use Node 24 and the reviewed Migration B files. Never run the destructive local test harness against
Neon, use schema push, reset a shared schema or edit `neon_auth` tables.

1. In the Neon console, select the dedicated non-production branch used for Migration A. Privately
   confirm its Auth Base URL, pooled runtime database URL and direct migration URL all refer to that
   branch/database. Preserve a recoverable branch/snapshot using the owner's normal procedure.
2. The owner fills ignored `apps/api/.env.local` with `NEON_AUTH_BASE_URL`, exact `APP_ORIGIN`,
   pooled `DATABASE_URL` and direct `MIGRATION_DATABASE_URL`. Never put these URLs in chat, shell
   arguments, logs or `VITE_` variables. The web file contains only the public Auth URL.
3. Review the new forward SQL, journal and snapshot together with the preserved migrations. Run
   `pnpm db:check` first. From the repository root, explicitly load the private file and run the
   migration command against that selected development branch:

   ```sh
   pnpm --filter @kendo-menu/api exec node --env-file=.env.local --import tsx src/database/migrate-command.ts
   ```

   Expect only `MIGRATIONS_APPLIED`. A fixed failure code is not proof of rollback; privately inspect
   migration bookkeeping and the selected branch before retrying. Do not collect raw driver errors.

4. Start the local Node API with explicit private configuration loading:

   ```sh
   pnpm --filter @kendo-menu/api exec node --env-file=.env.local --import tsx src/node.ts
   ```

   The Node listener uses port 3000. An owner-controlled development harness can exercise the
   contract directly; B supplies no production browser account UI. Preserve A's isolated proof.

## Private live read/write checklist

The owner performs Google login and comparisons privately. Tokens, identity payloads, cookies,
connection strings and raw errors are not evidence artifacts. Report pass/fail/not-run outcomes.

1. Obtain a managed token using A's proven callback/token path. Confirm `GET /api/account` reports
   uninitialized for a genuinely new managed identity; initialize with exact Origin. Privately
   retain the returned internal UUID and opportunity only in memory. Repeat initialization and
   inspection: same account UUID, no opportunity reissue.
2. Reject a request containing only legacy cookies, a missing/expired bearer, and a mutation with
   missing/wrong Origin. No dashboard access or writes may succeed. Confirm guest bytes unchanged.
3. For a new account choose complete guest copy Yes or permanent No. Read the entire dashboard.
   A consumed or lost opportunity cannot be reused; ordinary Save remains available after failure.
4. Save a validated complete dashboard with the matching internal workspace ID, current revision,
   catalogue and a fresh request ID. Read it back and confirm complete contents and revision.
   Repeat the identical Save and confirm its original acknowledgement; submit a stale revision
   with a new ID and confirm a conflict. Reload and refresh the JWT, then read the same account.
5. Before public release, sign in with a second dedicated test account and verify distinct managed
   identity/internal account UUID and isolated reads/writes. An expected first-account UUID must
   reject under the second token. Return to the first account and verify stable identity and its
   original dashboard. **NOT RUN — owner-deferred**: one dedicated Google test account is available;
   personal accounts are excluded. This permits internal B work but remains a public-release gate.

No live B dashboard read/write or remote migration is claimed. Migration A's earlier callback
failures and later owner-reported single-account passes remain historical evidence. The inherited
mobile failure also remains unresolved: `account-persistence.spec.ts:273`, View dashboard click at
line 283, detached-element timeout after 30 seconds, 57/58 passed. B's API/database checks do not
erase it or establish whole-branch release readiness.
