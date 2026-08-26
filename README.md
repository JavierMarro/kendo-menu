# KendoMenu

KendoMenu is a local-first kendo training planner. It will provide a small curated library of
training sets, let practitioners add and adapt drills for a session, and support custom sets. The
first tier stores data in the browser; a server-backed tier can be added later without changing the
domain model.

## Current stack

- pnpm workspaces for one lockfile and shared packages
- React + Vite + TypeScript for `apps/web`
- Zustand `persist` with an injected storage adapter for local data
- Shared typed domain contracts in `packages/domain`
- Shared state factory in `packages/store`
- Expo is reserved for `apps/mobile` once the web domain and interaction model are stable

pnpm is the package manager. Bun is not required for the current SPA. If an API is added later,
Elysia can be introduced in an isolated `apps/api` package with its own runtime decision; there is
no reason to carry a database or server into the LocalStorage-only first milestone.

## Workspace layout

```text
apps/
  web/       React/Vite SPA
  mobile/    Expo placeholder
packages/
  domain/    Training-set types and curated defaults
  store/     Zustand store factory with an injected persistence adapter
  ui/        Reserved shared UI boundary
```

## Commands

```bash
pnpm install
pnpm dev
pnpm test
pnpm check
pnpm format
```

Curated drill content is authored in `packages/domain/data/default-drills.json`, with
`packages/domain/schema/kendo-drills.schema.json` as its validation contract, and normalized by
`packages/domain/src/default-training-sets.ts` into `DEFAULT_TRAINING_SETS`, the runtime interface
used by store and web modules. Every activity needs a stable id because dashboard quantity
overrides are keyed first by activity id and then by unit. The custom-set builder has a reserved
feature boundary at `apps/web/src/features/custom-sets`.

See [AGENTS.md](./AGENTS.md) for the working contract used by people and coding agents.

Development history is recorded in [`docs/work-sessions`](./docs/work-sessions/), with one concise
entry per working session.

Project-local Codex workflows are indexed in [`tools/skills`](./tools/skills/). Read the applicable
`SKILL.md` before heavy implementation, fuzz testing, verification, or semantic review.
