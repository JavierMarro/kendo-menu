# KendoMenu core audit

Pass 0 (mapping and planning) completed on 2026-11-10 (Europe/Madrid). This audit covers creating,
adding, editing, saving, reloading, sharing and importing menus in the guest and signed-in journeys.
Include library selection, identity, guest copy, recovery and browser behavior where they affect
those journeys. Exclude landing, informational pages, Mitori room and their content or visual
polish; inspect a shared route or shell only where it affects core state, access or navigation.

- [Repository map and documentation status](00-repository-map.md)
- [User journeys and endpoint inventory](01-data-flows.md)
- [Pass boundaries, evidence and completion criteria](02-audit-plan.md)
- [Pass 1: Guest menus and local persistence](10-guest.md)
- [Pass 2: Managed sign-in, identity and authorization](20-identity.md)
- [Pass 3: Account dashboard load, edit, save and replay](30-account-dashboard.md)
- [Pass 4: One-time guest copy and decline](40-guest-copy.md)
- [Pass 5: Saved-menu sharing and recipient import](50-sharing.md)
- [Pass 6: Core routes, accessibility and browser/PWA behavior](60-browser.md)
- [Pass 7: Architecture, process, CI, dependencies and static hosting](70-process.md)

## Baseline

| Item                    | Observation                                                                   |
| ----------------------- | ----------------------------------------------------------------------------- |
| Branch                  | `codex/updated-audit-kendomenu`                                               |
| HEAD                    | `de4f84fcc356edcdd5b58a53bedd5030fb90830d`                                    |
| HEAD subject            | Merge pull request #52 from JavierMarro/codex/sharing-feat-fixes              |
| Initial working tree    | Clean: no staged, unstaged, or non-ignored untracked paths                    |
| Earlier audit artifacts | No `docs/audit/` on disk, tracked, or in the local refs' history for the path |
| Runtime                 | Darwin x86_64; Git 2.56.0; shell default Node 25.2.1; pnpm 11.22.0            |
| Target runtime checked  | Node 24.21.0 and pnpm 11.22.0; CI pins Node 24.12.0                           |
| Local prerequisites     | Workspace `node_modules` present; DB configuration and browsers not exercised |

Baseline commands: `git status --short --branch --untracked-files=all`, `git rev-parse HEAD`,
`git diff --name-status`, `git diff --cached --name-status`, `git ls-files --others --exclude-standard`,
`git ls-files -- 'docs/audit/**'`, `git log -6 --all --oneline -- docs/audit`,
`node --version`, `pnpm --version`, `git --version`, and `uname -sm`. On this host, select the declared
runtime before invoking pnpm:

```sh
export PATH="/Users/javiermartinez-romera/.nvm/versions/node/v24.21.0/bin:$PATH"
node --version
pnpm --version
```

Before reusing evidence, record the current branch/HEAD, staged and unstaged status, and these
path-only comparisons against the pinned baseline. Compare all source and test changes in the pass
and any interface they call. Include non-ignored untracked implementation files in that scope.
Exclude private configuration/credential files from content reads. If the audit baseline moves,
record the new commit and affected paths, recheck affected evidence, and keep prior results dated.

```sh
git status --short --branch --untracked-files=all
git diff --name-status de4f84fcc356edcdd5b58a53bedd5030fb90830d -- . ':(exclude)docs/audit'
git diff --cached --name-status de4f84fcc356edcdd5b58a53bedd5030fb90830d -- . ':(exclude)docs/audit'
git ls-files --others --exclude-standard -- . ':(exclude)docs/audit' ':(exclude,glob)**/.env*'
```

HEAD identifies the initially clean tracked content. For later dirty baselines, record sanitized
fingerprints of reviewed non-private files if needed to distinguish successive versions at the same
path. A change under `docs/audit/` alone does not invalidate application evidence.

## Pass status

| Pass | Scope                                               | Status  |
| ---- | --------------------------------------------------- | ------- |
| 0    | Baseline, current flows, documentation and test map | Done    |
| 1    | Guest menu state, LocalStorage and recovery         | Done    |
| 2    | Managed sign-in, identity and authorization         | Done    |
| 3    | Account dashboard load, edit, save and replay       | Done    |
| 4    | One-time guest copy and decline                     | Done    |
| 5    | Share creation, public preview and recipient import | Done    |
| 6    | Core routes, accessibility and PWA/browser behavior | Done    |
| 7    | Architecture, process, tests, CI and static hosting | Done    |
| 8    | Interface review and consolidated remediation       | Planned |

