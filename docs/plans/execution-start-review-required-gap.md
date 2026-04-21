# Review: `execution:start` Returns Empty While Project Remains `review_required`

## Scope

Observed while continuing `ITEM-0007` after a successful planning stage and after fixing the earlier story-worktree verification baseline issue.

Relevant commands:
- `planning:approve --project-id project_ce84652e-b7f0-4216-a924-975eba802b63 --autorun`
- `execution:start --project-id project_ce84652e-b7f0-4216-a924-975eba802b63`
- `project:show --project-id project_ce84652e-b7f0-4216-a924-975eba802b63`

## Observed behavior

- `planning:approve --autorun` reported a downstream stop at `verification_readiness_blocked`.
- After fixing the project baseline and rerunning `execution:start`, the command returned:
  - `activeWaveCode: "W01"`
  - `scheduledCount: 0`
  - `executions: []`
- At the same time, `project:show` still reports:
  - `item.currentColumn: "implementation"`
  - `item.phaseStatus: "review_required"`

This leaves the operator in an unclear state:
- planning is already completed
- execution is not blocked by a direct command error
- but execution silently schedules nothing because the project is still treated as review-gated

## Concrete evidence

For `ITEM-0007` / `ITEM-0007-P01`:
- Project id: `project_ce84652e-b7f0-4216-a924-975eba802b63`
- Planning run `run_d9e4a70c-289b-4fd2-97f5-731ac867750a` is `completed`
- `execution:start` returned no scheduled executions
- `project:show` still reports `phaseStatus: "review_required"`

## Why this is a problem

- The CLI does not clearly explain which review gate is still open.
- The operator has no direct pointer to the blocking review artifact/run from the `execution:start` result.
- From the outside, this looks like execution is broken or silently ignoring the project, even though the real state is "review still unresolved".

## Expected behavior

If execution cannot start because the project or wave is still `review_required`, the CLI should return a blocking result that explicitly names:
- the unresolved review type
- the blocking run or artifact id
- the command to inspect it next

For example:
- `status: "blocked"`
- `reason: "planning_review_required"` or `reason: "implementation_review_required"`
- `blockingRunId: "..."`
- `nextCommand: "planning-review:show ..."`

## Likely failure boundary

The problem appears to be in execution gating / status-to-CLI reporting, not in the planner itself.

Likely areas to inspect:
- `src/workflow/execution-service.ts`
- `src/workflow/status-resolution.ts`
- `src/workflow/autorun-orchestrator.ts`
- CLI presentation in `src/cli/main.ts`

## Suggested fix direction

1. Make `execution:start` return an explicit blocked status when review gating prevents scheduling.
2. Include the concrete unresolved review/run identifier in the response.
3. Add an integration test that asserts:
   - project remains `review_required`
   - `execution:start` does not silently return an empty schedule
   - the result identifies the blocking review path and next inspection command.

## Resolution status

Implemented fix scope:

- `execution:start` now returns an explicit review blocker payload instead of ending with `scheduledCount: 0` and `executions: []` when the active wave is already `review_required`.
- the result now reports:
  - `blockedByReview: true`
  - `reason` for the blocking review path
  - `blockingRunType`
  - `blockingRunId`
  - `blockingStoryCode`
  - `nextCommand`
- planning re-import now tears down the previous wave / wave-execution subtree transactionally before replacing the implementation plan, so later planning reruns do not fail with `FOREIGN KEY constraint failed` or leave partial wave state behind.
- `planning:approve` now validates that waves, wave stories and persisted dependencies are actually materialized before approval succeeds.
- execution/verification readiness now reports a dedicated `worktree_baseline_uncommitted` blocker when the main workspace contains uncommitted project-setup changes that story worktrees, created from committed `HEAD`, cannot inherit.

Regression coverage added:

- explicit `execution:start` review-gate reporting
- worktree baseline / uncommitted setup precondition
- planning approval materialization integrity
