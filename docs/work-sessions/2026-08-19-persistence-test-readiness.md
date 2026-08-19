# Work session: persistence test readiness

- Date: 2026-08-19
- Duration: about 35 minutes

## Scope

Turn the pre-build capability audit into the smallest useful implementation: make persisted Zustand
state safe to hydrate, add executable tests to the repository quality gate, reconcile conflicting
skill guidance, and add one KendoMenu-specific web-feature workflow.

## Starting state

The React/Vite shell and package boundaries were sound, but `packages/store` trusted parsed JSON,
used Zustand's default version 0 and shallow merge, and had no migration tests. The workspace had no
test runner or test script, `pnpm check` did not run tests, and its lint/format scope included bundled
`.agents/skills` tooling that did not follow the product-code configuration.

## Main changes

- Added Vitest at the workspace root, a store test script, and tests in `pnpm check`.
- Added a version-1 persistence boundary that validates the Zustand envelope, reconstructs only
  recognized domain fields, migrates valid version-0 data, and rejects malformed state.
- Protected future-version data from stale tabs and ordered asynchronous reads, writes, and clears
  so older operations cannot overwrite newer or explicitly cleared state.
- Added 24 public-store tests for actions, round trips, migrations, corruption, envelope versions,
  nested-field sanitization, future-version quarantine, cross-tab writes, async ordering, and clear.
- Added and indexed `kendomenu-web-feature`, plus repository precedence guidance and current Vitest
  wording in the existing verification/fuzzing skills.
- Excluded bundled `.agents/skills` and generated `.impeccable` cache data from product lint/format
  scope so the documented quality gate is executable without weakening checks on repository code.

## Decisions

- Kept persistence validation private to `packages/store`; domain contracts remain platform-neutral,
  browser APIs remain in `apps/web/src/lib`, and no UI, mobile, server, sync, router, Query, Dexie,
  Tailwind, or shared-component infrastructure was introduced.
- Used hand-written structural parsing rather than adding a schema dependency for the small current
  payload. Unsupported newer versions are preserved and write-protected instead of downgraded.
- Added one coordinating project skill under the established `tools/skills` source of truth. Did not
  install `grilling`; its explicit architecture-survey consumer was not needed for this slice.
- Searched the skills catalog for Zustand, React/Vite, React testing, Playwright, and accessibility
  workflows. None justified installation for this non-UI slice: candidates were broader,
  stack-conflicting, lower-trust, or only useful once component/E2E behavior is added.
- Limited automated tooling to Vitest's Node environment. DOM testing and Playwright remain deferred
  until changed UI behavior makes them valuable.

## Failures and roadblocks

- The first sandboxed `pnpm add -Dw vitest` could not use the existing pnpm store; the approved rerun
  used the existing store and updated the single lockfile.
- The skill creator's `quick_validate.py` could not import PyYAML. No global package was installed;
  the generated YAML and SKILL frontmatter were parsed with the system YAML library, checked for
  template markers, and formatted successfully. An initial Ruby helper used an unavailable
  `safe_load_file` method and was replaced with `safe_load(File.read(...))`.
- The first `pnpm check` stopped on 2,363 diagnostics from bundled `.agents/skills` runtimes. The
  lint/format exclusions were narrowed to vendored skill tooling and generated Impeccable cache;
  the complete gate then passed.
- Vite initially could not bind localhost inside the sandbox; an approved local-server run started
  successfully. No browser backend was connected, so interactive responsive/keyboard verification
  was not possible; a localhost request returned HTTP 200 instead.
- Tests were written before the persistence implementation and initially produced four expected
  failures. Semantic review then found future-version, nested-field, async ordering, cross-tab, and
  clear races; each was fixed and covered with a regression.

## Verification

- `pnpm --filter @kendo-menu/store typecheck`: passed.
- `pnpm --filter @kendo-menu/store test`: passed, 24 tests.
- `pnpm exec eslint packages/store/src`: passed.
- `pnpm check`: passed after the quality-scope correction, including typecheck, lint, Prettier,
  Vitest, and the production Vite build.
- `curl --fail --silent --show-error --head http://127.0.0.1:5173/`: HTTP 200 while Vite was running.
- Skill YAML/frontmatter parsing, TODO scan, targeted Prettier, `git diff --check`, and scoped
  debug-log/type-suppression scans: passed; scan matches were documentation text or Vitest's
  `expect.any`, not product diagnostics or TypeScript `any`.

## Follow-up context

Future UI work should surface an incompatible persisted version: the adapter deliberately preserves
newer data and allows in-memory actions, but those actions are not written until storage is cleared
through the persistence API. Repeat the unavailable desktop/mobile-width/keyboard/reload smoke test
when a browser backend is connected. Component/E2E tooling, curated drill content, the custom-set
builder, and persistence-status UX remain deliberate follow-up rather than part of this readiness
slice.
