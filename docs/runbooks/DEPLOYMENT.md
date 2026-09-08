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

## Intentional canonical origin and indexing

The intentional canonical origin is **https://www.kendomenu.com**. This agrees with the historical
observations above and a fresh read-only check on 2026-09-08: the apex returned HTTP 308 to
`https://www.kendomenu.com/`. This decision changes repository metadata only; it does not change
DNS, apex/www redirects, Vercel settings, or browser storage origins.

The public discovery entry is `/app`, so the initial sitemap deliberately lists only
`https://www.kendomenu.com/app`. The landing page, library overview, sources, and cookie policy are
public/indexable; the sitemap conservatively promotes only the landing page. Dashboard, editor,
recovery, unknown routes, query-string variants, and other application surfaces are excluded. The shared
HTML shell supplies absolute canonical/social URLs. Client metadata applies the indexing policy
after routing; non-JavaScript crawlers still receive the shared shell, a known SPA limitation.
`robots.txt` permits crawling so that capable crawlers can observe `noindex`; it is not an access
control for local data. Revisit the sitemap deliberately if static public content pages are added.

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

## Rollback procedure (owner verification required)

This procedure was checked against Vercel documentation on 2026-09-08; it has **not been
executed against the live project**. Owner verification is required. An authorized owner must verify the project, plan permissions, deployment
eligibility, and production state before clicking a dashboard action. Vercel's current [Instant
Rollback documentation](https://vercel.com/docs/instant-rollback) says that rollback reassigns
production domains to an eligible earlier deployment without rebuilding it, leaves environment
values in their original state, and turns off automatic production-domain assignment until a
deployment is promoted again. The [production rollback
runbook](https://vercel.com/docs/deployments/rollback-production-deployment) documents the same
flow and the optional CLI commands.

### Identify the last known-good deployment

1. Record the incident time, the current production deployment URL, commit SHA, domains, and the
   first failing route or asset. Preserve the incident record before changing the serving deployment.
2. In the Vercel dashboard, select the verified project, open **Deployments**, and filter to
   production deployments. Inspect candidate deployments for the commit SHA, branch, deployment
   time, build status, and deployment URL. Select the most recent deployment that was previously
   serving production and passed the route, asset, persistence, and PWA checks below.
3. Confirm that the candidate is eligible for Instant Rollback. Vercel's current plan rules allow
   the immediately previous production deployment on Hobby and eligible previously production-
   aliased deployments on Pro or Enterprise. A Preview deployment that never served production is
   not an Instant Rollback target.
4. Before selecting a target, compare the persistence versions written by the incident revision and
   accepted by the candidate. This revision uses v10. A deployment predating v10 may not read a
   browser that has already migrated. Verify compatibility from the candidate source/tests and a
   representative non-sensitive fixture in an isolated profile; a clean-profile smoke test alone
   does not prove existing-data compatibility. If compatibility is unknown or fails, choose a
   compatible target or a forward fix rather than resetting user storage.
5. If the last known-good revision is unclear, stop and have the owner compare the candidate and
   bad deployment logs or use Vercel's documented `vercel inspect`, `vercel logs`, and `vercel bisect`
   workflow. Do not guess based only on a deployment name.

### Roll back through the dashboard

1. From the project's Production Deployment tile, choose **Instant Rollback**. The same action is
   available from the ellipsis menu beside an eligible deployment in **Deployments**.
2. Select the recorded last known-good deployment and continue. Review the confirmation dialog:
   verify every listed production domain, including the currently observed apex-to-`www` redirect,
   and confirm that no environment-variable change is being requested. Do not open project
   settings, edit domains, or change environment values as part of the incident response.
3. Confirm the rollback and record the selected deployment URL, commit SHA, operator, and time. A
   rollback changes which immutable deployment receives production traffic; it does not rebuild the
   source or alter a user's browser data.
4. Keep the project in the rolled-back state only while the incident requires it. Vercel disables
   automatic production-domain assignment after Instant Rollback, so new pushes must not be
   assumed to replace the rolled-back deployment.

The documented CLI equivalent is `vercel rollback` (or `vercel rollback <deployment-url>` when the
owner has confirmed that a specific target is allowed), followed by `vercel rollback status`.
These commands require an already authorized, linked project and are included for reference only;
never copy tokens or environment values into this runbook.

### Restore normal promotion after the incident

After a fixed deployment has passed the release gate and the owner is ready to resume normal
releases, use the dashboard's **Undo Rollback** action on the production tile, select the intended
deployment, and click **Confirm** to promote it. Vercel documents that this promotion re-enables automatic
production-domain assignment. The CLI equivalent is `vercel promote <deployment-url>` followed by
`vercel promote status`. Confirm the exact commit before promoting; do not promote an unreviewed
Preview or a deployment from outside the protected Production Branch.

### Validate the canonical domain and application after rollback

Run this checklist in a dedicated clean browser profile and with read-only HTTP checks where
possible. The current repository evidence identifies `https://www.kendomenu.com/` as the serving
canonical host and `https://kendomenu.com/` as the apex that redirects to it; recheck both after
the rollback rather than assuming a domain assignment survived the operation. Compare assets and
metadata with the selected revision: a target predating this polish may legitimately lack social
metadata, robots/sitemap files, responsive sources, or client noindex. Record those known
limitations; do not change hosting settings to make an old revision satisfy a newer asset list.

- [ ] The apex redirects to `https://www.kendomenu.com/` over HTTPS, and the canonical host returns
      a successful response with the expected host, certificate, title, and any canonical/social
      metadata implemented by the selected revision.
- [ ] Open `/`, `/app`, `/app/dashboard`, `/app/library`, a known library detail route,
      `/app/drills/new`, `/app/sources`, and `/cookies`. Refresh each route directly and confirm the
      SPA fallback keeps the URL and renders the expected page.
- [ ] Visit an unknown route under `/app` and at the top level. Confirm the client Not Found
      surface matches the target revision, including noindex where implemented; record that the hosting rewrite may still return
      HTTP 200 for this client-side soft 404.
- [ ] Fetch the hashed JavaScript and CSS referenced by the rolled-back HTML, the responsive image
      sources (or the older background assets), `manifest.webmanifest`, `sw.js`, and `registerSW.js`.
      Check `robots.txt` and `sitemap.xml` when included in the target revision. Confirm successful
      responses and that the PWA assets belong to the selected deployment.
- [ ] In a clean profile, add a built-in session, adjust one quantity, add a dashboard/activity
      note, reload, and confirm the values survive. In a profile with existing data, export a
      backup before testing and confirm that the current v10 LocalStorage payload remains readable;
      never clear a user's data to make a rollback pass.
- [ ] Revisit an installed or previously visited PWA session. Confirm the prompt-based service
      worker can update through its normal acceptance prompt and the cached app shell opens after a
      prior visit. Confirm the running revision after activation; an old worker can temporarily
      keep serving a different cached revision. Check the service-worker
      cache independently from LocalStorage; a rollback does not restore LocalStorage; service-worker assets may update independently.
- [ ] Review the Vercel deployment tile and incident record for unexpected errors. Confirm no
      environment-variable, domain, project, or production-branch setting was changed as a side
      effect of the rollback.

Rollback affects deployed files only. It does not change a browser's origin-specific LocalStorage,
including a v10 migration already performed by a user's browser.

## Static paths, `.git/config`, and client soft 404s

The repository serves `apps/web/dist`, and the checked-in Vercel rewrite sends document paths to
`index.html` after static files are considered. The repository's `.git/config` is outside that
publish directory and is not a production asset. The runbook therefore does not add a special
`.git` blocking rewrite: there is no repository file to protect at the deployed path, and adding
path exceptions would create a hosting change that could interfere with legitimate SPA deep links.

A read-only production GET on 2026-09-08 verified that `https://www.kendomenu.com/.git/config`
returned HTTP 200, `Content-Type: text/html`, and the 1,281-byte application HTML shell containing
`<div id="root"></div>`; it contained no Git `[core]` or `[remote ...]` sections. Repository output
inspection and the local preview tests provide a separate check of this change's publish boundary.
This verifies the requested path; it is not a claim of a complete production security audit.

After a deployment, an authorized owner may repeat that read-only request. A body
containing the app's HTML shell is evidence of the SPA fallback (a soft 404), not evidence that the
repository file was exposed. A response containing Git configuration sections or a non-HTML file
would be an incident requiring immediate owner investigation. The same soft-404 limitation applies
to unknown application routes because the rewrite may return HTTP 200 while the client renders
`NotFoundPage`; the client page should carry `noindex` metadata, while changing the HTTP status or
rewrite behavior remains a separately authorized hosting decision.

## Account and domain continuity checklist (owner verification required)

Every item below is an owner-operated control. This repository has no direct evidence that any of
these settings is enabled, and no setting should be changed as part of this documentation update.

- [ ] **GitHub — owner verification required:** record the account owner and at least one backup
      maintainer; verify MFA is enabled; securely store recovery codes; test a recovery method; and
      keep multiple recovery methods where GitHub supports them.
- [ ] **Vercel — owner verification required:** record the team owner and backup operator; verify MFA
      is enabled; securely store and periodically test recovery codes; and retain multiple recovery
      methods where the account supports them.
- [ ] **Porkbun — owner verification required:** record the registrar-account owner and backup
      operator; verify MFA is enabled; securely store and test recovery codes; and retain multiple
      recovery methods where supported.
- [ ] **Porkbun domain — owner verification required:** verify auto-renewal is enabled, the payment
      method is valid, and registrant/admin contact details and notification addresses are current.
- [ ] **Domain continuity — owner verification required:** record the expiry date and reminder
      owner; verify registrar/transfer lock is enabled where supported; and record who is authorized
      to change DNS, Vercel domains, certificates, or redirects.
- [ ] **Recovery record — owner verification required:** store the account owners, backup contacts,
      recovery-code location, and last review date in the owner's approved password manager or
      equivalent secure record. Do not put credentials, recovery codes, tokens, or secrets in this
      repository.

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

The requested `docs/security/SUPPLY_CHAIN_SECURITY.md` was absent on 2026-09-08, and no equivalent
supply-chain security document was found in the tracked tree. No policy is inferred from that
missing file; the owner should provide it if additional release controls are intended.
