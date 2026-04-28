# Engine — Features

**Last updated:** 2026-04-27
**Scope:** `@beerengineer/engine` — the CLI + HTTP/SSE service that drives
AI coding assistants through a structured product-development pipeline.

The engine is the product. The UI (`apps/ui`) is one optional consumer of
its API; the CLI is the other. Everything below ships today.

---

## Stage pipeline

`src/stages/` + `src/workflow.ts` + `prompts/{system,reviewers,workers}/`

The default workflow walks an item through the design-prep and project stages,
then stops at an item-level promotion gate:

`brainstorm → visual-companion → frontend-design → requirements →
architecture → planning → execution → project-review → qa → documentation →
handoff → merge-gate`

- Each stage has a worker prompt, a reviewer prompt, and a system prompt.
- Stage runtimes wrap calls in `withStageLifecycle` which emits canonical
  `phase_started` / `phase_completed` / `phase_failed` events.
- Stage execution is **registry-driven** — see
  [`engine-architecture.md`](./engine-architecture.md) for adding a stage.
- Two design-prep stages (`visual-companion`, `frontend-design`) are
  manually triggered by item actions; everything else auto-chains.
- `handoff` is still per-project project→item consolidation; `merge-gate`
  is the item-level operator pause before item→base merge.

## Run orchestration

`src/core/runOrchestrator.ts` + `src/core/runService.ts`

- One **run** = one execution of the workflow against one item.
- Per-workspace git worktrees: each run lives on its own branch, merges
  back via PR. Real git is mandatory; there's no simulated mode.
- **Authoritative-run rule**: a run only writes item state when it is
  the sole live run for that item. Sibling runs go silent.
- Recovery on restart: orphan runs are auto-marked failed with a
  resume-ready payload.
- Managed item/story worktrees receive preview ports and can be launched via
  `preview.command` in `.beerengineer/workspace.json` or a root
  `package.json` `scripts.dev` fallback.

## CLI

`src/index.ts` + `bin/`

```bash
beerengineer                       # default workflow (will prompt for an idea)
beerengineer status [--all]        # workspace overview
beerengineer items [--all]         # list items
beerengineer chats [--all]         # open prompts waiting for an answer
beerengineer chat answer <runId> "<text>"
beerengineer runs watch <runId>    # live event stream
beerengineer runs tail <runId> [--level 0|1|2]
beerengineer item action --item <id> --action <name>
beerengineer doctor                # health check
beerengineer setup                 # interactive setup
beerengineer start ui              # launch the optional Next.js UI
```

CLI subcommands route through the same item-action transition table the
HTTP API uses, so a CLI-driven action is indistinguishable from an
API-driven one.

## HTTP / SSE API

`src/api/`, OpenAPI at `src/api/openapi.json` (also served at `GET /openapi.json`)

- Listens on `127.0.0.1:4100` by default. Token auth via
  `x-beerengineer-token` (CSRF) loaded from
  `$XDG_STATE_HOME/beerengineer/api.token`.
- Endpoints: `/workspaces`, `/board`, `/runs`, `/items`,
  `/runs/:id/{events,messages,conversation,answer}`, `/items/:id/actions/:action`, `/events`.
- SSE channels:
  - **Workspace-scoped** at `/events?workspace=:key&level=N` — every event
    for every run in that workspace.
  - **Run-scoped** at `/runs/:id/events?level=N` — events for one run.
- Messaging-level filter: `?level=N` returns events with `entry.level >= N`.
  See [`docs/messaging-levels.md`](../../../docs/messaging-levels.md).

## LLM dispatch — harness × runtime matrix

`src/llm/` + `src/core/llmConfig.ts` + presets in `src/llm/presets/`

Two orthogonal axes:

| Harness | Runtime | What it means |
|---|---|---|
| `claude` | `cli` | Spawn the `claude` CLI per turn. Subscription-billed. |
| `claude` | `sdk` | In-process via `@anthropic-ai/claude-agent-sdk`. Per-token billed. |
| `codex` | `cli` | Spawn the `codex` CLI per turn. Subscription-billed. |
| `codex` | `sdk` | In-process via `@openai/codex-sdk`. Per-token billed. |
| `opencode` | `cli` | Spawn the OpenCode CLI per turn. |

Five real adapters ship today. Profiles bind harness/runtime per role
(coder / reviewer / merge-resolver). `self` mode mixes per role. Doctor
refuses to start a workspace whose profile selects an SDK runtime
without the matching env key (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`).

## Messaging levels (L0 / L1 / L2)

`src/core/messagingLevel.ts` + `src/core/messagingProjection.ts`

- **L0** — full debug (`tool_result`, `llm_thinking`, `llm_tokens`).
- **L1** — milestones + operational detail (`phase_started`,
  `prompt_answered`, `agent_message`, `user_message`,
  `loop_iteration`, `tool_called`, `item_column_changed`, …). Default
  for `runs tail` and the UI workspace stream.
- **L2** — milestones only (`run_started`, `prompt_requested`, …).

## Persistence

`src/db/`

- SQLite + WAL via `better-sqlite3`. Schema in `src/db/schema.sql`.
- Idempotent `ALTER TABLE` migrations in `src/db/connection.ts` —
  no separate migration files.
- Tables: `workspaces`, `items`, `runs`, `events`, `prompts`,
  `conversation_log`, `artifacts`, `notifications`.

## Notifications & integrations

`src/notifications/` + `src/review/`

- **Telegram** — push for `run_started`, `run_failed`, `needs_answer`;
  webhook handler accepts replies and posts answers back.
- **CodeRabbit** — per-story code review during the QA gate.
- **SonarCloud** — per-story quality gate via `sonar-scanner`.
- **GitHub** (`gh`) — PR creation on the merge step.

## Setup & doctor

`src/setup/`

- `beerengineer setup` — interactive bootstrap. Writes config under
  `$XDG_CONFIG_HOME/beerengineer-nodejs/` and the API token to
  `$XDG_STATE_HOME/beerengineer/api.token`.
- `beerengineer doctor [--json]` — machine-readable health check used
  by the harness protocol. See [`app-setup.md`](./app-setup.md).
- Walkthrough: [`setup-for-dummies.md`](./setup-for-dummies.md).

---

## Out of scope (today)

- Cloud / multi-tenant deployment. The engine is a local tool.
- Authentication beyond a single CSRF token. There are no user accounts.
- A non-SQLite persistence layer.
- Stage editing through the UI. Pipeline shape is code-defined.
