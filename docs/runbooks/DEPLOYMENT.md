# Deployment runbook

This runbook describes the repository-declared release contract and the current public deployment.
It does not authorize changes to Vercel, DNS, domains, analytics, environment variables, or other
production state.

## Repository-declared settings

The checked-in settings are the source of truth for the build:

| Setting                  | Declared value                                      | Source                                    |
| ------------------------ | --------------------------------------------------- | ----------------------------------------- |
| Package manager          | `pnpm@11.22.0` (`packageManager`)                   | [`package.json`](../../package.json)      |
| Node requirement         | `>=20.19.0` (`engines.node`)                        | [`package.json`](../../package.json)      |
| Checked-in Vercel config | Repository root: [`vercel.json`](../../vercel.json) | [`vercel.json`](../../vercel.json)        |
| Build command            | `pnpm build`                                        | [`vercel.json`](../../vercel.json)        |
| Build implementation     | `pnpm --filter @kendo-menu/web build`               | root [`package.json`](../../package.json) |
| Output directory         | `apps/web/dist`                                     | [`vercel.json`](../../vercel.json)        |
| SPA rewrite              | `/(.*)` → `/index.html`                             | [`vercel.json`](../../vercel.json)        |

The root lockfile is `pnpm-lock.yaml`; no alternate package manager or lockfile is declared. No
`installCommand`, framework override, function, API, or provider-specific environment value is
checked into `vercel.json`. Vercel documents package-manager detection and the `packageManager`
field in its [Package Managers guide](https://vercel.com/docs/package-managers), build/output and
root-directory settings in [Configuring a Build](https://vercel.com/docs/builds/configure-a-build),
and the SPA pattern in [Rewrites on Vercel](https://vercel.com/docs/routing/rewrites).
The current Vercel supported-version table lists pnpm through version 10; the repository's pnpm 11
pin therefore needs confirmation in the current or next build log and, if necessary, the documented
Corepack setup.

Relevant repository release commands are:

```text
pnpm session:check
pnpm format:check
pnpm check
pnpm build
pnpm test:e2e:preview
pnpm test:e2e:pwa
pnpm verify:full
```

`pnpm verify:full` is the release gate: it runs `pnpm check`, the complete non-PWA suite against a
fresh Vite preview, and the dedicated PWA suite. It does not rerun the development-server suite.

## Production facts as of 2026-09-02

### Owner-reported

- KendoMenu is deployed on Vercel.
- Porkbun is the registrar/DNS provider.
- The custom domain is `kendomenu.com`.
- Vercel PR checks and Preview deployments are connected to this GitHub repository.
- DNS and HTTPS are working.

### Independently observed

Read-only checks from this environment on 2026-09-02 observed that:

- `https://kendomenu.com/` returned HTTP 308 with `Location: https://www.kendomenu.com/`.
- `https://www.kendomenu.com/` returned HTTP 200 and identified the serving platform as Vercel;
  the apex TLS handshake verified successfully. Public DNS resolved the apex and returned a Vercel
  DNS CNAME for `www`.
- The canonical host returned HTTP 200 for `/app`, `/app/dashboard`, `/app/library`, `/cookies`,
  `/manifest.webmanifest`, `/sw.js`, and `/registerSW.js`.

Therefore the current observed canonical behavior is **www**: the apex redirects to
`https://www.kendomenu.com/`, while `www` serves the app. This records observed behavior, not the
undocumented dashboard mechanism that implements it.

The [2026-08-31 preview-readiness entry](../work-sessions/2026-08-31-vercel-preview-readiness.md)
remains a valid pre-deployment historical snapshot; it is not replaced by these current facts.

## Protected PR → production

Before release, the owner confirms the configured Vercel Production Branch and whether automatic
production-domain assignment is enabled. The normal path for this GitHub-integrated project is a
protected pull request into that Production Branch, expected to be `main`.

1. From a clean intended revision, run `pnpm verify:full`. Confirm the build uses the declared Node
   requirement and pnpm version; the historical preview-readiness record specifically flags the
   repository's pnpm 11 pin for owner confirmation in Vercel build logs.
2. Open or update a pull request targeting the Production Branch. Wait for the repository
   `release-gate` and Vercel Preview checks to pass, and confirm the Preview commit matches the pull
   request head. Vercel describes Local, Preview, and Production as separate environments in its
   [deployment overview](https://vercel.com/docs/deployments).
3. Inspect that Preview deployment's build output, logs, generated route assets, and the smoke
   checklist below. If using the CLI with an already linked project, list a ready preview, inspect it,
   test it, and review errors:

   ```text
   vercel list --status READY
   vercel inspect <deployment-url> --logs
   vercel curl /app/dashboard --deployment <deployment-url>
   vercel logs --deployment <deployment-url> --level error --limit 50
   ```

   These commands follow Vercel's [Preview-to-Production guide](https://vercel.com/docs/deployments/promote-preview-to-production);
   replace the placeholder only in an authorized operator session.

4. Merge the approved pull request through the protected branch. Do not bypass its required checks or
   push the release commit directly.
5. Confirm Vercel created a Production deployment from the merged revision and assigned the canonical
   domains. Re-run the smoke checklist against `https://www.kendomenu.com/`. A deployment change does
   not migrate, back up, or restore a user's browser LocalStorage.

### Conditional manual promotion

Use direct Preview promotion only when the owner has deliberately configured a manual-promotion
workflow or disabled automatic production-domain assignment. Confirm the exact revision and explicit
release approval first: promoting an unmerged branch Preview can put a revision outside the protected
Production Branch into production. Promote through the Vercel dashboard or with
`vercel promote <deployment-url>`. Vercel states that this triggers a production rebuild with
Production environment values; do not assume the Preview artifact is merely relabelled.

## Rollback expectations

For a production incident, use Vercel Instant Rollback from the project dashboard or the documented
`vercel rollback` flow. It points the production domains at an eligible previous production
deployment without rebuilding it; Vercel notes that changed environment values are not rebuilt by
that operation. Verify the canonical domain, routes, PWA assets, and logs after rollback. Vercel
also notes that rollback disables automatic production-domain assignment until a deployment is
promoted again; restore normal release behavior with `vercel promote <deployment-url>`. See
[Instant Rollback](https://vercel.com/docs/instant-rollback) and the [production rollback
runbook](https://vercel.com/docs/deployments/rollback-production-deployment).

Rollback affects deployed files only. It does not change a browser's origin-specific LocalStorage,
including a v10 migration already performed by a user's browser.

## Post-deploy smoke checklist

- [ ] Use a dedicated clean browser profile for state-changing smoke checks. If a profile contains
      real KendoMenu data, export a backup first and restore or clean up the smoke-test data afterward.
- [ ] Check apex → `www` redirect, HTTPS, and a 200 response on the canonical host.
- [ ] Open `/`, `/app`, `/app/dashboard`, `/app/library`, a library detail route, `/app/drills/new`,
      `/app/sources`, and `/cookies`; confirm the intended not-found behavior for an unknown route.
- [ ] Refresh the dashboard, library detail, custom-session builder, and cookie-policy routes
      directly; confirm the SPA rewrite preserves the URL and the page loads.
- [ ] Fetch `manifest.webmanifest`; confirm it is valid, starts at `/app`, and has `/` scope.
- [ ] Confirm `/sw.js` registers, the update prompt remains prompt-based, and an installed/standalone
      session can load the cached app shell after a prior visit. Keep service-worker cache checks
      separate from data-retention checks.
- [ ] Add a built-in session and a custom session, change a quantity, add dashboard/activity notes,
      refresh, and confirm the values persist. Confirm reset/backup recovery behavior where needed.
- [ ] Verify the data is stored under the canonical origin. LocalStorage is origin-specific and is
      neither server backup nor cross-device recovery; clearing site data or changing origin can
      remove or hide it.
- [ ] Check a narrow mobile viewport, including navigation and forms, for overflow, usable targets,
      and readable content.
- [ ] Navigate with the keyboard: visible focus, logical order, labeled controls, usable dialogs,
      and no interaction that requires color or a pointer.
- [ ] Inspect the network/privacy boundary: GoatCounter may receive the configured document-load
      analytics request, but there should be no app-state, plan, note, menu-name, SPA-route, or
      custom-event payload intentionally sent to it. Confirm the cookie policy remains accurate.

## Known unknowns / owner confirmation

- The exact Vercel project/team/deployment identifiers, Production Branch, automatic production-domain
  assignment, deployment protection, dashboard Root Directory/framework settings, GitHub integration
  configuration, and dashboard environment values are intentionally not recorded here.
- Confirm the Vercel build log uses the repository's `pnpm@11.22.0`. Vercel's current package-manager
  documentation lists the Corepack path for an exact `packageManager` pin; whether the historical
  readiness recommendation `ENABLE_EXPERIMENTAL_COREPACK=1` is configured for Preview and Production
  is not independently verified.
- DNS TTLs, certificate identifiers, registrar-account details, credentials, and secrets are omitted
  intentionally. The public checks cannot prove the owner-reported Porkbun relationship or the
  dashboard configuration behind the observed redirect.
