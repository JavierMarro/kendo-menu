# KendoMenu

A free, open-source planner for kendo practice. Browse 11 curated keiko menus, adjust repetitions
and duration, add training notes, or build your own sessions.

- **Guest:** your dashboard stays in this browser, with offline use and backup export.
- **Google account:** saved menus live online and are available across devices. Account edits stay
  in memory until you choose **Save to account**.
- **Guest copy:** eligible new accounts receive one choice to copy their guest menus. The original
  stays on the device, and subsequent guest/account edits are independent.

The managed-account release reached production on 2026-10-18. The owner reports that the site is
deployed and working; this status is owner-reported, not an independent live verification. See the
[deployment runbook](docs/runbooks/DEPLOYMENT.md) for the evidence distinction and the
[account contract](docs/MANAGED_DASHBOARDS.md).

## Run locally

Use Node **24.x** and the pnpm version declared in `package.json`.

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:5173`. Guest use does not require a database or Google credentials.

For account development, use your own non-production Neon branch. Copy the placeholder templates
and fill the ignored files privately:

```sh
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env.local
```

The web app needs `VITE_NEON_AUTH_URL`. The API needs `NEON_AUTH_BASE_URL`, `DATABASE_URL`, and
`APP_ORIGIN=http://localhost:5173`. The two Auth URL variables refer to the same complete Neon Auth
base URL. Database migrations use a separate `MIGRATION_DATABASE_URL`; applying them is an explicit
owner action, never part of starting the app. Follow the [database checklist](docs/MANAGED_DASHBOARDS.md#owner-run-non-production-migration)
before enabling account storage.

Keep the web terminal running. In a second terminal, start the API from its own directory:

```sh
cd apps/api
pnpm exec node --env-file=.env.local --import tsx --watch src/node.ts
```

The API listens on port 3000; Vite proxies the account requests. See the
[managed-account guide](docs/MANAGED_ACCOUNT_WEB.md) for the complete development flow.

## Useful commands

```sh
pnpm check                # Types, lint, formatting, unit tests, build
pnpm test:e2e             # Desktop/mobile development browser suite
pnpm test:e2e:preview     # Complete suite against a fresh production preview
pnpm test:e2e:pwa         # Service worker and offline guest shell
pnpm verify:full          # Code checks, preview suite, and PWA suite
```

Real database integration tests require the guarded local `kendomenu_test` database. Never point
`TEST_DATABASE_URL` at Neon, development, or production data.

## Project layout

- `apps/web`: React, Vite, React Router and the browser UI.
- `apps/api`: Node 24, Elysia, PostgreSQL and Drizzle.
- `packages/domain`: training contracts, validation and the curated catalogue.
- `packages/store`: Zustand state with injected browser or memory storage.
- `packages/ui`: reserved for genuinely shared platform-neutral components; the responsive web app
  and installable PWA cover mobile use.

Curated content lives in `packages/domain/data/default-drills.json`. Read [PRODUCT.md](PRODUCT.md)
and [CONTEXT.md](CONTEXT.md) for the product and terminology, or [the architecture](docs/ARCHITECTURE.md)
for data flow. [AGENTS.md](AGENTS.md) describes repository conventions for coding agents.

## Contributing and security

Small, focused issues and pull requests are welcome. Describe the user-visible change, preserve
independent guest/account data, and run the relevant checks before proposing a code change.

- Keep database passwords, OAuth secrets, management keys, tokens and personal training data out of
  commits, issues, screenshots and logs. `VITE_*` values are exposed to browsers; never put secrets
  in them. The Neon Auth base URL is public configuration, not a credential.
- `.gitignore` and CI reject common private configuration, key and database-export file names.
  This is a file guard, not a content-based secret scanner. `.env.example` files must stay empty
  placeholder templates.
- Before making a repository public, run a redacted scan of its entire Git history and review
  third-party content/asset permissions. Ignoring or deleting a file does not remove earlier
  commits; revoke and rotate any credential that was exposed.
- Confirm [GitHub secret scanning and push protection](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning),
  protect `main` with required CI checks, and enable private vulnerability reporting. Report
  security issues privately when that channel is enabled; never attach credentials to a public issue.

CI uses read-only repository permissions and runs the existing release checks without deployment
credentials. Public source code does not grant access to a hosted account or database.

## License

Copyright (C) 2026 JavierMarro.

KendoMenu's original code is licensed under **GNU AGPL version 3 only** (`AGPL-3.0-only`); see
[LICENSE](LICENSE). Reuse, modification and commercial use are allowed under its terms. If you host
an applicable modified version, offer users the corresponding source for that version. Third-party
dependencies and materials retain their own license terms.
