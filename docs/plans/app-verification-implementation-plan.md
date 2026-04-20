# App Verification Implementation Plan

## Goal

Add a story-level `app_verification` runtime step to BeerEngineer so the engine
can verify implemented stories in a real browser flow before `story_review` and
long before project-level `qa`.

The implementation should reuse the existing engine-first runtime pattern:

- persisted runtime entities
- deterministic workflow sequencing
- CLI-triggered execution and retry paths
- autorun integration
- bounded adapter contracts

`app_verification` should be engine-owned. The browser runner executes a
prepared story-level check, but it does not decide when the step starts, when
fallback is allowed, or how results affect the delivery flow.

## Current Baseline

The current story path in `WorkflowService` is:

1. `test_preparation`
2. `implementation`
3. `verification.basic`
4. `verification.ralph`
5. `story_review`

The main integration points already exist:

- `WaveStoryExecution` is the story-scoped runtime anchor
- `showExecution()` already surfaces per-story subruns
- `AutorunOrchestrator.resolveExecutionDecision()` gates downstream progress
- CLI already follows the `start / show / retry` pattern for runtime steps
- persistence already stores JSON snapshots and agent sessions per bounded run

This means `app_verification` should be introduced as one more story-level
runtime layer, not as a variant of `qa`.

## Confirmed Design Decisions

### App Verification Is A Separate Runtime Entity

Do not overload `VerificationRun`.

`VerificationRun` is currently code- and output-oriented and already models the
two existing modes `basic` and `ralph`.

`app_verification` has different semantics:

- browser-runner selection
- prepare/setup phase
- infrastructure vs product failure split
- browser artifacts
- retryability on its own step boundary

It should therefore get its own runtime record: `AppVerificationRun`.

### App Verification Sits Between Ralph And Story Review

For the first BeerEngineer slice the enforced order should become:

1. `test_preparation`
2. `implementation`
3. `verification.basic`
4. `verification.ralph`
5. `app_verification`
6. `story_review`

`story_review` should only run when the latest `app_verification` for the story
is `passed`.

### The Runtime Anchor Remains `WaveStoryExecution`

`AppVerificationRun` should reference `waveStoryExecutionId`.

That matches the current data model and keeps app verification tied to exactly
one implementation attempt, one repo snapshot, and one story-level retry path.

### The First Slice Should Be Serial, Not Parallel

Do not parallelize `story_review` with `app_verification` in the first cut.

The current execution path is already strictly ordered, and the autorun logic
assumes a single deterministic next action. Preserving that pattern keeps the
change small and testable.

### Config Should Be Workspace-Scoped In MVP

The current codebase already has a workspace settings layer but no project-level
settings model. The least disruptive first slice is:

- store app test configuration on `workspace_settings`
- apply it to all projects in that workspace
- allow later introduction of project overrides if needed

Recommended new field:

- `workspace_settings.app_test_config_json`

Do not overload `verificationDefaultsJson`. The current codebase already uses
`verification` for non-browser story verification, so a dedicated field is less
ambiguous.

### MVP Runner Support Should Stay Narrow

Official MVP support should be:

- runner preference order:
  - `agent_browser`
  - `playwright`
- auth strategies:
  - `existing_session`
  - `password`
- app lifecycle mode:
  - attach to an already running app
  - optional readiness command or health check

Do not try to solve general app boot orchestration, magic-link auth, or OAuth
flows in the first slice.

This matches the current engine, which has no secret manager and no persistent
browser session model yet.

## Data Model

### `AppVerificationRun`

Add a new runtime entity with these fields:

- `id`
- `waveStoryExecutionId`
- `status`
  - `pending`
  - `preparing`
  - `in_progress`
  - `passed`
  - `review_required`
  - `failed`
- `runner`
  - `agent_browser`
  - `playwright`
- `attempt`
- `startedAt`
- `completedAt`
- `projectAppTestContextJson`
- `storyContextJson`
- `preparedSessionJson`
- `resultJson`
- `artifactsJson`
- `failureSummary`
- `createdAt`
- `updatedAt`

Notes:

- use `attempt`, not `attemptCount`, to match existing runtime entities
- keep findings embedded in `resultJson` for the first slice
- add a separate findings table only if remediation for app verification becomes
  a real follow-up scope

### `WorkspaceSettings`

Add:

- `appTestConfigJson`

That config should hold the declarative browser-test setup:

