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
- The board DTO already includes `itemId` for each card.

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

## Architectural Decisions (gate Phase 1)

These three decisions must be made and written down before Phase 1 begins. They determine the shape of every later phase.

### D1. CLI transport: in-process vs. HTTP

**Decision:** CLI stays in-process. It imports the orchestrator and repositories directly and opens the same SQLite file the API uses.

Rationale:

- Avoids forcing an API server to run for local CLI use.
- Avoids double-encoding prompt IO over HTTP.
- The orchestrator already exposes `prepareRun` / `runWorkflowWithSync` suitable for in-process use.

Consequence: file-level SQLite locking must be tolerated. If the API is running concurrently, both processes will contend on the same DB; acceptable for single-operator dev use.

### D2. Prompt ownership for CLI-started runs

**Decision:** The CLI process that started a run owns its prompts for that run's lifetime and answers them through the terminal `ioCli` adapter. Those prompts are also mirrored into `pending_prompts` for visibility, but the UI MUST NOT answer prompts on a run whose `owner = "cli"`.

Tasks this implies:

- Add `owner` column on `runs` (`"cli" | "api"`).
- `POST /runs/:id/input` rejects input for runs where `owner = "cli"`.
- UI run console shows read-only prompt state for CLI-owned runs.

Out of scope: cross-surface prompt answering (UI answering a CLI prompt or vice versa).

### D3. Item identity and ID minting

**Decision:** Item IDs are minted by a single repository function `Repos.items.nextId()` that returns monotonically increasing `ITEM-####`. The CLI stops hardcoding `ITEM-0001` in Phase 1. A CLI run either creates a new item (default) or targets an existing `--item <id>` (added in Phase 5).

Consequence: old ad-hoc CLI behavior is replaced; see Migration Note below.

## Item Action State Model

Phase 2 and Phase 3 are testable only if the transition matrix is explicit. The matrix must use the real persisted item model:

- `items.current_column`: `idea | brainstorm | requirements | implementation | done`
- `items.phase_status`: `draft | running | review_required | completed | failed`

Actions are defined against the current board column plus phase status. Cells below describe the target state or `reject`.

