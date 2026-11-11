# Pass 6 — Core routes, accessibility and browser/PWA behavior

The findings and standalone probe describe the pre-fix checkout. See the
[audit index](README.md) for the remediation and current regression checks.

Audited 2026-11-11 (Europe/Madrid) on `codex/updated-audit-kendomenu` at
`cf2d14dc0c3e7be2ad722f88d00b32e49386e0c0`. The intake index and working tree were clean, with
no non-ignored untracked paths. Compared all 45 changed paths outside `docs/audit/` with
`de4f84fcc356edcdd5b58a53bedd5030fb90830d` using the [baseline commands](README.md#baseline).
Relevant drift includes guest persistence recovery, account save and identity fencing, share
recipient recovery, the static share document and corresponding tests. The route tree, workspace
shell, library dialog, install/update components and PWA build and test configs are unchanged
from the pinned baseline. The Pass 5 fixes are present. The runtime was Node 24.21.0 and pnpm
11.22.0 on Darwin x86_64. All new evidence is under `docs/audit/`.

## Route and state matrix

| Journey                        | Implementation and boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Local evidence                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace entry and Back       | The [route tree](../../apps/web/src/app/app-routes.tsx#L37) separates guest, account and public share routes. [Legacy redirects](../../apps/web/src/app/app-route-components.tsx#L347) preserve query/hash. The [guest route](../../apps/web/src/features/persistence/GuestWorkspaceRoute.tsx#L77) confirms local persistence before replacing the route for a verified or uninitialized account. The [account gate](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx#L124) sends signed-out entry to sign-in or the corresponding public share and withholds account state while verification is unavailable. | Preview covered entry, Back/Forward and scroll restoration across library and workspace routes. The trailing-slash entry discrepancy is KM-06-001.                                                                          |
| Library and workspace controls | The [library](../../apps/web/src/features/library/LibraryPage.tsx#L61) removes invalid dialog query state, restores focus to the originating link or the main region, and uses Back only for a dialog opened from the library. [DialogShell](../../apps/web/src/components/DialogShell.tsx#L71) hides and inerts background content, traps Tab and handles Escape. [Route focus](../../apps/web/src/app/app-route-components.tsx#L223) targets main on pathname changes. [WorkspaceShell](../../apps/web/src/components/WorkspaceShell.tsx#L59) closes User options on navigation and restores keyboard access on Escape.      | Preview covered phone navigation and content clearance, 320 px layout, builder keyboard order at 200% text size, library dialog focus/scroll return, and account portal removal when editing is fenced.                     |
| Dirty work and failures        | The [builder](../../apps/web/src/features/custom-sets/CreateDrillPage.tsx#L144) holds unsubmitted values in memory, adds native leave protection and focuses the invalid form summary. The [guest gate](../../apps/web/src/features/persistence/PersistenceGate.tsx#L182) protects unconfirmed writes and session-only data. The [account workspace](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx#L353) exposes recovery and keeps drafts in memory. [Recovery boundaries](../../apps/web/src/features/errors/ApplicationRecovery.tsx#L11) offer reload and sanitized diagnostics.                         | Preview covered quota/session-only exits, canonical draft confirmation, unavailable account and blocked actions, and keyboard recovery with clipboard/storage failure. URL variants and canceled updates are covered below. |
| Public preview and recipient   | The [share page](../../apps/web/src/features/sharing/SharedMenuPage.tsx#L148) keeps public preview independent of the account dashboard. Its signed-in recipient route is fenced by identity, with setup continuation [owned by the account workspace](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx#L474). Read retries and Add status are in place.                                                                                                                                                                                                                                                       | Preview covered signed-out recipient fallback, sign-in/setup return, explicit Add, denied identity, transient and missing states, and preservation of unrelated account edits on retry. Uses synthetic transport.           |
| Clipboard and Web Share        | The [share dialog](../../apps/web/src/features/sharing/ShareMenuButton.tsx#L36) creates a link on request, exposes it as a selectable read-only field and invokes either browser API on a subsequent action. Denial or cancellation leaves the link available.                                                                                                                                                                                                                                                                                                                                                                 | Keyboard probe checked initial focus, exact copied URL, copy denial and retry, Web Share payload/cancellation, one Create request, and Escape focus return. Browser APIs were injected. [Probe](browser-probes.mjs#L112)    |

The [product decision](../../PRODUCT.md#L121) limits account drafts to memory and calls browser
leave warnings best effort. The expected in-app discard guard is separate from the native
`beforeunload` dialog. Existing tests verify named controls, focus, status, route history and
rendered states. Axe checks cover selected serious and critical violations. Screen reader output
and other browser engines remain unverified.

## Offline, installation and updates

- **Cache scope.** The [production build](../../apps/web/vite.config.ts#L20) generates a
  root-scoped worker and standalone manifest starting at `/app`. Workbox precaches build assets
  and uses the same neutral shell for allowed app navigations. It has no runtime response caching
  rule and excludes the static share document and social image. The
  [auth dispatcher](../../apps/web/src/auth-dispatcher.ts#L17) sanitizes ordinary routes before
  importing the app and isolates verifier exchange from normal worker registration in
  [app entry](../../apps/web/src/app-entry.tsx#L25). A worker already in control can serve the
  neutral shell at the callback path. The verifier URL is a navigation input, with no precache
  entry for it.
- **Observed offline behavior.** A fresh offline context failed to open the app. After a
  synthetic sign-in and successful account, public and recipient loads, the controlled browser
  had 39 CacheStorage entries. None matched API, account, auth or shared routes, the shared HTML
  document, or a verifier query. The test removed route mocks before going offline. Reloading
  the account route showed verification unavailable, hid the saved card and Save control, and
  allowed opening the guest workspace. The separate PWA suite verified a primed guest dashboard
  and library offline, local v10→v11 migration, a saved edit from an offline deep link, and
  failure to reopen an online public snapshot offline. This is evidence for generated Workbox
  behavior and CacheStorage. Browser HTTP and hosting caches are a separate boundary.
  [Probe](browser-probes.mjs#L184), [production cases](../../apps/web/e2e/pwa.spec.ts#L42)
- **Install.** The [install provider](../../apps/web/src/features/install/InstallExperience.tsx#L104)
  defers a captured browser prompt to user action, tracks display mode and fullscreen, and offers
  platform instructions when needed. [Install state](../../apps/web/src/lib/install-prompt.ts#L42)
  uses device signals and local counters/dismissal with storage fallbacks. Unit and preview checks
  cover prompt/dismissal and phone eligibility, including cookie-notice priority. The production
  suite checks the manifest and actual PNG dimensions. OS installation and installed-window
  behavior require device verification.
- **Update.** The [update component](../../apps/web/src/components/ServiceWorkerUpdates.tsx#L6)
  checks the registration on foreground visibility and shows a waiting-worker notice with
  **Update** and **Later**. Existing production coverage passed for clean deferral, activation and
  reload. With an unsaved account builder in a second tab, **Later** hid the notice. Activation
  by the other tab still attempted to reload the dirty tab. Chromium offered its native leave
  dialog and dismissing it retained the form. The [architecture note](../ARCHITECTURE.md#L187)
  says Later leaves the current page running. It does not specify how a different tab's update
  should affect that page. No data loss was observed in this two-tab check. Per-tab consent
  remains a product question. Same-tab recovery is a confirmed defect below.
  [Production case](../../apps/web/e2e/pwa.spec.ts#L84), [probe](browser-probes.mjs#L246)

## Findings

### KM-06-001 · P2 · High confidence · Defect

Accepted builder URLs with a trailing slash bypass the in-app unsaved-form warning. Open
`/app/guest/drills/new/` or `/app/account/drills/new/`, type an unsaved name, then click
**Dashboard**. Both navigated with zero dialogs and Back reopened an empty form. The canonical
URLs prompted, and canceling kept the form. React Router accepts the slash variant. The guest
and account guards use exact, suffix or anchored matches that reject it. The same mismatch
affects entry routing. A verified visit to `/app/guest/library/` went to account Dashboard,
while `/app/guest/library` reached account Library. The browser probe exercised these exact
variants. The edit guards use the same anchored pattern with a parameter.

The existing builder and guest recovery cases use canonical routes and therefore miss this
path. Use React Router's matching semantics in the two draft guards and guest-to-account
destination selection, keeping the intended behavior for guest edit IDs. Verify new and edit
paths in both workspaces, with and without the trailing slash. Cancel must keep the value and
confirmation must allow departure. Verify library entry maps the same destination for both forms.
[Guest guard](../../apps/web/src/features/persistence/PersistenceGate.tsx#L486),
[account guard](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx#L690),
[guest entry](../../apps/web/src/features/persistence/GuestWorkspaceRoute.tsx#L16),
[existing account test](../../apps/web/e2e/managed-account.spec.ts#L1244),
[probe](browser-probes.mjs#L62)

### KM-06-002 · P3 · High confidence · Defect

**Update** becomes ineffective after the user cancels the browser's unsaved-work warning. In a
controlled Chromium tab with a dirty account builder, **Update** activated the waiting worker
and prompted the native leave dialog. Dismissing it left the draft intact and the update notice
visible. `registration.waiting` was `null`. A second click produced zero new dialogs and zero
reloads within the observation window. The app always invokes `updateServiceWorker(true)`.
The installed `vite-plugin-pwa` 1.3.0 client sends `SKIP_WAITING` to a waiting worker and reloads
on the `controlling` event. A second click has no waiting worker to activate and the first
controlling event has already occurred.

The notice unit test checks a rejected callback and the production test updates from a clean
page. Neither covers a canceled native reload after activation. Track that the update is already
active and have the remaining action request a normal reload with the existing native guard.
Verify first cancellation retains the form, the action is still usable, and the tab can reload
after saving or confirming discard. Keep automatic draft recovery outside this change.
[Update action](../../apps/web/src/components/ServiceWorkerUpdates.tsx#L28),
[notice](../../apps/web/src/components/ServiceWorkerUpdateNotice.tsx#L11),
[production case](../../apps/web/e2e/pwa.spec.ts#L84), [probe](browser-probes.mjs#L246)

### KM-06-003 · P3 · High confidence in the check failure · Test gap

The desktop Chromium closed-library axe scan failed in the scoped preview suite. Axe reported
three header colors `#dfb65b`, `#f4f6f8` and `#b9c4d0` against `#ffffff`, with contrast ratios
1.91, 1.08 and 1.76. All four isolated repetitions passed, as did the ordinary library scan in
the first run. The [CSS](../../apps/web/src/styles.css#L83) declares a dark page background.
This evidence establishes an inconsistent check result. It leaves the cause of the white
background measurement unresolved.

The failing test starts its first axe scan immediately after `goto`. The ordinary library
test waits for the routed heading. Add that same readiness assertion before the first scan
and capture computed foreground and ancestor backgrounds if the failure recurs. Verify both
closed/open scans repeatedly in the full scoped preview context with axe rules still enabled.
[Failing scan](../../apps/web/e2e/accessibility.spec.ts#L87),
[ready-heading comparison](../../apps/web/e2e/accessibility.spec.ts#L125)

An independent reviewer checked the route matching, persistence and identity fences, installed
router and worker behavior, and browser evidence. The confirmed findings are bounded to the
observed in-app navigation and same-tab retry. The peer-tab case retains its separate product
question and observed native protection.

## Verification and limits

Commands ran sequentially from the repository root with the [target runtime](README.md#baseline).

| Check                                                                                       | Result                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Scoped web Vitest                                                                           | 7 files, 61 passed.                                                                                                                       |
| Scoped preview, desktop and mobile Chromium                                                 | 72 passed, 3 expected platform skips, 1 failed (KM-06-003).                                                                               |
| Separate production PWA suite                                                               | 7 passed.                                                                                                                                 |
| Route and PWA probes                                                                        | Both completed. The probes record the defects above with synthetic auth/API data and real Chromium routing, storage and worker lifecycle. |
| Isolated closed/open library axe, desktop Chromium                                          | 4 passed. The original preview run still has one failure.                                                                                 |
| Account dashboard/sign-out accessibility and responsive library, desktop and mobile preview | 4 passed.                                                                                                                                 |

```sh
pnpm --filter @kendo-menu/web exec vitest run --config vitest.config.ts src/lib/install-prompt.test.ts src/features/install/InstallExperience.test.tsx src/components/ServiceWorkerUpdateNotice.test.tsx src/lib/route-metadata.test.ts src/lib/navigation-state.test.ts src/test/error-recovery.test.tsx src/features/account/AccountUnsavedWarning.test.tsx

pnpm test:e2e:preview --workers=2 accessibility.spec.ts ui-journey.spec.ts navigation-scroll.spec.ts error-recovery.spec.ts install-notices.spec.ts guest-recovery-navigation.spec.ts managed-account.spec.ts menu-sharing.spec.ts --grep 'menu-sharing\.spec\.ts|error-recovery\.spec\.ts|install-notices\.spec\.ts|guest-recovery-navigation\.spec\.ts|library dialog closed or open|dashboard route|library route|library detail route|drill builder route|builder keyboard order|empty dashboard and session builder|workspace navigation keeps library|preserves a scrolled library|established Google redirect|public sign-in resets|guest workspace navigation|verified User options|unsaved account warning|offline account builder|account library portal dialog|hidden dirty account draft|unfinished account builder draft'

pnpm test:e2e:pwa
node --import ./apps/api/node_modules/tsx/dist/loader.mjs docs/audit/browser-probes.mjs routes
node --import ./apps/api/node_modules/tsx/dist/loader.mjs docs/audit/browser-probes.mjs pwa

pnpm test:e2e:preview --workers=1 --project=chromium --repeat-each=4 accessibility.spec.ts --grep 'library dialog closed or open'
pnpm test:e2e:preview --workers=2 accessibility.spec.ts managed-account.spec.ts --grep 'account dashboard and sign-out dialog are accessible|aligns Library activity quantities'
```

The [preview config](../../apps/web/playwright.preview.config.ts#L14) uses a fresh Vite build
with error test fixtures. The [separate PWA config](../../apps/web/playwright.pwa.config.ts#L22)
uses the production build and desktop Chromium. The local probe serves a byte change to the
generated worker response to simulate an update, using no file changes to the build. Native
desktop/mobile engines other than Chromium, OS share and clipboard permissions, installed OS
windows, native BFCache, and real hosted HTTPS caching, Google and Neon were unavailable in
these checks. The two-tab probe observes foreground behavior only. This pass reuses Pass 1's
guest coordination evidence and adds no native Web Locks comparison. Landing, side pages and
Mitori content, backend/database checks, and the process and hosting audit were outside scope.
