# Telegram Connector — Refactor Plan

Follow-on to `spec/architecture.md` + `spec/api-contract.md`. The conversation/API refactor introduced three capabilities the Telegram connector does not yet use:

1. `GET /runs/:id/conversation` — canonical transcript with resolved `openPrompt.text`.
2. `POST /runs/:id/answer` — single write path; `recordAnswer({ source })` is transport-agnostic.
3. `POST /items/:id/actions/:action` — explicit action routes, safe for bot callbacks.

Supersedes the outbound-only constraint from `spec/telegram-notifications-plan.md` **only** for reply-driven answers. Everything else the old plan forbade (second orchestration path, workflow control outside the engine) stays forbidden.

---

## 1. Problem

Today the connector is outbound-only, event-summary driven:

- Subscribes to `run_started | run_blocked | run_finished | stage_completed`.
- Builds a three-to-five-line text, sends via `sendTelegramMessage`.
- Dedup via `notification_deliveries.dedup_key`.
- No `openPrompt` context — a blocked run's message says "Summary: X" but not the actual question the run is waiting on.
- No reply path — operator must switch to the UI or CLI to answer.
- No action affordances — resume / mark-done always routes through a different surface.

Result: the notification tells you "something needs attention", then you context-switch. For a tool whose main operator UX is "come to the chat when needed", this is a high-friction loop.

## 2. Target

1. Outbound messages that require operator input carry the **resolved prompt text** (from `conversation.openPrompt.text`) — so the operator can see the question in Telegram without opening the UI.
2. Replies to an outbound message in Telegram map 1:1 to a `(runId, promptId)` and call `recordAnswer({ source: "webhook" })`. No channel-binding CRUD, no intents layer — one reply, one write.
3. Optional inline-keyboard buttons on `run_blocked` messages: `Open in UI`, `Mark reviewed` (future — gated on whether it survives v1 usage).
4. Dedup and audit stay in `notification_deliveries`; we add exactly what's needed to map inbound replies to runs — no new parallel table.

Non-goals:
- No channel-binding model (`telegram_bindings`, `chat_ids` per workspace, etc.). One chat per deployment, as today.
- No Slack/Teams/Discord. If they come later, they bind to the same `recordAnswer` path.
- No outbound from arbitrary events. Only the four already-supported types, plus one new one (`prompt_requested` at `requiresResponse`).
- No full conversation mirroring in Telegram. The UI stays the primary transcript view; Telegram is for "when action is needed".

## 3. Layering

```
Engine Bus                                     attaches the dispatcher
  └─ TelegramNotificationDispatcher ───→  sendTelegramMessage (Telegram API)
                                          ↑
                                          │  stores message_id + run_id + prompt_id
                                          │  in notification_deliveries
                                          ↓
Telegram webhook  ──→  /webhooks/telegram ──→ recordAnswer({ source: "webhook" })
                                               └─ same code path as CLI/UI answers
```

Rule: the Telegram webhook route does exactly two things — map the reply to a `(runId, promptId)` via `notification_deliveries`, then call `recordAnswer`. No orchestration, no workflow re-entry logic, no prompt persistence writes of its own.

## 4. Phase A — Enrich outbound with `openPrompt`

**Done when:** a `run_blocked` notification and any "awaiting answer" notification includes the resolved prompt text; legacy dedup continues to work; no inbound yet.

