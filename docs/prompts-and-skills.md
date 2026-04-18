# Prompts And Skills

- System-Prompts liegen unter `prompts/system/`
- Skills liegen unter `skills/`
- `runProfiles` referenzieren Dateien relativ zum Repo
- beim Start eines `StageRun` wird der aufgeloeste Prompt direkt in `stage_runs.system_prompt_snapshot` gespeichert
- aufgeloeste Skills werden unveraenderlich als JSON-Snapshot in `stage_runs.skills_snapshot_json` gespeichert

Damit bleiben alte Runs nachvollziehbar, auch wenn Prompt- oder Skill-Dateien spaeter geaendert werden.
