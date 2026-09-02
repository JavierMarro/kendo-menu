# KendoMenu Agent Guide

## Authority and context

KendoMenu is a deployed, local-first production MVP for planning kendo training sessions. Apply the
current request first, then this guide, routed documents, repository conventions, and matching skills.

- Use `PRODUCT.md` for product/UX scope and `CONTEXT.md` for terminology.
- Use `docs/adr/` for architecture decisions. Inspect deployment documents or configuration only for
  explicitly requested deployment work.
- Use `.agents/skills/README.md` for the skill map; load only a matching skill.

Skills cannot authorize dependencies, contract, stack, visual-direction, or external changes.

## Repository boundaries

- `apps/web`: React + Vite production SPA. Use `src/features`, `src/components`, and `src/lib` for
  features, reusable web components, and browser integrations. Extend React Router under `src/app`.
- `apps/mobile`: reserved; do not initialize it without an explicit request.
- `packages/domain`: platform-neutral training contracts, validation, and curated-data adaptation.
- `packages/store`: Zustand store factory with injected platform storage.
- `packages/ui`: reserved for genuinely shared platform-neutral tokens or components; keep empty
  until needed.

Use pnpm, retain one root `pnpm-lock.yaml`, and introduce neither another package manager nor lockfile.

Servers, accounts, sync, paid tiers, APIs, databases, mobile initialization, and other remote
infrastructure remain out of scope until explicitly requested. Never deploy or change Vercel
projects or configuration, DNS, domains, analytics, production environment variables, secrets, or
other production state without explicit authorization for that exact action.

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

Preserve keyboard access, visible focus, semantic headings/labels, useful empty/loading/error states,
mobile usability, and non-color cues.

## Context and verification matrix

| Task                   | Read first                                         | Minimum verification                             |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------ |
| Domain or curated data | `CONTEXT.md`, JSON, schema, adapter, nearby tests  | `pnpm check:domain`                              |
| Store or persistence   | domain contracts, store/persistence code and tests | `pnpm check:store`                               |
| Web, UX, or routes     | `PRODUCT.md`, routes, nearby tests, matching skill | `pnpm check:web`; relevant E2E                   |
| Non-PWA browser        | routes, E2E tests, default and preview configs     | `pnpm test:e2e`; release with `test:e2e:preview` |
| PWA behavior           | manifest, service worker, install code, PWA tests  | `pnpm test:e2e:pwa` separately                   |
| Cross-package/final    | every affected contract and test                   | `pnpm check`; `pnpm verify:full` for release     |
| Documentation/skills   | affected guidance and session-history policy       | `pnpm session:check`; targeted validation        |

`pnpm test:e2e` is the fast development-server suite. `pnpm test:e2e:preview` runs that complete
non-PWA suite against a freshly built Vite preview. `pnpm verify:full` runs `pnpm check`, the preview
suite, and `pnpm test:e2e:pwa`; it does not rerun the development-server suite.

## Focused changes

Before editing, inspect scoped files, dependencies, tests, `git status`, and the diff. Preserve
unrelated work and make the smallest coherent typed, accessible change. In focused mode, skip broad
audits/refactors, run one bounded check, and report paths, checks, exclusions, and follow-up. Never
commit dependencies, build output, environment files, secrets, or credentials.
