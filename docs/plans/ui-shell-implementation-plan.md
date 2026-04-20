# UI Shell Implementation Plan

## Goal

Implement a first BeerEngineer UI shell that:

- presents the workflow as a workspace-scoped control panel
- uses the board as the primary operational view
- supports inbox- and chat-driven attention handling
- reuses existing BeerEngineer core workflow logic instead of wrapping terminal output

The UI should feel like a neutral control panel with Beerventures accents, not like a marketing site and not like a terminal emulator.

Primary visual reference:

- [Board Mockup](../specs/beerengineer-ui-shell/5_mockups/ui-shell-board.html)

## Confirmed Design Decisions

### Workspace First

The UI is scoped to one active workspace at a time.

The user should be able to switch workspaces globally from the top control zone.
The main board, inbox, runs, artifacts, and settings views all operate in the currently selected workspace.

An `All workspaces` view may be added later for inbox-style cross-workspace oversight, but it is not the primary mode for V1.

### Board First

The main operational screen is the item board using the real domain board columns:

- `idea`
- `brainstorm`
- `requirements`
- `implementation`
- `done`

Cards represent `Item`s, not runs.
Deeper workflow detail is exposed through an overlay side panel.

### Overlay Detail Panel

Item details should open in a right-side overlay panel, not a permanently reserved third column.

The panel is for:

- current status and attention
- timeline/progress
- next actions
- chat preview

This keeps the board wide and readable while still enabling depth on demand.

### Inbox Is A First-Class View

The inbox is not a secondary utility page.
It is a core operational mode that aggregates waiting sessions, blocked reviews, and failed runs.

The inbox should be implementable as a structured aggregation over existing workflow entities rather than as a UI-only invention.

### UI Uses Core Services, Not CLI Text

The UI should not shell out to the CLI and parse console output.

Instead:

- CLI and UI should share the same application/core services
- the UI should call structured service methods or thin HTTP/API handlers
- terminal-specific formatting stays in the CLI adapter only

## UI Scope For V1

### Main Views

- `Board`
- `Inbox`
- `Runs`
- `Artifacts`
- `Settings`

### Board Capabilities

- show items grouped by board column
- show item title, code, attention signals, and lightweight metadata
- show mode per item
- open overlay panel on card selection
- filter by attention and scope

### Overlay Panel Capabilities

- summary of selected item
- stage timeline
- next actions
- chat preview
- status/mode summary

### Inbox Capabilities

- aggregate waiting sessions and failed/review-required work
- sort by urgency
- link back into the selected item or chat flow

### Chat Capabilities

- show active interactive session transcript
- send user input
- expose the next actionable resolution controls

## Technical Delivery Shape

### Recommended Structure

Create a dedicated UI app inside the repo, for example:

- `apps/ui`

Suggested stack:

- Next.js
- React
- TypeScript
- shared BeerEngineer core imports from existing `src/`

The UI app should import or call the same workflow/core services that the CLI uses, not duplicate them.

### Shared Design Inputs

Use Beerventures as the design source for:

- color tokens
- font choices
- heading/body hierarchy
- button feel

But apply those tokens with a more restrained product shell:

- neutral working background
- petrol mostly for structure/focus
- gold for action and emphasis
- very limited JetBrains Mono usage

## Component Plan

Components are a first-class concern for this UI.
The implementation should not jump directly to page-specific markup.
Instead, the board shell should be assembled from a clear component set that can later support Inbox, Runs, and Settings without rewriting layout primitives.

### Required Deliverables

For this UI effort, the following are mandatory and not optional nice-to-haves:

- a UI showcase that renders the central components in isolation and in realistic state variants
- a maintained component list that documents the current component inventory and intended responsibilities

The agent should treat both as core implementation outputs, not as follow-up documentation work.

### App Shell Components

These components define the persistent UI chrome.

- `AppShell`
  - top-level page frame
  - owns page background and main content width/height behavior
