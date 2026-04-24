# Messaging Levels — Spec

Follow-on to `spec/architecture.md`, `spec/api-contract.md`, `spec/telegram-refactor.md`, `spec/cli-navigation-and-harness-ux-plan.md`. Defines a tiered verbosity model over the existing `WorkflowEvent` bus so CLI, API, and chat connectors can each subscribe to the granularity that fits their channel.

This revision intentionally tightens the architecture around **one canonical message projection**. The engine bus remains the write-time source of truth, and `stage_logs` remains the persisted event store, but every read-side consumer in this plan (SSE, history, CLI, chattool adapters, future UI) goes through the same `MessageEntry` projection instead of each consumer re-deriving its own event semantics.

Scope of this plan:
- CLI + API. UI is **out of scope** for now — but the data shapes below are what a future UI would consume unchanged.
- Generic chattool adapter surface (Telegram today, Slack/Teams/Discord later). Existing `notifications/telegram*` gets extracted behind an interface; no new providers are built here.

Non-goals:
- No new persistence layer. `stage_logs` remains the canonical event store.
- No rewrite of `WorkflowEvent`. Levels are added as metadata, not as a new event taxonomy.
- No intents layer, no channel-binding CRUD, no multi-chat-per-deployment routing. Those stay out until a real ask exists.

---

## 1. Mental model

Three cumulative verbosity levels. To avoid ambiguity, the levels are defined by an explicit **detail rank**:

- `L2` = lowest detail (`detailRank = 2`)
- `L1` = medium detail (`detailRank = 1`)
- `L0` = highest detail (`detailRank = 0`)

A subscriber configured for level `N` receives every event whose `detailRank >= N`. In concrete terms:

- `L2` subscribers receive only `L2`
- `L1` subscribers receive `L1 + L2`
- `L0` subscribers receive `L0 + L1 + L2`

| Level | Intent | Typical consumer |
|---|---|---|
| **L2 — Milestones** | What a stakeholder needs to know: run started, phase crossed, needs answer, done, failed. No per-iteration noise. | Chattool (Telegram/Slack), `runs ls`, `runs show`, CLI summary on exit, future UI board view. |
| **L1 — Operational** | What an operator watching live needs: L2 + tool-call *names*, loop iterations, final agent messages, user messages. Readable in a terminal. | CLI `runs tail` default, future UI run-detail default view. |
| **L0 — Debug** | Everything: L1 + LLM thinking/reasoning, full tool args/results, raw tokens, low-level logs. | CLI `runs tail -vv`, future UI drill-down, forensic analysis. |

Invariants:
- Levels are **cumulative** (L2 ⊂ L1 ⊂ L0).
- Errors (`run_failed`, `stage_completed` with `status="failed"`, any `run_blocked`) are **force-through**: they are delivered to every subscriber regardless of subscribed level. Rationale: a run must never "die silently" for a stakeholder watching at L2.
- The level is an attribute of each event, assigned by a **single classifier function** in `core/` or a sibling. Producers do not annotate level at emit-time — this keeps existing call sites untouched.
- The classifier is a read-side concern. Producers emit `WorkflowEvent`; consumers subscribe to projected `MessageEntry`.

## 2. Event → level mapping

Applied to the existing `WorkflowEvent` union (`apps/engine/src/core/io.ts`):

| `WorkflowEvent.type` | Level | Notes |
|---|---|---|
| `run_started` | L2 | |
| `run_finished` | L2 | |
| `run_blocked` | L2 (force) | Always delivered. |
| `run_failed` | L2 (force) | Always delivered. |
| `run_resumed` | L2 | |
| `external_remediation_recorded` | L2 | |
| `stage_started` | L1 | Phase boundaries exist at L2 via `stage_completed`; `stage_started` is operational. |
| `stage_completed` — status completed | L2 | |
| `stage_completed` — status failed | L2 (force) | |
| `prompt_requested` | L2 | Blocks the run → stakeholder-relevant. |
| `prompt_answered` | L1 | The answer itself is operational detail; L2 subscribers see the lifted block via `prompt_requested` → next phase. |
| `chat_message` — role agent, final-facing | L1 | Final-facing = last message before a prompt / run end. Same heuristic `telegramWebhook` already uses. |
| `chat_message` — intermediate / tool chatter | L0 | |
| `item_column_changed` | L1 | |
| `project_created` | L2 | |
| `artifact_written` | L0 | Full path / kind is debug-level; summary fact travels via `stage_completed`. |
| `log` — warn\|error | L1 | |
| `log` — info / debug | L0 | |
| `presentation` | L0 | Decorative, CLI-only. |

