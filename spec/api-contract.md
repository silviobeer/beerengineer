# Engine API Contract

Target shape for `apps/engine/src/api`. Companion to `spec/architecture.md`.

The Engine API is the canonical surface for all clients (UI, CLI, future webhooks). CLI-local ergonomics (`workspace use`, `item open`, `run open`, terminal rendering) are not part of this contract.

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
- `DELETE /workspaces/:key`
- `GET /workspaces/:key/preview`

Workspace status (counts, latest run) is returned as part of `GET /workspaces/:key`. No separate `/status` endpoint.

### Items

- `GET /items?workspace=:key&status=&column=&limit=&cursor=`
- `GET /items/:id`
- `POST /items/:id/actions/:action`
  - `:action` ∈ `start_brainstorm | start_implementation | promote_to_requirements | mark_done`
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
No `POST /runs/:id/input` in the target contract (kept as deprecated alias during Phase 2, removed in Phase 4).

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

No channel-binding CRUD. No inbound webhook routes in this contract — added when and if real bidirectional chat ships (see `architecture.md` §7).

### Events

- `GET /events?workspace=:key` (SSE)
- `GET /runs/:id/events` (SSE)

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

## Client → route mapping

### UI (Next.js)

UI API routes forward 1:1 to Engine API. No orchestration logic.

| UI route (Next.js) | Engine call |
|---|---|
| `GET /api/workspaces` | `GET /workspaces` |
| `GET /api/runs` | `GET /runs?workspace=…` |
| `GET /api/runs/:id` | `GET /runs/:id` |
| `GET /api/runs/:id/conversation` | `GET /runs/:id/conversation` |
| `GET /api/runs/:id/messages` | `GET /runs/:id/messages` |
| `POST /api/runs/:id/messages` | `POST /runs/:id/messages` |
| `POST /api/runs/:id/answer` | `POST /runs/:id/answer` |
| `POST /api/runs` | `POST /runs` |
| `POST /api/runs/:id/resume` | `POST /runs/:id/resume` |
| `POST /api/items/:id/actions/:action` | `POST /items/:id/actions/:action` |
| `GET /api/runs/:id/events` (SSE) | `GET /runs/:id/events` (proxied) |
| `GET /api/events` (SSE) | `GET /events` (proxied) |

### CLI

CLI calls engine services **in-process** for local mode; the contract above is what remote-mode CLI would consume. Either way the data shapes are identical.

Local-only commands (outside this contract): `workspace use`, `item open`, `run open`, compact rendering.

### Future chattool webhook (out of scope for this refactor)

One route, one shape: receive provider payload, map to a known `(runId, promptId)`, call the same service that backs `POST /runs/:id/answer`.

---

## Migration from current routes

Already matches the target:
- `GET /runs/:id`, `/runs/:id/tree`, `/runs/:id/recovery`, `/runs/:id/events`, `/events`
- Workspace CRUD routes (in `apps/engine/src/api/routes/workspaces.ts`)
- `POST /runs/:id/resume`, `POST /items/:id/actions/:action` (scaffolded in `apps/engine/src/api/routes/items.ts`)
- Notifications test + deliveries

Needs adding:
- `GET /runs/:id/conversation`
- `POST /runs/:id/answer`
- `POST /runs` (create-run as engine intent, replacing UI's CLI spawn)

Needs replacing/removing:
- `POST /runs/:id/input` → deprecated alias for `/answer`, removed in Phase 4.
- `GET /runs/:id/prompts` → removed once `/conversation` covers the same need.
