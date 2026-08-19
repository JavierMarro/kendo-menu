# KendoMenu work-session history

This directory is the chronological point of truth for development sessions. Each session gets a
short Markdown document so a future contributor or coding agent can understand what changed, what
was attempted, which problems occurred, and where to continue.

## Naming and contents

Use `YYYY-MM-DD-short-slug.md`. Keep entries factual and concise. Every entry should include:

- date and approximate duration
- scope and starting state
- main changes and decisions
- failures, roadblocks, and resolutions
- verification performed
- follow-up work or context for the next session

The newest entry should be the first place to look when onboarding to recent work. This history is
complementary to the repository code, README, and `AGENTS.md`; it does not replace them.

## Automation

Create a correctly named, non-overwriting template from the repository root:

```bash
pnpm session:new -- --slug <short-slug> --duration "<duration>"
```

Add `--date YYYY-MM-DD` when recording a previous session. The generator creates every required
section, but the agent must still replace the placeholders with evidence-based content. The
project-local skill at `tools/skills/work-session-history/SKILL.md` defines the workflow.

## Sessions

- [2026-08-19 — Impeccable init](./2026-08-19-impeccable-init.md)
- [2026-08-19 — Codex project skills](./2026-08-19-codex-project-skills.md)
- [2026-08-19 — session history automation](./2026-08-19-session-history-automation.md)
- [2026-08-18 — project initialization](./2026-08-18-project-initialization.md)
