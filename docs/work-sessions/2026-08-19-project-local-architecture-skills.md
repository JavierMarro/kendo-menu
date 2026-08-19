# Work session: project local architecture skills

- Date: 2026-08-19
- Duration: not recorded

## Scope

Add the three previously global Codex skills to KendoMenu's versioned project-local skill set.

## Starting state

The skills existed under `/Users/javiermartinez-romera/.codex/skills`, but the repository's
`tools/skills` directory contained only the original project-local skills.

## Main changes

- Added `tools/skills/improve-codebase-architecture/` with its skill instructions, HTML report
  guidance, and Codex metadata.
- Added `tools/skills/codebase-design/` with its skill instructions, deepening guidance, interface
  design guidance, and Codex metadata.
- Added `tools/skills/domain-modeling/` with its skill instructions, ADR/context templates, and
  Codex metadata.
- Updated `tools/skills/README.md` with the new skill map entries and recommended order.

## Decisions

- Kept the user-level skill installations and added matching copies to the repository so the
  project workflow is versioned and available to future agents.
- Resolved the requested `domain-modelling` name to the published `domain-modeling` skill.

## Failures and roadblocks

- Full `pnpm format:check` reported 207 files, largely pre-existing files in the bundled
  `.agents/skills` tree; the newly added files were formatted separately.
- The first README patch did not match the repository's wrapped bullet lines; it was split into a
  corrected patch and applied successfully.

## Verification

- Compared each new project-local skill directory with its global source using `diff -rq`; all
  three matched with the expected file counts before session-local formatting.
- `git diff --check`: passed.
- Targeted `pnpm exec prettier --check` over all changed Markdown/YAML files: passed.
- Full `pnpm format:check`: failed because of the pre-existing repository-wide warnings described
  above.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm check`: not run; this session changed
  skill documentation and metadata only.

## Follow-up context

Use [`tools/skills/README.md`](../../tools/skills/README.md) to select the architecture and domain
modeling workflows. The new directories are untracked until the user commits them.
