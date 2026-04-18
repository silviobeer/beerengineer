# Execution Implementation Plan

## Goal

Implement the BeerEngineer execution layer so that the engine, not the LLM, controls:

- wave progression
- story-level dependency resolution
- safe parallel execution within a wave
- worker role selection
- verification and retry flow

The LLM should stay responsible for bounded work inside a single execution unit, not for orchestration.

## Confirmed Design Decisions

### Engine Owns Orchestration

The engine decides:

- which wave is currently active
- which wave stories are ready to run
- which stories may run in parallel
- when a wave is complete
- when review or retry is required

The execution skill does not decide topology, worker count, or wave order.

### Planning Owns Parallelizability

The planning stage already stores:

- `ImplementationPlan`
- `Wave`
- `WaveStory`
- `WaveStoryDependency`

This is the source of truth for execution order.

### Agent Roles Are a Registry, Not the Scheduler

Existing agent roles are treated as reusable execution roles.
The engine chooses when to use them.

Initial active roles:

- `implementer`
- `backend-implementer`
- `frontend-implementer`

Deferred roles for later rollout:

- `code-reviewer-gate`
- `red-team-tester`
- `integration-guard`
- `ui-auditor`
- `component-scout`
- `sonar-scanner-gate`

### Context Is Split Into Persistent Project Context And Per-Run Snapshots

The execution layer should not rely on one giant repo dump.

Instead, context is split into:

- persistent project context
  - slower-moving execution guidance that can be reused across runs
- per-run execution context snapshots
  - freshly generated context for one concrete `WaveStoryExecution`

The engine owns both context types.
The LLM consumes them but does not define their structure.

## Phase 1: Minimal Execution Core

### Scope

Build a deterministic execution loop for one approved `ImplementationPlan`.

The first version should support:

- loading the latest approved implementation plan for one project
- selecting the next executable wave stories
- spawning one worker run per executable story
- tracking execution status
- basic retry handling
- story completion and wave completion

### New Runtime Entities

Add these entities:

- `ProjectExecutionContext`
  - persistent execution-oriented project context for one `Project`
- `WaveExecution`
  - one execution attempt for one `Wave`
- `WaveStoryExecution`
  - one execution attempt for one `WaveStory`
- `ExecutionAgentSession`
  - runtime session record for a worker assigned to one `WaveStoryExecution`
- `VerificationRun`
  - verification result for a `WaveStoryExecution` or `WaveExecution`

Optional later:

- `ReviewRun`
- `QaRun`

### Minimal Status Model

Suggested statuses:

- `WaveExecution`
  - `pending`
  - `running`
  - `blocked`
  - `review_required`
  - `completed`
  - `failed`

- `WaveStoryExecution`
  - `pending`
  - `running`
  - `review_required`
  - `completed`
  - `failed`

### CLI Commands

Add minimal deterministic commands:

- `execution:start --project-id <projectId>`
  - starts execution for the latest approved implementation plan
- `execution:tick --project-id <projectId>`
  - advances the plan by scheduling any newly executable stories
- `execution:show --project-id <projectId>`
  - shows current wave, story execution states, blockers, retries
- `execution:retry --wave-story-execution-id <id>`
  - retries one failed or review-required story execution

Optional:

- `execution:approve --wave-story-execution-id <id>`
  - manual override only if needed later

### Persistent Project Context

Store reusable execution context per project.

Initial fields should stay small and deterministic:

- relevant directories
- relevant files
- integration points
- test locations
- coding and repo conventions
- execution notes

This context may be:

- initialized from architecture and prior execution history
- updated between runs
- reused as the baseline for new story executions

It is not a full repo index and not a replacement for fresh run-time inspection.

## Phase 2: Story Worker Contract

### Scope

Define one bounded worker contract for exactly one story execution.

The worker input should include:

- item context
- project context
- implementation plan summary
- current wave context
- target user story
- acceptance criteria for that story
- relevant architecture summary
- persistent project execution context
- relevant repo context

The worker should not receive the whole project as an open-ended mandate.

### Execution Context Generation And Storage

For every new `WaveStoryExecution`, the engine should:

1. load the persistent `ProjectExecutionContext`
2. build the structured business context
3. derive a fresh repo context for the target story
4. persist both snapshots before the worker starts

Business context snapshot should include:

