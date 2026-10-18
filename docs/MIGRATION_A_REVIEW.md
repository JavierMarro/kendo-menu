# Migration A owner review packet

Migration A adds an isolated, loopback-only development proof of Neon-managed Google authentication
and the Node/Elysia JWT identity seam. Production account routes, legacy OAuth/session runtime,
guest persistence, SQL and databases remain unchanged. No files have been staged or committed.

## Readiness and live evidence

**Scoped commit readiness: YES, for owner review and commit of Migration A only.**
The callback code has no outstanding concrete finding from the bounded independent review. A
reviewed implementation commit and subsequent internal B work are not blocked by the deferred
second-account check alone; no B work is authorized by this review preparation.

**Public account release readiness: NO.** Second-account distinction and return-to-first-account
stability are **NOT RUN — owner-deferred**, because the owner has one dedicated Google test account
and will not use personal accounts. Complete live multi-account validation is not claimed. This
check remains outstanding before public account release. Production replacement and release
verification belong to later assigned jobs.

Owner-reported live PASS: callback exchange/backend-verified identity, stable identity after reload,
stable identity after JWT expiry/refresh, sign-out followed by no managed session, credential-free
storage/no new account IndexedDB or CacheStorage data during inspected sign-in/out stages, and
identical guest fingerprints with a custom menu present. Cookie HttpOnly/Secure flags were reported
enabled; no cookie correction is indicated. These are owner reports, not agent live inspection.
The subsequent private owner inspection explicitly reports **PASS** for credential-free
LocalStorage/SessionStorage and no account IndexedDB/CacheStorage data after reload and after JWT
expiry/refresh, with stable identity in both stages. This closes the previously unverified storage
gap using the existing dedicated account; it does not waive an invariant or extend the initial
sign-in/out evidence. The reply supplies no new guest fingerprints; retain the earlier owner-reported
identical-custom-menu evidence without claiming an additional comparison.

Historical blank rendering, homepage callback and token-before-bootstrap failures remain evidence;
see the preserved [initial proof](work-sessions/2026-10-04-managed-auth-storage-gate.md),
[callback correction](work-sessions/2026-10-04-managed-auth-callback-handoff.md) and
[current gate amendment](work-sessions/2026-10-05-managed-auth-owner-review.md).

## Review and verification

Bounded independent review inspected the actual callback client/UI, SDK characterization and client
tests, proof middleware and native synthetic-cookie browser regressions. Callback exchange uses
public `getSession` once successfully in a fresh callback document, followed by full document
replacement and token-only retrieval. Failure is sanitized/retryable; sign-out waits for exchange
and fences late navigation. No concrete code defect was found. Old gate wording was corrected;
the historical handoff remains preserved and is superseded by the new amendment. Independent
re-review found no remaining documentation or evidence mismatch, including the later storage report.

Reused unchanged implementation evidence under Node 24.21.0: `pnpm check:web` PASS (342 tests/build),
`pnpm check:api` PASS (454 tests including 17 native transport identity tests), focused SDK/client/UI
12 PASS, desktop/mobile proof 4 PASS, guest smoke 46 PASS, production proof excluded, preview proof
404 and ordinary Node/Vercel proof endpoint 404. Synthetic mocks do not clear live gates.

Fresh final `pnpm check` under Node 24.21.0 PASS: 938 tests (domain 73, store 69, API 454,
web 342), cross-package/root typecheck, lint (zero errors), formatting, session-history validation
and production build. The first sandbox run could not bind synthetic HTTP listeners; rerunning the
same check with approved local-listener access passed, without an implementation change. Final
targeted documentation formatting/session checks passed after the new owner evidence was recorded.
The exact manifest matches all 34 changed/untracked files; scoped debug/unsafe-TypeScript scans and
tracked/untracked whitespace checks are clear. Lockfile review found no changed existing package
integrities or existing snapshot contents; the Drizzle snapshot gains the SDK's Kysely peer context,
and the pinned auth package adds transitive dependencies and lockfile formatting churn.
No database, private configuration or live browser credential inspection is part of this review.

Inherited failure: legacy mobile `account-persistence.spec.ts:273` timed out clicking View dashboard
at line 283 (detached element; 30 seconds) in the mixed guest/account selection; 57/58 passed.
Proof passes and guest smoke do not erase that failure. The earlier interrupted broad browser run
is not completed-suite evidence; whole-branch release readiness is not claimed. The complete preview
and PWA release suites have not been run for this migration. React-refresh lint, API MaxListeners,
future Vite config-loader and existing production chunk-size warnings remain informational.

## Exact candidate files for the owner's staging step

Include the following files together after owner review. This is a review
manifest, not a staging action. Include reviewed source, tests, templates, documentation and the
single lockfile; exclude private configuration, dependencies, build output and browser artifacts.

```text
PRODUCT.md
apps/api/.env.example
apps/api/package.json
apps/api/src/app.ts
apps/api/src/auth/managed-identity.ts
apps/api/src/managed-auth-proof.ts
apps/api/src/managed-identity-http.test.ts
apps/web/.env.example
apps/web/package.json
apps/web/playwright.config.ts
apps/web/playwright.managed-auth.config.ts
apps/web/tsconfig.json
apps/web/vite.config.ts
apps/web/dev/managed-auth-proof-plugin.ts
apps/web/dev/managed-auth-proof.html
apps/web/e2e/managed-auth-proof.spec.ts
apps/web/src/features/managed-auth-proof/ManagedAuthProof.test.tsx
apps/web/src/features/managed-auth-proof/ManagedAuthProof.tsx
apps/web/src/features/managed-auth-proof/entry.tsx
apps/web/src/features/managed-auth-proof/proof.css
apps/web/src/lib/managed-auth-proof.test.ts
apps/web/src/lib/managed-auth-proof.ts
apps/web/src/lib/managed-auth-sdk-storage.test.ts
docs/ARCHITECTURE.md
docs/MANAGED_AUTH_PROOF.md
docs/MANAGED_AUTH_TRANSITION.md
docs/MIGRATION_A_REVIEW.md
docs/adr/0007-managed-auth-online-account-drafts.md
docs/work-sessions/2026-10-04-managed-auth-callback-handoff.md
docs/work-sessions/2026-10-04-managed-auth-storage-gate.md
docs/work-sessions/2026-10-05-managed-auth-owner-review.md
docs/work-sessions/README.md
pnpm-lock.yaml
pnpm-workspace.yaml
```

Dependencies: exact `@neondatabase/auth@0.5.0-beta` (vanilla auth-only adapter, Better Auth 1.6.23)
and `jose@6.2.12`. SDK transitive UI/server dependencies do not enable self-hosted auth or Data API;
`core-js` install build scripts are disabled. The API proof script uses Node 24
`--env-file-if-exists=.env.local --import tsx --watch` from its package directory; Vite loads web
configuration separately. Only owner-filled `VITE_NEON_AUTH_URL` and `NEON_AUTH_BASE_URL` are needed
in the respective ignored files. Private values were neither read nor changed.