New synthetic events (added to `WorkflowEvent`, emitted from existing call sites, optional for L0/L1 consumers):

| Type | Level | Payload |
|---|---|---|
| `loop_iteration` | L1 | `{ runId, stageRunId, n, phase }` — emitted from the stage runtime where the inner loop tick already exists. |
| `tool_called` | L1 | `{ runId, stageRunId, name }` |
| `tool_result` | L0 | `{ runId, stageRunId, name, argsPreview, resultPreview }` — previews truncated to 2KB. |
| `llm_thinking` | L0 | `{ runId, stageRunId, text }` — only emitted when the LLM adapter is running a thinking-capable model; gated by config to avoid spam. |
| `llm_tokens` | L0 | `{ runId, in, out, model }` — one per LLM call. |

Adding these is opt-in: a producer that does not emit them simply yields an L0/L1 consumer with fewer rows. No schema break.

### Classifier

```ts
// apps/engine/src/core/messagingLevel.ts
export type MessagingLevel = 0 | 1 | 2
export type LevelInfo = { level: MessagingLevel; force: boolean }

export function levelOf(event: WorkflowEvent): LevelInfo { … }
```

Single pure function. One switch over `event.type`, with sub-discrimination for `stage_completed.status`, `log.level`, `chat_message.source + requiresResponse`. Unit-tested with a fixture of every known event type; new event types added to the union must update the switch (type-level exhaustiveness check).

## 3. Canonical message backbone

This plan adopts a single read-side backbone:

```
WorkflowEvent (bus emit)
      │
      ▼
stage_logs (persisted raw event rows)
      │
      ▼
MessageProjection
  - canonical message type
  - level / force
  - stable messageId cursor
  - normalized payload
      │
      ├── GET /runs/:id/messages
      ├── GET /runs/:id/events (SSE)
      ├── GET /events (workspace SSE)
      ├── CLI runs messages / tail / watch
      ├── chattool dispatchers
      └── future UI
```

Design rule: **no read-side consumer may classify raw `WorkflowEvent` or raw `stage_logs` independently once `MessageProjection` exists**. That means:

- SSE does not stream ad-hoc `stage_logs` rows anymore; it streams projected `MessageEntry`.
- chattool adapters do not subscribe directly to raw bus events for rendering decisions; they consume the same projected message stream as every other client.
- conversation remains a separate read model, but where it overlaps with generic messages it should reuse the same normalization rules rather than re-invent heuristics.

This is the main simplification in the plan: one projection, many consumers.

## 4. Delivery semantics

### Live streams (SSE / NDJSON)

Subscriber opts in via query param on the existing stream endpoint:

```
GET /runs/:id/events?level=2           # default 2
GET /runs/:id/events?level=1
GET /runs/:id/events?level=0
GET /runs/:id/events?level=1&since=<messageId>
```

- Filtering happens on projected `MessageEntry` objects before writing SSE frames. Force-through events always pass.
- `since=<messageId>` resumes from a given stable message cursor. This is a real cursor-model upgrade: today's tailing is `created_at`-based, but the messaging API will expose a stable logical cursor so harnesses do not bind to timestamp semantics.
- A new top-level endpoint for all runs mirrors the same query:

  ```
  GET /events?workspace=:key&level=2
  ```

### History (read-only, paginated)

A new synchronous endpoint for replay, backed by the same projection over `stage_logs`:

```
GET /runs/:id/messages?level=2&since=<id>&limit=200
```

Response:

```jsonc
{
  "runId": "run_…",
  "schema": "messages-v1",
  "nextSince": "msg_…",      // null when end reached
  "entries": [
    {
      "id": "msg_…",
      "ts": "2026-04-24T10:15:00Z",
      "runId": "run_…",
      "stageRunId": "sr_…",
      "type": "phase_completed",   // canonical label (see §5)
      "level": 2,
      "force": false,
      "payload": { … }             // event-shape-specific, mirrors WorkflowEvent
    }
  ]
}
```

Invariants:
- `entries` is ordered by the stable message cursor, ascending.
- `type` is the **canonical messaging label** (see §5), not the raw `WorkflowEvent.type`. Raw types are stable in `payload.rawType` for debugging.
- `schema: "messages-v1"` is the versioning knob; breaking changes bump to `v2`.