- item summary
- project summary
- implementation plan summary
- wave summary
- target user story
- acceptance criteria
- relevant architecture summary
- blocking and completed story references

Repo context snapshot should include:

- relevant directories
- relevant files
- nearby tests
- selected repo conventions
- optional file hashes or notes if useful

This keeps runs reproducible while still allowing context to reflect the current repo state.

### Worker Output

The first execution worker should return:

- summary of changes
- changed file list
- tests run
- test results
- implementation notes
- optional blockers

This should be stored in structured execution artifacts and session records.

### Role Selection Policy

The engine selects the worker role deterministically.

Initial policy:

- use `backend-implementer` if the story is clearly backend-only
- use `frontend-implementer` if the story is clearly frontend-only
- otherwise use `implementer`

This policy should be explicit code, not prompt inference.

The first version may use a minimal heuristic:

- repo/project metadata
- future story classification field if needed
- fallback to generic `implementer`

### Repo Context Curation Policy

The engine, not the worker, prepares the initial repo context.

The first version should use deterministic heuristics:

- story wording and acceptance criteria
- architecture decisions
- project execution context
- known module and test locations

The worker may inspect the repo further, but starts from the engine-curated context instead of an open-ended full-repo mandate.

## Phase 3: Verification Core

### Scope

Add deterministic post-worker verification.

The engine should verify:

- required tests ran
- worker reported success cleanly
- story acceptance criteria have a recorded verification result

Initial pragmatic rule:

- one `VerificationRun` per `WaveStoryExecution`
- if verification fails, mark story execution `review_required` or `failed`

The first version does not need full QA personas or external review systems.

### Verification Inputs

Use:

- the `UserStory`
- all `AcceptanceCriterion` records for that story
- worker output summary
- test results

Later expansion may add:

- build verification
- browser verification
- code review verification

## Phase 4: Wave Gate Logic

### Scope

Close waves deterministically inside the engine.

A wave is complete only if:

- every `WaveStory` in the wave has a completed execution
- every required verification run is green
- no story in the wave is left pending, running, blocked, failed, or review-required

Only then may the engine start the next wave.

### Blocking Rules

The engine should compute executable stories as:

- story belongs to active wave
- story has no unfinished blocking dependencies
- story is not already running or completed

This replaces freeform LLM decisions about what can run in parallel.

## Phase 5: Review And QA Expansion

This phase is explicitly deferred until the execution core is stable.

Later additions:

- optional `ReviewRun` with `code-reviewer-gate`
- optional static analysis integration
- optional `QaRun`
- UI/browser verification
- red-team or audit personas

These should plug into the execution model as optional stages, not redefine the core loop.

## Implementation Order

### Step 1

Add runtime domain types, schema, repositories, and migration updates for:

- `ProjectExecutionContext`
- `WaveExecution`
- `WaveStoryExecution`
- `ExecutionAgentSession`
- `VerificationRun`

### Step 2

Add execution service methods:

- create execution
- load and update project execution context
- build business context snapshots
- build repo context snapshots
- compute ready stories
- spawn story workers
- persist session results
- update story and wave execution status

### Step 3

Add CLI commands:

- `execution:start`
- `execution:tick`
- `execution:show`
- `execution:retry`

### Step 4

Add local demo adapter support for one-story execution so the execution path is testable end to end before real Codex integration.

### Step 5

Add tests:

- unit tests for ready-story computation
- integration tests for execution persistence
- e2e CLI flow from `planning:approve` to completed wave execution

### Step 6

Add docs for:

- execution lifecycle
- runtime entities
- CLI execution commands
- known limitations of the first execution slice

## Explicit Non-Goals For The First Cut

Do not include in the first execution implementation:

- dynamic agent-team design by the LLM
- open-ended worker spawning policies
- SonarCloud, CodeRabbit, Playwright, or browser gating
- multi-project execution
- speculative UI-specific infrastructure
- autonomous policy that bypasses explicit engine state transitions

## Success Criteria

The first execution slice is complete when:

- an approved `ImplementationPlan` can be executed deterministically
- the engine computes runnable stories from `WaveStoryDependency`
- multiple same-wave stories can run in parallel when unblocked
- a story execution is tracked as its own runtime record
- a wave closes only after all its stories are completed and verified
- the flow is reproducible via CLI and covered by tests
