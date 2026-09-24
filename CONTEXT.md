# KendoMenu Training

KendoMenu models reusable kendo practice menus and dashboard-specific adaptations.

## Language

**Training session / keiko menu (`TrainingSet`)**:
A complete, reusable, ordered kendo practice menu.

**Built-in training session**:
An immutable curated session from the authored drill collection; `isBuiltIn` is `true`.

**Custom training session**:
A practitioner-authored session using the same runtime model; `isBuiltIn` is `false` and it appears
on the dashboard rather than in the curated library.

**Dashboard entry**:
A dashboard-owned snapshot of a selected training session, with its own quantity overrides and notes.

**Activity (`TrainingActivity`)**:
A recursive runtime practice node with a stable activity ID and zero or more child activities.

**Exercise**:
A leaf activity with no children.

**Authored drill data**:
The curated JSON source in `packages/domain/data/default-drills.json`. Its source-facing
`sections`/`exercises` shape is validated and adapted; it is not the recursive runtime vocabulary.

**Session activity note**:
A practitioner-entered note keyed by activity ID within one dashboard entry.

**Quantity override**:
A dashboard-specific quantity keyed first by activity ID and then by unit; absence is not zero.

## Account and continuity language

**KendoMenu account**:
A practitioner's identity within KendoMenu, associated with their account workspace.

**Application session**:
A period during which KendoMenu recognizes a practitioner as signed in. It is used for authentication
and is distinct from a kendo training session, which describes practice activities.

**Guest workspace**:
The dashboard belonging to anonymous use in one browser, separate from any account workspace.

**Account workspace**:
The dashboard belonging to one KendoMenu account across its signed-in devices.

**Guest adoption**:
The practitioner's choice to move an eligible guest dashboard into their new account's empty cloud
dashboard.

**Cloud dashboard**:
The account's acknowledged dashboard held for continuity between devices.

**Dashboard revision**:
An identifier for an acknowledged edition of a cloud dashboard.

**Synchronization conflict**:
A disagreement between a device's dashboard changes and a cloud dashboard changed since that
device's last acknowledged revision.
