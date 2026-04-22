# Frontend-CLI Board Integration Plan

## Goal

Turn the current CLI workflow engine into the backend for a board-style frontend.
The frontend should reuse an existing static template and evolve it into a live UI
that shows runs, projects, stories, stage runs, logs, and artifacts.

The key rule is:

- the CLI remains the workflow engine
- the frontend becomes a view and control layer over runs
- the database becomes the board/query model

## Frontend Reuse — `beerengineer/apps/ui`

**Reuse the existing frontend at `/home/silvio/projects/beerengineer/apps/ui` instead of starting from a static template or a fresh Next.js scaffold.**

It is a working Next.js 15 + React 19 app that already implements most of the board-integration target:

```
apps/ui/
  app/                        Next.js App Router entrypoints
    page.tsx
    layout.tsx
    globals.css
    inbox/
    runs/
    artifacts/
    settings/
    setup/
    showcase/                 visual component catalogue — keep as design reference
  components/
    board/                    BoardView, BoardColumn, BoardCard, BoardFilterBar,
                              AttentionIndicator, BoardCardModeIcon, BoardIcons
    conversation/             ConversationView + Composer/MessageList/ActionBar/Message
    shell/                    AppShell, PrimaryNav, WorkspaceSwitcher, GlobalSignals
    primitives/               shared low-level UI
    inbox/, overlay/, setup/
  lib/
    live-board.ts             better-sqlite3-backed board data (!)
    view-models.ts            board/run view models
    mock-data.ts              current dev fixtures
    mock-legacy-data.ts
  tests/                      Playwright e2e setup (playwright.config.ts)
```

**Implications for this plan:**

1. The board UI, shell layout, conversation thread view, and column/card components already exist. **Do not rebuild them.**
2. `lib/live-board.ts` + `better-sqlite3` is already the intended data path — the SQLite schema in this plan should be **aligned with whatever `live-board.ts` already queries**, not designed in isolation.
3. The showcase page is the visual source of truth — use it as the design reference for any new components.
4. Playwright is already wired (`dev:e2e` on port 3100, `playwright.config.ts`) — use it for integration tests once the API wiring lands.
5. The mock-data files (`mock-data.ts`, `mock-legacy-data.ts`) mark exactly the seams that need to be replaced with real API/DB data.

**How to reuse — recommended: copy `apps/ui` into this repo as a monorepo workspace.** Promote `beerengineer2` to a workspace root with two packages:

```
beerengineer2/
  package.json              (workspaces: ["apps/*"])
  apps/
    engine/                 ← move current src/ here
    ui/                     ← copy from beerengineer/apps/ui
```

This keeps the engine and UI in one repo so stage events, DB schema, and UI view models can evolve together without a cross-repo sync. A git submodule or npm link is also viable, but both add coordination overhead for a repo that is still pre-1.0.

**Before copying, audit `live-board.ts` and `view-models.ts`** — they define the shape the UI already expects. The DB schema in the "Data Model" section below must be reconciled with that shape before any migration is written, not after.

## Current State

The repo already has the right backend foundation:

- `src/workflow.ts` orchestrates the full workflow
- `src/core/stageRuntime.ts` persists structured stage runs
- `.beerengineer/workspaces/...` already stores run data and artifacts on disk
- `src/index.ts` is currently a terminal-only entrypoint

This means the frontend should not directly call stage internals.
Instead, it should talk to a backend API that starts runs, streams updates, and
queries a board-oriented data model.

## Target Architecture

### 1. Engine Layer

Keep the existing workflow logic as the source of truth.

Responsibilities:

- execute workflows
- advance stage status
- write logs
- write artifacts
- request human input when needed

This layer should become UI-agnostic.

### 2. API Layer

Add a small server that wraps the engine.

Responsibilities:

- start runs
- expose run snapshots
- expose board data
- accept human replies to prompts
- stream live updates to the frontend

Recommended transport:

- HTTP for commands and snapshots
- SSE first for live updates
- WebSocket only if bidirectional streaming becomes necessary

### 3. Database Layer

Add a DB to represent the board and hierarchical work tree.

The DB is not the primary artifact store.
It is the query model for the frontend.

Recommended first choice:

- SQLite

Reason:

- simple local setup
- enough for early board iteration
- can be migrated to Postgres later if needed

### 4. File Artifact Layer

Keep filesystem persistence for generated artifacts and large logs.

The DB should store references to files, not duplicate all artifact content.

## Data Model

### Core Principle

Model the board as hierarchical work items.

Do not make every concept a separate UI-specific table first.
Use one main tree structure and project it into columns.

### Main Tables

#### `runs`

Represents one workflow run.

Suggested fields:

