# Pass 8 — Cross-interface review and remediation plan

This report preserves the audited baseline and original findings. The [audit index](README.md#post-audit-remediation)
records the subsequent fixes and returning-visitor verification.

Audited 2026-11-13 (Europe/Madrid) on `codex/updated-audit-kendomenu`, HEAD
`e03a00fde682252bb672e53e87f943a47fbcfc58`. The intake tree and index were clean, with no
non-ignored untracked files. Its contents matched `main` at
`f5d68dd9b47a8961acdb8b1e88e6631a9e4024eb`, the [PR #57 merge](https://github.com/JavierMarro/kendo-menu/pull/57).
Compared with `de4f84fcc356edcdd5b58a53bedd5030fb90830d`, 55 paths changed outside the audit
directory. Since the Pass 7 intake, drift was confined to the mounted share integration test,
lint and two handoff documents. Checked branch, HEAD, staged and unstaged paths and untracked
files with the [baseline commands](README.md#baseline). Pass 8 evidence uses Node 24.21.0 and
pnpm 11.22.0 on Darwin x86_64.

## Overall assessment

The checkout implements independent local guest data and verified online account drafts, bounded
explicit Save with revision and receipt checks, one-use copy/decline, and saved-menu sharing with
explicit recipient Add and Save. Current evidence supports the reviewed ownership, replay and
note-projection boundaries. The most consequential remaining issue is the rollback runbook's
v10 assumption. A trailing-slash recipient URL also loses its continuation. Two older wording
discrepancies remain. No P0 or P1 finding remains open in the reviewed scope.

The approved product permits memory-only account drafts and loss of an interrupted copy opportunity.
It excludes guest share/import, automatic upload, durable copy recovery and link revocation UI.
Earlier designs that required these are historical. Git merge and local test results establish the
reviewed implementation. The runbook separately records the owner's October managed-account
production report and two-account HTTPS Preview exercise, plus a dated migration/configuration
read-back. Current deployed commit, provider behavior and sharing rollout still require owner
verification. [Product](../../PRODUCT.md#online-account-journey), [approved transition](../adr/0007-managed-auth-online-account-drafts.md),
[sharing decisions](../CUSTOM_MENU_SHARING_PLAN.md#1-approved-behavior), [release record](../runbooks/DEPLOYMENT.md#managed-account-production-release-status--2026-10-18)

## Cross-interface evidence

| Seam                                                    | Verified behavior and limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guest write and recovery → sign-in → copy               | Guest departure waits for a flush and canonical read-back, fences stale transitions and retains a hidden builder until explicit discard. The copy flow rereads exact guest bytes under coordination at **Yes**, checks the current handoff and verifies identity before dispatch. A later peer write remains on the device. The confirmed request is a snapshot from the Yes action, with no promise to sample again at network dispatch. Browser cases exercised stale-tab retry, edits during sign-in flush, actual guest creation followed by copy, and departure while verification was held. PostgreSQL evidence covers terminal consumption, competing Save, authoritative reload and unchanged guest source. [Guest gate](../../apps/web/src/features/persistence/PersistenceGate.tsx#L205), [guest entry](../../apps/web/src/features/persistence/GuestWorkspaceRoute.tsx#L93), [copy](../../apps/web/src/features/account/AccountSetupPage.tsx#L158), [Pass 4](40-guest-copy.md) |
| Identity change during Save and sharing                 | The controller checks identity before protected operations, freezes the Save, and applies an acknowledgement only to its originating epoch and request. Sender create binds a saved entry and revision, then fences late results. Recipient reads bind account and token, abort on departure and invalidate current identity on 401 or mismatch. Browser regressions exercised foreign-workspace reload, sign-out during Save and recipient denial. Unit evidence exercises late sender and recipient results. A browser abort cannot revoke an already committed transaction. [Save](../../apps/web/src/lib/account-draft.ts#L330), [sender](../../apps/web/src/lib/account-draft.ts#L510), [recipient](../../apps/web/src/features/sharing/SharedMenuPage.tsx#L150), [Pass 2](20-identity.md), [Pass 3](30-account-dashboard.md), [Pass 5](50-sharing.md)                                                                                                                               |
| Share continuation → import → Save, reload and re-share | Browser cases passed existing-account, decline and copy continuations, explicit Add and Save, and retained Shared provenance after reload/edit. Add changes memory only. The composed guarded probe passed actual client → Elysia → PostgreSQL import, v11 Save, independent re-share and source removal/local owner deletion with synthetic identity. A new private recipient note remained out of the re-share. The direct recipient variant gap is KM-08-002. [Atomic import](../../apps/web/src/lib/account-draft.ts#L465), [browser cases](../../apps/web/e2e/menu-sharing.spec.ts#L56), [guarded probe](sharing-probes.mjs#L63)                                                                                                                                                                                                                                                                                                                                                     |
| PWA update and old-client compatibility                 | Current PWA tests cover primed offline v10→v11 migration, clean update, and canceled-reload retry. They simulate activation by changing bytes in the same generated worker. Current API/SQL tests prove that a retained v10 receipt can replay after a v11 Save and a fresh v10 write returns 409 without replacing v11. An old client can still reject a v11 read, and rolling back the full deployment has a separate risk (KM-08-001). An actual two-build browser update or rollback remains unverified. [PWA cases](../../apps/web/e2e/pwa.spec.ts#L97), [SQL version test](../../apps/api/src/persistence/managed-dashboard.integration.test.ts#L228), [Pass 6](60-browser.md)                                                                                                                                                                                                                                                                                                      |
| Hosting, migration and public preview                   | The current build emits the separate share shell. Both packaged tests passed static route/include checks and native Node GET/HEAD with a generic token-free document. The mounted API integration and guarded probe verify PostgreSQL on the actual migration chain. Health opens no database. Vercel rewrite resolution, Preview protection, migration 0004 on the deployed database, and role grants remain distinct owner checks. [Static config](../../vercel.json), [adapter](../../api/%5B...path%5D.ts#L13), [package test](../../apps/api/src/vercel-package.node-test.ts#L94), [Pass 7](70-process.md)                                                                                                                                                                                                                                                                                                                                                                           |

Reconciled the [module map](00-repository-map.md#runtime-and-dependency-direction) with the current
entry points. The core web shell/routes, guest storage and coordination, shared builder, dashboard,
library, domain/store codecs, account and auth, setup/copy, sender/recipient, browser APIs and
worker, API handlers, SQL adapters/schema and packaging/CI each have an owning pass. The dev-only
auth proof has separate coverage. `packages/ui` is reserved. No significant production module in
the agreed core scope was unassigned. Landing and informational content, Mitori, broad visual work,
and native apps remain outside scope.

Independent review traced current source for guest exit, copy timing, Save/recipient identity,
old-client compatibility, and rollback. It corroborated both new findings. The guest exit check
still compares with the strict v10 serializer. An externally seeded v11 guest snapshot with
share provenance could block departure, but ordinary guest actions cannot create that marker
and there is no guest import flow. Keep this as the compatibility limit already recorded in
[Pass 1](10-guest.md), without treating it as another ordinary journey defect.

## Confirmed open findings and ordered fixes

1. **KM-08-001 · P2 · High confidence · Documentation defect with rollback impact.** The
   [rollback procedure](../runbooks/DEPLOYMENT.md#L218) and [smoke checklist](../runbooks/DEPLOYMENT.md#L276)
   call v10 current. The [guest writer](../../packages/store/src/persistence.ts#L2604) now writes
   v11, and the current [account adapter](../../apps/api/src/persistence/postgres/managed-dashboard-adapter.ts#L114)
   accepts v10/v11. At historical revision `8f0a89541bb1692cbf132bddded31aa57d4fc5c3`, the guest
   reader classifies v11 as future, the account client rejects v11 responses, and the server's
   stored-snapshot reader requires v10 even on the existing-row Save path. A rollback chosen
   using only the prescribed v10 fixture could hide already saved guest and account menus.
   Source confirms incompatibility. No live rollback or destructive data loss was observed.
   Current migration and worker tests exercise forward behavior, and current API replay tests
   use the current server. Neither exercises that historical deployment as a rollback target.

   **First, before any rollback decision**, correct the runbook to compare actual writer/reader
   versions for both stores and check only candidate-emitted assets. The current build has no
   standalone `registerSW.js`. Acceptance requires a disposable existing v11 guest profile and
   a v11 account fixture with provenance against the candidate, plus old-tab/new-API and
   candidate frontend/backend compatibility. Preserve stored data and prefer a compatible
   target or forward fix when a candidate cannot read it.

2. **KM-08-002 · P3 · High confidence · Defect.** React Router accepts a trailing slash on
   [the recipient route](../../apps/web/src/app/app-routes.tsx#L72). The [signed-out fallback](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx#L132)
   and [setup return](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx#L482)
   still classify the raw path with exact checks. The [Chromium probe](final-interface-probe.mjs)
   ran four cases. Signed-out canonical → public preview, slash → generic sign-in. New-account
   canonical → same share after decline/Continue, slash → Dashboard. No PUT ran. Normal generated
   links are canonical, and the behavior shares the route-matching root cause of KM-06-001.
   The [existing browser tests](../../apps/web/e2e/menu-sharing.spec.ts#L200) use canonical paths.

   **Next**, match the recipient path with React Router semantics in both branches, validate
   the token and build the existing canonical destination. Acceptance requires the same valid
   token to reach public preview when signed out and resume after copy, decline or skip when
   newly verified, with and without a trailing slash. Retain the malformed-token, identity,
   no-automatic-Add and no-automatic-Save protections.

3. **KM-01-002 · P3 current · High confidence · Documentation/UI wording defect.** The owner
   accepted keeping the explicit Undo. The [reset dialog](../../apps/web/src/features/persistence/PersistenceGate.tsx#L759)
   still promises permanent removal while [Dashboard Undo](../../apps/web/src/features/dashboard/DashboardPage.tsx#L304)
   can restore the one previously removed entry in the same view. The [original reproduction](10-guest.md#km-01-002--reset-leaves-a-pre-reset-undo-that-can-restore-erased-data)
   remains applicable to these branches. Reset clears saved bytes and live entries first. The
   user must click Undo separately to restore anything. Existing reset tests do not hold a prior
   removal. This narrows the original P2 recommendation to the promise the UI makes.

   **Then**, clarify the confirmation text around removal and the existing per-menu Undo. Verify
   reset leaves the dashboard empty on reload without Undo, that a surviving Undo restores only
   the previously removed item, and that unrelated unfinished builder input follows its existing
   lifetime. A reset-wide undo guarantee would be a separate product change.

4. **KM-03-002 · P3 · High confidence · Documentation defect.** The [account handoff](../MANAGED_ACCOUNT_WEB.md#L41)
   lists explicit in-app Reload for ambiguous Save. The [dashboard](../../apps/web/src/features/dashboard/DashboardPage.tsx#L372)
   exposes Reload for conflict/blocked states and **Retry same save** for ambiguity. The workspace
   separately offers draft download when eligible. [Pass 3](30-account-dashboard.md#km-03-002--uncertain-save-has-no-explicit-in-app-reload-action)
   observed the behavior. Replay and conflict tests cover their own states. Update the table to
   distinguish exact retry, eligible download and best-effort browser refresh from conflict's
   warned in-app Reload. Acceptance is a source and test cross-check against both states.

The latter two wording changes can proceed independently. The recipient fix needs no schema or
provider change. The rollback correction is a dependency for selecting a rollback candidate.

## Closed findings and optional work

| Merge                                                       | Findings closed and evidence                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #53](https://github.com/JavierMarro/kendo-menu/pull/53) | KM-01-001/003 stale guest retry and rejected note, KM-02-001/002 callback isolation and sign-out recovery, KM-03-001/003 rejected account note and workspace mismatch. Current preview reran stale retry and mismatched reload. [Index](README.md#pass-status)                                                                               |
| [PR #54](https://github.com/JavierMarro/kendo-menu/pull/54) | KM-04-001/002/003 copy acknowledgement versus refresh, abandoned preflight and v11 guide. Current preview reran held-preflight departure and copy. [Pass 4](40-guest-copy.md)                                                                                                                                                                |
| [PR #55](https://github.com/JavierMarro/kendo-menu/pull/55) | KM-05-001/002/003/004 recipient identity fence, in-place retry, token-free static metadata and release wording. Current preview and package checks reran the relevant seams. [Pass 5](50-sharing.md)                                                                                                                                         |
| [PR #56](https://github.com/JavierMarro/kendo-menu/pull/56) | KM-06-001/002/003 builder route matching, canceled update retry and axe readiness. Preview/PWA regression evidence passed. The original intermittent axe cause remains unconfirmed. KM-08-002 tracks the remaining recipient-specific route mismatch. [Pass 6](60-browser.md)                                                                |
| [PR #57](https://github.com/JavierMarro/kendo-menu/pull/57) | KM-07-001/002/003 mounted share API coverage, lint enforcement and architecture wording, plus KM-03-004 v10/v11 HTTP handoff. Local check and 77 guarded tests passed. The [release gate](https://github.com/JavierMarro/kendo-menu/actions/runs/43035329806) passed on retry after Ubuntu package-mirror DNS blocked Chromium installation. |

**Optional.** KM-07-004 remains a dependency review cadence question. The top-level README and
agent guide can describe merged sharing and both workspace modes while preserving release
qualifications. The two-tab **Later** policy remains a product question. The observed peer-tab
reload still offered native protection. No silent draft loss was demonstrated in that check.
Performance work should start with measured duplicate request costs and keep verification intact.

## Endpoint coverage and measured costs

The [inventory](01-data-flows.md#endpoint-inventory-for-payload-verification) covers all core API
and hosted document endpoints. Numbers below are raw body bytes from local synthetic fixtures.
They exclude framing, headers, provider tokens, live compression and latency.

| Endpoint and trigger                                                  | Measured cost and decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account GET/POST during entry, operation preflight and initialization | Empty bodies. Typical GET 81–88 B, synthetic boundary GET 991 B, creation 155 B representative and 1,065 B boundary. Mapped cold entry used two GETs and one dashboard GET. The accepted email length boundary is a fixture, with live provider behavior unmeasured. [Identity](20-identity.md#synthetic-request-measurements), [copy](40-guest-copy.md#request-cost)                                                                                                                                                                                    |
| Dashboard GET and explicit PUT/retry                                  | GET 217 B empty, 1,475 B representative, 2,097,124 B near limit. PUT 1,518 B v11 representative and 2,097,152 B at limit, 187 B acknowledgement. A maximum-size exact retry adds another 2,097,152 B upload. Extra preflight and connection probes can transfer full data without replacing the draft. Snapshot writes remain coherent for infrequent atomic explicit Saves. [Pass 3 measurements](30-account-dashboard.md#payload-and-request-costs)                                                                                                    |
| Adoption POST and authoritative GET                                   | Yes 593 B representative or 2,097,152 B at limit, 376 B acknowledgement. No 216 B in and 103 B out. The near-limit Yes upload plus refresh is 4,194,200 B. Explicit decisions only. Keep authoritative refresh because the final state can differ after a concurrent Save. [Pass 4 measurements](40-guest-copy.md#request-cost)                                                                                                                                                                                                                          |
| Share create, public GET, recipient GET                               | Create 116/873 B in, 136 B out. Public 456/391,402 B out and recipient 533/391,479 B out. Public and recipient combined 989/782,881 B. Repeated immutable content has a cost at the domain limit, but recipient read rechecks link existence and account binding. Create is already a focused saved-entry request. Add itself sends nothing. [Pass 5 measurements](50-sharing.md#request-cost)                                                                                                                                                           |
| Hosted share document, health and provider                            | The rebuilt static share document is 1,842 B and HEAD returns an empty body. The earlier 2,240 B result predates token metadata removal. Local packaged health measured 15 B for GET and 0 B for HEAD. SDK call counts were measured with an intercepted provider. Live sign-in, sign-out, JWKS traffic and the isolated dev-proof response size were outside production payload measurement. [Build adapter](../../api/%5B...path%5D.ts#L13), [health](../../apps/api/src/app.ts#L64), [identity counts](20-identity.md#synthetic-request-measurements) |

## Owner release gates and verification limits

- Verify the intended deployed revision, Node/pnpm, route/include behavior and protection in
  Vercel. Verify sharing migration `0004` and the API runtime role before relying on share routes.
  Follow the [sharing release check](../runbooks/DEPLOYMENT.md#sharing-release-check) for the
  absent-token response, generic no-referrer/noindex metadata and the two-account live journey.
- For a rollback, use the v11 compatibility acceptance above. A two-build worker rehearsal,
  OS install/share and clipboard behavior, native BFCache and non-Chromium engines remain unverified.
  Browser transport was synthetic. SQL tests used only harness-owned schemas on local `kendomenu_test`.
- Current branch protection settings, vendor dependency support, advisories, deployed compression,
  and production data were outside this pass. A green CI run does not settle these limits.

## Commands and outcomes

Reran only combined browser seams, the disputed recipient variants, current packaged HTML and the
composed sharing/SQL seam. Reused PR #57's full gate and the exact-head Pass 7 integration evidence.
The earlier Chromium install failure belonged to CI setup and the retry passed. No full local
release matrix or live checks were performed in Pass 8.

```sh
pnpm test:e2e:preview --workers=2 guest-coordination.spec.ts guest-builder-lifetimes.spec.ts managed-adoption.spec.ts managed-account.spec.ts menu-sharing.spec.ts --grep 'stale guest tab|verified account transition retains|edits during the Google|a new account confirms|awaiting identity verification|foreign workspace|sign-out fences a late Save|recipient response for|shared preview returns through|signed-out recipient routes'
pnpm test:api:package
VITE_NEON_AUTH_URL=https://synthetic-auth.example.invalid/neon/auth pnpm --filter @kendo-menu/web build
node --import ./apps/api/node_modules/tsx/dist/loader.mjs docs/audit/final-interface-probe.mjs
node --env-file=apps/api/.env.test.local --import ./apps/api/node_modules/tsx/dist/loader.mjs docs/audit/sharing-probes.mjs db
node --input-type=module -e 'import {createApp} from "./apps/api/dist/index.js"; for (const method of ["GET", "HEAD"]) { const response = await createApp().handle(new Request("https://audit.example.test/api/health", { method })); process.stdout.write(JSON.stringify({ method, status: response.status, bodyBytes: (await response.arrayBuffer()).byteLength }) + "\n"); }'
wc -c apps/web/dist/shared-menu.html
```

Preview passed 30 desktop/mobile Chromium cases. Both native package checks passed after a fresh
build. The four-case loopback probe reproduced both variant outcomes using synthetic auth/share
data and blocked outbound requests. Historical compatibility was checked with `git show` on
`bc31fd3^` for `packages/store/src/persistence.ts`, `apps/web/src/lib/account-api.ts` and
`apps/api/src/persistence/postgres/managed-dashboard-adapter.ts`. No historical build was deployed.
