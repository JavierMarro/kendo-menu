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
- [`work-session-history`](./work-session-history/SKILL.md): create the required evidence-based,
  eight-line session handoff and validate the history policy.
- [`onboarding-code-comments`](./onboarding-code-comments/SKILL.md): explicitly invoked, behavior-
  preserving senior-engineer comments for a selected handwritten implementation scope.

## Workflow composition

- `kendomenu-web-feature` may route a cross-package slice to the testing or verification skills when
  those workflows are actually required.
- Use `kendomenu-api-feature` for backend changes; load both feature skills only for a cross-package
  task. Do not install generic Neon/PostgreSQL skills or an MCP connection merely to run local tests.
- `pre-commit-verification` uses `code-reviewer-pre-commit` for its bounded semantic review stage.
- `work-session-history` records the completed work after verification evidence is known.

Fuzzing is for a requested bounded attack, not every review. Onboarding comments remain explicit-only.
Reuse valid evidence instead of loading every workflow or repeating the same check through each skill.

Skills remain subordinate to the user's request, `AGENTS.md`, repository permissions, and explicit
authorization boundaries.
