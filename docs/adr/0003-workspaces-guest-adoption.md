---
status: superseded by ADR-0006
---

# Separate workspaces with explicit guest adoption

Guest and authenticated workspaces remain separate to avoid silent combination or loss at sign-in.
A blocking Yes/No choice appears only when a new KendoMenu account has an empty cloud dashboard and
the browser contains an eligible, non-empty guest workspace: Yes uploads the complete validated
guest dashboard, creates the account cache, and deletes the guest workspace only after server
acknowledgement; No preserves the hidden guest workspace, which reappears after logout.

There is no dismiss action. Exact eligibility for returning empty accounts is not accepted by this
ADR and requires owner confirmation. This was the original target, not implemented behavior. The
current decision is [ADR 0006](0006-independent-dashboards-one-time-guest-copy.md); the original
move/delete rule above is retained as historical evidence.
