# KendoMenu Training

KendoMenu models reusable kendo practice menus and the amounts of work they prescribe.

## Language

**Drill**:
A complete, reusable, ordered kendo training session made of sections.
_Avoid_: Workout

**Section**:
A named, ordered activity block within a drill. A section may prescribe quantities for the whole block and may contain exercises.
_Avoid_: Phase, category

**Standalone section**:
A section with no child exercises. The section itself is a valid editable activity.
_Avoid_: Empty section, placeholder exercise

**Exercise**:
A named practice activity within a section.
_Avoid_: Step, drill

**Quantity**:
A count or duration prescribed for a section or exercise. An activity can carry several independent quantities; an unstated quantity remains unknown, while zero is an explicit amount.
_Avoid_: Reps when the unit is unknown or is not repetitions

**Unspecified category**:
A drill whose source did not assign a practice category.
_Avoid_: Mixed when the source does not establish a mixture