- `TopControlBar`
  - contains brand, workspace switcher, main title context, and top-level actions
- `WorkspaceSwitcher`
  - global active workspace selector
  - should support current workspace display, list loading, and switch action
- `PrimaryNav`
  - top navigation for `Board`, `Inbox`, `Runs`, `Artifacts`, `Settings`
- `GlobalSignals`
  - compact status strip for waiting/review/failed/global mode summaries

### Board Components

These components define the main operational screen.

- `BoardView`
  - page-level board composition
  - consumes `getBoardView()`
- `BoardFilterBar`
  - renders board-level filters and scoped chips
- `BoardColumn`
  - one visual workflow column
  - shows title, count, and card stack
- `BoardCard`
  - the main item card
  - shows item code, title, summary, mode icon, and attention indicators
- `BoardCardModeIcon`
  - renders `manual`, `assisted`, `auto` as small consistent icons
- `AttentionIndicator`
  - renders waiting/review/failed/done signals in a compact style
- `CardMetaRow`
  - compact metadata row for counts like project totals or small status values

### Overlay Components

These components define the context panel opened from the board.

- `ItemOverlay`
  - right-side overlay shell
  - owns open/close behavior and width rules
- `ItemOverlayHeader`
  - selected item summary and top-level status/mode display
- `ItemProgressList`
  - stage progression summary
- `ItemProgressRow`
  - one stage/status line in the progress list
- `ItemActionList`
  - list of currently available actions
- `ItemChatPreview`
  - latest conversation excerpt shown in the overlay

### Inbox Components

These should be planned now even if implemented after the board.

- `InboxView`
  - page-level inbox composition
  - consumes `listInbox()`
- `InboxToolbar`
  - sorting and filtering controls
- `InboxList`
  - renders ordered attention items
- `InboxRow`
  - one inbox item with kind, title, priority, status, and primary action
- `PriorityMarker`
  - lightweight urgency indicator

### Conversation Components

These should support future brainstorm/review/planning-review chat surfaces.

- `ConversationView`
  - full transcript view
- `ConversationMessageList`
  - ordered transcript rendering
- `ConversationMessage`
  - one system/assistant/user message
- `ConversationComposer`
  - user input surface
- `ConversationActionBar`
  - action buttons such as approve, retry, request changes

### Shared Primitive Components

These are reusable low-level building blocks and should be implemented early.

- `Icon`
  - shared icon wrapper for consistent stroke size and sizing
- `Button`
  - Beerventures-influenced button primitive
- `StatusChip`
  - compact neutral or accented chip
- `MetricPill`
  - very compact counter/status token for top-level summaries
- `SectionTitle`
  - heading primitive using `Space Grotesk`
- `MonoLabel`
  - tiny technical uppercase label
- `Panel`
  - simple bordered surface primitive
- `ListRow`
  - reusable row primitive for inbox/progress/run tables
- `EmptyState`
  - reusable empty state presentation
- `LoadingState`
  - reusable loading skeleton or placeholder block
- `ErrorState`
  - reusable error block with retry action slot

### UI Showcase Requirement

The UI implementation must include a dedicated showcase surface.

Purpose:

- verify visual consistency
- validate state variants without navigating full workflows
- make component review faster during implementation

Suggested shape:

- `apps/ui/app/showcase/page.tsx`
  - if the UI app uses the App Router
- or an equivalent route/screen if a different structure is chosen

The showcase should include at minimum:

- `BoardCard` in multiple status/mode variants
- `BoardColumn` with realistic stacks
- `ItemOverlay` in open state
- `WorkspaceSwitcher`
- `PrimaryNav`
- `GlobalSignals`
- `InboxRow`
- `ConversationMessage`
- empty/loading/error examples for shared states

The showcase is for development and review.
It does not need final product polish before it becomes useful.

### Component Inventory Requirement

The component list must stay explicit and current while the UI evolves.

Suggested home:

