---
name: kendomenu-web-feature
description: Implement or review KendoMenu React/Vite features, Zustand guest persistence, account UI, or browser integration. Not backend-only work.
---

# KendoMenu Web Feature

Build the smallest coherent web slice for the approved journey. Guests remain local-first; the
managed-auth replacement uses online-only account drafts. This skill does not expand task scope.

## Establish the slice

Identify the requested user behavior and affected layers. Apply the task-specific context matrix in
`AGENTS.md`, reusing context already established for the current work:

- Product/UX: `PRODUCT.md`, affected routes, components, and nearby tests.
- Domain/curated content: `CONTEXT.md`, contracts, JSON, schema, adapter, and nearby tests.
- Store/persistence: domain contracts and affected store, storage, migration, and boundary tests.
- Browser/PWA: affected browser code, routes, configuration, and relevant E2E tests.
- Cross-package boundaries: `docs/ARCHITECTURE.md`; consult ADRs for affected architecture decisions.
- Additional workflows: `.agents/skills/README.md` when selecting a matching skill.

Use relevant package scripts for commands.

Preserve the dependency direction: domain contracts and defaults in `packages/domain`;
platform-neutral actions and persistence in `packages/store`; browser APIs in `apps/web/src/lib`;
feature composition and rendering in `apps/web/src/features` and reusable web layout in
`apps/web/src/components`.

Extend the existing React Router configuration. For account work, read the transition handoff and
keep separate guest/account store lifetimes while reusing dashboard/library/builder UI. Do not
persist replacement account drafts in LocalStorage/IndexedDB or rebuild background synchronization.
Use the API feature skill only when the assigned slice also changes backend contracts or behavior.

## Implement safely

- Keep training concepts and calculations outside JSX. Components render selected state and invoke
  typed actions; transient presentation state stays local to React unless multiple features truly
  share it.
- Preserve the curated-content and recursive-activity invariants from `AGENTS.md`.
- Keep storage injection platform-neutral. Treat rehydrated JSON as `unknown`, copy only recognized
  state into the live store, and preserve action functions.
- When a persisted shape changes, bump its version, implement only supported migrations, and add
  public-boundary tests for valid round trips, old versions, malformed data, and future versions.
- Preserve strict TypeScript, immutable updates, stable identifiers, semantic HTML, keyboard access,
  visible focus, non-color cues, and useful empty, loading, and error states.
- Translate generic skill commands and examples to this repository's pnpm scripts. A skill's stack
  preference does not authorize Tailwind, shadcn/ui, an alternate router, or another dependency.
- Preserve KendoMenu's calm interface and deliberate existing patterns. Categorical style advice is
  advisory when it conflicts with the product brief or established UI.
- Guest-copy failure may consume the one-time opportunity, but never alter the guest source or block
  ordinary account use indefinitely. Do not restore durable copy retries or creating-session gates.

## Verify and hand off

- Complete affected package and browser gates from `AGENTS.md`. Run `pnpm check` for a cross-package
  slice and `pnpm verify:full` for release; preserve its separate non-PWA preview and PWA coverage.
- Exercise affected user transitions in a real browser, including applicable desktop, mobile-width,
  keyboard, empty/error, reload, and persistence flows.
- Use `$testing-fuzz-stress` when state-space or adversarial testing is requested,
  `$pre-commit-verification` when the request calls for its verification modes, and
  `$code-reviewer-pre-commit` when semantic review is requested or required by repository risk policy.
  Preserve independent review for the changes specified in `AGENTS.md`.
- Reuse current verification evidence; repeat or broaden checks only for changed code, stale
  evidence, failures, or unresolved concerns. Additional skills do not replace required gates.
