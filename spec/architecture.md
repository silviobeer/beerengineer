# BeerEngineer — Architecture Plan

Scope: refactor CLI / UI / Engine so the Engine HTTP API is the single source of truth. Replaces the previous five-document plan (`cli-api-ui-refactoring-plan.md`, `conversation-model-plan.md`, `conversation-json-schema.md`, `chattool-integration-plan.md`, `engine-api-route-design.md`).

See `spec/api-contract.md` for routes and JSON schemas.

---

## 1. Problem

Today the UI is a **mixed client**:
- API client for reads (board, run detail, events).
- CLI launcher for execution (`POST /api/runs`, `POST /api/items/:id/actions/:action`, `POST /api/runs/:id/resume` all spawn `beerengineer …`).

Concrete spawn sites:
- `apps/ui/app/api/_lib/cli.ts` — `spawn(process.execPath, [ENGINE_BIN, …])`
- `apps/ui/app/api/runs/route.ts` — POST spawns `run --json`.
- `apps/ui/app/api/items/[id]/actions/[action]/route.ts` — forwards explicit item actions; older UI revisions spawned `start_brainstorm` / `start_implementation`.
- `apps/ui/app/api/runs/[id]/resume/route.ts` — spawns `run resume`.

Secondary problem: there is no canonical **conversation** view. Clients reconstruct chat from `chat_message` / `prompt_requested` / `prompt_answered` events, which makes `you >`-placeholders leak into UI and CLI.

## 2. Target

1. Engine API owns every domain read and every workflow intent.
2. UI Next.js routes become thin proxies (auth + forwarding) to the Engine API. No more `spawn`.
3. CLI calls shared services directly in-process (local mode) or the Engine API (remote mode) — same data shapes.
4. Run-scoped **conversation** is a first-class backend projection with a single shape used everywhere.

Non-goals for this refactor:
- No second ("simple") UI. Build one UI. Specialize later if real need emerges.
- No chattool abstraction (bindings, intents, multi-platform adapters). If Telegram inbound happens, it's one webhook route that calls `POST /runs/:id/answer`.

## 3. Layering

```
Engine Core (apps/engine/src/core)           ← orchestration, git, prompts, events
     │
Engine Services                              ← shared application layer used by BOTH:
     │                                          - Engine HTTP API (apps/engine/src/api)
     │                                          - CLI (apps/engine/src/index.ts)
     │
Engine HTTP API  ─────────────────┐
     │                            │
UI API proxy (Next.js) ──────→    │
     │                            ▼
Browser UI                       CLI, Chattool webhook, future clients
```

Rule: no client contains orchestration logic. No client parses CLI stdout as a control path.

## 4. Conversation Model (minimal)

A `ConversationEntry`:

```
id, runId, stageKey, kind, actor, text, createdAt,
promptId?      // only when kind=question
answerTo?      // only when kind=answer, points to the question entry's promptId
```

- `kind` ∈ `system | message | question | answer`
- `actor` ∈ `system | agent | user`
- `text` is always resolved display text (never a `you >` placeholder).

Derived, not stored:
- "open prompt" = last `question` entry without a matching `answer`.
- Entry "status" — derived from kind + presence of answer.

`GET /runs/:id/conversation` returns `{ runId, updatedAt, entries[] }` and a convenience `openPrompt` field computed from entries.

`POST /runs/:id/answer` is the single answer write; it returns the updated `ConversationResponse`. No delta/merge contract.

## 5. Migration — concrete file mapping

| Current (spawn) | Replacement |
|---|---|
| `apps/ui/app/api/runs/route.ts` POST → `spawnEngineCli(['run', '--json', …])` | Forward to `POST {engine}/runs` |
| `apps/ui/app/api/items/[id]/actions/[action]/route.ts` → CLI for `start_brainstorm` / `start_implementation` | Forward to `POST {engine}/items/:id/actions/:action` |
| `apps/ui/app/api/runs/[id]/resume/route.ts` → CLI for resume | Forward to `POST {engine}/runs/:id/resume` (already exists) |
| `apps/ui/app/api/_lib/cli.ts` | Delete once the three sites above no longer import it |

Engine-side additions:
| New engine route | Backed by |
|---|---|
| `POST /runs` | existing run-creation path (currently reached via CLI) extracted into a service |
| `POST /items/:id/actions/start_brainstorm`, `start_implementation` | existing item-action path extracted from CLI |
| `GET /runs/:id/conversation` | projection over existing `chat_message` / `prompt_requested` / `prompt_answered` events |
| `POST /runs/:id/answer` | wraps existing `POST /runs/:id/input`; `/input` is kept as compatibility alias for one release, then removed |

Everything already on the engine API stays (`GET /runs/:id`, `/tree`, `/recovery`, `/events`, workspace routes, notifications, setup).

## 6. Phases (with a hard done-signal each)

### Phase 1 — Conversation projection
**Done when:** `GET /runs/:id/conversation` returns the resolved transcript for every existing run; CLI transcript rendering uses it; `you >` no longer appears in any UI.

- Add `ConversationEntry` projection in engine services.
- Add `GET /runs/:id/conversation` route.
- Replace CLI transcript renderer to call the projection (local in-process) instead of stitching events.
- Replace UI run-detail conversation rendering.

### Phase 2 — Canonical answer write
**Done when:** every answer path (CLI, UI, future webhook) uses `POST /runs/:id/answer`; `/runs/:id/input` is an alias.

- Add `POST /runs/:id/answer`.
- Switch UI answer submit and CLI `chat answer` to it.
- Keep `/input` as thin alias.

### Phase 3 — Kill UI→CLI spawn
**Done when:** `apps/ui/app/api/_lib/cli.ts` is deleted; no `spawn` / `child_process` import remains in `apps/ui`.

- Extract existing CLI start/resume orchestration into engine services.
- Expose `POST /runs`, `POST /items/:id/actions/:action` (already scaffolded under `apps/engine/src/api/routes/items.ts`), ensure `POST /runs/:id/resume` covers UI's needs.
- Rewrite the three UI routes to forward to the Engine API.
- Delete `cli.ts`.

### Phase 4 — Cleanup
**Done when:** route set matches `api-contract.md` exactly; `/runs/:id/input` removed; docs updated.

- Remove `/input` alias.
- Delete dead code left over from Phase 3.
- One-pass README/`docs/TECHNICAL.md` update.

## 7. Scope that stays out

Deferred until they have real users / real usage:
- Dual Simple-UI / Pro-UI split.
- Chattool channel-binding model, intents layer, Slack/Teams adapters.
- Global `GET /status --all`, workspace-scoped `chats` endpoint — if `GET /runs?status=needs_answer` is enough, we don't need a second endpoint.
- Artifact-by-id routes.
- `POST /runs/:id/cancel`.

## 8. Guardrails (only what's enforceable)

- **Grep-check in CI:** `rg -n 'spawn|child_process' apps/ui/app/api/` must return zero matches after Phase 3.
- **Grep-check in CI:** `rg -n 'you\s*>' apps/ui apps/engine/src/index.ts` must return zero matches in user-facing render paths after Phase 1.
- **One answer route:** linter-allowed list of mutation endpoints in the Engine API; PRs adding new answer-like endpoints are rejected.

Prosa-only guardrails from the old plan are dropped.
