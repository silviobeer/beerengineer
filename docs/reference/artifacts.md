# Artifacts

Alle persistenten Outputs gehoeren in den bearbeiteten App-Workspace.

Engine-interne Artefakte werden unter `.beerengineer/artifacts/` gespeichert.
Von menschen lesbare Workspace-Ausgaben sollen nicht in `docs/` landen. Delivery-Reports
werden ebenfalls unter diesem Namespace materialisiert, konkret unter
`.beerengineer/artifacts/delivery-reports/`.

Pfadkonvention:

```text
items/<itemId>/<projectId|_shared>/runs/<stageRunId>/<kind>.<format>
```

Zu jedem Artefakt werden in SQLite gespeichert:

- relativer Pfad
- SHA-256
- Dateigroesse
- Bezug zu `Item`, optional `Project` und `StageRun`
