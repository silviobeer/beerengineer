# PROJ-13 Concept - UI Board Launchers

## Status
Approved concept

## Feature Seed
The beerengineer UI lacks first-class Create idea and Import feature entry points. Operators can watch and steer work from the board, but starting new work from the UI still depends on CLI-like paths or small per-card actions.

## Project Context
- Existing system: beerengineer_ is a local-first workflow engine with a CLI, HTTP/SSE API, Next.js UI, SQLite state, and an operator board at `/w/:key`.
- Relevant constraints: the UI must talk to the engine through HTTP/SSE and Next.js proxy routes; production UI code must not import engine internals; all browser writes go through `apps/ui/app/api/**`; the board uses workspace SSE plus server refresh; item detail is an existing client modal owned by `Board.tsx`.
- Prior related specs: PROJ-8 covers workflow capability safety across start/import surfaces; PROJ-9 covers engine-owned read models for existing board facts; PROJ-10 and PROJ-11 cover API boundary and contract safety. None of those adds the missing top-level operator launchers.
- Existing API support discovered: `POST /runs` starts a fresh run from `{ workspaceKey, title, description? }` and synchronously returns `{ runId, itemId, status }` (HTTP 202); `POST /items/import-prepared` creates and starts a prepared import item from `{ workspaceKey?, path }` and synchronously returns `{ kind: "started", itemId, runId, action, column, phaseStatus, warnings }` (HTTP 200); per-card `import_prepared` already exists but is not a top-level board launcher. Synchronous `itemId` return makes auto-open deterministic — the UI does not have to wait for SSE to discover the new item.

## Problem And Goal
Today, the UI is good at observing and steering work that already exists, but it does not give the operator an obvious way to create a new idea or import prepared feature artifacts from the board.

This creates a workflow break: a local operator can be looking directly at the workspace board, decide on the next feature, and still need to fall back to CLI knowledge or awkward per-card import behavior.

The goal is to add compact board-level launchers for Create idea and Import feature. Each launcher should collect only the minimum required input, start the existing engine workflow, and continue in the existing item detail and conversation experience once the new item exists.

## Primary Users And Scenarios
- Solo local operator: uses beerengineer on their own repository and wants to start or import work for the currently selected workspace without leaving the board.
- Create-from-scratch scenario: the operator has a feature idea, enters it in the UI, starts brainstorm immediately, and sees the new item's conversation or prompts without hunting for the card.
- Import-prepared scenario: the operator has a local prepared artifact folder, pastes the folder path in the UI, starts prepared import, and lands in the new item's detail/conversation flow.

## Current Workflow Or Pain
- `POST /runs` exists for fresh ideas, but the active board UI does not expose a top-level Create idea control.
- `POST /items/import-prepared` exists for creating a prepared-import item, but the UI currently exposes import mainly as a small per-card action in `BoardCardActions.tsx`.
- The existing per-card import path uses `window.prompt("Prepared artifact directory")`, which is not a first-class import workflow and does not help when importing a new feature without first selecting an existing item.
- The board already owns item selection and opens `BoardItemModal`, so new work should reuse that surface instead of adding a second conversation UI.

## Success Criteria
- The board offers both Create idea and Import feature entry points for the current workspace; both are hidden or disabled with a brief reason when no workspace is selected.
- Create idea accepts one required free-form idea text field and starts a brainstorm run without CLI use.
- Import feature accepts one required pasted local folder path and starts prepared import without CLI use.
- On success, the newly created item opens automatically in the existing item detail modal/conversation flow.
- The operator can see run progress, prompts, or conversation after starting work without manually finding the new card.
- Required-input validation happens before submit; engine/domain failures show inline while preserving the entered text or path.
- Existing board, modal, conversation, and SSE behavior are reused.
- The first version is desktop-first while remaining usable at 375px mobile width for QA.

## Scope
### In Scope
- Top-level board launchers for Create idea and Import feature in the current workspace context.
- A minimal Create idea input that accepts one free-form text value.
- Deriving a short engine run/item title from the first non-empty line of the idea text, trimmed and capped at 80 characters; if no non-empty line exists, the launcher fails the non-empty validation rather than fabricating a title.
- Sending the full untrimmed idea text as the engine description when starting the run.
- A minimal Import feature input that accepts a pasted local folder path.
- Inline non-empty validation for both launchers.
- Inline display of engine errors, including Git readiness, invalid folder, and domain-rule failures.
- Preserving entered idea/path after validation or engine failure.
- Starting existing engine workflows through UI proxy routes.
- Refreshing or following the board's existing SSE behavior after success.
- Automatically opening the newly created item in the existing item detail modal using the synchronously returned `itemId`, with a bounded wait (target: 3 s) for SSE/board state to converge before falling back to a recoverable state.
- Deciding the fate of the existing per-card `import_prepared` action (`BoardCardActions.tsx` `window.prompt`): keep, hide, or remove. Default position for v1: hide the per-card action once the top-level launcher exists, since prepared import creates a new item rather than acting on an existing card. Requirements may revisit.

