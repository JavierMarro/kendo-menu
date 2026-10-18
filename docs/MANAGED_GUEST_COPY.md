# Migration D — one-time guest copy and transition cleanup

D extends reviewed Migration C at `6475f9184a72a0afb4a11b2451506e2d309dce7a` on
`codex/managed-auth-online-dashboard`, including C's reviewed lifecycle corrections. It changes
only the frontend and directly affected guidance. B's authorization, consumption, atomic copy and
ordinary Save contracts remain authoritative. This is internal integration, not public release.

## Choice and one-use lifetime

`/app/account/setup` is a separate guarded screen. Its heading is **Copy your guest menus to your
account?** The offer requires the validated winning creation response, its `copyOpportunityId`,
the same verified account, an eligible validated cloud dashboard (revision zero and no dashboard),
and complete valid non-empty guest data that fits the complete request's 2,097,152 UTF-8 byte limit.
An empty returning account is not eligible merely because it is empty. Callback parameters and
Google email never establish eligibility.

The browser handoff exists only in memory. A setup-scoped `pagehide` listener releases it on
full-document departure, including BFCache, and prevents pending preflight reads from submitting. It is released before dispatching either decision, or
when setup is skipped or abandoned, the identity changes, sign-out starts, or its lifetime ends.
Back navigation and route remount cannot recreate the choice from the original creation response,
including after an unsuccessful or unconfirmed attempt. Strict Mode's unused effect setup is not
user abandonment. There is no decision journal, background copy, implicit No or import replay.

| Exit                                                                                     | Result                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yes confirmed                                                                            | A strict matching accepted acknowledgement confirms the complete copy; load the current cloud dashboard before editing.                                                                     |
| No confirmed                                                                             | A strict matching decline acknowledgement confirms the permanent decline; load the current cloud dashboard before editing.                                                                  |
| Failed or unconfirmed attempt                                                            | Explain that completion could not be confirmed and the opportunity may be lost; allow ordinary account continuation through validated dashboard loading. Never offer either decision again. |
| Missing/ineligible handoff or absent, empty, unreadable, invalid or oversized guest data | Release the handoff, send no adoption request and enter the ordinary account journey.                                                                                                       |
| Reload, Back or navigation away                                                          | Lose the unused handoff without sending an implicit No. A stale setup visit does not reload or replace an existing account draft.                                                           |
| Identity change or sign-out                                                              | Hide/dispose the prior account state and fence late responses using C's existing lifecycle.                                                                                                 |

A dispatched decision marks the controller as requiring an authoritative dashboard in memory.
Until a current-account validated response is installed, the retained store is neither loaded nor
editable. Same-account verification and connectivity changes cannot clear this requirement; an
availability retry installs the response instead of probing and discarding it. Revision zero with
an empty dashboard is valid after No or an unsuccessful copy; later revisions retain their actual
contents and revision. Ordinary dirty-draft and uncertain-Save availability probes still preserve
the draft, expected revision and unresolved request.

A failed post-attempt dashboard load offers an ordinary load retry. It never retries adoption.
Ordinary Save and its existing uncertain-request retry remain separate. A later server revision,
including an intervening ordinary Save, wins over the submitted guest snapshot.

## Complete copy and transport

The offer reads guest storage under the existing guest coordination lock and validates the whole
snapshot. Yes re-reads it under the same coordination and compares the exact source, including
same-count changes. Changed valid data refreshes the offer and requires another explicit choice;
unusable data skips setup. No path clears, rewrites, migrates or removes guest LocalStorage.
Supported legacy decoding happens only in memory.

Yes freezes one complete v10 request: decision, transport version, verified account mismatch guard,
existing opportunity, revision `"0"`, current catalogue, a fresh request ID and complete dashboard.
Validation includes the full envelope's UTF-8 size. Notes, activity IDs and quantity overrides use
the existing domain codec. No sends only the strict decline envelope. Duplicate submissions are
coalesced in memory, and the existing API client supplies transient bearer authorization.

Accepted responses must match the account, request ID, revision and completion timestamp; declined
responses must match the request ID and decision. Unknown/malformed responses and lost acknowledgements
are unconfirmed. Adoption errors use their own strict `{ error }` contract, including revision
conflicts; dashboard PUT conflicts retain their existing `{ error, currentRevision }` contract.
Neither an empty guess nor the submitted guest payload opens the account editor after an attempt:
only a subsequent validated cloud dashboard does. Guest and account edits thereafter are independent.

Local Vite proxying adds only the exact `/api/dashboard/adoption` endpoint, preserving Origin.
No callback handling, auth protocol, remote routing, database schema or dependency changes belong
to D. C's Google departure/retry, BFCache, builder preservation and blocked-dialog cleanup stay.