Pass 0 inspected the source entry points, workspace owners, shared state and validation,
server routes and storage adapters, relevant docs and test discovery wiring linked in the three
reports. It traced source-level paths; no functional scenarios, application suites, DB tests,
payload measurements, live services, or dependency advisories were run or queried. Historical
check counts are reference evidence, not current results. No private files were read. The only
working-tree additions from this pass are these four reports. See the repository map for the
unverified sharing rollout and the difference between October production read-back and
owner-reported journeys.

Pass 0 verification: `pnpm exec prettier --check docs/audit/*.md` passed under the selected
Node 24 runtime. A local path, heading and source-line link check and a whitespace scan of the
new reports passed. `git diff --check`, `git diff --cached --check`, and the pinned baseline
comparisons above found no tracked or non-ignored untracked changes outside the reports.

Pass 1 found no baseline drift outside the audit folder. It examined the guest route and gate,
menu builder/dashboard/library, domain/store codecs and actions, migration fixtures, browser
storage/coordination, and backup/reset. Domain (89), store (83), web (393) and scoped desktop/mobile
Chromium (56) tests passed. The isolated [reproduction](guest-probes.mjs) verified Unicode/size
boundaries and independently reviewed findings: retry can replace a peer tab's confirmed dashboard
(KM-01-001, P1), reset leaves a working pre-reset Undo (KM-01-002, P2), and a rejected near-limit
note can be reported saved (KM-01-003, P2). All three were reproduced in Chromium; none was fixed.
See the [Pass 1 report](10-guest.md) for commands, sandbox-only failures, tested scenarios and limits.
Browser behavior without Web Locks was verified through injected faults, not native cross-engine
concurrency. No account, sharing, PWA, DB or live behavior was established in this pass.

Between Passes 1 and 2, `7f9f153` addressed KM-01-001 and KM-01-003. The Pass 1 report
describes the original pinned baseline. KM-01-002 was deferred.

Pass 2 audited clean HEAD `7f9f1530e7d03109ae979b3ea17bc4fe15027480` against the pinned
baseline. It traced the auth dispatcher and pinned SDK, identity and sign-out fences, the
account API and mapping, and the proof used by protected routes. Scoped checks passed on
Node 24.21.0 and pnpm 11.22.0: 171 API, 81 web unit, 54 browser, and 14 guarded local
PostgreSQL cases. Two P2 findings were reproduced with synthetic transport: a verifier
on an ordinary route can escape callback isolation (KM-02-001), and failed sign-out loses
its recovery action after SPA navigation (KM-02-002). The [Pass 2 report](20-identity.md)
records commands, request measurements, exclusions, and live-provider limits.

Pass 3 checked the pinned baseline against HEAD `7f9f153` and the unstaged Pass 2 fixes,
including the untracked account recovery button. It traced both Save controls, memory draft
ownership, API authorization and validation, and PostgreSQL revision and receipt effects.
The [report](30-account-dashboard.md) records the inspected paths, exact checks, local
v10/v11 read-back and replay, and byte measurements at the 2,097,152-byte PUT limit. Chromium
reproduced two P2 defects: a Save can confirm an earlier note when the shown replacement was
rejected (KM-03-001), and an identity change between the account check and dashboard read can
leave the prior draft visible and exportable (KM-03-003). Two P3 documentation discrepancies
cover ambiguous-Save Reload (KM-03-002) and the v10/v11 endpoint contract (KM-03-004).
Domain (89), store (83), API (171), scoped web (109), Chromium (42), and guarded PostgreSQL (17)
tests passed. Live provider timing and deployment behavior remain unverified. Guest-copy and
share behavior were outside this pass.

