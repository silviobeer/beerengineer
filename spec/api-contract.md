# Engine API Contract

Target shape for `apps/engine/src/api`. Companion to `spec/architecture.md`.

The Engine API is the canonical surface for all clients (UI, CLI, future webhooks). CLI-local ergonomics (`workspace use`, `item open`, `run open`, terminal rendering) are not part of this contract.

The machine-readable version of this contract lives at
`apps/engine/src/api/openapi.json` and is served at runtime from
`GET /openapi.json`. The document below is authoritative for prose and
invariants; the OpenAPI file is authoritative for request/response shapes
consumed by tooling.

---

## Conventions

- All ids are opaque strings.
- All timestamps are ISO 8601 UTC.
- All text fields are **resolved display text**. No `you >` placeholders.
- Errors: standard HTTP codes plus a short JSON body `{ error: string, code?: string }`. Codes used: `bad_request`, `not_found`, `forbidden`, `invalid_transition`, `prompt_not_open`, `run_blocked`.

---

## Routes

### Health / setup

- `GET /health` → `{ ok: true }`
- `GET /setup/status` (existing)

### Workspaces

- `GET /workspaces`
- `POST /workspaces`
- `GET /workspaces/:key`
- `DELETE /workspaces/:key?purge=1`
- `POST /workspaces/:key/open` — resolve the workspace's on-disk root path.
- `POST /workspaces/backfill` — re-derive per-workspace config files from the registry.
- `GET /workspaces/preview?path=<abs fs path>` — filesystem preflight for a candidate registration target. **Not** keyed by an existing workspace — the query parameter is an absolute filesystem path. Returns a `WorkspacePreview` (see OpenAPI) describing existence, writability, git status, greenfield heuristics, conflicts with existing registrations, etc.

Workspace status (counts, latest run) is returned as part of `GET /workspaces/:key`. No separate `/status` endpoint.

### Items

- `GET /items?workspace=:key&status=&column=&limit=&cursor=`
- `GET /items/:id`
- `POST /items/:id/actions/:action`
  - `:action` ∈ `start_brainstorm | start_implementation | rerun_design_prep | promote_to_requirements | mark_done`
  - Request: `{}` (action-specific fields may be added per action; document them in the handler, not generically).

No generic `POST /items/:id/actions` with an action string in the body. Explicit routes only.

### Runs

- `GET /runs?workspace=:key&itemId=&status=&owner=&limit=&cursor=`
- `POST /runs` — create run
  - Request: `{ workspaceKey, title, description? }`
  - Response: `{ runId, itemId, status }`
- `GET /runs/:id`
- `GET /runs/:id/tree`
- `GET /runs/:id/recovery`
- `POST /runs/:id/resume`
  - Request: `{ summary, branch?, commit?, reviewNotes? }`
  - Response: `{ runId, status }`

`GET /runs/:id` response includes `openPrompt` when `status === 'needs_answer'`, so UIs that only show "is it waiting on me?" don't need a second call.

### Conversation (run-scoped)

- `GET /runs/:id/conversation`
  - Response:
    ```json
    {
      "runId": "run_…",
      "updatedAt": "2026-04-24T12:35:12.000Z",
      "entries": [ConversationEntry, …],
      "openPrompt": OpenPrompt | null
    }
    ```
- `POST /runs/:id/answer`
  - Request: `{ promptId, answer }`
  - Response: same shape as `GET /runs/:id/conversation` (post-write snapshot).

No `/open-prompt` endpoint — derive from `/conversation`.
No `POST /runs/:id/input`, no `GET /runs/:id/prompts` — both were removed
before the UI teardown; clients use `/answer` and `/conversation` instead.

### Messages (canonical projected event log)

Follow-on to the conversation endpoint. Where `/conversation` returns the
operator-facing transcript (messages, questions, answers only), `/messages`
returns the full event log projected through `MessageEntry` with level
filtering — the shape defined in `spec/messaging-levels.md`.

