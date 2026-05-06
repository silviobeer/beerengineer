# Agent Notes — Supabase Readiness

## Gotchas

### Wave-gate npm workspace test paths are workspace-relative

Discovered during PROJ-6 Wave 1. Commands like
`npm run test:file --workspace=@beerengineer/engine -- apps/engine/test/...`
fail because npm executes the script from `apps/engine`. Use
`test/...` for engine tests and `tests/...` for UI tests in
`wave-gate-config.json`.

## Patterns That Work Well

### Pre-execution readiness keeps retry out of setup actions

The setup action vocabulary is intentionally limited to Supabase repair tasks.
`Retry run` belongs in `retry` metadata so CLI/API/UI surfaces can render it as
recovery, not as another missing prerequisite.
