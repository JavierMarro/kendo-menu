---
name: code-reviewer-pre-commit
description: Perform a semantic review of changed files before commit or pull request by tracing functions and data flow, checking logic, error handling, security, design quality, code smells, and counter-hypotheses. Use when asked to review changed code or challenge an implementation beyond linting.
---

# Code Reviewer: Pre-commit

Review behavior, not just syntax. This is a read-only review by default; do not modify files, commit,
push, or open a pull request unless the user separately asks for implementation or coordination.
Return `PASS` only when the evidence supports it. Do not rubber-stamp.

## Scope and evidence

- Accept optional file or directory paths. Otherwise collect tracked changes with
  `git diff --name-only HEAD` and relevant untracked files from `git status --short`.
- Apply `AGENTS.md` and read enough context to assess each change, including affected contracts,
  callers, state boundaries, side effects, persistence, and error paths. Expand beyond diff hunks
  where needed; consult README, session history, configuration, or whole files only when relevant.
- For KendoMenu, use pnpm commands from root package scripts. Inspect configuration when a command
  or its coverage is unclear.
- Reuse verification evidence covering the current changes and configuration. Run checks when
  evidence is absent, stale, or relevant to a finding; preserve repository-required gates.
  A baseline failure belongs in the report and does not prevent semantic analysis.
- Account for deleted, renamed, untracked, and generated files where they affect behavior;
  explain material scope exclusions.

Use function tracing tables when complexity or risk makes them useful, not for every touched
function. Check affected inputs, outputs, nullable values, async errors, mutations, and caller
invariants.

## Data-flow analysis

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

## Review concerns

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

## Risk-based investigation

Use counter-hypotheses for plausible failure modes in risky or complex changes, rather than requiring
one per function. Investigate material concerns with code, types, existing tests, or a read-only
reproduction. Distinguish confirmed defects, disproved concerns, and unresolved risks.

## Output

Report scope, verification evidence (reused or newly run), findings, material limitations, and a
`PASS` or `NEEDS WORK` verdict. Include tracing tables or counter-hypothesis results only when they
help explain findings or the user requests them.

Every issue must include impact, reproduction or reasoning, and a precise `file:line` location when
available. Distinguish observed defects from recommendations. Use `NEEDS WORK` for unresolved
critical or security issues, a broken required baseline, or a material risk that prevents confidence
in the change. Do not treat an unsupported hypothetical as a confirmed defect.
