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
| 2    | Managed sign-in, identity and authorization         | Planned |
| 3    | Account dashboard load, edit, save and replay       | Planned |
| 4    | One-time guest copy and decline                     | Planned |
| 5    | Share creation, public preview and recipient import | Planned |
| 6    | Core routes, accessibility and PWA/browser behavior | Planned |
| 7    | Architecture, process, tests, CI and static hosting | Planned |
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

## Exact next-pass prompt

> Run only Pass 2 of the KendoMenu core audit in docs/audit/02-audit-plan.md. Start from
> docs/audit/README.md, check baseline drift against de4f84fcc356edcdd5b58a53bedd5030fb90830d,
> and include relevant tracked and untracked changes. Audit managed sign-in, callback storage
> and token handling, account initialization and mapping, authorization, and identity change
> and sign-out fencing. Run the scoped local checks sequentially with Node 24 and pnpm 11.22.0.
> Use only the guarded local kendomenu_test harness for database tests, and record any
> unavailable checks and what remains unproven. Write docs/audit/20-identity.md with evidence
> and stable finding IDs and update the audit index with the next-pass instruction. Do not
> change app code, tests, dependencies, configuration or migrations; do not begin Pass 3.
