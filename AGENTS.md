# KendoMenu Agent Guide

## Product and repository

KendoMenu is a local-first kendo training planner. The web milestone lets practitioners browse
curated drills, build dashboards and custom training sets, adjust repetitions, and attach notes;
free-tier data stays in browser storage. Mobile may later reuse domain and state contracts; do not
add server, accounts, sync, paid tiers, or initialize `apps/mobile` until shared contracts are stable.

- `apps/web`: React + Vite application and feature composition.
- `apps/mobile`: reserved Expo application.
- `packages/domain`: platform-neutral training types and curated defaults.
- `packages/store`: Zustand store factory with injected storage.
- `packages/ui`: reserved for genuinely shared tokens/components; keep empty until needed.
- `docs`: durable product or architecture notes only when code comments are insufficient.
- `tools/skills`: project-local workflows; read `tools/skills/README.md` and applicable `SKILL.md`
  before substantial coding, testing, verification, or review.

Follow this precedence: current user request; this guide and `PRODUCT.md`; established repository
conventions; applicable skills; generic best practices. Skills cannot authorize dependency,
public-contract, visual-direction, or package-manager changes. Do not assume Tailwind, shadcn/ui,
routing, or other stack choices without repository evidence. Use pnpm for all workspace operations,
keep one `pnpm-lock.yaml`, and do not mix Bun/npm/Yarn commands into the repository.

## Models and delegation

- With Sol access: Sol (`max`) plans and orchestrates but does not implement; Luna (`max`) implements;
  Sol reviews with `xhigh` and sends required fixes back to Luna for a second review.
- With Luna only: Luna (`max`) plans, implements, reviews, validates, and delivers.
- Do the work directly when delegation overhead exceeds the cost of a small fix.

## Non-negotiable code standards

- TypeScript everywhere; do not add JavaScript source files.
- No `as any`, silence-casts, non-null `!`, or barrel re-exports of foreign modules.
- Keep `strict` TypeScript enabled. Preserve `noUncheckedIndexedAccess`, exact optional properties,
  and the other strictness flags in `tsconfig.base.json`.
- Run ESLint and Prettier. Do not suppress a rule inline unless the smallest possible suppression is
  justified in a nearby comment. Never disable type safety for convenience.
- Prefer small pure functions, immutable updates, stable identifiers, typed exported APIs, and
  `import type` for type-only imports.
- Do not use `console.log` in product code. If diagnostic logging is necessary, explain why and
  remove or gate it before shipping.

## Domain and persistence

- Keep training concepts in `packages/domain`, not React components. Put curated sets in
  `packages/domain/src/default-training-sets.ts`; every set and step needs a stable id.
- Built-ins are immutable and use `isBuiltIn: true`; user-created data uses the same model with
  `isBuiltIn: false`. Dashboard repetition overrides are keyed by step id.
- Use Zustand `persist` for this small LocalStorage dataset, with an injected storage adapter so
  Expo can later provide AsyncStorage or another adapter.
- Treat persisted JSON as untrusted: version and migrate shape changes. Do not store secrets,
  credentials, or server-sync assumptions. Use IndexedDB/Dexie only when scale or querying requires it.

## UI and architecture

- Put feature code under `apps/web/src/features/<feature>`, reusable layout primitives under
  `components`, and browser integrations under `lib`.
- Keep domain logic out of JSX. Components should render state and dispatch typed actions.
- Preserve keyboard access, visible focus, semantic headings, labels, and useful empty/loading/error
  states. Do not rely on color alone.
- Maintain a calm, focused, mobile-friendly experience with clear hierarchy and restrained motion.
- Do not add TanStack Query while data is local; add it with remote fetching/sync. Add routing only
  when screens need URL-addressable navigation. Share domain, state, validation, and tokens across
  web/mobile only when platform-neutral; do not force DOM and React Native UI together.

## Commands and verification

Use the narrowest relevant checks first; run `pnpm check` for meaningful cross-package changes or
before delivery. Available root commands include `pnpm dev`, `pnpm typecheck`, `pnpm lint`,
`pnpm format:check`, `pnpm test`, `pnpm build`, and `pnpm check`. Add or update tests for behavior
and persistence migrations; a successful build does not prove user flows work.

## Change workflow

1. Inspect nearby code, existing scripts, current `git diff`, and relevant tests before editing.
2. Keep the change within the request and preserve unrelated user work.
3. Implement the smallest coherent, typed, accessible slice.
4. Verify proportionally and report changes, checks, deliberate exclusions, and follow-up.
5. Treat current code, tests, git diff, and runtime behavior as the source of truth. Document only
   durable architectural decisions or unresolved blockers.

## Focused-change mode

For small, localized requests:

- Inspect only the named files and direct dependencies.
- Make one focused implementation pass.
- Run one bounded, relevant verification.
- Skip broad audits, redesigns, and unrelated refactors unless requested.
- Keep commentary and final output concise.
- Preserve unrelated user changes.

Never commit `node_modules`, build output, local environment files, secrets, or credentials.