Between Passes 3 and 4, `f64eee1` committed the Pass 2 fixes, KM-03-001 and KM-03-003, and the
requested Share it! and Mitori tweaks on the audit branch. [PR #53](https://github.com/JavierMarro/kendo-menu/pull/53)
merged the application and test changes, including the earlier Pass 1 fixes, to `main` at
`6101a17967c9d433c043ea4b5147504746f1cea9` after passing CI. Audit artifacts remain in this workspace.

Pass 4 compared `f64eee1` and its working tree against the pinned baseline, including changes to
the account provider, API client and guest persistence. It inspected setup UI, the guest snapshot
reader, account controller, API authorization and validation, copy SQL and migration tests. Scoped
web (111), API (19), guarded PostgreSQL (39), and desktop/mobile Chromium (22) cases passed, plus
migration metadata and the local probes. The [report](40-guest-copy.md) records Yes/No and refresh
bytes, preserved guest data, terminal states and Save races. Independent review confirmed two P2
defects. A failed refresh can misreport a confirmed copy (KM-04-001), and a pending decision can
dispatch after departure (KM-04-002). The transport guide still names v10 (KM-04-003, P3). The
browser transport was synthetic. Native BFCache scheduling and live identity and deployment
behavior remain unverified. Share continuation/import and general PWA behavior were excluded.

After Pass 4, `4c64375` fixed KM-04-001 and KM-04-002 and corrected the v11 transport guide
(KM-04-003). Local verification passed under Node 24.21.0 and pnpm 11.22.0, including `pnpm check:web`
(400 tests) and `pnpm test:e2e --workers=2 managed-adoption.spec.ts` (26 cases).
[PR #54](https://github.com/JavierMarro/kendo-menu/pull/54) passed the release gate and merged
to `main` at `ca8688a58671feccb167f08a4aee8fc3cd584d45`. The Pass 4 report records the earlier baseline.

Pass 5 compared `4c64375` and its working tree against the pinned baseline. It traced the sharing
UI, account draft and callback/setup seams, DTO and v11 provenance, API, PostgreSQL and static
share metadata. Domain (6), store (3), web (103), API (6), package (2), guarded PostgreSQL (8),
and preview Chromium (14) checks passed, along with migration metadata and supplemental probes.
The probes verified reuse, local owner cascade, independent recipient copies and payload costs.
The [report](50-sharing.md) records a recipient identity-fencing defect (KM-05-001, P2), misleading
transient failure UI (KM-05-002, P3), and two documentation discrepancies (KM-05-003 and
KM-05-004, P3). Local browser transport was synthetic. Production migration/runtime permissions,
deployed rewrites, live Google, preview caching and native platform sharing remain unverified.
General browser and PWA behavior were excluded.

After Pass 5, the working-tree fixes route denied recipient reads through account verification
(KM-05-001), retry transient share reads in place (KM-05-002), omit `og:url` from the initial
share document while retaining its generic social card (KM-05-003), and update the plan and
release handoff (KM-05-004). On Node 24.21.0 and pnpm 11.22.0, `pnpm check:web`, `pnpm check:api`,
`pnpm test:api:package` and `pnpm test:e2e:preview --workers=2 menu-sharing.spec.ts` passed.
A focused 63-test rerun passed after adding coverage for a late denial from a previous account.
The Pass 5 report and probe document the pre-fix baseline.

Pass 6 compared clean HEAD `cf2d14dc0c3e7be2ad722f88d00b32e49386e0c0` with the pinned baseline.
It included the committed Pass 5 fixes and found no untracked implementation at intake. The
[report](60-browser.md) traces route and workspace ownership, keyboard/focus and mobile behavior,
clipboard and Web Share, cache boundaries, installation and worker activation. Chromium reproduced
unsaved builder loss on accepted trailing-slash routes (KM-06-001, P2) and an unresponsive Update
action after canceling the first reload (KM-06-002, P3). The first scoped preview run had 72 passes,
three expected platform skips and one desktop axe failure (KM-06-003, P3). Four isolated repetitions
and four additional account accessibility/responsive cases passed. All 61 scoped unit tests and
seven separate production PWA tests passed. The [local probes](browser-probes.mjs) inspected real
CacheStorage and used synthetic account and share data. Native install and share, other browser
engines and hosted behavior remain unverified. Peer-tab **Later** semantics remain a product
question. Landing, side pages, Mitori content, database and hosting/process work were excluded.

The Pass 6 fixes use React Router matching for builder departure and guest-to-account entry
(KM-06-001), allow a reload retry after worker activation and native cancellation (KM-06-002),
and wait for the routed library heading before the first axe scan (KM-06-003). Independent review
found no blocking issues. The standalone probe preserves pre-fix evidence. Regression coverage is in
[builder navigation](../../apps/web/e2e/custom-menu-edit.spec.ts),
[verified entry](../../apps/web/e2e/managed-account.spec.ts),
[PWA lifecycle](../../apps/web/e2e/pwa.spec.ts), and
[library accessibility](../../apps/web/e2e/accessibility.spec.ts).

Remediation verification used Node 24.21.0 and pnpm 11.22.0. `pnpm check:web` passed (402 tests),
along with scoped `pnpm test:e2e` (36) and `pnpm test:e2e:preview` (87 with three platform skips).
The separate `pnpm test:e2e:pwa` suite passed all eight cases, including canceling the native
reload warning, retaining the draft and retrying the reload. Three additional desktop and mobile
preview repetitions of the library axe cases passed (18). The earlier contrast failure's cause
remains unconfirmed. Native device and hosted behavior remain unverified.

Pass 7 compared clean HEAD `78b0459a50698abb3f40b0f9f16423208219ab0a` with the pinned baseline.
Its contents matched cached `origin/main` at `c6d50d6`, the PR #56 merge. There were 51 changed
paths outside `docs/audit/` and no non-ignored untracked paths at intake. The [report](70-process.md)
maps core package and state ownership, CI and discovery, guarded SQL, lint policy, dependency
resolution and packaged Vercel wiring. `pnpm check` passed 745 package and two packaged API cases.
Migration metadata, 76 guarded PostgreSQL cases, the composed sharing probe, 20 scoped cases in
each of development and preview, and eight production PWA cases passed. The missing-URL guard
returned exit 1. An isolated offline frozen install stopped on absent registry metadata after
accepting lockfile consistency. Earlier exact-head CI completed the online install and full gate.

The confirmed gaps concern mounted share API coverage (KM-07-001, P2), lint enforcement
(KM-07-002, P3), and architecture documentation (KM-07-003, P3). Tracked application dependency
monitoring is an optional improvement (KM-07-004, P3). No live infrastructure or advisory
lookup was used. Current hosting settings, production sharing migration/runtime role and live
journeys remain owner verification. No application fixes were made.

After Pass 7, the guarded integration suite gained a `createApp` test for share creation, public
preview and authenticated recipient reads (KM-07-001). It checks exact note-free responses,
no-store headers and denial before body parsing. TypeScript lint now rejects non-null assertions
and console diagnostics (KM-07-002). The architecture guide describes guest v11, the two size
units, all four API services and both per-tab markers (KM-07-003). The managed dashboard handoff
also records v10/v11 reads and the 409 response for a new v10 write over v11 (KM-03-004).

Independent review passed. On Node 24.21.0 and pnpm 11.22.0, `pnpm check` passed 745 package and
two packaged cases, `pnpm db:check` passed, and the [guarded harness](70-process.md#local-verification-record)
passed 77 tests. The stdin lint probe returned exit 1 with both intended errors. The changes affect
tests, lint and documentation. The Pass 7 browser evidence still applies. KM-07-004 remains optional.

## Exact next-pass prompt

> Run only Pass 8 of the KendoMenu core audit in docs/audit/02-audit-plan.md. Start from
> docs/audit/README.md, check baseline drift against de4f84fcc356edcdd5b58a53bedd5030fb90830d,
> and include relevant tracked and untracked changes. Recheck interfaces across Passes 1–7,
> including guest write/recovery into sign-in and copy, account identity during Save and sharing,
> recipient import into v11 Save and re-share, app updates across client versions, and hosting,
> migration and public preview. Verify coverage of all significant core modules and endpoint
> measurements. Reconcile findings against approved decisions, deduplicate by root cause, and
> distinguish fixed findings, confirmed open findings, transition/release gates, optional changes,
> and unresolved or externally unverified areas. Obtain independent review for material security or
> data-integrity conclusions. Rerun only stale or disputed checks sequentially with Node 24 and
> pnpm 11.22.0. Use only the guarded local kendomenu_test harness for database checks. Write
> docs/audit/99-remediation-plan.md with evidence limits, priorities, ordered fixes, dependencies and
> acceptance tests. Update the audit index with final coverage and limits. Do not implement fixes,
> change app code, tests, dependencies, configuration or migrations, or access live infrastructure.
