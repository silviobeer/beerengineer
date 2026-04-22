# BeerEngineer UI — design notes

Durable notes from the UI-direction conversation on 2026-04-22.
This document captures the intended shape of the UI once the engine contract
lands. Not implemented yet; engine setup is being nailed down first.

## Mental model

- **Workspace = the app/project being built.** It has its own folder on disk,
  registered via `root_path` in the engine DB.
- **Don't mix workspaces on any board.** Each board is scoped to one
  workspace. Cross-workspace signals live in a **global dashboard + a
  notification bell**, not inside a workspace view.
- **Breadcrumb**, not nested dropdowns: `workspace › item — title`.

## Route tree

```
/                                    dashboard (workspace-agnostic aggregate)
/setup                               tool setup + workspace register (first-run & add)
/w/[key]                             board (today's /)
/w/[key]/inbox
/w/[key]/runs
/w/[key]/runs/[id]
/w/[key]/artifacts
/w/[key]/settings
```

Legacy `?workspace=…&item=…` URLs redirect to the nested routes. `item`
becomes a segment, not a query param.

## Shell chrome

Topbar, left → right:

1. **WorkspaceSwitcher** — dropdown of registered workspaces, plus
   `+ Add workspace` (→ `/setup?add=1`).
2. **Breadcrumb** — `workspace › item` when drilled into an item; just
   `workspace` otherwise.
3. **PrimaryNav** — inbox / runs / artifacts / settings, scoped to the
   current workspace.
4. **GlobalSignals** — current workspace's attention pills
   (awaiting_answer, blocked, merge_ready, ready_to_test).
5. **NotificationBell** — cross-workspace attention count. Click → popover
   with rows that deep-link into other workspaces. Count excludes the
   current workspace.

## Setup flow (paste-path, no native picker)

Single form — `RegisterWorkspaceForm` — that replaces today's three mock
forms (`CreateWorkspaceForm`, `WorkspaceRootForm`, `WorkspaceInitForm`).

Mechanic:

1. User pastes a path.
2. Debounced `GET /workspaces/preview?path=…` returns:
   `{ exists, isDirectory, isWritable, isGitRepo, hasRemote, defaultBranch,
      detectedStack, existingFiles[], isRegistered, isInsideAllowedRoot,
      conflicts[] }`.
3. Inline preview card renders that state — red if unregisterable, green if
   ready, grey while typing.
4. Primary button text is driven by preview state: *Register* vs.
   *Create & register*. One button, two behaviors.
5. On submit → `POST /workspaces` → redirect to `/w/[key]`.

Entry points:

- `/setup` — first-run, no shell chrome (no workspace yet).
- `/setup?add=1` — inside the shell, from `+ Add workspace`.

Safety: engine rejects paths outside `config.allowedRoots[]`. The preview
response surfaces that so the form can explain the rejection inline.

## Dashboard (`/`)

Aggregates attention items across all workspaces, grouped by workspace:

- Awaiting answer
- Blocked / failed
- Merge ready
- Ready to test
- Review required

Each row: count + label + deep link (`/w/[key]/inbox` or
`/w/[key]/runs/[id]`). Reuses the existing `SignalPopover` row pattern, with
a `workspaceKey` added to each entry.

Empty state when zero attention items.

Tool-level settings (data dir, allowed roots, LLM config, doctor output)
live on this surface too — they're not bound to any workspace.

## Notification bell

Topbar icon + numeric badge. Count = attention items across workspaces
*other than* the current one. Click → popover using the same `SignalPopover`
primitive, showing rows grouped by workspace. Clicking a row switches
workspace and deep-links into the target.

Extend `WorkspaceSignalEntry` with a `workspaceKey` field. That's the only
data-model change.

## Artifacts policy

Ownership rule: *does it belong to the thing being built, or to the tool
building it?*

- **Workspace repo** (in git): specs, PRDs, architecture docs, generated
  code, test fixtures, design tokens — human-reviewable outputs.
- **BeerEngineer data dir** (not in any git): run transcripts, SSE events,
  stage timings, prompt histories, attempt blobs, preview snapshots.
- Preview URLs / screenshots → engine data dir, referenced by URL in PR
  descriptions, never checked in.

The Artifacts page shows both buckets with clear labels ("in repo" vs.
"run telemetry").

## Component-level rules already enforced (2026-04-22)

- `DetailBlock` primitive is the only way to make a `detail-block` with a
  kicker + title. No raw `<div class="detail-block">`.
- `Panel` primitive wraps all chrome panels. No raw `<div class="panel">`.
- `StatusChip` for all status pills (board filters, inbox filters, run
  status).
- `Button` primitive now carries full button semantics; no raw
  `<button class="button button-*">` except for very specialized cases.
- `PreviewBody` is the shared preview-card body used by both the overlay
  and the run console.
- `ConversationMessage` is the one way to render a chat line.
- `BoardLiveSubscriber` uses leading + trailing throttle so trailing events
  are never dropped.

## Deferred (until the tool is proven)

- Electron wrapper / desktop packaging / code signing.
- Native folder picker (pointless without Electron).
- Folder watching or tailing files that only the browser knows about.
- Auth / multi-user shell chrome.

## UI work that unblocks only after the engine contract lands

Nothing UI-side is worth starting until the engine exposes:

- `GET /setup/status` + `POST /setup/init`
- `GET /workspaces` / `POST /workspaces` / `GET /workspaces/preview?path=` /
  `DELETE /workspaces/:key`
- `root_path NOT NULL UNIQUE` in the `workspaces` table
- Artifact paths resolved against each workspace's `root_path`, not against
  the engine folder

Once those exist, the UI work is:

1. `RegisterWorkspaceForm` + `/setup`.
2. Route restructure to `/w/[key]/…` + legacy redirects.
3. Dashboard at `/`.
4. Notification bell + `workspaceKey` on signal entries.
5. Breadcrumb.
