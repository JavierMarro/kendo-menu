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
- The guest dashboard uses Zustand with browser LocalStorage and retains its offline/recovery behavior.
  Internal Migration C account routes use the same store factory with memory-only drafts and an
  explicit Save to account. Persisted guest JSON remains untrusted, validated, versioned and migrated.
- Migration A has owner-reported single-account Google/Neon identity and storage passes. Live B
  persistence, second-account/return-to-first and production HTTPS/Vercel checks remain unverified
  public-release gates. No deployment or provisioning is authorized. Paid tiers and initialization
  of `apps/mobile` remain out of scope.

## Account journey — internal Migrations C and D

[Migration C](docs/MANAGED_ACCOUNT_WEB.md) separates `/app/guest/*` and `/app/account/*` routes,
reusing the dashboard, library and custom-session builder. The landing offers Continue as a guest
and Continue with Google; each workspace has a dashboard shortcut. Guest use stays local and works
without authentication availability. Verified signed-in visitors entering guest routes go to the
matching account route. Account routes require verified identity; unresolved identity hides account
content and does not authorize analytics. Verified email is shown when supplied.

Account loading validates B's bearer-authenticated complete response before creating a memory-only
store. An empty account stays empty. Editing requires an online available service. **Save to
account** submits a frozen whole dashboard with the expected account, revision, catalogue and stable
request ID. Edits made during Save remain dirty after acknowledgement. An uncertain Save retries
its identical request; a revision conflict preserves the draft and offers download or explicit
reload. Failures retain this tab's draft without claiming local durability. Reloading or closing
can lose unsaved work; intentional discard is warned and browser leave warnings are best effort.
Sign-out hides account content, fences late requests and returns home.

Guest and account data remain independent; signing in alone never uploads guest data. Legacy
account caches are ignored without deletion. [Migration D](docs/MANAGED_GUEST_COPY.md) offers a
separate Yes/No setup screen only with the winning account-creation response, its one-time
opportunity, an eligible cloud dashboard and complete valid non-empty guest data. Yes creates an
independent online copy while leaving guest bytes unchanged; No permanently declines. Dispatch,
skipping or abandoning setup releases the browser handoff. An interruption may lose the opportunity;
there is no import retry or later import button. Account editing resumes only after authoritative
dashboard loading; ordinary load and Save retries remain separate. A committed ordinary Save
consumes an unused opportunity. [ADR 0007](docs/adr/0007-managed-auth-online-account-drafts.md)
supersedes offline account caching, custom sessions and interrupted-copy recovery. C remains
internal work, not a public account release.

Realtime connections, CRDTs, automatic field merging, collaboration, paid tiers and public sharing
remain excluded. See the [transition contract](docs/MANAGED_AUTH_TRANSITION.md) for sequential scope
and [B's contract](docs/MANAGED_DASHBOARDS.md) for the unchanged backend boundary.

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
