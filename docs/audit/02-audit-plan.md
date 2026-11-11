# Pass 0 — Audit plan

Read the [index](README.md), [repository map](00-repository-map.md) and the relevant
[flow/endpoint rows](01-data-flows.md). Use the product decisions and observed source at the
recorded baseline. Reuse evidence only when its source, test, runtime and configuration still
apply. In each pass compare the production caller, its boundary validation and its tests before
confirming a finding. Review security, integrity and test quality inside each journey.

## 1. Guest menu state, persistence and recovery → `10-guest.md`

- **Scope and shared interfaces.** [Domain model/catalogue](../../packages/domain), [store and
  migration chain](../../packages/store/src), [guest gate](../../apps/web/src/features/persistence),
  [browser adapter](../../apps/web/src/lib/training-persistence.ts), [coordination](../../apps/web/src/lib/workspace-coordination.ts),
  [recovery boundary](../../apps/web/src/features/errors), and the guest callers in
  [builder](../../apps/web/src/features/custom-sets), [dashboard](../../apps/web/src/features/dashboard)
  and [library](../../apps/web/src/features/library). Store/actions/codec are shared with 3 and 5;
  the read-only guest snapshot/lock is shared with 4; navigation/update integration with 6.
- **Invariants.** Curated immutability and independent dashboard snapshots; retained IDs, notes
  and effective quantities across edit, removal/undo and reload; a rejected mutation changes
  neither stored nor live accepted state. Failed device writes preserve recoverable live data and
  never imply durability. Migrate supported versions in order, reject corrupt/future data, preserve
  raw bytes until an authorized successful operation, and distinguish local backup from restore.
  No guest menu upload. Account behavior, share import and PWA update mechanics are excluded.
- **Evidence.** Read domain tests, store `index`, `ownership`, persistence/sharing compatibility
  and seeded custom-edit tests, web `training-persistence`, `workspace-coordination`,
  `persistence.integration`, `write-recovery.integration`, and relevant browser cases. Trace
  create/add/edit/cancel and quantity/note commit to actual bytes and fresh hydration. Check v10 →
  v11 plus older representative/migration-conflict and unsupported cases; invalid counts, IDs and
  quantities; size just below/at/above the actual limit, including multi-byte names; quota, stale
  tabs, missing/failed Web Locks, read-back failure, reset and recovery/download integrity. Record
  live versus durable observations and where mocks end. Run sequentially:
  `pnpm check:domain`, `pnpm check:store`, `pnpm check:web`, then
  `pnpm --filter @kendo-menu/web exec playwright test --config playwright.config.ts persistence.spec.ts custom-menu-edit.spec.ts guest-coordination.spec.ts guest-recovery-navigation.spec.ts guest-builder-lifetimes.spec.ts`
  (attribute account cases separately or filter them out). Done with per-scenario outcomes or
  bounded unavailability. No DB or remote services needed.

## 2. Managed sign-in, identity and authorization → `20-identity.md`

- **Scope and shared interfaces.** [Dispatcher](../../apps/web/src/auth-dispatcher.ts),
  [callback](../../apps/web/src/features/auth-callback), [SDK wrapper](../../apps/web/src/lib/managed-auth.ts),
  [auth marker](../../apps/web/src/lib/auth-return.ts), sign-in/provider and peer hint wiring,
  [API auth](../../apps/api/src/auth), [account handler](../../apps/api/src/account) and
  [mapping adapter](../../apps/api/src/persistence/postgres/managed-account-adapter.ts).
  Compare proof, origin and account-state contracts at all protected callers in 3–5.
  Inspect guest redirect/pageview gating only where identity or credentials could cross it.
- **Invariants.** Fixed callback paths and verifier-clean replacement; no credentials in
  JavaScript-readable persistence; verified issuer/subject is authority, email only metadata.
  Sign-out, failed sign-out, account switch, stale response and cross-tab hints cannot reveal or
  retarget a draft. Exact origin policy on writes, JWT claims/expiry and mapping isolation.
  No custom sessions or new provider guarantees. Exclude dashboard transaction contents and live
  Google/Neon.