## Cleanup and verification

C already removed the legacy browser account cache, synchronization, adoption dialog and fixtures.
D's scoped caller search found no remaining runtime references to those modules. The legacy storage
sentinel in managed-account tests intentionally verifies preservation and stays. No additional
runtime deletion is needed; historical SQL, ADRs, evidence and stored browser data remain intact.

The [D work-session handoff](work-sessions/2026-10-10-managed-guest-copy.md) records actual checks and
independent review. Required suites run sequentially under Node 24 and pinned pnpm: focused checks,
`pnpm check`, full development E2E, freshly built full preview E2E, and separate PWA E2E, followed
by session and diff checks. No database suite is required for this frontend-only slice. Passing
isolated tests do not clear a required failing full suite. The retired mobile detached-click failure
from C remains unresolved historical evidence, not a pass obtained by deleting that journey.

Original D verification before the post-decision freshness correction, under Node **24.21.0**
and pnpm **11.22.0**, with suites run sequentially:

| Check                                                                       | Observed result                                                                                                                                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused API/draft/guest-reader/setup/proxy tests                            | PASS — 92 tests; final code also covered by the complete check below.                                                                                                                       |
| `pnpm check`                                                                | PASS — 608 tests (73 domain, 69 store, 154 API, 312 web), typecheck, lint, formatting, session check and production build.                                                                  |
| `pnpm test:e2e`                                                             | PASS — 287 tests, 3 intentional skips; desktop Chromium and mobile Chrome, including all 18 D cases.                                                                                        |
| `pnpm test:e2e:preview`                                                     | PASS — freshly built complete suite, 287 tests and 3 intentional skips.                                                                                                                     |
| `pnpm test:e2e:pwa`                                                         | PASS — 4 tests in the separate production PWA suite.                                                                                                                                        |
| Bounded independent review                                                  | PASS — identity-cancellation lease release and BFCache abandonment findings fixed and re-reviewed; ownership, complete copy, guest preservation, late responses and accessibility reviewed. |
| Final `pnpm session:check`, targeted formatting and `git diff --check HEAD` | PASS.                                                                                                                                                                                       |

Initial focused browser fixture failures and lint failures were corrected before the complete final
suite passes. A sandbox-denied API socket run was cleared by rerunning the complete `pnpm check`
with local listener permission. Fast Refresh, chunk-size and listener-count warnings remain
non-blocking. Desktop/mobile setup screenshots were inspected and axe/keyboard checks passed.
Callback code is unchanged, so no additional isolated callback rerun was needed; full browser suites
include the existing application callback regressions. No database tests, remote migration, live
Google/Neon or deployed HTTPS checks were run. The historical retired mobile failure and live gates
above remain separate from these current-suite passes.

## Post-decision freshness correction — 2026-10-11–12

The failing controller regression reproduced the defect before runtime edits: a connection retry
made the stale revision-zero draft editable instead of installing the server's revision-five
response. A controller-owned memory flag now hides that store and blocks mutations until a
validated current-account dashboard is installed. Same-account verification, connectivity changes,
and failed retries retain the requirement. Existing cancellation/disposal fencing remains; a late
canceled response cannot overwrite a newer loaded and edited draft. No provider or setup runtime
change was needed: their existing loaded/editable checks consume the controller's gated snapshot.

Correction paths (the pre-existing uncommitted D implementation is preserved):

- `apps/web/src/lib/account-draft.ts`
- `apps/web/src/lib/account-draft.test.ts`
- `apps/web/src/features/account/AccountSetupPage.test.tsx`
- `apps/web/e2e/managed-adoption.spec.ts`
- `apps/web/e2e/synthetic-managed-harness.ts`
- `docs/MANAGED_ACCOUNT_WEB.md`
- `docs/MANAGED_GUEST_COPY.md`
- `docs/work-sessions/2026-10-10-managed-guest-copy.md`

Focused controller/setup regressions pass: 33 tests. Four new desktop Chromium/mobile Chrome cases
cover the freshness journey within the complete managed-adoption browser file.
The browser cases cover confirmed and unconfirmed decisions, failed load, identity uncertainty,
same-account verification, repeated failed load retry, then actual server contents at revision seven.
They assert unchanged guest bytes, exactly one adoption POST and expected revision seven on the
next ordinary Save. Controller coverage includes valid empty revision zero, availability loading,
late-response fencing and unchanged ordinary dirty-draft/uncertain-Save recovery. Independent
review found and confirmed a missing progress state during a held decision POST; the controller
now enters the existing loading state at dispatch. Its new assertion failed before that fix.
The corrected runtime and tests passed independent re-review.

Final correction verification under Node **24.21.0** and pinned pnpm **11.22.0**, sequentially:

