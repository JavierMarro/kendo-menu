# KendoMenu architecture

KendoMenu is a React/Vite single-page web app with a platform-neutral domain package and a
Zustand store. Its core workflow is local-first: a practitioner can plan, adapt, and save a
session in the browser without an account, server, or network dependency.

## Managed-auth transition status

[ADR 0007](adr/0007-managed-auth-online-account-drafts.md) records the approved managed-auth and
online-account replacement. [Migration A](MANAGED_AUTH_PROOF.md) provides isolated callback-only
session bootstrap, a fresh document and subsequent token-only retrieval. Single-account identity,
reload/JWT-refresh and storage checks have owner-reported passes. [Migration B](MANAGED_DASHBOARDS.md)
provides managed bearer authorization, internal account mapping and PostgreSQL dashboards.
[Migration C](MANAGED_ACCOUNT_WEB.md) consumes that contract with separate guest/account routes and
memory-only explicit account saves. Legacy browser account cache/synchronization modules are retired;
legacy SQL/auth/adoption rows stay preserved without linking to managed identities.
[Migration D](MANAGED_GUEST_COPY.md) adds the one-use guest-copy setup screen. Live B persistence and second-account/return-to-first validation remain
NOT RUN public-release gates in the historical October 13 checklist. The owner later reported
two-account Preview checks and a production release on October 18; see the
[deployment runbook](runbooks/DEPLOYMENT.md) for the current evidence boundary. The
[transition contract](MANAGED_AUTH_TRANSITION.md) owns the implementation scope.

### Managed account API boundary

The Node and Vercel adapters share listener-free Elysia composition and one lazy PostgreSQL pool.
Health/import/build do not connect to the database. The dedicated managed verifier binds EdDSA
JWT signature, issuer, audience and expiry to the configured Neon branch. Explicit bearer
credentials establish managed identity; cookies and browser identity fields never authorize it.
Account initialization maps provider/issuer/subject uniquely to a generated internal UUID and
creates its one-time random copy opportunity in the same transaction. Email is nullable verified
metadata. Inspection creates nothing and never reissues an opportunity.

Protected dashboard and adoption operations carry an internally branded account proof. Missing
mapping returns `409 ACCOUNT_NOT_INITIALIZED`. Mutation authorization checks exact configured
Origin before reading a body. Complete bounded v10 validation, workspace mismatch guards,
optimistic revisions and ordinary Save receipts remain. SQL mutations serialize on the account
first and recheck JWT expiry after waits and before completion; no custom session locks, activity
updates, CSRF cookies or application-token issuance remain in runtime composition.

The copy opportunity contains only ID, consumption and outcome metadata. Valid Yes/No consumption
commits before a Yes copy starts its second transaction. That transaction reacquires the account
lock and requires no existing dashboard and revision zero, so an intervening ordinary Save cannot
be overwritten. Success acknowledges a committed whole snapshot/outcome. Failure or uncertain
copying leaves consumption final and ordinary account access available; there is no copy replay
or recovery journal. Guest LocalStorage remains independent. See the
[B contract and owner-run checklist](MANAGED_DASHBOARDS.md) for frontend integration and gates.

## Boundaries and flow

These are different relationships:

```text
Code imports:  apps/web ──→ packages/store ──→ packages/domain
                   └─────────────────────────→ packages/domain

Curated data: default-drills.json ──→ domain validation/adaptation ──→ web library UI
                                                  └─→ store snapshots/persistence ──→ dashboard UI
```

The web package owns routes, React components, browser APIs, and presentation helpers. The store
package owns dashboard actions and persistence orchestration, but receives its storage boundary by
injection. The domain package owns contracts, validation, traversal, quantity policy, and curated
data adaptation. The domain package does not depend on the store or the web app.

## Domain model and ownership

[`TrainingActivity`](../packages/domain/src/types.ts) is the canonical recursive runtime node. Each
node has a stable `id`, a name, optional quantities/metadata, and ordered `children`; an empty child
collection makes it a leaf exercise. Depth-first traversal preserves authored order. A
[`TrainingSet`](../packages/domain/src/types.ts) has its own stable ID and an ordered activity tree.

Curated sessions are authored as [`default-drills.json`](../packages/domain/data/default-drills.json),
where source nodes call their children `exercises`. The runtime model calls them `children`; the
source-only shape is intentionally not used as the runtime contract. Built-ins are immutable,
deep-frozen values marked `isBuiltIn: true`. User-authored sessions use the same runtime model,
are marked `isBuiltIn: false`, and are available through the dashboard rather than the curated
library.

