# Custom-menu sharing implementation plan

Prepared 8 November 2026 against `8f0a895`. This plan records the owner's approved sharing journey.
It supersedes the earlier exclusion of public sharing for this feature. Existing authentication,
guest isolation and explicit account-save rules remain. The feature was implemented and merged.
See the [progress record](CUSTOM_MENU_SHARING_PROGRESS.md) for local verification and release status.

## 1. Approved behavior

- Only signed-in accounts can share, and only their custom dashboard menus. Curated/library
  menus are excluded in both UI and server validation, including adapted library entries.
- **Share it!** is a button in the dashboard card action row, in the position indicated by the
  owner. Guest cards have no sharing action.
- Share the last acknowledged account version, never unsaved browser contents. Show:
  “This shares your last saved version. Save to account first to include your changes.”
  A never-saved custom menu requires Save to account before it can be shared.
- Snapshot only the menu name, intensity, ordered activities/exercises and effective quantities.
  Exclude descriptions, menu notes, activity notes, exercise notes, author identity and account
  metadata. Quantity overrides must be folded into the snapshot, including explicit zero values.
- Anyone with a link can preview without authentication. Preview does not add or save anything.
- **Sign in to add** returns the visitor to that menu after Google authentication and any required
  new-account setup. Adding requires a verified account and an editable, loaded account draft.
- Add an independent, fully editable custom copy to the recipient's in-memory dashboard. Clearly
  say it is added but needs **Save to account**. Reuse the existing complete-dashboard save; never
  silently save unrelated changes. No guest/LocalStorage import.
- Received copies display **Custom**, **Shared** and the existing intensity badge when present.
  Dashboard **Shared** filters received menus, not menus the owner has sent. Editing a received
  copy retains Shared; custom editing and re-sharing remain available.
- Unchanged shareable content from the same source menu reuses its link. Changed content creates
  a new link; notes-only changes do not. Old snapshots never update. No expiry or disable-link UI.
- Removing the source menu does not remove its links. Deleting the owning KendoMenu account
  must remove its hosted shares; recipient copies and their edits survive independently. This is
  the approved lifecycle contract, not a claim that an account-deletion workflow exists: see section 7.

## 2. Verified code seams and consequences

| Current evidence                                                                                                                                                                                           | Implementation consequence                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [Domain types](../packages/domain/src/types.ts) and [dashboard codec](../packages/domain/src/dashboard-persistence.ts) store independent custom snapshots with strict v10 allow-lists.                     | Shared provenance needs an explicit versioned contract change, not an extra unchecked JSON property.                                          |
| [Store](../packages/store/src/index.ts) already builds fresh IDs, validates size limits, edits custom menus and preserves entry fields.                                                                    | Reuse custom construction; add one atomic import operation with provenance. Avoid separate add-then-mark mutations.                           |
| [Dashboard](../apps/web/src/features/dashboard/DashboardPage.tsx) and [filters](../apps/web/src/lib/training-data.ts) already share guest/account rendering.                                               | Gate sharing by workspace, add an entry-level Shared predicate and badge; leave library tagging unchanged.                                    |
| [Account draft controller](../apps/web/src/lib/account-draft.ts) keeps a private acknowledged baseline and exposes revision plus whole-dashboard dirty state.                                              | Add a narrow saved-menu selector for eligibility and per-menu comparison; do not expose mutable baseline state.                               |
| [Dashboard adapter](../apps/api/src/persistence/postgres/managed-dashboard-adapter.ts) verifies identities and uses account-first locks, canonical saved JSON and revision guards.                         | Create shares from a validated saved entry under the same lock order; do not accept a client snapshot as the source.                          |
| [API routes](../apps/api/src/app.ts) and [runtime](../apps/api/src/runtime.ts) compose lazy services with no-store responses.                                                                              | Add a small sharing service/persistence boundary; public read must not invoke account initialization.                                         |
| [Auth return](../apps/web/src/lib/auth-return.ts), [managed auth](../apps/web/src/lib/managed-auth.ts) and [sign-in](../apps/web/src/features/account/SignInPage.tsx) use fixed destinations.              | Add a bounded share-intent continuation, never an arbitrary redirect URL; preserve the verifier-clean fresh-document exchange.                |
| [Account workspace](../apps/web/src/features/account/AccountWorkspaceProvider.tsx) owns draft lifetime and redirects eligible new users to [setup](../apps/web/src/features/account/AccountSetupPage.tsx). | Resume the shared-menu journey after setup, without remounting/discarding an existing account draft or auto-importing.                        |
| [Schema](../apps/api/src/persistence/schema.ts) maps managed identities to local users; existing account foreign keys use RESTRICT.                                                                        | A share foreign key can cascade when a local user is deleted, but does not implement deletion of that user or observe provider-side deletion. |

