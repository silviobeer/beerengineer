# BeerEngineer UI — design notes

**Status (2026-04-24):** This is *design intent* for the UI rebuild. The
first UI existed 2026-04-22 → 2026-04-24 in `apps/ui/` and was then torn
down (see `specs/ui-rebuild-plan.md`). No UI code exists in the tree today.
This document sums up which design decisions from that first pass are
worth carrying into the rebuild, and which ones died with it.

For the API side — *what endpoints exist and what they return* — start with
[`api-for-designers.md`](./api-for-designers.md). That doc is the
companion: it describes the engine surface; this one describes the UX
surface.

Authoritative sources when things drift:

- Engine contract: `spec/api-contract.md` + live spec at `GET /openapi.json`
- UI teardown rationale: `specs/ui-rebuild-plan.md`
- This document: UX shell, routing, design-system principles

---

## Mental model

- **Workspace = the app/project being built.** It has its own folder on
  disk, registered via `root_path` in the engine DB.
  - Schema note: `root_path` is nullable today (no UNIQUE constraint either).
    If the rebuild wants "every workspace has exactly one registered path,"
    that's a schema migration request — not a given.
- **Don't mix workspaces on any board.** Each board is scoped to one
  workspace. Cross-workspace signals live in a **global dashboard + a
  notification bell**, not inside a workspace view.
- **Breadcrumb**, not nested dropdowns: `workspace › item — title`.
- **Four concepts total**: workspace, item, run, stage. Learn them once.
  (See `api-for-designers.md` §"The mental model" for full definitions.)

## Route tree

```
/                                    dashboard (workspace-agnostic aggregate)
/setup                               first-run tool setup + workspace register
/w/[key]                             board (the main Kanban screen)
/w/[key]/inbox                       pending-prompts view
/w/[key]/runs                        run list
/w/[key]/runs/[id]                   run console
/w/[key]/artifacts                   artifact browser
/w/[key]/settings                    workspace + tool settings
```

`item` is a URL segment inside a run/inbox context, not a top-level query
param. Greenfield: no legacy URLs to redirect.

## Shell chrome

Topbar, left → right:

1. **WorkspaceSwitcher** — dropdown of registered workspaces (from
   `GET /workspaces`), plus `+ Add workspace` (→ `/setup?add=1`).
2. **Breadcrumb** — `workspace › item` when drilled into an item; just
   `workspace` otherwise.
3. **PrimaryNav** — inbox / runs / artifacts / settings, scoped to the
   current workspace.
4. **GlobalSignals** — current workspace's attention pills
   (awaiting_answer, blocked, merge_ready, ready_to_test).
5. **NotificationBell** — cross-workspace attention count. Click → popover
   with rows that deep-link into other workspaces. Count **excludes the
   current workspace** (the current one is already shown in GlobalSignals).

## Setup flow (paste-path, no native folder picker)

One form. The endpoint already supports it end-to-end.

Mechanic:

1. User pastes an absolute filesystem path.
2. Debounced `GET /workspaces/preview?path=<abs>` → inline preview card:
   ```
   { exists, isDirectory, isWritable, isGitRepo, hasRemote,
     defaultBranch, detectedStack, existingFiles[], isRegistered,
     isInsideAllowedRoot, isGreenfield, hasWorkspaceConfigFile,
     hasSonarProperties, conflicts[] }
   ```
3. Card renders status — red if unregisterable, green if ready, grey while
   typing. Don't hide fields; surface every conflict/warning verbatim.
4. Primary button text is driven by preview state: *Register* vs.
   *Create & register*. One button, two behaviors.
5. Submit → `POST /workspaces` → redirect to `/w/[key]`.

Entry points:

- `/setup` — first-run, no shell chrome (no workspace yet).
- `/setup?add=1` — inside the shell, from `+ Add workspace`.

Safety: engine rejects paths outside `config.allowedRoots[]`. The preview
response surfaces that in `isInsideAllowedRoot` / `conflicts[]` so the form
can explain the rejection inline — don't wait for `POST` to show the error.

