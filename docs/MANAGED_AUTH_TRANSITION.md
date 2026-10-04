# Managed authentication and online account dashboards

Prepared 4 October 2026 from the owner's approved simplification. This is a transition handoff,
not evidence that managed authentication has been integrated or deployed.

## Target and limits

- Guests keep the existing Zustand/LocalStorage dashboard and offline PWA workflow.
- Signed-in dashboards require online authenticated loading and saving. Zustand holds the active
  account draft in memory; account dashboards are not persisted to LocalStorage or IndexedDB.
- Use an explicit **Save to account** action for the initial account implementation. Failed saves
  retain the in-memory draft and offer retry/download. Reloading or closing the page can lose an
  unsaved account draft; disclose that limitation instead of building another durable offline queue.
- Guest and account pages render the same dashboard implementation with different store providers.
  Scope the library's Add action and the custom-menu builder to the selected workspace too.
- Suggested route trees are `/app/guest/*` and `/app/account/*`, including each dashboard. Continue
  as a guest and Continue with Google are the landing entries. Keep an appropriate dashboard
  shortcut after entry. Direct account links require authentication; verified signed-in visitors
  entering guest routes go to the account route. Unavailable authentication must not make the
  independent local guest workflow depend on Neon connectivity. Unresolved identity never opens
  account data or authorizes guest analytics.
- Preserve the approved one-time complete guest copy for a genuinely new KendoMenu account:
  Yes copies into the cloud and keeps guest LocalStorage unchanged; No permanently declines;
  returning accounts receive no offer. Complete it on a separate setup screen before the account
  dashboard opens. The owner accepts a missed copy opportunity after interruption: no creating-
  session restriction, durable pending copy, or interrupted-copy recovery. Store consumption
  server-side per account, preserve atomic copying and honest acknowledgements, and let a failed or
  unconfirmed copy exit to ordinary account use. No later transfer, merging, or retry-import button.
- Retain Node 24, Elysia, Neon PostgreSQL, Drizzle/pg, the TypeScript pnpm monorepo, and one lockfile.
  Neon **managed** auth replaces the custom Google OAuth/session implementation. Installing and
  running Better Auth ourselves is not this plan.
- Retain server validation, the cloud byte limit, account ownership checks, optimistic revisions,
  and idempotent save handling. Do not introduce realtime connections, offline account caches,
  background sync, paid tiers, a new frontend framework, or the Neon Data API.

The existing ADRs still describe the previous implementation. The target above includes the owner's
later clarification that creating-session eligibility and durable interrupted-copy recovery are no
longer required. Migration A will explicitly record which decisions are superseded and which remain
in force; historical ADRs and session evidence stay. This guidance update changes no runtime code.

## 1. Preserve the current work before restructuring

The following is a historical owner-run checkpoint recipe, not agent authorization to change Git
state. The owner has since created `codex/managed-auth-online-dashboard` from checkpoint `a4ca0c4`.
Do not rerun it during Migration A; verify current branch/status instead. Any future staging,
commit, or branch operation requires the owner's explicit request.

At the original preparation, the observed checkout was `codex/account-sync-integration`, HEAD
`25350c1`, with uncommitted 6D-B changes; the suggested new branch names had not yet been checked.
Recheck before any future owner-authorized use; never run while another agent is editing.

Create a local archive branch, stage the known work, inspect it, and make a checkpoint:

```bash
git status --short
git switch -c codex/archive-account-sync
git add -u
git add -- apps/web/e2e/account-adoption-peers.spec.ts apps/web/e2e/account-adoption.spec.ts apps/web/src/features/account/AdoptionDialog.test.tsx apps/web/src/features/account/AdoptionDialog.tsx docs/work-sessions/2026-09-30-guest-adoption-web.md docs/MANAGED_AUTH_TRANSITION.md docs/work-sessions/2026-10-04-managed-auth-transition-plan.md
git diff --cached --name-only
git diff --cached --stat
git commit -m "chore(checkpoint): preserve unfinished account sync before simplification"
git switch -c codex/managed-auth-online-dashboard
```

Inspect staged contents locally if any path is unexpected. Environment files, credentials, generated
output, and dependencies must not enter the checkpoint. This is a recoverable local work snapshot,
not a claim that the old feature passes release checks. Do not push the archive or merge it into
main. The new implementation branch starts with the preserved work so useful code remains available.