- this implementation plan until the UI exists
- later optionally a dedicated reference file such as `docs/reference/ui-components.md`

Minimum information per component:

- component name
- purpose
- main input props/view model
- current status
  - planned
  - in progress
  - implemented
  - deprecated

### Component Constraints

The following constraints should guide implementation:

- do not hardcode workflow logic inside visual components
- keep components data-driven and driven by structured view models
- prefer shallow, composable components over large screen-specific monoliths
- keep Mono usage limited to tiny labels, IDs, and technical markers
- prefer `Inter` for readable UI text and `Space Grotesk` for hierarchy
- mode and attention should be expressible with icons and compact indicators, not verbose badge stacks

## Implementation Phases

### Phase 1: UI Foundation

Build the UI shell and static structure.

Deliverables:

- UI app scaffold
- global layout
- top control zone with workspace switcher
- top navigation
- board screen shell
- overlay panel shell
- shared tokens/Typography/Button primitives adapted from Beerventures
- first component primitives:
  - `AppShell`
  - `TopControlBar`
  - `WorkspaceSwitcher`
  - `PrimaryNav`
  - `BoardColumn`
  - `BoardCard`
  - `ItemOverlay`
  - `Icon`
  - `Button`
  - `StatusChip`

No real workflow data is required yet.
Mock data should reflect the real domain model.

### Phase 2: Workspace And Board Read Models

Build structured read models for the board.

Deliverables:

- active workspace selection
- board query returning items grouped by board column
- item card view model
- selected item detail query
- integration of:
  - `BoardView`
  - `BoardFilterBar`
  - `BoardColumn`
  - `BoardCard`
  - `BoardCardModeIcon`
  - `ItemOverlayHeader`
  - `ItemProgressList`
  - `ItemActionList`

This phase should define the UI-facing shape for:

- board columns
- item status
- attention summary
- current mode
- summary counts

### Phase 3: Inbox Aggregation

Build a unified inbox query/service.

Deliverables:

- structured inbox list
- prioritization and sorting
- item/session deep links
- inbox counts for top navigation
- implementation of:
  - `InboxView`
  - `InboxToolbar`
  - `InboxList`
  - `InboxRow`
  - `PriorityMarker`

This is the first place where the current CLI/core likely needs explicit support work.

### Phase 4: Interactive Session Surface

Connect real brainstorm/review/planning-review chat flows.

Deliverables:

- show active transcript
- send user response
- refresh status after response
- surface next actions in panel and/or chat view
- implementation of:
  - `ConversationView`
  - `ConversationMessageList`
  - `ConversationMessage`
  - `ConversationComposer`
  - `ConversationActionBar`

### Phase 5: Actions And Workflow Controls

Expose workflow actions through structured UI handlers.

Initial actions:

- open item
- open chat
- retry
- approve where valid
- continue/autorun where valid

### Phase 6: Runs, Artifacts, Settings

Add supporting screens after the board/inbox/chat path is working.

Deliverables:

- runs list/detail
- artifact list/detail
- workspace settings and defaults
- implementation of additional views using shared primitives rather than bespoke layout code

## What The CLI/Core Must Provide

The current codebase already provides much of the workflow state model, but the UI needs better structured aggregation than the CLI currently exposes.

### Already Largely Available

The following domain pieces already exist and are good foundations:

- board columns and item phase status
- stage run status
- brainstorm session state
- interactive review state
- planning review state
- execution/QA/documentation/review run statuses
- item/project/workflow repositories

### Missing Or Not Yet UI-Friendly

The UI will need explicit support for these capabilities.

#### 1. Workspace Switching Read Model

The UI needs a structured workspace list and active workspace selector shape.

Needed:

- list workspaces
- show workspace summary
- switch active workspace without relying on ad hoc CLI flag handling

Suggested core/UI service:

- `workflowService.listWorkspaces()`
- `workflowService.getWorkspaceShellSummary(workspaceId | workspaceKey)`

