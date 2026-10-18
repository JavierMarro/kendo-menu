---
name: pre-commit-verification
description: Verify KendoMenu changes before a commit, PR, or release, or run a requested healthcheck. Match checks to the changed scope and report evidence; not a semantic code review.
---

# Pre-commit Verification

Provide one consistent verification workflow. Default to `scoped` for a bounded task, and `full`
when the user asks for whole-branch readiness. Accept an explicit mode:

`scoped`, `quick`, `full`, `pre-commit`, `pre-pr`, `healthcheck`, or `scan`.

These are Codex modes, not Claude slash commands. Do not assume `$BUILD`, `/code-review`, a
particular runtime, or a particular audit tool exists. Detect the repository toolchain first and
translate each check into the available commands.

## Safety and setup

1. Read `AGENTS.md`, status/diff, and the affected package scripts. Inspect CI or hooks only when
   relevant to the requested gate; do not load every manifest for a documentation-only task.
2. Detect the package manager from `packageManager`, lockfiles, and scripts. For KendoMenu, use pnpm
   from the repository root. Use Node 24 for application checks; disclose another runtime rather
   than claiming Node 24 verification. Prefer existing scripts over invented duplicate workflows.
3. Use `rg` for source searches and exclude dependency/build directories. Do not print secret values.
4. Keep checks read-only unless the user explicitly requests fixes. Never run
   `git reset --hard`, `git clean`, broad deletion, force-push, or dependency upgrades as a fix.
5. Network dependence alone does not require extra approval. Honor existing authorization and the
   actual sandbox, privilege, data-transfer, production, and external-mutation permission boundaries;
   request approval when those boundaries require it.

## Mode matrix

| Mode          | Required work                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `quick`       | Run the production build only. Stop at the first failure.                                                 |
| `scoped`      | Run the AGENTS.md verification matrix for the changed scope, targeted formatting, and diff/status checks. |
| `full`        | Run `pnpm check`, scoped debug-log/static scans, and git status. Add affected API/database/browser gates. |
| `pre-commit`  | Run `full`; inspect staged and unstaged changes separately. Never stage or commit.                        |
| `pre-pr`      | Run `full`, then hardcoded-secret scan, dependency audit, and static-analysis scan.                       |
| `healthcheck` | Diagnose the requested project/tooling concern; inspect processes or ports only when relevant.            |
| `scan`        | Run healthcheck and semantic review; only if fixes are requested, use up to three fix-and-verify loops.   |

Missing tooling is never silently treated as passing. Report `NOT CONFIGURED` or `NOT APPLICABLE`
with a reason. Treat a required but missing test command as a readiness warning or failure according
to repository policy, rather than claiming full confidence.

For guidance/skills only, use targeted formatting, `git diff --check`, and skill/config validation;
do not run application or database suites. For comments only, use the comment skill's behavior-
preserving checks. Reuse successful checks for an unchanged diff and environment, record their
provenance, and rerun what subsequent changes invalidate. Serialize CPU-heavy suites to avoid load-
induced timeouts; required checks still need trustworthy evidence.

## Core checks

### Build, type, lint, tests, and format

- Run the repository's documented build command and record the exact command and exit status.
- Run typechecking and linting when separate from build. Preserve strict TypeScript rules; do not
  suppress errors to make a commit green.
- Run configured tests for affected behavior. For API changes add `pnpm check:api`; for PostgreSQL
  behavior use the guarded local `pnpm test:api:integration` harness. Missing `TEST_DATABASE_URL`
  is a blocker to database verification, not a skipped pass. Never substitute Neon/production.
- For schema changes run `pnpm db:check` and review generated SQL/metadata. Mocks and metadata
  checks alone do not prove migrations, rollback, locking, or concurrency.
- Run the formatter in check mode. Do not rewrite files during a read-only verification mode.
- For KendoMenu, `pnpm check` covers typecheck, ESLint, Prettier, Vitest, and the production web
  build.
- `pnpm check` does not include real PostgreSQL or browser suites. Use the AGENTS.md browser/PWA
  matrix for affected paths; use `pnpm verify:full` for a release. No local suite proves real Google,
  managed-provider, HTTPS-cookie, or deployed Vercel behavior.

### Debug-log scan

Use a scoped `rg` scan for `console.log`, `console.debug`, `debugger`, ad hoc prints, and temporary
markers. Exclude dependencies, build output, generated files, and documented test fixtures. Classify
each match as product code, intentional diagnostic code, test fixture, or false positive; never fail
solely because a deliberate diagnostic is documented and gated.

### Secret scan

In `pre-pr` and `scan`, inspect tracked and relevant untracked files for private-key headers, cloud
access-key shapes, tokens, passwords, connection strings, and accidental `.env` files. Prefer an
installed secret scanner; otherwise use conservative `rg` patterns and inspect matches without
echoing values. Respect `.env.example` and documented fixtures. Redact values in the report.

### Dependency and static analysis

In `pre-pr` and `scan`, run the ecosystem audit that matches detected manifests only when available:
`pnpm audit`/`npm audit`, `govulncheck`, `cargo audit`, or the repository's documented equivalent.
Do not install scanners or upgrade dependencies just to run this skill. Record network failures
separately from vulnerability findings. Scan for explicit or implicit `any`,
`@ts-ignore`, `@ts-nocheck`, unjustified lint disables, unsafe eval, and broad error swallowing.

### Healthcheck

Report runtime/package-manager versions, lockfile/install health, git branch and worktree state,
configured hooks, missing required files, orphaned processes, and ports in use. Use read-only process
and port inspection. Safe fixes may include formatting, creating missing cache directories, or
reinstalling from an existing lockfile when authorized; do not kill unrelated processes or modify
deployment state.

## Scan loop

`scan` is bounded and evidence-driven:

Without a request to fix, collect and review findings, then report them without editing.

1. Run `healthcheck` and collect all failures.
2. Review the failing output and changed files.
3. Apply only scoped, reversible fixes that are within the user's request.
4. Re-run the failed checks. Repeat review → fix → verify no more than three iterations.
5. Use `$code-reviewer-pre-commit` for the semantic review stage.
6. Stop with `NEEDS WORK` when failures remain, the toolchain is unavailable, or a required check
   could not be trusted.

## Output contract

Return a compact table and a verdict. Use `PASS`, `FAIL`, `WARN`, `SKIPPED`, or `NOT CONFIGURED` for
each row; include the command and a short reason. Omit irrelevant template rows and state material
exclusions once.

```markdown
| Check           | Status            | Evidence                 |
| --------------- | ----------------- | ------------------------ |
| Build           | PASS/FAIL         | command and result       |
| Lint            | PASS/FAIL         | command and result       |
| Tests           | PASS/FAIL/WARN    | command or why missing   |
| Format          | PASS/FAIL         | command and result       |
| Debug logs      | PASS/WARN         | scan scope and findings  |
| Secrets         | PASS/FAIL/SKIPPED | scan scope, never values |
| Dependencies    | PASS/WARN/SKIPPED | audit and network status |
| Static analysis | PASS/WARN         | patterns and findings    |
| Git status      | PASS/SKIPPED      | staged/unstaged scope    |
```

End with `Ready for commit: YES` only when all required checks pass and no unresolved warning can
affect correctness or security. Otherwise end with `Ready for commit: NO` and list the smallest next
actions. Distinguish bounded-task readiness from whole-branch/release readiness. Report inherited
failures explicitly; isolated reruns alone do not clear a required red full suite.