## 3. Contracts and persistence

### Note-free share payload

Add a small versioned domain share DTO/parser and projection. Reuse training input validation,
quantity units and limits. Its explicit allow-list contains only approved content, with no source
IDs. Preserve section/exercise order and quantities at both levels. Fail on unsupported structure
instead of flattening or dropping activities. Generate new entry, menu and activity IDs on import.

Preserve quantity units and fixed/ranged duration semantics, not just display strings or numbers.
Reconstruct custom-menu editing capabilities through the existing custom builder/adaptation rules;
verify that all supported source units remain editable after import. Custom wire menus currently
use two levels despite the recursive runtime model; do not add generic recursive import machinery
or discard deeper structures silently.

Project from a validated persisted custom entry, applying its quantity overrides. Use a canonical
representation and existing server hashing for comparison. Exclude note fields, generated IDs,
timestamps and imported Shared provenance from the digest. This also makes re-sharing a received
menu an independent hosted snapshot owned by the new sender.

### Received provenance and v11

Add optional entry-level `receivedViaShare: true` for received custom copies. Absence means ordinary
origin; reject it on library entries. It is a UI origin label, not an authorization or verified
authorship claim. No foreign key, source-account ID or live-link dependency belongs in a recipient
dashboard. Editing, undo/remove, exports, reload and account saves must preserve the marker.

Introduce dashboard/store format v11 and migrate supported legacy guest formats through existing
migrations to v11, with no Shared marker on old entries. Keep v10 parsing intact for existing cloud
rows. Update cloud read/write validation, canonicalization, account API/controller, guest-copy
transport, backup/inspection/recovery paths and fixtures together. Old canonical v10 rows must be
validated as v10 before any in-memory conversion; never compare converted bytes to old digests.

Compatibility rule: new clients read v10/v11 and write v11; the API continues reading v10 rows and
validating retained v10 receipts without rehashing converted requests. A new v10 write against a
v11 dashboard must fail explicitly as an unsupported client, preserving the existing dashboard.
Exact retained retries still replay their original acknowledgement before version-transition rules.
Test that stale clients cannot erase provenance. Do not bulk rewrite cloud rows or increment their
revisions just to read them. Ship backend compatibility before exposing v11 clients; deployment is
a separate authorized task. Recheck all version-10 callers rather than mechanically renaming them.

### Hosted share records

Add `menu_shares` through a reviewed forward Drizzle migration, with opaque random public token,
owner local-user foreign key (`ON DELETE CASCADE`), source dashboard-entry ID (plain value, no
entry-lifetime foreign key), payload version, canonical note-free payload, digest and creation time.
Unique `(owner, source entry, payload version, digest)` provides deterministic link reuse and
concurrent-create deduplication. Verify canonical payload equality on reuse. Random token generation
must be cryptographic and collision-safe; never publish account IDs or sequential database IDs.

Read with bounded parsing and strict output validation. Keep responses no-store and exclude share
payloads from service-worker caches. There is no public listing endpoint. Apply existing content
and request-size limits, but no per-account hosted-snapshot count cap. The owner chose this for
the initial personal/small-friends audience on 8 November 2026. Reuse unchanged snapshots; do not
silently expire links. Revisit a count quota only if actual usage or storage growth warrants it.

## 4. API and race behavior

