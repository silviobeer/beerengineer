# Persistence

SQLite enthaelt im MVP die Kernobjekte:

- `workspaces`
- `workspace_settings`
- `items`
- `concepts`
- `projects`
- `user_stories`
- `architecture_plans`
- `stage_runs`
- `agent_sessions`
- `artifacts`
- `stage_run_input_artifacts`

Migrationen werden ueber `src/persistence/migration-registry.ts` definiert und bei CLI-Starts automatisch angewendet.

## Workspace Scope

Der persistierte Top-Level-Scope ist jetzt `Workspace`.

- jedes `Item` gehoert direkt zu genau einem Workspace
- alles unterhalb von `Item` bleibt indirekt workspace-scoped ueber die bestehenden Beziehungen
- Workspace-Einstellungen leben separat in `workspace_settings`

Der technische `workspaceRoot` fuer Git-/Repo-Ausfuehrung ist bewusst nicht
gleich dem fachlichen Workspace-Scope.

Im aktuellen Git-Lifecycle gilt:

- `gitMetadataJson` auf `wave_story_executions` und `story_review_remediation_runs`
  ist die kanonische Persistenz fuer Branch-, Merge- und Worktree-Zustand
- `workspaceRoot` in diesen Metadaten bleibt der stabile Projekt-Root
- `worktreePath` zeigt optional auf den aktiven Story-/Fix-Worktree
- `mergedIntoRef` und `mergedCommitSha` dokumentieren den engine-seitig
  ausgefuehrten Merge nach erfolgreichem Gate-Pass

Wichtig:

- `0000_initial` beschreibt das Basisschema
- nachtraegliche Schemaaenderungen bekommen eigene inkrementelle Migrationen
- aktuelles Beispiel: `0001_add_verification_run_mode` fuegt `verification_runs.mode` fuer bestehende Datenbanken nachtraeglich hinzu