Why a new endpoint alongside `/runs/:id/events` (SSE): SSE is inherently stream-shaped; harnesses doing "fetch history, then tail" need a finite endpoint for the first half. This endpoint returns paginated finite data; the SSE endpoint returns the live tail. A client can do:

```
GET /runs/:id/messages?level=1&limit=500
  → paginate with nextSince until exhausted
GET /runs/:id/events?level=1&since=<last-id>
  → open SSE from that id
```

### Conversation vs messages

`GET /runs/:id/conversation` stays as-is (canonical chat transcript for the operator — message / question / answer entries only). `GET /runs/:id/messages` is the full event log with level filtering. Different concerns, different shapes; do not merge them.

## 5. Canonical message types

To insulate clients from incidental renames in `WorkflowEvent`, messages expose a small, stable vocabulary:

| `message.type` | Sourced from |
|---|---|
| `run_started` | `run_started` |
| `run_finished` | `run_finished` |
| `run_failed` | `run_failed` |
| `run_blocked` | `run_blocked` |
| `run_resumed` | `run_resumed` |
| `phase_started` | `stage_started` |
| `phase_completed` | `stage_completed` (status=completed) |
| `phase_failed` | `stage_completed` (status=failed) |
| `prompt_requested` | `prompt_requested` |
| `prompt_answered` | `prompt_answered` |
| `agent_message` | `chat_message` with role=agent/system |
| `user_message` | `chat_message` with role=user (source=cli/api/webhook) |
| `loop_iteration` | `loop_iteration` |
| `tool_called` | `tool_called` |
| `tool_result` | `tool_result` |
| `llm_thinking` | `llm_thinking` |
| `llm_tokens` | `llm_tokens` |
| `artifact_written` | `artifact_written` |
| `log` | `log` |

The projection is a single function in `core/messagingProjection.ts` that maps a `StageLogRow` to a `MessageEntry`. Live consumers may still observe a local `WorkflowEvent` before persistence, but externally visible payloads come from the same projection contract.

## 6. CLI shape

Builds on the navigation plan in `cli-navigation-and-harness-ux-plan.md`. New/extended commands below. All honour `--json`; NDJSON used for streams (one JSON object per line, no wrapping array, `\n`-terminated).

| Command | Behaviour |
|---|---|
| `beerengineer runs tail <runId> [--level L0\|L1\|L2] [--since <id>] [--json]` | NDJSON stream; default `--level L1`. Exits on `run_finished`/`run_failed` with exit code per §7. With `--since`, re-emits nothing older than the given id (resume). |
| `beerengineer runs messages <runId> [--level L0\|L1\|L2] [--since <id>] [--limit N] [--json]` | Finite history. Defaults: level L2, limit 200. Useful for "dump what happened". |
| `beerengineer runs watch <runId> [--level L1]` | History replay then live tail in one invocation — `messages` paginated to completion, then `tail` from the last id. Convenience wrapper. |
| `beerengineer chat send <runId> <text> [--json]` | Posts a free-form user message. Never answers a prompt implicitly. Returns the created message entry or updated conversation snapshot. |
| `beerengineer chat answer <runId> <text> [--prompt <id>] [--json]` | Canonical prompt-answer path. Calls `recordAnswer` (same path as `POST /runs/:id/answer`). If `--prompt` is omitted, targets the single open prompt for the run. |
| `beerengineer runs ls [--workspace <key>] [--status ...] [--json]` | Already planned; unchanged. |
| `beerengineer runs show <runId> [--json]` | Already planned; adds a `lastMessages` preview (top N at L2) in JSON. |

Agent-harness contract:
- `tail` is the **only** long-lived subscription a harness needs. It emits NDJSON, one event per line, and ends naturally when the run ends.
- `--since` makes `tail` re-entrant across disconnects. After a crash, the harness records the last stable `messageId` it consumed and restarts with `--since <id>` — no duplicates, no gaps.
- Exit codes (see §7) distinguish "run finished OK" from "run failed" from "CLI error", so a harness can `if cli runs tail $RUN; then …` without parsing output.
- `--json` flag is required in agent mode; human rendering is intentionally unstable (we may tune colours, prefixes, truncation).

## 7. API shape

Additive to `api-contract.md`:

```
GET /runs/:id/messages?level=&since=&limit=
GET /runs/:id/events?level=&since=          # existing SSE, add query params
GET /events?workspace=&level=               # existing SSE, add query param
POST /runs/:id/messages                      # post a user chat (does NOT answer a prompt)
   body: { text, source? }  → { ok: true, entry }
```

