---
name: pre-commit-verification
description: Run layered build, quality, formatting, debug-log, secret, dependency, and static checks with explicit verification modes and a PASS or FAIL readiness table. Use before commits, pull requests, releases, or when asked for a project healthcheck or autonomous verification scan.
---

# Pre-commit Verification

Provide one consistent verification workflow for the repository. Accept one optional mode; default
to `full`:

`quick`, `full`, `pre-commit`, `pre-pr`, `healthcheck`, or `scan`.

These are Codex modes, not Claude slash commands. Do not assume `$BUILD`, `/code-review`, a
particular runtime, or a particular audit tool exists. Detect the repository toolchain first and
translate each check into the available commands.

## Safety and setup

1. Read `AGENTS.md`, `README.md`, workspace configuration, package manifests, and existing CI/hooks.
2. Detect the package manager from `packageManager`, lockfiles, and scripts. For KendoMenu, use pnpm
   from the repository root; prefer `pnpm check` as the existing typecheck/lint/format/build baseline.
3. Use `rg` for source searches and exclude dependency/build directories. Do not print secret values.
4. Keep checks read-only unless the selected mode explicitly allows safe local fixes. Never run
   `git reset --hard`, `git clean`, broad deletion, force-push, or dependency upgrades as a fix.
5. Ask for approval before network-dependent audits or any command that needs elevated permissions.

## Mode matrix

| Mode          | Required work                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `quick`       | Run the production build only. Stop at the first failure.                                                        |
| `full`        | Build, lint, tests, format check, debug-log scan, and git status. This is the default.                           |
| `pre-commit`  | Run `full` without git status.                                                                                   |
| `pre-pr`      | Run `full`, then hardcoded-secret scan, dependency audit, and static-analysis scan.                              |
| `healthcheck` | Diagnose runtimes, git health, project health, hooks, zombie processes, and ports; apply only safe, local fixes. |
| `scan`        | Run `healthcheck`, then at most three review → fix → verify loops, then use the semantic-review skill.           |

Missing tooling is never silently treated as passing. Report `NOT CONFIGURED` or `NOT APPLICABLE`
with a reason. Treat a required but missing test command as a readiness warning or failure according
to repository policy, rather than claiming full confidence.

## Core checks

### Build, type, lint, tests, and format

- Run the repository's documented build command and record the exact command and exit status.
- Run typechecking and linting when separate from build. Preserve strict TypeScript rules; do not
  suppress errors to make a commit green.
- Run the configured test command, including integration tests when the repository defines them.
- Run the formatter in check mode. Do not rewrite files during a read-only verification mode.
- For KendoMenu, `pnpm check` covers typecheck, ESLint, Prettier, Vitest, and the production web
  build.

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
Record network failures separately from vulnerability findings. Scan for explicit or implicit `any`,
`@ts-ignore`, `@ts-nocheck`, unjustified lint disables, unsafe eval, and broad error swallowing.

### Healthcheck

Report runtime/package-manager versions, lockfile/install health, git branch and worktree state,
configured hooks, missing required files, orphaned processes, and ports in use. Use read-only process
and port inspection. Safe fixes may include formatting, creating missing cache directories, or
reinstalling from an existing lockfile when authorized; do not kill unrelated processes or modify
deployment state.

## Scan loop

`scan` is bounded and evidence-driven:

1. Run `healthcheck` and collect all failures.
2. Review the failing output and changed files.
3. Apply only scoped, reversible fixes that are within the user's request.
4. Re-run the failed checks. Repeat review → fix → verify no more than three iterations.
5. Invoke or read `tools/skills/code-reviewer-pre-commit/SKILL.md` for the semantic review stage.
6. Stop with `NEEDS WORK` when failures remain, the toolchain is unavailable, or a required check
   could not be trusted.

## Output contract

Return a compact table and a verdict. Use `PASS`, `FAIL`, `WARN`, `SKIPPED`, or `NOT CONFIGURED` for
each row; include the command and a short reason.

```markdown
| Check           | Status            | Evidence                      |
| --------------- | ----------------- | ----------------------------- |
| Build           | PASS/FAIL         | command and result            |
| Lint            | PASS/FAIL         | command and result            |
| Tests           | PASS/FAIL/WARN    | command or why missing        |
| Format          | PASS/FAIL         | command and result            |
| Debug logs      | PASS/WARN         | scan scope and findings       |
| Secrets         | PASS/FAIL/SKIPPED | scan scope, never values      |
| Dependencies    | PASS/WARN/SKIPPED | audit and network status      |
| Static analysis | PASS/WARN         | patterns and findings         |
| Git status      | PASS/SKIPPED      | only in full/healthcheck/scan |
```

End with `Ready for commit: YES` only when all required checks pass and no unresolved warning can
affect correctness or security. Otherwise end with `Ready for commit: NO` and list the smallest next
actions.
