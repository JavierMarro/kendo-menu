---
status: accepted
---

# Optional Google identity with KendoMenu application sessions

Anonymous use remains fully supported and free; optional KendoMenu accounts use Google as the only
identity provider. KendoMenu owns an opaque server-side application session, with credentials in
Secure, HttpOnly cookies and never LocalStorage, separating provider identity from application
access rather than making a Google token or browser-readable bearer token the application session.

This is accepted target architecture, not implemented production behavior. Provider libraries,
session lifetimes, and deployment choices remain recommendations in the
[account and synchronization design](../ACCOUNT_SYNC.md).
