# Pass 3 — Account dashboard load, edit, save and replay

Audited `codex/updated-audit-kendomenu` at `7f9f1530e7d03109ae979b3ea17bc4fe15027480` on
2026-11-10 (Europe/Madrid). The pinned Pass 0 baseline is
`de4f84fcc356edcdd5b58a53bedd5030fb90830d`. The index was clean. The committed Pass 1 fixes
changed the shared dashboard editor and guest persistence. Unstaged Pass 2 remediation changed
the account route/provider, auth/token client, shared preview's auth recovery, and associated tests.
Included the untracked [account recovery button](../../apps/web/src/features/account/AccountRecoveryButton.tsx).
The account draft/client, API, domain, store, SQL and migrations match the pinned baseline.
The [audit index](README.md) and untracked [Pass 2 report](20-identity.md) were present at intake.

Reviewed working-copy fingerprints (`git hash-object`): `AccountWorkspaceProvider.tsx` `c013abbb`,
`ManagedAuthProvider.tsx` `8bdcc197`, `AccountRecoveryButton.tsx` `e7fb984a`,
`DashboardPage.tsx` `dfc38ebd`, `managed-auth.ts` `fbe144ba`, `account-draft.ts` `5678fc4f`,
`account-api.ts` `f489529c`, `dashboard.ts` `a09c13f0`, managed dashboard adapter `c201aa69`.
No application, test, dependency, configuration or migration edits were made in this pass.

## Findings

### KM-03-001 — Account Save can acknowledge an earlier note while showing a rejected edit

**P2 · High confidence · Defect.** On a valid near-limit dashboard, type a small accepted
practice note, replace it with a longer note that breaches the full store bound, and click
**Save your changes**. The dialog still shows the longer note when it says **Changes saved to
your account.** The submitted dashboard contains the earlier note and the replacement disappears
after reload.

