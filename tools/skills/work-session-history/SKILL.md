---
name: work-session-history
description: Record completed coding work sessions in a repository's docs/work-sessions history, including changes, decisions, failures or roadblocks, verification, and follow-up context. Use when a session ends or when asked to create, update, or backfill a work-session record.
---

# Work Session History

Create a concise, factual Markdown record for every completed work session. Treat the record as
onboarding history for future agents, not as a diary or a replacement for code documentation.

## Workflow

1. Read the repository's `AGENTS.md`, `docs/work-sessions/README.md`, and the newest existing
   session entry before writing. Follow repository-specific naming and formatting rules.
2. Establish the session date and duration. Use the duration supplied by the user or runtime; do
   not invent precision. If the date is uncertain, use the repository's current date and state the
   assumption in the entry.
3. Gather evidence from the worktree: changed files, important commands, test/build output, and
   tool failures. Separate resolved roadblocks from remaining blockers.
4. From the repository root, run the generator when available:

   ```bash
   pnpm session:new -- --slug <short-slug> --duration "<duration>" [--date YYYY-MM-DD]
   ```

   If the generator is unavailable, create `docs/work-sessions/YYYY-MM-DD-<short-slug>.md`
   directly. Never overwrite an existing session entry.

5. Fill every required section with concise facts:
   - scope, duration, and starting state
   - main changes and architectural decisions
   - failures, roadblocks, and their resolutions
   - verification actually performed
   - follow-up context for the next agent
6. Update `docs/work-sessions/README.md` when the repository's index requires a new entry. Run the
   narrowest relevant formatting or documentation check before handing off.

## Evidence and writing rules

- Prefer observed facts over narrative. Name the relevant files, commands, and outcomes.
- Record failed commands even when resolved; include the cause and the next successful approach.
- Say `not run` when a check was not performed. Never imply that a build or test passed without
  evidence.
- Mention deliberate scope exclusions so future agents do not mistake placeholders for completed
  features.
- Keep entries short enough to scan during onboarding. Avoid secrets, credentials, and private data.

## Project helper

For KendoMenu, `scripts/new-work-session.sh` is exposed as `pnpm session:new`. It creates the dated
template and refuses duplicate paths; the agent remains responsible for supplying accurate content.
