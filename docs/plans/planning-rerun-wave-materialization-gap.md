# Review: Planning Rerun Leaves Execution Waves Non-Executable

## Scope

Observed while continuing `ITEM-0007` after architecture replanning and attempting to re-enter execution.

Relevant project:
- `ITEM-0007`
- project: `ITEM-0007-P01`
- project id: `project_ce84652e-b7f0-4216-a924-975eba802b63`

## Observed behavior

There are now two related planning-path failures:

1. A previous planning rerun produced a revised artifact but failed import with:
   - `Failed to import planning output: FOREIGN KEY constraint failed`
   - run id: `run_e2c8b8f6-f018-439f-b572-fc46d3b9caf5`

2. A later planning rerun stays `running` without materializing an executable wave payload:
   - run id: `run_37562133-d3b9-4cde-8071-e6835cbeacb5`
   - `project:show` reports `phaseStatus: running`
   - `run:show` for that run has no artifacts and no sessions
   - `execution:show` still shows:
     - active wave `W01`
     - `waveExecution.status: "blocked"`
     - `stories: []`

The result is a project that looks like it has an approved implementation plan and an active wave, but the wave is not executable because no wave stories were materialized.

## Concrete evidence

- Approved implementation plan:
  - `plan_f889402d-c2ed-4a24-8de1-ff0d57c579e9`
  - status: `approved`
- Execution state still empty:
  - `execution:start` returns `scheduledCount: 0`
  - `executions: []`
- Wave state:
  - `wave_execution_d33b9f4c-9646-4f77-84c9-5b9b74e861ad`
  - status: `blocked`
  - no wave stories attached in `execution:show`

## Why this is a problem

- The CLI can no longer advance from planning into execution even though the plan is approved.
- Operators see inconsistent state:
  - approved plan
  - active wave
  - blocked execution
  - but no executable stories
- A rerun of planning can leave the repo in a more confusing state than before, because the wave shell exists while its execution payload does not.

## Expected behavior

After a successful planning approval or planning rerun:
- every wave must have its `wave stories` and dependencies persisted
- execution should see those stories immediately
- if materialization fails, the plan should not remain effectively active/executable

If planning is still running or import failed:
- the CLI should not leave the previous wave execution in a half-live blocked state without telling the operator why

## Likely failure boundary

The failure appears to sit in planning import / wave materialization / execution-state reconciliation.

Likely areas to inspect:
- `src/workflow/stage-service.ts`
- `src/workflow/workflow-service.ts`
- `src/workflow/execution-service.ts`
- planning import path that persists implementation plan waves and wave stories

## Suggested fix direction

1. Make planning import idempotent and transactional across:
   - implementation plan
   - waves
   - wave stories
   - story dependencies
2. If import fails, roll back or keep the prior executable plan/wave state intact.
3. When a new planning rerun starts, reconcile or replace old blocked `waveExecution` rows so execution state matches the active plan payload.
4. Add an integration test that asserts:
   - a planning rerun can revise a project that already has an approved plan
   - the rerun either produces a full new executable wave payload or fails cleanly without leaving empty waves
   - `execution:start` never sees an approved plan with `stories: []` for the active wave.
