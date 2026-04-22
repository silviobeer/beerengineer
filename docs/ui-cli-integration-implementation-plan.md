# UI, CLI, And Live Workflow Integration Plan

## Goal

Make the application behave as one coherent system:

- an item action in the UI can start or advance workflow work
- the engine runs through the same persisted execution model regardless of whether it was triggered from UI or CLI
- work performed by the engine is reflected back into the UI without manual refresh

## Current State

### What already works

- The UI can start a run through `POST /runs`.
- The run console can answer engine prompts through `POST /runs/:id/input`.
- The engine API persists runs, stage runs, logs, prompts, and item column state into SQLite.
- The run console subscribes to SSE and reflects run progress live.

### What does not work

- The board UI is read-only. It cannot move/promote/advance items.
- The standalone CLI runs `runWorkflow()` directly and bypasses the persisted run model.
- The board page reads SQLite on render, but does not live-update while open.
- There is no single workflow command model shared by UI and CLI.
- There is no backend mutation API for board actions such as promote-to-requirements or start-implementation.

## Target Model

Use one persisted workflow execution path for every trigger:

1. UI action or CLI command issues an intent against an item.
2. Backend converts that intent into a run or stage transition.
3. Engine executes through the same orchestrator, DB sync, and event stream.
4. UI run console and board both react to persisted state and live events.

## Scope

### In scope

- Unify CLI-triggered work with the same persisted run/orchestrator path used by the API.
- Add backend item action endpoints.
- Add real board action controls in the UI.
- Make the board update live while open.
- Add integration tests that cover UI/API/CLI persistence behavior.

### Out of scope for this phase

- Major visual redesign of the UI.
- Reworking stage semantics beyond what is needed to expose actionable transitions.
- Multi-user auth/permissions.

## Implementation Phases

### Phase 1: Unify Engine Entry Paths

Objective: the CLI must no longer bypass the run database model.

Tasks:

- Add a CLI command path that creates a persisted run through `prepareRun()` or `runWorkflowWithSync()`.
- Initialize `Repos` and SQLite in the CLI entrypoint.
- Ensure CLI-triggered runs create:
  - `items`
  - `runs`
  - `stage_runs`
  - `stage_logs`
  - `artifact_files`
  - `pending_prompts`
- Keep terminal prompting behavior, but route it through the same orchestrator and DB sync used by the API.

Acceptance criteria:

- Starting a run from the CLI creates a row visible on `/runs`.
- A CLI-triggered run updates item column/phase state in SQLite.
- The UI can inspect a CLI-triggered run after it starts.

### Phase 2: Define Item Workflow Actions

Objective: create a clear action model for item-level progression.

Tasks:

- Define supported item intents, for example:
  - `start_brainstorm`
  - `promote_to_requirements`
  - `start_implementation`
  - `resume_run`
  - `mark_done`
- Decide which actions:
  - start a new run
  - resume an existing run
  - directly mutate item state
- Add backend command handlers so actions are explicit and validated.
- Prefer one endpoint shape such as:
  - `POST /items/:id/actions`
  - body: `{ action: "promote_to_requirements" }`

Acceptance criteria:

- Backend rejects invalid actions for the item’s current state.
- Backend returns the created or affected `runId` when an action starts work.
- Item state transitions are persisted and observable in the DB.

### Phase 3: Wire Board UI Actions

Objective: make board actions real instead of presentational.

Tasks:

- Replace inert overlay action spans with buttons or links that call the new item action API.
- Add item identity to board card/overlay view models so actions target a concrete item.
- Add optimistic or loading states around action submission.
- Route operators to `/runs/:id` when an action starts background work.

Acceptance criteria:

- Clicking an item action from the board triggers a backend mutation.
- The operator sees success/failure feedback.
- Starting workflow work from the board opens or links to the associated run.

### Phase 4: Make The Board Live

Objective: reflect backend changes on the board without manual refresh.

Tasks:

- Choose one live update mechanism:
  - SSE board stream
  - client polling
  - revalidation triggered by run events
- Preferred approach:
  - add a board-level SSE stream or workspace event stream
  - subscribe on the board page
  - refresh board state when item/run/stage events affect visible items
- Include at least these event types:
  - `run_started`
  - `stage_started`
  - `stage_completed`
  - `item_column_changed`
  - `run_finished`
  - `project_created`
- Ensure duplicate replay/live events are handled safely.

Acceptance criteria:

- Keeping `/` open while a run progresses updates the item’s column/phase state.
- CLI-triggered runs also appear/move on the board while the page is open.
- Refresh is not required to observe normal workflow progression.

### Phase 5: Close The UI/CLI Gap

Objective: make CLI and UI interchangeable control surfaces over the same system.

Tasks:

- Decide whether the CLI should:
  - call the engine API over HTTP, or
  - operate in-process against the same DB/orchestrator modules
- Recommended for now:
  - keep CLI in-process
  - use the same repositories/orchestrator as the API
  - do not fork behavior between CLI and API workflow startup
- Add a CLI mode for item actions, for example:
  - `beerengineer item action --item <id> --action promote_to_requirements`
- Ensure CLI actions mutate the same persisted state the UI reads.

Acceptance criteria:

- A CLI action against an existing item is reflected in the UI.
- A UI action against an item is inspectable from CLI tooling or logs.
- There is one authoritative execution model, not one for API and another for CLI.

### Phase 6: Verification And Regression Coverage

Objective: cover the new integration contract with tests.

Tasks:

- Add engine tests for item action handlers.
- Add API integration tests for:
  - starting/resuming runs from item actions
  - invalid action rejection
  - SSE propagation of item/run updates
- Add Playwright flows for:
  - board action starts run
  - run advances item on board live
  - CLI-triggered run appears in UI
- Add a test for board live updates while the page remains open.

Acceptance criteria:

- The end-to-end path is covered from trigger to reflected board state.
- Regression tests fail if CLI/API diverge again.

## Proposed Technical Changes

### Backend

- Add item action service module, for example `apps/engine/src/core/itemActions.ts`.
- Add item action HTTP route(s) in `apps/engine/src/api/server.ts`.
- Extend repositories as needed for:
  - loading item state
  - validating transitions
  - resolving latest active run for an item
- Keep workflow start/resume logic centralized in the orchestrator.

### UI

- Extend board DTO/view models to include `itemId`.
- Replace static overlay actions with actionable controls.
- Add client-side live board subscription logic.
- Keep run console SSE and board SSE concerns separate.

### CLI

- Replace direct `runWorkflow(item)` startup in `apps/engine/src/index.ts`.
- Add persisted run startup via DB-backed orchestrator.
- Add CLI commands for acting on existing items, not just creating fresh ad hoc items.

## Risks

- Stage semantics may not map cleanly to item actions without introducing a small action/state layer.
- Live board updates can become noisy if every event triggers full refresh.
- CLI UX may become awkward if it mixes ad hoc item creation and item-action commands in one entrypoint.

## Recommended Order

1. Unify CLI with persisted orchestrator path.
2. Add backend item action API and validation.
3. Wire real board action controls.
4. Add live board updates.
5. Add CLI item-action commands.
6. Add end-to-end regression coverage.

## Definition Of Done

- UI board actions are real backend mutations.
- CLI-triggered work uses the same persisted execution path as API-triggered work.
- Board state updates live while open.
- Run console and board both reflect the same underlying run/item state.
- CLI and UI can each trigger work that the other surface can observe.
