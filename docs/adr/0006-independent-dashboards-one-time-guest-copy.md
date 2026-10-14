---
status: accepted
---

# Independent dashboards with a one-time guest copy

Guest and signed-in dashboards are independent workspaces. The guest dashboard uses Zustand and
LocalStorage; a signed-in dashboard uses Zustand, an account-scoped IndexedDB cache, and the cloud
API. Keeping both copies avoids destroying a practitioner's device-only work when an account is
created. This decision supersedes [ADR 0003](0003-workspaces-guest-adoption.md), which required
deleting the guest copy after adoption.

Only the creating session of a newly created KendoMenu account may receive one blocking Yes/No
adoption offer, and only when this browser has a non-empty, complete guest dashboard that passes
local validation and the cloud byte limit. Invalid or oversized guest data stays unchanged and
does not invent a No decision. An empty cloud dashboard does not establish that an account is new,
grant an offer to a returning account, or create a default menu. Yes copies the complete guest
dashboard into the account; the guest LocalStorage copy remains unchanged, including after server
acknowledgement. No permanently declines the offer and also leaves guest data unchanged. An
interrupted decision recovers from the server's terminal status or replays its stable request ID;
completion requires confirmed account-cache persistence. A completed or unavailable offer is never
issued again to a returning account.

Later edits in either workspace cause neither another adoption offer nor an automatic transfer to
the other. A future manual import feature would require a separate decision. After successful
sign-in, using the guest dashboard requires signing out; sign-out returns to the homepage. The
public offer and sign-in journey are target behavior, not part of the implemented 6D-A foundation.
