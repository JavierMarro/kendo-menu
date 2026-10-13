# Migration C — guest routes and online account drafts

Migration C consumes the reviewed Migration B contract from
`629d2b0edb6c1b152d6ee47d45d4b32ad4664eaf` on `codex/managed-auth-online-dashboard`.
This is internal browser integration, not a public account release. Backend contracts, SQL,
dependencies and remote configuration are unchanged. [Migration D](MANAGED_GUEST_COPY.md) now
extends this baseline with the separate one-use guest-copy setup screen.

## Routes and store lifetimes

`/app` offers Continue as a guest and Continue with Google. Each enters its dashboard. Separate
`/app/guest/*` and `/app/account/*` trees contain dashboard, library, library detail, drills and
custom-menu creation. Legacy unscoped app links redirect to guest destinations; a verified
signed-in visitor is redirected to the equivalent account destination. The shell provides the
selected workspace's dashboard shortcut. Shared dashboard/library/builder components receive the
workspace provider; an open editor never has its store swapped to another workspace.

Guest routes use the existing injected Zustand/LocalStorage store, `kendo-menu` key, validation,
Web Lock/read-back and recovery behavior. Guest use remains available when authentication cannot
be checked, including offline. Unresolved identity does not authorize analytics.

Account routes require server-verified identity and validated account/dashboard responses before
constructing the existing store factory with memory storage. A null dashboard produces an empty
store. Account drafts, identity, creation responses and copy opportunities are never written to
LocalStorage, SessionStorage or IndexedDB. Existing legacy account caches are ignored, without
deletion, migration or upload.

## State and event exits

| State / event                         | Observable behavior and exit                                                                                                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guest route access                    | Local workspace works while identity is checking or unavailable; verified sign-in redirects to the matching account route.                                                                                        |
| Account route access                  | Checking/unavailable identity hides account content and offers explicit retry or guest/home exit; signed out requires Google entry. Verified uninitialized identity can initialize through B.                     |
| Dashboard loading fails               | No guessed menus or unvalidated store; explicit retry. A previously loaded draft survives a failed reload. Failed identity verification hides it.                                                                 |
| Ordinary Save                         | Freeze one complete account/revision/catalogue/request-ID envelope; no background upload. A committed matching acknowledgement advances the revision and baseline for that snapshot only.                         |
| Edits during Save                     | The submitted snapshot is immutable; later edits remain in the live draft and remain dirty after acknowledgement.                                                                                                 |
| Ambiguous Save response               | Keep the original request unresolved; Retry the same Save resubmits the identical ID/envelope. Download or explicitly reload after a discard warning.                                                             |
| Revision conflict                     | Preserve draft and original revision; offer download and explicit reload. No automatic overwrite or merge; ordinary Save stays blocked until reload.                                                              |
| Offline / storage service unavailable | Retain this tab's draft, show read-only content only while identity remains verified, and offer honest retry/download. Reconnection does not save or re-enable editing automatically.                             |
| 401 / unresolved identity             | Hide content immediately, abort and fence late results. Explicit verification of the same account may reveal this tab's original draft and unresolved Save; no dashboard replacement occurs during that recovery. |
| Provider sign-out / identity change   | Hide immediately, fence requests and release the old draft; completed sign-out returns home. A different verified account receives a fresh store.                                                                 |
| Intentional discard / closure         | Confirm discard before reload, sign-out or leaving the account workspace with unsaved work. State that reload/closure can lose it; browser leave warnings are best effort.                                        |

Account edits are in memory until **Save to account** is acknowledged. Neither a downloaded backup
nor an unconfirmed request is a cloud save. API requests use transient bearer credentials,
`credentials: omit`, no-store and redirect rejection. Email is shown only from B's verified nullable
metadata. B authorizes ownership from managed identity, never the displayed email or browser UUID.

## Bounded correction acceptance

The October correction preserves the same architecture and checks these existing journeys:

- Account practice notes, activity notes and valid quantities update the memory draft as typed.
  Unfinished quantity text stays in the dashboard component's memory across dialog interruption;
  it participates in discard warnings and must be completed or cleared before Save or download.
  Same-account verification and connection retry retain the original store and revision; explicit
  reload, sign-out or account change retain their discard semantics.
- Guest pending writes, quota failures and session-only menus require explicit discard confirmation
  before leaving the guest route, including from recovery options. Cancel preserves the current
  menu and backup. Guest-internal navigation remains available, and public pages remain accessible
  without mounting guest persistence. One guest navigation guard also handles unsaved builder input,
  so a clean or dirty builder cannot bypass recovery protection. No guest data is deleted during
  authentication.
- Guest builder input stays mounted but hidden and inert while local recovery is open. Retry,
  session-only continuation and confirmed dashboard reset return to that same builder; only recovery
  from an already-failed React error boundary resets its child tree. Verified account identity also
  hides and disables the retained guest builder. Continue to account uses the shared guest discard
  guard, so cancel keeps the input and acceptance opens a fresh account builder. Identity or route
  changes fence pending guest-save checks; authentication never transfers the unfinished input or
  changes guest storage.
- Identity checks are fenced while provider sign-out is pending or failed. Confirmed sign-out wins
  over stale verification and broadcasts the existing credential-free hint; failure retains hidden
  account content and the explicit sign-out retry. The previous account draft remains disposed.
- The analytics regression waits for the observable committed verification transition before
  advancing its virtual clock. Its earlier full-preview failure is cleared only by a complete
  freshly built preview pass, not isolated repeats. Google entry admits one current attempt and
  recovers after failure or BFCache return; application HTML and the local development server use
  the proof's `no-referrer` policy, including modules injected before the HTML policy is parsed.
  A pending attempt A followed by BFCache reset and attempt B remains coalesced under B even if A
  fails late; the regression checks that B's finite callback marker stays intact.

