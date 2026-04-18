# Artifacts

Artefakte werden unter `var/artifacts/` gespeichert.

Pfadkonvention:

```text
items/<itemId>/<projectId|_shared>/runs/<stageRunId>/<kind>.<format>
```

Zu jedem Artefakt werden in SQLite gespeichert:

- relativer Pfad
- SHA-256
- Dateigroesse
- Bezug zu `Item`, optional `Project` und `StageRun`
