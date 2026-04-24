# beerengineer_

> Hand me an idea. Hold your beer.

A multi-stage agent pipeline that drives a product concept through
**brainstorm → design → requirements → architecture → planning →
execution → QA**, using Claude Code in conjunction with Codex.
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
- **Claude Code + Codex** as the underlying agent runtimes
- **CLI-first** (`beerengineer …`), with an **HTTP/SSE API** on port
  4100 for any external consumer (UIs, webhooks, custom tooling)
- **Per-workspace git worktrees** — each run lives on its own branch,
  merges back via PR
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
| Claude Code CLI | `npm i -g @anthropic-ai/claude-code` |

| Optional | |
|---|---|
| Codex CLI | for Codex-backed stages |
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
│   │  Stage Runtime    │ │  ←  Claude Code + Codex agents
│   │  Run Orchestrator │ │
│   └───────────────────┘ │
│   ┌───────────────────┐ │
│   │   SQLite + WAL    │ │  ←  runs, items, prompts, logs
│   └───────────────────┘ │
└─────────────────────────┘
```

- `apps/engine` — CLI + HTTP API (the product)
- `apps/ui` — optional Next.js 15 consumer (in rebuild)
- `spec/` — OpenAPI + architecture specs (contract source of truth)

## Configuration

- Config file: `$XDG_CONFIG_HOME/beerengineer-nodejs/config.json`
- Data dir: `$XDG_DATA_HOME/beerengineer-nodejs/` (SQLite + WAL)
- API token file: `$XDG_STATE_HOME/beerengineer/api.token`
- Per-workspace: `.beerengineer/workspace.json` in the target repo

Common env vars:

- `BEERENGINEER_API_TOKEN` — override the generated CSRF token
- `BEERENGINEER_UI_ORIGIN` — allowed CORS origin
- `HOST`, `PORT` — API bind (default `127.0.0.1:4100`)
- `SONAR_TOKEN`, `TELEGRAM_BOT_TOKEN`, … — integrations

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

## Deeper reading

Detailed design notes and implementation history (in German):
[`docs/NOTES.de.md`](docs/NOTES.de.md).

## License

TBD.