- `GET /runs/:id/messages?level=&since=&limit=`
  - `level` ∈ `0 | 1 | 2` (or `L0 | L1 | L2`). Default `2`. See
    `spec/messaging-levels.md` §1 for the detail-rank semantics.
  - `since` is the stable `MessageEntry.id` cursor. Omit for head of log.
  - `limit` ≤ 500, default 200.
  - Server-side scan is capped at `MESSAGES_ENDPOINT_MAX_SCAN` rows per
    request. When the cap is hit before `limit` entries are assembled the
    response returns `nextSince` pointing at the last scanned row so the
    client can resume — even when the client's `limit` was not met.
  - Response:
    ```jsonc
    {
      "runId": "run_…",
      "schema": "messages-v1",
      "nextSince": "msg_…",   // null when end of log reached
      "entries": [MessageEntry, …]
    }
    ```
- `POST /runs/:id/messages`
  - Free-form user chat posted into the run. **Does not** close an open
    prompt — use `POST /runs/:id/answer` for that.
  - Request: `{ text }`. The HTTP boundary pins `source = "api"`; internal
    surfaces (CLI, webhook handler) call `recordUserMessage` directly and
    set their own source.
  - Response: `{ ok: true, entry: ConversationEntry, conversation: ConversationResponse }`.

### Events (SSE)

- `GET /events?workspace=:key&level=` (workspace-scoped)
- `GET /runs/:id/events?level=&since=` (run-scoped)

Both SSE streams emit projected `MessageEntry` frames. `level` and `since`
behave identically to the `/messages` endpoint above; errors
(`run_failed`, `run_blocked`, `phase_failed`) are force-through regardless
of level.

### Notifications (outbound only)

- `GET /notifications/deliveries`
- `POST /notifications/test/:channel`

No channel-binding CRUD.

### Webhooks (inbound, channel-authenticated)

- `POST /webhooks/telegram` — authenticates with `x-telegram-bot-api-secret-token`, bypasses the CSRF gate. Only reachable when `telegram.inbound.enabled` is set.

### Artifacts

- `GET /runs/:id/artifacts`
- `GET /runs/:id/artifacts/:path` — single file under the run's workspace directory; `..` segments stripped.
- `GET /items/:id/wireframes` — `visual-companion` artifact bundle for an item's most recent completed run.
- `GET /items/:id/design` — `frontend-design` artifact bundle for an item's most recent completed run.

### Board

- `GET /board?workspace=:key` — columns + cards aggregate for a workspace.

### Spec

- `GET /openapi.json` — this contract as a machine-readable OpenAPI 3.1.0 document (served from `apps/engine/src/api/openapi.json`).

---

## Schemas

### ConversationEntry

```ts
{
  id: string
  runId: string
  stageKey: string | null
  kind: 'system' | 'message' | 'question' | 'answer'
  actor: 'system' | 'agent' | 'user'
  text: string                  // resolved display text, never empty
  createdAt: string             // ISO
  promptId?: string             // present iff kind === 'question'
  answerTo?: string             // promptId answered by this entry; present iff kind === 'answer'
}
```

Invariants:
1. `kind === 'question'` iff `promptId` is present.
2. `kind === 'answer'` iff `answerTo` is present.
3. `text` is non-empty after trim.
4. Ordering within a `runId` is by `createdAt` ascending; ties broken by `id`.

Not present (intentionally): `requiresResponse`, `status`, `source`, `meta`, `actor=reviewer`, `kind=review_note|blocker|resolution`. Add only when a concrete UI surface needs them.

### OpenPrompt (convenience, derived)

```ts
{
  promptId: string
  runId: string
  stageKey: string | null
  text: string
  createdAt: string
}
```

Computed as: last `question` entry in `entries` with no matching `answer` (i.e. no later entry with `answerTo === this.promptId`). `null` if none.

### AnswerRequest

```ts
{
  promptId: string
  answer: string     // non-empty after trim
}
```

No `client.surface` / `client.channel`. If audit is needed, log the HTTP source server-side.

### MessageEntry

```ts
{
  id: string                 // stable cursor; alias of stage_logs.id
  ts: string                 // ISO
  runId: string
  stageRunId: string | null
  type: CanonicalMessageType // see spec/messaging-levels.md §5
  level: 0 | 1 | 2
  force: boolean             // true → delivered regardless of subscribed level
  payload: Record<string, unknown>  // event-shape-specific; mirrors WorkflowEvent
}
```

### Error body

```ts
{ error: string, code?: string }
```

---

## Clients

