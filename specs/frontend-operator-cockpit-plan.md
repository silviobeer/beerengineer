# Frontend Operator Cockpit Plan

## Goal

Design the UI as an operator cockpit for the BeerEngineer workflow engine:

- the board stays item-centric
- every item can expose active and historical runs
- the operator can see when the engine is working vs. waiting
- the operator can answer prompts from anywhere
- the operator can inspect projects, stories, branches, and artifacts without leaving context
- implementation outputs can be tested from the UI
- branch merge/handoff flows are visible in the UI even before the CLI fully implements them

This plan replaces the too-narrow assumption that "run = implementation".

> UX review note (2026-04-22): the four-surface model matches what the codebase
> already grew toward. This revision anchors the plan on the existing component
> inventory so we extend rather than duplicate. See
> "Mapping To Existing Components" below.

## Mapping To Existing Components

Every surface in this plan corresponds to code that already exists. New work
extends these files; new components are only introduced where a primitive is
missing.

| Plan surface / concept        | Existing code                                                                 | Action          |
| ----------------------------- | ----------------------------------------------------------------------------- | --------------- |
| Board                         | `components/board/BoardView.tsx`, `BoardColumn.tsx`, `BoardCard.tsx`          | extend          |
| Card attention signal         | `components/board/AttentionIndicator.tsx` (+ `AttentionState` enum)           | extend enum     |
| Item overlay (aka "drawer")   | `components/overlay/ItemOverlay.tsx` (`overlay-scrim` + `overlay-panel`)      | extend          |
| Overlay header                | `components/overlay/ItemOverlayHeader.tsx`                                    | keep            |
| Stage ladder                  | `components/overlay/ItemProgressList.tsx` + `ItemProgressRow.tsx`             | extend rows     |
| Quick prompt peek             | `components/overlay/ItemChatPreview.tsx`                                      | extend to form  |
| Run workspace                 | `components/runs/LiveRunConsole.tsx` + `RecoveryPanel.tsx`, route `/runs/[id]`| restructure     |
| Inbox page                    | `app/inbox/page.tsx` + `components/inbox/InboxView.tsx` (+ List/Row/Toolbar)  | deepen          |
| Global action tray            | `components/shell/GlobalSignals.tsx` (already in `AppShell` top bar)          | make clickable  |
| Primitives                    | `MonoLabel`, `MetricPill`, `StatusChip`, `Panel`, `SectionTitle`, `ListRow`, `Button`, `EmptyState`, `ErrorState`, `LoadingState` | reuse |
| Design tokens                 | `--petrol`, `--gold`, `--good`, `--bad`, `--warn`, `--muted`, `--surface*`    | reuse           |

**Vocabulary decision.** The code name wins: this plan uses **Item Overlay**
(not "item drawer") everywhere. CSS hooks `overlay-scrim` and `overlay-panel`
stay.

**New primitives needed (explicit list).**

- `BranchRow` — compact branch display (name + base + status) built on
  `ListRow` + `StatusChip`.
- `DisclosureRow` — expandable row for the projects→waves→stories tree, built
  on `ListRow`.
- `SignalPopover` — popover attached to `GlobalSignals` pills that lists
  queued actions (prompts, blocked, merge-ready, ready-to-test).
- `PromptComposer` — single form used by every prompt-answer entry point.
  Wraps the existing `answerPrompt` call in `lib/api`.

Every other component in this plan is an extension of an existing file.

## Core Domain Model

The UI vocabulary must stay strict:

- `Item` = the persistent work object on the board
- `Column` = lifecycle position of the item
- `Run` = one active or historical engine session for that item
- `Stage` = the current step inside that run

This means:

- an item in `brainstorm` can have a live run
- an item in `requirements` can have a live run
- `implementation` is only one board column, but internally spans:
  `architecture -> planning -> execution -> project-review -> qa -> documentation`

## Information Architecture

The UI should use four coordinated surfaces.

### 1. Board

The board remains the default workspace.

Columns:

- `idea`
- `brainstorm`
- `requirements`
- `implementation`
- `done`

