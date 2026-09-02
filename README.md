# KendoMenu

KendoMenu is a deployed, local-first production MVP for planning kendo training sessions.
Practitioners can browse 11 curated built-in sessions, add sessions to a dashboard, adapt activity
quantities, attach notes, and create custom sessions. Product data remains in browser storage; no
account or server is required.

## Current stack

- pnpm workspaces with one root lockfile
- React, React Router, Vite, and TypeScript in `apps/web`
- Zustand `persist` with an injected storage adapter in `packages/store`
- Shared recursive training contracts and curated-data validation in `packages/domain`
- An uninitialized `apps/mobile` boundary reserved for explicitly requested future work

Server APIs, accounts, remote sync, paid tiers, databases, and other remote infrastructure are not
part of the current product scope.

## Workspace layout

```text
apps/
  web/       React/Vite production SPA
  mobile/    Reserved Expo boundary
packages/
  domain/    Training contracts, validation, and curated-data adapter
  store/     Zustand store factory with injected persistence
  ui/        Reserved shared UI boundary
```

## Development

pnpm is the repository package manager. Common root commands are:

```bash
pnpm install
pnpm dev
pnpm test:domain
pnpm test:store
pnpm test:web
pnpm check:domain
pnpm check:store
pnpm check:web
pnpm test
pnpm check
pnpm test:e2e
pnpm test:e2e:pwa
pnpm test:e2e:chromium
pnpm test:e2e:mobile
pnpm test:e2e:a11y
pnpm verify:full
pnpm session:new -- --slug <short-slug> --duration "<duration>"
pnpm session:check
pnpm format
```

Use `pnpm check` as the normal code gate. `pnpm verify:full` adds the default Playwright suite, while
PWA coverage remains a separate `pnpm test:e2e:pwa` command.

Curated drill content is authored in `packages/domain/data/default-drills.json`, validated against
`packages/domain/schema/kendo-drills.schema.json`, and adapted by
`packages/domain/src/default-training-sets.ts` into the recursive `TrainingActivity` runtime model.
Every activity has a stable ID because dashboard quantities and activity notes are keyed by it.

See [PRODUCT.md](./PRODUCT.md) for product and UX scope, [CONTEXT.md](./CONTEXT.md) for terminology,
and [AGENTS.md](./AGENTS.md) for the repository working contract. Development history is recorded in
[`docs/work-sessions`](./docs/work-sessions/).

Project-owned Codex workflows are natively discoverable and indexed in
[`.agents/skills`](./.agents/skills/). Load only the skill that matches the current workflow.
