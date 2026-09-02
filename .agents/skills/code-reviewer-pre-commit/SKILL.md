---
name: code-reviewer-pre-commit
description: Perform a semantic review of changed files before commit or pull request by tracing functions and data flow, checking logic, error handling, security, design quality, code smells, and counter-hypotheses. Use when asked to review changed code or challenge an implementation beyond linting.
---

# Code Reviewer: Pre-commit

Review behavior, not just syntax. This is a read-only review by default; do not modify files, commit,
push, or open a pull request unless the user separately asks for implementation or coordination.
Return `PASS` only when the evidence supports it. Do not rubber-stamp.

## 0. Detect scope and toolchain

- Accept optional file or directory paths. If none are supplied, collect tracked changes with
  `git diff --name-only HEAD` and include relevant untracked files from `git status --short`.
- Read `AGENTS.md`, `README.md`, and the newest work-session entry before reviewing.
- Detect the toolchain from repository guidance, `package.json`/workspace manifests, lockfiles,
  `Makefile`, `go.mod`, `Cargo.toml`, `pyproject.toml`, and CI configuration in that order of
  relevance. For KendoMenu, use pnpm and TypeScript commands from the root package scripts.
- Run typecheck and lint as an informational baseline when available. A baseline failure is evidence
  for the report, not a reason to skip semantic analysis.

## 1. Read all changed files

Read every changed file completely, not only the diff hunk. For each file identify its language,
framework, public exports, state boundaries, side effects, persistence, and error paths. Read nearby
callers, types, tests, and configuration when needed to understand the contract. Treat generated or
lock files separately and do not spend review effort inventing logic inside them.

Include a scope note when a file is deleted, renamed, untracked, generated, or excluded, and explain
why it is or is not part of the semantic review.

## 2. Function tracing table

Create a table for every touched function, method, hook, component with meaningful behavior, or
exported factory:

| Function | File        | Parameters   | Return type  | Behavior summary                     |
| -------- | ----------- | ------------ | ------------ | ------------------------------------ |
| `name`   | `path:line` | typed inputs | typed output | observable behavior and side effects |

Check that parameter and return types match actual behavior, nullable values are handled, async
errors are observable, mutations are intentional, and callers receive the invariants they expect.

## 3. Data-flow analysis

For each critical route, trace creation → validation → transformation → storage/transport →
consumption. Cover whichever are present:

- user input and form state
- authentication tokens and permissions
- database reads/writes and migrations
- API requests/responses and serialization
- browser LocalStorage or native persistence
- async actions, retries, cancellation, and duplicate submissions

At each boundary identify the invariant, trust level, failure behavior, and whether sensitive data is
logged or exposed. If a route is not present, state `N/A`; do not fabricate a security conclusion.

## 4. Review checklist

Look for concrete evidence of:

- **Logic correctness:** off-by-one errors, stale closures, wrong branching, ordering, idempotence,
  race conditions, invalid assumptions, and incorrect default behavior.
- **Design quality:** coherent domain boundaries, unnecessary coupling, duplicated sources of truth,
  leaky abstractions, platform-specific code in shared packages, and avoidable complexity.
- **Error handling:** rejected promises, partial writes, malformed persisted data, missing loading or
  empty states, swallowed errors, retry storms, and unsafe recovery.
- **Security:** injection, XSS, auth bypass, secret exposure, unsafe deserialization, insecure
  persistence, overbroad permissions, and relevant OWASP quick-scan concerns.
- **Code smells:** `any`, unsafe casts, ignored type errors, unjustified lint disables, hidden global
  state, dead code, fragile string paths, and tests coupled to implementation details.

Use repository conventions as the source of truth. Do not demand a framework, dependency, or pattern
that the project has deliberately not adopted.

## 5. Counter-hypothesis

For every critical function or data route, write at least one concrete counter-hypothesis: a scenario
in which the implementation could fail despite the happy path. Try to disprove it with code, tests,
types, or a small read-only reproduction. Record the result as confirmed, disproved, or unresolved.

Examples include: storage hydration completes after render; two updates serialize out of order; a
custom id collides; a malformed response bypasses validation; a mobile adapter lacks a browser API;
or an empty collection is treated as a valid selected item.

## Output

Return structured Markdown with evidence and file:line locations:

```markdown
## Scope and baseline

## Function Tracing Table

## Data Flow Analysis

## Critical Issues

<!-- correctness or security defects that should block the change -->

## Warnings

<!-- material risks or missing safeguards -->

## Suggestions

<!-- non-blocking improvements -->

## Counter-Hypothesis Results

<!-- one result for each critical function or route -->

## Security

## Verdict

PASS or NEEDS WORK
```

Every issue must include impact, reproduction or reasoning, and a precise `file:line` location when
available. Distinguish observed defects from recommendations. Use `NEEDS WORK` for any unresolved
critical issue, security issue, broken baseline, or counter-hypothesis that could not be disproved.