| Endpoint                           | Contract                                                                                                                                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/shares`                 | Managed bearer and write-origin checks before body acquisition. The bounded body carries the expected account, dashboard revision and source entry ID. Returns the token, workspace ID and confirmed source revision after commit. |
| `GET /api/shares/:token`           | Public bounded note-free snapshot; no identity, owner ID, source entry ID or account initialization. Missing/deleted share yields a generic unavailable/not-found view.                                                            |
| `GET /api/shares/:token/recipient` | Verified account read returning validated import content and whether the caller is the sender. No dashboard write. Used inside account routes; only copies from another account receive Shared.                                    |

Create locks/verifies the account first, validates the stored dashboard and expected revision, then
finds the requested custom entry and inserts/reuses its canonical projection. Reject other-owner,
missing, built-in and never-saved entries. Sharing does not alter the dashboard revision, consume a
guest-copy opportunity or acknowledge an ordinary Save.

An unexpected revision returns conflict without creating a share. Keep the user's draft and offer
the existing reload/conflict path, never overwrite it silently. Disable share creation while Save
is in flight or uncertain, identity is unresolved, or account service is unavailable. The baseline
selector updates only on acknowledged Save, so edits made during Save remain unsaved.

Retry after a lost response with the same source/revision: uniqueness returns the same share if the
dashboard is unchanged. If the dashboard changed meanwhile, return conflict rather than sharing a
different version. No new durable retry journal is required. Account deletion and creation serialize
through the account row; an in-flight public response may already have been delivered, but subsequent
uncached requests must fail after deletion. Already delivered content cannot be retracted.

Recipient fetch/add must fence late responses on sign-out, account change, route change and disposal.
Add exactly once per deliberate button activation; disable during processing and show success. A
later explicit import may create another independent copy; global import deduplication is not required.
Validate aggregate dashboard size before the atomic add, preserving the draft on failure. A recipient
copy already added remains saveable if its source link subsequently disappears.

## 5. Browser journey

Generate public links at `/share/:token`, outside the offline navigation fallback. Keep existing
`/app/shared/:token` links valid. Use `/app/account/shared/:token` for the same preview plus Add.
Keep the account page under the existing provider so opening it from a dirty
dashboard preserves the store. Both use a dedicated read-only renderer of the share DTO; do not
mount guest persistence or expose note inputs. Reuse existing presentation components where they
fit without making all training components understand sharing.

Preserve the existing noncanonical-route noindex behavior in `route-metadata.ts`; do not publish
share tokens in canonical/Open Graph metadata or add a public directory. A noindex hint is not
access control: the link remains readable and forwardable by anyone who has it.

Use a short-lived, bounded per-tab continuation containing only a validated share token and expiry,
separate from the existing callback-flow marker. Never store credentials, account identity, draft
content or arbitrary URLs. Share sign-in uses the fixed `/share/auth/callback` exchange, followed
by `/share/:token/add`, which enters the guarded account shared-menu route in-app. These document
paths bypass the pre-sharing worker's `/app` navigation fallback. Resume the recipient route after
verified account initialization and any guest-copy setup.
Do not automatically import on return. Clear the continuation on consumption, cancellation, sign-out
or expiry; missing/blocked storage falls back honestly to reopening the original link. It is navigation
state, not a durable guest-copy recovery mechanism.

The sender opens a small share dialog with the saved-version warning where applicable. After create,
offer **Copy link** and an optional platform share action when supported; a selectable link remains
available if clipboard access fails. Creating/copying a link must not launch a message to anyone.
Include pending/error/retry feedback, keyboard operation and focus return. Prefer an explicit second
platform-share click after asynchronous creation so browser user-activation requirements are respected.

Add Shared beside Custom/intensity and to the dashboard filter; preserve it after editing and saved
reload. Display no Shared badge merely because an owner clicked Share it. Self-link imports remain
ordinary custom copies. Retain existing full editor, quantity and note editing on recipient copies;
new recipient notes are private and excluded again on re-share.

## 6. Sequential implementation jobs and acceptance gates

1. **Domain and compatibility foundation.** Implement DTO projection/parser, v11 provenance and
   migrations, plus all cloud/client/guest-copy codec changes as one coherent compatibility slice.
   Tests: zero overrides, quantities at each level, ordering, maximum valid sizes, unsupported shapes,
   all note/description/identity exclusion, old/future/malformed formats, canonical v10 reads/receipts,
   no provenance loss through old-client writes, backup/recovery and guest-copy regression coverage.
   Run `pnpm check:domain`, `pnpm check:store`, `pnpm check:api`, `pnpm check:web` sequentially.
2. **Sharing service and PostgreSQL.** Add schema/migration/metadata, typed persistence port and adapter,
   runtime composition and HTTP routes. Extend `dev-proxy-rules.ts` and its tests for the dynamic
   share paths, and Node/API package tests. The existing `api/[...path].ts` delegates to the common
   route table; verify that adapter without adding another application surface.
   Test ownership, built-in rejection, saved-only extraction, revision races, note-free public output,
   limits, concurrent deduplication, unchanged/notes-only/changed content, rollback and uncertain commit.
   Test source removal retains links, local-account deletion removes shares, recipient snapshots survive,
   and re-shares have their own owner. Run `pnpm check:api`, `pnpm test:api:integration`, `pnpm db:check`.
3. **Public preview and auth continuation.** Add both routes and client methods, setup-aware return,
   validation/error states and read-only rendering. Cover existing/new accounts, guest-copy Yes/No/skip/
   unconfirmed load, cancelled sign-in, invalid/expired markers, storage unavailable, malicious redirect
   input, verifier cleanup and independent tabs. Run `pnpm check:web` and relevant auth/setup E2E.
4. **Create, import and dashboard UI.** Add the saved-entry selector, sender dialog, atomic custom import,
   badges and Shared filter. Cover hidden guest/library actions; unsaved and never-saved menus; full edit;
   add versus save messages; duplicate clicks; account changes; full dashboards; save failure/conflict;
   reload persistence; imported Shared retained after edit; sent-only menus excluded by filter. Extend
   dashboard/store tests, `custom-menu-edit.spec.ts` and managed-account browser coverage. Run affected
   package checks and `pnpm test:e2e` sequentially, including mobile, desktop and keyboard interactions.
5. **Independent review and completion evidence.** Review actual implementation for ownership, data
   loss, note leakage, format compatibility and account-lifetime races; resolve substantive findings.
   Run `pnpm check` for the complete cross-package diff. Before a separately authorized release run
   `pnpm verify:full` (preview E2E plus separate PWA coverage) and real local database gates. Confirm
   public shares are not cached offline and guest persistence still works. Reuse checks only when
   they cover the exact unchanged diff/configuration.

Use Node 24 and the declared pnpm version for implementation gates. Integration tests may use only
guarded local `TEST_DATABASE_URL` for `kendomenu_test`, never Neon or another database. Missing local
configuration is NOT RUN, not a pass. No private environment file inspection is needed.

Update PRODUCT, architecture and current account/dashboard contract docs when implementation lands,
clearly replacing the old public-sharing exclusion. Document provenance semantics and the new wire
version, public link visibility, note exclusion, deletion behavior and explicit account saving.
Update user-facing privacy text for hosted public snapshots without changing analytics configuration.
No dependencies are currently identified as necessary.

## 7. Deletion and release boundaries

This feature implements the share-record lifetime relationship and verifies it in local database
tests. It does **not** add a Delete account UI/API, a provider webhook or remote deletion operation.
Deleting a Neon-managed identity alone is not evidence that its local user/shares were deleted.
Any future account deletion workflow must remove hosted shares as part of deleting the local account,
handle existing RESTRICT relationships, and preserve other accounts' imported snapshots. Do not
claim end-to-end provider deletion support until that separately scoped workflow exists and is tested.

Implementation does not authorize deployment, remote migrations, environment/secret changes, DNS,
Vercel configuration changes, Git staging/commits/pushes or branch switches. Live Google return,
HTTPS link sharing/clipboard behavior, two-account independence and hosted-route delivery require
separate observed evidence on an authorized environment; local synthetic E2E cannot prove them.

## 8. Plan verification record

- Inspected actual source contracts, account saved baseline and lifetime, API transaction/identity
  boundaries, strict codecs, auth callback/setup routes, migration layout, browser test inventory and
  package scripts. No implementation or live behavior is claimed from this inspection.
- Planning shell reports Node `v25.2.1` and pnpm `11.22.0`. Application checks have not been run;
  this is not Node 24 application verification.
- Documentation formatting, relative-link existence, diff whitespace and independent plan review:
  Prettier passed; all 15 relative source links exist; whitespace check found no errors. An independent
  reviewer inspected the plan and relevant source, found the core flow sound, and identified the
  deletion limitation, then-unresolved quota and quantity-editability detail. Those caveats and tests
  are now explicit. This is plan review, not approval or execution of the future implementation.
- The owner subsequently resolved the quota question: no per-account hosted-snapshot count cap
  for this version. Payload validation, request-size limits and snapshot deduplication remain required.
