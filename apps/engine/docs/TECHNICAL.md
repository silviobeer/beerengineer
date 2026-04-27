# Engine — Technical Reference

**Last updated:** 2026-04-27

This is the **map** of the engine. The deep dives in
[`engine-architecture.md`](./engine-architecture.md),
[`context-and-llm-config.md`](./context-and-llm-config.md), and
[`app-setup.md`](./app-setup.md) are the territory — go there for the
specifics. Use this file to navigate, not to memorise.

---

## Architecture at a glance

```
                ┌──────────────────────────────────────────────┐
   CLI / UI ──► │  HTTP/SSE API (src/api)         :4100        │
                │  CSRF token auth + OpenAPI 3.1               │
                └──────────────────────┬───────────────────────┘
                                       │
                ┌──────────────────────▼───────────────────────┐
                │  Run Orchestrator (src/core/runOrchestrator) │
                │  - workspace registry                        │
                │  - item-action transition table              │
                │  - authoritative-run gating                  │
                └──────────────────────┬───────────────────────┘
                                       │
                ┌──────────────────────▼───────────────────────┐
                │  Workflow (src/workflow.ts)                  │
                │  walks ProjectStageNodes through the         │
                │  pipeline; each stage emits canonical events │
                └─┬───────────────────────┬───────────────────┬┘
                  │                       │                   │
                  ▼                       ▼                   ▼
          ┌───────────────┐    ┌──────────────────┐  ┌────────────────┐
          │ Stage runtime │    │ LLM dispatch     │  │ Git Adapter    │
          │ (src/stages)  │    │ (src/llm)        │  │ (src/core/git) │
          │ withStageLife │    │ harness×runtime  │  │ worktrees, PR  │
          │ cycle wrapper │    │ adapters + presets│  │ branches      │
          └───────────────┘    └──────────────────┘  └────────────────┘
                  │                       │                   │
                  ▼                       ▼                   ▼
          ┌──────────────────────────────────────────────────────┐
          │  SQLite + WAL (src/db) — runs, items, events, …      │
          └──────────────────────────────────────────────────────┘
```

The single source of truth for shapes is `src/api/openapi.json`. Prose
companion: [`docs/api-contract.md`](../../../docs/api-contract.md).

## Source layout

```
apps/engine/
├── bin/                     CLI entrypoint
├── prompts/
│   ├── system/              one per stage
│   ├── workers/             one per stage
│   └── reviewers/           one per stage
├── src/
│   ├── api/                 HTTP server, route handlers, OpenAPI, SSE
│   │   ├── openapi.json     authoritative shapes
│   │   ├── server.ts        Fastify-style mount
│   │   └── sse/             workspace + run streams
│   ├── core/                cross-cutting plumbing
│   │   ├── boardColumns.ts  stage→column projection
│   │   ├── itemActions.ts   transition table for item-action endpoints
│   │   ├── runOrchestrator.ts  authoritative-run gating, recovery
│   │   ├── runService.ts    spawn / seed runs from item actions
│   │   ├── messagingLevel.ts L0/L1/L2 taxonomy
│   │   ├── messagingProjection.ts envelope construction
│   │   └── git/             worktree + branch + PR helpers
│   ├── db/                  SQLite schema + connection + migrations
│   ├── llm/                 harness × runtime adapters + presets
│   ├── notifications/       Telegram bot + webhook handler
│   ├── render/              artifact rendering helpers
│   ├── review/              CodeRabbit + Sonar integrations
│   ├── setup/               doctor + setup wizard
│   ├── sim/                 (legacy) simulation helpers — no real-git path
│   ├── stages/              one module per pipeline stage
│   ├── types/, types.ts     shared types
│   ├── workflow.ts          stage walker
│   └── index.ts             CLI dispatcher
└── test/                    node:test files (~45 of them)
```

## Cross-cutting decisions

- **Real git is mandatory.** No simulated mode. Every run gets a worktree
  off `master` and a PR to merge back.
- **Authoritative-run rule.** A run only writes item state when it is the
  sole live run for that item. See `runOrchestrator.ts` (`isAuthoritative`
  and `wasSoleLiveRun`).
- **Idempotent migrations** via `ALTER TABLE … IF NOT EXISTS`-style guards
  in `src/db/connection.ts`. No separate migration files.
