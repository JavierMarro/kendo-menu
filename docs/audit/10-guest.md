# Pass 1 — Guest menus and local persistence

Baseline: `codex/updated-audit-kendomenu` at `de4f84fcc356edcdd5b58a53bedd5030fb90830d`,
checked on 2026-11-10 (Europe/Madrid). The staged and working-tree comparisons to that commit
and the non-ignored untracked-file list showed no drift outside `docs/audit/`. No product
files were changed. All observations are from this checkout under Node 24.21.0 and pnpm 11.22.0.

## Confirmed findings

### KM-01-001 — Retrying a stale tab replaces a newer saved dashboard

**P1 · High confidence · Defect.** With two guest tabs on the same origin, the second tab can
save successfully, then lose that whole confirmed dashboard when the older tab chooses
**Try again**. No warning says the newer dashboard will be replaced, and there is no server copy.

- **Evidence.** In desktop Chromium, open Junior High in tab A while storage is empty. Add Senior
  High in tab B and wait for success. Add Junior High in A: the UI says it could not confirm
  the write and disk still equals B's saved bytes. In A, open **View dashboard → Open recovery
  options → Try again**. Disk now contains only Junior High; B no longer shows Senior High after
  reload. No mocked lock or disk error is needed. The same baseline replacement affects
  nonempty diverged dashboards.
