# Custom training sets

The custom-set builder belongs in this feature boundary. It creates a typed `TrainingSet` through
the dashboard-owned store action `useTrainingStore.createCustomTrainingSetAndAddToDashboard`.
Custom sessions are added directly to the dashboard and are not library entries; the library stays
limited to the immutable curated defaults. Dashboard copies can be edited with per-session
quantity overrides and notes.
