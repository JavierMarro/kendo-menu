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
- The guest dashboard uses Zustand with browser LocalStorage; a verified signed-in dashboard uses
  Zustand with an account-scoped IndexedDB cache and cloud API. Persisted JSON is untrusted and must
  be validated, versioned, and migrated when its shape changes.
- The verified account workspace foundation and local backend contracts are implemented on the
  integration branch. Public Google entry and guest adoption remain unmounted in 6D-A; the account
  service has not been deployed or connected to real Google accounts. This document does not
  authorize deployment or provisioning. Paid tiers and initialization of `apps/mobile` remain out
  of scope.

## Account journey — local integration only

Anonymous use remains fully supported and free. Planned optional Google-only KendoMenu accounts add
cross-device continuity through local-first, whole-dashboard synchronization with explicit conflict
handling. Guest and account workspaces remain separate; signing in must not silently combine them.

A planned blocking Yes/No guest-adoption choice applies only to a **newly created KendoMenu account**
when this browser has an eligible guest dashboard. Yes copies the complete guest dashboard into the
account; the guest LocalStorage copy stays unchanged, even after server acknowledgement. No
permanently declines the offer and also leaves the guest dashboard unchanged. There is no dismiss
action. Returning accounts never receive another offer, even with an empty cloud dashboard. Later
changes in either workspace cause no new offer or automatic transfer; a future manual import feature
is a separate decision. After successful sign-in, guest use requires signing out, which returns to
the homepage. An empty cloud dashboard alone does not prove a new account or create a default menu.

Realtime connections, CRDTs, automatic field merging, collaboration, paid tiers, and public sharing
are excluded. The verified account workspace foundation is implemented locally; public account
entry, guest adoption, and cross-device continuity are not current production functionality.
See [ADR 0006](docs/adr/0006-independent-dashboards-one-time-guest-copy.md) and the
[account and synchronization design](docs/ACCOUNT_SYNC.md) for accepted decisions,
recommendations awaiting confirmation, and the gates for later implementation jobs.

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
