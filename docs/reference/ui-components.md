# UI Components

Maintained inventory for the `apps/ui` shell and setup surfaces. Status values:

- `planned`
- `in progress`
- `implemented`
- `deprecated`

## App Shell

| Component | Purpose | Main props / view model | Status |
| --- | --- | --- | --- |
| `AppShell` | Top-level page frame with persistent chrome and content slot. | `shell`, `activeHref`, `children`, `onWorkspaceChange?` | `implemented` |
| `TopControlBar` | Brand, workspace switcher, title context, and top-level actions. | `shell`, `onWorkspaceChange?` | `implemented` |
| `WorkspaceSwitcher` | Global workspace selector with a11y-aware switching and dismissal behavior. | `workspace`, `workspaces?`, `onWorkspaceChange?` | `implemented` |
| `PrimaryNav` | Primary navigation across board, inbox, runs, artifacts, settings, setup, showcase. | `items`, `activeHref` | `implemented` |
| `GlobalSignals` | Compact global status strip. | `signals` | `implemented` |

## Board

| Component | Purpose | Main props / view model | Status |
| --- | --- | --- | --- |
| `BoardView` | Page-level board composition. | `board` | `implemented` |
| `BoardFilterBar` | Filter chips for the board scope. | `filters` | `implemented` |
| `BoardColumn` | One workflow column with cards. | `column` | `implemented` |
| `BoardCard` | Main item card. | `card` | `implemented` |
| `BoardCardModeIcon` | Compact mode marker for `manual`, `assisted`, `auto`. | `mode` | `implemented` |
| `AttentionIndicator` | Waiting/review/failed/done attention marker. | `attention` | `implemented` |
| `CardMetaRow` | Compact metadata counters on cards. | `meta` | `implemented` |

## Overlay

| Component | Purpose | Main props / view model | Status |
| --- | --- | --- | --- |
| `ItemOverlay` | Right-side overlay shell. | `overlay` | `implemented` |
| `ItemOverlayHeader` | Selected item summary and mode/attention display. | `overlay` | `implemented` |
| `ItemProgressList` | Stage progression list. | `rows` | `implemented` |
| `ItemProgressRow` | One stage/status line. | `row` | `implemented` |
| `ItemActionList` | Available workflow actions. | `actions` | `implemented` |
| `ItemChatPreview` | Recent conversation excerpt. | `messages` | `implemented` |

## Inbox

| Component | Purpose | Main props / view model | Status |
| --- | --- | --- | --- |
| `InboxView` | Page-level inbox composition. | `inbox` | `implemented` |
| `InboxToolbar` | Sorting/filter chips. | `filters` | `implemented` |
| `InboxList` | Ordered inbox rows. | `rows` | `implemented` |
| `InboxRow` | One inbox attention row. | `row` | `implemented` |
| `PriorityMarker` | Lightweight urgency indicator. | `priority` | `implemented` |

## Conversation

| Component | Purpose | Main props / view model | Status |
| --- | --- | --- | --- |
| `ConversationView` | Full conversation surface for setup assist and later review chat. | `messages` | `implemented` |
| `ConversationMessageList` | Ordered transcript rendering. | `messages` | `implemented` |
| `ConversationMessage` | One conversation line. | `message` | `implemented` |
| `ConversationComposer` | User input composer surface. | none | `implemented` |
| `ConversationActionBar` | Approve/retry/request-changes controls. | none | `implemented` |

## Setup

| Component | Purpose | Main props / view model | Status |
| --- | --- | --- | --- |
| `SetupOverview` | Structured workspace setup screen grounded in doctor/init/bootstrap models. | `setup`, `messages` | `implemented` |
| `CreateWorkspaceForm` | Collect workspace creation inputs. | none | `implemented` |
| `WorkspaceRootForm` | Focused root repair form. | none | `implemented` |
| `WorkspaceInitForm` | Safe init options. | none | `implemented` |
| `SetupAssistComposer` | Start or continue setup assist planning. | none | `implemented` |
| `BootstrapPlanForm` | Editable bootstrap options. | none | `implemented` |
| `BootstrapOptionToggle` | Reusable bootstrap/init boolean toggle. | `label`, `defaultChecked` | `implemented` |
| `PathInput` | Reusable path input field. | `label`, `defaultValue` | `implemented` |
| `StackSelect` | Explicit stack selector. | none | `implemented` |

## Shared Primitives

| Component | Purpose | Main props / view model | Status |
| --- | --- | --- | --- |
| `Icon` | Shared icon wrapper. | `children`, `className`, `title` | `implemented` |
| `Button` | Shared button primitive. | `children`, `variant` | `implemented` |
| `StatusChip` | Compact neutral or accented chip. | `label`, `tone` | `implemented` |
| `MetricPill` | Compact summary token. | `label`, `value` | `implemented` |
| `SectionTitle` | Heading and optional description block. | `title`, `description` | `implemented` |
| `MonoLabel` | Tiny technical uppercase label. | `children` | `implemented` |
| `Panel` | Bordered surface primitive. | `children`, `className` | `implemented` |
| `ListRow` | Reusable row primitive. | `children` | `implemented` |
| `EmptyState` | Empty state presentation. | `title`, `detail` | `implemented` |
| `LoadingState` | Loading placeholder block. | `label` | `implemented` |
| `ErrorState` | Error state block. | `title`, `detail` | `implemented` |
