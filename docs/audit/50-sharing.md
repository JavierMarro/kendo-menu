# Pass 5 — Saved-menu sharing and recipient import

The working-tree remediation addresses KM-05-001 through KM-05-004. The findings, payloads and
probe below preserve the original audit evidence at `4c64375`. The [index](README.md) records
verification of the fixes.

Audited 2026-11-11 (Europe/Madrid) on `codex/updated-audit-kendomenu`, HEAD
`4c64375dc955cb1002e1745af139b75572400df3`. The index was clean and only audit artifacts were
modified or untracked at intake. There were no untracked implementation files. The working tree
matched local `origin/main` (`ca8688a58671feccb167f08a4aee8fc3cd584d45`) outside `docs/audit/`.
Compared with `de4f84fcc356edcdd5b58a53bedd5030fb90830d` using the
[baseline commands](README.md#baseline). Of the 37 changed paths, rechecked the share page's recovery
button, dashboard card and filter, account provider/controller/client, auth/callback and guest-copy
continuation changes, with their tests. Share creation UI behavior, share codecs, API, PostgreSQL,
migration 0004, return-marker format, and hosted document wiring match the pinned baseline.

## Journeys and boundaries

- **Sender.** The account dashboard offers **Share it!** only on custom cards. The controller
  selects the entry from its acknowledged baseline. Pending or uncertain Save, identity failure,
  and unresolved conflict prevent Create. Draft-only edits stay out of the request. Create sends
  just the expected workspace, saved revision and entry ID. Clipboard and platform sharing act on
  the returned link and have no application write. [Dashboard](../../apps/web/src/features/dashboard/DashboardPage.tsx#L885),
  [dialog](../../apps/web/src/features/sharing/ShareMenuButton.tsx#L36),
  [saved selector](../../apps/web/src/lib/account-draft.ts#L127),
  [controller](../../apps/web/src/lib/account-draft.ts#L510)
- **Write authority and persistence.** Elysia leaves the body unparsed until the share handler checks
  headers, exact application Origin and mapped bearer identity. The workspace field is a mismatch
  guard. PostgreSQL locks the account and saved dashboard, rechecks identity and expiry, checks the
  exact revision, validates canonical v10/v11 data and finds the owned custom entry. The projection
  preserves ordering, intensity, effective quantities, zero, and fixed/ranged duration with a
  second unit when present. It excludes descriptions, notes, IDs, timestamps and provenance.
  The unique owner/source/version/digest key reuses identical content. New content inserts a
  32-byte random base64url token and acknowledges only after commit. Stale revision
  conflicts precede reuse. No dashboard revision or Save receipt changes. [Route](../../apps/api/src/shares/shares.ts#L181),
  [locks and projection](../../apps/api/src/persistence/postgres/managed-shares-adapter.ts#L219),
  [insertion and commit](../../apps/api/src/persistence/postgres/managed-shares-adapter.ts#L263),
  [DTO](../../packages/domain/src/menu-sharing.ts#L156)
- **Public preview.** The public GET sends no bearer and exposes only the validated snapshot.
  The adapter checks token shape, reads by token, and validates size, canonical JSON and digest.
  Missing, removed and malformed shares return generic unavailable results. The browser can
  preview even when the account dashboard is down. The public route sends no dashboard request
  until the user proceeds. The HTML handler serves a generic social card without fetching a
  menu. The client uses same-origin cookies for Preview access, while protected API access still
  requires a bearer. The HTML has `no-referrer`, `noindex, nofollow` and no canonical
  tag. The hydrated SPA sets canonical and `og:url` to `/app`. Tokenized static `og:url` is
  documented below. Guest analytics maps this path to `/404` and suppresses the referrer.
  [Client](../../apps/web/src/lib/account-api.ts#L983), [public API](../../apps/api/src/shares/shares.ts#L170),
  [stored read](../../apps/api/src/persistence/postgres/managed-shares-adapter.ts#L169),
  [static routing](../../vercel.json), [template](../../apps/web/shared-menu.html#L6),
  [hydrated metadata](../../apps/web/src/lib/route-metadata.ts#L89),
  [analytics mapping](../../apps/web/src/lib/guest-pageview.ts#L26)
- **Continue to account.** Signed-in visitors use the fixed recipient route. The signed-out CTA
  writes a per-tab version-1 marker containing only a valid token and 15-minute expiry. Callback
  consumption resolves the fixed local account path. Failed storage/start, cancellation, expiry
  and successful sign-out have explicit handling. A newly initialized account can visit one-time
  guest-copy setup. The provider holds the intended recipient route through Yes, No or skip,
  then resumes it. Public preview and sign-in never import automatically. [Marker](../../apps/web/src/lib/share-return.ts),
  [CTA](../../apps/web/src/features/sharing/SharedMenuPage.tsx#L201),
  [callback](../../apps/web/src/lib/managed-auth.ts#L183),
  [setup continuation](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx#L474)
- **Recipient read and explicit Add.** The recipient GET verifies the current mapped bearer,
  returns the same immutable content, an `isSender` boolean and the caller's workspace ID.
  The page keys loads by account and token and aborts the request on route exit or sign-out.
  Add requires an editable account draft. It validates content in a candidate memory store,
  assigns fresh IDs, preserves both duration units and preflights the complete UTF-8 Save body.
  Success changes the live store once. Other-account copies get `receivedViaShare: true` and own
  copies omit the marker. Rejected or duplicate actions leave the live draft intact. Add itself
  does not send a request. Ordinary v11 Save persists the copy and the Shared badge/filter read
  its provenance through edit and reload. [Recipient HTTP](../../apps/api/src/shares/shares.ts#L153),
  [recipient DB](../../apps/api/src/persistence/postgres/managed-shares-adapter.ts#L340),
  [page](../../apps/web/src/features/sharing/SharedMenuPage.tsx#L137),
  [atomic import](../../apps/web/src/lib/account-draft.ts#L465)
- **Lifetime.** Source changes and removals preserve existing links. Deleting the local owning
  account cascades only its hosted shares. Saved recipient copies and re-shares have independent
  lifetime. The approved plan has no per-account quota, link expiry, revocation UI, guest import,
  global import deduplication or provider account-deletion workflow. The existing database cleanup
  needed before local user deletion is part of a future workflow. [Migration](../../apps/api/drizzle/0004_solid_zaladane.sql#L1),
  [approved semantics](../CUSTOM_MENU_SHARING_PLAN.md#7-deletion-and-release-boundaries)

## Findings

### KM-05-001 · P2 · High confidence · Defect

The account workspace stays accessible after a protected recipient read rejects authentication.
The Chromium probe loaded a synthetic saved account dashboard, returned HTTP 401 for the recipient
read, and clicked Dashboard from the unavailable screen. The saved card was visible without a new
`GET /api/account`. The catch handler collapses the 401 into a local share error. It never invokes
the account fence. The client also rejects a valid foreign workspace response as a generic invalid
response. That mismatch is confirmed at the client boundary. The browser reproduction uses 401.
This violates the same verified-workspace invariant as KM-03-003 on a separate caller. No foreign
snapshot was installed and the server correctly denied the protected request.

Client tests check rejection of a foreign envelope. Browser sharing tests use successful
recipient responses and do not check what happens to account state after a 401. The existing Save
and share-create controller already hides and invalidates identity on 401 or a workspace mismatch.
Give a valid mismatched recipient response the existing mismatch code and invoke that account fence
for recipient 401/mismatch. Verify that a rejected read hides the prior draft and controls until
verified, while ordinary 404, 503 and malformed responses leave a verified workspace available.
[Recipient catch](../../apps/web/src/features/sharing/SharedMenuPage.tsx#L176),
[client binding](../../apps/web/src/lib/account-api.ts#L1043),
[existing fence](../../apps/web/src/lib/account-draft.ts#L266),
[provider checks](../../apps/web/src/features/account/ManagedAuthProvider.tsx#L138),
[client test](../../apps/web/src/lib/account-api.test.ts#L632), [browser probe](sharing-probes.mjs#L461)

### KM-05-002 · P3 · High confidence · Defect

Temporary share read failure is presented as a possibly invalid link or deleted owner, with no
in-page retry. Chromium received a public 503, showed that exact message, then loaded the same link
after the service recovered and the page was reloaded. The recipient uses the same catch and
unavailable screen. Reloading a recipient page can discard unrelated in-memory edits. The API
already distinguishes missing content from service/network failure, and existing HTTP/client tests
cover status and timeout without asserting the corresponding UI recovery. Keep the generic message
for missing/invalid links. Give transient failures a Retry that repeats only the failed share read.
Verify 503 → 200 in-place on both routes and verify that Retry preserves the recipient draft and
does not add or Save. [Handler statuses](../../apps/api/src/shares/shares.ts#L67),
[shared error screen](../../apps/web/src/features/sharing/SharedMenuPage.tsx#L266),
[timeout test](../../apps/web/src/lib/account-api.test.ts#L662), [browser probe](sharing-probes.mjs#L439)

### KM-05-003 · P3 · High confidence · Documentation defect

The original approved plan excludes tokens from Open Graph metadata. The later `5fa32c9` change,
current runbook and packaged test deliberately emit the requested share URL as initial `og:url`.
The local fake-link document probe verified that the URL contains its token, strips query parameters
and contains no snapshot. Metadata consumers can retain the share URL in that field. They already
have the URL when they fetch it, so this does not establish separate private-data disclosure. After
hydration the browser replaces `og:url` with the canonical `/app` URL. The later implementation
and test establish intent for static social previews. They do not record a decision reconciling
the original token-free rule. Explicitly reconcile the contract. If the original rule stands,
keep the generic social metadata and replace or omit the token-bearing value. If the hosted behavior
was approved, date the plan exception. Verify the initial HTML and hydrated metadata against the
chosen contract. [Plan](../CUSTOM_MENU_SHARING_PLAN.md#L145), [runbook](../runbooks/DEPLOYMENT.md#L21),
[adapter](../../api/%5B...path%5D.ts#L13), [package test](../../apps/api/src/vercel-package.node-test.ts#L109),
[document probe](sharing-probes.mjs#L287)

### KM-05-004 · P3 · High confidence · Documentation defect

Current handoffs still label sharing planned and the implemented endpoints proposed. The progress
record says the changes remain unstaged and uncommitted. The implementation is in the pinned merged
baseline and the checked-out code matches local `origin/main` outside the audit folder. Readers
could mistake historical status for current release evidence. Label the plan and original progress
state as dated history and link to current local verification and the owner-run release checklist.
Package and migration checks cannot catch this prose drift. Verify the handoff distinguishes the
merge, local PostgreSQL migration evidence and unverified production application.
[Plan status](../CUSTOM_MENU_SHARING_PLAN.md#L3), [endpoint status](../CUSTOM_MENU_SHARING_PLAN.md#L105),
[progress](../CUSTOM_MENU_SHARING_PROGRESS.md#L53), [sharing release check](../runbooks/DEPLOYMENT.md#L342)

Independent review traced the API, SQL, projection and browser identity seam and agreed with the
bounded identity finding and the metadata discrepancy. It found no confirmed server-side
authorization or note-projection defect in the reviewed paths.

## Request cost

Measured raw UTF-8 JSON bytes with the browser API client, actual Elysia handler and guarded local
PostgreSQL. The representative fixture has one section and one exercise. The larger fixture reaches
the 512-activity domain bound with four sections of 127 exercises, 200-character multibyte names,
two duration units, counts and a 256-character multibyte entry ID. It is a near-limit valid fixture
for the domain, well below the generic 2,097,152-byte HTTP body cap. Sizes exclude headers, path,
token exchange, TLS and compression.

| Endpoint                           | Trigger and JSON fields                                                                                             | Request bytes, typical / large | Response bytes, typical / large |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -----------------------------: | ------------------------------: |
| `POST /api/shares`                 | Explicit Create or retry. Workspace, revision, entry ID → token, workspace, source revision                         |                      116 / 873 |                       136 / 136 |
| `GET /api/shares/:token`           | Public preview on route load. Token in path → `{ snapshot }`                                                        |                          0 / 0 |                   456 / 391,402 |
| `GET /api/shares/:token/recipient` | Recipient route for the current verified account. Token in path and bearer → snapshot, `isSender`, caller workspace |                          0 / 0 |                   533 / 391,479 |

The self-recipient response was one byte smaller (`true` versus `false`). Retrying the unchanged
Create transferred the same bodies and reused the token. A stale revision must conflict before
reuse. All sampled success and error API responses were `private, no-store`. The raw hosted HTML
probe was 2,240 bytes and HEAD had no body. This pass did not measure live compression.

In Chromium, existing signed-in preview → recipient used one public GET, two account GETs, one
dashboard GET and one recipient GET, with four synthetic `/token` calls. Signed-out preview →
new account with empty guest storage used one public GET, one `/sign-in/social` POST, one
`/get-session` GET, two account GETs, one account POST, one dashboard GET and one recipient GET,
with six synthetic `/token` calls. Setup skipped without an adoption POST or guest write. Copy
and decline setup add their own requests as measured in [Pass 4](40-guest-copy.md#request-cost).
Explicit Add and duplicate-click suppression made no application requests.

Public and recipient share reads transfer 989 / 782,881 bytes combined. The second read rechecks
link existence and binds sender status to the verified account. Its snapshot is byte-equivalent
content from the same immutable row. A verified response that can reuse an already validated
public snapshot could reduce the duplicate bytes, but would need to check current token existence,
account binding and content identity, and still support direct recipient entry. Create already
sends a small reference to a saved revision. Keeping whole snapshots for the public read and for
standalone recipient entry preserves strict validation and atomic import.
[Database measurement](sharing-probes.mjs#L63), [browser trace](sharing-probes.mjs#L312)

## Verification and release evidence

Ran sequentially under Node 24.21.0 and pnpm 11.22.0. The database harness loaded the private
local test configuration without printing its contents. The URL guard passed before the suite.

```sh
pnpm --filter @kendo-menu/domain exec vitest run src/menu-sharing.test.ts
pnpm --filter @kendo-menu/store exec vitest run src/sharing-compatibility.test.ts
pnpm --filter @kendo-menu/web exec vitest run --config vitest.config.ts src/lib/share-return.test.ts src/lib/sharing-v11-compatibility.test.ts src/lib/account-api.test.ts src/lib/account-draft.test.ts src/features/sharing/ShareMenuButton.test.tsx src/features/sharing/SharedMenuPage.test.tsx
pnpm --filter @kendo-menu/api exec vitest run --config vitest.config.ts src/shares/shares.test.ts
pnpm db:check
pnpm test:api:package
(
  cd apps/api
  node --env-file=.env.test.local --import tsx --input-type=module -e 'import { validateTestDatabaseUrl } from "./src/database/test-database.ts"; validateTestDatabaseUrl(process.env.TEST_DATABASE_URL)'
  node --env-file=.env.test.local --import tsx ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts src/persistence/managed-shares.integration.test.ts
)
pnpm test:e2e:preview --workers=2 menu-sharing.spec.ts
pnpm exec eslint docs/audit/sharing-probes.mjs
node --env-file=apps/api/.env.test.local --import ./apps/api/node_modules/tsx/dist/loader.mjs docs/audit/sharing-probes.mjs db
node --import ./apps/api/node_modules/tsx/dist/loader.mjs docs/audit/sharing-probes.mjs metadata
node --import ./apps/api/node_modules/tsx/dist/loader.mjs docs/audit/sharing-probes.mjs browser
```

- **Domain 6, store 3, web 103 and API 6 passed.** Covered DTO field allow-lists, zero/dual
  quantities, version compatibility, return-marker bounds and cleanup, wrong workspace rejection,
  dirty baseline selection, aggregate-size failure with unchanged draft, and authenticated reads.
- **Migration metadata, 2 packaged checks and 8 guarded PostgreSQL cases passed.** Covered
  concurrent creates, notes-only reuse, changed quantities, stale revision, foreign/curated/missing
  entries, rollback and a committed create with lost response, removal and cascade. The supplemental
  probe used actual HTTP contracts over local PostgreSQL for wrong Origin, malformed/oversized body,
  bad/missing token, method, unauthenticated recipient, no-store, and actual v11 import → Save →
  re-share → source removal/local owner deletion. A new recipient note persisted privately and was
  excluded from the re-share. [PostgreSQL suite](../../apps/api/src/persistence/managed-shares.integration.test.ts#L184)
- **14 Chromium preview cases passed.** Desktop and mobile emulation exercised existing sign-in
  and Yes/No setup, quantity rendering, independent edit/save/reload, Shared filter, guest byte
  preservation, sender-only controls, focus return and pending dialog dismissal. Browser transport
  and hosted routing were synthetic. Additional development Chromium probes confirmed empty-guest
  skip, own-link behavior, double-click suppression, route/sign-out cancellation, the 401 account
  fence gap and 503 recovery. An initial probe assertion targeted a signed-in label inside a
  collapsed menu. The corrected probe checked dashboard navigation and account request counts.
  [Browser suite](../../apps/web/e2e/menu-sharing.spec.ts#L56), [probe](sharing-probes.mjs#L312)

All planned scoped commands ran. The runbook requires production migration 0004 and a hosted/API
smoke check. Git history establishes the code merge. The checkout and guarded tests establish
local behavior and migration compatibility. Real Google/Neon timing, production migration and
runtime role, deployed HTTPS rewrites, external preview caching and native clipboard/share-sheet
behavior remain unverified. General PWA and browser coverage belongs to Pass 6. No application,
existing test, dependency, configuration or migration changed during this pass.
