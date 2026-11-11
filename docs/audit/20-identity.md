# Pass 2 — Managed sign-in, identity and authorization

Audited `codex/updated-audit-kendomenu` at `7f9f1530e7d03109ae979b3ea17bc4fe15027480`
on 2026-11-10 (Europe/Madrid). The tracked drift from
`de4f84fcc356edcdd5b58a53bedd5030fb90830d` is the single Pass 1 remediation commit
`7f9f153`: guest recovery/storage, shared dashboard detail UI, and three related test files.
Checked the changed guest recovery and shared editor seams. The retry change preserves the
guest baseline and the editor change passes account actions through to the existing controller.
The callback, auth provider, workspace identity, API, and managed mapping source files match
the pinned baseline. The working tree and index were clean at the start, with no non-ignored
untracked implementation files in scope.

## Findings

### KM-02-001 — Unexpected auth parameters can forward a verifier outside the callback flow

**P2 · High confidence in local behavior · Callback isolation and credential handling.**
A document loaded at `/app/guest/dashboard?neon_auth_session_verifier=...` starts the ordinary
app. The pinned Neon SDK forwards that query value to its configured `/token` endpoint. If
the URL also includes `neon_popup=1` and the document has an opener, the SDK sends the
verifier to that opener with `postMessage(..., '*')`, including across origins. This popup
behavior also occurs on the explicit application callback.

