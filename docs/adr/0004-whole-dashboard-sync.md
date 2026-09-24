---
status: accepted
---

# Local-first whole-dashboard synchronization with optimistic revisions

Signed-in dashboards use local-first, whole-dashboard synchronization. Cloud writes use optimistic
revisions and never silently apply last-write-wins: this preserves a bounded dashboard as the unit
of ownership while making concurrent edits explicit instead of claiming automatic reconciliation.

Realtime connections, CRDTs, automatic field merging, collaboration, paid tiers, and public sharing
are excluded. This is accepted target architecture, not implemented behavior; conflict interaction,
retry scheduling, and the separately accepted Job 3 stack are specified in the
[account and synchronization design](../ACCOUNT_SYNC.md).
