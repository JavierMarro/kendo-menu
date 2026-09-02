# KendoMenu project skills

These five versioned, project-owned Codex skills are natively discoverable from `.agents/skills`.
Load a skill only when its described workflow matches the current task; ordinary work does not need
every skill.

## Skill map

- [`kendomenu-web-feature`](./kendomenu-web-feature/SKILL.md): implement or review a local-first web
  feature across the domain, Zustand persistence, browser integration, and accessible React UI
  boundaries.
- [`testing-fuzz-stress`](./testing-fuzz-stress/SKILL.md): the `/antirez`-style black-box fuzzing and
  stress-testing workflow with seeded reproducibility and state-space reporting.
- [`pre-commit-verification`](./pre-commit-verification/SKILL.md): the translated verification
  modes: `quick`, `full`, `pre-commit`, `pre-pr`, `healthcheck`, and `scan`.
- [`code-reviewer-pre-commit`](./code-reviewer-pre-commit/SKILL.md): semantic changed-code review,
  data-flow tracing, security checks, and counter-hypotheses.
- [`work-session-history`](./work-session-history/SKILL.md): create the required evidence-based,
  eight-line session handoff and validate the history policy.

## Workflow composition

- `kendomenu-web-feature` may route a cross-package slice to the testing or verification skills when
  those workflows are actually required.
- `pre-commit-verification` uses `code-reviewer-pre-commit` for its bounded semantic review stage.
- `work-session-history` records the completed work after verification evidence is known.

Skills remain subordinate to the user's request, `AGENTS.md`, repository permissions, and explicit
authorization boundaries.