Responsibilities:

- prioritize and scan items
- show where work is
- show where operator attention is needed
- open the item overlay

### 2. Item Overlay

The item overlay (`ItemOverlay.tsx`, right-side `<aside class="overlay-panel">`
with scrim) is the structural detail view for one item.

Responsibilities:

- show item summary and current lifecycle state
- show projects and user stories
- show current branches and candidate branches (via new `BranchRow`)
- show latest run and recent run history
- expose item-level actions (reuse `ItemActionList` + `ItemBoardActions`)
- provide quick prompt-answer access (new `PromptComposer`, shared form)
- provide quick path into the full run workspace

### 3. Run Workspace

The run workspace is the live interaction surface for one engine session.
Implementation: restructure `LiveRunConsole.tsx` into named sections rather
than create a new component.

Responsibilities:

- show active prompt
- show conversation and timeline
- show stage progression
- show recovery / remediation
- show artifacts
- show branch state
- show test-preview actions
- show merge-to-main actions

This should exist both:

- as a full page for deep work (existing `/runs/[id]` route)
- as a right-side panel opened from the board/item overlay

See "Right-Pane Arbitration" below for the rule when overlay, run panel, and
preview pane all want the right side.

### 4. Inbox

The inbox is the cross-item action queue.

Responsibilities:

- aggregate unresolved prompts
- aggregate blocked/failed runs
- aggregate review-required items
- aggregate merge-ready candidates
- aggregate finished implementations awaiting human test/validation

Inbox is not the main chat surface. It is the triage surface.

## UX Principles

1. Motion means the engine is active.
2. Badges mean the operator must act.
3. The board gives overview, not every detail.
4. The item overlay explains structure.
5. The run workspace handles synchronous interaction.
6. The inbox prevents important prompts from being lost.
7. One mutation per domain action; many entry points. Prompt-answer goes
   through one shared `PromptComposer` backed by `answerPrompt` in
   `lib/api`, regardless of whether it was fired from a card hint, the
   overlay, the inbox row, or the run workspace.

## Right-Pane Arbitration

The overlay, the run panel, and the test preview all compete for the right
side. Arbitration rule:

1. Only one right pane is visible at a time. Opening another replaces the
   current one (with a back affordance).
2. Item Overlay is the default right pane from the board.
3. "Open live run" from the overlay *replaces* the overlay with the Run
   Workspace panel. The overlay's item context is carried in the panel
   header with a back-to-overlay action.
4. Test preview opens inside the Run Workspace as an internal tab
   (transcript | stages | branches | preview), never as a third pane.
5. On screens < 1200px, right panes become full-screen modals.
6. URL state owns which pane is open (`?item=…`, `?run=…`,
   `?preview=run-<id>`). Deep links and back button must work.

## Card Status System

Each board card must communicate two separate dimensions:

### A. Engine Activity

If a run is in progress, the card should look alive.

Recommended treatment:

- subtle pulse on a live dot
- low-amplitude animated edge or shimmer
- never aggressive blinking

This means:

- `running` = active motion

### B. Operator Attention

This must be stronger than the running signal.

The existing `AttentionState` enum
(`idle | waiting | review | failed | done`) is *extended*, not replaced,
to carry the finer operator-action states. Each new state maps onto a
token tone so we do not grow a second parallel badge system.

| New attention state | Existing `AttentionState` | Tone token | Badge label      |
| ------------------- | ------------------------- | ---------- | ---------------- |
| `awaiting-answer`   | `waiting`                 | `gold`     | "Awaiting answer"|
| `blocked`           | `failed`                  | `warn`     | "Blocked"        |
| `failed`            | `failed`                  | `bad`      | "Failed"         |
| `review-required`   | `review`                  | `gold`     | "Review"         |
| `merge-ready`       | `review`                  | `petrol`   | "Merge ready"    |
| `ready-to-test`     | `review`                  | `petrol`   | "Ready to test"  |
| `running`           | `waiting`                 | `muted`    | (motion only)    |
| `done`              | `done`                    | `good`     | "Done"           |
| `idle`              | `idle`                    | `muted`    | "Draft"          |