- `baseUrl`
- `runnerPreference`
- `readiness`
- `auth`
- `users`
- `fixtures`
- `routes`
- `featureFlags`

## Persistence Changes

### Schema

Update:

- [src/persistence/schema.ts](/home/silvio/projects/beerengineer/src/persistence/schema.ts)
- [src/persistence/migration-registry.ts](/home/silvio/projects/beerengineer/src/persistence/migration-registry.ts)
- [src/domain/types.ts](/home/silvio/projects/beerengineer/src/domain/types.ts)

Add:

- `appVerificationRuns` table
- `appVerificationRunStatuses`
- `appVerificationRunners`
- `AppVerificationRun` domain type
- `WorkspaceSettings.appTestConfigJson`

### Repositories

Update:

- [src/persistence/repositories.ts](/home/silvio/projects/beerengineer/src/persistence/repositories.ts)
- [src/app-context.ts](/home/silvio/projects/beerengineer/src/app-context.ts)

Add:

- `AppVerificationRunRepository`
  - `create()`
  - `getById()`
  - `listByWaveStoryExecutionId()`
  - `getLatestByWaveStoryExecutionId()`
  - `updateStatus()`

The repository should mirror the existing runtime repos for QA and story review
instead of inventing a different pattern.

## Workflow Integration

### Replace The Current Post-Ralph Branch

The current `executeWaveStory()` path directly calls `executeStoryReview()` when
basic and Ralph pass.

That branch should become:

1. create basic verification
2. create Ralph verification
3. if both passed, run `executeAppVerification()`
4. only if app verification passed, run `executeStoryReview()`

### New Workflow Methods

Add to [src/workflow/workflow-service.ts](/home/silvio/projects/beerengineer/src/workflow/workflow-service.ts):

- `executeAppVerification()`
- `buildProjectAppTestContext()`
- `buildStoryAppVerificationContext()`
- `prepareAppVerificationSession()`
- `showAppVerification(appVerificationRunId)`
- `retryAppVerification(appVerificationRunId)`

Recommended method boundaries:

- context building is deterministic and local
- prepare phase resolves infrastructure and setup
- execution phase delegates to adapter/runner
- status mapping stays inside `WorkflowService`

### Result Semantics

Map outcomes strictly:

- `passed`
  - browser flow and acceptance checks succeeded
- `review_required`
  - product/UI behavior failed in a reproducible way
- `failed`
  - setup, runner, readiness, or environment failed technically

That distinction must be preserved in stored status and autorun behavior.

### Execution Status Resolution

`WaveStoryExecution.status` should remain:

- `completed` only if `story_review` passed
- `review_required` if `app_verification` or `story_review` returns
  `review_required`
- `failed` if `app_verification` or prior technical steps fail

This keeps the outer story status model unchanged while inserting a new inner
gate.

## Runner Abstraction

### Extend The Existing Adapter Layer

The current architecture routes bounded execution through `adapters/`.
`app_verification` should follow that same seam.

Update:

- [src/adapters/types.ts](/home/silvio/projects/beerengineer/src/adapters/types.ts)
- [src/adapters/local-cli-adapter.ts](/home/silvio/projects/beerengineer/src/adapters/local-cli-adapter.ts)
- [scripts/local-agent.mjs](/home/silvio/projects/beerengineer/scripts/local-agent.mjs)

Add a new adapter contract:

- `runStoryAppVerification(request): Promise<AppVerificationAdapterRunResult>`

Request should include:

- item/project/story metadata
- acceptance criteria
- project app test context
- story app verification context
- implementation summary
- repo and business snapshots from the source `WaveStoryExecution`

Result should include:

- selected runner
- overall status
- summary
- checks
- artifacts
- failure classification

### Fallback Policy

Fallback from `agent_browser` to `playwright` is allowed only during runner
initialization / prepare problems.

Do not fallback when the product flow itself fails.

This policy belongs in engine code, not in the runner script.

## CLI Integration

Add commands in [src/cli/main.ts](/home/silvio/projects/beerengineer/src/cli/main.ts):

- `app-verification:start --wave-story-execution-id <id>`
- `app-verification:show --app-verification-run-id <id>`
- `app-verification:retry --app-verification-run-id <id>`

Why `wave-story-execution-id` instead of `project-id` for `start`:

- the runtime entity is story-scoped
- retries are already story-execution-scoped elsewhere
- it avoids ambiguity if several stories are eligible at once

