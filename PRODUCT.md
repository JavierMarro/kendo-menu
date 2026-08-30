# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Individual kendo practitioners preparing and carrying out a focused practice session. They need to
choose useful drills, adapt the amount of work to the day, and keep lightweight notes as part of
their practice routine.

## Product Purpose

KendoMenu is a local-first kendo training planner. It lets practitioners browse curated training
sets, add them to a dashboard, adjust exercise quantities, attach notes, and create custom training
sets.
Success means a practitioner can assemble and adapt a useful session quickly, with the session data
available on the same device without account or server overhead.

## Positioning

KendoMenu combines a curated drill library with session-level adaptation and user-created training
sets in a local-first workflow. The first milestone is useful without accounts, remote sync, or a
server, while keeping the domain and state contracts ready for a future mobile app and later
product decisions.

## Operating Context

Practitioners use the web SPA to prepare a day's keiko, select drills from the library, and shape
the work for the current practice. A dashboard entry represents a selected training set for a
session; its step quantities can be overridden by unit and notes can be attached. Browser storage
is the free-tier persistence boundary for the first milestone.

## Capabilities and Constraints

- The library contains exactly the 11 curated built-in training sets. User-created training sets
  appear on the dashboard only.
- Practitioners can add training sets to a dashboard, adjust per-step quantities, attach notes, and
  remove dashboard entries.
- Built-in training data is immutable, marked `isBuiltIn: true`, and uses stable ids for sets and
  steps. Dashboard quantity overrides are keyed first by step id and then by unit.
- User-created data uses the same domain model and is marked `isBuiltIn: false`.
- The first milestone is a React + Vite + TypeScript web SPA in a pnpm workspace. Domain contracts
  live in `packages/domain`; the platform-neutral Zustand store lives in `packages/store` and
  receives an injected storage adapter.
- Zustand `persist` and browser LocalStorage are sufficient for the current small data set. Persisted
  JSON is untrusted and must be versioned and migrated when its shape changes.
- `apps/mobile` is reserved for an Expo app after the shared domain and state contracts are stable.
- A server, accounts, remote sync, and paid tiers are later decisions, not requirements of this
  milestone. TanStack Query, a database, and an API are likewise out of scope until remote data or
  sync becomes real.
- Future catalogue additions and the server, account, sync, and tier decisions are still open.

## Brand Commitments

The established product name is KendoMenu. The existing product language uses kendo practice and
keiko terminology. No additional brand assets, claims, or formal voice rules have been confirmed.

## Evidence on Hand

- `AGENTS.md` contains the confirmed product brief and engineering constraints.
- `README.md` documents the local-first milestone, workspace boundaries, and future mobile direction.
- `packages/domain/src/types.ts` contains the typed training-set and dashboard-entry contracts.
- `packages/domain/src/default-training-sets.ts` contains the 11 researched built-in training sets;
  future work must not fabricate additional drills, testimonials, customers, benchmarks, or other
  proof.
- `packages/store/src/index.ts` contains the injected-storage Zustand store factory.
- `apps/web` contains the current React/Vite shell with dashboard and drill-library views.

## Product Principles

- Keep core practice useful without accounts, servers, or network access.
- Help practitioners shape the session they actually intend to do today.
- Treat curated drills and user-created sets as one coherent training model while keeping curated
  library defaults immutable and user-created sessions dashboard-owned.
- Keep domain and state contracts portable so a future native app can reuse them.
- Preserve a calm, focused practice experience with clear, accessible interactions.

## Accessibility & Inclusion

The web experience must preserve keyboard access, visible focus, semantic headings and labels,
useful empty/loading/error states, and communication that does not rely on color alone. Layouts must
remain usable on mobile-sized screens.
