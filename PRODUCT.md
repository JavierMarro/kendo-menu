# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Individual kendo practitioners preparing and carrying out a focused practice session. They need to
choose useful drills, adapt the amount of work to the day, and keep lightweight notes as part of
their practice routine.

## Product Purpose

KendoMenu is a responsive web app for planning kendo practice. Guests can use it locally and offline;
Google account users can save menus online and access them across devices. Both workflows let
practitioners browse curated training sessions, adjust activity quantities, attach notes, and create
custom training sessions.

## Positioning

KendoMenu combines a curated drill library with session-level adaptation and practitioner-authored
training sessions. Built-in and custom sessions share one recursive activity model while browser
storage keeps the workflow local-first.

## Operating Context

Practitioners use the web app to prepare a day's keiko, select a built-in or custom training session,
and shape it for the current practice. A dashboard entry is the selected session snapshot whose
activity quantities and notes can be adapted without mutating the built-in library.

## Capabilities and Constraints

- The library displays 10 curated built-in training sessions. The canonical catalogue retains the
  hidden Official ZNKR/AJKF menu so existing saved sessions still resolve. Custom training sessions
  appear on the dashboard only.
- Practitioners can add sessions to the dashboard, adjust per-activity quantities, attach dashboard
  and activity notes, and remove dashboard entries.
- Runtime sessions contain recursive `TrainingActivity` values. Every session and activity has a
  stable ID; quantity overrides are keyed by activity ID and then unit.
- Built-in sessions are immutable and marked `isBuiltIn: true`. Practitioner-authored sessions use
  the same model and are marked `isBuiltIn: false`.
- Custom dashboard menus offer **Edit menu**, reopening the builder with their current contents and
  quantities. Practitioners can edit menu details and add or remove activities and exercises.
  **Save changes** updates the same menu, preserving retained activity IDs and practice notes;
  **Cancel** discards the form edits. Guests save locally, including offline; account edits remain
  in memory until **Save to account** succeeds. Library menus retain quantity and note editing only.
- Curated content is authored in `packages/domain/data/default-drills.json`, validated against
  `packages/domain/schema/kendo-drills.schema.json`, and adapted by
  `packages/domain/src/default-training-sets.ts`.
- The production app is a React + Vite + TypeScript web app with React Router. Domain contracts live
  in `packages/domain`; the platform-neutral Zustand store lives in `packages/store` and receives an
  injected storage adapter.
- The guest dashboard uses Zustand with browser LocalStorage and retains its offline/recovery behavior.
  Managed account routes use the same store factory with memory-only drafts and an
  explicit Save to account. Persisted guest JSON remains untrusted, validated, versioned and migrated.
- The owner reported successful Google sign-in, existing menus, Save/reload, sign-out and
  second-account/return-to-first checks on the development-branch HTTPS Vercel Preview on
  2026-10-14. These are owner-reported Preview results. On 2026-10-18 the owner reported the
  managed-account release deployed and working in production; see the deployment runbook for the
  verification boundary. Paid tiers remain out of scope.

## Information and workspace navigation

The public landing page explains KendoMenu; its primary navigation links to How it works,
Library info (the curated-library overview), and FAQ sections, followed by Get started for sign-in.
The mobile menu opens a compact vertical dropdown with separated links and a Get started button. Try without an account opens the
guest dashboard. Sign up opens a dedicated Google-only authentication page headed “Prepare for keiko”.
Email/password authentication is an informational future option, not an available form.
The landing and information pages retain the site footer; sign-in and workspace pages omit it.
Public `/privacy` explains guest/account data, service providers and deletion choices alongside the
unchanged `/cookies` page. Footer Navigation ends with installation when available; Information lists
GitHub, Sources, Cookies and Privacy, in that order. Glossary remains available through its public route
and Mitori room.