A [`DashboardEntry`](../packages/domain/src/types.ts) is the selected session plus dashboard-owned
adaptation. Quantity overrides are keyed by activity ID and then unit; activity notes are keyed by
activity ID. Dashboard actions therefore change the entry, not a curated default. Custom sessions
are stored as dashboard-owned snapshots: the v10 wire format embeds the custom snapshot with the
entry, so entries do not depend on a shared mutable custom-set collection. Built-in entries are
canonicalized from the immutable defaults when loaded.

## Curated data and validation

The [`kendo-drills.schema.json`](../packages/domain/schema/kendo-drills.schema.json) is the strict
Draft-07 source contract for the recursive `sections`/`exercises` JSON. The current workspace does
not declare a Draft-07 validator dependency; runtime checks are performed by
`validateCuratedDrills` and `validateTrainingSet` in [`types.ts`](../packages/domain/src/types.ts),
while domain tests assert the schema recursion contract and exercise the validator with valid and
invalid fixtures.

[`default-training-sets.ts`](../packages/domain/src/default-training-sets.ts) validates the imported
JSON, maps `sections`/`exercises` to `activities`/`children`, derives the built-in category, freezes
the set and every nested value, and asserts the researched collection counts. The store applies the
same validation boundary to custom builder input, generates set/section/exercise/dashboard IDs, and
validates the resulting runtime set before it is exposed.

## Store and browser persistence

[`packages/store/src/index.ts`](../packages/store/src/index.ts) creates a Zustand store with
`createTrainingStore({ storage, storageKey, onHydrationError })`. Zustand `persist` is configured
with the injected `StateStorage`, a custom JSON storage adapter, the migration function, a v10
partialized state, and a merge that accepts only validated current state. Sync and async injected
storage are supported by the corresponding store factories.

[`packages/store/src/persistence.ts`](../packages/store/src/persistence.ts) treats persisted JSON as
untrusted. The current persisted version is **10**. It parses an envelope, validates bounded state,
migrates older versions in order, and serializes the same v10 representation used by storage writes.

The 2026-09-02 hardening is part of this boundary:

- Domain-shape limits for arrays, records, strings, activity count, and nesting depth are centralized
  in `TRAINING_DATA_LIMITS`; persistence separately owns the 2 MiB raw serialized-JSON ceiling. Both
  boundaries reject oversized input before unbounded work.
- Public validators, parsers, classifiers, and storage inspection are exception-safe at hostile
  getter/proxy, malformed-input, and browser-availability boundaries; migration and action APIs
  reject invalid input explicitly rather than returning partial state.
- Encoding and storage use the same v10 validation and serialization path, including a raw-size
  preflight. Store actions preflight the candidate before returning a new state, so rejected
  validation/size actions leave the in-memory state and storage unchanged.
- Custom snapshots retain a two-level wire shape (`sections` containing `exercises`) even though
  the runtime contract is recursive. Unsupported custom nesting is rejected with an exception;
  it is never silently truncated. Browser write failures are surfaced to the web persistence UI,
  and the adapter stops further writes after a failure. The live state remains usable for the
  session and can be explicitly downloaded through the same validated v10 serializer.

### Ordered migration chain

`migratePersistedTrainingState` composes every applicable step; it does not jump directly from an
old shape to v10:

| Step     | Migration purpose                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| v0 → v1  | Validate the original legacy state shape.                                                                                        |
| v1 → v2  | Wrap legacy flat steps in a generated section.                                                                                   |
| v2 → v3  | Add the legacy quantity collection to each step.                                                                                 |
| v3 → v4  | Convert `repOverrides` to activity/unit-keyed quantity overrides.                                                                |
| v4 → v5  | Adapt legacy sections/steps into recursive runtime activities.                                                                   |
| v5 → v6  | Merge the corrected International Uchikomi overrides and convert the known seconds-to-minutes duration; conflicting values fail. |
| v6 → v7  | Remove obsolete activity overrides and normalize the affected Police dojo activity.                                              |
| v7 → v8  | Normalize the corrected Top University activity and its seconds-only overrides.                                                  |
| v8 → v9  | Add activity-note maps to dashboard entries.                                                                                     |
| v9 → v10 | Move shared custom sets into dashboard-owned snapshots and canonicalize referenced built-ins.                                    |

