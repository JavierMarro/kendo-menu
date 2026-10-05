---
status: accepted
---

# Managed authentication and online account drafts

Neon-operated Google-only authentication replaces KendoMenu's custom Google OAuth and opaque
application sessions. Managed browser session cookies are expected; credentials must never enter
JavaScript-readable persistence. Guests retain offline Zustand/LocalStorage. Account dashboards
load online, hold drafts only in memory, and save explicitly with existing ownership, validation,
revision and request-id protections. Reload can lose an unsaved account draft.
This reduces application-owned authentication and offline-account synchronization complexity,
accepting unsaved-draft loss and a missed guest-copy opportunity after interruption.

This supersedes ADR 0002's custom session architecture, ADR 0004's local-first account synchronization,
and ADR 0006's account IndexedDB cache, creating-session eligibility, and durable interrupted-copy
recovery. Retain independent dashboards, a complete new-account-only Yes copy or permanent No,
unchanged guest source, atomic acknowledged writes, and no later automatic transfer. An interrupted
copy may consume the opportunity; ordinary account use must not wait indefinitely for recovery.
Historical ADRs, SQL migrations and evidence remain unchanged.

Migration A must prove supported SDK credential handling and real managed identity reaching the
Node/Elysia verifier before B maps issuer/subject to an internal account. Email is metadata, never
authorization; managed subject is neither assumed to be a UUID nor a Google subject. A creates no
account and needs no database or managed session ID. See the
[transition handoff](../MANAGED_AUTH_TRANSITION.md) for sequential scope and the
[A proof and live gates](../MANAGED_AUTH_PROOF.md) for the observed SDK constraint and selected callback/token path.

This is the approved replacement decision, not evidence that the replacement works. The pinned SDK
persists credentials through its session-refresh lifecycle; the isolated proof uses one supported
callback-only session bootstrap on a fresh document, then replaces the document before token-only
retrieval. This avoids that write in synthetic tests. The owner reported the prior token-before-bootstrap
live attempt failed with no managed session; the latest owner-reported retry passes callback,
reload, expiry refresh and sign-out. Initial storage evidence covered inspected sign-in/out only;
subsequent private owner inspection reports credential-free storage/no account IndexedDB or
CacheStorage after reload and JWT refresh, with stable identity. The 5 October amendment records second-account
distinction/return stability as NOT RUN — owner-deferred, required before public account release
but alone not blocking a reviewed A commit or internal B. No other gate is waived. Existing legacy runtime behavior remains implemented; no replacement production route
or authentication path is enabled.