Autorun should still start app verification automatically after execution, so
manual start is mainly for diagnostics and explicit reruns.

## Autorun Integration

Update:

- [src/workflow/autorun-types.ts](/home/silvio/projects/beerengineer/src/workflow/autorun-types.ts)
- [src/workflow/autorun-orchestrator.ts](/home/silvio/projects/beerengineer/src/workflow/workflow-service.ts)

Required behavior:

- if a story execution passed Ralph but has no app verification yet:
  start `app-verification`
- if latest app verification is `passed`:
  continue to `story_review`
- if latest app verification is `review_required`:
  stop autorun with a product-level stop reason
- if latest app verification is `failed`:
  stop autorun with an infrastructure-level stop reason

The first slice should not auto-remediate app-verification failures.

## Show Surfaces

Update `showExecution()` so each story entry also includes:

- `appVerificationRuns`
- `latestAppVerificationRun`

This keeps `execution:show` as the central runtime inspection command without
forcing users into a separate path for normal diagnosis.

`app-verification:show` should then return the fully expanded run:

- run
- source execution
- parsed contexts
- artifacts
- related adapter sessions if stored separately

## Artifact Strategy

The first slice should persist browser artifacts as files under the existing
artifact root and reference them from `artifactsJson` in `AppVerificationRun`.

Recommended artifact metadata shape:

- `kind`
  - `screenshot`
  - `log`
  - `trace`
  - `report`
- `path`
- `label`
- `contentType`

Do not model them as first-class DB rows yet unless the UI layer needs direct
artifact queries immediately.

## Testing Strategy

### Unit

Add tests for:

- app verification status mapping
- runner fallback rules
- autorun decision logic after app verification is introduced

Likely files:

- `test/unit/...` for pure status and orchestration helpers

### Integration

Extend:

- [test/integration/repositories.test.ts](/home/silvio/projects/beerengineer/test/integration/repositories.test.ts)
- [test/integration/migrator.test.ts](/home/silvio/projects/beerengineer/test/integration/migrator.test.ts)
- [test/integration/workflow-service.test.ts](/home/silvio/projects/beerengineer/test/integration/workflow-service.test.ts)

Cover:

- repository CRUD for `AppVerificationRun`
- migration from pre-app-verification schemas
- execution path `ralph -> app_verification -> story_review`
- `review_required` vs `failed`
- retry behavior
- autorun stop behavior

### End To End

Extend:

- [test/e2e/cli-happy-path.test.ts](/home/silvio/projects/beerengineer/test/e2e/cli-happy-path.test.ts)

Cover:

- successful CLI path now includes app verification
- `execution:show` includes app verification data
- `app-verification:show`
- `app-verification:retry`

The local adapter script should provide deterministic fake browser results so
these tests do not depend on a real browser stack.

## Recommended Implementation Order

1. Add domain types, schema, migration, repository, and app context wiring.
2. Surface the new run in `showExecution()` before changing orchestration.
3. Add adapter contract and local deterministic stub for app verification.
4. Insert `executeAppVerification()` between Ralph and story review.
5. Add CLI `show` and `retry`, then manual `start`.
6. Update autorun decisions and stop reasons.
7. Expand integration and E2E coverage.

## Risks And Constraints

### The Spec Assumes Browser Capability That The Repo Does Not Yet Have

The current repo has no Playwright dependency, no browser-session persistence,
and no real `agent_browser` adapter.

Therefore the first implementation slice should make the orchestration and data
model real while keeping the local adapter deterministic.

### Secret Handling Is Not Solved Yet

The spec references `passwordSecretRef`, but the current codebase has no secret
resolution subsystem.

For the first slice, config can store secret references as opaque strings and
tests can use `existing_session` or stubbed `password` flows. Real secret
resolution should remain a follow-up.

### App Startup Should Not Be Over-Scoped

A generic "start the whole app for me" subsystem would be much larger than the
runtime step itself.

The MVP should verify a running app with optional readiness hooks, not own full
dev-server orchestration.

## Exit Criteria For The First Slice

The preparation can be considered successfully implemented when:

- a completed `WaveStoryExecution` can produce an `AppVerificationRun`
- app verification is visible in `execution:show`
- `story_review` only runs after app verification passed
- CLI supports `show` and `retry` for app verification
- autorun stops correctly on `review_required` and `failed`
- tests cover the happy path and both failure classes