## Callback isolation

The dispatcher runs before ordinary routes, stores or analytics import. Both Neon flows may return
to `/` with `neon_auth_session_verifier`. Before sign-in, the initiating tab writes and reads back
`kendomenu:auth-return-v1` in SessionStorage: exactly `{version: 1, flow, expiresAt}`, with `flow`
limited to `proof` or `application` and a 15-minute lifetime. It contains no return URL, credential,
identity, draft or opportunity. An absent, malformed, expired or mismatched root marker fails
closed in isolated callback UI.

Destinations are fixed: proof `/managed-auth-proof.html`, application `/app/auth/callback`.
Explicit callback paths select only their fixed flow; a present marker must match and validate.
The proof remains loopback development-only and never initializes a KendoMenu account. Application
bootstrap uses A's single fresh-document `getSession()` exchange, then full document replacement
to `/app/account/dashboard`. Ordinary application identity checks, refresh and sign-out use A's
token-only lifecycle. Success/cancellation/sign-out clear the marker; failed bootstrap retains only
its bounded marker for retry. Errors are sanitized and callback URLs are cleaned before ordinary
application content opens.

## Migration D handoff

C supplied the validated winning B creation response, including `copyOpportunityId`, to the
current memory-only account draft controller. [D](MANAGED_GUEST_COPY.md) consumes that seam for a
separate guarded setup route. Dispatching either decision, skipping or abandoning setup releases
the handoff; Back/remount cannot recreate it from the retained initialization response. Eligibility
is never inferred from an empty dashboard. Reload can lose the opportunity; an ordinary committed
Save consumes an unused opportunity server-side and releases the browser handoff.

## Local startup under Node 24

Use three terminals from the repository root:

```sh
pnpm --filter @kendo-menu/api exec node --env-file=.env.local --import tsx --watch src/node.ts
pnpm --filter @kendo-menu/api dev:managed-auth-proof
pnpm --filter @kendo-menu/web dev --port 5173 --strictPort
```

Vite proxies exact `/api/account`, `/api/dashboard` and `/api/dashboard/adoption` paths to B's Node listener on port 3000;
the isolated proof identity endpoint remains on port 3001. `changeOrigin: false` preserves the
browser's Origin header. B's existing exact `APP_ORIGIN` validation remains authoritative.

The owner supplies the existing ignored web `VITE_NEON_AUTH_URL` and API `NEON_AUTH_BASE_URL`,
`DATABASE_URL` and exact `APP_ORIGIN=http://localhost:5173`. Vite loads web configuration;
Node explicitly loads the API file. No private file inspection or editing is needed. B's reviewed
migrations must already be applied to the selected non-production target by a separately
authorized owner action; starting either listener does not migrate it. `127.0.0.1` and `localhost`
are distinct origins. Missing configuration or unavailable persistence is shown as unavailable,
not an offline account editor. The synthetic test environment proves neither live Google/Neon
nor production HTTPS/Vercel behavior.

## Retirement and verification

| Disposition                   | Files and guarantees                                                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep                          | Domain v10 codec; `packages/store` factory/validation; web `training-persistence`, guest lock/read-back/recovery and SDK storage characterization; shared dashboard/library/builder; B backend/SQL/contracts.   |
| Rewrite                       | `account-api`, account/auth providers, routes, navigation, metadata and analytics; `workspace-coordination` now serves only guest storage. New `account-draft` injects memory storage rather than a cache.      |
| Remove after callers replaced | `account-database`, `account-storage`, `account-synchronization`, `account-workspace` and their obsolete tests; `AdoptionDialog`, `AccountPersistenceBridge`, old account fixtures and cache/sync/adoption E2E. |

Observable isolation, late-response, guest lock/read-back, credential-free storage, identity fencing
and failure coverage is ported to API/draft and managed-account tests. Durable account-cache,
background-sync and adoption-recovery tests no longer describe an approved requirement. Legacy
browser data remains untouched. An explicit connection retry probes validated identity and dashboard
availability without replacing the current draft or its expected revision.

The inherited mobile `account-persistence.spec.ts:273` View dashboard click at line 283 timed out on
a detached element (57/58 passed). That historical failure remains unresolved. C replaces that
changed journey's leave-warning coverage with managed-account desktop/mobile tests; deleting the
obsolete IndexedDB journey does not establish a historical pass. The owner reported single-account
development persistence passes on 2026-10-13, including guest copy Yes, explicit Save, reload and
sign-out/sign-in; see the [live checklist status](MANAGED_DASHBOARDS.md#private-live-readwrite-checklist).
The remaining full-application storage checks, guest copy No, second-account/return-to-first and
deployed HTTPS validation remain unverified public-release gates.

Final local verification and independent implementation review are recorded in the
[C work-session handoff](work-sessions/2026-10-07-managed-account-web.md).
No staging, commit, push, deployment, remote migration or provider configuration change
belongs to this work.

### Post-decision dashboard freshness

Migration D's controller keeps a memory-only authoritative-load requirement after a dispatched
adoption decision. A failed refresh cannot reveal the old store as loaded or editable after
same-account verification or connectivity changes. Load/availability retries must install a
validated current-account response, including a valid empty revision-zero result. Ordinary C
availability probes for an existing dirty draft or uncertain Save still retain that draft,
expected revision and pending Save request. See [Migration D](MANAGED_GUEST_COPY.md).