### CLI

The CLI calls engine services **in-process** for local mode; the contract above is what a remote-mode CLI would consume. Either way the data shapes are identical.

Local-only commands (outside this contract): `workspace use`, compact rendering.

### UI

No UI ships today (`apps/ui` was removed 2026-04-24 ahead of a rebuild — see
`specs/ui-rebuild-plan.md`). Any future UI is one HTTP client among many and
gets no privileged access; the machine-readable contract lives at
`GET /openapi.json`.

### Chattool webhooks

Inbound provider webhooks (currently only Telegram) hit
`POST /webhooks/:channel`, authenticate with a channel-specific secret
header, and map provider payloads to `(runId, promptId)` before calling the
same service that backs `POST /runs/:id/answer`.

---

## Audit — UI teardown, Step 1 (2026-04-24)

Companion to `specs/ui-rebuild-plan.md` §Steps.1. Captures the actual engine
surface the current `apps/ui` consumes before the UI is deleted, so the next
UI has a real baseline and the contract doesn't silently shed behavior.

Scope of the audit: `apps/ui/app/api/**` (proxy layer that the browser hits)
and `apps/ui/lib/api.ts` (both the browser-side helpers and the handful of
Server-Component SSR calls). Greps used: `fetch(`, `EventSource(`, and every
string referencing an engine path. All findings below refer to the engine
(backend) surface, not the Next.js `/api/*` facade.

### What the UI actually calls over HTTP

Via the Next.js proxy layer (`apps/ui/app/api/**` → `forwardToEngine`):

| Engine route | Method | Proxy route |
|---|---|---|
| `/events` | GET (SSE) | `apps/ui/app/api/events/route.ts` |
| `/items/:id/actions/:action` | POST | `apps/ui/app/api/items/[id]/actions/[action]/route.ts` |
| `/notifications/deliveries` | GET | `apps/ui/app/api/notifications/deliveries/route.ts` *(proxy exists but unused — see below)* |
| `/notifications/test/:channel` | POST | `apps/ui/app/api/notifications/test/[channel]/route.ts` |
| `/runs` | POST | `apps/ui/app/api/runs/route.ts` |
| `/runs/:id` | GET | `apps/ui/app/api/runs/[id]/route.ts` |
| `/runs/:id/answer` | POST | `apps/ui/app/api/runs/[id]/answer/route.ts` |
| `/runs/:id/conversation` | GET | `apps/ui/app/api/runs/[id]/conversation/route.ts` |
| `/runs/:id/events` | GET (SSE) | `apps/ui/app/api/runs/[id]/events/route.ts` |
| `/runs/:id/messages` | GET, POST | `apps/ui/app/api/runs/[id]/messages/route.ts` |
| `/runs/:id/recovery` | GET | `apps/ui/app/api/runs/[id]/recovery/route.ts` |
| `/runs/:id/resume` | POST | `apps/ui/app/api/runs/[id]/resume/route.ts` |
| `/runs/:id/tree` | GET | `apps/ui/app/api/runs/[id]/tree/route.ts` |
| `/workspaces` | POST | `apps/ui/app/api/workspaces/route.ts` *(POST only — no GET proxy)* |
| `/workspaces/preview` | GET | `apps/ui/app/api/workspaces/preview/route.ts` |

Directly from Server Components (SSR, bypassing the Next proxy via
`${ENGINE_BASE_URL}`):

| Engine route | Method | Caller |
|---|---|---|
| `/runs` | GET | `apps/ui/lib/api.ts:listRuns` ← `app/runs/page.tsx` |
| `/setup/status` | GET | `apps/ui/lib/api.ts:getSetupStatus` ← `app/settings/page.tsx`, `app/setup/page.tsx` |
| `/notifications/deliveries` | GET | `apps/ui/lib/api.ts:getNotificationDeliveries` ← `app/settings/page.tsx` |

Note: the proxy at `app/api/notifications/deliveries/route.ts` exists but no
UI code calls it — all reads go through the SSR helper directly. Also no GET
proxy for `/workspaces`, `/workspaces/:key`, `/workspaces/:key/open`, or
`DELETE /workspaces/:key` exists in the proxy layer.

### UI ↔ engine coupling not routed through HTTP

