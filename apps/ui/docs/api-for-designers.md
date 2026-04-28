# API for Designers — BeerEngineer Engine

A quick orientation for UI/UX designers joining the UI rebuild. You don't
need to read code. This document shows **what the Engine exposes**, grouped
by screen, so you can design against real data shapes.

The authoritative technical contract lives in two places:

- **`GET /openapi.json`** — machine-readable spec (OpenAPI 3.1.0). Paste
  into [editor.swagger.io](https://editor.swagger.io) or any OpenAPI tool
  to explore interactively. Also served directly by the running engine.
- **`docs/api-contract.md`** — prose companion with invariants.

This file is the designer-friendly summary. When the two disagree, the
OpenAPI file wins.

---

## The mental model

Four concepts. Learn these once.

| Concept | What it is | Lifespan |
|---|---|---|
| **Workspace** | A product / app the engine drives. Persisted registration pointing at a filesystem path (a git repo). | Long-lived. |
| **Item** | A piece of work inside a workspace — a feature idea, a bug, a refactor. Has a stable `code` (e.g. `ITEM-0001`) and sits in a **column** of the board (`idea` / `brainstorm` / `requirements` / `implementation` / `done`) plus a `phase_status` (`draft` / `running` / `review_required` / `completed` / `failed`). | Long-lived. |
| **Run** | One execution of the workflow against an item. Walks through stages (brainstorm → visual-companion → frontend-design → requirements → architecture → planning → execution → project-review → qa → documentation → handoff). Has a `status` and a `current_stage`. | Finite (minutes–hours). |
| **Stage** | One phase of a run. Emits events (messages, questions, artifacts). When the stage asks the user a question, the run is `needs_answer` until the user answers. | Inside a run. |

The **board** is a Kanban-style projection of items into columns. The
column is driven by the item's `current_column` field (already computed by
the engine — you just read it).

---

## Authentication in one sentence

Browser-side fetches can hit all `GET` endpoints directly (CORS-restricted
to the configured UI origin). Mutating calls (`POST`/`DELETE`) need an
`x-beerengineer-token: …` header — the UI reads the token from the engine's
token file on its server side; the browser never sees it.

SSE streams (`/events`, `/runs/:id/events`) are GETs — no header needed.

---

## Screens and the endpoints that feed them

Each screen below is a likely UI surface. Pick the one you're designing and
jump to the relevant endpoints.

### 1. Workspace picker

A user opens the app; they have one or more workspaces.

- `GET /workspaces` → list. Each entry has `{ id, key, name, description, rootPath, createdAt, updatedAt }`.
- Empty state: the user has no workspaces yet. Send them to the "add workspace" flow.

### 2. Add workspace / preflight

User drags in a folder path or types one.

- `GET /workspaces/preview?path=<abs path>` → pre-flight report: `exists`, `isDirectory`, `isWritable`, `isGitRepo`, `hasRemote`, `defaultBranch`, `detectedStack`, `conflicts[]`, `isGreenfield`, etc. **Render this as a checklist** before the user commits.
- `POST /workspaces` with `{ path, name?, key?, create?, harnessProfile?, sonar?, git? }` → register. Response is `{ ok: true, workspace, warnings[], actions[] }` or `{ ok: false, error, detail }`.
- Designer note: `warnings[]` and `actions[]` are user-visible strings from the engine — don't reword them; they describe what the engine did (or couldn't do) during registration.

### 3. Board view (the main screen)

The core Kanban. Seven columns, cards are items.

- `GET /board?workspace=<key>` → a ready-to-render DTO:
  ```
  { workspaceKey, columns: [
      { key, title, cards: [
          { itemCode, itemId, title, summary, column, phaseStatus, meta: [{label,value}, …] },
          …
      ]},
      …
  ]}
  ```
- Columns are **always in this order**: `idea` → `brainstorm` → `frontend` → `requirements` → `implementation` → `merge` → `done`. Even when empty, they appear.
- `meta` today contains `phase` and `projects` count. Minimal by design — if you need more (e.g. number of open questions, blocked/failed indicator, latest run info), say so and we add it. Don't reach around the API.

