# Agent Notes — Supabase Readiness

## Gotchas

### Wave-gate npm workspace test paths are workspace-relative

Discovered during PROJ-6 Wave 1. Commands like
`npm run test:file --workspace=@beerengineer/engine -- apps/engine/test/...`
fail because npm executes the script from `apps/engine`. Use
`test/...` for engine tests and `tests/...` for UI tests in
`wave-gate-config.json`.

### Empty setup waves are DB-neutral prelude metadata

Discovered during PROJ-6 Wave 2 while wiring pre-execution readiness into
resume. Fake/generated plans can include a `kind: "setup"` wave with tasks and
no stories before feature waves. Treat that empty setup wave as DB-neutral
prelude; keep strict `dbRelevant` / `dbRelevantWave` validation for feature
waves and stories.

## Patterns That Work Well

### Pre-execution readiness keeps retry out of setup actions

The setup action vocabulary is intentionally limited to Supabase repair tasks.
`Retry run` belongs in `retry` metadata so CLI/API/UI surfaces can render it as
recovery, not as another missing prerequisite.
