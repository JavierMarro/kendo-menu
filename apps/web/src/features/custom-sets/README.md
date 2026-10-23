# Custom training sets

The custom-set builder belongs in this feature boundary. It creates a typed `TrainingSet` through
the dashboard-owned store action `useTrainingStore.createCustomTrainingSetAndAddToDashboard`.
Custom sessions are added directly to the dashboard and are not library entries; the library stays
limited to the immutable curated defaults. Library dashboard entries allow quantity overrides and
notes; custom dashboard entries also offer **Edit menu**.

Guest and account `drills/:entryId/edit` routes reuse the builder with the existing menu and effective
quantities filled in. **Save changes** replaces that custom snapshot through the guarded store
action `updateCustomTrainingSet`, retaining IDs and notes for existing content and generating IDs
for additions. **Cancel** leaves the store untouched. Guest saves flush local storage; account edits
update the memory draft for the separate **Save to account** flow. Dirty-form navigation guards and
workspace availability gates cover both creation and editing. Built-in and missing entries never
mount an editable form.