#### 2. Board Query

The UI needs one board-oriented read model instead of stitching multiple CLI commands together.

Needed:

- items grouped by board column
- item summary per card
- counts per column
- current mode and attention summary per item

Suggested service:

- `workflowService.getBoardView({ workspaceId, filters })`

Suggested card fields:

- `itemId`
- `itemCode`
- `title`
- `currentColumn`
- `phaseStatus`
- `mode`
- `attentionState`
- `summaryCounts`
- `latestActivityAt`

#### 3. Item Detail Query

The overlay panel needs one compact view model.

Needed:

- item summary
- timeline/progress summary
- next actions
- preview of current interactive session if one exists

Suggested service:

- `workflowService.getItemDetailView({ itemId })`

#### 4. Inbox Aggregation

This is the biggest missing piece.

The UI needs one unified inbox list across these sources:

- brainstorm sessions waiting for input
- interactive reviews waiting for input or ready for resolution
- planning reviews with open questions, blockers, or revisions
- failed/review-required execution, QA, documentation, or related runs

Suggested service:

- `workflowService.listInbox({ workspaceId, filters })`

Suggested inbox item shape:

- `kind`
- `workspaceId`
- `itemId`
- `projectId`
- `sourceId`
- `title`
- `status`
- `reason`
- `priority`
- `updatedAt`
- `primaryAction`
- `deepLink`

#### 5. Mode Exposure

The UI wants to show per-item mode such as:

- `manual`
- `assisted`
- `auto`

If this is currently implicit or scattered in settings/runtime state, it needs a clean exposed read model.

Suggested service:

- `workflowService.getItemMode(itemId)`
- or include mode directly in board/detail read models

#### 6. Interactive Session Read/Write API

The UI needs structured access to current conversation state.

Needed:

- get active session transcript
- send user message
- resolve action
- refresh session status

Suggested services:

- `workflowService.getConversationView({ itemId | sessionId })`
- `workflowService.sendConversationMessage(...)`
- `workflowService.resolveConversationAction(...)`

#### 7. UI Action Capability Model

The UI should not guess which actions are currently valid.

Needed:

- a capability list per selected item/session

Suggested shape:

- `availableActions: Array<{ key, label, enabled, reasonIfDisabled }>`

This prevents invalid buttons and duplicated workflow rules in the UI.

## Recommended Core Additions Before Or During UI Build

The following additions would materially reduce UI friction:

1. Add a board read model service.
2. Add an inbox aggregation service.
3. Add a selected-item detail service.
4. Add a structured conversation/transcript service.
5. Add an action-capability service so the UI can render valid controls safely.

These should live in the application/core layer and be reusable by both UI and CLI.

## UI Risks

### Risk: UI Reimplements Workflow Rules

If the UI infers valid actions from raw state, it will drift from the engine.

Mitigation:

- expose capabilities and aggregated view models from core services

### Risk: Too Much Data Stitching In The UI

If the UI must call many small endpoints and join them client-side, complexity and inconsistency will rise.

Mitigation:

- prefer board/detail/inbox aggregate queries over primitive repository exposure

### Risk: Chat And Inbox Become Separate Truths

If the inbox is generated differently from the actual interactive session state, users will lose trust quickly.

Mitigation:

- inbox items must resolve directly from real workflow entities and statuses

## Immediate Next Steps

1. Create `apps/ui` with the shell layout and top-level navigation.
2. Implement a first static board page using the current board mockup as visual guide.
3. Add a core `getBoardView()` service.
4. Add a core `listInbox()` service.
5. Add a core `getItemDetailView()` service for the overlay panel.

## Definition Of Done For UI V1

UI V1 is complete when:

- a user can switch workspace globally
- the board renders real items by real board columns
- selecting an item opens a real overlay detail panel
- the inbox shows real waiting/failed/review-required work
- active chat/review sessions can be read and responded to from the UI
- the UI does not parse terminal output or duplicate workflow rules