Keep subsequent jobs as separate reviewed commits on the new branch. Main and the production
deployment remain unchanged. A future push can trigger Vercel Preview; configure a dedicated
development database/auth environment before authorizing live Preview integration. Do not merge
the old draft PR; create a new draft PR for the replacement branch when appropriate.

## 2. Owner setup in Neon and Google

No Neon CLI install, global skill installation, MCP setup, `neon deploy`, or Vercel linking is
required to supply an Auth URL and PostgreSQL connection strings.

1. Open the existing **KendoMenu** Neon project. Create a dedicated non-production database branch,
   for example `auth-simplification-dev`, and select it. A Neon branch and a Git branch are different:
   the former isolates the database/auth environment; the latter isolates source code.
2. On that Neon branch, open Auth/Settings -> Auth and enable the managed Better Auth offering.
   Copy its Auth Base URL. Follow the current console labels if they differ from these instructions.
3. Configure Google as the sole sign-in provider; disable email/password and other login methods
   in the managed service settings, rather than merely hiding their buttons. Verify that setup
   during Migration A. Reuse the existing Google Web application OAuth client
   for initial testing by adding the Neon branch's exact callback URI, or use a dedicated development
   client for cleaner separation. Copy the callback from Neon; its documented shape is
   `{NEON_AUTH_BASE_URL}/callback/google`. Enter the client ID and client secret in Neon's provider
   settings. Do not delete the earlier callback while the old implementation is being preserved.
4. Keep the Google app in Testing for this development integration and add the Google test accounts
   used for login and ownership checks. Do not publish the Google consent screen for this job.
5. Use `http://localhost:5173` as the initial app origin. Neon documents localhost ports as allowed
   for development. Verify the exact origin you use; `127.0.0.1` is not the same hostname. Add exact
   trusted Preview origins later when authorized; do not allow all `*.vercel.app` sites.
6. From Neon's connection dialog for that same branch/database/role, obtain a pooled runtime
   connection string and a direct migration connection string. Keep credentials private. Retain
   the existing local `kendomenu_test` database for destructive/disposable integration tests.

Neon also offers shared Google credentials for development. Using your existing own Google client
avoids having to replace those shared credentials later. Production must use your own configured
Google client, as described in Neon's OAuth guide.

### Configuration to prepare privately

| Value                                      | Location/intended use                                                        | Secret?                  |
| ------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------ |
| `VITE_NEON_AUTH_URL`                       | `apps/web/.env.local`; managed Auth Base URL                                 | No; public endpoint      |
| Managed Auth Base URL for API verification | Server configuration; exact variable name/loading established in Migration A | No; public endpoint      |
| `DATABASE_URL`                             | `apps/api/.env.local`; pooled development-branch connection                  | Yes                      |
| `MIGRATION_DATABASE_URL`                   | `apps/api/.env.local`; direct connection to that same development branch     | Yes                      |
| `TEST_DATABASE_URL`                        | Private environment for local `kendomenu_test` integration harness           | Yes                      |
| Google client ID/secret                    | Neon's selected branch/provider settings                                     | Secret for client secret |

Do not paste database URLs, passwords, Google client secrets, cookies, or bearer tokens into chats.
No Neon management API key is required for manual console setup or ordinary database access.

The current backend does **not** automatically load environment files. Migration A must establish
and document explicit development environment loading with the selected Node runtime. Creating
`apps/api/.env.local` alone will not make the values available to today's API scripts. Vite loads
its web `.env.local` separately. `.env.local` is already ignored; verify with `git check-ignore`.
Never give database credentials a `VITE_` prefix.

Do not run the current migrations against Neon just to get started. Migration B reviews the new
identity/schema requirements first, then provides an explicit command for the selected development
branch. Do not point the local destructive test harness at Neon.

## 3. What can start before setup is complete?

Codex CLI can plan Migration A now: inspect the checkout, confirm provider support, map dependencies,
record the approved scope, and prepare environment templates and the narrow proof implementation.
Real Google login and managed-session/API verification require the Neon Auth setup and your browser
sign-in. Dashboard persistence against Neon additionally requires the database URLs and reviewed
development migrations. Missing live evidence must be reported as not run, never replaced with
mocked tests labelled as provider verification.

Pause the former 6D-B/6D-C implementation queue. Its uncommitted code is evidence and reuse material;
it is no longer the target feature to finish. Do not require obsolete offline-account features to
pass before removing them. Guest behavior and security/ownership guarantees remain required.

## 4. Four bounded implementation jobs