Implementation note: widen the view-model `AttentionState` union and add a
`tone` discriminator so `AttentionIndicator.tsx` keeps its current shape.
The existing `toneClass` map extends; it does not fork.

Recommended treatment:

- clear badge (reuse `StatusChip` / `AttentionIndicator`)
- stronger border / card tint tied to the tone token above
- optional prompt count via `MetricPill`

Signal hierarchy (highest-priority wins when multiple apply):

1. `awaiting-answer`
2. `blocked` / `failed`
3. `review-required`
4. `merge-ready`
5. `ready-to-test`
6. `running` (motion only, never a badge)

Rule:

- motion = engine working
- badge = human action required

### C. Motion Specification

Operator cockpit motion must stay calm and readable alongside the existing
Swiss-editorial tone (`--petrol`, `--gold`, `--surface*`).

Rules:

- Running signal is a **single** animated element per card: a 6px dot with
  a 1.8s ease-in-out opacity pulse between 0.4 and 1.0. No shimmer, no
  moving edges, no scaling.
- Animation uses a named CSS variable (`--motion-pulse`) so it can be
  tuned globally.
- Under `@media (prefers-reduced-motion: reduce)` the dot stays at fixed
  opacity 0.8 — no animation.
- Motion is never the *only* indicator of running: the card also gets a
  `data-running="true"` attribute and a visually hidden "run in progress"
  label for assistive tech.

## Board Card Content

The existing `BoardCard.tsx` carries a Swiss-editorial restraint that must be
preserved. Information is organized in three tiers, never flat.

### Tier 1 — Always visible (primary)

- item code (`.code` span)
- title (`<h4>`)
- short summary (`<p>`)
- attention signal (`AttentionIndicator`) — one badge only, highest-priority wins
- mode icon (`BoardCardModeIcon`)
- running dot if `data-running="true"` (see Motion Specification)

### Tier 2 — Visible when card is `.selected` or hovered

- current stage (if a run exists)
- open prompts count (via `MetricPill`)
- recovery badge (`blocked` / `failed`) — existing behavior, promoted to Tier 2
  unless it is the winning attention signal (then Tier 1)

### Tier 3 — Overlay-only (never on card)

- projects count, stories count
- latest branch name
- candidate branch name
- latest run age
- merge state

Rule: a card never shows more than **six** informational elements at once.
If a seventh would appear, it is demoted to Tier 2 or Tier 3.

## Item Overlay Specification

The item overlay (`ItemOverlay.tsx`) should become the main "inspect this
item" surface. Existing subcomponents (`ItemOverlayHeader`,
`ItemProgressList`, `ItemBoardActions`, `ItemActionList`, `ItemChatPreview`)
are kept; new sections below are added as siblings.

### Section 1: Header

Show:

- item code
- title
- summary
- current column
- current phase
- active attention state

### Section 2: Run Summary

Show:

- active run status
- current stage
- started at / last event time
- last completed run
- recent run history

### Section 3: Branches

The overlay must surface branch state explicitly.

Show:

- main branch state
- project branch per project if available
- story branch per story if available
- candidate branch if handoff/candidate exists
- branch status:
  - active
  - merged
  - open candidate
  - abandoned

Preferred rendering:

- compact branch list in the overlay using the new `BranchRow` primitive
  (`ListRow` + `StatusChip` + mono branch name)
- project groups use `DisclosureRow` to reveal story branches on expand

This is mandatory. Branch state is one of the core artifacts of implementation.

### Section 4: Projects And Stories

The overlay needs a real expandable tree (built on `DisclosureRow`):

- Item
  - Project
    - Wave
      - Story

Per node show:

- status
- stage if applicable
- branch if applicable
- review state
- artifact presence

### Section 5: Workflow Ladder

The board has five columns, but the overlay must expose internal implementation progress:

- brainstorm
- requirements
- architecture
- planning
- execution
- project-review
- qa
- documentation
- done

