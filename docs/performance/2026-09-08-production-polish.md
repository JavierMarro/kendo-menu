# Production image and metadata polish — 2026-09-08

## Scope and baseline

This is a local production-build comparison against baseline commit `a9282a5`, not a deployment
or field-speed benchmark. No DNS,
Vercel configuration, deployment, environment, analytics, account, persistence format, or dependency
was changed. The requested supply-chain document was absent (see the deployment runbook).

The production references before this pass were:

| Image | Production references                                                                       | Original encoding                                                | Rendered size and loading                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Logo  | `BrandLockup.tsx`, used by `AppShell.tsx` and `SiteFooter.tsx`                              | `public/assets/kendo-menu-logo.jpeg`, 2816×1536, 1,760,202 bytes | Header 88×44 CSS px; footer 44×22; old attributes 88×48; `object-fit: cover` plus 3× zoom; header high priority, footer default eager                              |
| Hero  | `styles.css` desktop and narrow-screen `.landing-page` backgrounds; tablet `cover` override | `public/assets/kendo-menu-hero.jpeg`, 2752×1536, 1,485,301 bytes | Viewport-width landing section; desktop `cover`, right center; phone 200% width at 68% center; tablet `cover` at 68%; CSS-discovered, no explicit loading/priority |

Both JPEGs were copied unchanged from `public` into `dist`, and both appeared in the generated
service-worker precache: **1,760,202 logo bytes + 1,485,301 hero bytes = 3,245,503 bytes combined**. Existing integration/E2E tests also referenced
the old paths; they have been updated. Historical work-session references remain historical.

## Encoding and delivery

The original files now live under `assets/source`, outside the publish directory. Each original
contributes **0 bytes** to production output and the new precache. The
[source README](../../assets/source/README.md) records the offline recipe and encoder versions.
Existing local Sharp 0.34.5 / libvips 8.17.3 supplied AVIF, WebP, and MozJPEG encoders; no runtime
image processing or new dependency is involved. Production byte counts are encoded file lengths:

| Image | Dimensions | AVIF bytes | WebP bytes | JPEG bytes |
| ----- | ---------- | ---------: | ---------: | ---------: |
| Logo  | 44×22      |        635 |        562 |        826 |
| Logo  | 88×44      |      1,018 |      1,034 |      1,602 |
| Logo  | 176×88     |      1,466 |      2,020 |      3,549 |
| Logo  | 264×132    |      2,055 |      2,990 |      5,585 |
| Hero  | 768×429    |      8,836 |     11,818 |     15,655 |
| Hero  | 1280×714   |     15,973 |     23,760 |     32,704 |
| Hero  | 1920×1072  |     24,284 |     39,712 |     58,126 |
| Hero  | 2752×1536  |     33,493 |     60,082 |     95,812 |

All 24 responsive variants total **443,597 bytes**, an 86.33% reduction from the two originals even
when storing every format and size. `<picture>` orders AVIF, WebP, then a responsive JPEG fallback.
The logo crop encodes the previous visible 3× zoom; the rendered frame stays unchanged and its
attributes now correctly describe a 2:1 ratio. Header `sizes` is 88px and footer `sizes` is 44px,
with candidates covering common 1×–3× DPRs. The footer is lazy; the header has normal priority.

Hero `sizes` follows the existing crop: 200vw below 680px, `max(100vw, 941px)` from 680–960px
(the 525px section height times the source ratio), and viewport/height-based `cover` above 960px.
The largest candidate retains the source width, avoiding invented detail at very high DPRs.
Width/height attributes retain 2752:1536; the positioned image cannot change the section's layout.
The original gradients and desktop/phone/tablet positioning remain in CSS. Empty alt text is
intentional: the illustration is decorative, and the logo link already says “KendoMenu home”.

A Chromium Largest Contentful Paint observer at 1440×900, 393×851, and 768×1024 identified the
hero image as the final LCP candidate on each viewport. It alone receives eager/high-priority
loading. This confirms prioritization, not a claim of improved field LCP timing.

## Visual and responsive verification

Baseline/after screenshots and DOM measurements were taken with Chromium in clean contexts:

| Viewport / DPR | Header before → after | Hero section before → after | Selected AVIF after |
| -------------- | --------------------- | --------------------------- | ------------------- |
| 1440×900 / 1   | 88×44 → 88×44         | 1440×828 → 1440×828         | Logo 88; hero 1920  |
| 393×851 / 2.75 | 88×44 → 88×44         | 393×525 → 393×525           | Logo 264; hero 2752 |
| 768×1024 / 2   | 88×44 → 88×44         | 768×525 → 768×525           | Logo 176; hero 1920 |

The footer frame remains 44×22. Desktop selected image bytes fall from 3,245,503 to **25,302**;
phone DPR 2.75 selects **35,548** bytes. These figures exclude the separately loaded footer and
PWA install downloads. Browser tests verify source ordering, selected AVIF, decoded WebP/JPEG
fallbacks, image attributes, priority, no horizontal overflow, and the tablet cover crop. Visual
inspection preserved the artwork, crop, text placement, and layout; no branding redesign occurred.

## Build and precache measurements

Final build measurements are recorded after all changes below. Gzip compares the same Node
`zlib.gzipSync` default settings against production `dist/assets/*.js`; preview fixture builds are
excluded. Precache bytes sum the actual local file sizes for every unique URL in `dist/sw.js`,
including manifest icons and explicit includeAssets. The plugin's printed KiB summary excludes
some of those entries and is not the total used here.

