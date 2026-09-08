---
name: kendomenu-web-feature
description: Implement or review KendoMenu React and Vite web features across domain, Zustand persistence, browser integration, and accessible UI boundaries. Use for vertical slices, store changes, persisted-state changes, or web feature work in this repository.
---

# KendoMenu Web Feature

Build the smallest coherent web slice that serves the deployed local-first production MVP. Treat this
workflow as project-specific coordination for existing skills, not as permission to broaden scope.

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

Extend the existing React Router configuration for route work. Do not create alternate routing,
mobile, server, account, synchronization, query, IndexedDB, or shared-UI infrastructure for a
hypothetical need.

## Implement safely

- Keep training concepts and calculations outside JSX. Components render selected state and invoke
  typed actions; transient presentation state stays local to React unless multiple features truly
  share it.
- Author curated content in `packages/domain/data/default-drills.json`, keep its schema in
  `packages/domain/schema/kendo-drills.schema.json`, and adapt it through
  `packages/domain/src/default-training-sets.ts`. Runtime sessions use recursive `TrainingActivity`
  values and stable activity IDs; preserve the activity tree.
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
- Finish with `$work-session-history`, recording material verification evidence, exclusions,
  and follow-up according to its evidence rules.