Changes:
- Extend `SupportedTelegramEvent` to include `prompt_requested` (only when `requiresResponse` or when the run's status transitions to `needs_answer` — pick one consistent trigger to avoid spam).
- In `buildMessage`, for `run_blocked` and `prompt_requested`, call `buildConversation(repos, runId)` and append the `openPrompt.text` (truncated to one sentence if needed).
- Message footer stays `Open: ${runLink}`. Add a second line: `Reply to answer`.
- Persist the Telegram `message_id` returned by the send call onto `notification_deliveries` so Phase B can look it up.

DB migration:
- `notification_deliveries.telegram_message_id INTEGER` (nullable).
- `notification_deliveries.run_id TEXT` (nullable — already derivable from `dedup_key`, but store explicit for indexing).
- `notification_deliveries.prompt_id TEXT` (nullable — only set for prompt-carrying messages).

Rate-limit guard: a run that asks many questions in a row should not send one Telegram message per question. Minimum gap of N seconds per `(runId, "prompt_requested")` — reuse the dedup pattern, but expire the dedup row after N seconds so subsequent prompts re-notify.

## 5. Phase B — Inbound replies via webhook

**Done when:** replying to a BeerEngineer Telegram message with text closes the matching open prompt; replies to non-prompt messages are ignored with a soft acknowledgement; the CI guardrail `rg -n 'recordAnswer' apps/engine/src/notifications` returns exactly one hit (the webhook handler).

New route: `POST /webhooks/telegram` (engine HTTP).
- Accepts the standard Telegram `Update` body.
- Validates `secret_token` header against a new `BEERENGINEER_TELEGRAM_WEBHOOK_SECRET` env var (Telegram's own auth mechanism — no new auth code).
- Resolves the target prompt:
  1. `update.message.reply_to_message.message_id` → look up `notification_deliveries.telegram_message_id` → `(run_id, prompt_id)`.
  2. If no reply-to, try `(update.message.chat_id, last open prompt for that chat)` — only if the deployment has exactly one configured chat.
  3. Otherwise: send a one-line help message back ("Reply to a BeerEngineer prompt to answer it."). Do not invent prompt ids from message text.
- Call `recordAnswer(repos, { runId, promptId, answer: update.message.text, source: "webhook" })`.
- On result:
  - `ok: true` → send 👍 reaction to the original message (or a compact "answered" confirmation).
  - `prompt_not_open` / `prompt_mismatch` → reply "that prompt was already answered" (idempotent UX).
  - `empty_answer` / `run_not_found` → reply with the specific reason.

Security posture:
- Webhook endpoint is `POST`-only, requires the Telegram secret token.
- Rate-limited to N writes/minute per chat (shared memory limiter — not persisted).
- Does not accept commands like `/resume` in this phase. Only free-text replies. Commands are Phase C.

Operational setup:
- Extend `beerengineer setup` to register the webhook URL with Telegram (`setWebhook` Bot API call) if the operator confirms. Skipped if `publicBaseUrl` is not HTTPS-reachable from the public internet.
- If the operator runs local-only, Phase B degrades: outbound still works (Phase A), webhook route returns 200 but gets no traffic.

## 6. Phase C — Inline-keyboard actions (optional, deferred)

**Done when:** the operator has used Phase B for two weeks and there is evidence that a specific action (resume, mark-done) would save enough context switches to justify the UX surface. Only then, and only for that one action.

Out-of-scope until that evidence exists. Keeps us from building a button rack nobody taps.

Sketch (do not implement speculatively):
- `reply_markup.inline_keyboard` on `run_blocked` messages → `[Resume]`, `[Open in UI]`.
- New route `POST /webhooks/telegram/callback` consumes `callback_query`.
- Resume callback → forward to `POST /runs/:id/resume` with a synthetic remediation summary `"Resumed via Telegram by ${from.username}"` — or prompt for a summary via force-reply before firing.

## 7. Migration path

Phase A and Phase B are independently shippable:
- Ship Phase A first. Operators notice that blocked/waiting messages now include the question — no behavior change required of them.
- Ship Phase B behind a config flag `notifications.telegram.inbound.enabled` (default `false`). Flip on per deployment.

No grace period on the old outbound format is needed — the added `openPrompt` line is additive; existing downstream consumers (just the operator) see a strictly-more-informative message.

## 8. Guardrails

- `rg -n 'recordAnswer' apps/engine/src/notifications` ≤ 1 match (webhook handler only).
- No direct writes to `pending_prompts` from anything under `apps/engine/src/notifications/`.
- The webhook handler must not import from `../core/runOrchestrator`, `../core/runService`, or `../workflow`. It only imports `core/conversation.recordAnswer` and `db/repositories`. A lint rule in CI catches new imports.
- Outbound messages truncated via `truncateForTelegram` already; Phase A just adds a new input, same guarantees.

## 9. Open questions (decide before Phase B merges)

- Which event triggers the "you need to answer" Telegram message — `prompt_requested` with `requiresResponse: true`, or a lifted status on the run (`needs_answer`) that could be debounced? Prefer the latter so rapid in-stage back-and-forth doesn't spam.
- Should the webhook auto-register on `beerengineer setup`, or require a separate `beerengineer notifications telegram register-webhook` command? Separate command is safer (explicit network side effect), auto-register is nicer. Pick one and document the other as not-a-mistake.
- If a run is blocked while no one is watching Telegram, and the block clears via the UI, should we send a "cleared" follow-up? Default: no. Dedup key expires on terminal run state and we move on.

## 10. Out of scope for this plan

- Slack / Teams / Discord adapters. When they happen, they bind to `recordAnswer({ source })` the same way.
- Channel-binding CRUD (`/notifications/channels`, per-workspace Telegram chat mapping).
- Intents layer, multi-platform routing, chat history mirroring.
- Proactive summaries ("overnight run X completed all 9 stages").

If any of those three become a real ask, they get their own plan file. This one stays scoped to making the existing connector leverage the new `/conversation` + `/answer` surfaces.