| Metric                                        |    Before |     After |                               Change |
| --------------------------------------------- | --------: | --------: | -----------------------------------: |
| Production application JavaScript, raw bytes  |   462,283 |   465,451 |                               +3,168 |
| Production application JavaScript, gzip bytes |   129,746 |   130,658 |                         +912 (0.70%) |
| Actual complete PWA precache bytes            | 4,344,459 | 1,547,391 |                  −2,797,068 (64.38%) |
| Actual precache URL count                     |        12 |        34 | All 24 format/size variants included |

Vite's own compressed-size report was 130.99 kB → **131.89 kB** for application JavaScript;
the table uses the independently repeatable Node gzip measurement instead. The extra markup and
metadata add under 1 kB gzipped. The Workbox console summary was 3,680.93 KiB → **949.42 KiB**;
use the full manifest totals above for actual precache contribution. No preview test fixtures,
source originals, or social card are included in the measured production precache.

The social JPEG is **1200×630, 46,750 bytes**. It combines the established logo, navy/gold palette,
hero illustration, and existing landing-page wording; it was inspected at full size and thumbnail
scale. It is publicly served for link previews and deliberately excluded from the precache.
All responsive fallbacks are precached and tested offline; the original sources are neither
published nor included in the new precache. Existing installations may retain their old worker and
assets until the user accepts the existing update prompt and the new worker activates. Existing
PWA icons remain unchanged.

## Metadata and operations

The intentional origin is `https://www.kendomenu.com`; `/app` is the sitemap's sole discovery page.
The static HTML includes an absolute canonical link, Open Graph type/site/title/description/URL,
image URL/dimensions/alt, and Twitter large-image card/title/description/image/alt. Description and
theme metadata have no conflicting duplicates. Route indexing and recovery handling are covered by
focused tests; this SPA still has a shared HTML response for non-JavaScript crawlers.

A public GET to `https://www.kendomenu.com/.git/config` on 2026-09-08 returned HTTP 200 and a
1,281-byte HTML app shell, with no Git configuration sections. This is an observed soft 404, not a
repository-file exposure. No blocking rules, rewrites, or status changes were added. The
[deployment runbook](../runbooks/DEPLOYMENT.md) records this evidence and the canonical decision,
provides an explicitly unexecuted owner-verification-required rollback procedure, and lists owner
checks for MFA, recovery codes/methods, domain renewal/payment/contacts/lock/expiry, and account
control. All external settings remain owner verification required.

## Changed files

- Image delivery: `apps/web/src/components/{AppShell,BrandLockup,SiteFooter}.tsx`,
  `apps/web/src/features/landing/LandingPage.tsx`, `apps/web/src/styles.css`, and
  `apps/web/vite.config.ts`.
- Production assets: 24 responsive files and `kendo-menu-social.jpg` under
  `apps/web/public/assets`; the two original JPEGs moved to `assets/source`, with the social SVG
  overlay and regeneration README beside them.
- Metadata: `apps/web/index.html`, `apps/web/public/{robots.txt,sitemap.xml}`,
  `apps/web/src/lib/route-metadata.ts`, `apps/web/src/app/app-route-components.tsx`,
  `apps/web/src/features/errors/AppErrorBoundary.tsx`, and
  `apps/web/src/features/persistence/PersistenceGate.tsx` (metadata only).
- Tests: `apps/web/src/lib/route-metadata.test.ts`,
  `apps/web/src/test/app.integration.test.tsx`, and
  `apps/web/e2e/{accessibility,app,images,metadata,pwa}.spec.ts`.
- Documentation: this report, `docs/runbooks/DEPLOYMENT.md`, the
  `docs/work-sessions/2026-09-08-production-polish.md` handoff, and the history index.

## Verification

| Check                         | Status  | Evidence                                                                                                                                                             |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:web`              | PASS    | Initial package gate: 145 tests plus typecheck, lint, and production build; final web changes covered again by the release gate (158 tests).                         |
| `pnpm test:e2e:preview`       | PASS    | 149 passed; 3 expected platform skips.                                                                                                                               |
| `pnpm test:e2e:pwa`           | PASS    | 4 passed, including every responsive format/width fetched offline.                                                                                                   |
| `pnpm verify:full`            | PASS    | Exit 0; session policy, typecheck, lint, format, 289 unit tests (63 domain / 68 store / 158 web), production build, 149 preview tests with 3 skips, and 4 PWA tests. |
| Independent semantic review   | PASS    | Image crop/delivery, canonical allowlist, recovery metadata, PWA output, and operational documentation reviewed; findings addressed.                                 |
| Diff and debug-log checks     | PASS    | `git diff --check`; no debug logs or debugger statements in changed product code.                                                                                    |
| Dependency audit              | SKIPPED | No dependency/lockfile changes; network vulnerability audit was outside this focused pass.                                                                           |
| External operational controls | SKIPPED | No deployment or account changes; rollback and continuity settings require owner verification.                                                                       |

The first complete preview run found the existing tablet test still asserting the removed CSS
background property. The assertion now checks actual cover geometry at 680/800/960px; the full
rerun and final release gate both passed. Recovery metadata was added to both fallback surfaces
following independent review. The final gate's production output was remeasured and matched the
byte table exactly. Work-session history records the completed pass.

Ready for commit: **YES**. This is code readiness, not authorization to deploy or change external
settings.
