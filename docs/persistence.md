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