### Out Of Scope
- Saving ideas as drafts without starting a run.
- Filesystem browsing or native folder picker.
- Drag-and-drop import.
- Zip upload/import.
- Editing import metadata before start.
- A separate intake conversation UI.
- CLI shortcut or command-copy-only surface as the primary workflow.
- Solving board action authority or UI action drift; that remains aligned with PROJ-9/PROJ-8.
- Redesigning the board, item modal, or conversation surface.

### Later
- Folder browser or engine-backed local directory picker.
- Import preview or validation summary before starting.
- Saved drafts or staged idea intake.
- Richer create form with explicit title/description fields if title derivation proves insufficient.
- Import metadata editing.
- Recent paths or favorite prepared-artifact locations.

## Selected Direction
Build minimal **Board Launchers Into Existing Item Detail**.

The board gains top-level Create idea and Import feature entry points. Each launcher collects the smallest possible input, starts the existing engine workflow, then hands the operator into the existing item detail modal and conversation surface once the item exists.

This direction is selected because it solves the missing UI workflow without creating a parallel intake system, duplicating conversation UI, or changing engine workflow authority.

## Key Behaviors And Flows
- Create idea opens an entry surface from the board, accepts one free-form idea text field, and requires non-empty input.
- When Create idea submits, the UI derives a short title from the first non-empty line (trimmed, capped at 80 characters), sends the full text as the run description, and starts the brainstorm run for the current workspace.
- Import feature opens an entry surface from the board, accepts one pasted local folder path, and requires non-empty input.
- When Import feature submits, the UI sends the folder path and current workspace to prepared import.
- After either success response returns an `itemId` synchronously, the UI opens the matching item in the existing item detail modal, refreshing or waiting on live board state up to ~3 s if the card has not yet appeared.
- If the item is not visible immediately because server refresh or SSE has not caught up, the UI shows a short starting/opening state rather than asking the operator to find the card manually.
- Once the item detail modal is open, existing conversation, message, prompt, and progress behavior continues to own the operator workflow.
- If an engine call fails, the launcher remains open, keeps the user's entered value, and shows the engine error inline.

## Data, Permissions, And Constraints
- Create idea creates engine work for the current selected workspace.
- Import feature creates engine work for the current selected workspace and references a local folder path readable by the engine process.
- The UI should only validate presence for idea text and path; the engine owns workflow readiness, Git readiness, path readability, prepared artifact parsing, and domain validation.
- The browser must not receive or send engine tokens directly; mutations continue through Next.js proxy routes.
- Production UI code must not import engine internals.
- No new auth or multi-user permissions are introduced; beerengineer remains a local operator console.
- The input path is local-machine data and should be displayed only as needed for the operator's current action.
- **Path-from-body exception.** The repo rule "always derive filesystem paths from server-side state; never trust path/ID fields from request bodies" exists for multi-tenant safety. Import feature is a documented exception that already applies to `POST /items/import-prepared`: the operator pastes a local path on a single-operator console, the engine resolves and validates it, and the UI never touches the filesystem itself. The launcher inherits this posture; it does not extend the exception to other endpoints.
- **PROJ-8 capability gating coordination.** PROJ-8 owns workflow capability safety across start/import surfaces. v1 of these launchers takes the attempt-then-engine-error path (always enabled, errors surface inline). If PROJ-8 ships a board-readable capability flag (e.g. Git not ready ⇒ disable start), the launcher must respect that flag and surface the reason rather than letting the operator submit only to fail. This is a coordination point, not a hard dependency; ordering is decided at architecture time.

## Error Handling And Edge Cases
- Empty idea text blocks submit and keeps focus in the create launcher.
- Empty import path blocks submit and keeps focus in the import launcher.
- No workspace selected: launchers are hidden or disabled with a brief reason; submit is unreachable.
- Missing Git readiness, workspace path problems, invalid prepared folder, unreadable path, or engine workflow rejection show inline engine error text where possible.
- Engine errors do not clear the idea text or folder path.
- Duplicate submit attempts are disabled while a start/import request is pending.
- If the board does not yet contain the returned item after success, the UI enters an opening state and resolves it through refresh/SSE rather than silently doing nothing.
- If auto-open does not resolve within ~3 s, the board exits the opening state, surfaces a "started — open from board" hint linking to the returned `itemId`, and remains usable.
- Long idea text should not overflow controls; the derived title is capped at 80 characters and the full text preserved as description.

