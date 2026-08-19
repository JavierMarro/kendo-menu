# KendoMenu Agent Guide

## Product

KendoMenu is a local-first kendo training planner. The first milestone is a web SPA where a
practitioner can browse curated drills, add them to a dashboard, adjust repetitions, attach notes,
and create custom training sets. Free-tier data is persisted in browser storage. A future mobile
app will reuse the domain and state contracts; a server, accounts, sync, and paid tiers are later
decisions, not current requirements.

## Repository shape

- `apps/web`: React + Vite browser application and feature composition.
- `apps/mobile`: reserved Expo application; do not initialize it until shared contracts are stable.
- `packages/domain`: platform-neutral training-set types and hard-coded curated defaults.
- `packages/store`: platform-neutral Zustand store factory with an injected storage adapter.
- `packages/ui`: reserved for genuinely shared tokens/components; keep it empty until needed.
- `docs`: architecture and product notes when a decision needs more context than code comments.
- `tools/skills`: project-local Codex skills; read the index and applicable `SKILL.md` before heavy
  coding, fuzzing, verification, or review.

Before substantial implementation, read [`tools/skills/README.md`](tools/skills/README.md). The
project skills are Codex-native adaptations of the supplied workflows; do not assume Claude slash
commands such as `/antirez` or `/code-review`, or shell variables such as `$BUILD`, exist. Use the
named skill workflow and the repository's actual commands instead.

When instructions conflict, use this order: the current user request; this guide and `PRODUCT.md`;
established architecture and deliberate project conventions; applicable skills; generic best
practices. Skills do not authorize dependency, public-contract, visual-direction, or package-manager
changes. Translate generic commands to pnpm, and require repository evidence before adopting stack
assumptions such as Tailwind, shadcn/ui, or routing. Impeccable's categorical visual rules are
advisory when they conflict with KendoMenu's product brief or established interface. Codebase-design
vocabulary applies during architecture analysis and does not replace ordinary React component or
project-boundary terminology. The TypeScript-only rule applies to product and package source, not
vetted or vendored skill tooling.

Use pnpm for every workspace operation. Keep one `pnpm-lock.yaml`. Do not add a second lockfile or
mix Bun/npm/Yarn commands into the repository. Bun is available for a possible future Elysia API,
but this LocalStorage-only milestone has no API package, database, or Elysia runtime.

## Non-negotiable code standards

- TypeScript everywhere; do not add JavaScript source files.
- No `any` at all: never write explicit `any`, introduce an implicit one, or weaken a type to make
  the compiler quiet. Model unknown data with `unknown`, validation, generics, or discriminated
  unions.
- Keep `strict` TypeScript enabled. Preserve `noUncheckedIndexedAccess`, exact optional properties,
  and the other strictness flags in `tsconfig.base.json`.
- Run ESLint and Prettier. Do not suppress a rule inline unless the smallest possible suppression is
  justified in a nearby comment. Never disable type safety for convenience.
- Prefer small pure functions, immutable updates, stable identifiers, and explicit return types on
  exported functions. Use `import type` for type-only imports.
- Do not use `console.log` in product code. If diagnostic logging is necessary, explain why and
  remove or gate it before shipping.

## Domain and persistence

- Put training concepts in `packages/domain`, not inside React components.
- Add curated sets to `packages/domain/src/default-training-sets.ts`. Give every set and step a
  stable id; dashboard rep overrides are keyed by step id.
- Keep built-in data immutable and mark it `isBuiltIn: true`. User-created data must be represented
  by the same domain model with `isBuiltIn: false`.
- Use Zustand `persist` for the current small LocalStorage data set. The store must receive a
  storage adapter so the browser can use `localStorage` and Expo can later inject AsyncStorage or
  another native adapter.
- Do not put secrets, credentials, or assumptions about server sync in LocalStorage.
- Treat persisted JSON as untrusted and version/migrate the state when its shape changes.
- Prefer a storage adapter or IndexedDB/Dexie only when data volume, querying, or history actually
  requires it; do not introduce Dexie for the initial dashboard.

## UI and architecture

- Keep feature code under `apps/web/src/features/<feature>`. Keep reusable layout primitives under
  `components`; keep browser integrations under `lib`.
- Keep domain logic out of JSX. Components should render state and dispatch typed actions.
- Preserve keyboard access, visible focus, semantic headings, labels, and useful empty/loading/error
  states. Do not rely on color alone.
- Maintain the calm, focused kendo practice experience: clear hierarchy, restrained motion, and
  mobile-friendly layouts.
- Do not add TanStack Query while data is entirely local. Add it when remote fetching/sync exists;
  add routing when screens need URL-addressable navigation rather than pre-emptively increasing
  the dependency surface.
- The web and mobile apps may share domain, state, validation, and design tokens, but do not force
  DOM and React Native components into one abstraction.

## Commands and verification

Run from the repository root:

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm format:check
pnpm session:check
pnpm test
pnpm build
pnpm check
```

Before handing off a change, run the narrowest relevant checks, then `pnpm check` for cross-package
changes. Add or update tests for behavior and persistence migrations; do not treat a successful
build as proof that user flows work. Never commit `node_modules`, build output, local environment
files, or secrets.

## Change workflow

1. Inspect nearby code and existing scripts before editing.
2. Keep changes scoped to the request; preserve unrelated user work.
3. Implement the smallest coherent slice with types and accessible UI states.
4. Verify typecheck, lint, formatting, build, and tests as applicable.
5. Record every working session with `pnpm session:new -- --slug <slug> --duration "<duration>"`,
   then fill the generated entry in `docs/work-sessions/`. Keep each dated entry to at most eight
   physical lines and run `pnpm session:check`. Use the project-local
   `tools/skills/work-session-history/SKILL.md` workflow when available.
6. Report what changed, what was verified, and any remaining deliberate follow-up.
