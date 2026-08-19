# KendoMenu project skills

These are versioned, project-local Codex skills. Read this index and the applicable `SKILL.md`
before heavy coding, testing, verification, or review. They adapt the supplied Claude-style
workflows to Codex: use the skill names below rather than assuming Claude slash commands or shell
variables exist, and keep the instructions in English so every agent has one durable source of truth.

## Skill map

- [`work-session-history`](./work-session-history/SKILL.md): create factual work-session history
  entries at the end of every session.
- [`testing-fuzz-stress`](./testing-fuzz-stress/SKILL.md): the `/antirez`-style black-box fuzzing and
  stress-testing workflow with seeded reproducibility and state-space reporting.
- [`pre-commit-verification`](./pre-commit-verification/SKILL.md): the translated verification
  modes: `quick`, `full`, `pre-commit`, `pre-pr`, `healthcheck`, and `scan`.
- [`code-reviewer-pre-commit`](./code-reviewer-pre-commit/SKILL.md): semantic changed-code review,
  data-flow tracing, security checks, and counter-hypotheses.
- [`codebase-design`](./codebase-design/SKILL.md): shared vocabulary for deep-module design and seam
  placement.
- [`domain-modeling`](./domain-modeling/SKILL.md): sharpen the project's domain language and record
  durable decisions.
- [`improve-codebase-architecture`](./improve-codebase-architecture/SKILL.md): find architectural
  friction and propose deepening opportunities.

## Recommended order

1. Read `AGENTS.md` and this index before substantial implementation.
2. Use `codebase-design` when designing or restructuring module interfaces and seams.
3. Use `domain-modeling` when resolving domain terminology or recording architectural decisions.
4. Use `improve-codebase-architecture` to survey architectural friction before a broad refactor.
5. Use `testing-fuzz-stress` when robustness or state-space testing is requested.
6. Use `pre-commit-verification` before a commit or pull request.
7. Use `code-reviewer-pre-commit` for the semantic review stage, especially from `scan`.
8. Use `work-session-history` to record the completed session and its roadblocks.

All skills are guidance and must still respect the user's request, repository permissions, and the
project's strict TypeScript and pnpm conventions.