- **Evidence.** Inspect `managed-auth-sdk-storage`, dispatcher/callback/referrer and sign-out-race
  tests; API `account-authorization`, `account`, `managed-identity-http` and
  `managed-account-migrations.integration`. Run `pnpm check:api`, relevant web/auth Playwright
  cases (including separately discovered proof tests), and guarded local integration if available.
  Probe invalid signatures/claims, origin mismatch, cookie-only, concurrent first initialization,
  two subjects with the same email, provider outage and late responses. Complete with authorization
  matrix, synthetic storage/referrer observations, account/SDK request counts and bytes for
  representative and accepted-boundary fields, and review of material identity findings.

## 3. Account dashboard load, edit, save and replay → `30-account-dashboard.md`

- **Scope and shared interfaces.** [Workspace provider](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx),
  [controller](../../apps/web/src/lib/account-draft.ts), [client](../../apps/web/src/lib/account-api.ts),
  shared editor/library/dashboard controls, [HTTP dashboard handler/validation](../../apps/api/src/dashboard),
  [transaction adapter](../../apps/api/src/persistence/postgres/managed-dashboard-adapter.ts)
  and [domain wire codec](../../packages/domain/src/dashboard-persistence.ts). Use the proof from 2,
  store actions from 1, copy-consumption seam from 4, acknowledged share baseline and v11 provenance
  from 5. No guest storage recovery or copy/sharing implementation audit here.
- **3A: ordinary load and explicit edit/save.** Trace empty/existing load, create/edit/curated add,
  focused-field commits, both save buttons, validated reload, catalogue and v10/v11 compatibility,
  invalid/oversized Unicode and mismatched account/version. No hidden persistence or save on edit.
  Use `account-draft`, `account-api`, account editor React tests,
  `managed-account.spec.ts`, `account-unblurred-editors.spec.ts`, and API request/validation tests.
- **3B: uncertainty and consistency.** Probe concurrent revisions, transaction rollback and lost
  response/COMMIT, retained exact replay vs. changed request ID intent, expiry/cleanup and
  v10-on-v11 replay, edits during flight, offline/identity changes, reload and draft download.
  Use `managed-dashboard`, `dashboard-failures.integration`, `managed-dashboard.integration`
  plus browser account cases. Do not require auto-merge, offline durability or unlimited receipts.
- **Evidence.** Run scoped package checks, relevant browser cases, `pnpm db:check` and
  `pnpm test:api:integration` on the guarded target if available. Complete with before/after
  revisions and row/receipt effects or an explicit evidence limit, exact request/ack observations,
  and measured GET/PUT sequences and byte costs including conflicts and retry. Explain whether
  bounded whole snapshots are appropriate given validation, atomicity, replay and complexity.

## 4. One-time guest copy and decline → `40-guest-copy.md`

- **Scope and shared interfaces.** [Setup UI](../../apps/web/src/features/account/AccountSetupPage.tsx),
  [guest snapshot](../../apps/web/src/lib/account-adoption.ts), controller setup methods,
  [HTTP adoption](../../apps/api/src/adoption), [copy persistence](../../apps/api/src/persistence/postgres/managed-copy-adapter.ts),
  and opportunity schema/creation. Consume 1's storage/lock, 2's mapped identity and 3's
  authoritative load/save ordering; share-return interaction belongs to 5.
- **Invariants.** Only winning new-account creation can offer complete, valid, nonempty eligible
  guest data. Yes preserves guest bytes, No is terminal, abandon is not implicit No. One terminal
  opportunity, no overwrite if Save wins, no copy replay or durable recovery. Failed/uncertain
  attempts may lose the opportunity; ordinary access resumes only from verified current data.
- **Evidence.** Read `account-adoption`, `AccountSetupPage`, `managed-adoption.spec.ts`,
  API `managed-adoption` and `managed-copy.integration`; run applicable package/browser checks,
  `pnpm db:check` and guarded PostgreSQL tests. Probe same-count stale source, corruption and
  near-limit size, duplicate Yes/No, race with ordinary Save, failure between transactions and
  dropped acknowledgement plus refresh. Complete with guest raw equality, terminal DB state,
  account reload result, Yes/No body and refresh bytes/calls, or a stated local evidence limit.