- **Single CSRF token** for the API. Local-only tool; no user accounts.
- **Canonical event names everywhere.** Engine, CLI, UI all use the same
  vocabulary: `phase_started`, `item_column_changed`, `run_finished`, etc.
  See [`docs/messaging-levels.md`](../../../docs/messaging-levels.md).
- **Harness × runtime matrix.** Roles bind to a (harness, runtime) pair
  rather than a single LLM choice. SDK runtimes refuse to start without
  their API key — no silent fallback to CLI.

## Data model (high level)

| Entity | Lifespan | Owns |
|---|---|---|
| `workspaces` | long | name, root_path, harness profile, SCM config |
| `items` | long | code (ITEM-NNNN), title, summary, current_column, phase_status, current_stage |
| `runs` | finite (minutes–hours) | item_id, status, current_stage, branch, started_at |
| `events` | append-only | run_id, type, level, payload — drives SSE |
| `prompts` | per-stage | run_id, text, status (open / answered / cancelled) |
| `conversation_log` | per-run | actor, kind, text, prompt_id |
| `artifacts` | per-run | path, kind, sha |

Schema: `src/db/schema.sql`. Migrations: `src/db/connection.ts`.

## API contract

- Authoritative shapes: `src/api/openapi.json` (served at `GET /openapi.json`).
- Prose companion: [`docs/api-contract.md`](../../../docs/api-contract.md).
- Cross-cutting because the UI consumes it directly. When code and the
  prose disagree, the OpenAPI file wins.

## Messaging levels (L0 / L1 / L2)

Cross-cutting taxonomy lives at
[`docs/messaging-levels.md`](../../../docs/messaging-levels.md). Engine
side: `src/core/messagingLevel.ts`, `src/core/messagingProjection.ts`. The
filter semantics — `?level=N` returns events where `entry.level >= N` —
are identical in the CLI (`runs tail`), the API, and the UI tier toggle.

## LLM configuration

Deep dive: [`context-and-llm-config.md`](./context-and-llm-config.md).
TL;DR: a profile binds a (harness, runtime) pair to each role
(coder / reviewer / merge-resolver). Five adapters: `claude:cli`,
`claude:sdk`, `codex:cli`, `codex:sdk`, `opencode:cli`. Presets cover
common combinations; `self` mixes per role.

## Setup, doctor, harness protocol

Deep dive: [`app-setup.md`](./app-setup.md). User walkthrough:
[`setup-for-dummies.md`](./setup-for-dummies.md). The doctor's `--json`
output is the machine-readable harness contract used by `beerengineer`
itself for self-checks.

## Testing

```bash
npm test --workspace=@beerengineer2/engine          # node:test, ~45 files
npm run typecheck --workspace=@beerengineer2/engine
```

- `node:test --import tsx` — no transpile step, real TS in tests.
- Live SDK smoke tests are gated behind `BEERENGINEER_SDK_LIVE=1` (they
  burn real tokens). Default test runs use offline fakes.
- `BEERENGINEER_FORCE_FAKE_LLM=1` forces every stage to its offline
  fake adapter, useful in CI.

## Dependencies

`apps/engine/package.json`:

- `better-sqlite3` — DB
- `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk` — SDK runtimes
- `tsx` — TS-as-script for dev/test
- `zod` — runtime validation at API + DB boundaries
- HTTP server: lightweight, framework-free over `node:http`.

## Deployment

Out of scope. The engine runs on the user's local machine. Bind defaults
to `127.0.0.1:4100` for that reason — the UI proxy's allowlist is the
only ingress point.

## Gotchas

- **Two component trees in `apps/ui`.** Doesn't affect the engine, but if
  you proxy/scrape UI tests be aware. See `apps/ui/docs/TECHNICAL.md`.
- **Authoritative-run gating means silent runs are correct.** A run that
  isn't authoritative will appear to "do nothing" in the UI item state;
  it still emits its own run-scoped events.
- **`current_stage` clears on terminal events** when the run was the sole
  live run for the item. UIs must accept `null` as a legitimate value.
- **CLI synchronous paths must spawn**, not just flip a column. The
  recent action additions (`start_visual_companion`,
  `start_frontend_design`) had a regression where the CLI handler
  short-circuited; see commit history around `runService` for the fix.
- **Idempotent migrations only.** Don't add a non-idempotent `ALTER` —
  recovery on restart will trip on it.