`POST /runs/:id/messages` is **only** for free-form chat into the run (think: side-channel hint mid-stage). It does **not** close prompts — for that, `POST /runs/:id/answer` remains the single write path. This mirrors Telegram/Slack semantics: most lines users type are not answers, they're notes.

Guardrail: the message projection and SSE filter live in `core/` and `api/sse/` only. Chattool adapters never reach into `stage_logs` or emit raw events; they consume projected `MessageEntry` values from the same read-side contract as every other client.

### Exit codes (CLI)

| Code | Meaning |
|---|---|
| 0 | Run finished OK |
| 10 | Run failed (captured in event) |
| 11 | Run blocked at terminal time (needs operator) |
| 20 | Bad CLI usage (missing args, bad flags) |
| 30 | Transport error (engine unreachable, auth failed) |

Stable across versions; agent harnesses can switch on them without parsing stderr.

## 8. Chattool adapter abstraction

Extracts today's `notifications/telegram*` into a provider-agnostic shape so Slack/Teams/Discord can be added without a second dispatcher.

Important architectural choice: chattool providers are **read-side adapters over canonical messages**, not privileged bus subscribers with their own event semantics.

### Layering

```
Engine Bus (WorkflowEvent)
      │
      ▼
stage_logs
      │
      ▼
MessageProjection
      │
      ▼
ChatToolDispatcher           ← one instance per active provider, subscribed at its own
      │                        configured level; canonical message filter,
      │                        correlationKey lifecycle, shared renderer
      ▼
ChatToolProvider (interface)
      │
      ├── providers/telegram.ts        ← today: send + sanitize + edit
      ├── providers/slack.ts           ← later, if needed
      └── providers/teams.ts           ← …

Inbound (parallel, per provider its own route):
POST /webhooks/telegram  ──►  providers/telegram.parseWebhook()  ──┐
POST /webhooks/slack     ──►  providers/slack.parseWebhook()    ──┤
                                                                  ▼
                                                     ChatToolInboundUpdate
                                                                  │
                                                                  ▼
                                            correlation lookup (notification_deliveries)
                                                                  │
                                                                  ▼
                                          recordAnswer({ source: "webhook" })
                                          or  POST /runs/:id/messages
```

Three properties of this layout:

1. **One dispatcher instance per active provider.** `attachChattools(...)` iterates enabled providers and attaches a projected-message consumer per provider. Telegram and Slack run in parallel, independent — each with its own `level` in config. If one provider fails, the others keep going.
2. **Outbound is unified, inbound is not.** Slack signs webhooks with `X-Slack-Signature`, Telegram with `secret_token`, Teams with JWT. Auth details stay **inside** each provider; there is no generic "webhook middleware". But **after** `parseWebhook()` they all converge on the same `ChatToolInboundUpdate` shape and the same single code path to `recordAnswer` / `POST /runs/:id/messages`.
3. **Reply correlation differs per provider, but uses one table.** Telegram: `reply_to_message.message_id`. Slack: `thread_ts` on outbound + inbound. Teams: its own correlation id. All of them map their value into `notification_deliveries` (one row per outbound with `channel`, `chatId`, `providerMessageId`, `runId`, `promptId`, `correlationKey`, `messageRole`). No second schema.

**Diamond point:** the dispatcher is the single place where the canonical message stream is filtered + rendered and then fans out to N providers. Adding a provider ≈ adding a file `providers/<name>.ts` + a webhook route + a config block. No change to the dispatcher, renderer, or `recordAnswer` path.

### Interface

```ts
// apps/engine/src/notifications/chattool/types.ts
export type ChatToolOutboundMessage = {
  channelRef: string            // provider-specific (chatId for Telegram, channel ID for Slack)
  text: string                  // rendered per level; producers hand over plain text
  correlationKey: string        // stable per (runId, canonicalType[, scope]) — enables idempotency / edits
  messageRole: "summary" | "prompt" | "event"
  linkback?: string             // deep link the user can click ("Open in UI" equivalent)
}

export type ChatToolOutboundResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string }

export type ChatToolInboundUpdate = {
  providerMessageId: string | null    // reply target, if any
  replyToProviderMessageId: string | null
  channelRef: string
  userHandle: string
  text: string
}

export interface ChatToolProvider {
  readonly id: "telegram" | "slack" | "teams" | "discord"
  send(message: ChatToolOutboundMessage): Promise<ChatToolOutboundResult>
  // Inbound is still HTTP-webhook-shaped; each provider has its own /webhooks/:id
  // route that parses its payload and produces a canonical ChatToolInboundUpdate.
  parseWebhook(req: IncomingMessage): Promise<ChatToolInboundUpdate | null>
}
```

