# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Individual kendo practitioners preparing and carrying out a focused practice session. They need to
choose useful drills, adapt the amount of work to the day, and keep lightweight notes as part of
their practice routine.

## Product Purpose

KendoMenu is a deployed, local-first production MVP. It lets practitioners browse curated training
sessions, add them to a dashboard, adjust activity quantities, attach notes, and create custom
training sessions. A practitioner can assemble and adapt a useful session on the same device without
an account, server, or network dependency.

## Positioning

KendoMenu combines a curated drill library with session-level adaptation and practitioner-authored
training sessions. Built-in and custom sessions share one recursive activity model while browser
storage keeps the workflow local-first.

## Operating Context

Practitioners use the web app to prepare a day's keiko, select a built-in or custom training session,
and shape it for the current practice. A dashboard entry is the selected session snapshot whose
activity quantities and notes can be adapted without mutating the built-in library.

## Capabilities and Constraints

- The library contains exactly 11 curated built-in training sessions. Custom training sessions
  appear on the dashboard only.
- Practitioners can add sessions to the dashboard, adjust per-activity quantities, attach dashboard
  and activity notes, and remove dashboard entries.
- Runtime sessions contain recursive `TrainingActivity` values. Every session and activity has a
  stable ID; quantity overrides are keyed by activity ID and then unit.
- Built-in sessions are immutable and marked `isBuiltIn: true`. Practitioner-authored sessions use
  the same model and are marked `isBuiltIn: false`.
- Curated content is authored in `packages/domain/data/default-drills.json`, validated against
  `packages/domain/schema/kendo-drills.schema.json`, and adapted by
  `packages/domain/src/default-training-sets.ts`.
- The production MVP is a React + Vite + TypeScript web app with React Router. Domain contracts live
  in `packages/domain`; the platform-neutral Zustand store lives in `packages/store` and receives an
  injected storage adapter.
- Browser LocalStorage is sufficient for the current bounded dataset. Persisted JSON is untrusted
  and must be validated, versioned, and migrated when its shape changes.
- Server infrastructure, accounts, remote sync, paid tiers, databases, API work, and initialization
  of `apps/mobile` remain out of scope until explicitly requested.

## Brand Commitments

The established product name is KendoMenu. Existing product language uses kendo practice and keiko
terminology. No additional brand assets, claims, or formal voice rules have been confirmed.

## Evidence on Hand

- `CONTEXT.md` defines the product and runtime vocabulary.
- `packages/domain/src/types.ts` defines recursive training activities and dashboard entries.
- `packages/domain/data/default-drills.json` and its schema contain the authored curated collection;
  `packages/domain/src/default-training-sets.ts` validates and adapts it for runtime use.
- `packages/store/src/index.ts` contains the injected-storage Zustand store factory.
- `apps/web` contains the deployed React/Vite product, routed library, dashboard, and custom-session
  builder.

Do not fabricate drills, metrics, testimonials, customers, benchmarks, or other product proof.

## Product Principles

- Keep core practice useful without accounts, servers, or network access.
- Help practitioners shape the session they intend to do today.
- Keep curated defaults immutable while dashboard entries own session-specific adaptation.
- Keep domain and state contracts platform-neutral without initializing speculative clients.
- Preserve a calm, focused practice experience with clear, accessible interactions.

## Accessibility & Inclusion

The web experience must preserve keyboard access, visible focus, semantic headings and labels,
useful empty/loading/error states, communication that does not rely on color alone, and usability on
mobile-sized screens.
