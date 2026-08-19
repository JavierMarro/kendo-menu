---
name: kendomenu-web-feature
description: Implement or review KendoMenu React and Vite web features across domain, Zustand persistence, browser integration, and accessible UI boundaries. Use for vertical slices, store changes, persisted-state changes, or web feature work in this repository.
---

# KendoMenu Web Feature

Build the smallest coherent web slice that serves the current local-first milestone. Treat this
workflow as project-specific coordination for existing skills, not as permission to broaden scope.

## Establish the slice

1. Read `AGENTS.md`, `PRODUCT.md`, `tools/skills/README.md`, nearby source and tests, and the relevant
   package scripts.
2. State the user behavior and identify only the layers it genuinely touches.
3. Preserve the dependency direction: domain contracts and defaults in `packages/domain`;
   platform-neutral actions and persistence in `packages/store`; browser APIs in `apps/web/src/lib`;
   feature composition and rendering in `apps/web/src/features` and reusable web layout in
   `apps/web/src/components`.
4. Reuse an existing seam before adding an abstraction. Do not create mobile, server, account,
   synchronization, router, query, IndexedDB, or shared-UI infrastructure for a hypothetical need.

## Implement safely

- Keep training concepts and calculations outside JSX. Components render selected state and invoke
  typed actions; transient presentation state stays local to React unless multiple features truly
  share it.
- Keep storage injection platform-neutral. Treat rehydrated JSON as `unknown`, copy only recognized
  state into the live store, and preserve action functions.
- When a persisted shape changes, bump its version, implement only supported migrations, and add
  public-boundary tests for valid round trips, old versions, malformed data, and future versions.
- Preserve strict TypeScript, immutable updates, stable identifiers, semantic HTML, keyboard access,
  visible focus, non-color cues, and useful empty, loading, and error states.
- Translate generic skill commands and examples to this repository's pnpm scripts. A skill's stack
  preference does not authorize Tailwind, shadcn/ui, routing, or another dependency.
- Preserve KendoMenu's calm interface and deliberate existing patterns. Categorical style advice is
  advisory when it conflicts with the product brief or established UI.

## Verify and hand off

1. Run the narrowest package test and typecheck while developing.
2. Exercise each affected user transition. For UI work, include applicable desktop, mobile-width,
   keyboard, empty/error, reload, and persistence flows in a real browser.
3. Run `pnpm check` for a cross-package slice.
4. Use `testing-fuzz-stress` when state-space or adversarial testing is requested,
   `pre-commit-verification` for the final quality gate, and `code-reviewer-pre-commit` for semantic
   changed-code review. Do not duplicate their full workflows here.
5. Finish with `work-session-history` and record facts, failed commands, deliberate exclusions, and
   verified behavior.