## 5. Share creation, preview and recipient import → `50-sharing.md`

- **Scope and shared interfaces.** [Web sharing](../../apps/web/src/features/sharing),
  [return marker](../../apps/web/src/lib/share-return.ts), dashboard filters/tags and account
  controller, [share DTO](../../packages/domain/src/menu-sharing.ts), [HTTP shares](../../apps/api/src/shares),
  [share adapter](../../apps/api/src/persistence/postgres/managed-shares-adapter.ts),
  [migration 0004](../../apps/api/drizzle/0004_solid_zaladane.sql), [hosted HTML](../../apps/web/shared-menu.html)
  and its rewrite/adapter. Bind to 2's auth, 3's saved revision/v11 and 4's setup; 6 checks
  runtime cache and keyboard/browser integration; 7 checks packaging/release declarations.
- **5A: sender/public lifetime.** Saved custom-only and exact owner/revision. Verify no notes,
  descriptions or IDs, effective quantities including zero/both duration units, digest reuse and
  isolation across owners, changed payload/new link, concurrent create, lost reply/stale revision,
  invalid token/method, no revision change, source removal and local-account cascade. Probe HTML
  metadata/noindex/referrer behavior with fake links; resolve the plan's Open Graph discrepancy.
- **5B: recipient/continuation.** Public access by token only. Sign-in returns through setup
  without automatic import or loss of existing draft; fence late loads, account changes and exit.
  Add creates an independent editable copy once per intended action; own links do not mark Shared.
  Verify provenance through edit/save/reload/re-share, aggregate size, failed add, and survival
  after source changes/deletion. No guest import, quota/expiry or full provider-deletion workflow.
- **Evidence.** Inspect and run the relevant `menu-sharing`, `sharing-compatibility`,
  `sharing-v11-compatibility`, `ShareMenuButton`, `SharedMenuPage`, `share-return`,
  `shares`, `managed-shares.integration`, `menu-sharing.spec.ts`, and packaged API tests,
  using scoped package checks, guarded DB and metadata checks where applicable. Complete with
  sender/public/recipient traces, positive and negative DB evidence, no-store observations and
  measured create/read/recipient payloads for typical and near-limit valid data; show both
  preview→recipient requests and whether their duplication carries a correctness benefit.
  Keep live HTTPS, real Google, OS sharing and production migration status separate.

## 6. Core routes, accessibility and browser/PWA → `60-browser.md`

- **Scope and shared interfaces.** [Routes and shell](../../apps/web/src/app), shared dashboard,
  builder, library, setup, and sharing controls, [workspace shell](../../apps/web/src/components/WorkspaceShell.tsx),
  [dialogs](../../apps/web/src/components/DialogShell.tsx), recovery, install and update UI,
  [Vite/PWA](../../apps/web/vite.config.ts), [route metadata](../../apps/web/src/lib/route-metadata.ts)
  and relevant client integrations. Use state/ownership results of 1–5.
- **Invariants.** Entry/deep links/back preserve the correct workspace. Keyboard/focus, labels,
  status, errors, loading/empty states and mobile controls work on core paths. Guest shell can
  reload offline once primed; account/auth/share data or verifier URLs must not be cached.
  Confirm dirty-state behavior through reload/update; navigation protection is best effort where
  the platform limits it. Landing, side pages, Mitori, broad visual audit and native apps excluded.
- **Evidence.** Read `accessibility`, `ui-journey`, `navigation-scroll`, `error-recovery`,
  `install-notices`, and `pwa.spec.ts` plus the Playwright modes. Run scoped desktop/mobile
  browser checks (include keyboard/axe and real navigation), production-preview cases as relevant,
  then `pnpm test:e2e:pwa` separately. Complete with route/state matrix, cache inspection and
  explicit browser limitations for Web Locks, offline, clipboard, share sheet and install.

## 7. Architecture, process, CI, dependency and static configuration → `70-process.md`

