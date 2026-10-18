# KendoMenu project skills

These seven project-owned skills are discoverable from `.agents/skills`. Load only the workflow
needed for the task. Skill descriptions help routing; the full instructions are loaded on demand.

## Skill map

- [`kendomenu-web-feature`](./kendomenu-web-feature/SKILL.md): implement or review a local-first web
  feature across Zustand, browser integration, and accessible React UI; keep guest and online
  account stores separate during the managed-auth transition.
- [`kendomenu-api-feature`](./kendomenu-api-feature/SKILL.md): Elysia routes, verified-identity
  authorization, PostgreSQL transactions, Drizzle migrations, and guarded local integration tests.
- [`testing-fuzz-stress`](./testing-fuzz-stress/SKILL.md): the `/antirez`-style black-box fuzzing and
  stress-testing workflow with seeded reproducibility and state-space reporting.
- [`pre-commit-verification`](./pre-commit-verification/SKILL.md): the translated verification
  modes: `scoped`, `quick`, `full`, `pre-commit`, `pre-pr`, `healthcheck`, and `scan`.
- [`code-reviewer-pre-commit`](./code-reviewer-pre-commit/SKILL.md): semantic changed-code review,
  data-flow tracing, security checks, and counter-hypotheses.
- [`onboarding-code-comments`](./onboarding-code-comments/SKILL.md): explicitly invoked, behavior-
  preserving senior-engineer comments for a selected handwritten implementation scope.

## Workflow composition

- `kendomenu-web-feature` may route a cross-package slice to the testing or verification skills when
  those workflows are actually required.
- Use `kendomenu-api-feature` for backend changes; load both feature skills only for a cross-package
  task. Do not install generic Neon/PostgreSQL skills or an MCP connection merely to run local tests.
- `pre-commit-verification` uses `code-reviewer-pre-commit` for its bounded semantic review stage.

Fuzzing is for a requested bounded attack, not every review. Onboarding comments remain explicit-only.
Reuse valid evidence instead of loading every workflow or repeating the same check through each skill.

## Installed plugin skills

Use the installed Ponytail core skill (`$ponytail:ponytail`) in `full` mode by default for coding
plans, implementation, fixes, and code review, not general conversation. Read its installed
`SKILL.md`; do not copy the plugin into this repository or pin a machine-specific cache path here.
Honor explicit level changes and `stop ponytail` / `normal mode`. If unavailable, report that briefly
and retain the reuse-first, minimum-scope approach without installing anything automatically.

Ponytail complements the matching project workflow; it does not replace semantic review or the
required verification matrix. Use existing tests and frameworks, and preserve the approved journey
and safety invariants. Its review skill is a read-only complexity review, not a correctness or
security verdict. Load review, whole-repo audit, debt, or gain skills only when requested; do not add
automatic audits, ledgers, metrics, or hooks to ordinary feature work.

Skills remain subordinate to the user's request, `AGENTS.md`, repository permissions, and explicit
authorization boundaries.
