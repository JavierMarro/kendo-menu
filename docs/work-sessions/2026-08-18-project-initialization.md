# Work session: project initialization

- Date: 2026-08-18
- Duration: 23m 51s
- Scope: Initialize the KendoMenu web/mobile monorepo and establish its engineering contract.

## Starting state

The cloned repository was effectively empty apart from a README describing a future kendo training
app and a possible Bun, Elysia, PostgreSQL, React, TanStack, and Expo stack. Node 25.2.1, pnpm
11.22.0, Bun 1.3.14, and npm 11.19.0 were available locally.

## Main changes

- Chose pnpm as the single package manager and created a pnpm workspace with `apps/*` and
  `packages/*`.
- Created the initial workspace layout:
  - `apps/web`: React + Vite SPA shell with dashboard and drill-library views.
  - `apps/mobile`: documented Expo placeholder for a later phase.
  - `packages/domain`: strict training-set types, dashboard-entry types, and the curated defaults
    entry point.
  - `packages/store`: Zustand store factory using an injected persistence adapter.
  - `packages/ui`: reserved boundary for future genuinely shared UI.
- Added strict TypeScript defaults, including `noImplicitAny`, `noUncheckedIndexedAccess`, exact
  optional properties, and `noPropertyAccessFromIndexSignature`.
- Added flat ESLint configuration with type-aware TypeScript rules, React Hooks checks, an explicit
  `no-explicit-any` error, and Prettier integration.
- Added repository hygiene files: `.gitignore`, `.npmrc`, `.editorconfig`, `.prettierignore`, and
  `.prettierrc.json`.
- Updated the README with architecture, commands, package responsibilities, and the pnpm/Bun
  decision.
- Created `AGENTS.md` as the project-wide development contract. It is 94 lines and requires
  TypeScript, zero `any`, ESLint, Prettier, strict persistence boundaries, accessibility, and
  verification before handoff.
- Left the built-in drill list empty intentionally. The owner will add the initial approximately ten
  curated sets in `packages/domain/src/default-training-sets.ts`, with stable ids for each step.

## Decisions

- pnpm is used now instead of `bun init`; mixing package managers would add unnecessary lockfiles
  and resolution rules. Bun remains available if a future Elysia API needs it.
- Zustand `persist` was selected over Dexie for the initial small LocalStorage dataset. The store
  accepts a storage adapter so a future Expo app can inject native storage and a future IndexedDB
  migration remains possible.
- No Elysia API, PostgreSQL database, TanStack Query, or Expo app was initialized because the first
  milestone is local-only. Those dependencies should be introduced when remote sync, accounts, or
  native screens become real requirements.

## Failures and roadblocks

1. The first dependency install could not resolve `registry.npmjs.org` inside the sandbox and
   returned `ENOTFOUND`. The install was retried with approved network access and succeeded.
2. Installing `typescript@latest` selected TypeScript 7.0.2, which was not supported by the chosen
   `typescript-eslint` release. TypeScript was pinned to the supported 6.x line, ultimately resolving
   to 6.0.3.
3. Type-aware ESLint rules initially applied to `eslint.config.mjs`, which caused a missing
   parser-services error. The type-checked configuration was scoped to TypeScript and TSX files.
4. After changing the TypeScript major, pnpm needed to recreate `node_modules`. A non-interactive
   run aborted the purge, and an offline retry lacked cached tarballs. `CI=true pnpm install` with
   approved network access restored the workspace.

All roadblocks were resolved; none are current product blockers.

## Verification

`pnpm check` passed all of the following:

- workspace typechecking for domain, store, and web
- ESLint
- Prettier formatting check
- production Vite build for `apps/web`

## Follow-up context

The next useful session should add the curated training-set data and implement the custom-set
builder plus dashboard editing for per-step repetitions and notes. Keep those concepts in the shared
domain/store contracts so the eventual Expo app can reuse them. Add persistence migrations before
changing the stored JSON shape.