Use each prompt in `/plan`, then implement the agreed plan. Run one job at a time from its reviewed
predecessor. All prompts inherit these rules: preserve unrelated changes; use Node 24 and pnpm;
no staging, commit, push, merge, production access, deployment, or external console changes by the
agent. Use established SDK/library verification rather than handwritten OAuth or JWT cryptography.
Apply the repository's independent-review policy to material auth/persistence changes. Keep tests
for observable guarantees; retire tests only when their requirement has explicitly been removed.
Record short evidence-based handoffs and unresolved provider evidence without reopening the entire
legacy feature in every review.

### Migration A — prove managed Google authentication

Suggested owner commit: `feat(auth): prove Neon managed Google authentication`

```text
Implement Migration A from docs/MANAGED_AUTH_TRANSITION.md: a narrow Neon managed-auth proof.
First verify branch/status and read AGENTS.md, the transition handoff, accepted ADRs, current API
runtime/authorization composition, web auth wiring, and current primary Neon Auth/SDK documentation.
The approved target is independent guest LocalStorage and online-only account dashboards with
Neon-operated Google authentication. Retain Node 24/Elysia/React/Vite/pnpm; do not self-host Better Auth.

Record a concise superseding ADR and reconcile current-vs-target guidance without claiming the
transition complete. Map keep/rewrite/remove files and existing user/session SQL coupling.

Implement only the SDK client, the smallest proof UI, and a development proof endpoint that
verifies managed identity in our Node/Elysia API. Prove the selected Neon JWT bearer handoff using
supported SDK retrieval and established JWKS verification; do not copy a
Next.js-only integration or assume Neon's cookies are sent to the KendoMenu API automatically.
Use standard verified credential handling, require the configured provider/branch, validate
applicable signature/issuer/audience/expiry, and never trust browser-supplied user IDs or email.
Necessary managed HttpOnly session cookies are expected. Do not persist bearer/session credentials
in JavaScript-readable browser storage or logs. Inspect and test the actual pinned SDK's session
refresh/broadcast storage behavior; do not disguise it with SDK-internal monkey patches or global
LocalStorage overrides. If that invariant cannot be met, report the precise provider constraint.
Explain the chosen session expiry/revocation behavior; do not promise instant JWT revocation
unless the selected method demonstrates it. Do not create a second custom session system.
Confirm Google-only provider configuration, including disabled email/password authentication;
frontend button visibility alone does not enforce that rule.

Establish documented local environment loading, ignored private files and empty .env.example
placeholders. Use the auth-only SDK surface. Do not enable the Data API or redesign persistence.
Pin justified dependencies in the existing lockfile. Keep the old path isolated until replacement
works; do not delete guest storage, dashboard code, migrations, or old auth in this proof job.

Add focused tests for missing/invalid/expired identity, provider mismatch, sanitized failures and
unauthorized requests. Provide a manual real-Google procedure for two accounts, reload, sign-out,
and backend identity verification. The owner performs Google login privately; do not ask for tokens.
Mocks do not establish live compatibility. If the managed service cannot support the selected
backend handoff, report the exact gap before broader work. Managed session IDs are not required
for guest-copy eligibility; Migration B owns server-side new-KendoMenu-account/copy-consumption state.

Run affected package checks and relevant proof tests; reuse guest baseline evidence where valid.
Obtain independent security review. Report dependency versions, exact configuration/loading,
identity/session behavior, observed live results vs not-run checks, and the Migration B contract.
Update work-session history. Do not commit or change provider/Vercel configuration.
```

Do not proceed to B on the strength of a mock-only login proof. The managed identity must reach
the actual Node/Elysia verification path in a browser. At A, a database-backed dashboard write is
not claimed; B supplies and verifies that behavior.

### Migration B — connect managed identity to protected PostgreSQL dashboards

Suggested owner commit: `refactor(api): authorize dashboards with Neon managed identity`

