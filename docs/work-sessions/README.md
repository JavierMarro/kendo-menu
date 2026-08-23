# KendoMenu work-session history

This directory is the chronological point of truth for development sessions. Each dated entry is a
tiny handoff containing only the facts that materially affect future work.

## Naming and contents

Use `YYYY-MM-DD-short-slug.md`. Every dated entry has a hard maximum of eight physical lines:

- title
- date/duration, scope/start, changes, decisions, roadblocks, verification, and follow-up bullets

Do not add blank lines, section headings, or wrapped continuation lines. Keep only durable outcomes,
reusable roadblocks, actual verification, and actionable follow-up.

## Automation

Create a correctly named, non-overwriting template from the repository root:

```bash
pnpm session:new -- --slug <short-slug> --duration "<duration>"
```

Add `--date YYYY-MM-DD` when recording a previous session. Replace every placeholder, then run
`pnpm session:check`. The project-local skill defines the prioritization workflow.

## Sessions

- [2026-08-23 — landing typography](./2026-08-23-landing-typeset.md)
- [2026-08-23 — landing page bolder refinement](./2026-08-23-landing-bolder.md)
- [2026-08-23 — final landing page UX audit](./2026-08-23-ui-ux-final-audit.md)
- [2026-08-23 — landing page polish hierarchy](./2026-08-23-landing-polish-hierarchy.md)
- [2026-08-23 — compact footer](./2026-08-23-compact-footer.md)
- [2026-08-23 — landing page content sections](./2026-08-23-landing-page-content-sections.md)
- [2026-08-22 — responsive site footer](./2026-08-22-responsive-site-footer.md)
- [2026-08-21 — cookie layout refinement](./2026-08-21-cookie-layout-refinement.md)
- [2026-08-21 — cookie privacy notice](./2026-08-21-cookie-privacy-notice.md)
- [2026-08-21 — responsive wordmark breakpoint](./2026-08-21-responsive-wordmark-breakpoint.md)
- [2026-08-21 — responsive burger navigation](./2026-08-21-responsive-burger-navigation.md)
- [2026-08-21 — landing page polish](./2026-08-21-landing-page-polish.md)
- [2026-08-21 — landing page logo hero](./2026-08-21-landing-page-logo-hero.md)
- [2026-08-20 — routed training planner](./2026-08-20-routed-training-planner.md)
- [2026-08-19 — branch size audit](./2026-08-19-branch-size-audit.md)
- [2026-08-19 — persistence test readiness](./2026-08-19-persistence-test-readiness.md)
- [2026-08-19 — project-local architecture skills](./2026-08-19-project-local-architecture-skills.md)
- [2026-08-19 — Impeccable init](./2026-08-19-impeccable-init.md)
- [2026-08-19 — Codex project skills](./2026-08-19-codex-project-skills.md)
- [2026-08-19 — session history automation](./2026-08-19-session-history-automation.md)
- [2026-08-18 — project initialization](./2026-08-18-project-initialization.md)
