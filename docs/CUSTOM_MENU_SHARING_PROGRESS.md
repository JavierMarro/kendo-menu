# Custom-menu sharing implementation and verification

Implementation started 8 November 2026 against `8f0a895`; local acceptance completed 10 November.
The owner authorized the [implementation plan](CUSTOM_MENU_SHARING_PLAN.md) and requested
Sol 6.1 Extra High independent review. No per-account snapshot quota was added.

## Implemented journey

- Signed-in owners can share saved custom menus. Library and guest menus cannot be shared.
  The dialog explains that sharing uses the last saved account version.
- Hosted links expose immutable snapshots of names, intensity, activities, exercises and effective
  quantities. Notes, descriptions and source/account identifiers are excluded. Unchanged effective
  content reuses a link; changed content produces a new snapshot.
- Anyone can preview a link. Signed-in recipients can add a fully editable independent draft,
  then explicitly Save to account. Google sign-in returns to the menu through account setup.
- Received copies retain Custom, Shared and intensity tags, and appear in the dashboard Shared
  filter. Imports use fresh IDs, preserve both duration units and validate the complete save size
  before changing the live draft. Guest data is untouched.
- Storage/wire version 11 preserves received-copy provenance. Strict version 10 compatibility and
  retained receipts remain available; old-client writes cannot downgrade a version 11 dashboard.
- Removing a source menu preserves hosted links. Deleting its local owning account cascades hosted
  shares while other accounts retain their saved copies. This adds no account-deletion UI/provider
  workflow.

## Verification

All application checks use Node 24.21.0 and pnpm 11.22.0.

| Gate                              | Evidence                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Independent review                | Sol 6.1 Extra High: PASS; final lifecycle, keyboard and database test corrections re-reviewed.                            |
| Repository check                  | `pnpm check`: PASS on the final implementation; types, lint, formatting, 736 tests, both builds and 2 packaged API tests. |
| PostgreSQL integration            | PASS: 76 tests against guarded local `kendomenu_test`, using isolated harness-owned schemas.                              |
| Migration metadata                | `pnpm db:check`: PASS.                                                                                                    |
| Full desktop/mobile browser suite | PASS: 373 tests, 3 platform-specific skips; complete rerun supersedes an earlier sleep-interrupted run.                   |
| Production PWA suite              | PASS: 7 tests, including offline guest migration and no offline shared snapshot retention.                                |
| Visual/accessibility              | Desktop/mobile sharing screenshots inspected; sharing journeys include keyboard focus and axe checks.                     |
| Documentation and whitespace      | PASS: referenced local document paths resolve; final record formatting and `git diff --check` are clean.                  |

The complete browser suite ran with two workers under `caffeinate -i` to prevent idle sleep for that
process. No permanent system settings changed. Build chunk-size and test listener-count
warnings were emitted; checks pass without suppressing them.

The owner configured `apps/api/.env.test.local`, already excluded by Git. Its contents were not read
or displayed. From `apps/api`, the guarded integration command is:

```sh
node --env-file=.env.test.local --import tsx src/database/integration-command.ts
```

Use Node 24 explicitly if the shell defaults to another runtime. Run heavy suites sequentially.

## Release boundary

The implementation was merged to `main` by PR #52 at `de4f84f`. The verification table above
records the original local acceptance. Subsequent local preview, packaging and guarded PostgreSQL
checks also passed on the merged code. Follow the [sharing release check](runbooks/DEPLOYMENT.md#sharing-release-check)
for owner verification of production migration `0004_solid_zaladane.sql`, hosted delivery and
live Google/Neon/HTTPS behavior.

The owner reported using sharing successfully in production on 2026-11-13. They also reported
returning visitors opening a shared link from WhatsApp and seeing the app's route-not-found page.
A private window loaded the menu. This is owner-reported journey evidence. It leaves the affected
browser's exact service-worker version and production configuration unverified.
