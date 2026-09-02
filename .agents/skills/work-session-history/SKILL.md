---
name: work-session-history
description: Record completed work sessions as evidence-based handoffs with a strict eight-line maximum. Use when a session ends or when asked to create, compact, update, or backfill repository work-session history.
---

# Work Session History

Create a factual Markdown record for every completed work session. Treat it as a tiny handoff for
future agents, not a diary or a replacement for code documentation. Every dated entry has a hard
maximum of eight physical lines.

## Workflow

1. Read `AGENTS.md`, `docs/work-sessions/README.md`, and the newest dated entry.
2. Gather the date, duration, durable outcomes, architectural decisions, reusable roadblocks,
   verification evidence, and actionable follow-up. Omit transient command or patch noise.
3. Run the generator when available:

   ```bash
   pnpm session:new -- --slug <short-slug> --duration "<duration>" [--date YYYY-MM-DD]
   ```

   If unavailable, create `docs/work-sessions/YYYY-MM-DD-<short-slug>.md` directly. Never overwrite
   an entry.

4. Fill the fixed lines: title; date/duration; scope/start; changes; decisions; roadblocks;
   verification; follow-up. Do not add blank lines, headings, or wrapped continuation lines. Use
   semicolons when one line needs multiple facts.
5. Update the history index when adding an entry. Run `pnpm session:check` and the narrowest
   formatting or documentation check.

## Evidence and writing rules

- Prefer observed facts over narrative. Keep only information that changes future work.
- Record a failure only when it leaves a blocker or a reusable lesson.
- Say `not run` when a check was not performed. Never imply that a check passed without evidence.
- Mention only material scope exclusions. Avoid secrets, credentials, and private data.
- Never exceed eight physical lines, even when the session was large.

## Project helper

For KendoMenu, `pnpm session:new` creates the fixed template and refuses duplicate paths;
`pnpm session:check` enforces the cap. The agent remains responsible for accurate prioritization.