- **Cause.** [The resolver](../../apps/web/src/lib/auth-return.ts#L113) handles explicit
  callback paths and the root before treating every other pathname as ordinary at line 160.
  [The dispatcher](../../apps/web/src/auth-dispatcher.ts#L39) then starts the SPA with that
  query intact. [The explicit callback](../../apps/web/src/features/auth-callback/entry.tsx#L35)
  likewise constructs the SDK client without removing the popup flag.
  [The auth client](../../apps/web/src/lib/managed-auth.ts#L53) constructs
  `@neondatabase/auth@0.5.0-beta`. Its installed `adapter-core-CZ8saNEY.mjs` maps `/token`
  to the same session hook as `/get-session` (lines 491–533, 602–607), and
  `initBroadcastChannel()` recognizes the popup query at initialization (lines 610–623,
  809). The browser's no-referrer policy does not govern either action.
- **Observed.** With the real installed SDK and synthetic transport, load the ordinary guest
  URL with a synthetic verifier and return `401` from the issuer token route. The ordinary
  dashboard renders, the issuer request carries the verifier as a query parameter, no
  `/get-session` runs, and the verifier remains in the address bar. In a separate Chromium
  context, a second loopback origin opens the guest path with the popup flag and receives
  the synthetic verifier in a message from the app origin. The same opener probe also
  received the verifier from `/app/auth/callback` with that flag.
- **Limits.** The probes establish the client behavior if a verifier reaches this URL.
  They do not establish that an attacker can route a real Google/Neon verifier there,
  redeem it, or bypass live hosting protections. The normal app requests the fixed
  application callback. The root dispatcher drops unrelated query parameters on its valid
  redirect. The first probe contacted only the configured synthetic issuer.
- **Why existing tests miss it.** [Application callback tests](../../apps/web/e2e/managed-auth-app-callback.spec.ts#L5)
  cover root and explicit callback routes. [Referrer tests](../../apps/web/e2e/managed-auth-referrer.spec.ts#L7)
  check module requests, and the [SDK storage test](../../apps/web/src/lib/managed-auth-sdk-storage.test.ts#L13)
  starts with a clean URL. None exercise an auth query on an ordinary app path or a
  distinct-origin opener.
- **Smallest correction and acceptance.** At the initial dispatcher boundary, strip or
  reject verifiers outside allowed callback paths and reject or remove unsupported
  popup parameters before SDK construction, including on the explicit callback. Prove
  that normal root and explicit exchanges still work, that a wrong-path verifier never
  reaches `/token` or remains in a navigable URL, and that a distinct-origin opener
  receives no verifier from either path.

### KM-02-002 — Leaving the account route after failed sign-out loses the retry action

**P2 · High confidence · Account recovery.** When provider sign-out fails, KendoMenu correctly
hides the account. Navigate to Home and back within the SPA, and the sign-out retry disappears.
The replacement **Retry account check** button makes no request, even after the outage ends.
Reloading the document restores normal checks.

- **Cause.** [The provider](../../apps/web/src/features/account/ManagedAuthProvider.tsx#L99)
  holds a failed-sign-out latch across route transitions. Its
  [verification guard](../../apps/web/src/features/account/ManagedAuthProvider.tsx#L44)
  intentionally ignores checks while latched. The
  [retry action](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx#L616)
  depends on a route-local error flag set after sign-out fails at line 367.
  After the account route remounts without its previous account record, the
  [generic unavailable screen](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx#L131)
  invokes verification instead. [The sign-in page](../../apps/web/src/features/account/SignInPage.tsx#L76)
  also offers verification in that state.
- **Observed.** Start with an empty verified account, make the first synthetic provider
  sign-out return `503`, and wait for **Retry sign-out**. Click the workspace Home link,
  then use Back in the same document. The account route offers **Retry account check**.
  Two clicks and a focus event produced zero SDK or account API requests. A full reload
  verified the still-authenticated synthetic session and reopened its dashboard. No
  account content was revealed while the latch was active.
- **Why existing tests miss it.** [The failed sign-out regression](../../apps/web/e2e/managed-auth-signout-race.spec.ts#L119)
  checks focus and pageshow fencing, then retries from the original mounted account screen.
  It does not leave and remount the route before retrying.
- **Smallest correction and acceptance.** Expose the failed sign-out state from the provider
  and use it to render an explicit sign-out retry on the relevant remounted recovery screen.
  Keep the verification fence until confirmed sign-out. A browser regression should inject
  `503`, navigate Home and Back, recover with one successful explicit provider retry, and
  assert that account details and prior drafts remain hidden throughout.

Independent source review confirmed both paths and the severity limits. It did not run the
browser probes. The opener result demonstrates conditional forwarding by the installed SDK,
with no evidence here of real OAuth verifier delivery or redemption by an attacker.

## Authorization and storage evidence

| Boundary                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Callback and storage          | The [marker parser](../../apps/web/src/lib/auth-return.ts#L46) bounds the tab's exact `{version, flow, expiresAt}` record to 15 minutes. Root callback needs the marker. The explicit callback selects its fixed flow and rejects a contradictory or malformed marker if one is present. [Application bootstrap](../../apps/web/src/features/auth-callback/entry.tsx#L45) calls the SDK once on a fresh document, fences pagehide, and replaces the document before ordinary token calls. The dedicated desktop/mobile proof exercises synthetic cookies, failed exchange, sanitized retry, and omission of verifiers from module referrers. |
| SDK credential storage        | The [installed SDK characterization](../../apps/web/src/lib/managed-auth-sdk-storage.test.ts) passed both controls. Token-only use and sign-out do not write credentials in that fixture. Repeated session reads crossing refresh do write credential-bearing `better-auth.message` under the pinned SDK. Keep the single callback bootstrap and clean replacement boundary. The passing proof describes the tested lifecycle; KM-02-001 concerns an input outside it.                                                                                                                                                                       |
| Bearer and Origin             | [Authorization](../../apps/api/src/auth/account-authorization.ts#L42) caps the bearer header at 16,384 characters and treats hosting/legacy cookies as insufficient. Writes require exact configured Origin before remote verification; reads use bearer without the write-origin setting. Missing/invalid/expired identity returns `401`, wrong write Origin `403`, valid unmapped identity `409`, and unavailable verifier or DB `503`. The [ordinary route composition](../../apps/api/src/app.ts#L52) uses private/no-store responses and excludes the proof endpoint unless injected.                                                   |
| JWT                           | [Verifier](../../apps/api/src/auth/managed-identity.ts#L87) pins the configured key-set URL and exact issuer/audience, requires EdDSA, subject, expiry and authenticated role, rejects anonymous identity, and only exposes verified email. Local Node HTTP tests signed their own tokens and exercised wrong key, issuer, audience, invalid/expired claims, and unavailable/malformed JWKS. They do not establish the deployed Google-only provider configuration or immediate bearer revocation on provider sign-out.                                                                                                                      |
| Mapping and initialization    | [The account route](../../apps/api/src/account/account.ts#L71) accepts no caller-selected account or initialization body. [The adapter](../../apps/api/src/persistence/postgres/managed-account-adapter.ts#L106) locks the provider/issuer/subject tuple, rechecks expiry, and atomically creates the mapped UUID and first-use opportunity. Guarded PostgreSQL cases established one winner among eight concurrent requests, distinct mappings with equal verified email, and no attachment to the same-email legacy row. GET rechecks the proof mapping before exposing account metadata.                                                  |
| Protected callers             | [Dashboard](../../apps/api/src/dashboard/dashboard.ts#L111), [adoption](../../apps/api/src/adoption/adoption.ts#L60) and [sharing](../../apps/api/src/shares/shares.ts#L156) consume verified account proofs. The client-supplied expected workspace ID on writes is compared with that proof; persistence binds internal ID, provider, issuer, subject and expiry. The public share read is intentionally distinct from protected recipient read and share creation. Transaction content and product behavior for those routes belong to later passes.                                                                                      |
| Browser lifecycle and privacy | [Account workspace](../../apps/web/src/features/account/AccountWorkspaceProvider.tsx#L325) gates visibility and mutation on verified identity, with account-keyed mounts and controller abort/epoch checks. Scoped tests exercised a late Save response after sign-out, 401, same-account recovery, switched-account isolation, and cross-tab hints. [Hints](../../apps/web/src/lib/guest-pageview.ts#L64) carry no identity or credential; recipients recheck the server. Guest analytics tests observed signed-out gating, allow-listed paths and cancellation while identity is unresolved.                                               |

## Synthetic request measurements

Measured decoded UTF-8 response body bytes in Chromium against the repository's synthetic
managed harness. Request counts are for opening `/app/account/dashboard` in a fresh
already-authenticated document, through first visible dashboard. No interaction, retry, or
browser focus change was added during measurement. Header bytes, TLS, compression and actual
provider JWT length are outside these figures. Dashboard content and its response size
belong to Pass 3.

| Case                                         | Account requests                                                                                                                                                                        | Synthetic SDK token calls                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Mapped identity, typical email               | Two empty `GET /api/account`; 88 B per `200` response. One dashboard GET follows.                                                                                                       | Three empty `GET /token`; 35 B per fixture response. |
| New identity, accepted email length boundary | Empty account GET returns 35 B (`409`); empty account POST returns 1,065 B (`200`, includes opportunity); follow-up empty account GET returns 991 B (`200`). One dashboard GET follows. | Four empty `GET /token`; 35 B per fixture response.  |

The boundary fixture uses a synthetic 320-code-unit email value with multibyte characters
and reached the dashboard. Its length exercises the client acceptance cap without implying
the live provider would issue that address. The repeated mapped account GET comes from the
provider's first identity check and the controller's independent preflight. Sign-in and
sign-out behavior was exercised separately; their provider response sizes were not measured.

## Verification

All runs were sequential on Node 24.21.0 and pnpm 11.22.0.

- `pnpm check:api`: initial sandbox attempt hit `listen EPERM` on `127.0.0.1`; approved
  rerun passed all 171 tests in 14 files, type checks, and lint. The run emitted a
  non-blocking Node listener-count warning.
- `pnpm test:e2e --workers=2 --grep 'sign-out|identity|verification|account creation|Preview cookie|analytics|application callback|different verified' managed-account.spec.ts managed-auth-signout-race.spec.ts`:
  32 passed in desktop Chromium and mobile emulation combined.
- `pnpm --filter @kendo-menu/web test:e2e:managed-auth --workers=2`: 22 callback, referrer
  and proof cases passed in both Chromium projects combined.
- `pnpm --filter @kendo-menu/web exec vitest run --config vitest.config.ts src/lib/managed-auth-sdk-storage.test.ts src/lib/managed-auth.test.ts src/lib/auth-return.test.ts src/lib/account-api.test.ts src/features/account/ManagedAuthProvider.test.tsx src/features/account/SignInPage.test.tsx`:
  81 tests in 6 files passed.
- `node --import ./apps/api/node_modules/tsx/dist/loader.mjs /private/tmp/kendomenu-pass2-browser.mjs`:
  the temporary Chromium probe reproduced both findings and recorded the synthetic request
  counts and bytes above. Only loopback and intercepted synthetic endpoints were used.
- `node --import ./apps/api/node_modules/tsx/dist/loader.mjs /private/tmp/kendomenu-pass2-popup.mjs`:
  the follow-up Chromium probe observed synthetic verifier messages on both the ordinary
  guest path and the explicit application callback.
- Scoped PostgreSQL run from `apps/api` through the existing guard and test harness, below:
  14 passed, 19 excluded by name filter, across three files. The URL guard and the database
  identity check ran before schema changes. The test configuration was loaded by Node
  without printing or inspecting private contents.

```sh
node --env-file=.env.test.local --import tsx --input-type=module -e 'import { validateTestDatabaseUrl } from "./src/database/test-database.ts"; validateTestDatabaseUrl(process.env.TEST_DATABASE_URL)'
node --env-file=.env.test.local --import tsx ../../node_modules/vitest/vitest.mjs run \
  --config vitest.integration.config.ts \
  src/persistence/managed-account-migrations.integration.test.ts \
  src/persistence/managed-copy.integration.test.ts \
  src/persistence/managed-dashboard.integration.test.ts \
  -t 'managed account forward migration|managed identity database invariants|creates one account and delivers|isolates managed mappings'
```

The PostgreSQL cases include ownership assertions needed to check the identity boundary.
This pass does not audit Save, replay, copy consumption, or share behavior. No live
Google/Neon session, production origin, provider cookie attributes, or live revocation was
verified. Those deployment properties remain outside these local results.
