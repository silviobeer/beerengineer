# beerengineer_

> Hand me an idea. Hold your beer.

A multi-stage agent pipeline that drives a product concept through
**brainstorm → visual-companion → frontend-design → requirements →
architecture → planning → execution → project-review → QA →
documentation**, using Claude Code and/or Codex as the underlying
agent runtimes — **either via the CLI (subscription-bundled) or
in-process via the vendor SDK (per-token, API-key billed)**.
CLI-first, HTTP/SSE API, optional Next.js UI.

![status](https://img.shields.io/badge/status-experimental-orange)

---

## What it does

You describe an idea in one or two paragraphs. `beerengineer` takes
that idea, runs it through a chain of specialised agents — each with
its own prompt, reviewer loop, and persisted artefact — and ends up
with working, committed code on a feature branch.

Every stage is observable: pending prompts surface in the CLI, the
HTTP API, or Telegram; artefacts are written to disk per run; events
stream over SSE for live UIs.

## Features

- **Staged agents** — brainstorm, visual-companion, frontend-design,
  requirements, architecture, planning, execution, project-review,
  QA, documentation
- **Design fidelity controls** — frontend-design emits
  `design-tokens.css`, execution receives owner-scoped mockup HTML, and
  story review rejects hardcoded palette drift and rounded corners
- **Pluggable LLM runtimes** — pick Claude Code or Codex per role
  (coder / reviewer / merge-resolver), and pick **CLI** (subprocess,
  uses your local CLI subscription) or **SDK** (in-process, billed
  per-token to your API key) per role. Ships five real
  `(harness, runtime)` adapters: `claude:cli`, `claude:sdk`,
  `codex:cli`, `codex:sdk`, `opencode:cli`. Presets cover the common
  combinations; `self` mode mixes harnesses + runtimes per role
- **CLI-first** (`beerengineer …`), with an **HTTP/SSE API** on port
  4100 for any external consumer (UIs, webhooks, custom tooling)
- **Per-workspace git worktrees** — each run lives on its own branch,
  merges back via PR
- **Shared-infra setup waves** — planning can serialize cross-cutting
  file edits before feature stories branch in parallel
- **Review integrations** — CodeRabbit + SonarCloud wired into the
  per-story quality gate
- **Telegram notifications** — run started/failed/needs-answer events
  push live to your phone; replies come back over a webhook
- **Recovery-on-restart** — orphaned runs are auto-marked failed with
  a resume-ready recovery payload

## Prerequisites

| Required | |
|---|---|
| Node.js 22+ | engine + tests |
| Git 2.30+ | worktrees, branch management |
| **At least one** LLM runtime — see below | drives every stage |

### Pick your LLM runtimes

You only need the rows that match the harness profile you'll actually
use. Most operators set up just one or two of these:

| Profile preset | What you need | Auth + billing |
|---|---|---|
| `claude-first` / `claude-only` | `claude` CLI (`npm i -g @anthropic-ai/claude-code`) | `claude login`; bundled with your Claude subscription |
| `codex-first` / `codex-only` / `fast` | `codex` CLI (OpenAI Codex CLI) | `codex login`; bundled with your Codex subscription |
| `claude-sdk-first` | `ANTHROPIC_API_KEY` env var | per-token API billing on the Anthropic API |
| `codex-sdk-first` | `OPENAI_API_KEY` env var | per-token API billing on the OpenAI API |
| `self` (mix per role) | any combination of the above | each role is billed by its own runtime |

The SDK adapters wrap `@anthropic-ai/claude-agent-sdk` /
`@openai/codex-sdk` and run the agent loop in-process — no subprocess
spawn per turn, richer streaming events, and direct per-call billing
visibility. Doctor will refuse to start a workspace whose profile
selects an SDK runtime without the matching env key set; it never
silently falls back to CLI.

| Optional | |
|---|---|
| CodeRabbit CLI | per-story code review |
| `sonar-scanner` + `sonarqube-cli` | SonarCloud quality gate |
| GitHub CLI (`gh`) | PR creation, repo operations |
| Telegram bot | push notifications |

## Quick start

```bash
git clone https://github.com/silviobeer/beerengineer.git
cd beerengineer
npm install

# One-time config (config + SQLite DB in ~/.config, ~/.local/share)
npm exec --workspace=@beerengineer2/engine beerengineer -- setup

# Register the project you want the engine to work on
npm exec --workspace=@beerengineer2/engine beerengineer -- \
  workspace add --path /path/to/your/project --sonar
npm exec --workspace=@beerengineer2/engine beerengineer -- \
  workspace use <key>

# Run the default workflow — you'll get prompted for an idea
npm exec --workspace=@beerengineer2/engine beerengineer
```

Alternatively, start the HTTP API and drive from another tool:

```bash
npm run start:api                        # listens on :4100
curl -X POST http://localhost:4100/runs \
  -H 'x-beerengineer-token: <token>' \
  -d '{"title":"My feature","description":"…"}'
```

## Usage (most common commands)

```bash
beerengineer                       # run default workflow
beerengineer status [--all]        # workspace overview
beerengineer items [--all]         # list items
beerengineer chats [--all]         # open prompts waiting for answer
beerengineer chat answer <runId> "<text>"
beerengineer runs watch <runId>    # live event stream
beerengineer item action --item <id> --action <name>
beerengineer doctor                # health check
beerengineer setup                 # re-run setup
```

Full CLI help: `beerengineer --help`.

## Architecture

```
┌─────────────────────────┐
│  Anyone (CLI, UI, HTTP) │
└────────────┬────────────┘
             │ HTTP + SSE (OpenAPI)
             ▼
┌─────────────────────────┐
│   @beerengineer2/engine │
│   ┌───────────────────┐ │
│   │  Stage Runtime    │ │  ←  Claude / Codex (CLI or SDK)
│   │  Run Orchestrator │ │
│   └───────────────────┘ │
│   ┌───────────────────┐ │
│   │   SQLite + WAL    │ │  ←  runs, items, prompts, logs
│   └───────────────────┘ │
└─────────────────────────┘
```

- `apps/engine` — CLI + HTTP API (the product)
- `apps/ui` — optional Next.js 15 consumer (in rebuild)
- `docs/api-contract.md` — Engine HTTP API contract (authoritative prose
  companion to `apps/engine/src/api/openapi.json`)

## Configuration

- Config file: `$XDG_CONFIG_HOME/beerengineer-nodejs/config.json`
- Data dir: `$XDG_DATA_HOME/beerengineer-nodejs/` (SQLite + WAL)
- API token file: `$XDG_STATE_HOME/beerengineer/api.token`
- Per-workspace: `.beerengineer/workspace.json` in the target repo

Common env vars:

- `BEERENGINEER_API_TOKEN` — override the generated CSRF token
- `BEERENGINEER_UI_ORIGIN` — allowed CORS origin
- `HOST`, `PORT` — API bind (default `127.0.0.1:4100`)
- `ANTHROPIC_API_KEY` — required when any role uses `claude:sdk`
- `OPENAI_API_KEY` — required when any role uses `codex:sdk`
- `SONAR_TOKEN`, `TELEGRAM_BOT_TOKEN`, … — integrations
- `BEERENGINEER_SDK_LIVE=1` — opt in to the live SDK smoke tests
  (skipped by default; runs real paid API calls)
- `BEERENGINEER_MAX_ITERATIONS_PER_CYCLE` — Ralph implementation
  iterations per review cycle (default `4`)
- `BEERENGINEER_MAX_REVIEW_CYCLES` — Ralph review cycles before
  declaring a story blocked (default `3`)
- `BEERENGINEER_MERGE_RESOLVER_BASE_MS`,
  `BEERENGINEER_MERGE_RESOLVER_PER_FILE_MS`,
  `BEERENGINEER_MERGE_RESOLVER_CAP_MS` — merge-resolver timeouts
- `BEERENGINEER_FORCE_FAKE_LLM=1` — force every stage to use its
  offline fake adapter (test mode)
- `BEERENGINEER_PROMPTS_DIR` — load prompt files from a different
  directory (absolute, or relative to `cwd`)
- `BEERENGINEER_HOSTED_RETRY_DELAYS_MS` — comma-separated retry delays
  for hosted CLI invocations (default `2000,8000`)

For the full picture of harness profiles, runtime policies, prompt
contracts, and how context flows into every LLM call, see
[`apps/engine/docs/context-and-llm-config.md`](apps/engine/docs/context-and-llm-config.md).

## Development

```bash
npm run typecheck                     # both workspaces
npm test --workspace=@beerengineer2/engine
npm run dev:engine                    # watch-mode API
npm run dev:ui                        # Next.js on :3000
```

## Dogfooding

beerengineer is being used to build its own UI (`apps/ui`). The engine
drives its own feature development through the stage pipeline, which
surfaces bugs and ergonomic issues faster than any synthetic test
harness — several engine fixes landed this week purely because real
runs against a real project hit real edge cases.

## For AI coding agents

Read [`AGENTS.md`](AGENTS.md) before making changes. The repo follows
the [agents.md](https://agents.md) convention: nested `AGENTS.md` files
are supported, the nearest one wins, and 20+ AI coding tools (Claude
Code, Codex, Cursor, Copilot, JetBrains Junie, …) pick them up without
configuration.

## Deeper reading

**Engine:**

- [`apps/engine/docs/PROJECT.md`](apps/engine/docs/PROJECT.md) — feature
  catalog (stages, runtimes, integrations, persistence).
- [`apps/engine/docs/TECHNICAL.md`](apps/engine/docs/TECHNICAL.md) —
  architecture map, source layout, cross-cutting decisions, gotchas.
- [`apps/engine/docs/engine-architecture.md`](apps/engine/docs/engine-architecture.md) —
  registry-driven pipeline, `GitAdapter`, iteration loop, file map,
  how to add a stage.
- [`apps/engine/docs/context-and-llm-config.md`](apps/engine/docs/context-and-llm-config.md) —
  context assembly (prompt envelope, codebase snapshot, conversation
  log) and LLM configuration (harness profile, runtime policy,
  presets, env vars).
- [`apps/engine/docs/setup-for-dummies.md`](apps/engine/docs/setup-for-dummies.md) —
  user-facing setup walkthrough.
- [`apps/engine/docs/architecture-plan.md`](apps/engine/docs/architecture-plan.md) —
  historical refactor plan (shipped) explaining how the current
  single-source-of-truth API architecture came to be.

**UI:**

- [`apps/ui/README.md`](apps/ui/README.md) — quick start, tech stack.
- [`apps/ui/docs/PROJECT.md`](apps/ui/docs/PROJECT.md) — feature catalog.
- [`apps/ui/docs/TECHNICAL.md`](apps/ui/docs/TECHNICAL.md) — architecture,
  SSE wiring, theming, gotchas.
- [`apps/ui/docs/api-for-designers.md`](apps/ui/docs/api-for-designers.md) —
  designer-friendly view of the engine API.

**Cross-cutting:**

- [`docs/api-contract.md`](docs/api-contract.md) — HTTP API prose
  contract (companion to `apps/engine/src/api/openapi.json`).
- [`docs/messaging-levels.md`](docs/messaging-levels.md) — L0/L1/L2
  taxonomy and event-to-level mapping.

## License

[MIT](LICENSE) © Silvio Beer