## High-Level Implementation Success
- User/stakeholder success: operators can start new ideas and import prepared features from the board, then immediately continue in the normal item detail/conversation workflow.
- Product constraints: keep the launchers minimal, reuse existing board/modal/conversation surfaces, and avoid creating a separate intake product.
- Operational constraints: preserve local-only token handling, engine-owned validation, current workspace context, and existing workflow start/import authority.
- Existing behavior to preserve: board columns, item detail modal ownership, conversation/message streams, per-card actions, SSE updates, and existing CLI/API start/import behavior.
- Downstream attention needed: visual-companion should explore where these board-level launchers live and how the entry surface opens without cluttering the board; requirements-engineer should define exact validation, pending, success, auto-open, and error expectations.

## Downstream Handoff Notes
- For visual-companion: explore the UI container and interaction shape for two top-level board launchers, including how Create idea remains "already open" as it transitions into the created item's detail modal. Preserve board density and avoid a separate conversation surface. Account for the "no workspace selected" empty state.
- Mockup-relevant product inputs: launcher labels are Create idea and Import feature; Create idea has one free-form text input; Import feature has one local folder path input; both show inline errors and pending states; success should lead into the existing item detail modal.
- For requirements-engineer: specify user stories for create, import, validation, engine error display, duplicate-submit prevention, success refresh/SSE behavior, auto-open timing (~3 s bound), bounded failure recovery if the item is not immediately visible, the no-workspace state, and the per-card `import_prepared` deprecation/hide decision (default: hide once top-level launcher exists).
- For architecture/planning: use existing engine endpoints where possible; add UI proxy routes only where missing; keep the UI/engine boundary intact; ensure board refresh/selection behavior can target the synchronously returned `itemId` without depending on engine internals; coordinate with PROJ-8 on whether a board-readable capability flag should pre-emptively disable launchers vs. relying on engine-error feedback.

## Explored Alternatives
### Alternative A
- Summary: Full pre-run intake workflow with title, metadata, import preview, validation, and draft-like behavior.
- Why not selected: it may become useful later, but it is too large for the immediate pain and risks duplicating workflow/conversation surfaces.

### Alternative B
- Summary: CLI-first UI shortcut surface that shows copyable commands or prompts the user toward the CLI.
- Why not selected: it has low UI effort, but it does not solve the core product issue that starting and importing should be possible from the board.

### Alternative C
- Summary: Keep import as a per-card action and only add Create idea.
- Why not selected: both create and prepared import are equally important v1 workflows, and import should work for new prepared features without first choosing an existing card.

## Assumptions Confirmed
- The feature adds top-level board actions for the current workspace: Create idea and Import feature.
- The primary user is a solo local operator using beerengineer on their own repository without leaving the UI.
- Create idea uses one free-form idea text field and immediately starts the brainstorm run.
- The engine run title may be derived from the idea text rather than requiring a separate title field in v1.
- Import feature asks only for a pasted local folder path to prepared artifacts.
- After success, the UI should automatically open the newly created item in the existing item detail modal and conversation flow.
- The first version is desktop-first, with basic 375px mobile usability still required for QA.
- Engine errors should show inline and preserve the entered text/path.
- Drafts, folder browsing, drag-and-drop import, zip upload/import, and metadata editing are out of scope for v1.
- Create idea and Import feature are equally important v1 workflows.
- The selected direction is minimal board launchers into the existing item detail/conversation surface.
- The user confirmed that everything is clear.

## Risks And Trade-Offs
- Title derivation may create imperfect item titles. Accepted for v1 to avoid a heavier form; requirements should bound the derived title and preserve full text as description.
- Auto-opening may race board refresh or SSE. Accepted with a starting/opening state until the returned item is available.
- Prepared import validation remains engine-owned. Accepted so the UI does not duplicate path and artifact parsing logic.
- Launcher placement could clutter the board. Deferred to visual-companion to explore container shape while preserving board density.
- The work is adjacent to PROJ-9 engine-owned action facts. This concept deliberately uses existing start/import endpoints and does not attempt to solve board action authority.

## Testing Focus
- Create idea entry is available from the board and submits non-empty idea text for the current workspace.
- Empty idea text blocks submit and preserves input/focus.
- The derived title behavior is bounded and the full idea text is sent as description.
- Import feature entry is available from the board and submits a non-empty local folder path for the current workspace.
- Empty import path blocks submit and preserves input/focus.
- Engine error responses are shown inline before generic fallback copy where a user-facing message is available.
- Pending state prevents duplicate submit for both launchers.
- Successful create/import refreshes or follows SSE and opens the returned item in the existing item detail modal.
- Auto-open handles delayed board visibility for the returned item within the ~3 s bound and surfaces a recoverable hint after timeout.
- Workspace-not-selected state hides or disables both launchers.
- Per-card `import_prepared` deprecation/hide is verified per the requirements decision.
- Existing per-card actions (other than `import_prepared`) and item detail conversation behavior continue to work.
- 375px mobile screenshots are captured for the new top-level UI surface before QA marks the UI work green.

## Next Step
- UI feature: visual-companion
- Backend/API feature: requirements-engineer after UI shape is selected