There is **no** `POST /setup/init` HTTP endpoint. Tool-level setup
(data dir, config file, LLM providers) is done via the CLI:
`beerengineer setup --no-interactive`. `GET /setup/status` reports the
current doctor state; if a user is stuck, surface a copy-pasteable command
from `remedy.command`, don't try to run setup over HTTP.

## Dashboard (`/`)

Cross-workspace attention aggregate, grouped by workspace:

- Awaiting answer
- Blocked / failed
- Merge ready
- Ready to test
- Review required

Each row: count + label + deep link (`/w/[key]/inbox` or
`/w/[key]/runs/[id]`). Empty state when zero attention items.

Tool-level settings (data dir, allowed roots, LLM config, doctor output)
live on this surface too — they're not bound to any workspace.

**Data source caveat.** There is no single `GET /dashboard` endpoint today.
The current board is workspace-scoped (`GET /board?workspace=`). A
cross-workspace aggregate either fans out client-side (`GET /workspaces` →
N × `GET /board?workspace=…`) or waits for a new server endpoint. The
former is fine for a handful of workspaces; the latter becomes worth it if
users commonly have 10+ workspaces.

## Notification bell

Topbar icon + numeric badge. Count = attention items across workspaces
*other than* the current one. Click → popover grouped by workspace.
Clicking a row switches workspace and deep-links into the target.

Same data-fanout caveat as the dashboard.

## Inbox (`/w/[key]/inbox`)

"What's waiting on me in this workspace?"

- No dedicated endpoint today. The rebuild has two shapes to choose from:
  - **Client-side derivation**: fetch `GET /runs`, filter to runs belonging
    to the workspace with `status === "needs_answer"`. Cheap, no backend
    change, slightly chatty on large workspaces.
  - **Server-side aggregate**: propose `GET /workspaces/:key/pending-prompts`.
    Single round-trip. Ask for it when the screen is actually built and
    the shape of "what to show per row" is clear.

## Run console (`/w/[key]/runs/[id]`)

Live view of a single run. The engine already supports everything needed:

- Poll-free main state: subscribe to `GET /runs/:id/events?level=2` (SSE).
- "Is it waiting on me?" is in `GET /runs/:id.openPrompt`.
- Conversation transcript: `GET /runs/:id/conversation`.
- Full event log with level filter: `GET /runs/:id/messages?level=…`.
- Stage tree / progress stepper: `GET /runs/:id/tree`.
- Recovery banner: `GET /runs/:id/recovery`.

See `api-for-designers.md` §5–§8 for shapes.

## Artifacts policy

Ownership rule: *does it belong to the thing being built, or to the tool
building it?*

- **Workspace repo** (in git): specs, PRDs, architecture docs, generated
  code, test fixtures — human-reviewable outputs that belong to the product.
- **BeerEngineer data dir** (not in any git): run transcripts, SSE events,
  stage timings, prompt histories, attempt blobs, preview snapshots, plus
  design-prep artifacts (wireframe HTMLs, design-preview HTMLs).
- Preview URLs / screenshots → engine data dir, referenced by URL in PR
  descriptions, never checked in.

The Artifacts page shows both buckets with clear labels ("in repo" vs.
"run telemetry"). Today exposed via `GET /runs/:id/artifacts[/:path]` and
`GET /items/:id/wireframes`, `GET /items/:id/design`.

## Design-system principles

The first UI had these enforced as primitives (`DetailBlock`, `Panel`,
`StatusChip`, `Button`, `PreviewBody`, `ConversationMessage`,
`BoardLiveSubscriber`). **Those components no longer exist in the tree.**
The *principles* behind them are worth preserving:

- **One way to render a detail block.** Kicker + title + body — a single
  primitive, not ad-hoc divs per screen.
- **One way to render a chrome panel.** All major surfaces share a
  `Panel`-style container so spacing/radius/shadow stay consistent.
- **One way to render a status pill.** Board filters, inbox filters, run
  status indicators all route through one component; adding a new status
  is a one-line enum change.
- **One way to render a button.** Variants via props, not per-screen CSS.
- **One way to render a chat line.** The run console and any overlay that
  shows messages share the same row component — so tone/role/avatar stay
  consistent.