The exact legacy IDs and conflict rules remain in the migration source of truth above; future
shape changes must add a new ordered migration rather than rewriting historical steps.

The guest [`training-persistence.ts`](../apps/web/src/lib/training-persistence.ts) adapter wraps
`window.localStorage` under the `kendo-menu` key, catches browser read/write/remove failures, and
maps store inspection into UI states. [`PersistenceGate.tsx`](../apps/web/src/features/persistence/PersistenceGate.tsx)
chooses local storage, exposes recovery/reset/backup actions, or explicitly falls back to an
in-memory session. Guest data is origin-specific and is not a server backup or cross-device sync.

[`ApplicationRecovery.tsx`](../apps/web/src/features/errors/ApplicationRecovery.tsx) keeps a global error boundary outside the router. Its guest-specific wrapper owns the guest
persistence gate and an inner boundary, preserving the live guest store when an editor fails. A
second guest boundary protects recovery itself; public/account routes mount no guest store. The fallback offers reload and,
when the gate remains available, access to the existing recovery screen. Explicitly copied
diagnostics contain only the fixed `KENDOMENU_UNEXPECTED_UI_ERROR` code and a boolean recovery
availability flag; they never consume exceptions, storage, URLs, or training state.

## Web, hosting, and external boundaries

[`app-routes.tsx`](../apps/web/src/app/app-routes.tsx) uses React Router for `/app` (landing),
separate `/app/guest/*` and `/app/account/*` workspace trees, shared sources, `/cookies`, and
not-found routes. Workspace trees reuse dashboard, library/details and custom-session creation. `/` redirects to `/app`; direct refreshes rely on the
hosting fallback.

The root [`vercel.json`](../vercel.json) runs `pnpm build` and serves `apps/web/dist`, with API
dispatch before the SPA fallback to `/index.html` and static-file precedence retained. The build
first emits `apps/api/dist/index.js` using a separate Vite server config; the API and domain/curated
JSON are bundled, and third-party server dependencies stay external. The API package resolves source
for types/development and emitted JavaScript for deployment. No credentials are embedded or database
connection opened by this build. Native-Node artifact verification is separate from live Vercel
function and HTTPS validation; the deployment runbook records that boundary and production evidence.

[`vite.config.ts`](../apps/web/vite.config.ts) uses `vite-plugin-pwa` to generate the manifest and
service worker. The manifest starts at `/app`, has `/` scope, and requests standalone display. The
Workbox navigation fallback is limited to the app's supported document paths and its cache is
independent of LocalStorage. Installation is prompt-based; the service worker is an asset/navigation
boundary, not a data-sync or backup system.

The browser analytics gate sends one GoatCounter image request per document only after managed
identity checking confirms signed out. Verified accounts, unresolved identity and offline state
send no analytics. Its `/count?p=...` request uses a static route allow-list, drops query strings
and referrer data with `no-referrer`, and carries no account or training content. It loads no
GoatCounter JavaScript. Ordinary request metadata such as IP address and user-agent still reaches
GoatCounter. It does not attempt continuing guest-only tracking across tabs.

## Production status and platform boundaries

The managed account routes and API are implemented. The owner reports that the release reached
production on 2026-10-18; this document does not independently verify live application behavior.
See the [deployment runbook](runbooks/DEPLOYMENT.md) for owner-reported and read-back evidence.
There is no native mobile application: the responsive web app and installable PWA cover mobile use.
`packages/ui` remains reserved for genuinely shared platform-neutral UI.

For the original recursive-model decision, see [ADR 0001](./adr/0001-recursive-training-activities.md).

## Local API and managed persistence

Migration B implements the managed account server replacement approved by
[ADR 0007](adr/0007-managed-auth-online-account-drafts.md), preserving
independent dashboards and whole-dashboard atomic writes while retiring application sessions and
copy recovery. The older auth/synchronization ADRs describe superseded decisions.

Elysia application behavior lives in `apps/api`, with a standalone Node listener and a minimal
root Vercel adapter. `createApp({ account, dashboard, adoption })` handles standard Requests without
starting a listener. `createRuntimeServices()` composes managed authorization and all three
services around a single lazy PostgreSQL provider. Only root Vercel composition attaches the pool
through its lifecycle helper. PostgreSQL clients and transactions remain behind persistence ports.
Explicit migration commands live under `apps/api/src/database`, and reviewed SQL, snapshots and
journal live under `apps/api/drizzle`. Runtime requests never migrate the database. Unit tests and
guarded schema-isolated local PostgreSQL tests remain separate commands. Node 24 is the target.