### Dispatcher (level-aware)

```ts
// apps/engine/src/notifications/chattool/dispatcher.ts
export class ChatToolDispatcher {
  constructor(
    private readonly provider: ChatToolProvider,
    private readonly subscribedLevel: MessagingLevel,   // default L2
    private readonly repos: Repos,
  ) {}
  onMessage(entry: MessageEntry): Promise<ChatToolOutboundResult | null>
}
```

Rules:
- Consumes the canonical message stream, not raw `WorkflowEvent`.
- Filters by `entry.level`; force-through always passes.
- Renders a plain-text string via a shared renderer (`renderChatMessage(entry, provider.id)`). Provider-specific markup (Telegram HTML vs Slack mrkdwn) is the provider's concern, not the dispatcher's — the renderer hands over a neutral string + a small hint map (bold/italic/code spans), and each provider renders that hint map into its own flavour.
- Dedup / edit: the dispatcher uses `correlationKey` + `messageRole` to look up `notification_deliveries`. On a matching open summary row, the provider may `editMessage` (Telegram supports it, Slack does too); otherwise a new message is sent. This is what turns "phase transitions" into a live-updated single message instead of a chat flood.

### Telegram migration (inbound + outbound)

- Move `notifications/telegram.ts` send + sanitize into `notifications/chattool/providers/telegram.ts` implementing `ChatToolProvider`.
- Move `notifications/dispatcher.ts` logic into `chattool/dispatcher.ts`, dropping the Telegram-specific event switch: message text now comes from the shared renderer keyed on the canonical message type.
- `notifications/telegramWebhook.ts` becomes `chattool/webhooks/telegram.ts`; it parses the Telegram update into `ChatToolInboundUpdate` and calls a generic handler that maps `(channelRef, replyToProviderMessageId) → (runId, promptId)` via `notification_deliveries` and calls `recordAnswer({ source: "webhook" })`.
- `POST /webhooks/telegram` remains. Slack/Teams/Discord, if they happen, register at `POST /webhooks/slack` etc., each with its own signature-validation secret. No attempt to unify inbound webhook authentication — providers vary too much.

### Config shape

Extends the existing `notifications.telegram` config with a level knob, and is repeated per provider:

```yaml
notifications:
  telegram:
    enabled: true
    botTokenEnv: BEERENGINEER_TELEGRAM_BOT_TOKEN
    defaultChatId: "-1001234567890"
    level: 2                 # L2 default; rarely L1
  slack:                     # future
    enabled: false
    level: 2
```

Telegram's config remains backwards compatible (level defaults to 2).

Guardrails:
- `rg -n 'telegram' apps/engine/src/notifications/chattool/` → only matches in `providers/telegram.ts` and `webhooks/telegram.ts` after the extraction.
- `rg -n 'recordAnswer' apps/engine/src/notifications/` → exactly one hit (the shared inbound handler).
- No chattool provider may import from `core/runOrchestrator`, `core/runService`, `workflow`. Enforced by the existing import-rule lint.

## 9. Levels at the Telegram end

Re-states `telegram-refactor.md` §2 in the level vocabulary:

- Telegram subscribes at **L2**. Hard cap — no CLI flag or env var lifts it to L1. If an operator wants L1/L0 detail, they use the CLI or (later) the UI.
- Outbound per canonical type:

  | Type | Action |
  |---|---|
  | `run_started` | New message, record `providerMessageId` as the "run summary" anchor. |
  | `phase_completed` / `phase_failed` | **Edit** the run summary anchor in place (appending phase lines) — keeps the chat quiet. |
  | `run_blocked` / `prompt_requested` | **New** message with prompt text + "Reply to answer" footer. Captured for inbound routing. |
  | `run_finished` | Edit the run summary anchor to final status. |

- Inbound: unchanged from Phase B of `telegram-refactor.md`. Free-text reply → `recordAnswer`. Non-reply messages become `user_message` via `POST /runs/:id/messages` (so an operator can leave a note mid-run without targeting a specific prompt).

## 10. Phases

### Phase 0 — Canonical message projection (no user-visible change)

**Done when:** `core/messagingProjection.ts` maps `StageLogRow → MessageEntry`; every known `WorkflowEvent.type` has a canonical message mapping + level classification; the projection exposes a stable `messageId`; both are exported but unused by any route.

