# Migration A — isolated managed-auth proof

The development proof is implemented; live single-account identity checks have owner-reported passes.
Migration A changed no application account mapping, database, deployment or provider settings.
[Migration C](MANAGED_ACCOUNT_WEB.md) reuses this lifecycle in the application while preserving
proof isolation; its internal account routes do not establish a public release. The second-account check is **NOT RUN — owner-deferred** under the 5 October amendment:
it does not block a reviewed A implementation commit or subsequent internal B work, but remains
required before public account release. The owner's subsequent private inspection reports PASS
for credential-free storage after reload and JWT refresh with the existing dedicated account;
this is additional stage-specific evidence, not a waived invariant. Google-only settings
and filled private URL files are owner-confirmed; private contents remain unread.

## Run locally under Node 24

Both ignored files contain the same complete development-branch Neon Auth Base URL, including its
path. Owner-filled variables only:

| File                  | Variable             |
| --------------------- | -------------------- |
| `apps/web/.env.local` | `VITE_NEON_AUTH_URL` |
| `apps/api/.env.local` | `NEON_AUTH_BASE_URL` |

Empty `.env.example` templates are supplied. No database URL, Google secret, management key or
application cookie secret is needed. Google secrets remain in Neon's branch/provider settings.
The callback is exactly `{Auth Base URL}/callback/google`; preserve the old callback. The browser
origin is `http://localhost:5173`, and Google stays in Testing. The owner has one dedicated test
account and will not use personal accounts; do not request a second account for implementation review.

In separate terminals from the repository root, using Node 24:

```sh
pnpm --filter @kendo-menu/api dev:managed-auth-proof
pnpm --filter @kendo-menu/web dev --port 5173 --strictPort
```

The API script runs from its package directory with
`node --env-file-if-exists=.env.local --import tsx --watch src/managed-auth-proof.ts`.
Vite separately loads the web configuration. Open `http://localhost:5173/managed-auth-proof.html`.
The API listener binds `127.0.0.1:3001`; Vite proxies only the exact development identity endpoint.
The proof document and proxy also reject non-loopback sockets. The proof document is absent from
production build entries, preview returns 404, and ordinary Node/Vercel API composition returns
404 for `/api/dev/managed-identity`. The existing account providers, persistence and analytics are
not imported by the separate proof entry.

The sign-in request sets the fixed proof callback URL. The owner observed a live origin-root
return carrying `neon_auth_session_verifier`. C preserves isolation now that application login can
also return to the root: before either sign-in, a read-back-verified SessionStorage marker stores
only version, `proof`/`application` flow and a 15-minute expiry. Root dispatch happens before normal
routes, stores or analytics import and chooses only `/managed-auth-proof.html` or
`/app/auth/callback`. Missing/expired/malformed root markers fail closed in isolated callback UI;
explicit callback paths accept no arbitrary destinations and reject a present invalid/mismatched
marker. Proof callbacks never initialize a KendoMenu account.

The proof remains development-only and loopback-guarded. Successful exchange replaces the address
with the clean proof URL; failed exchange remains retryable with a bounded marker and sanitized
error. Application callbacks use a separate bootstrap and clean account-dashboard destination.
Synthetic desktop/mobile tests cover both root-return and explicit callback success/failure for
both flows, including absence of cross-flow account/proof requests. No credentials, identities,
drafts or copy opportunities are stored in the marker.

## Credential handling and SDK constraint

Web pins `@neondatabase/auth@0.5.0-beta`; API pins `jose@6.2.12` in the single root lockfile.
The vanilla SDK resolves Better Auth 1.6.23. Its published auth-only package brings UI/server
transitive dependencies; none authorizes self-hosting auth or enabling the Data API. `core-js`
build scripts are explicitly disabled.

The owner's earlier private retry **FAILED**: Google returned to the proof, but token retrieval reported
no managed session and retained the verifier until sign-out. All remaining live stages were NOT RUN.
The earlier mock accepted `/token?verifier` without first requiring a session, so it did not cover
this provider handoff. Routing alone did not establish a managed session.

