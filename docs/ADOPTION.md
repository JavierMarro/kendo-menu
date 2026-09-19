# Job 6A: authoritative guest-adoption backend

## Approved scope

Job 6A adds server-authoritative adoption and recovery. Jobs 6B–6D own browser workspaces,
synchronization, and account UI; account entry points remain inaccessible until 6D completes.
This work does not migrate production or connect to Neon.

The first successful Google login creates the account, its application session, and its pending
adoption capability in one transaction. Returning accounts receive no new capability, including
accounts whose cloud dashboard is still empty. Concurrent callbacks must not issue it twice.

An account has one adoption row, with a nullable creating-session reference and at most one terminal
receipt. Foreign keys point from adoption to users and sessions. Accepted and declined completions
remain available to later authenticated sessions for the same account; they do not retain another
dashboard representation or a history of adoption receipts.

Pending capability requires the active creating session and cloud revision zero. Expiry, revocation,
replacement, or an ordinary dashboard write makes it unavailable. Unavailable never means declined.
Session inspection computes eligibility without writing; authenticated mutations normalize stale
pending state. Eligible pending state survives rejected ordinary dashboard writes. Authentication,
logout, adoption, and dashboard writes lock the account before its session and adoption state.
Expiry is rechecked after database waits and before completing an adoption mutation or replay.

## HTTP contract

`GET /api/session` adds a strictly validated `adoption` union:

| Status                     | Public fields                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pending` or `unavailable` | `status`, `capability`                                                                                      |
| `accepted`                 | `status`, `capability: false`, completion with `decision`, `requestId`, `acknowledgedRevision`, `timestamp` |
| `declined`                 | `status`, `capability: false`, completion with `decision`, `requestId`                                      |

No adoption status exposes request digests, dashboard contents, session IDs, Google subjects, or
credentials. Session-status recovery does not require resubmitting the original dashboard.

`POST /api/dashboard/adoption` authenticates and checks Origin/CSRF before acquiring or reading the
body. Automatic framework parsing is disabled. The endpoint requires JSON, rejects query parameters,
and bounds the entire envelope to 2,097,152 UTF-8 bytes. Both decisions require a stable request ID
and the expected internal account ID. Yes contains the existing dashboard transport fields and
requires revision `"0"`; No contains no dashboard.

Yes atomically checks capability and revision, writes the dashboard and ordinary acknowledgement,
and records accepted completion. No records declined completion without a dashboard write.
An authenticated identical terminal replay returns the original completion even after capability
consumption. Changed payloads, opposing decisions, and reused request IDs conflict. HEAD and other
unsupported methods return 405 with `Allow: POST` without consuming a body. All responses are
private/no-store.

Google callback failures redirect to `/app?authError=<allowlisted-code>` for cancellation, failure,
or temporary unavailability. A valid browser-bound login transaction is consumed before processing
provider cancellation or exchange failure. Every failure clears the login cookie and issues no
application-session cookies. Invalid binding must not consume another browser's transaction;
unavailable persistence fails closed. Redirects and logs never contain provider responses or
sensitive callback values.

## Verification and remaining gates

Required checks are `pnpm check`, `pnpm db:check`, and `pnpm test:api:integration`, followed by
independent review of the actual implementation. Integration tests use only the configured local
`kendomenu_test` connection and uniquely owned schemas. The harness validates the URL before opening
a socket and verifies the server's database name before creating its schema.

The local preflight confirmed the exported test variable without printing its value, then created,
migrated, and removed an isolated harness schema successfully. Checks use Node **24.12.0**, restored
to a temporary directory and verified against the official archive checksum, with
`pnpm_config_verify_deps_before_run=false`.

| Check                       | Observed result                                    |
| --------------------------- | -------------------------------------------------- |
| Local database preflight    | Passed; URL value never printed                    |
| `pnpm test:api:integration` | Passed: 152 tests across 11 files                  |
| `pnpm db:check`             | Passed                                             |
| Repeated `pnpm db:generate` | No schema changes; no additional migration         |
| `pnpm check`                | Passed: 744 unit tests, types, lint, format, build |

Integration coverage includes concurrent first logins, Yes/No and ordinary-write races, revocation
and replacement races, rollback, ambiguous committed decisions, identical replay, changed payloads,
later-session recovery, and permanent completion after ordinary receipt cleanup. Migration tests
cover empty-schema application, exact preservation of Job 5B data, repeated application, late-DDL
rollback, SQL constraints, and journal/snapshot consistency. HTTP tests prove authorization before
body acquisition and enforce the complete UTF-8 envelope limit.

Independent review identified callback replacement normalization, expiry across database waits,
and premature capability consumption by rejected ordinary writes. Those findings have regression
coverage and were corrected. Independent re-review returned **PASS**, with no remaining substantive
defects. `git diff --check`, scoped debug-log scanning, and the final documentation/history checks
also passed. No dependency, deployment, or production configuration files changed.

The creating-session rule deliberately fails closed if an initial login commits but its response
never reaches the browser: a later login does not receive a replacement capability. Guest data is
not deleted by this backend. Browser preservation and adoption UI remain later-job work. The
creating-session foreign key verifies session existence; the adapter separately verifies that the
session belongs to the account before granting capability.

Real Google, HTTPS cookies, Neon, Vercel routing, and Fluid Compute remain separate verification
gates. No commit, push, deployment, production migration, or external configuration change belongs
to this job.