`apps/ui/lib/live-board.ts`, `live-inbox.ts`, and related server modules open
the engine's SQLite file directly (read-only) via `better-sqlite3` and query:

- `workspaces`, `items`, `runs`, `stage_runs`, `stage_logs`, `pending_prompts`, `projects`

This is a layering violation (the UI reaches past the API into engine
internals). It means the current UI does not need HTTP for:

- Listing workspaces
- Listing items / board view data
- Listing pending prompts
- Resolving the active workspace

These read-paths **die with the UI** — the next UI must not open the engine
DB. They are therefore **implicit contract gaps**: read endpoints the UI has
been substituting for via a side-channel. See "Gaps for the next UI" below.

### Endpoints listed in `specs/ui-rebuild-plan.md` §Steps.1 that the UI does NOT use over HTTP

The plan enumerates these as "actual route shapes the UI uses today"; the
audit shows they are not hit by the browser or by SSR code:

- `GET /workspaces` — substituted by direct SQLite read.
- `GET /workspaces/:key` — not called anywhere in `apps/ui`.
- `POST /workspaces/:key/open` — not called anywhere in `apps/ui`.
- `DELETE /workspaces/:key` — not called anywhere in `apps/ui`.

These routes **do exist on the engine** (`apps/engine/src/api/server.ts:137-143`,
routes in `apps/engine/src/api/routes/workspaces.ts`). They are reachable but
unused by the current UI. The contract keeps them because CLI / future-UI /
webhook clients will need them; they just aren't part of the
"don't silently lose this" UI baseline.

### Discrepancies resolved alongside the teardown

The audit originally flagged four contract bugs. All fixed in the same
teardown commit:

1. ~~`/workspaces/preview` shape.~~ Contract now documents the
   `GET /workspaces/preview?path=<abs path>` filesystem-preflight shape
   matching the engine. The OpenAPI spec is authoritative for field shape
   (`WorkspacePreview`).
2. ~~Duplicate `/events` section.~~ Collapsed.
3. ~~Stale "Needs adding" migration list.~~ Removed — every listed
   endpoint is already implemented.
4. ~~Dead deprecation notes for `POST /runs/:id/input` /
   `GET /runs/:id/prompts`.~~ Removed.

### Gaps for the next UI (read endpoints currently served via SQLite side-channel)

If the new UI must not open `~/.local/state/beerengineer/*.sqlite` directly
(and it shouldn't — that's the whole point of the teardown), the API needs:

- **Workspaces list.** `GET /workspaces` exists and suffices.
- **Items list / board view.** `GET /items?workspace=…` exists; the board
  today additionally needs joined fields (`pending_prompts` counts, recovery
  flags, stage runs) that `live-board.ts` assembles client-side. Either the
  items endpoint grows richer response payloads, or a dedicated board endpoint
  lands. Explicitly out of scope for this teardown — flagged as a follow-up
  contract task. (See `specs/ui-rebuild-plan.md` Open Question 2.)
- **Inbox / pending prompts view.** Same story as board. No HTTP equivalent
  today. Flagged as a follow-up.
- **Setup / doctor projection.** `GET /setup/status` covers this; no gap.

These are the items that should move into a future "contract additions"
PR — not as part of UI removal, per the plan's Drift Mitigation note.

### Browser-side conveniences that die with `apps/ui`

Per the plan, "browser-side conveniences that exist only in `apps/ui` should
die with the UI unless we explicitly want to preserve them." Items in this
category discovered during the audit:

- **CSRF token sourcing from `~/.local/state/beerengineer/api.token`** in
  `apps/ui/app/api/_lib/engine.ts`. This is a UI-side convenience for
  injecting the engine's token header; the mechanism itself (token file,
  `x-beerengineer-token` header) is engine-owned and stays. The file reader
  is UI-local and goes away with the UI.
- **Direct-SQLite live views** in `apps/ui/lib/live-*.ts`. Dies with the UI.
  Any functionality we still want lives as a future HTTP read endpoint, not
  as a recreated SQLite client in the new UI.
- **Legacy view-model shims / mock fallbacks** (`apps/ui/lib/mock-legacy-data.ts`,
  `lib/view-models.ts`). Purely presentation. Dies with the UI.

None of the above are contract obligations.
