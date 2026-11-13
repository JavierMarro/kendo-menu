# Pass 7 — Architecture, process, CI, dependencies and static hosting

The findings below preserve the pre-fix evidence. The [audit index](README.md) records remediation
and verification.

Audited 2026-11-11 (Europe/Madrid) on `codex/updated-audit-kendomenu`, HEAD
`78b0459a50698abb3f40b0f9f16423208219ab0a`. The intake tree and index were clean and there were
no non-ignored untracked paths. The locally cached `origin/main` at
`c6d50d64c5e9d1225734eedd14a3d15031aa3b03` had identical file contents. Compared the checkout
with `de4f84fcc356edcdd5b58a53bedd5030fb90830d` using the [baseline commands](README.md#baseline).
The 51 changed paths outside `docs/audit/` include the guest/account recovery, share delivery
and recipient, and browser guard changes. Reviewed those core interfaces and their tests. The
release workflow, dependency policy and lockfile, root scripts, TS/ESLint rules, static rewrite
configuration and Drizzle history match the pinned baseline. Local runtime was Node 24.21.0,
pnpm 11.22.0 on Darwin x86_64. CI pins Node 24.12.0 on Ubuntu.

## Ownership and dependency direction

| Boundary               | Observed implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain and store       | [Domain exports](../../packages/domain/package.json) own curated inputs, training validation, [dashboard v10/v11 codecs](../../packages/domain/src/dashboard-persistence.ts) and the [note-free share DTO](../../packages/domain/src/menu-sharing.ts). The [Zustand factory](../../packages/store/src/index.ts) imports domain and receives a storage adapter. [Store persistence](../../packages/store/src/persistence.ts#L39) owns ordered migration and the local string-size check. Its current wire validation delegates to domain. The store has no browser or server package dependency.                                                                                                                                                                                                                                  |
| Browser workspaces     | [Guest route and persistence gate](../../apps/web/src/features/persistence/GuestWorkspaceRoute.tsx) own LocalStorage and recovery. The [account route](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx) owns the lifecycle of the [memory draft controller](../../apps/web/src/lib/account-draft.ts). The [auth provider](../../apps/web/src/features/account/ManagedAuthProvider.tsx) fences identity; the [callback dispatcher](../../apps/web/src/auth-dispatcher.ts) runs before ordinary app bootstrap. Shared UI uses the [workspace interface](../../apps/web/src/lib/workspace-context.ts). Guest copy reads the independent guest source through [its web adapter](../../apps/web/src/lib/account-adoption.ts). The service worker owns the static shell, with data persistence outside that boundary. |
| HTTP and PostgreSQL    | The [browser API client](../../apps/web/src/lib/account-api.ts) validates envelopes and account/receipt bindings using the domain codecs. The [Elysia route table](../../apps/api/src/app.ts#L49) dispatches raw writes to four services. [Authorization](../../apps/api/src/auth/account-authorization.ts) supplies verified proofs. [Runtime composition](../../apps/api/src/runtime.ts#L20) injects PostgreSQL ports through a lazy provider. The [adapters](../../apps/api/src/persistence/postgres/adapter.ts#L101) own transactions, locks and committed outcomes. Migrations run through an explicit command or the test harness.                                                                                                                                                                                         |
| Entry points and build | The [web manifest](../../apps/web/package.json) depends on store/domain, the [API manifest](../../apps/api/package.json) depends on domain, and the [root adapter](../../api/%5B...path%5D.ts#L8) depends on the API export. The [API build config](../../apps/web/vite.api.config.ts#L17) is build-time use of the web toolchain. The API runtime imports neither React nor Zustand. The [UI directory](../../packages/ui/README.md) remains reserved.                                                                                                                                                                                                                                                                                                                                                                          |

The reviewed manifests, exports and core production imports agree with this direction. Account
memory, guest LocalStorage, receipt replay, one-use copy and saved share snapshots have distinct
owners consistent with the [approved transition](../MANAGED_AUTH_TRANSITION.md#migration-c--separate-routes-and-online-account-editing).
The web and API copies of the 2,097,152-byte limit and revision bound agree today. Both sides
need boundary validation. Their separate tests consume local definitions, so a change on one
side can drift. The Pass 3 composed probe checked agreement for the byte boundary. Keep the
guest string-size ceiling independent. [Web bounds](../../apps/web/src/lib/account-api.ts#L18),
[API bounds](../../apps/api/src/dashboard/contracts.ts#L62), [measured cases](30-account-dashboard.md).

## Gates, test realism and supply chain

| Check or control                    | Evidence and coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow and failure propagation    | [CI](../../.github/workflows/ci.yml#L3) runs on pull requests and pushes to `main`, with per-ref cancellation of superseded runs, read-only contents access and a 45-minute job cap. The [steps](../../.github/workflows/ci.yml#L37) reject listed private file paths, select Node, enable Corepack, install frozen, check Drizzle metadata, run guarded PostgreSQL, install Chromium and run `verify:full`. Commands propagate failures. The path scan checks filenames. It cannot detect secrets pasted into otherwise ordinary files. Current branch protection, merge-queue settings and check requirements are outside tracked configuration.                                                                                                                                                                              |
| Repository checks                   | [`check`](../../package.json#L33) runs strict TS, ESLint, Prettier, the four package suites, API/web builds and the native Node package tests. [`verify:full`](../../package.json#L34) then runs preview and PWA. It leaves migration metadata and real DB integration to the separate CI steps. Local `check` passed 89 domain, 83 store, 171 API, 402 web and two packaged cases. API tests emitted one `beforeExit` listener warning and the web build warned about chunk size. Both stages exited successfully.                                                                                                                                                                                                                                                                                                             |
| Database and migrations             | [Guarded command](../../apps/api/src/database/integration-command.ts#L9) validates the local named target before spawning Vitest and propagates child failure. The [harness](../../apps/api/src/database/test-database.ts#L116) verifies the database again and applies the real migration chain in an owned random schema. The normal API suite [excludes integration files](../../apps/api/vitest.config.ts), and the [DB configuration](../../apps/api/vitest.integration.config.ts) discovers them and serializes files. `db:check` passed. The real harness passed 76 cases across six files. With the URL absent, the command returned the fixed guard error and exit 1 before Vitest. This validates local test containment and applied test SQL. It leaves hosted migration state and runtime role grants unverified.   |
| Browser discovery and release modes | [Development](../../apps/web/playwright.config.ts) and [preview](../../apps/web/playwright.preview.config.ts) listed the same 418 cases in 26 files, with desktop and mobile-emulated Chromium. Preview builds with [two test HTML inputs](../../apps/web/vite.preview.config.ts#L7). [PWA](../../apps/web/playwright.pwa.config.ts#L22) uses the generated production build and lists eight desktop cases. The [loopback auth-proof config](../../apps/web/playwright.managed-auth.config.ts) lists 32 cases in three files, eight unique to the proof page. Those eight are deliberately outside the standard release suite. The three platform-conditional install skips are explicit. CI allows two retries and retains failure artifacts on job failure, so an eventually passing run can contain a first-attempt failure. |
| Test realism                        | [Browser](../../apps/web/e2e/synthetic-managed-harness.ts#L99) cases exercise rendered flows with synthetic transport. [Recipient retry](../../apps/web/e2e/menu-sharing.spec.ts#L277) asserts an exact request count and preserved draft text. [SQL failure coverage](../../apps/api/src/persistence/dashboard-failures.integration.test.ts#L410) verifies committed state and unchanged rows/receipts on replay. [Share SQL cases](../../apps/api/src/persistence/managed-shares.integration.test.ts#L184) exercise authorization proofs, concurrent reuse and transaction outcomes. HTTP unit cases check denial and bounded bodies. A mounted share API seam still falls outside the normal gate (KM-07-001).                                                                                                               |
| Runtime and dependencies            | The [root pin](../../package.json#L6), single [lockfile](../../pnpm-lock.yaml#L1) and [build-script/age policy](../../pnpm-workspace.yaml) are tracked. API runtime and the Neon SDK are explicitly pinned in their manifests. Installed Elysia declares the explicit API peer packages, so their absence from direct application imports is expected. The clean offline install recognized the lockfile as current, then stopped on missing registry mirror metadata during pnpm's policy check. Fresh offline materialization was unavailable. [Dependabot](../../.github/dependabot.yml#L2) covers Actions monthly. Application dependencies have no tracked scheduled update/advisory check.                                                                                                                                |

The [agent rules](../../.codex/rules/repository-validation.rules) grant scoped command permission.
The [hook guide](../../.codex/README.md) describes advisory, owner-local hooks. Neither establishes
an enforced release check. TS has strict, indexed-access and exact optional safeguards. ESLint
enforces explicit `any` and type imports. A subset of the stated conventions relies on review
(KM-07-002). The current pass did not inspect private or global hook configuration.

## Package and hosting boundary

[Vercel configuration](../../vercel.json#L3) declares `pnpm build`, `apps/web/dist`, includes the
shared HTML in the function, routes `/api` and matching public share paths to the function before
the SPA fallback. The [Vite API build](../../apps/web/vite.api.config.ts#L17) emits
`apps/api/dist/index.js`, bundles domain data and leaves declared server dependencies external.
The [API export](../../apps/api/package.json#L6) uses emitted JS by default and source for types and
development. [Native package tests](../../apps/api/src/vercel-package.node-test.ts#L18) assert the
static rewrite list and included file and then run Node against a temporary assembled package with
no TypeScript loader, no credential environment, a trap for pool construction and outbound fetch
disabled. Health, protected denial, proof-route absence and the share document's private/no-store,
generic token-free HTML and HEAD response all passed. The local test copies the emitted HTML and
links installed dependencies itself. Vercel's actual router, file tracing, deployed runtime and
header propagation still require owner verification. [Deployment contract](../runbooks/DEPLOYMENT.md#repository-declared-settings)

Previous work observed [PR #56's release job](https://github.com/JavierMarro/kendo-menu/actions/runs/43000701960)
pass the CI install and full release checks for this head before merge. That is dated release
evidence, with no new external lookup for this pass. The runbook separately records owner-reported
two-account Google Preview behavior and production release on 2026-10-18, plus a dated migration
and provider configuration read-back. Current production journeys and sharing migration 0004,
runtime role, routing and metadata rollout remain owner-run release checks. A healthy endpoint
does not inspect the schema. [Owner reports and read-back](../runbooks/DEPLOYMENT.md#managed-account-production-release-status--2026-10-18),
[sharing release checklist](../runbooks/DEPLOYMENT.md#sharing-release-check)

## Findings

### KM-07-001 · P2 · High confidence · Test gap

The release gate could pass with a missing mounted share API route. The three paths are registered
in [app.ts](../../apps/api/src/app.ts#L81). The [composition tests](../../apps/api/src/app.test.ts#L18)
never request them. [Handler tests](../../apps/api/src/shares/shares.test.ts#L66) invoke
`shares.handle` with fake ports, the [DB suite](../../apps/api/src/persistence/managed-shares.integration.test.ts#L184)
invokes the adapter directly, and the [browser tests](../../apps/web/e2e/menu-sharing.spec.ts#L42)
intercept share requests. The [package test](../../apps/api/src/vercel-package.node-test.ts#L109)
exercises the separate document endpoint. A missing mount or wrong parser mode could break
sharing while those checks still pass. The guarded [Pass 5 probe](sharing-probes.mjs#L63) does
compose the real router, handlers, browser client and SQL. Its DB mode passed on this checkout.
It is outside ordinary test discovery and workflow commands.

Add one small guarded integration case in the existing DB suite for a saved custom entry,
share create, anonymous public read and verified recipient read through `createApp`. Assert
expected status and note-free shape, `private, no-store`, denial for an unauthenticated recipient,
and a raw create body reaching the handler after authorization. Removing any of the three mounts
or breaking the create parser should fail the release gate. Retain the focused failure and browser
cases for the cases they already cover.

### KM-07-002 · P3 · High confidence · Process gap

[AGENTS.md](../../AGENTS.md#L69) bans non-null assertions and shipping `console.log` diagnostics.
The [lint configuration](../../eslint.config.mjs#L21) has no non-null-assertion rule and assigns
`no-console` a warning. [`pnpm lint`](../../package.json#L15) accepts warnings. A stdin-only
probe with both constructs in an ordinary web TypeScript file returned exit 0 with just one
console warning. The synthetic snippet was never executed or written to the source tree. The
gate can miss a future unchecked null assumption or diagnostic. This pass found no current
production instance in the scoped source scan.

Enable the targeted non-null-assertion rule and make the production diagnostic restriction
blocking, retaining deliberate diagnostics with the existing narrow justification convention.
Verify the same probe fails lint and ordinary application lint stays green.

### KM-07-003 · P3 · High confidence · Documentation defect

The guide points to `ARCHITECTURE.md` as current. It calls v10 the current guest format and
describes only three API services. The store writes v11 and runtime composes four services.
It also describes the callback marker without distinguishing the separate expiring share token
marker. This can direct maintenance work to the wrong format or omit the share port. The
existing build and tests verify implementation behavior. They do not reconcile the prose.
Correct the version and local code-unit limit, include the API/domain dependency and share
service, and name the two per-tab markers. Verify the paragraph against the exports and the
registered routes. Preserve older transition notes as dated evidence.
[Architecture version](../ARCHITECTURE.md#L116), [API composition](../ARCHITECTURE.md#L222),
[marker wording](../ARCHITECTURE.md#L281), [serializer](../../packages/store/src/persistence.ts#L2724),
[service registration](../../apps/api/src/app.ts#L75), [share marker](../../apps/web/src/lib/share-return.ts#L1)

The [documentation queue](00-repository-map.md#documentation-reconciliation-queue) still includes
the v10-only dashboard table (KM-03-004), even though its extension accurately describes v11.
The sharing plan and token-free hosted metadata were corrected in Pass 5. The
[agent opening](../../AGENTS.md#L5), [README practitioner list](../../README.md#L51) and
[web handoff](../MANAGED_ACCOUNT_WEB.md#L174) can be refreshed to describe both modes and merged
sharing, keeping the owner verification boundary. Historical test counts and old transition
failures describe their named revisions.

### KM-07-004 · P3 · High confidence · Optional improvement

The tracked [Dependabot config](../../.github/dependabot.yml#L2) intentionally enables Actions
updates alone and documents a pnpm compatibility constraint. The [workflow](../../.github/workflows/ci.yml#L65)
uses frozen installation and its package policy but has no scheduled application dependency
review. This leaves registry advisory/update coverage outside the repository-declared gate.
Current vendor support, private alerts and owner monitoring remain unverified. No dependency
vulnerability is established here. Keep the pinned runtime and document an owner cadence or
verify a pnpm 11-compatible updater before enabling it. Acceptance is a repeatable review of
the resolved app graph without changing the lockfile on read-only runs.

Independent source review corroborated the sharing route gap, lint behavior and package test
limits. It did not identify a present security failure from those gaps.

## Local verification record

Commands ran sequentially with the [target runtime](README.md#baseline). The guarded URL was
loaded privately. The first `node --env-file=.env.test.local --run test:integration` attempt from
`apps/api` reached the fixed URL guard and exited 1. A direct env-file validator accepted the
target. Running the normal pnpm command as a child of the env-file process passed. A sandboxed
missing-URL check stopped on tsx IPC `EPERM`; the host rerun reached the guard and returned 1 as
expected. No private file contents were read or printed.

```sh
pnpm db:check
node --env-file=apps/api/.env.test.local --input-type=module -e 'import {spawnSync} from "node:child_process"; process.exitCode = spawnSync("pnpm", ["test:api:integration"], {stdio:"inherit"}).status ?? 1;'
pnpm check
printf '%s\n' 'export function diagnostic(value?: string) { console.log(value!.length); }' | pnpm exec eslint --stdin --stdin-filename apps/web/src/lib/account-api.ts
env -u TEST_DATABASE_URL pnpm test:api:integration
CI=1 pnpm --dir "$audit_install_dir" install --offline --frozen-lockfile --ignore-scripts
pnpm test:e2e --list
pnpm test:e2e:preview --list
pnpm test:e2e:pwa --list
pnpm --filter @kendo-menu/web test:e2e:managed-auth --list
node --env-file=apps/api/.env.test.local --import ./apps/api/node_modules/tsx/dist/loader.mjs docs/audit/sharing-probes.mjs db
pnpm test:e2e --workers=2 accessibility.spec.ts custom-menu-edit.spec.ts managed-account.spec.ts menu-sharing.spec.ts --grep 'library dialog closed or open|trailing-slash URL|matching account route|shared preview returns through|recipient read preserves'
pnpm test:e2e:preview --workers=2 accessibility.spec.ts custom-menu-edit.spec.ts managed-account.spec.ts menu-sharing.spec.ts --grep 'library dialog closed or open|trailing-slash URL|matching account route|shared preview returns through|recipient read preserves'
pnpm test:e2e:pwa
```

The scoped development and preview runs each passed the same 20 cases. They exercised trailing-slash
draft departure, verified entry, library dialog axe scans, share return through existing account,
copy and decline, and recipient retry with an unrelated draft. All eight production PWA cases
passed separately. The guarded share probe passed creation, anonymous preview, recipient reads,
denial, re-share and copy independence through the real mounted routes. It used synthetic identity
and a local harness-owned schema.

The isolated install directory contained the tracked workspace manifests and lockfile. Its
offline attempt exited 1 with `ERR_PNPM_NO_OFFLINE_META` for `@hookform/resolvers`. Scripts were
disabled for this probe. No registry advisory or current vendor support lookup was performed.
The earlier exact-head CI result covers a clean online install with lifecycle policy enabled.
The full local `verify:full` was not repeated. This pass ran `check`, scoped browser comparisons
and the separate production PWA suite. Landing, side pages, Mitori, physical devices, other
browser engines, and live infrastructure were outside this pass.