Guest and account workspaces share navigation for Dashboard, Library, Mitori room and User: a fixed left
sidebar on desktop and a fixed bottom bar on mobile. The KendoMenu brand returns to the landing
page. User shows guests their device-save status and sign-up, and verified account users their
cloud-save status and sign-out action. Cloud status distinguishes confirmed saves from unsaved or
uncertain changes with text and colour. Account deletion is not offered in the UI. Existing draft-exit warnings apply.
The new layouts retain KendoMenu’s navy/gold palette, typography and existing dashboard content.
Google continues through the validated full-page redirect; navigation changes do not alter
authentication, account saves, guest persistence or one-time guest-copy decisions.

### Mitori room

“Learn through observation.” The guest and account `/mitori-room` routes share six URL-addressable
sections: General (default), Competitions, Documentaries, Kata, Resources and Glossary. The sprout
navigation item sits after Library on desktop and between Library and User on mobile. Sections
replace only the page content and use ordinary page scrolling; section links scroll horizontally
when needed. Existing `tab=techniques` links continue to select General.

General, Documentaries, Kata and Competitions use an owner-curated local video list. Competitions
contains the 2026, AJKC finals (mens) and AJKC finals (womens) collections, with 2026 selected by
default. Existing `collection=ajkc-finals` links select the men’s collection. Videos and playlists
share one row pattern with YouTube player controls. Documentaries omit uploader credits. Opening a
title loads one privacy-enhanced YouTube embed without autoplay; closing it or changing sections or
collections removes the player. A YouTube fallback link remains available for restricted or
unavailable playback. Videos require internet access and may contain YouTube adverts; no YouTube API
key or automatic live detection is used. Resources and Glossary reuse the public pages’ content,
retaining glossary search. Public Sources and Glossary routes remain available. Practitioners can
mark any listed video Seen; these marks use separate browser local storage on guest and account pages
and do not sync across devices or change training data or saves.

## Online account journey

The account integration described in [its implementation guide](docs/MANAGED_ACCOUNT_WEB.md)
separates `/app/guest/*` and `/app/account/*` routes, reusing the dashboard, library and custom-
session builder. The landing offers guest entry and a
link to the authentication page when signed out, or a dashboard link for verified account users;
each workspace has a dashboard shortcut. Guest use stays local and works
without authentication availability. Verified signed-in visitors entering guest routes go to the
matching account route. Account routes require verified identity; unresolved identity hides account
content and does not authorize analytics. Verified email is shown when supplied.

Account loading validates B's bearer-authenticated complete response before creating a memory-only
store. An empty account stays empty. Editing requires an online available service. **Save to
account** submits a frozen whole dashboard with the expected account, revision, catalogue and stable
request ID. “Save your changes” in expanded account menu details uses this same whole-dashboard save;
guest menu saves remain local. Edits made during Save remain dirty after acknowledgement. An uncertain Save retries
its identical request; a revision conflict preserves the draft and offers download or explicit
reload. Failures retain this tab's draft without claiming local durability. Reloading or closing
can lose unsaved work; intentional discard is warned and browser leave warnings are best effort.
Sign-out hides account content, fences late requests and returns home.

Guest and account data remain independent; signing in alone never uploads guest data. Legacy
account caches are ignored without deletion. The [guest-copy setup](docs/MANAGED_GUEST_COPY.md) offers a
separate Yes/No setup screen only with the winning account-creation response, its one-time
opportunity, an eligible cloud dashboard and complete valid non-empty guest data. Yes creates an
independent online copy while leaving guest bytes unchanged; No permanently declines. Dispatch,
skipping or abandoning setup releases the browser handoff. An interruption may lose the opportunity;
there is no import retry or later import button. Account editing resumes only after authoritative
dashboard loading; ordinary load and Save retries remain separate. A committed ordinary Save
consumes an unused opportunity. [ADR 0007](docs/adr/0007-managed-auth-online-account-drafts.md)
supersedes offline account caching, custom sessions and interrupted-copy recovery. Current release
status is recorded in the deployment runbook.

Realtime connections, CRDTs, automatic field merging, collaboration, paid tiers and public sharing
remain excluded. See the [managed-auth contract](docs/MANAGED_AUTH_TRANSITION.md) for scope and
the [account API contract](docs/MANAGED_DASHBOARDS.md) for the backend boundary.

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