- **Cause and invariant.** The [input handler](../../apps/web/src/features/dashboard/DashboardPage.tsx#L663)
  updates its React draft before invoking the store. The [store](../../packages/store/src/index.ts#L806)
  throws before mutating its state when the full dashboard exceeds its serialized bound.
  [Account blur](../../apps/web/src/features/dashboard/DashboardPage.tsx#L647) bypasses rejected-edit
  tracking used by guest mode. The [form](../../apps/web/src/features/dashboard/DashboardPage.tsx#L681)
  then saves the still-dirty accepted state. Confirmation must correspond to the visible edit.
- **Evidence and gap.** The [browser probe](account-dashboard-probes.mjs) loaded a valid 2,097,148-byte
  synthetic PUT-equivalent fixture, accepted `OK`, and attempted a 480-character replacement.
  Chromium recorded exceptions on change and blur. The one PUT was 2,097,150 bytes, carried
  `OK`, received a matching synthetic acknowledgement, and reload showed `OK`. The
  [ordinary account browser case](../../apps/web/e2e/managed-account.spec.ts#L485) and
  [editor tests](../../apps/web/src/test/account-dashboard-editors.integration.test.tsx#L195)
  use accepted edits. The [guest limit regression](../../apps/web/e2e/custom-menu-edit.spec.ts#L172)
  never exercises the account branch.
- **Smallest fix and acceptance.** Handle rejection on account change and blur with the existing
  field-rejection feedback. Keep rejected text correctable and keep both Save entry points from
  implying it was committed. Verify no false success or uncaught error for the fixture, then
  shorten the note and verify the displayed replacement appears in the PUT and after reload.

### KM-03-002 — Uncertain Save has no explicit in-app Reload action

**P3 · High confidence · Documentation defect.** The current
[account state table](../MANAGED_ACCOUNT_WEB.md#L41) describes a warned explicit reload as an
exit from an ambiguous Save. The [dashboard](../../apps/web/src/features/dashboard/DashboardPage.tsx#L366)
offers Reload only for conflict or blocked saves. The [workspace](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx#L596)
offers a connection probe, which keeps the pending Save and revision.

- **Evidence and gap.** Chromium observed **Retry same save** and **Download draft** but no
  **Reload account**, both before and after a successful connection probe. The browser's own
  refresh remains available with a best-effort leave warning. The
  [uncertain Save test](../../apps/web/e2e/managed-account.spec.ts#L566) asserts exact replay, and
  the [conflict test](../../apps/web/e2e/managed-account.spec.ts#L585) exercises in-app reload.
  Neither checks the documented uncertainty exit.
- **Smallest fix and acceptance.** Align the state table with the approved retry/download
  recovery and best-effort browser refresh, unless a warned in-app discard/reload is confirmed
  as required. Keep the conflict Reload documented. The [product brief](../../PRODUCT.md#L123)
  specifies exact retry for uncertainty and explicit reload for conflict. This is a documented
  behavior discrepancy rather than evidence of failed replay or loss of export.

### KM-03-003 — A foreign dashboard response can leave the prior account draft visible

**P2 · High confidence in the conditional browser behavior · Defect, privacy.** If the managed
identity changes between a successful account-A preflight and the separately authenticated
dashboard GET, a valid account-B response is rejected. The old A draft stays visible and can
still be exported because that rejection is treated as service unavailability.

- **Cause and invariant.** Each request acquires its own [bearer](../../apps/web/src/lib/account-api.ts#L964).
  [Dashboard response parsing](../../apps/web/src/lib/account-api.ts#L312) checks the workspace ID
  but reports every parse rejection as [invalid response](../../apps/web/src/lib/account-api.ts#L1125).
  [Load](../../apps/web/src/lib/account-draft.ts#L307) and
  [connection retry](../../apps/web/src/lib/account-draft.ts#L431) preserve the visible store after
  a successful preflight. [The auth fence](../../apps/web/src/lib/account-draft.ts#L266) recognizes
  a 401 and explicit workspace mismatch. A valid foreign response must invalidate the previous
  verification instead of preserving access to the prior draft.
- **Evidence and gap.** The [browser probe](account-dashboard-probes.mjs) asserted
  `GET /api/account` returned A, then switched the synthetic mapping before `GET /api/dashboard`
  and asserted that response named B. It observed A's card and downloaded an export containing
  A's private note. The browser rejected B's snapshot. Existing
  [API-client binding tests](../../apps/web/src/lib/account-api.test.ts#L185) exercise rejection,
  and the [controller](../../apps/web/src/lib/account-draft.test.ts#L686) and
  [browser](../../apps/web/e2e/managed-account.spec.ts#L964) cover changes detected by verification.
  They miss the gap between the two requests. Local synthetic switching establishes the behavior
  given this sequence. The timing with live Neon and peer lifecycle events remains unverified.
- **Smallest fix and acceptance.** Surface a valid foreign workspace ID as the existing mismatch
  outcome, hide and fence the old draft and require verified identity again. Cover reload and
  connection retry with A then B responses, asserting A cannot render or export. Preserve normal
  same-account read-only behavior for a generic storage failure. This does not indicate that
  PostgreSQL served data without authorization or that B's dashboard was installed in A's view.

### KM-03-004 — Managed dashboard handoff documents the wrong version response

**P3 · High confidence · Documentation defect.** The [endpoint table](../MANAGED_DASHBOARDS.md#L25)
still describes v10-only GET. The [v11 extension](../MANAGED_DASHBOARDS.md#L174) incorrectly
documents a new v10 write over v11 as `422 UNSUPPORTED_DASHBOARD_VERSION`. The actual
[handler](../../apps/api/src/dashboard/dashboard.ts#L184) returns
`409 DASHBOARD_VERSION_UPGRADE_REQUIRED`. 422 is used for an unsupported payload version at
the [validation boundary](../../apps/api/src/dashboard/dashboard.ts#L151).

- **Evidence and gap.** The guarded probe got the 409 on a valid fresh v10 request against
  revision 2 (v11). The [existing HTTP test](../../apps/api/src/dashboard/managed-dashboard.test.ts#L166)
  asserts the correct code, and the [SQL test](../../apps/api/src/persistence/managed-dashboard.integration.test.ts#L228)
  checks the transition and old replay. These tests cannot detect a stale handoff. Integrators
  relying on the table would handle the wrong status or reject valid GET versions.
- **Smallest fix and acceptance.** Correct the handoff table and extension against the current
  tests, and update the v10-only comments in [schema](../../apps/api/src/persistence/schema.ts#L276)
  and [adapter](../../apps/api/src/persistence/postgres/managed-dashboard-adapter.ts#L1)
  when touching those files. Leave historical handoffs and migrations as historical evidence.

Independent review confirmed KM-03-001 and KM-03-003 at P2. For KM-03-002 it confirmed the
documentation divergence and withdrew an initial concern about Download after observing the
[dashboard-level warning](../../apps/web/src/features/dashboard/DashboardPage.tsx#L436).

## Journey, boundaries and verification

| Stage                            | Current behavior and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Load                             | The [auth provider](../../apps/web/src/features/account/ManagedAuthProvider.tsx#L44) verifies identity. The [account route](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx#L42) keys the controller by account. Its [load](../../apps/web/src/lib/account-draft.ts#L278) verifies again and requests the whole dashboard. Revision 0 has null dashboard and timestamp. A positive revision can contain an explicitly saved empty snapshot. Client binds the account, parses v10/v11, and checks catalogue references before the controller installs a memory-backed Zustand store.                                                                                                                                                                                                                                                                                                                                 |
| Edit                             | [Library add](../../apps/web/src/features/library/DrillDetailContent.tsx#L68), [builder](../../apps/web/src/features/custom-sets/CreateDrillPage.tsx#L129) and [dashboard detail](../../apps/web/src/features/dashboard/DashboardPage.tsx#L534) use the active store. Mutations validate complete domain bounds before applying. No dashboard request on typing, local add or builder commit. Focused valid values enter the draft, unfinished quantity input blocks Save and download. Edits during Save stay dirty when the submitted baseline alone is acknowledged.                                                                                                                                                                                                                                                                                                                                                              |
| Save and receipt                 | The [controller](../../apps/web/src/lib/account-draft.ts#L561) freezes one v11 intent and submitted baseline. Both Save controls reach it. [HTTP](../../apps/api/src/dashboard/dashboard.ts#L86) checks method, query, headers, Origin and managed auth before reading bounded strict UTF-8 JSON. Server-owned mapping authorizes access, while the expected workspace is a mismatch guard. [SQL](../../apps/api/src/persistence/postgres/managed-dashboard-adapter.ts#L264) rechecks mapped proof/expiry and locks the account, then receipt and dashboard rows. Queries bind parameters. New writes update snapshot and revision, record digest/receipt, consume an unused copy opportunity and prune receipts atomically. The [transaction runner](../../apps/api/src/persistence/postgres/adapter.ts#L63) acknowledges after COMMIT. Errors expose fixed codes. Private/no-store responses were observed at the Elysia boundary. |
| Conflict, unavailable and reload | A stale new ID returns 409 with current revision. UI retains the original draft/revision and offers export and warned reload. A failed reload retains the draft. A failed identity check hides it, subject to KM-03-003. Reconnect probes GET and discards its snapshot. A valid explicit reload installs the new store and remounts editor state. The draft and unresolved request live only in this tab, with no auto-merge or offline account durability under [ADR 0007](../adr/0007-managed-auth-online-account-drafts.md).                                                                                                                                                                                                                                                                                                                                                                                                     |
| Ambiguous Save                   | Timeout, service error or invalid acknowledgement after dispatch can leave outcome uncertain. Exact retry resends frozen bytes and ID. Receipt comparison precedes current catalogue and revision for structurally valid writes. Different intent under the same ID rejects. A retained receipt can return an older revision without mutating the current row. Cleanup runs on successful new writes, with seven-day age pruning and a cap of 1,024 receipts. Lost COMMIT response is distinct from confirmed rollback.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Versions and rollout             | Guarded SQL and browser client accepted v10 load and v11 Save. v11 provenance survives read-back in the SQL suite. Exact retained v10 replay after v11 returns its original acknowledgement, and a new v10 write returns 409. No read-time rewrite. A change to the ordered catalogue digest requires explicit rollout verification against existing saved rows because [stored reads](../../apps/api/src/persistence/postgres/managed-dashboard-adapter.ts#L141) compare the row to the current catalogue even for structurally compatible content. No catalogue change or production rollout was undertaken.                                                                                                                                                                                                                                                                                                                       |

The managed online-account architecture is the approved target and is present in this checkout.
[The managed dashboard handoff](../MANAGED_DASHBOARDS.md#L140) distinguishes its owner-reported
journey from live gates. This pass provides local behavior only. It does not establish what
revision of the application is currently deployed. The legacy account cache and automatic sync
documents are historical, with no current recovery or migration obligations for this pass.

## Payload and request costs

Measured UTF-8 JSON bodies at the real browser serializer and Elysia Request/Response seam
backed by guarded PostgreSQL. The representative fixture has one curated and one custom menu
with six exercises and ordinary notes. The near-limit case uses bounded exercise notes
containing three-byte UTF-8 characters and fills the entire PUT envelope. Headers, cookies, JWT
bytes, network framing, compression and live provider/hosting cost are excluded.

| Request                        | Trigger and fields                                                                                                                  |                                                   Request bytes |                                          Response bytes |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------: | ------------------------------------------------------: |
| `GET /api/account`             | App verification and one preflight per load, Save, retry or probe. Returns workspace ID and nullable email.                         |                                                               0 |                                                      81 |
| `GET /api/dashboard`           | Load/reload or connection probe. Returns transport version, workspace, catalogue, revision, timestamp and whole versioned snapshot. |                                                               0 | 217 empty / 1,475 representative / 2,097,124 near limit |
| `PUT /api/dashboard`           | Explicit dirty Save or identical retry. Version, expected workspace/revision, request ID, catalogue and whole versioned snapshot.   | 1,503 v10 seed / 1,518 v11 edit or retry / 2,097,152 near limit |                                     187 acknowledgement |
| `PUT /api/dashboard` rejection | Stale expected revision, or new v10 write over v11. No dashboard in response.                                                       |                                                      1,503 each |               51 revision conflict / 46 version upgrade |

- Chromium observed a cold verified-account entry make two account GETs and one dashboard GET,
  with three synthetic issuer calls. An ordinary Save or exact retry each used one account GET
  and one PUT. Each protected browser operation asks for a token. Reconnect adds one account GET
  and a full dashboard GET even though the response snapshot is discarded. Probe steps were
  settled between actions. Focus events can add independent identity checks.
- The lost-ack probe observed byte-identical v11 submissions (3,036 total upload bytes),
  with two 81-byte preflight responses. The server produced two 187-byte acknowledgements and
  the first was deliberately discarded. Replaying a maximum-size PUT would upload 4,194,304
  bytes across both attempts, an estimate based on the measured per-attempt cap.
- Complete snapshots are a coherent fit for bounded, explicit Saves of potentially multiple
  changes and removals. They let the server validate one coherent object, commit one revision
  and bind a single replay digest. A focused update would need reconstruction and equivalent
  validation/receipt semantics. The observed waste is in extra preflight/connection traffic and
  repeated full serialization, especially at the limit. The SQL write also reads the previous
  full row under lock before replacement. [Validation](../../apps/api/src/dashboard/validation.ts#L96)
  canonicalizes the full intent twice (once for the text and once for its hash), then canonicalizes
  the snapshot. These are source-level CPU/allocation costs. Latency and throughput remain
  unmeasured. Keep authorization/fencing intact when evaluating reductions.

## Commands and evidence limits

Selected Node **24.21.0**, pnpm **11.22.0** via the [audit index](README.md). The CI pin is
Node 24.12.0. Ran suites sequentially.

- `pnpm check:domain` (89) and `pnpm check:store` (83) passed, including typecheck and lint.
- `pnpm check:api` initially hit 28 loopback `listen EPERM` cases under the sandbox and passed
  all 171 with local listener access. It emitted a non-fatal MaxListeners warning. Request tests
  covered malformed UTF-8, duplicate keys, lossy numbers, nesting, incorrect headers, byte
  counts and denied auth before body consumption. Binding and acknowledgement tests reject
  mismatched accounts, request IDs, revisions and invalid stored output.
- `pnpm --filter @kendo-menu/web exec vitest run --config vitest.config.ts src/lib/account-draft.test.ts src/lib/account-api.test.ts src/test/account-dashboard-editors.integration.test.tsx src/features/account/AccountUnsavedWarning.test.tsx`
  passed 109 cases. These check timeout/abort, failed reload retaining draft, local action
  guards, identity changes, exact retry and focused inputs with injected API responses.
- `pnpm db:check` passed schema metadata validation. Guarded PostgreSQL tests below passed
  17 cases. They verify one winner for concurrent differing intents, single receipt for
  concurrent duplicates, changed intent rejection, proof expiry during an observed lock wait,
  cleanup and atomic rollback after injected SQL/COMMIT failures. The
  [lost COMMIT case](../../apps/api/src/persistence/dashboard-failures.integration.test.ts#L372)
  delegates real COMMIT before simulating a missing response, then checks stored rows and replay.
  The 1,024 boundary suite injects a failure during eviction and verifies rollback. It does not
  separately assert successful capacity eviction at the exact threshold.
- `pnpm test:e2e --workers=2 managed-account.spec.ts account-unblurred-editors.spec.ts --grep 'empty account|whole dashboard|edits made during|uncertain Save|revision conflict|network loss|offline account builder|dashboard load|401 hides|late Save|different verified account|unsaved dashboard edits|unblurred|unfinished quantity|offline download'`
  passed 34 desktop and mobile-emulated Chromium cases with synthetic API/issuer. The
  existing browser uncertainty test returns a synthetic 503 without committing. The extra
  database probe below actually commits through the handler before dropping the response.
- `pnpm test:e2e --workers=2 custom-menu-edit.spec.ts --grep 'account edits|account cancels|unfinished account menu|pending account save'`
  passed 8 more desktop and mobile-emulated Chromium cases. Structural edits preserve quantities
  and notes, cancel leaves the menu untouched, offline interruption preserves the editor, and a
  pending Save cannot replace a newer structural edit.

Guarded database setup and targeted existing cases from `apps/api`:

```sh
node --env-file=.env.test.local --import tsx --input-type=module -e 'import { validateTestDatabaseUrl } from "./src/database/test-database.ts"; validateTestDatabaseUrl(process.env.TEST_DATABASE_URL)'
node --env-file=.env.test.local --import tsx ../../node_modules/vitest/vitest.mjs run \
  --config vitest.integration.config.ts src/persistence/managed-dashboard.integration.test.ts \
  src/persistence/dashboard-failures.integration.test.ts
```

Bounded [synthetic probes](account-dashboard-probes.mjs) from the repository root:

```sh
node --env-file=apps/api/.env.test.local --import ./apps/api/node_modules/tsx/dist/loader.mjs docs/audit/account-dashboard-probes.mjs db
node --import ./apps/api/node_modules/tsx/dist/loader.mjs docs/audit/account-dashboard-probes.mjs browser
```

The database probe uses the harness-owned schema and a fixed clock/fixture, and runs a single
sequence through actual handlers, client and SQL. Revisions advanced 0 → 1 (v10) → 2 (v11)
→ 3 (exact byte cap). After dropping the first HTTP acknowledgement for revision 2, two receipts
already existed and exact replay did not change the row or receipts. The cap plus one byte was
rejected by client serialization and the server, with three receipts still present. The loopback
Node listener also returned `413 REQUEST_TOO_LARGE` for a chunked request at limit plus one
with the same receipt count. Earlier
probe attempts needed to set the Node-only controller's online state explicitly and account
for automatic dismissal of the unavailable editor. Those setup failures are separate from the
successful observations. The browser probe uses fixed ASCII near-limit and small fixtures,
one synthetic connection transition and one switched-account attempt. It stops on assertion
failure, with a ten-second locator timeout. No randomized fuzz or open-ended load probe was run.

Used only the guarded local `kendomenu_test` harness. Node loaded the private test configuration
without its contents being read or displayed. Full integration discovery, browser engines
outside Chromium, preview/PWA, live Google/Neon/Vercel, remote migrations and deployed compression
were outside the scoped run. Guest-copy behavior, sharing behavior, static hosting and the CI
matrix remain with their assigned passes. This pass covered only the ordinary Save seams they
consume.