- **Scope and shared interfaces.** All in-scope interfaces from 1–6; [CI and Dependabot](../../.github),
  [root scripts](../../package.json), package scripts and test configs, [workspace/lockfile](../../pnpm-workspace.yaml),
  [TypeScript](../../tsconfig.base.json), [lint](../../eslint.config.mjs), [AGENTS](../../AGENTS.md),
  [.codex guidance](../../.codex/README.md), [Drizzle history/harness](../../apps/api/drizzle),
  [static Vercel wiring](../../vercel.json), packaged API tests and documentation queue.
- **Invariants.** Ownership and dependency direction stay explicit. Recommend deletion/reuse or
  interface changes only for evidenced costs (e.g. repeated limits causing drift, callers needing
  internal state, tests forced to mock a real transaction). Check actual frozen installs, runtime
  pins, script propagation, test discovery/skips, DB guard and PostgreSQL service, preview vs. dev
  vs. PWA, generated/API packaging, and advisory vs. enforced controls. Do not infer required
  branch checks, deployed behavior or configured hooks from tracked files alone.
- **Evidence.** Reconcile test discovery (`--list` where useful) and CI/script matrix with local
  check outcomes; inspect whether assertions use observable behavior. Review dependency resolution
  and update coverage; label any advisory lookups that are unavailable or outside authorized
  verification. Use `pnpm check`, `pnpm verify:full`, and guarded integration evidence only as
  needed and sequentially. Compare current Markdown and source, date historical docs, suggest the
  smallest corrections. Complete with concrete dependency/ownership paths, reproducible gate
  evidence or limits, and separate repository declarations versus owner/live release evidence.
  No external configuration or application changes.

## 8. Cross-pass interface review and remediation → `99-remediation-plan.md`

Trace boundary combinations that local reviews can miss: guest write/recovery → sign-in/copy →
load; focus or account change during Save/share → receipt/draft fencing; recipient import →
v11 save/replay/edit/re-share; app update → old-client/version compatibility; hosting → migration →
public preview. Check all significant production modules assigned in the map and all endpoint
measurements; rerun only stale or disputed bounded evidence. Reconcile findings against approved
decisions, deduplicate by root cause and obtain independent review of material security/integrity
conclusions. Complete with prioritized confirmed findings, known transition/release gates, ordered
remediation and acceptance tests, optional changes, and external/unreviewed areas. No implementation,
deployment or security/release verdict inferred solely from green tests.

## Evidence protocol

- For each pass, update the index with baseline drift, inspected source and tests, exact commands
  and outcomes (pass/fail/inherited/not run), scenarios exercised, exclusions, open questions and
  the exact next prompt. Verify links, formatting and whitespace after writing. Keep synthetic
  reproductions small and under this directory if needed. Preserve all owner work.
- A finding uses a stable pass-scoped ID (e.g. `KM-01-001`), P0–P3 severity and separate confidence,
  classification, precise path/line, trigger and violated invariant, practical impact, reproducible
  evidence, missed test and smallest fix with an acceptance check. Separate confirmed defects,
  test/process gaps, known gates, optional improvements and hypotheses. Give independent reviewers
  the actual source/evidence for material security or data integrity and resolve disagreements.
- Use Node 24/pnpm 11.22.0. Only the guarded local `kendomenu_test` harness can run DB tests; no
  reading private config. Use sanitized presence/failure evidence. Mark what unit/mock, real
  browser, real local PostgreSQL, static hosting, and owner live evidence each actually proves.
  For a bounded adversarial probe record target, seed, case cap, invariant and stopping condition.
- Measure request/response JSON UTF-8 bytes at the real serializers or local HTTP seam, with typical
  and near-limit valid synthetic data and bounded edge cases. Include error/ack envelopes, exact
  triggers/counts per journey and repeated bytes on retry, plus HTML where relevant. Use no
  credentials in logs. Distinguish measured body bytes from estimated overhead, unverified
  compression and provider/host behavior. Compare focused updates only if justified by observed
  cost and their effect on atomicity, revision checks, idempotency and recovery.
