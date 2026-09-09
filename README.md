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
- Elysia local API scaffold in `apps/api`, with separate Node and Vercel adapters (not deployed)
- An uninitialized `apps/mobile` boundary reserved for explicitly requested future work

Optional accounts and synchronization are accepted future direction. Only the local health API
scaffold is implemented; accounts, remote sync, databases, and provider resources remain absent.
See [the account design](docs/ACCOUNT_SYNC.md) for decision status and later gates.

## Workspace layout

```text
apps/
  web/       React/Vite production SPA
  api/       Elysia application and standalone Node entry
  mobile/    Reserved Expo boundary
packages/
  domain/    Training contracts, validation, and curated-data adapter
  store/     Zustand store factory with injected persistence
  ui/        Reserved shared UI boundary
```

## Development

Node 24 LTS is the declared runtime; pnpm is the repository package manager. Common root commands are:

```bash
pnpm install
pnpm dev
pnpm dev:api
pnpm check:api
pnpm test:domain
pnpm test:store
pnpm test:web
pnpm check:domain
pnpm check:store
pnpm check:web
pnpm test
pnpm check
pnpm test:e2e
pnpm test:e2e:preview
pnpm test:e2e:pwa
pnpm test:e2e:chromium
pnpm test:e2e:mobile
pnpm test:e2e:a11y
pnpm verify:full
pnpm session:new -- --slug <short-slug> --duration "<duration>"
pnpm session:check
pnpm format
```

Use `pnpm check` as the normal code gate and `pnpm test:e2e` as the fast browser suite backed by the
Vite development server. `pnpm test:e2e:preview` rebuilds the app and runs the complete non-PWA
browser suite against Vite's production preview. `pnpm test:e2e:pwa` remains the dedicated PWA
artifact suite. The release gate, `pnpm verify:full`, runs `pnpm check`, the preview suite, and the
PWA suite without rerunning the development-server suite.

`pnpm dev:api` serves the standalone health API on local port 3000. The web development server
remains separate and does not call it. API request tests cover the application and root Vercel
adapter without opening a listener; combined Vercel discovery/routing still requires an authorized
Preview verification. No environment file or credentials are required for the health scaffold.

Curated drill content is authored in `packages/domain/data/default-drills.json`, validated against
`packages/domain/schema/kendo-drills.schema.json`, and adapted by
`packages/domain/src/default-training-sets.ts` into the recursive `TrainingActivity` runtime model.
Every activity has a stable ID because dashboard quantities and activity notes are keyed by it.

See [PRODUCT.md](./PRODUCT.md) for product and UX scope, [CONTEXT.md](./CONTEXT.md) for terminology,
and [AGENTS.md](./AGENTS.md) for the repository working contract. Development history is recorded in
[`docs/work-sessions`](./docs/work-sessions/). See the [architecture](./docs/ARCHITECTURE.md) and
[deployment runbook](./docs/runbooks/DEPLOYMENT.md) for the current production boundaries and
release procedure.

Project-owned Codex workflows are natively discoverable and indexed in
[`.agents/skills`](./.agents/skills/). Load only the skill that matches the current workflow.
