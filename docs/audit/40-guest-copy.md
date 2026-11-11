# Pass 4 — One-time guest copy and decline

Completed on 2026-11-10 (Europe/Madrid) on `codex/updated-audit-kendomenu` at
`f64eee18969aa56a26fa8b18626c74de4bc56e33`. Compared the working tree and index against
`de4f84fcc356edcdd5b58a53bedd5030fb90830d` using the [index commands](README.md#baseline).
The index was clean. The only working-tree changes at entry were the audit index and untracked
Pass 2/3 artifacts. There were 33 changed web paths against the pinned commit and no untracked
implementation paths. Rechecked the changed provider, token/client and guest persistence seams.
Setup, the copy controller, server route, database adapter, and domain/store codecs were unchanged.
The web tree matched the release commit in [PR #53](https://github.com/JavierMarro/kendo-menu/pull/53),
merged to `main` at `6101a17967c9d433c043ea4b5147504746f1cea9` with passing CI.

## Actual journey and boundaries

- **Initialization.** `POST /api/account` creates the account and random one-use opportunity in one
  transaction under the verified provider identity. Only the winning creation response carries the
  capability. The browser holds it in memory. [Mapping and creation](../../apps/api/src/persistence/postgres/managed-account-adapter.ts#L106)
- **Offer.** The account route opens `/app/account/setup` with a matching live handoff and a
  verified dashboard at revision zero with no saved snapshot. Setup reads exact guest LocalStorage
  under the guest coordinator. It accepts complete nonempty data through strict v10/v11 codecs and
  decodes supported older formats in memory. Unusable or oversized input skips the offer without
  sending a decision. Both paths preserve guest storage. [Route and handoff](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx#L439),
  [offer](../../apps/web/src/features/account/AccountSetupPage.tsx#L69), [guest read](../../apps/web/src/lib/account-adoption.ts#L31)
- **Explicit Yes or No.** Yes rereads and compares exact guest bytes. A changed valid source needs
  another explicit choice even when the count matches. Both decisions carry transport version 1,
  decision, request ID, workspace guard and capability. Yes also carries revision `"0"`, catalogue
  and a complete v11 dashboard. After same-account verification, the controller releases the
  handoff and calls `POST /api/dashboard/adoption` with a transient bearer token.
  [Choice](../../apps/web/src/features/account/AccountSetupPage.tsx#L142),
  [controller](../../apps/web/src/lib/account-draft.ts#L676), [API client](../../apps/web/src/lib/account-api.ts#L1155)
- **HTTP boundary.** The app bypasses framework body parsing. The handler checks POST, absence of
  query, JSON headers, exact Origin and server-verified mapped identity before reading the body.
  The 2,097,152 UTF-8 byte limit covers the full envelope. Strict keys, account guard, UUIDs,
  v10/v11 dashboard validation, catalogue and per-account capability gate persistence. Replies
  use `private, no-store` and bounded error codes. [Mount](../../apps/api/src/app.ts#L86),
  [authorization](../../apps/api/src/auth/account-authorization.ts#L110),
  [handler](../../apps/api/src/adoption/adoption.ts#L36), [validation](../../apps/api/src/adoption/contracts.ts#L73)
- **Database effects.** Parameterized queries verify identity and expiry under the account lock
  and check the opportunity and revision. No commits `declined` without a dashboard. Yes commits
  `consumed`, then relocks and atomically writes the entire snapshot at revision 1 and marks it
  `accepted`. An earlier Save marks the unused opportunity `saved`. A Save between the two Yes
  transactions wins and its dashboard is preserved. A failed second transaction leaves
  `consumed`. A lost successful COMMIT response leaves `accepted` and the copy. No Save receipt
  is written for either decision. [Consume](../../apps/api/src/persistence/postgres/managed-copy-adapter.ts#L96),
  [copy](../../apps/api/src/persistence/postgres/managed-copy-adapter.ts#L176),
  [ordinary Save](../../apps/api/src/persistence/postgres/managed-dashboard-adapter.ts#L392)
- **Acknowledgement and reload.** Yes validates decision, account, request ID, revision and
  timestamp. No validates decision and request ID. A missing or invalid response yields
  unconfirmed completion, with no POST retry. The controller requires a fresh identity check
  and validated dashboard read before editing. When read-back fails, Retry reads again and the
  previous store stays unavailable. Account changes and sign-out fence late results.
  [Handler replies](../../apps/api/src/adoption/adoption.ts#L99),
  [load](../../apps/web/src/lib/account-draft.ts#L278), [completion](../../apps/web/src/lib/account-draft.ts#L724)

The [product scope](../../PRODUCT.md#L132), [setup guidance](../MANAGED_GUEST_COPY.md#choice-and-one-use-lifetime)
and [ADR 0007](../adr/0007-managed-auth-online-account-drafts.md) approve a volatile handoff and
the possibility of losing the opportunity. A terminal No, a consumed-but-unwritten Yes, and a
lost response after commit are expected outcomes. There is no durable pending copy, creating-session
restriction, replay or offline account draft. This pass establishes checkout behavior. The
[repository map](00-repository-map.md) distinguishes historical deployed behavior and outstanding
owner verification. Sharing continuation/import and general PWA caching belong to later passes.

## Findings

### KM-04-001 · P2 · High confidence · Defect

A confirmed copy can be followed by a false assertion that the account was unchanged. After Yes
received a valid 200 acknowledgement, the probe forced the dashboard refresh to return 503.
The page said “The account service is unavailable. Your account was not changed.” Retry revealed
the copied menu, with one adoption POST throughout and identical guest bytes. The editing gate
held correctly. The violated invariant is accurate mutation status when read-back fails.

`load(true)` sets the refresh error, then `submitAdoption` clears it and the route uses the unsafe
fallback. The existing browser cases check the failed-load heading, blocked editing, and later
revision, but skip the claim in the alert. Preserve the load result and use fallback wording that
only describes failed loading. Verify the full alert after both confirmed and unconfirmed
decisions, and assert that Retry reads only and displays the current server dashboard.
[Load error](../../apps/web/src/lib/account-draft.ts#L307),
[error reset](../../apps/web/src/lib/account-draft.ts#L746),
[fallback](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx#L564),
[existing E2E](../../apps/web/e2e/managed-adoption.spec.ts#L371), [probe](guest-copy-probes.mjs#L133)

### KM-04-002 · P2 · High confidence · Defect

Releasing the handoff during the final identity preflight can still dispatch a pending choice.
The probe clicked Yes, held the verification `GET /api/account`, and departed while there were
zero adoption POSTs. Both an injected `pagehide` and actual SPA navigation to Dashboard released
the handoff. After releasing the read, each path sent one Yes POST and displayed the copied
menu or the success screen. The guest source remained unchanged. The user had clicked Yes,
but the documented pre-dispatch abandonment guarantee failed and the one-time opportunity was used.
This finding concerns departure before dispatch. Existing sign-out fencing after dispatch is separate.

The controller captures the handoff before awaiting verification. The departure handlers clear
it without changing the epoch, and the final guard checks only identity, epoch and abort. The
existing lifecycle tests cover an unused handoff, sign-out after dispatch and the earlier guest
read, leaving this verification window open. Check that the same handoff is still live immediately
after verification and before marking either decision dispatched. Hold verification for Yes and
No, depart, and verify zero adoption POSTs and normal account continuation without a new offer.
[Pagehide](../../apps/web/src/features/account/AccountSetupPage.tsx#L44),
[SPA departure](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx#L474),
[release](../../apps/web/src/lib/account-draft.ts#L172), [dispatch](../../apps/web/src/lib/account-draft.ts#L713),
[unused-offer E2E](../../apps/web/e2e/managed-adoption.spec.ts#L343),
[setup unit test](../../apps/web/src/features/account/AccountSetupPage.test.tsx#L117),
[probe](guest-copy-probes.mjs#L151)

### KM-04-003 · P3 · High confidence · Defect (documentation)

The transport description linked from the product guide still says Yes sends v10. The current
browser always sends v11, including after decoding v10 data. The server accepts both through
the shared dashboard validator. This can mislead fixture authors and readers investigating
compatibility. The v10 fixture test verifies preserved entries and source bytes, while the
local probe verifies a v11 request and read-back. Neither checks the prose. Label the v10
description as historical or update the current transport note to v11 with v10 accepted by
the server. Verify the guide against the emitted envelope and accepted versions. The related
architecture version discrepancy is already recorded in the repository map.
[Guide](../MANAGED_GUEST_COPY.md#L55), [encoder](../../apps/web/src/lib/account-adoption.ts#L69),
[validator](../../apps/api/src/adoption/contracts.ts#L177),
[fixture test](../../apps/web/src/lib/account-adoption.test.ts#L65), [repository map](00-repository-map.md)

An independent reviewer inspected the changed call paths, tests and reproductions and confirmed
both P2 defects. The legacy copy path implements the approved in-memory migration and has no
guest write in its source path.

## Request cost

Measured uncompressed UTF-8 JSON body bytes through the actual browser API client and Elysia
handlers backed by guarded PostgreSQL. The typical Yes fixture has one curated entry and a
short multibyte note. The boundary fixture uses a second custom entry with three sections and
264 exercises, and valid multibyte notes padded to the exact full request limit. Headers,
token exchanges, HTTP framing and deployment compression are outside these counts.

| Endpoint and trigger                                                    |   Request bytes |                          Response bytes | Body shape                                                                                                     |
| ----------------------------------------------------------------------- | --------------: | --------------------------------------: | -------------------------------------------------------------------------------------------------------------- |
| `POST /api/account`, new-account initialization                         |               0 |                                     155 | Workspace ID, email, creation flag, opportunity                                                                |
| `GET /api/account`, identity preflight and before refresh               |               0 |                                      81 | Workspace ID and email                                                                                         |
| `POST /api/dashboard/adoption`, Yes once                                | 593 / 2,097,152 |                                     376 | Complete Yes envelope; completion and Save-shaped acknowledgement duplicate request ID, revision and timestamp |
| `POST /api/dashboard/adoption`, No once                                 |             216 |                                     103 | Minimal No envelope; completion decision and request ID                                                        |
| `POST /api/dashboard/adoption`, attempted reuse after terminal decision |             216 |                                      40 | No envelope; HTTP 409 error code                                                                               |
| `POST /api/dashboard/adoption`, limit + 1                               |       2,097,153 |                                      29 | HTTP 413 error code; client would reject before sending                                                        |
| `GET /api/dashboard`, authoritative refresh                             |               0 | 489 / 2,097,048 after Yes; 217 after No | Workspace ID, catalogue, revision, update time, snapshot or null                                               |

Browser tracing showed `GET /api/account` → decision POST → `GET /api/account` →
`GET /api/dashboard`, with four intercepted `/token` exchanges after the click, for Yes, No,
and a dropped acknowledgement. Initial setup reads are separate. Offer display, stale-source
reconfirmation and skipped setup send no adoption request. Retry after a failed refresh reads
only. Each server operation reauthorizes and the fresh read installs current state if another
Save has won or followed the copy.

At the measured limit, the upload and refresh snapshot contribute 4,194,200 body bytes combined.
A full snapshot fits this bounded, one-time atomic operation and the follow-up read returns the
actual latest revision. A partial update would add reconstruction and validation complexity to
the eligibility and transaction boundary. The small duplicate acknowledgement fields are part of
the current strict contract. The browser also repeats normalization and serialization for size
checks and final send. The source shows repeated work, and this pass did not measure a timing cost.
[Offer and size check](../../apps/web/src/lib/account-adoption.ts#L107),
[serializer](../../apps/web/src/lib/account-api.ts#L825), [measurement probe](guest-copy-probes.mjs#L237)

## Verification and limitations

Commands ran sequentially on Node 24.21.0 and pnpm 11.22.0. Run from repository root except the
two guarded database suite commands shown in the subshell. The existing local private test
configuration was loaded by Node for the guard/harness without reading or printing its contents.

```sh
pnpm --filter @kendo-menu/web exec vitest run --config vitest.config.ts src/lib/account-adoption.test.ts src/lib/account-api.test.ts src/lib/account-draft.test.ts src/features/account/AccountSetupPage.test.tsx
pnpm --filter @kendo-menu/api exec vitest run --config vitest.config.ts src/adoption/managed-adoption.test.ts
pnpm db:check
(
  cd apps/api
  node --env-file=.env.test.local --import tsx --input-type=module -e 'import { validateTestDatabaseUrl } from "./src/database/test-database.ts"; validateTestDatabaseUrl(process.env.TEST_DATABASE_URL)'
  node --env-file=.env.test.local --import tsx ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts src/persistence/managed-copy.integration.test.ts src/persistence/adoption-migrations.integration.test.ts
)
pnpm test:e2e --workers=2 managed-adoption.spec.ts
node --env-file=apps/api/.env.test.local --import ./apps/api/node_modules/tsx/dist/loader.mjs docs/audit/guest-copy-probes.mjs db
node --import ./apps/api/node_modules/tsx/dist/loader.mjs docs/audit/guest-copy-probes.mjs browser
```

- **111 web and 19 API cases passed.** Covered preservation of IDs, notes and zero overrides,
  strict guest and transport parsing, origin and identity rejection, bounded body, and setup gating.
- **Migration metadata and 39 PostgreSQL cases passed.** The 11 managed-copy cases covered one concurrent initialization
  winner, invalid capability/catalogue leaving eligibility, competing choices, Save before or
  between copy transactions, rollback and committed copy with lost acknowledgement. The 28
  adoption-migration cases exercised historical migration preservation, constraints and rollback.
  The extra database probe verified revision 1/`accepted` for Yes,
  revision 0/`declined` for No, no Save receipts, rejected repeat and exact-limit acceptance
  after the oversize rejection. [Integration suite](../../apps/api/src/persistence/managed-copy.integration.test.ts#L153)
- **22 desktop/mobile-emulated Chromium cases passed.** Covered same-count stale input, successful
  and lost decisions, duplicate click, sign-out, Back, same-account reverification, lost unused
  handoff and authoritative refresh recovery. The bounded extra probe covered corrupt and valid
  UTF-8-oversized guest fixtures with zero POSTs, an in-memory v9 to v11 copy, and byte equality
  after every case. It reproduced KM-04-001 and KM-04-002. Its browser transport is synthetic.
  Database evidence comes from the separate local harness and uses synthetic authorization.

All planned scoped checks ran. The departure event injection verifies the handler contract.
Native BFCache suspension/resume scheduling remains unverified. The browser suite used local
development mode. Current production routing/compression, deployed database state, and real
Google/Neon session timing require owner-run verification. No production configuration or runtime
was inspected. No app code or existing tests changed during this pass.