| Action                    | idea/draft | brainstorm/* | requirements/* | implementation/running | implementation/review_required | done/* |
| ------------------------- | ---------- | ------------ | -------------- | ---------------------- | ------------------------------ | ------ |
| `start_brainstorm`        | → brainstorm/running (new run) | reject | reject | reject | reject | reject |
| `promote_to_requirements` | reject | → requirements/draft | reject | reject | reject | reject |
| `start_implementation`    | reject | reject | → implementation/running (new run) | reject | reject | reject |
| `resume_run`              | reject | resume active run | resume active run | resume active run | reject | reject |
| `mark_done`               | reject | reject | reject | reject | → done/completed | reject |

Actions that "start a new run" create a fresh `runs` row; `resume_run` reattaches an existing one. Invalid cells cause the action endpoint to return `409 Conflict` with `{ error: "invalid_transition", current, action }`.

## Event Schema (Phase 4)

Single SSE stream at `GET /events` scoped to a workspace. The existing run console SSE at `GET /runs/:id/events` stays as-is and is unaffected; the board subscribes only to `/events`.

| Event                 | Payload                                         | Emitted from              |
| --------------------- | ----------------------------------------------- | ------------------------- |
| `run_started`         | `{ runId, itemId, startedAt }`                  | orchestrator: prepareRun  |
| `stage_started`       | `{ runId, itemId, stage }`                      | orchestrator: stage enter |
| `stage_completed`     | `{ runId, itemId, stage, status }`              | orchestrator: stage exit  |
| `item_column_changed` | `{ itemId, from, to }`                          | itemActions service       |
| `run_finished`        | `{ runId, itemId, status }`                     | orchestrator: terminate   |
| `project_created`     | `{ itemId, projectRef }`                        | orchestrator: artifact    |

Clients must tolerate duplicate events (retry during reconnect). Board reducer keys on `(itemId, event)` with last-write-wins on timestamps.

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
- Cross-surface prompt answering (see D2).

## Implementation Phases

### Phase 1: Unify Engine Entry Paths

Objective: the CLI must no longer bypass the run database model.

Prerequisites: D1, D2, D3 written down and approved.

Tasks:

- Add `owner` column to `runs`; migrate existing rows to `owner = "api"`.
- Replace `runWorkflow(item)` in `apps/engine/src/index.ts` with an in-process call to `prepareRun()` / `runWorkflowWithSync()`.
- Initialize `Repos` and SQLite in the CLI entrypoint.
- Use `Repos.items.nextId()` for new CLI items; stop hardcoding `ITEM-0001`.
- Ensure CLI-triggered runs create: `items`, `runs` (with `owner = "cli"`), `stage_runs`, `stage_logs`, `artifact_files`, `pending_prompts`.
- Keep terminal prompting via `ioCli`, but emit prompt state into `pending_prompts` for visibility.
- Guard `POST /runs/:id/input` to reject when `owner = "cli"`.

Acceptance criteria:

- Starting a run from the CLI creates a row visible on `/runs`.
- A CLI-triggered run updates item column/phase state in SQLite.
- The UI can inspect a CLI-triggered run after it starts.
- `POST /runs/:id/input` returns `409` for a CLI-owned run.

Status note:

- Phase 1 complete: `runs.owner` column + `migrateRunsOwnerColumn()` migration added; `Repos.nextItemCode()` mints monotonically increasing codes; CLI entrypoint now goes through `runWorkflowWithSync({ owner: "cli" })`; `createCliIO(repos)` mirrors prompts into `pending_prompts`; `POST /runs/:id/input` returns 409 for CLI-owned runs.
- Phase 2 complete: `apps/engine/src/core/itemActions.ts` implements the full transition matrix; `POST /items/:id/actions` returns 200 / 404 / 409 per spec.
- Phase 3 complete: `ItemBoardActions.tsx` client component renders real buttons that call `POST /items/:id/actions`, routes to `/runs/:id` on run-start, and shows toast feedback on 409.
- Phase 4 complete: `GET /events` SSE endpoint broadcasts `run_started`, `stage_started`, `stage_completed`, `item_column_changed`, `run_finished`, and `project_created`; `BoardLiveSubscriber` reconciles by calling `router.refresh()` (coalesced to 1 per 400 ms) and reconnects on error.
- Phase 5 complete: `beerengineer item action --item <id|code> --action <name>` wires the same `itemActions` service in-process.
- Phase 6 complete: contract tests for `ioApi`/`ioCli`, matrix tests for every transition cell, repos tests for `nextItemCode`/`owner`/`latestActiveRunForItem`, and HTTP integration tests (including the SSE `item_column_changed` propagation and the CLI-owned prompt rejection).

### Phase 2: Define Item Workflow Actions

Objective: create a clear action model for item-level progression.

Prerequisites: state transition table above.

Tasks:

- Implement item intents per the transition matrix: `start_brainstorm`, `promote_to_requirements`, `start_implementation`, `resume_run`, `mark_done`.
- Add backend command handlers in `apps/engine/src/core/itemActions.ts` that validate against the matrix.
- Single endpoint `POST /items/:id/actions` with body `{ action: "<name>" }`.
- Responses:
  - `200 { itemId, runId? }` on success (runId present when the action starts or resumes a run).
  - `409 { error: "invalid_transition", current, action }` on invalid transition.
  - `404` on unknown item.

Acceptance criteria:

- Every cell of the transition matrix is covered by a test (pass or expected-reject).
- Backend returns the created or affected `runId` when an action starts work.
- Item state transitions are persisted and observable in the DB.

### Phase 3: Wire Board UI Actions

Objective: make board actions real instead of presentational.

Tasks:

- Replace inert overlay action spans with buttons that call `POST /items/:id/actions`.
- Apply one consistent feedback pattern per action kind:
  - run-starting actions: show loading state until response, then route to `/runs/:id`.
  - pure state-mutation actions (e.g. `promote_to_requirements`, `mark_done`): optimistic update with revert on error.
- Surface `409` errors as a non-blocking toast explaining the invalid transition.

Acceptance criteria:

- Clicking an item action from the board triggers a backend mutation.
- The operator sees success/failure feedback per the pattern above.
- Starting workflow work from the board opens or links to the associated run.

### Phase 4: Make The Board Live

Objective: reflect backend changes on the board without manual refresh.

Prerequisites: event schema table above.

Tasks:

- Add `GET /events` SSE endpoint on the engine API. Keep it separate from the run console stream at `GET /runs/:id/events`.
- Emit the events in the schema table from the orchestrator and `itemActions` service.
- Board page subscribes to `/events`, applies updates with last-write-wins keyed on `(itemId, event)`.
- Handle reconnect and duplicate delivery explicitly — no event-sourced state rebuilds on every reconnect; reconcile by refetching the board snapshot.

Acceptance criteria:

- Keeping `/` open while a run progresses updates the item's column/phase state.
- CLI-triggered runs also appear/move on the board while the page is open.
- Refresh is not required to observe normal workflow progression.
- Reconnect does not duplicate visible items or mis-order columns.

### Phase 5: Close The UI/CLI Gap

Objective: make CLI and UI interchangeable control surfaces over the same system.

Tasks:

- Add CLI subcommand for item actions, for example:
  - `beerengineer item action --item <id> --action promote_to_requirements`
- The subcommand calls the same `itemActions` service the API uses (in-process, per D1).
- Keep existing ad-hoc CLI flow (create item + start brainstorm) as a separate subcommand to avoid entrypoint ambiguity.

Acceptance criteria:

- A CLI action against an existing item is reflected in the UI live (via Phase 4 events).
- A UI action against an item is inspectable from CLI tooling or DB queries.
- One authoritative execution model; no parallel workflow startup code paths remain.

### Phase 6: Verification And Regression Coverage

Objective: cover the new integration contract with tests.

Tasks:

- **Contract tests** for the IO abstraction: assert `ioApi` and `ioCli` satisfy identical interface obligations the orchestrator depends on. Run in CI.
- Engine unit tests for `itemActions` covering every cell of the transition matrix.
- API integration tests for:
  - starting/resuming runs from item actions
  - invalid action rejection (`409`)
  - `POST /runs/:id/input` rejection on CLI-owned runs
  - SSE propagation of each event in the schema table
- Playwright flows for:
  - board action starts run, routes to `/runs/:id`
  - run advances item on board live (no refresh)
  - CLI-triggered run appears in UI board live

Acceptance criteria:

- The end-to-end path is covered from trigger to reflected board state.
- Contract tests fail if `ioApi` and `ioCli` diverge.
- Regression tests fail if CLI/API workflow startup diverges again.

## Proposed Technical Changes

### Backend

- Add item action service module `apps/engine/src/core/itemActions.ts`.
- Add `POST /items/:id/actions` in `apps/engine/src/api/server.ts`.
- Add `GET /events` SSE endpoint (board stream).
- Extend repositories for:
  - `Repos.items.nextId()`
  - loading item state
  - resolving latest active run for an item
- Add `owner` column to `runs`; schema migration required.

### UI

- Reuse the existing `itemId` already present in the board DTO/view models.
- Replace static overlay actions with actionable controls.
- Add client-side `/events` SSE subscription on the board.
- Keep run console SSE and board SSE endpoints separate.

### CLI

- Replace direct `runWorkflow(item)` startup in `apps/engine/src/index.ts`.
- Add persisted run startup via in-process orchestrator with `owner = "cli"`.
- Add `beerengineer item action` subcommand (Phase 5).

## Migration Note

The current CLI behavior (non-persisted, hardcoded `ITEM-0001`) will disappear in Phase 1. Anyone relying on a "fast, no-DB" CLI mode should be warned. If that mode is still needed, expose it as an explicit `--ephemeral` flag that skips repository writes; otherwise remove it.

## Risks

- **Schema drift.** Adding `owner` and any action-validation state requires migrations. Ship migrations atomically with Phase 1 code.
- Stage semantics may not map cleanly to item actions without the small action/state layer introduced in Phase 2.
- Live board updates can become noisy if every event triggers full refresh — mitigated by keyed last-write-wins reducer.
- CLI UX may become awkward if it mixes ad hoc item creation and item-action commands — mitigated by separate subcommands in Phase 5.
- SQLite contention if CLI and API run simultaneously (D1 trade-off). Acceptable for single-operator dev use.

## Recommended Order

1. Approve D1, D2, D3 and the transition matrix.
2. Unify CLI with persisted orchestrator path (Phase 1).
3. Add backend item action API and validation (Phase 2).
4. Wire real board action controls (Phase 3).
5. Add live board updates (Phase 4).
6. Add CLI item-action commands (Phase 5).
7. Add end-to-end regression coverage (Phase 6).

## Definition Of Done

- UI board actions are real backend mutations.
- CLI-triggered work uses the same persisted execution path as API-triggered work, with `owner = "cli"`.
- Board state updates live while open over a dedicated `/events` SSE stream.
- Run console and board both reflect the same underlying run/item state.
- CLI and UI can each trigger work that the other surface can observe.
- Contract tests guarantee `ioApi` and `ioCli` cannot silently diverge.
