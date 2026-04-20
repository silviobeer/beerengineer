# Artifacts

BeerEngineer trennt zwischen Runtime-Artefakten und bewusst exportierten,
versionierbaren Ergebnissen im bearbeiteten App-Workspace.

Engine-interne Artefakte werden unter `.beerengineer/artifacts/` gespeichert und
sollten als Runtime-Daten nicht versioniert werden.

Pushbare Delivery-Reports werden dagegen bewusst unter
`docs/delivery-reports/<workspaceKey>/` materialisiert.

Runtime-spezifische Git-Worktrees liegen unter:

```text
.beerengineer/workspaces/<workspaceKey>/worktrees/
```

Pfadkonvention:

```text
.beerengineer/artifacts/workspaces/<workspaceKey>/items/<itemId>/<projectId|_shared>/runs/<stageRunId>/<kind>.<format>
```

Zu jedem Artefakt werden in SQLite gespeichert:

- relativer Pfad
- SHA-256
- Dateigroesse
- Bezug zu `Item`, optional `Project` und `StageRun`

Empfohlene Git-Semantik im Workspace:

- `.beerengineer/` komplett ignorieren
- `docs/delivery-reports/<workspaceKey>/` bei Bedarf committen