Implementation: extend the existing `ItemProgressList` /
`ItemProgressRow` to accept substage markers (current / complete / failed /
skipped). Do not introduce a parallel "ladder" component.

### Section 6: Quick Actions

The overlay should show (reuse `ItemBoardActions` + `ItemActionList`):

- `Start brainstorm`
- `Promote to requirements`
- `Start implementation`
- `Resume run`
- `Mark done`
- `Open live run`
- `Open artifacts`
- `Open test preview`

### Section 7: Quick Prompt Answer

The operator asked for a short path to answer questions from everywhere.

The item overlay must therefore include a compact prompt module whenever the
item has an open prompt. Implementation: a compact variant of the shared
`PromptComposer` (same mutation as the run workspace and the inbox), rendered
above `ItemChatPreview`:

- current prompt text
- short answer field
- `Answer` button (calls `answerPrompt` from `lib/api`)
- `Open full run` link

This is not the full transcript. It is the "answer now without leaving context" affordance.

## Global Prompt Access

There should be a universal way to answer prompts in all major views.

### Required access points

All four entry points share the same `PromptComposer` component and the
same `answerPrompt` mutation — only the layout differs.

1. Board card
   show prompt-needed badge and count (one-line hint, click opens overlay)

2. Item overlay
   inline compact `PromptComposer`

3. Run workspace
   full `PromptComposer` pinned above the transcript

4. Inbox
   row-level expand reveals the same `PromptComposer`

### Recommended global pattern

Extend the existing `GlobalSignals` component (`components/shell/GlobalSignals.tsx`)
in `AppShell`'s top bar into a clickable `SignalPopover`. Do not introduce a
new tray — `GlobalSignals` already occupies this slot.

The popover shows:

- open prompts count
- blocked runs count
- merge-ready candidates count
- ready-to-test count

Each row deep-links into the exact context (overlay / run / merge / preview).
This solves the "answer from anywhere" requirement without polluting every page with full chat UI.

## Run Workspace Specification

`LiveRunConsole.tsx` is restructured into the sections below. The existing
`RecoveryPanel` slots into section 6. The existing prompt form is replaced
by the shared `PromptComposer`.

### Sections

1. Run header
   - item title
   - run status
   - current stage
   - active branch / candidate branch
   - last activity

2. Active prompt strip
   - pinned at top whenever a prompt is open
   - answer field
   - submit
   - jump-to-context link

3. Conversation transcript
   - stage-agent messages
   - reviewer messages
   - system presentation events
   - operator answers

4. Stage inspector
   - list of stages
   - per-stage status
   - errors
   - produced artifacts

5. Branch panel
   - project branch
   - story branches
   - candidate branch
   - merge status

6. Recovery panel
   - blocked/failed state
   - remediation history
   - resume controls

7. Validation / test panel
   - test preview URL or preview controls
   - environment/source note

## Inbox Specification

The inbox must become real, not mock.

Primary row types:

- `Prompt waiting`
- `Blocked run`
- `Failed run`
- `Review required`
- `Merge ready`
- `Ready to test`

Each row should deep-link into the exact context:

- item overlay
- run panel
- merge panel
- test preview (inside the run workspace, per Right-Pane Arbitration)

## Merge-To-Main UX

The UI needs merge controls even if the CLI/backend capability lands later.

### Product position

Do not hide merge behind the CLI forever. The UI should visibly own the handoff decision.

### Phase 1 UI model

Mock the merge surface with explicit state and disabled actions where backend support is missing.

Show in overlay and run workspace:

- candidate branch name
- base branch
- checklist summary
- validation status

Primary actions:

- `Test candidate`
- `Merge to main`
- `Reject candidate`

If backend support is not yet implemented, avoid phantom affordances:

- render the actions using the existing `Button` primitive with
  `aria-disabled="true"` and a muted tone
- show a one-line helper under the panel: "Backend pending — preview only"
- on hover/focus, a tooltip reads "Merge endpoint lands in Phase 2"
- never show a spinner or pending state for a click that cannot succeed
- mock/demo mode stays behind a `?mock=1` URL flag for layout review only

### Phase 2 real model