**Live updates:** `GET /events?workspace=<key>` is a Server-Sent Events stream. Subscribe once and re-fetch the board (or merge events in) when you see `item_column_changed`, `run_started`, `run_finished`, `stage_started`, `stage_completed`, `project_created`. `item_column_changed` is now emitted on **every** column transition — both operator-driven actions (`promote_to_requirements`, etc.) and workflow-driven stage transitions (e.g. moving from `implementation` → `merge` when the merge gate opens). The board no longer needs a manual refresh to track stage progress. See §Live data.

### 4. Item detail / overlay

User clicks a card.

- `GET /items/:id` → full item row.
- `GET /runs?` → all runs in the system, newest first. Currently no filter parameters are honoured, so for a per-item view you filter client-side (`runs.filter(r => r.item_id === itemId)`). If that becomes painful, ask for `GET /runs?itemId=<id>`.
- Actions available on an item: `POST /items/:id/actions/<name>` where `<name>` is one of:
  - `start_brainstorm` — move `idea` → `brainstorm`, start a run.
  - `start_implementation` — move `requirements` (completed) → `implementation`, start a run.
  - `rerun_design_prep` — re-run visual-companion + frontend-design for an item that already has brainstorm.
  - `promote_to_requirements` — pure column transition.
  - `promote_to_base` / `cancel_promotion` — merge-gate controls while an item sits in `merge`.
  - `mark_done` — pure column transition.
- On success: `200 { kind, itemId, runId?, column, phaseStatus, action }`. On wrong column/phase: `409 { error: "invalid_transition", current: {column, phaseStatus}, action }`. Render this cleanly — the engine tells you which transitions are valid from where.
- Design-prep artifacts: `GET /items/:id/wireframes` and `GET /items/:id/design` return the visual-companion and frontend-design bundles (URL pointers to generated HTML). Only populated after a completed run that went through those stages.

### 5. Run console (live)

User clicked into a run that's in-flight.

- `GET /runs/:id` → run metadata. When the run is waiting for the user, response includes `openPrompt: { promptId, text, stageKey, createdAt, actions? }`. **That's the "waiting on me" signal** — no second call needed.
- `GET /runs/:id/conversation` → operator-facing transcript. Array of entries with `kind ∈ {system, message, question, answer}`. Render as a chat-style log.
- `GET /runs/:id/messages?level=<0|1|2>&since=<id>&limit=<n>` → full projected event log with level filtering. `level=2` is the default (milestones + summaries). `level=0` is the chattiest (every tool event). Use `/messages` when you want the full technical history; use `/conversation` for the human-readable transcript.
- `GET /runs/:id/tree` → all stage runs with status + timings. Good for a vertical stepper UI.
- `GET /runs/:id/recovery` → `null` if the run is healthy, or `{ status: "blocked"|"failed", summary, scope, remediations[], resumable }` if it's stuck. Render as a banner / resume-CTA.

**Live updates:** `GET /runs/:id/events?level=<n>&since=<id>` is the SSE stream for a single run. Same level/since semantics as `/messages`. Errors (`run_failed`, `run_blocked`, `phase_failed`) are force-delivered regardless of your `level` filter.

### 6. Prompt composer (the "answer me" box)

When the run is waiting.

- Read the open prompt from `GET /runs/:id` (`openPrompt.text`).
- Answer with `POST /runs/:id/answer`, body `{ promptId, answer }`. Answer must be non-empty after trim. Response is the updated conversation (same shape as `GET /runs/:id/conversation`) — useful for an optimistic UI that swaps in the post-write state.
- Errors: `409 prompt_not_open` means the prompt was already answered (or cancelled) before your click landed — re-fetch the conversation and decide what to show.

If you want a **free-form chat message** that is *not* an answer to a pending question: `POST /runs/:id/messages { text }` → `201 { ok: true, entry, conversation }`. The message appears in the conversation log with `actor: "user"`, `kind: "message"`.

