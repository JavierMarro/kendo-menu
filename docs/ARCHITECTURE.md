# KendoMenu architecture

KendoMenu is a React/Vite single-page web app with a platform-neutral domain package and a
Zustand store. Its core workflow is local-first: a practitioner can plan, adapt, and save a
session in the browser without an account, server, or network dependency.

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

The web [`training-persistence.ts`](../apps/web/src/lib/training-persistence.ts) adapter wraps
`window.localStorage` under the `kendo-menu` key, catches browser read/write/remove failures, and
maps store inspection into UI states. [`PersistenceGate.tsx`](../apps/web/src/features/persistence/PersistenceGate.tsx)
chooses local storage, exposes recovery/reset/backup actions, or explicitly falls back to an
in-memory session. Local data is origin-specific and is not a server backup or cross-device sync.

[`ApplicationRecovery.tsx`](../apps/web/src/features/errors/ApplicationRecovery.tsx) keeps an error
boundary outside the router and inside the persistence gate, preserving the live store when the
application fails. A second boundary protects the gate itself. The fallback offers reload and,
when the gate remains available, access to the existing recovery screen. Explicitly copied
diagnostics contain only the fixed `KENDOMENU_UNEXPECTED_UI_ERROR` code and a boolean recovery
availability flag; they never consume exceptions, storage, URLs, or training state.

## Web, hosting, and external boundaries

[`app-routes.tsx`](../apps/web/src/app/app-routes.tsx) uses React Router for `/app` (landing,
dashboard, library, library details, custom-session creation, sources, and an app not-found route),
`/cookies`, and a top-level not-found route. `/` redirects to `/app`; direct refreshes rely on the
hosting fallback.

The root [`vercel.json`](../vercel.json) runs `pnpm build` and serves `apps/web/dist`. The Job 3
checkout adds API dispatch before the existing SPA fallback to `/index.html`, retaining static
file precedence. Combined Vercel function discovery and routing remain unverified; this configuration
change has not been deployed. The existing production observations are recorded in the deployment
runbook.

[`vite.config.ts`](../apps/web/vite.config.ts) uses `vite-plugin-pwa` to generate the manifest and
service worker. The manifest starts at `/app`, has `/` scope, and requests standalone display. The
Workbox navigation fallback is limited to the app's supported document paths and its cache is
independent of LocalStorage. Installation is prompt-based; the service worker is an asset/navigation
boundary, not a data-sync or backup system.

[`index.html`](../apps/web/index.html) is the only analytics integration boundary: it loads the
external GoatCounter document script for cookie-free aggregate document-load statistics. There is
no SPA route or custom-event analytics pipeline, and training plans, notes, and menu names are not
intentionally sent to GoatCounter. Analytics availability is therefore separate from the local
planning workflow.

## Current production exclusions

There is no production server API, account system, remote sync, database, paid tier, or initialized
mobile app. `apps/mobile` remains a reserved boundary and `packages/ui` remains reserved for genuinely
shared platform-neutral UI.

For the original recursive-model decision, see [ADR 0001](./adr/0001-recursive-training-activities.md).

## Local API scaffold and accepted later architecture

Optional accounts and synchronization are now an approved product direction, but the production
behavior above still has no account, application-session, API, database, or synchronization
implementation. The accepted decisions are [identity and application sessions](adr/0002-identity-application-sessions.md),
[workspace separation and guest adoption](adr/0003-workspaces-guest-adoption.md), and
[whole-dashboard synchronization](adr/0004-whole-dashboard-sync.md).

The Job 3 local scaffold puts Elysia application behavior in `apps/api`, with separate standalone
Node and minimal root Vercel function adapters. The `createApp()` interface handles standard Requests
without starting a listener. Only health and JSON errors exist; no frontend integration, domain/store
dependency, database, or authentication is introduced. Node 24 is the declared target; the local
runtime remains Node 25. See [ADR 0005](adr/0005-node-elysia-api-foundation.md).

In the later target, the web workspace module selects isolated guest/account
stores; the synchronization module exchanges validated whole dashboards with the backend over a
same-origin interface. Domain validation remains platform-neutral. Injected storage is still a
local persistence seam, not a replacement for revision checks, acknowledgements, or retries.

The [account and synchronization design](ACCOUNT_SYNC.md) distinguishes owner-approved decisions,
accepted technology, unapproved behavior/operational recommendations, mandatory correctness/security
requirements, and later implementation gates.
The existing local JSON limit counts 2,097,152 JavaScript UTF-16 code units, not network bytes;
cloud transport limits must be evaluated separately. No production routing or runtime compatibility
is claimed from this proposed diagram:

```text
Browser workspace → local store/storage
        └→ synchronization → same-origin /api/* → Vercel adapter → backend application → PostgreSQL
                                                        local Node adapter ─┘
```
