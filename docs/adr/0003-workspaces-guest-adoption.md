---
status: accepted
---

# Separate workspaces with explicit guest adoption

Guest and authenticated workspaces remain separate to avoid silent combination or loss at sign-in.
A blocking Yes/No choice appears only when a new KendoMenu account has an empty cloud dashboard and
the browser contains an eligible, non-empty guest workspace: Yes uploads the complete validated
guest dashboard, creates the account cache, and deletes the guest workspace only after server
acknowledgement; No preserves the hidden guest workspace, which reappears after logout.

There is no dismiss action. Exact eligibility for returning empty accounts is not accepted by this
ADR and requires owner confirmation. This target is not implemented; eligibility recommendations
and failure handling are in the [account and synchronization design](../ACCOUNT_SYNC.md).
