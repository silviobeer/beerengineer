# Persistence

SQLite enthaelt im MVP die Kernobjekte:

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

Wichtig:

- `0000_initial` beschreibt das Basisschema
- nachtraegliche Schemaaenderungen bekommen eigene inkrementelle Migrationen
- aktuelles Beispiel: `0001_add_verification_run_mode` fuegt `verification_runs.mode` fuer bestehende Datenbanken nachtraeglich hinzu