When backend/CLI support exists, wire actions to real commands.

The merge panel should capture:

- candidate branch
- base branch
- merge preconditions
- operator acknowledgement
- merge result

### Where merge UI lives

Best location:

- in the run workspace for the active run
- summarized in the item overlay
- visible in inbox when merge is pending

Do not put full merge controls directly on the board card.

## Test After Implementation UX

The operator wants to test an item after implementation and open a new tab on the right to localhost.

### UX goal

After implementation reaches a testable state, the UI should provide a visible `Open test preview` action.

Good locations:

- item overlay
- run workspace (as an internal tab, not a third right pane)
- inbox row for `ready-to-test`

### Important constraint: remote UI access

If the UI is opened from another computer over Tailscale or another remote path, a browser-side link to `http://localhost:3000` is wrong, because `localhost` resolves on the operator's machine, not on the agent/engine host.

This means the UI must not assume the test target is browser-local.

### Correct product model

The preview target must be modeled as an environment-aware endpoint.

Recommended preview object:

- `previewLabel`
- `previewOriginType`: `local-host` | `network-url` | `proxied-url`
- `previewUrl`
- `sourceHost`
- `expiresAt`

### Delivery phases

#### Phase 1

Mock the preview area in the UI:

- show a placeholder preview URL
- allow `Open preview`
- show a host/source note:
  - `Runs on engine host`
  - `Requires proxy`
  - `Direct URL`

#### Phase 2

Add backend support for preview registration.

The engine/backend should expose a preview URL that is safe for the browser currently using the UI.

Preferred strategies:

1. Reverse proxy through the UI/backend host
   Best UX. Browser opens a reachable app-relative URL.

2. Registered public/Tailscale URL
   Acceptable if the implementation environment can expose one.

3. Raw localhost link
   Only acceptable when UI and test target are known to be on the same machine.

### Recommended UI treatment

When preview is available:

- render the preview as an internal tab inside the Run Workspace
  (transcript | stages | branches | preview) — this satisfies the
  Right-Pane Arbitration rule
- also allow `Open in new tab` using the resolved `previewUrl`

If preview is not browser-reachable:

- show explicit status using an `EmptyState` primitive:
  "Preview available on engine host only"
- provide a copyable URL / launch hint

This is better than silently opening a broken localhost tab.

## Required Backend Read Models

The current board and run APIs are not enough for this UI.

New read APIs should be planned for:

1. `GET /items/:id`
   item summary + latest run + recovery + counts

2. `GET /items/:id/tree`
   item -> projects -> waves -> stories with statuses and branches

3. `GET /items/:id/runs`
   run history

4. `GET /runs/:id/timeline`
   normalized timeline suitable for transcript rendering

5. `GET /runs/:id/branches`
   active, story, project, candidate branches

6. `GET /runs/:id/merge-state`
   merge readiness and candidate controls

7. `GET /runs/:id/preview`
   environment-safe preview metadata

8. `GET /inbox`
   workspace-scoped actionable queue

9. `GET /workspaces/:key/signals`
   prompts waiting, blocked, merge-ready, ready-to-test
   (feeds `GlobalSignals` + `SignalPopover`)

## Keyboard & Accessibility

The cockpit is operator-oriented and must be navigable without a mouse.

- `Esc` closes any right pane (overlay, run panel, preview tab falls back
  to the previous tab). Focus returns to the triggering card.
- When the overlay opens, focus moves to the overlay heading; tab order
  is trapped until the overlay closes.
- `g b` / `g i` / `g r` — global shortcuts to Board / Inbox / last Run.
- `j` / `k` move selection inside the board column; `Enter` opens the
  overlay; `o` opens the run workspace.
- `a` inside the overlay or inbox row focuses the `PromptComposer`;
  `Ctrl+Enter` submits. The composer owns its own focus ring.
- `AttentionIndicator` already has `aria-label="Attention: {state}"` —
  new states must extend the label set, not remove it.
- Running dot is announced once per run start via a visually hidden
  `role="status"` region; the pulse animation itself is decorative
  (`aria-hidden="true"`).
