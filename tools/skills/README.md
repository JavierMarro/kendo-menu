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

## Recommended order

1. Read `AGENTS.md` and this index before substantial implementation.
2. Use `testing-fuzz-stress` when robustness or state-space testing is requested.
3. Use `pre-commit-verification` before a commit or pull request.
4. Use `code-reviewer-pre-commit` for the semantic review stage, especially from `scan`.
5. Use `work-session-history` to record the completed session and its roadblocks.

All skills are guidance and must still respect the user's request, repository permissions, and the
project's strict TypeScript and pnpm conventions.