- `id`
- `workspace_id`
- `title`
- `status`
- `current_stage`
- `created_at`
- `updated_at`

#### `board_columns`

Defines visible board columns.

Suggested initial values:

- `inbox`
- `brainstorm`
- `requirements`
- `architecture`
- `planning`
- `execution`
- `review`
- `qa`
- `documentation`
- `done`
- `blocked`

Fields:

- `id`
- `name`
- `position`

#### `work_items`

Represents the hierarchy.

Supported item types:

- `item`
- `project`
- `prd`
- `wave`
- `story`
- `stage_run`
- `artifact`
- `qa_issue`

Fields:

- `id`
- `run_id`
- `parent_id`
- `type`
- `title`
- `status`
- `column_id`
- `position`
- `metadata_json`
- `created_at`
- `updated_at`

#### `stage_logs`

Optional but recommended for timeline/detail views.

Fields:

- `id`
- `run_id`
- `work_item_id`
- `stage_id`
- `log_type`
- `message`
- `data_json`
- `created_at`

#### `artifact_files`

Maps DB records to real files on disk.

Fields:

- `id`
- `work_item_id`
- `label`
- `kind`
- `path`
- `created_at`

## UI Model

The board is one projection of the run tree.

### Column Behavior

`type` and `column` must stay separate.

- `type` answers: what is this node?
- `column` answers: where is it in the process?

Example:

- a `story` stays `type = story`
- that story may move from `planning` to `execution` to `review` to `done`

### Card Hierarchy

The intended expansion flow is:

`item -> project -> wave/story -> stage_run -> artifact/log detail`

This allows the user to:

- see high-level run progress on the board
- open a card to inspect children
- inspect artifacts and logs without leaving context

### Detail Panel

Each selected card should show:

- metadata
- child items
- stage status
- prompt history
- generated files
- review findings

## API Plan

### Commands

- `POST /runs`
  Starts a workflow run.

- `POST /runs/:id/input`
  Answers a pending prompt.

- `POST /work-items/:id/move`
  Optional manual board movement if needed for UI workflows.
  This should be restricted so it does not corrupt engine state.

### Queries

- `GET /board`
  Returns columns and visible cards.

- `GET /runs/:id`
  Returns a run snapshot.

- `GET /runs/:id/tree`
  Returns the hierarchical work tree.

- `GET /work-items/:id`
  Returns one card plus detail payload.

### Live Updates

- `GET /runs/:id/events`
  SSE stream for live run updates.

Suggested event types:

- `run_started`
- `stage_status_changed`
- `prompt_requested`
- `prompt_answered`
- `artifact_written`
- `review_result`
- `work_item_updated`
- `run_finished`

## Backend Refactor Plan

### Phase 1. Isolate Terminal I/O

Replace direct terminal coupling with an interface.

Introduce something like:

```ts
type WorkflowIO = {
  ask(prompt: string): Promise<string>
  emit(event: WorkflowEvent): void
}
```

Then provide:

- CLI adapter using `readline` and console output
- API adapter using in-memory prompt routing and event streaming

### Phase 2. Emit Structured Workflow Events

Teach the engine to emit events whenever:

- a run starts
- a stage status changes
- a prompt is requested
- an artifact is written
- a review passes or fails
- a run completes or blocks

These events should become the source for both:

- live frontend updates
- DB synchronization

### Phase 3. Synchronize DB From Runtime

Whenever the runtime changes state:

- upsert `runs`
- upsert `work_items`
- append `stage_logs`
- upsert `artifact_files`

The runtime remains the operational source.
The DB becomes the queryable board view.

### Phase 4. Add HTTP/SSE Server

Create a backend entrypoint that:

- starts runs
- exposes read APIs
- streams events
- stores pending prompts per run

### Phase 5. Attach `beerengineer/apps/ui`

Copy `beerengineer/apps/ui` into this repo as `apps/ui` (see "Frontend Reuse" section).

Reuse directly:

- `components/shell/*` — AppShell, PrimaryNav, WorkspaceSwitcher, GlobalSignals
- `components/board/*` — BoardView, BoardColumn, BoardCard, filter bar, icons
- `components/conversation/*` — for the prompt/reply UI in Phase 6
- `components/primitives/*` — shared low-level UI
- `app/globals.css` — colors, typography, board styling, card styling
- `app/showcase/*` — keep as design reference; do not ship to users

Replace the mock data layer:

- rewire `lib/live-board.ts` to read from the new SQLite schema written by Phase 3
- delete `lib/mock-data.ts` and `lib/mock-legacy-data.ts` once components consume real data
- keep `lib/view-models.ts` if its shape matches the engine; otherwise adjust it rather than duplicating transforms

### Phase 6. Add Hierarchical Interactions