- **Leading + trailing throttle for SSE-driven re-renders.** Burst of
  events → re-render at the head and the tail of the window, not every
  event, and never drop the last one.

These are *rebuild targets*, not current state.

## Deferred (until the tool is proven)

- Electron wrapper / desktop packaging / code signing.
- Native folder picker (pointless without Electron).
- Folder watching or tailing files that only the browser knows about.
- Auth / multi-user shell chrome.

## Engine surface — ready / partially ready / not yet

This replaces the old "UI work blocked until engine contract lands" section.
Most of the prerequisites are now satisfied.

**Ready to build against:**

- `GET /workspaces`, `POST /workspaces`, `GET /workspaces/:key`,
  `DELETE /workspaces/:key?purge=1`, `POST /workspaces/:key/open`,
  `GET /workspaces/preview?path=`
- `GET /items?workspace=`, `GET /items/:id`,
  `POST /items/:id/actions/<name>`, `GET /items/:id/wireframes|design`
- `GET /runs`, `POST /runs`, `GET /runs/:id`,
  `GET /runs/:id/{tree,recovery,conversation,messages,artifacts}`,
  `POST /runs/:id/{answer,resume,messages}`
- `GET /board?workspace=` — minimal columns+cards DTO (see §"Gaps" below)
- SSE: `GET /events?workspace=`, `GET /runs/:id/events?level=&since=`
- `GET /setup/status`, `GET /notifications/deliveries`,
  `POST /notifications/test/:channel`
- `GET /openapi.json` — machine-readable spec, always the source of truth
  for response shapes

**Known gaps (file a ticket before the screen that needs it ships):**

- **Inbox aggregate.** `GET /workspaces/:key/pending-prompts` or
  `GET /runs?workspace=&status=needs_answer`. The filter parameters are
  documented in `spec/api-contract.md` but today's `handleListRuns`
  ignores them.
- **Richer `BoardCardDTO`.** Currently `meta` = `phase` + `projects` count.
  Likely wanted for a polished board: pending-prompts count per item,
  blocked/failed flag, latest-run reference (id, stage, status). Add when
  the card design demands them — don't speculate.
- **Merge status.** No signal today. `items.current_column = "done"` only
  means the handoff stage completed — *not* that the item is in the base
  branch. If the UI wants a "merged" visual, add `items.merged_at` +
  `POST /items/:id/actions/mark_merged` (operator action) in a scoped PR.
- **Cross-workspace aggregates.** Dashboard + notification bell have no
  single-shot endpoint; fan out client-side or add one later.

**Won't add speculatively:**

- Changing the 5-column board taxonomy before a concrete screen demands it.
  (See the "Soll-Zustand 7 Spalten" discussion in the commit log /
  `spec/api-contract.md` audit: the columns are also the item-lifecycle
  state machine that gates action transitions; changing them is not a
  display-only edit.)
- Swagger UI hosting. Paste `openapi.json` into any external viewer.

## Suggested first iteration of the rebuild

One ordering that minimises rework:

1. **Pick a stack.** Not in this document's scope — separate decision
   (see `specs/ui-rebuild-plan.md` Open Questions §3).
2. **`/setup` + `RegisterWorkspaceForm`.** The form is well-specified and
   the endpoints are stable. Good first screen to shake out the stack.
3. **`/w/[key]` board.** `GET /board?workspace=` gives you the DTO
   directly. Ship the minimal `meta` first; enrich later.
4. **Shell chrome** (WorkspaceSwitcher, Breadcrumb, PrimaryNav).
5. **Run console** (`/w/[key]/runs/[id]`). Biggest surface, biggest SSE
   test. Ship read-only first, then add answer / resume composers.
6. **Inbox** — only now do you know what fields matter per row, so propose
   the aggregate endpoint with real requirements.
7. **Dashboard + NotificationBell** — these depend on cross-workspace
   data; decide then whether to fan out or add a server endpoint.
8. **Settings page** — doctor report, notifications audit, test button.

Everything after step 5 has a natural point to push a small, motivated
API enhancement back to the engine team. That's the pattern: *screen
reveals the shape; then ask for the endpoint.*