### 7. Inbox / pending-prompts aggregate

"Show me every run in this workspace that's waiting on me."

- **No dedicated endpoint today.** Work around it by fetching `GET /runs` and filtering to `status === "needs_answer"` (and matching the workspace client-side). If this becomes the central screen for daily use, ask for `GET /workspaces/:key/pending-prompts` — one round-trip is cleaner than N.

### 8. Resume / recovery flow

A run is blocked or failed.

- `GET /runs/:id/recovery` → `remediations[]` is the audit log of prior operator remediations. Render it so the user sees what they (or someone) already tried.
- `POST /runs/:id/resume { summary, branch?, commit?, reviewNotes? }` → re-enter the workflow with the operator's remediation note. Response `200 { runId, status }`. `422` if the engine refuses (e.g. missing summary); `409 not_resumable` if another resume is already in-flight.

### 9. Settings

- `GET /setup/status` → doctor report (required/recommended/optional groups, each with checks and remedies). Render as a checklist with amber/red/green. Each failing check has a `remedy.hint` (text) and sometimes a `remedy.command` (copy-pasteable shell) or `remedy.url`.
- `GET /notifications/deliveries?channel=<name>&limit=<n>` → audit of outbound notifications (currently Telegram). Render as a recent-activity list.
- `POST /notifications/test/<channel>` → send a smoke-test notification.

---

## Live data — how SSE works

Two streams. Both are `GET` and served as `text/event-stream`.

| Stream | Scope | Use for |
|---|---|---|
| `GET /events?workspace=<key>&level=<n>` | Workspace-wide | Board live updates — cards moving columns, runs starting/finishing. |
| `GET /runs/:id/events?level=<n>&since=<id>` | Single run | Run console — live messages, stage starts/completions, prompts. |

Each frame is a projected `MessageEntry`:

```
{
  id,          // stable cursor
  ts,          // ISO
  runId,
  stageRunId,
  type,        // e.g. run_started, stage_started, chat_message, prompt_requested, …
  level,       // 0 | 1 | 2
  force,       // true → delivered regardless of subscribed level
  payload      // event-specific fields
}
```

- `since` lets you resume without losing events: pass the last seen `id` when reconnecting.
- `level` defaults to 2 (milestones). Use 1 for more detail, 0 for every internal tool event. `force: true` frames always come through — these carry errors and blockers.

---

## Engine concepts you can safely ignore

Don't design around these. They exist, but they're plumbing.

- **Stages vs columns.** The engine has ~11 stages; the board has 5 columns. The engine does the mapping in `items.current_column`. You just read it.
- **CSRF token file.** The UI server reads it and injects the header. Browser code doesn't see it.
- **SQLite.** All state lives in one SQLite file that the engine owns. The UI must never read it directly — that's why this document exists.

---

## What's not available yet (open asks)

If you design a screen that needs any of these, flag it — we'll add the endpoint. We prefer targeted additions over speculative ones.

- **Pending-prompts aggregate** per workspace. Today: walk `/runs` and filter client-side. See §7.
- **Rich board cards**: `pending_prompts` count, blocked/failed flag, latest-run reference. Today: `meta` is minimal. See §3.
- **Item → run filter**: `GET /runs?itemId=<id>` is documented in the contract as future work; the handler ignores filter params today.
- **Post-merge archival status**: the engine now merges the item branch into the workspace base branch at the merge gate, but it still does not archive or delete the item branch afterward.
- **Notification channel CRUD**: config is file-based today. No `POST /notifications/channels` surface.
- **Swagger UI hosting**: we don't ship one. Paste `openapi.json` into any external viewer if you want interactive exploration.

---

## When something feels off

- If the OpenAPI says one thing and the engine does another, the engine wins — file it and we'll fix the spec.
- If the prose in `docs/api-contract.md` contradicts the OpenAPI, the OpenAPI wins.
- If a response shape seems thinner than your screen needs, don't work around it with multiple round-trips. Ask for a richer field — one round-trip with the right shape is better than five with the wrong one.

Questions → the engine team.
