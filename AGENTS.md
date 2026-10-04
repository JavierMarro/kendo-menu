# KendoMenu Agent Guide

## Authority and context

KendoMenu is a personal kendo-training planner with a deployed, local-first guest MVP. Apply the
current request first, then this guide, task-relevant documents, conventions, and matching skills.
Prefer the smallest complete implementation of the approved journey; security and data integrity
are required, but optional recovery guarantees are product choices, not automatic scope additions.

- Use `PRODUCT.md` for product/UX scope and `CONTEXT.md` for terminology.
- Use [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for current production boundaries and
  data-flow/dependency direction.
- For the managed-auth transition, use [docs/MANAGED_AUTH_TRANSITION.md](docs/MANAGED_AUTH_TRANSITION.md)
  for the owner's approved replacement and sequential jobs. Distinguish implemented legacy behavior
  from the target; do not revive superseded offline-account or adoption-recovery requirements.
- Use `docs/adr/` for architecture decisions. Inspect deployment documents or configuration only for
  explicitly requested deployment work.
- For explicitly requested deployment work, route to
  [docs/runbooks/DEPLOYMENT.md](docs/runbooks/DEPLOYMENT.md) and preserve its observed-versus-owner-
  reported distinction.
- Use `.agents/skills/README.md` for the skill map; load only a matching skill.

Skills cannot authorize dependencies, contract, stack, visual-direction, or external changes.

## Repository boundaries

- `apps/web`: React + Vite production SPA. Use `src/features`, `src/components`, and `src/lib` for
  features, reusable web components, and browser integrations. Extend React Router under `src/app`.
- `apps/api`: Node 24 + Elysia application, PostgreSQL adapters using Drizzle/pg, and explicit
  migration/test commands. Domain validation remains in `packages/domain`; HTTP and SQL stay here.
- `apps/mobile`: reserved; do not initialize it without an explicit request.
- `packages/domain`: platform-neutral training contracts, validation, and curated-data adaptation.
- `packages/store`: Zustand store factory with injected platform storage.
- `packages/ui`: reserved for genuinely shared platform-neutral tokens or components; keep empty
  until needed.

Use Node 24 for application verification and pnpm as declared in `package.json`; retain one root
`pnpm-lock.yaml`. Report a different runtime instead of claiming target-runtime verification.

Approved replacement: Neon-managed Google-only authentication; offline guest Zustand/LocalStorage;
online-only account drafts in memory with explicit saves; one new-account guest-copy opportunity
that never changes the guest source. No creating-session restriction, durable pending copy, or
interrupted-copy recovery. Managed browser session cookies are expected; never put credentials in
JavaScript-readable persistence. Do not self-host another auth system or add the Neon Data API.

Backend/account work is limited to the assigned transition job; paid tiers, mobile initialization,
and unrelated infrastructure remain out of scope. Never deploy, migrate a remote database, or change
Vercel projects/configuration, DNS, domains, analytics, secrets, or remote environment variables
without authorization for that exact action. Do not stage, commit, push, merge, or switch branches
unless explicitly asked; preserve staged and unstaged owner work.

## Private configuration and credentials

- Do not inspect or display private `.env`/`.env.*` contents, credential files, or raw environment
  dumps for context. Exclude them from searches and collected logs. Read `.env.example` only as a
  placeholder template; never put actual credentials in it.
- Applications and approved test commands may load private configuration for an authorized target
  without exposing its values. Do not extract credentials into command arguments, chat, logs,
  fixtures, or generated artifacts; sanitize connection errors before reporting them.
- Check configuration presence and sanitized success/failure, not secret values. Let the owner fill
  private files; request missing configuration rather than passwords. Any necessary secret inspection
  requires explicit, scoped owner authorization. `.gitignore` prevents Git tracking, not file access.

## Code and data invariants

- Use TypeScript source. Preserve strict mode and every `tsconfig.base.json` safeguard, including
  `noUncheckedIndexedAccess` and exact optional properties.
- Do not use `as any`, error-silencing casts, non-null assertions, or barrel re-exports of foreign
  modules. Use `import type` for type-only imports.
- ESLint and Prettier must pass. Justify the smallest inline suppression nearby; do not ship
  `console.log` diagnostics.
- Keep domain logic out of JSX; use immutable updates, typed exports, and stable IDs.
- Author curated content only in `packages/domain/data/default-drills.json`, validate it against
  `packages/domain/schema/kendo-drills.schema.json`, and adapt it in
  `packages/domain/src/default-training-sets.ts`.
- Runtime sessions contain recursive `TrainingActivity` values with activity IDs; exercises are
  leaves. Built-ins are immutable with `isBuiltIn: true`; custom sessions use `isBuiltIn: false`.
- Key dashboard quantity overrides by activity ID then unit, and activity notes by activity ID. Use
  Zustand `persist` with injected storage for the browser-local dataset.
- Treat persisted JSON as untrusted: bound and validate it, version and migrate changes, preserve
  atomic failure and read/write symmetry, and store no secrets or sync assumptions.
- Authorize account requests from server-verified identity, never a browser ID or email. Use managed
  auth and established verification libraries; acknowledge database saves only after commit. Keep
  guest data and account drafts isolated, and exclude credentials and identity payloads from logs.

Preserve keyboard access, visible focus, semantic headings/labels, useful empty/loading/error states,
mobile usability, and non-color cues.

## Context and verification matrix

| Task                   | Read first                                         | Minimum verification                             |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------ |
| Domain or curated data | `CONTEXT.md`, JSON, schema, adapter, nearby tests  | `pnpm check:domain`                              |
| Store or persistence   | domain contracts, store/persistence code and tests | `pnpm check:store`                               |
| Web, UX, or routes     | `PRODUCT.md`, routes, nearby tests, matching skill | `pnpm check:web`; relevant E2E                   |
| API or authorization   | affected API contracts/callers; API feature skill  | `pnpm check:api`; relevant HTTP/auth tests       |
| PostgreSQL or schema   | adapter, schema, migration metadata, DB harness    | `pnpm test:api:integration`; `pnpm db:check`     |
| Non-PWA browser        | routes, E2E tests, default and preview configs     | `pnpm test:e2e`; release with `test:e2e:preview` |
| PWA behavior           | manifest, service worker, install code, PWA tests  | `pnpm test:e2e:pwa` separately                   |
| Cross-package/final    | every affected contract and test                   | `pnpm check`; `pnpm verify:full` for release     |
| Documentation/skills   | affected guidance and session-history policy       | `pnpm session:check`; targeted validation        |

`pnpm test:e2e` is the fast development-server suite. `pnpm test:e2e:preview` runs that complete
non-PWA suite against a freshly built Vite preview. `pnpm verify:full` runs `pnpm check`, the preview
suite, and `pnpm test:e2e:pwa`; it does not rerun the development-server suite.

Real database tests use only the guarded local `TEST_DATABASE_URL` for `kendomenu_test`, with
harness-owned schemas. Missing configuration is an explicit limitation, not a silent pass. Never
substitute Neon or a development database. Unit tests and local listeners do not prove live Google,
Neon, HTTPS-browser, or Vercel behavior. Run no database work for documentation-only changes.

## Efficient, bounded work

- Load only matching skills and the current contracts/callers/tests needed for the task. Consult
  historical handoffs only for a relevant unresolved decision or reusable failure.
- Reuse checks that still cover the exact diff/configuration. Parallelize read-only discovery, but
  run CPU-heavy unit/build/browser suites sequentially to avoid contention and misleading timeouts.
- Review approved invariants and concrete security/data-integrity defects. Separate optional
  hardening from blockers; do not silently add new product guarantees during a correction pass.
- Re-run affected checks after a fix. Report inherited failures separately; isolated reruns do not
  erase required full-suite failures. Scoped completion is not whole-branch release readiness.
- Use hooks for small, deterministic advisory checks, not automatic migrations, full test suites,
  secret-bearing context injection, or semantic approval. A silent hook is not a security verdict.

## Delegation and review

For substantial implementation, delegate to a default implementation subagent when that capability
is available and improves speed, quality, or token efficiency. Handle small focused changes directly
when delegation overhead exceeds their risk.

Use an independent reviewer for material, high-risk, cross-package, persistence, security, or release
changes when reviewer capability is available. The reviewer must inspect the actual changes and
report concrete findings; address substantive findings before declaring the task finished.

## Focused changes

Before editing, inspect scoped files, dependencies, tests, `git status`, and the diff. Preserve
unrelated work and make the smallest coherent typed, accessible change. In focused mode, skip broad
audits/refactors, run one bounded check, and report paths, checks, exclusions, and follow-up. Never
commit `node_modules`, build output, private environment files, secrets, or credentials. Reviewed
manifests, the single lockfile, and generated migration files may belong to an explicitly scoped job.