- Add `core/messagingLevel.ts` (classifier + canonical-type mapping).
- Add `core/messagingProjection.ts` (row → `MessageEntry`).
- Define stable cursor semantics (`messageId`) independent from raw timestamp polling.
- Unit tests: one fixture per event type, snapshotted to catch accidental level drift.

### Phase 1 — API: `/messages` + projected SSE

**Done when:** `GET /runs/:id/messages` returns paginated canonical messages; `GET /runs/:id/events?level=` streams projected messages with stable resume cursor; force-through errors always pass.

- Add route + handler + tests.
- Extend `tailStageLogs` consumer in `runStream.ts` with projection + level filter.
- Docs: update `api-contract.md` with the new endpoint and query param.

### Phase 2 — CLI: `runs tail`, `runs messages`, `runs watch`, `chat send`, `chat answer`

**Done when:** the five commands above exist with `--json` support; exit codes per §7; `--since` resume works end-to-end (test: disconnect mid-stream, restart, expect no duplicate ids).

- New command handlers under `apps/engine/src/index.ts` (or equivalent CLI surface).
- NDJSON writer utility shared with existing `renderers/ndjson.ts`.
- Integration test: harness-style script that runs `tail`, kills it, resumes, verifies contiguous id sequence.

### Phase 3 — Chattool provider extraction

**Done when:** Telegram is behind `ChatToolProvider`; `ChatToolDispatcher` consumes canonical messages at a configurable level (defaults to L2); no test behaviour changes; the new guardrail greps pass.

- Extract provider + webhook into `notifications/chattool/`.
- Shared renderer from canonical message type → neutral text + hints.
- Dispatcher consumes the canonical message stream via `MessageEntry` and `correlationKey`/`messageRole`-based dedup/edit.
- Config adds `notifications.telegram.level` (default 2).

### Phase 4 — Synthetic L1/L0 events (loop / tool / thinking / tokens)

**Done when:** the stage runtime emits `loop_iteration`, `tool_called`, `tool_result`, optionally `llm_thinking` and `llm_tokens`; consumers at L0 see them; L2 subscribers see nothing new.

- Additive emissions from the existing stage runtime. No API change — they're new `WorkflowEvent` union members, classified by §2.
- Gated by config: `engine.emit.llmThinking: false` by default (cost/noise).
- Redaction rule before merge: `llm_thinking`, tool args, and tool results must pass through an explicit redaction/truncation policy before being persisted into `stage_logs`.

### Phase 5 — (deferred) Slack provider

Not built as part of this plan. Surface is ready; adding Slack means: implement `ChatToolProvider`, add `POST /webhooks/slack`, add `notifications.slack.*` config. Nothing in dispatcher / renderer / recordAnswer path needs to change.

## 11. Open questions

1. **Run-summary edit vs fan-out in Telegram.** The "single anchor message, edited on phase transitions" style is quieter but loses phase-level history in the chat. Alternative: one message per phase, no edits. Decision before Phase 3 merges. Default assumption in this plan: **anchor + edit**, with a fallback to fan-out if edits start failing (Telegram rate-limits edits aggressively).
2. **`chat_message` final-vs-intermediate classification.** Current heuristic (`requiresResponse` or adjacent to a `prompt_requested`) catches most cases. Because conversation projection already contains folding heuristics, we should prefer one shared normalization rule rather than a second independent classifier. Decision before Phase 0 completes.
3. **Stable cursor implementation.** The API should expose `messageId`, not raw `stage_logs.id` or `created_at`. We still need to decide whether `messageId` is a direct alias over existing log ids in v1 or a new opaque cursor synthesized by the projection.
4. **Chattool inbound for providers without reply-to semantics** (Slack threads, Teams). The Telegram mapping uses `reply_to_message.message_id`. Slack needs `thread_ts` on the dispatched outbound message; Teams has its own. Each provider maps its concept into the same `notification_deliveries` lookup — no new table.

## 12. Out of scope

- Channel-binding CRUD, per-workspace routing, user-level subscriptions, do-not-disturb windows. If and when real operators ask for these, they get their own plan.
- Server-to-server audit log of who answered via which surface beyond what `recordAnswer({ source })` already records.
- Push to mobile outside chattools (email, web push, native app).
- A UI. This spec prepares the data shapes; the UI plan comes later and will consume `/messages` + `/events?level=` directly.