```text
Implement Migration B after Migration A's reviewed owner commit and successful real managed-login
proof. Read docs/MANAGED_AUTH_TRANSITION.md and the A handoff. Consume its verified auth interface.

Adapt protected dashboard and adoption authorization to the verified managed identity. Keep
generated internal KendoMenu IDs and map the stable provider identity uniquely; email is display
metadata, never identity or an automatic account-linking key. Preserve existing records; do not
assume provider IDs are UUIDs. Review every custom-session SQL dependency in dashboard/adoption
transactions and remove obsolete session lookup/touch/lock assumptions deliberately.

Keep server validation, cloud byte bounds, authenticated ownership, expected-workspace mismatch
guards, optimistic revisions, request-id replay, and atomic database writes. Save success requires
commit; ambiguous outcomes stay recoverable. Define manageable provider-expiry/revocation semantics
instead of recreating custom token machinery to mimic the previous session implementation.

Retain the new-account-only complete guest-copy/permanent-decline rules. Establish eligibility and
one-time consumption server-side from KendoMenu account creation; neither an empty dashboard nor
a newUserCallbackURL proves it. No creating-session binding, durable pending decision, or recovery
of interrupted guest copies is required. The owner accepts that an interrupted attempt may consume
the opportunity. Keep ownership, duplicate prevention and an atomic Yes copy, but do not indefinitely
block ordinary account access on an unconfirmed outcome. No later import/retry-import operation.
Keep ordinary Save-to-account request-id handling separate from the removed copy-recovery protocol.

Generate reviewed forward migrations where needed; preserve applied migration history. Do not
drop legacy data or edit neon_auth tables. Local integration uses the guarded kendomenu_test
harness. Supply a separate explicit migration and smoke-test procedure for the owner-selected
non-production Neon branch; no Neon mutation is authorized merely by running local tests.

Once no callers need it, remove custom Google OAuth/session issuance runtime code, its unused
dependencies and tests specific only to retired implementation details. Retain or port adversarial
ownership, unauthorized-access, validation, concurrency, replay and failure tests to the new path.
Do not leave two production auth implementations active.

Run check:api, local PostgreSQL integration, db:check and affected cross-package checks under
Node 24. Obtain independent auth/persistence review. Document exact removals, migrations, live
two-account dashboard-read/write procedure, limitations and the frontend contract. Update history.
Do not commit, deploy, or modify remote databases/configuration.
```

### Migration C — separate routes and online account editing

Suggested owner commit: `feat(web): separate guest and online account dashboards`

```text
Implement Migration C against Migration B's reviewed contract. Use the transition handoff and
kendomenu-web-feature. Reuse the dashboard/library/builder UI and the existing domain/store code.

Mount stable, separate guest and account route/store providers. Guests keep existing LocalStorage
and offline PWA behavior. The online account store holds a verified server-loaded dashboard and
its draft in memory only. Scope all data-changing library and builder actions to the selected
mode; do not dynamically swap the store beneath an open editor.

Provide Continue as a guest and Continue with Google on the landing page, the appropriate dashboard
shortcut after entry, verified email display, and provider sign-out returning home. Guard direct
account routes. Verified signed-in users cannot enter guest routes. Neon downtime must not disable
local guest use; unresolved identity cannot expose account data or authorize guest analytics.

Add explicit Save to account. Submit one frozen snapshot, expected revision, account mismatch
guard and stable request ID; acknowledge only that snapshot. Retain later edits separately in
memory. Lost-response retry uses the same request; a reload refetches the server and does not
claim an unsaved memory draft survived. A 409 preserves the draft and stops saving, with download
and explicit reload options; do not force-write over a newer cloud revision. A network failure
keeps a recoverable memory draft and a clear unavailable state. A 401 or account change hides
account content and fences late requests. Warn before intentionally discarding unsaved drafts.

No account dashboards, tokens or draft queues in LocalStorage/IndexedDB, no automatic background
sync, and no offline account editor. The initial new-account copy screen is a separate guarded
route for Migration D; offer ordinary account editing after completion, decline, a reported failed
or unconfirmed attempt, or ineligibility. Do not resurrect a durable pending-decision gate.

Retire old account cache/sync/workspace modules and bridges only after their callers are migrated.
Ignore old browser account caches without deleting them or uploading them. Keep guest bytes and
guest recovery behavior. Port useful isolation, auth-change and failure tests; remove obsolete
offline-account fixtures rather than preserving a second implementation solely for tests.

Verify direct links, library/builder destinations, guest offline access, Save success/failure/
conflict, sign-out, account switching and no account browser persistence in desktop and mobile
browser projects. Run check:web/check:store and affected development/preview E2E under Node 24;
run PWA tests for the changed route/offline journey. Obtain independent semantic/security/
accessibility review. Update documentation and history. Do not commit or deploy.
```

### Migration D — one-time guest copy, final cleanup and release verification

Suggested owner commit: `feat(web): complete one-time guest copy and retire legacy sync`