### Dashboard transport and storage

The platform-neutral [domain codec](../packages/domain/src/dashboard-persistence.ts) owns strict
v10 dashboard wire DTOs. Store aliases preserve existing imports, local migrations and serialization.
Node-compatible relative imports and JSON import attributes support both API NodeNext and web
bundler configurations. Neither React nor Zustand enters the API.

The [dashboard handler](../apps/api/src/dashboard/dashboard.ts) applies method/header rejection,
managed authorization, bounded strict JSON parsing, lossless domain validation and canonical hashing
before calling the [persistence port](../apps/api/src/persistence/dashboard-contracts.ts).
GET/PUT and adoption POST are registered; mutations disable Elysia automatic parsing so authorization
precedes body acquisition. Stored snapshots and acknowledgements are validated before serialization.

The [managed dashboard adapter](../apps/api/src/persistence/postgres/managed-dashboard-adapter.ts)
stores canonical complete snapshot text in `cloud_dashboards` and bounded ordinary Save
acknowledgements in `dashboard_write_receipts`. The account-first lock serializes revisions and
receipts with copy consumption. Retained identical request IDs return their original acknowledgement
before current catalogue/revision checks. New writes commit snapshot, receipt, receipt cleanup and
unused-opportunity invalidation together. Uncertain COMMIT outcomes return unavailable; the identical
ordinary Save request recovers its retained receipt. Copying has a separate consume-then-copy flow,
without replay/recovery, described in the [managed account contract](MANAGED_DASHBOARDS.md).

The historical [Job 5A foundation](DASHBOARD_FOUNDATION.md),
[Job 5B persistence evidence](DASHBOARD_PERSISTENCE.md) and [Job 6A adoption handoff](ADOPTION.md)
retain predecessor evidence. Their session locks, activity touches, CSRF and pending-copy recovery
are superseded server behavior; applied migration history and legacy records remain preserved.

### Browser workspace boundary — Migration C

The dispatcher resolves proof/application root returns before ordinary app imports. A bounded,
credential-free per-tab flow marker chooses only fixed callback destinations. The proof remains
isolated; application bootstrap uses the proven fresh-document exchange before entering account
routes. The managed auth provider performs bounded token-only identity verification and fences
superseded requests. No `/api/session`, custom OAuth or application CSRF cookie remains in browser
runtime. Vite's local exact-path proxies preserve browser Origin and B's validation.

The browser [API client](../apps/web/src/lib/account-api.ts) validates strict bounded UTF-8 account
and complete dashboard responses, account/revision/receipt binding and catalogue compatibility.
The [account draft controller](../apps/web/src/lib/account-draft.ts) injects memory storage into the
existing Zustand factory only after validated loading. Each account route lifetime owns its store;
guest routes own an independent persistence provider. Shared UI reads the selected workspace.

A Save freezes the complete envelope and records the submitted baseline. Matching acknowledgement
advances only that baseline/revision, preserving later edits as dirty. Ambiguous requests remain
immutable for identical retry. Conflicts retain the draft for download or explicit reload.
Unavailable service disables editing without a durable offline queue. Authentication uncertainty
hides content and fences late operations; only explicit same-account verification can reveal the
current tab's original retained draft. Sign-out, identity change and confirmed exit dispose it.
No legacy account LocalStorage/IndexedDB cache is read, deleted or uploaded.

Guest Web Locks/read-back and LocalStorage recovery remain. The only auth flow persistence is the
finite credential-free callback marker; credentials, identities, drafts and copy opportunities stay
out of JavaScript-readable persistence. D uses C's validated in-memory creation handoff for a
separate guarded setup route. Eligibility also requires the matching verified account, B's eligible
cloud dashboard and a complete valid non-empty guest snapshot within the full request byte limit.
Yes rechecks the exact source under the guest lock; changes refresh the offer before dispatch.
Either dispatch or abandoning/skipping setup releases the handoff without a journal or implicit No.
Strict adoption acknowledgements precede any success claim; unconfirmed attempts cannot replay.
A fresh validated cloud load precedes editing after either decision or uncertainty. Stale setup
visits do not replace existing drafts. A committed ordinary Save also releases the handoff.
See [Migration C](MANAGED_ACCOUNT_WEB.md) for the state/event table, local startup, retirement and
verification limits. Historical synchronization ADRs/handoffs retain predecessor evidence.