Current official [Neon JWT guidance](https://github.com/neondatabase/website/blob/main/content/docs/auth/guides/plugins/jwt.md)
distinguishes cookie-session establishment from JWT retrieval and requires cross-origin cookie
inclusion. The pinned SDK's server exchange implementation calls `/get-session`, and its vanilla
hook forwards the callback verifier to that endpoint. Calling `token()` instead merely requests
`/token?verifier`; it requires an existing session cookie and the owner observed 401. On failure,
the SDK success handler does not run, so the verifier remains. This is the diagnosed missing step;
the latest owner-reported results below now confirm callback exchange and backend verification.

The proof now uses public `getSession()` only on a fresh verifier-bearing callback document, until
the first successful exchange; failed attempts can be retried while the verifier remains. Auth requests explicitly use `credentials: include` in the published vanilla adapter's
`fetchOptions` (the pinned Better Auth client also defaults to include). The browser handles managed
HttpOnly cookies; application code neither reads nor copies them. Successful session/user response
lets the SDK remove the verifier and cache the session in memory. Then `location.replace` loads
the fixed clean proof document. Subsequent initial checks, reloads, Verify and JWT expiry use only
`token()`, followed by the existing bearer handoff to the Node/Elysia verifier.

The full document replacement is required because the pinned SDK classifies both `/get-session`
and `/token` with the same session hook: immediately after bootstrap, its memory cache can satisfy
`token()` with a session-shaped response rather than `{token}`. A fresh document discards that
memory cache while retaining browser-managed cookies. It does not clear browser persistence to
hide credential writes. No `getJWTToken`, `useSession`, session-atom subscription, SDK-internal
header, monkey patch, or storage override is used. Automatic focus/interval/offline refetch is
disabled. Failed exchange reports a sanitized callback failure, retains the verifier for retry,
and does not request a token or backend identity. Sign-out waits for an outstanding exchange before
invalidating the managed session; late results cannot trigger document replacement after cancellation.

The [SDK characterization](../apps/web/src/lib/managed-auth-sdk-storage.test.ts) demonstrates both:
public token-only retrieval/sign-out avoid credential-bearing persistence in synthetic transport;
repeated `getSession` bootstrap/cache-hit/expiry refresh writes the full session, including `session.token`,
to `better-auth.message` in LocalStorage even with refetch disabled. Neon core's `emitAuthEvent`
passes session data to Better Auth's `WindowBroadcastChannel.post`, which uses `localStorage.setItem`.
No public option suppressing that session-refresh write was found. This is a constraint on the
session lifecycle. A single fresh-cache callback bootstrap does not emit that refresh broadcast;
unit regressions and native desktop/mobile synthetic-cookie tests assert storage before sign-out,
and require the exchange before `/token` succeeds. Do not replace the proof
with session hooks or hide writes through patches, global storage overrides, or cleanup.

Tokens stay in transient function memory and are sent explicitly as `Authorization: Bearer` to the
API with `credentials: omit`, no-store and redirect rejection. Neon cookies do not authenticate
KendoMenu's API. Epochs and abort fencing prevent late verification from reopening identity after
sign-out/unmount. Identity is displayed privately in the proof page, never logged or persisted.

## Verified identity contract

`createManagedIdentityVerifier` is dedicated to one configured branch. It derives JWKS as
`{complete Auth Base URL}/.well-known/jwks.json` and uses the URL origin for exact issuer/audience.
This follows the current primary Neon JWT guide; token-supplied URLs never select keys. Require
EdDSA, nonempty `sub`, `exp`, and `role: authenticated`. Email is returned only when `emailVerified`
is true. Return `{identity: {provider: 'neon', issuer, subject, verifiedEmail, expiresAt}}`, where
expiry is JWT seconds. `provider: neon` identifies the verified issuer, not the upstream Google
provider. Google-only enforcement depends on managed settings, not a button or JWT.

The issuer/subject pair is the A-to-B identity seam; subject is not assumed to be a UUID or Google
subject. Email is nullable metadata, never authorization or automatic account linking. A creates no
KendoMenu account and needs no managed session ID. B owns internal account mapping, new-account
eligibility and one-time copy consumption. Responses are private/no-store; invalid credentials
receive sanitized 401, configuration/JWKS service failures receive sanitized 503. Neon documents
15-minute JWTs; sign-out does not establish instant revocation of an already issued bearer token.

## Private live procedure

The owner performs Google login privately. Do not collect tokens, identities, auth screenshots,
traces, storage dumps or raw errors. Report only pass/fail/not-run outcomes.

1. Start a fresh proof document and sign in with the first Google test account. Confirm callback
   exchange returns to the clean proof URL and the page reports backend-verified identity
   through the actual loopback Node/Elysia endpoint. Privately compare issuer/subject across reload.
2. Check LocalStorage and SessionStorage after callback, reload and repeated Verify identity. No
   bearer/session credential or credential-bearing session broadcast may be present. Existing guest
   bytes must remain unchanged. Check that the proof creates no IndexedDB or CacheStorage account
   data. Synthetic tests cover native LocalStorage/SessionStorage but are not provider evidence.
3. After the first JWT expires (Neon documents 15 minutes), verify again. Confirm successful token
   refresh, stable identity, no callback verifier in the URL, and continued storage/guest invariants.
4. Sign out; verify again or reload. Confirm identity is hidden and the managed session is absent.
   A previously issued bearer may still verify until expiry; this is not an instant-revocation test.
5. Before public account release, sign in with a second dedicated test account, privately confirm
   a distinct subject, then sign out and return to the first account. Confirm its subject is stable
   and repeat the storage checks. This stage is NOT RUN — owner-deferred; it no longer blocks a
   reviewed A implementation commit or subsequent internal B work. Do not use personal accounts.
6. Confirm managed settings disable email/password and every other provider. Owner reported Google
   enabled, email sign-up/sign-in disabled, and no additional providers; agent has not inspected them.

If a live stage stores credentials, cannot exchange the verifier, or fails the JWT contract, report
that exact stage and stop A. Do not conceal the failure or proceed to B on mock evidence.

## Preserved implementation and later work

The [retirement inventory](MANAGED_AUTH_TRANSITION.md#5-retirement-inventory) remains a candidate map.
Keep domain codecs, guest storage, shared dashboard/library/builder UI, validation and Drizzle/pg.
Rewrite account routing/providers and dashboard/adoption authorization only in later assigned jobs.
Retire custom OAuth/session issuance and offline-account cache/sync only after replacement callers
exist. Historical migrations and evidence remain unchanged.

Concrete SQL coupling: `persistence/schema.ts` retains internal `users`, `applicationSessions`, and
adoption's `creatingSessionId` foreign key. The PostgreSQL dashboard adapter validates UUID
user/session proofs, reads active custom sessions, locks the user then revalidates/locks the session,
and updates session activity with writes. `postgres/session-sql.ts` binds locks to session/user
credentials. The adoption adapter locks sessions and enforces creating-session eligibility. B must
adapt these dependencies without assuming a managed UUID, linking by email, weakening ownership or
atomicity, or editing historical migrations. A changes none of them.

## Evidence

The [owner-review handoff](work-sessions/2026-10-05-managed-auth-owner-review.md) records the gate
amendment and current readiness. The [callback correction handoff](work-sessions/2026-10-04-managed-auth-callback-handoff.md)
preserves the earlier gates and actual correction evidence; the latest amendment supersedes only
its second-account blocking requirement, not its historical outcomes or limited storage coverage.
The subsequent owner report separately adds reload/JWT-refresh storage passes. Synthetic SDK,
UI/native browser and Node/Elysia tests are local evidence, not real Google/Neon/HTTPS/Vercel proof.
No database work was run. The previously observed mobile legacy account-persistence E2E timeout
remains separate from proof verification and prevents claiming whole-branch release readiness.
The earlier failed callback-to-session attempt remains historical evidence. The latest private
retry produced the following **owner-reported** results; the agent did not inspect live credentials
or cookies, and these reports are separate from the agent-run synthetic checks.

| Live check                                                                     | Owner-reported result                                    |
| ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Callback exchange and backend-verified identity                                | PASS                                                     |
| Stable identity after reload                                                   | PASS                                                     |
| Stable identity after JWT expiry and refresh                                   | PASS                                                     |
| Sign-out followed by verification reports no managed session                   | PASS                                                     |
| Credential-free browser storage and no new account IndexedDB/CacheStorage data | PASS during inspected sign-in/sign-out stages            |
| Credential-free storage/no account IndexedDB or CacheStorage after reload      | PASS — subsequent private owner inspection               |
| Credential-free storage/no account IndexedDB or CacheStorage after JWT refresh | PASS — subsequent private owner inspection               |
| Guest fingerprints with a custom menu present                                  | PASS — identical                                         |
| Managed session cookie HttpOnly and Secure flags                               | Reported enabled; no cookie-setting correction indicated |
| Second-account distinction and return-to-first-account stability               | NOT RUN — owner-deferred                                 |

Complete live multi-account validation is not claimed. The deferred second-account check alone
does not block a reviewed A implementation commit or subsequent internal B work; public account
release still requires it. The original storage observations cover inspected sign-in/sign-out
stages only; the subsequent owner report adds explicit credential-free storage/no account
IndexedDB or CacheStorage passes after reload and JWT refresh, with stable identity in both.
No storage invariant was waived or inferred from identity success. Guest fingerprint evidence
remains the owner's earlier identical-custom-menu report; no new fingerprint comparison is claimed
from the subsequent storage-only reply. Do not extend observations to uninspected transitions or
describe every live gate as passed. See the
[review packet](MIGRATION_A_REVIEW.md) for exact candidate files, review findings and readiness.

- [Official auth-only SDK](https://github.com/neondatabase/neon-js/tree/main/packages/auth)
- [Primary Neon JWT guide and claim/JWKS contract](https://github.com/neondatabase/website/blob/main/content/docs/auth/guides/plugins/jwt.md)
- [Neon token retrieval guidance](https://github.com/neondatabase/agent-skills/blob/main/skills/neon-auth/SKILL.md)
- [Managed-auth transition](MANAGED_AUTH_TRANSITION.md)
