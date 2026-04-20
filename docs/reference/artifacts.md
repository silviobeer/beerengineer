# Artifacts

BeerEngineer trennt zwischen Runtime-Artefakten und bewusst exportierten,
versionierbaren Ergebnissen im bearbeiteten App-Workspace.

Engine-interne Artefakte werden unter `.beerengineer/workspaces/<workspaceKey>/artifacts/` gespeichert und
sollten als Runtime-Daten nicht versioniert werden.

Pushbare Delivery-Reports werden dagegen bewusst unter
`docs/delivery-reports/<workspaceKey>/` materialisiert.

Runtime-spezifische Git-Worktrees liegen unter:

```text
.beerengineer/workspaces/<workspaceKey>/worktrees/
```

Pfadkonvention:

```text
.beerengineer/workspaces/<workspaceKey>/artifacts/
  items/<itemId>/
    <projectId|_shared>/
      stages/<stageKey>/
        runs/<stageRunId>/
          <kind>.<format>
```

Damit ist sofort erkennbar:

- zu welchem Workspace ein Artefakt gehoert
- zu welchem Item und optional welchem Project es gehoert
- aus welcher Stage es stammt
- zu welchem konkreten Lauf es gehoert

Zu jedem Artefakt werden in SQLite gespeichert:

- relativer Pfad
- SHA-256
- Dateigroesse
- Bezug zu `Item`, optional `Project` und `StageRun`

Empfohlene Git-Semantik im Workspace:

- `.beerengineer/` komplett ignorieren
- `docs/delivery-reports/<workspaceKey>/` bei Bedarf committen
