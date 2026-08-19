# Work session: codex project skills

- Date: 2026-08-19
- Duration: not recorded

## Scope

Create durable project-local Codex skills by adapting the supplied Claude-style fuzzing, verification,
and semantic code-review workflows, including translation of the Spanish sections.

## Starting state

KendoMenu already had the project-local `work-session-history` skill and a `tools/skills` convention,
but no testing, pre-commit verification, or semantic-review source of truth. The supplied workflows
used Claude slash-command notation and Spanish mode descriptions.

## Main changes

- Added `tools/skills/testing-fuzz-stress/SKILL.md` for black-box, seeded, state-space fuzzing and
  stress testing with boundary, fuzz, round-trip, corruption, stress, and concurrency categories.
- Added `tools/skills/pre-commit-verification/SKILL.md` with Codex-native `quick`, `full`,
  `pre-commit`, `pre-pr`, `healthcheck`, and bounded `scan` modes.
- Added `tools/skills/code-reviewer-pre-commit/SKILL.md` for changed-file scope detection, complete
  file reading, function tracing, data-flow analysis, OWASP-oriented checks, and counter-hypotheses.
- Added `tools/skills/README.md` as the pre-coding index and updated `AGENTS.md` and `README.md` to
  make the skills discoverable before heavy work.
- Generated `agents/openai.yaml` metadata for each new skill.
- Translated the supplied Spanish verification and review requirements into English SKILL.md files.

## Decisions

- Kept the skills project-local and versioned under `tools/skills` so future agents receive the same
  KendoMenu-specific instructions.
- Replaced Claude-specific `/antirez`, `/code-review`, and `$BUILD` assumptions with named Codex
  skill files, detected repository commands, and explicit mode arguments.
- Kept the skills guidance-only and read-only by default. Safe fixes may be proposed or applied only
  when the selected workflow and user request authorize them.
- Required explicit `PASS`, `FAIL`, `WARN`, `SKIPPED`, or `NOT CONFIGURED` evidence rather than
  silently treating unavailable tooling as success.

## Failures and roadblocks

1. A first large patch failed because an added shell `done` line lacked the patch `+` prefix. The
   skill files were recreated with smaller, valid patches.
2. Prettier initially reported the generated skill metadata and Markdown as unformatted. Running the
   repository formatter resolved this.

No product or repository tooling blockers remain.

## Verification

- The skill-creator validator passed for all four project skills.
- `pnpm format:check` passed.
- `pnpm check` passed typechecking, ESLint, Prettier, and the production Vite build.
- Confirmed the new skills contain no initializer TODO placeholders.

## Follow-up context

Before substantial implementation, read `tools/skills/README.md` and the applicable SKILL.md. Use
`testing-fuzz-stress` for robustness attacks, `pre-commit-verification` before handoff, and
`code-reviewer-pre-commit` for semantic review. Keep future project skills in English and adapt any
external workflow to Codex tools, pnpm commands, repository permissions, and AGENTS.md rules.
