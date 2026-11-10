# Pass 0 — Data flows and transport inventory

Source trace for this checkout. This describes intended effects of the paths found in code.
It is not a test of the paths or a claim about the deployed site.

## Guest edit, persistence, migration and recovery (1, 6)

- [Guest route](../../apps/web/src/app/app-routes.tsx#L57) → [guest workspace](../../apps/web/src/features/persistence/GuestWorkspaceRoute.tsx)
  and [persistence gate](../../apps/web/src/features/persistence/PersistenceGate.tsx). Builder
  form data stays in React until submit. [Create/edit](../../apps/web/src/features/custom-sets/CreateDrillPage.tsx#L206)
  validates it with [builder state](../../apps/web/src/features/custom-sets/builder-state.ts);
  [curated Add](../../apps/web/src/features/library/DrillDetailContent.tsx#L67) selects the
  catalogue entry. [Dashboard](../../apps/web/src/features/dashboard/DashboardPage.tsx) applies
  notes, quantity overrides, removal/undo and detail changes to the selected store. IDs and
  notes for retained activities travel with the edit; cancel leaves the prior store entry.
- The [store](../../packages/store/src/index.ts#L755) owns snapshots, identifiers and action
  validation. It checks the candidate before accepting it. Zustand serializes the v11
  `{state, version}` envelope through the [persistence module](../../packages/store/src/persistence.ts#L2584).
  The [browser adapter](../../apps/web/src/lib/training-persistence.ts#L260) writes `kendo-menu`
  in LocalStorage, compares the known baseline and checks read-back, coordinating mutations
  with [Web Locks](../../apps/web/src/lib/workspace-coordination.ts) when available. Builder and
  library Add await guest flush. A memory mutation alone is not a confirmed device save.
- On mount/reload, inspect raw data before hydration; accepted older versions migrate through the
  ordered chain (including v10 → v11). Missing data starts empty; corrupt, future-version or
  inaccessible data uses the recovery UI instead of being replaced silently. Write failures retain
  the current in-memory store and expose retry, current backup and session-only continuation.
  [Recovery actions](../../apps/web/src/features/persistence/PersistenceGate.tsx#L275) include
  raw/current export and deliberate coordinated reset; recovery export is a local download, not
  a cloud backup. [Guest route/error guards](../../apps/web/src/features/errors/ApplicationRecovery.tsx)
  keep recovery available across render errors and guard leaving live work via the workspace.
- No menu API or database writes on these paths. The global auth provider can check identity
  independently; entering sign-in is not a guest upload.

## Authentication and account identity (2)

- [Sign-in](../../apps/web/src/features/account/SignInPage.tsx) → [SDK wrapper](../../apps/web/src/lib/managed-auth.ts#L38)
  → Google via Neon with a bounded per-tab flow marker and fixed return. The
  [dispatcher](../../apps/web/src/auth-dispatcher.ts) resolves returns before ordinary SPA imports;
  [callback entry](../../apps/web/src/features/auth-callback/entry.tsx) runs callback-only SDK
  session bootstrap, then replaces the document with a verifier-free account route. Ordinary
  account requests obtain an SDK token and send it as bearer; SDK session cookies are a separate
  provider mechanism. Inspect the pinned SDK path and lifecycle for actual storage behavior.
- [Identity provider](../../apps/web/src/features/account/ManagedAuthProvider.tsx#L44) uses
  account inspection on boot, focus, pageshow and peer hints. Unknown/superseded identity is
  fenced; workspace data is hidden until same-account verification, or disposed on account switch
  or sign-out. Provider sign-out may fail and keep access hidden. An anonymous or uninitialized
  identity is distinct from service failure.
- [JWT verification](../../apps/api/src/auth/managed-identity.ts) binds signature, issuer, audience,
  role and expiry. [Authorization](../../apps/api/src/auth/account-authorization.ts) resolves
  issuer/subject to a local UUID and issues the internal proof; verified email is display metadata.
  Origin checks protect writes. A browser ID, managed cookie alone, or a cross-tab hint grants
  no access. Inspect account rechecks/identity epoch guards in the callers and adapters.

## Account initialization, load, edit, explicit Save and reload (2, 3)

- [Account route](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx#L42)
  sends empty `POST /api/account` only on the verified-but-unmapped path. The
  [account handler](../../apps/api/src/account/account.ts) authorizes before accepting the request;
  [account adapter](../../apps/api/src/persistence/postgres/managed-account-adapter.ts) maps the
  identity and creates a copy opportunity atomically for the winning initialization. The response
  includes a volatile handoff only on creation; inspection creates nothing and does not reissue it.
- [Load/reload](../../apps/web/src/lib/account-draft.ts#L278) verifies account then GETs the
  dashboard. Server reads the owner's saved row, revalidates its canonical data/catalogue and
  returns a complete snapshot or null at revision zero. The [browser decoder](../../apps/web/src/lib/account-api.ts)
  bounds and validates the response and expected identity before a memory-only store is installed.
  Empty stays empty. Unavailable service/identity can disable or hide the workspace; reload
  requires discard confirmation when applicable and installs a draft from validated cloud data.
- Builder, dashboard and library edits use the same store actions as guest, with memory storage.
  Creating/editing a menu and committing quantity/note controls are draft actions. The workspace
  **Save to account** and expanded menu **Save your changes** use the same whole-dashboard save;
  no background flush or edit-triggered PUT. The [controller](../../apps/web/src/lib/account-draft.ts#L561)
  freezes and bounds the v11 JSON with expected account, revision, catalogue and request ID;
  it verifies identity again before PUT. [Server](../../apps/api/src/dashboard/dashboard.ts#L86)
  checks transport, origin/auth before body acquisition, and strict JSON/domain compatibility.
- [PostgreSQL compare-and-write](../../apps/api/src/persistence/postgres/managed-dashboard-adapter.ts#L236)
  locks the account first, checks the receipt/revision, and writes canonical dashboard, new
  receipt and unused-copy consumption in one transaction. The response is a small acknowledgement,
  validated against the submitted account, request ID and next revision. Only the submitted
  baseline becomes clean; newer edits remain dirty. No durable browser draft is created.
  Explicit backup is a download; refresh/close can lose unsaved edits.

## Save conflict, replay and lost acknowledgement (3)

A revision conflict keeps the draft and offers download or explicit reload; no automatic overwrite
or merge. If Save was sent but its outcome is unknown, the controller keeps the same envelope and
ID for explicit retry, with account/epoch checks, rather than minting a new request. The
[receipt lookup](../../apps/api/src/persistence/postgres/managed-dashboard-adapter.ts#L291) compares
the exact intent before ordinary new-write revision/version checks. A retained matching receipt can
acknowledge a prior commit even after another revision; a changed intent with the same ID is
rejected. New v10 writes cannot downgrade v11, but retained exact v10 replays are still supported.
Receipt retention is bounded ([policy](../../apps/api/src/dashboard/contracts.ts#L63)); replay is
not a permanent journal. Distinguish a failed transaction from lost commit/response confirmation.
Reject invalid acknowledgements and fence responses after identity/route disposal. Conflict,
blocked validation and uncertain outcomes are separate [controller states](../../apps/web/src/lib/account-draft.ts#L335).

## One-use guest copy and permanent decline (4)

[Setup](../../apps/web/src/features/account/AccountSetupPage.tsx) requires a matching verified new
account, live winning handoff, eligible authoritative empty dashboard and complete valid nonempty
guest data. [Snapshot acquisition](../../apps/web/src/lib/account-adoption.ts#L32) reads under the
guest lock, decodes/migrates in memory, and checks the Yes envelope size; Yes rechecks the exact
source before dispatch. It never writes guest bytes. Invalid/missing data or abandoned setup does
not send an implicit No.

Yes carries the whole snapshot at revision zero; No carries only decision and correlation fields.
The [handler](../../apps/api/src/adoption/adoption.ts) authorizes and validates the bounded body.
The [copy adapter](../../apps/api/src/persistence/postgres/managed-copy-adapter.ts) consumes the
opportunity before the separate Yes transaction, which reacquires account ownership and checks
that no intervening dashboard write won. No commits terminal decline without a dashboard write.
Success is a bound acknowledgement, followed by a fresh authoritative dashboard load. Dispatch
releases the handoff. A lost response, failed copy, or exit can consume/lose the chance; retry the
load, not the decision. No durable copy journal, later import button, or creating-session restriction.

## Sharing and adding a shared menu (5, 6)

- [Share it](../../apps/web/src/features/sharing/ShareMenuButton.tsx) is account/custom only. The
  controller selects the acknowledged entry and revision; the dialog requests link creation
  explicitly. The [server](../../apps/api/src/shares/shares.ts) accepts an entry reference and
  expected account/revision, not client menu content. The
  [adapter](../../apps/api/src/persistence/postgres/managed-shares-adapter.ts#L197) locks owner and
  saved dashboard, rejects missing/built-in/stale entries, projects note-free effective quantities
  with the [domain codec](../../packages/domain/src/menu-sharing.ts#L156), and inserts or reuses the
  canonical payload by owner/source/version/digest. Token acknowledgement follows the transaction.
  No save or revision advance. Retry with an unchanged saved revision can reuse the link; conflict
  or unavailable state preserves the draft. Copy link/Web Share are browser actions after creation.
- [Public route](../../apps/web/src/app/app-routes.tsx#L49) loads a validated opaque-token snapshot
  without account initialization or a guest store. A signed-in visitor may open the recipient
  route; a signed-out visitor can use a [bounded per-tab share return](../../apps/web/src/lib/share-return.ts)
  through auth and account setup. Missing/invalid token, failed fetch, aborted navigation or
  unavailable identity blocks import. The [hosted document](../../apps/web/shared-menu.html)
  adds static social metadata via the root Vercel adapter; it does not embed the snapshot.
- [Recipient route](../../apps/web/src/features/sharing/SharedMenuPage.tsx#L136) loads the
  authenticated projection with account binding and sender flag. **Add to dashboard** uses the
  loaded data locally: [import](../../apps/web/src/lib/account-draft.ts#L461) validates it,
  generates fresh IDs in a candidate store, preserves quantities, sets provenance for other
  senders, and preflights the complete Save before one live update. Failed import leaves the draft
  unchanged. It does not POST or write PostgreSQL. Ordinary explicit Save makes the editable copy
  durable; Shared filter/badge derive from v11 provenance. Source edits/removal leave hosted
  snapshots intact; local owner deletion cascades shares, and saved recipient copies are independent.

## Offline/PWA and browser integrations (6)

The [Vite Workbox config](../../apps/web/vite.config.ts#L58) precaches the app shell and uses a
navigation fallback; it excludes the hosted share HTML and declares no runtime API cache.
[Service-worker update UI](../../apps/web/src/components/ServiceWorkerUpdates.tsx) prompts before
activation/reload. A primed app shell plus guest LocalStorage supports offline guest work.
Account editing/save requires verified online service, and offline shared preview has no cached
payload guarantee. Map failure on cold load, warm offline reload, update/reload with dirty state,
and reconnect. Relevant APIs: LocalStorage, Web Locks, page lifecycle/navigation guards,
sessionStorage, connectivity events, clipboard/Web Share, and Blob downloads. No database
write follows a PWA, download, clipboard or navigation action by itself.

## Endpoint inventory for payload verification

Field names and triggers are from [browser transport](../../apps/web/src/lib/account-api.ts#L935)
and [Elysia registrations](../../apps/api/src/app.ts#L75). JSON except where noted; no-store success
responses for protected/menu data. “Per trigger” describes the call sites, not a measured network
count; a protected call also asks the managed SDK for a bearer.

| Endpoint                                                | Trigger / expected frequency                                                                    | Request → success response                                                                                                                                                                  | Pass |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `GET /api/account`                                      | Boot/focus/pageshow/peer identity checks, plus preflight verification for controller operations | No body → `accountId, email`                                                                                                                                                                | 2, 3 |
| `POST /api/account`                                     | Unmapped managed identity entering account route; retry on verification path                    | Empty → `accountId, email, created`, optional `copyOpportunityId`                                                                                                                           | 2    |
| `GET /api/dashboard`                                    | Initial load, explicit reload/reconnect recovery, authoritative refresh after copy attempt      | No body → transport version, account workspace ID, catalogue, revision, nullable timestamp and complete dashboard                                                                           | 3, 4 |
| `PUT /api/dashboard`                                    | Explicit dirty Save or exact retry                                                              | Transport version, expected account/revision, request ID, catalogue version, full v10/v11 dashboard (current client v11) → transport version, account, request ID, new revision, timestamp  | 3    |
| `POST /api/dashboard/adoption`                          | Explicit Yes/No, no client replay                                                               | Version, decision, expected account, opportunity ID and request ID; Yes adds zero revision, catalogue and full snapshot → accepted completion + save acknowledgement, or decline completion | 4    |
| `POST /api/shares`                                      | Explicit Create sharing link / retry                                                            | `expectedAccountWorkspaceId, expectedRevision, entryId` → `token, sourceRevision, accountWorkspaceId`                                                                                       | 5    |
| `GET /api/shares/:token`                                | Public preview mount/token change                                                               | Token in path; no body/bearer → `snapshot`                                                                                                                                                  | 5    |
| `GET /api/shares/:token/recipient`                      | Recipient route after verified account load, or token/identity change; Add uses loaded data     | Token in path; bearer, no body → `snapshot, isSender, accountWorkspaceId`                                                                                                                   | 5    |
| `GET/HEAD /app/shared/:token`                           | Direct browser/preview crawler visit to hosted share URL                                        | Token in path → HTML with metadata (HEAD has no body); API JSON follows only in browser                                                                                                     | 5, 7 |
| Managed SDK / Google / JWKS                             | Sign-in, callback bootstrap, per protected token acquisition, sign-out, verifier key lookup     | SDK exchanges/cookies and JWT verification; measure local synthetic call counts only, no real credentials or provider traffic                                                               | 2    |
| `GET/HEAD /api/health`; `GET /api/dev/managed-identity` | Health probes; isolated dev proof only                                                          | Status/empty HEAD; synthetic verified identity on proof route; no dashboard or share transfer                                                                                               | 2, 7 |

The raw guest limit is 2,097,152 JavaScript string code units. API dashboard/copy request cap is
2,097,152 UTF-8 bytes including the envelope; response limits differ. These are code limits,
not measured payload sizes. Measure actual encoded bytes and calls in the owning passes, including
public → recipient repeated snapshots, token/identity preflights, lost-ack retry, and small/multi-byte
near-limit fixtures. Distinguish application bytes from compressed network bytes and hosting limits.