Extend the static board with:

- expandable cards
- detail drawer or side panel
- live status badges
- logs/artifacts views

## Frontend Extension Plan

The "frontend" is `beerengineer/apps/ui` — not a static template. Extend it in this order:

### Step 1. Preserve the shell

Do not redesign the UI. Keep `components/shell/*`, `components/board/*`, and `app/globals.css` exactly as they are. New work lands in `lib/` (data wiring) and, only where needed, in new components under the existing folders.

### Step 2. Replace mock board data

Connect columns and cards to `GET /board`.

### Step 3. Add hierarchy

When the user opens a card:

- fetch `GET /work-items/:id` or `GET /runs/:id/tree`
- render children inline or in a detail panel

### Step 4. Add live run updates

Subscribe to `GET /runs/:id/events`.

Use events to update:

- card status
- column placement
- log timeline
- prompt state

### Step 5. Add prompt handling

When the engine asks a question:

- show a prompt UI
- submit the answer through `POST /runs/:id/input`

### Step 6. Add artifact browsing

Render links or previews for:

- markdown artifacts
- json artifacts
- summary files

## Column Mapping Strategy

Define a deterministic rule that maps engine status to board columns.

Initial mapping example:

- new run -> `inbox`
- brainstorming active -> `brainstorm`
- PRD active -> `requirements`
- architecture active -> `architecture`
- plan active -> `planning`
- story implementation active -> `execution`
- review active -> `review`
- QA active -> `qa`
- docs active -> `documentation`
- fully approved -> `done`
- blocked/failed -> `blocked`

This mapping should live in backend code, not in the frontend.

## Recommended Delivery Order

### Milestone 1. Board-ready backend

- isolate engine I/O
- emit workflow events
- add SQLite schema
- sync DB from runtime
- expose read APIs

Outcome:

- frontend can query board data even before live streaming is finished

### Milestone 2. Live run control

- add SSE stream
- add pending prompt routing
- add run start and input endpoints

Outcome:

- frontend can actually drive the workflow

### Milestone 3. UI integration

- copy `beerengineer/apps/ui` into this repo as `apps/ui` (monorepo workspace)
- reconcile the SQLite schema with the queries in `lib/live-board.ts`
- rewire `lib/live-board.ts` against the new engine-synced DB
- replace `lib/mock-data.ts` consumers component by component

Outcome:

- the existing board becomes a live view of the engine without UI redesign

### Milestone 4. Tree/detail UX

- add child views
- add log timeline
- add artifact browser

Outcome:

- users can inspect runs without dropping to CLI/file system

## Risks And Constraints

### Risk 1. Dual sources of truth

Do not let the frontend invent state transitions independent from the engine.
The engine must remain authoritative for workflow progression.

### Risk 2. Over-modeling too early

Start with a simple schema.
Do not create many narrow tables unless the query patterns demand it.

### Risk 3. Template-first drift

`beerengineer/apps/ui` was built against an earlier mental model (`lib/mock-legacy-data.ts` still exists).
Some UI interactions may imply transitions the engine does not support.
Rule: adapt the UI to the workflow model — do not add engine statuses just to make an existing card animation work.

### Risk 3b. UI/engine schema divergence

`lib/live-board.ts` already defines a query shape. If the new DB schema is designed without
reconciling it, the rewiring in Phase 5 will turn into a rewrite.
Mitigation: audit `live-board.ts` + `view-models.ts` **before** writing any migration.

### Risk 4. Prompt routing

Interactive stages currently assume direct terminal input.
This must be isolated early or the frontend integration will stay brittle.

## Immediate Next Actions

1. **Audit `beerengineer/apps/ui/lib/live-board.ts` and `view-models.ts`** to capture the shape the UI already expects — do this before designing the SQLite schema.
2. Promote this repo to a workspace root (`package.json` with `workspaces: ["apps/*"]`); move `src/` under `apps/engine/`.
3. Copy `beerengineer/apps/ui` into `apps/ui/` and confirm it still `npm run dev`-s against its mock data.
4. Create the SQLite schema for `runs`, `board_columns`, `work_items`, `stage_logs`, and `artifact_files` — reconciled with the audit from step 1.
5. Introduce a `WorkflowIO` abstraction so `src/index.ts` (now `apps/engine/src/index.ts`) becomes only one adapter.
6. Add event emission in `runStage()` and top-level workflow orchestration.
7. Build a small backend server with `POST /runs`, `GET /board`, `GET /runs/:id/tree`, and `GET /runs/:id/events`.
8. Rewire `apps/ui/lib/live-board.ts` against the engine-synced DB; delete `mock-data.ts` / `mock-legacy-data.ts` once every consumer is migrated.