- **Cause.** The [adapter](../../apps/web/src/lib/training-persistence.ts#L329) correctly rejects
  a write when disk differs from the observed raw value, even under the Web Lock. The
  [retry handler](../../apps/web/src/features/persistence/PersistenceGate.tsx#L275) treats any
  newly inspected valid/empty state as a safe baseline, replaces the writer, then
  [re-saves the existing live store](../../apps/web/src/features/persistence/PersistenceGate.tsx#L254).
  It compares against B's bytes at commit, but the payload still comes from A.
- **Why tests miss it.** The [adapter test](../../apps/web/src/lib/training-persistence.test.ts#L261)
  asserts the first refusal; the [recovery tests](../../apps/web/src/test/write-recovery.integration.test.tsx#L67)
  cover an unchanged empty baseline and corrupt/future peer bytes. The
  [two-tab browser case](../../apps/web/e2e/guest-coordination.spec.ts#L4) proves lock scheduling,
  not conflict recovery with a different valid dashboard.
- **Smallest fix and acceptance.** Keep the original observed baseline across ordinary retry;
  if it differs, preserve the live draft for download/session-only and offer to load the latest
  device data with explicit discard. No merge or new journal is needed. A same-origin two-tab
  test must keep B's exact bytes through A's retry and offer access to A's unsaved work.
  Retrying a genuine quota failure against an unchanged baseline must still save.

### KM-01-002 — Reset leaves a pre-reset Undo that can restore erased data

**P2 · High confidence · Defect.** A guest who removes a custom menu, hits a write failure and
confirms **Reset local data** can still restore that erased menu into durable storage by using
the old **Undo** button. Reset promises permanent removal of saved dashboard content. This
requires a prior removal and a subsequent click; it is not automatic resurrection.

- **Evidence.** In Chromium, create a custom menu, inject a synthetic quota failure on guest
  `setItem` only, remove the menu, then confirm reset from recovery. The LocalStorage key is
  deleted. Restore normal writes and click the still-visible **Undo**. The menu is written again
  and survives a fresh reload.
- **Cause.** [Reset](../../apps/web/src/features/persistence/PersistenceGate.tsx#L316) empties
  the same store and enables a new writer. The
  [recovery wrapper](../../apps/web/src/features/persistence/PersistenceGate.tsx#L443) only hides
  the dashboard. Its [removal/undo state](../../apps/web/src/features/dashboard/DashboardPage.tsx#L291)
  still owns a full pre-reset entry that it passes back to the store. The
  [confirmation text](../../apps/web/src/features/persistence/PersistenceGate.tsx#L751) does
  not describe this exception.
- **Why tests miss it.** The [corrupt reset test](../../apps/web/e2e/persistence.spec.ts#L9) has
  no live Undo state. The [builder-lifetime test](../../apps/web/e2e/guest-builder-lifetimes.spec.ts#L39)
  checks the live dashboard is empty after reset and that separate unsaved form input survives;
  it does not reset a dashboard with a pending removal.
- **Smallest fix and acceptance.** Invalidate the pending dashboard removal/Undo on successful
  reset. Keep an unrelated unfinished builder form mounted; preserving it is tested behavior.
  Verify Undo is gone after confirmed reset, bytes stay absent on reload, and Undo still works
  after an ordinary removal or cancelled reset.

### KM-01-003 — Guest Save reports success after rejecting a note at the storage cap

**P2 · High confidence · Defect.** A valid field-level note that pushes a valid dashboard over
the total serialized limit can remain visible in the input while **Save your changes** says it
was saved. Reload returns the previous note. This is a false acknowledgement, not a partial write.

- **Evidence.** Seed a valid v11 dashboard at 2,097,144 UTF-16 code units (cap minus eight),
  including a multi-byte menu name. Enter a 17-character practice note and click
  **Save your changes**. The page emits a size error, storage stays byte-for-byte unchanged, yet
  the dialog reports **Changes saved on this device.** After reload the note is empty.
- **Cause.** The [store preflight](../../packages/store/src/index.ts#L789) throws before
  committing the new state, preserving the prior snapshot. The
  [guest blur handler](../../apps/web/src/features/dashboard/DashboardPage.tsx#L650) does not
  handle that rejection. [Explicit Save](../../apps/web/src/features/dashboard/DashboardPage.tsx#L659)
  flushes the previous snapshot; because no browser write was attempted, the persistence status
  can still say saved. The textarea maximum only limits that field, not the serialized dashboard.
- **Why tests miss it.** [Store limits](../../packages/store/src/index.test.ts#L1083) exercise
  rejection and atomicity. The [dashboard save tests](../../apps/web/src/test/activity-notes.integration.test.tsx#L417)
  test persistence write failure, which sets the adapter failure flag. Neither checks a
  preflight rejection with healthy LocalStorage.
- **Smallest fix and acceptance.** Handle store rejection at the editor commit boundary, retain
  the draft with an actionable size message, and suppress save success until the pending edit
  commits. Check the same behavior for quantity and activity note commits which use that
  aggregate limit. In a browser test, the rejected note must remain visibly unsaved while raw
  bytes remain identical; a shorter note that fits must save and survive reload.

Independent reviewer `guest_integrity_review` challenged all three findings against the actual
callers, product promises and existing tests. It confirmed the paths by source inspection; it
did not run tests. The review also confirmed that a reset fix must preserve unfinished builder
form input.

## Coverage and boundaries

| Area                            | Evidence and result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create, add, edit, cancel       | Traced [builder input](../../apps/web/src/features/custom-sets/builder-state.ts), [builder submit](../../apps/web/src/features/custom-sets/CreateDrillPage.tsx#L206), [curated Add](../../apps/web/src/features/library/DrillDetailContent.tsx#L75), [dashboard](../../apps/web/src/features/dashboard/DashboardPage.tsx) and [store actions](../../packages/store/src/index.ts#L755). Browser and React tests exercise structural edit/cancel, retained values/notes, curated editor rejection, and durable reload. The probe creates a guest custom menu with explicit zero, checks the v11 bytes, then reloads it.                  |
| Data ownership and trust        | Reviewed [domain/types and limits](../../packages/domain/src/types.ts#L49), curated [JSON](../../packages/domain/data/default-drills.json), [schema](../../packages/domain/schema/kendo-drills.schema.json) and [adapter](../../packages/domain/src/default-training-sets.ts), store and browser seams. Built-ins stay catalogue-owned; guest entries own their overrides and notes. Unit tests exercise duplicate entries, prototype-like keys, invalid IDs/counts/quantities and atomic rejection. Guest edits use LocalStorage and no dashboard/shares requests were observed in the isolated probes; identity checks are separate. |
| Hydration and migration         | Reviewed [inspection, hydration and v11 serialization](../../packages/store/src/persistence.ts#L2583). Existing tests cover older supported starts, unambiguous migration, conflicts, v10→v11 preservation and future/malformed raw bytes. Browser tests verify v10 edit/reload and safe recovery of corrupt/future bytes. Synthetic probe accepted 2,097,151 and 2,097,152 code units and rejected 2,097,153 before parsing; it also verified failed size preflight did not mutate store or bytes. Local code units are not an API UTF-8 payload limit.                                                                               |
| Device failure and coordination | Read [browser adapter](../../apps/web/src/lib/training-persistence.ts#L260), [Web Locks](../../apps/web/src/lib/workspace-coordination.ts), and [guest gate and recovery](../../apps/web/src/features/persistence/PersistenceGate.tsx). Tests cover unavailable/failed locks, forced quota/read-back failures, stuck or disabled writers, session-only recovery and leaving with unsaved work. A real same-origin Chromium lock was exercised. Injected faults show app behavior; they do not measure each browser's quota or cross-tab guarantees without Web Locks.                                                                  |
| Backup, reset and privacy       | Chromium downloaded the exact ordinary corrupt fixture and the latest validated v11 in-memory draft after forced failure, with disk unchanged; reset/cancel checks isolated the guest key. [Downloads](../../apps/web/src/lib/training-persistence.ts#L529) are explicit local Blob exports; there is no guest restore/import workflow or remote backup in this journey. Checked [guest error boundary](../../apps/web/src/features/errors/ApplicationRecovery.tsx) and the local navigation guard; deeper route/lifecycle and service-worker behavior belongs to Pass 6.                                                              |

No additional guest network payload is required for create/add/edit, reset or download. No
authenticated account operations, guest-copy eligibility/transport, share import, PWA/preview,
live infrastructure or DB tests were part of this pass. The development browser checks use
Chromium desktop and mobile emulation, not independent browser engines or a mobile OS.
Guest-exit comparison and a backup source comment still refer to v10
([gate](../../apps/web/src/features/persistence/PersistenceGate.tsx#L225),
[backup](../../apps/web/src/lib/training-persistence.ts#L536)); new guest writes and current backups
use v11. No normal guest producer of share provenance was found; treat this as a compatibility
seam for later passes, not a confirmed guest defect. The published architecture's stale v10
statement is already in the [documentation queue](00-repository-map.md#documentation-reconciliation-queue).

## Verification log

Select the Node 24 PATH in the [index](README.md#baseline). Ran package and browser suites
sequentially. The package scripts include typecheck and lint; web also includes the Vite build.

| Command                                                                    | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:domain`                                                        | PASS, 5 files / 89 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm check:store`                                                         | PASS, 5 files / 83 tests. Includes the [bounded edit fuzz](../../packages/store/src/custom-edit-fuzz.test.ts#L619), default seed `0x43555354`: 8×2 smoke and 96×4 mixed edits, stable IDs and persisted/live agreement, plus atomic invalid/overflow checks. No extra fuzz run.                                                                                                                                                                                      |
| `pnpm check:web`                                                           | PASS, 42 files / 393 tests and production web build. Build emitted a non-blocking chunk-size warning.                                                                                                                                                                                                                                                                                                                                                                |
| Scoped Playwright command below                                            | Initial sandbox attempt stopped before test discovery/execution because Vite could not bind `127.0.0.1:4173` (EPERM). Approved loopback rerun: 56 passed (28 per project), no failures or skips.                                                                                                                                                                                                                                                                     |
| `pnpm --filter @kendo-menu/api exec tsx ../../docs/audit/guest-probes.mjs` | Final approved run exited 0: size boundaries verified, all three defects reproduced. The API package filter supplies the existing `tsx` executable only. Initial sandbox launch denied `tsx` IPC. Two exploratory runs stopped at UI setup (recovery behind the open library dialog, then cookie notice intercepting the builder click). The [final probe](guest-probes.mjs) follows **View dashboard** and acknowledges the unrelated notice in its fresh contexts. |

```sh
pnpm --filter @kendo-menu/web exec playwright test --config playwright.config.ts --workers=2 \
  --grep-invert 'account edits a custom menu|account cancels structural edits|unfinished account menu edit|pending account save cannot' \
  persistence.spec.ts custom-menu-edit.spec.ts guest-coordination.spec.ts \
  guest-recovery-navigation.spec.ts guest-builder-lifetimes.spec.ts
```

The probe uses a fixed synthetic fixture, a loopback Vite server, fresh browser contexts and
no external requests. It asserts the currently observed failures for reproducibility; it is
not a regression suite expected to pass after a fix. Its injected quota case touches only the
test context's guest key. No private configuration was opened or printed.