```text
Implement Migration D from the reviewed Migration C state. Reuse the B adoption contract and the
separate account setup route. Use the transition handoff and project web-feature guidance.

Offer Yes/No only for a server-eligible new KendoMenu account with complete validated, non-empty,
cloud-size-compliant guest data. Yes copies the exact snapshot into the cloud and leaves guest
LocalStorage unchanged; No permanently declines. Returning accounts receive no offer. Never
infer newness from cloud revision zero or the OAuth callback's URL.

Use one small module for a single copy attempt against B's account-level one-time contract. No
persisted pending copy payload, decision-recovery journal, background retries, or later import
button. Disable duplicate submissions in memory and rely on the server for ownership, one-time
consumption and atomic copy. After completion or decline, load the current cloud dashboard into
the memory-only account store. Report a failed/lost acknowledgement honestly and allow ordinary
account use without assuming the copy succeeded. The opportunity may have been consumed. Preserve
guest bytes for Yes, No and every failure.

Keep the existing same-guest-snapshot check before Yes, session/account guards, complete byte
validation, and accessible choice UI. Define exits for copied, declined, failed/unconfirmed attempt,
ineligibility and identity change before implementation. Block ordinary editing only during the
initial choice or in-flight attempt, not indefinitely for recovery. Do not record a user-chosen No
for absent, invalid or oversized guest data; follow B's eligibility rules for ordinary account entry.

Finish removing unreachable custom-auth/offline-account files, dependencies, fixtures and stale
comments. Preserve shared validation/security tests and historical SQL/ADRs/evidence. No destructive
browser/database cleanup. Report the exact deleted paths and their replacement coverage.

Run pnpm check, the complete development and freshly built preview browser suites, and PWA tests
under Node 24. Run affected PostgreSQL/API tests for any backend adjustment. Required final suites
must pass; isolated reruns do not clear unexplained failures. Obtain an independent review of
the final guest/account/auth/copy flows. Apply onboarding-code-comments to the final handwritten
implementation scope, preserving runtime behavior, then run the appropriate narrow checks.

Provide a concise owner-run live verification checklist for the dedicated Neon branch and later
Vercel Preview: real Google sign-in/out, two-account isolation, save/reload, copy/decline, guest
preservation, API/SPA routing and HTTPS behavior. Mark unexecuted provider checks as not run.
Update product/architecture/account guidance and history. Do not stage, commit, push, deploy,
change production credentials or migrate any remote database.
```

## 5. Retirement inventory

These are dependency-reviewed candidates, not permission to delete whole directories blindly.
Their existing callers still make them necessary today.

| Keep                                                   | Rewrite/reconnect                                                | Retire after callers are replaced                                                                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/domain`, v10 codecs, catalogue               | Managed identity mapping and authorization                       | `apps/api/src/auth/authentication.ts`, `google.ts` and exclusively custom OAuth/session issuance tests                                           |
| `packages/store`, dashboard/library/builder UI         | `account-api.ts`, AppShell, route composition                    | `account-database.ts`, `account-storage.ts`, `account-synchronization.ts`, `account-workspace.ts` and exclusively offline-account tests/fixtures |
| Guest `training-persistence.ts` and recovery           | Guest-only `PersistenceGate` and account memory-store provider   | Old `AccountWorkspaceProvider` and `AccountPersistenceBridge` once smaller providers serve callers                                               |
| API dashboard validation/body/canonicalization         | Dashboard/adoption SQL authorization, shared transaction helpers | Obsolete custom session SQL routines; keep genuinely shared transaction behavior                                                                 |
| Drizzle/pg runtime, migration tooling and SQL history  | Adoption module/UI for the new auth and memory-only account flow | `google-auth-library` when no caller remains; unused frontend/backend dependencies                                                               |
| Existing guest PWA, privacy and accessibility behavior | Analytics identity gating and route links                        | Old sync-status UI and IndexedDB-specific recovery UI                                                                                            |

Do not discard integration tests simply because they are difficult. Preserve the tests that prove
still-required behavior, and replace old implementation-specific fixtures with tests of the new
interface. Historical migrations may mention retired auth tables; that is expected and is not a
reason to rewrite migration history or drop data.

## Primary setup references

- [Managed Neon auth](https://neon.com/docs/auth/overview)
- [Google OAuth setup and exact callback URI](https://neon.com/docs/auth/guides/setup-oauth)
- [Trusted domains and localhost](https://neon.com/docs/auth/guides/configure-domains)
- [React/Vite integration](https://neon.com/docs/auth/quick-start/react)
- [Auth-only SDK](https://neon.com/docs/reference/javascript-sdk#initializing)
- [Connection pooling](https://neon.com/docs/connect/connection-pooling)