| Check                                                          | Observed result                                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Focused controller/setup tests                                 | PASS — 33 tests                                                                                 |
| Complete managed-adoption browser file                         | PASS — 22 desktop/mobile tests                                                                  |
| `pnpm check`                                                   | PASS — 614 tests (73 domain, 69 store, 154 API, 318 web), typecheck, lint, formatting and build |
| Complete `pnpm test:e2e`                                       | PASS — 291 tests, 3 intentional skips                                                           |
| Fresh complete `pnpm test:e2e:preview`                         | PASS — 291 tests, 3 intentional skips                                                           |
| Separate `pnpm test:e2e:pwa`                                   | PASS — 4 tests                                                                                  |
| Independent review                                             | PASS — progress-state finding fixed and re-reviewed                                             |
| Final session, targeted formatting and `git diff --check HEAD` | PASS                                                                                            |

The initial sandboxed check failed because the local API test listener was denied; the complete
check passed with local listener permission, and passed again after the final progress-state fix.
Initial new browser fixtures needed to await the failed verification response and assert the
existing direct dashboard navigation after successful Retry; final focused and full suites passed.
The first full development pass preceded the progress-state fix and was repeated in full afterward.
Existing Fast Refresh, listener-count, color-environment and bundle-size warnings remain non-blocking.
No database or remote work was performed. Live persistence, multi-account and deployed HTTPS checks
remain **NOT RUN**; synthetic localhost and preview tests do not establish those live results.

## Changed paths

No files were deleted. Runtime and local proxy changes:

- `apps/web/src/app/app-routes.tsx`
- `apps/web/src/features/account/AccountWorkspaceProvider.tsx`
- `apps/web/src/features/account/AccountSetupPage.tsx` (new)
- `apps/web/src/lib/account-api.ts`
- `apps/web/src/lib/account-draft.ts`
- `apps/web/src/lib/account-adoption.ts` (new)
- `apps/web/src/lib/dev-proxy-rules.ts`

Verification changes:

- `apps/web/src/lib/account-api.test.ts`
- `apps/web/src/lib/account-draft.test.ts`
- `apps/web/src/lib/account-adoption.test.ts` (new)
- `apps/web/src/lib/dev-proxy-rules.test.ts`
- `apps/web/src/features/account/AccountSetupPage.test.tsx` (new)
- `apps/web/e2e/synthetic-managed-harness.ts`
- `apps/web/e2e/managed-adoption.spec.ts` (new)

Guidance: `PRODUCT.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/MANAGED_ACCOUNT_WEB.md`,
`docs/MANAGED_AUTH_TRANSITION.md`, `docs/MANAGED_DASHBOARDS.md`, this new document,
`docs/work-sessions/README.md` and the new `docs/work-sessions/2026-10-10-managed-guest-copy.md`.

## Owner-run private live checklist

Run only in the owner's separately authorized non-production environment. Keep credentials,
identity payloads, cookies, opportunity IDs and connection details private; record sanitized
PASS/FAIL/NOT RUN outcomes. Synthetic tests do not prove live provider, persistence or HTTPS behavior.

1. Google sign-in/out: enter from guest with pending writes and builder input; verify C's departure
   guards, callback completion, account verification, sign-out and restoration of guest use.
2. Real dashboard Save/reload: edit notes and quantities, explicitly Save, reload and verify the
   complete authoritative result. Exercise ordinary uncertain-Save retry separately from copy.
3. Copy Yes: with a genuinely new test account and non-empty guest menus, confirm count, copy, then
   verify IDs, notes and quantity overrides after cloud reload. Guest bytes must remain identical.
4. Decline No: use another genuinely new test account; confirm permanent decline, ordinary entry
   and no later offer. Verify guest bytes remain unchanged. Do not reset server consumption to
   manufacture a retry. An interrupted attempt may lose the opportunity.
5. Independent edits: edit/save the account after copying, sign out and verify unchanged guest
   menus. Edit guests, return to the account and verify its saved contents remain independent.
6. Two-account isolation: use two dedicated test accounts; verify distinct identities and isolated
   dashboards, then return to the first and confirm stable identity and content. **NOT RUN —
   owner-deferred** until a second dedicated account is available; personal accounts are excluded.
7. Later Preview HTTPS/API routing: after separate authorization, verify the callback/session
   lifecycle, Origin handling and exact account/dashboard/adoption routes over HTTPS, plus Save,
   copy/decline and sign-out. Do not infer this from localhost or synthetic preview passes.

Live B persistence remains **NOT RUN**. The second-account/return-to-first gate remains **NOT RUN —
owner-deferred**. No remote actions were executed for D; internal completion is not public release
approval.