- `prefers-reduced-motion: reduce` disables the pulse (see Motion Spec).
- Disabled merge buttons use `aria-disabled="true"` and keep focusability
  so screen readers announce the pending-backend reason.

## Layout Sketch (pending)

This plan is prose-only. Before Phase A starts, attach a one-frame
wireframe at `docs/operator-cockpit-layout.png` showing:

- board + overlay (default right pane)
- board + run workspace (overlay replaced, back affordance visible)
- run workspace with preview tab active
- `SignalPopover` open from the top-right

The wireframe resolves right-pane arbitration and card density visually.

## Delivery Plan

### Phase A: Make Board And Overlay Real

- card selection with URL state (`?item=…`)
- real item overlay data instead of first-item default
- extended `AttentionState` + tone map
- shared `PromptComposer` wired to `answerPrompt` in `lib/api`
- quick prompt answer inside `ItemOverlay`
- branch summary in overlay via new `BranchRow`

### Phase B: Add Item Hierarchy

- projects tree via new `DisclosureRow`
- waves and stories
- branch-per-story display
- implementation stage markers inside `ItemProgressRow`

### Phase C: Upgrade Run Workspace

- restructure `LiveRunConsole` into the seven named sections
- structured transcript
- pinned active prompt using the shared `PromptComposer`
- stage inspector
- branch panel (reuses `BranchRow`)
- `RecoveryPanel` integration stays

### Phase D: Global Inbox / Actions Tray

- extend `GlobalSignals` into a clickable `SignalPopover`
- real inbox page backed by `GET /inbox`
- cross-item prompt answering via shared `PromptComposer`

### Phase E: Merge UX

- merge-ready state in overlay / inbox / run workspace
- mock merge panel first (aria-disabled buttons, not hidden)
- wire real actions later

### Phase F: Test Preview UX

- mock preview panel and actions
- backend preview metadata
- remote-safe URL handling
- preview as internal tab inside the run workspace + "Open in new tab"

## Design Risks

1. Overloading the board card
   Keep dense but not encyclopedic. Branch details belong in the overlay.
   Enforce the three-tier hierarchy and the six-element cap.

2. Mixing inbox and chat
   Inbox is a queue. Run workspace is conversation. Shared `PromptComposer`
   keeps them aligned without fusing them.

3. Treating localhost as universal
   This breaks remote/Tailscale use. Preview URLs must be host-aware.

4. Putting every action in the overlay only
   Global prompt access still needs `SignalPopover` and the inbox.

5. Making merge invisible until backend exists
   The UI should still establish the merge workflow now, even in mocked form.

6. Duplicating components
   Every "new" surface in this plan has an existing counterpart. New files
   only for the four primitives listed in "Mapping To Existing Components".

7. Vocabulary drift between doc and code
   The doc follows the code's vocabulary (`ItemOverlay`, `AttentionState`,
   `GlobalSignals`, `LiveRunConsole`). Do not reintroduce "drawer" or "tray"
   as implementation names.

8. Right-pane collisions
   Overlay, run panel, and preview all want the right side. The Right-Pane
   Arbitration rule is non-negotiable.

## Final Recommendation

Use this structure (each surface maps to an existing file, not a new one):

- **Board** (`BoardView.tsx`) for overview
- **Item Overlay** (`ItemOverlay.tsx`) for structure, branches, and quick
  answers
- **Run Workspace** (`LiveRunConsole.tsx`, restructured) for live interaction
- **Inbox** (`InboxView.tsx`) + **`SignalPopover`** on `GlobalSignals` for
  cross-item interruptions

And adopt these mandatory affordances:

- active runs visibly alive on cards (calm pulse, reduced-motion safe)
- prompt-needed clearly visible on cards
- branch state visible in the item overlay via `BranchRow`
- one `PromptComposer` mutation reachable from every major view
- merge-to-main surfaced in UI now, mocked with `aria-disabled` if needed
- test preview designed around remote-safe URLs, not naive localhost links
- keyboard-first operation with focus management on overlay open/close
