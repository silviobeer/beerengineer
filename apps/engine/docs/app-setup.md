# App Setup

BeerEngineer now has a dedicated app-level setup flow for machine readiness.

> **Audience:** operators / developers running the engine, not first-time
> users. For the user-facing walkthrough (interactive setup, registering
> a workspace, picking a harness profile, optional Telegram), start with
> [`setup-for-dummies.md`](./setup-for-dummies.md). This file is the
> reference for the underlying `doctor` / `setup` commands the
> walkthrough invokes.

## Commands

```bash
npm exec --workspace=@beerengineer2/engine beerengineer -- doctor
npm exec --workspace=@beerengineer2/engine beerengineer -- doctor --json
npm exec --workspace=@beerengineer2/engine beerengineer -- setup --no-interactive
npm exec --workspace=@beerengineer2/engine beerengineer -- setup --group notifications
npm exec --workspace=@beerengineer2/engine beerengineer -- notifications test telegram
```

- `doctor` is read-only. It reports config, data-dir, DB, toolchain, and auth status.
- `setup` provisions the default config, data directory, and SQLite database, then reruns diagnostics. It refuses to overwrite a config file that exists but fails validation — fix or remove it by hand, then retry.
- `setup --group notifications` re-runs only the notification setup flow and guides you through `publicBaseUrl`, the Telegram bot-token env var name, and the default chat id.
- `notifications test telegram` sends a smoke-test message through the configured Telegram bot/chat, using the same engine delivery path as real run events.
- `GET /setup/status` returns the same JSON contract as `doctor --json`. Passing `?group=` with an unknown id responds `400 { "error": "unknown_group" }`; the CLI equivalent exits with code 2.

Known group ids: `core`, `vcs.github`, `llm.anthropic`, `llm.openai`, `llm.opencode`, `browser-agent`, `review`, `notifications`.

### LLM auth: CLI vs SDK

The engine supports two invocation runtimes per harness role:

- **CLI runtimes** (`claude:cli`, `codex:cli`) rely on the local agent
  CLI's auth state — i.e. you've previously run `claude login` /
  `codex login`. No API key is needed in the engine environment.
- **SDK runtimes** (`claude:sdk`, `codex:sdk`) require a real API key
  in the process environment:
  - `claude:sdk` → `ANTHROPIC_API_KEY`
  - `codex:sdk`  → `OPENAI_API_KEY`

  `doctor` flags missing keys when a workspace's harness profile
  selects an SDK-backed role. The engine refuses to silently fall back
  to CLI when SDK was requested — it throws
  `profile_references_unavailable_runtime` so the operator sees the
  mismatch immediately.

  **Billing note.** SDK profiles bill **per-token** against the API
  key. CLI profiles bill against the local subscription bundle.
  Switching a coder role from `cli` to `sdk` can change the invoice
  shape — read [`context-and-llm-config.md`](./context-and-llm-config.md) § *CLI vs SDK runtime*
  before flipping a production workspace.

  `opencode:sdk` is rejected at validation time — there's no
  comparable opencode agent SDK shipping today.

## Config

Default config path is OS-aware via `env-paths` and resolves to `config.json` under the app config directory.

Default config shape:

```json
{
  "schemaVersion": 1,
  "dataDir": "<env-paths user data dir>",
  "allowedRoots": ["~/projects"],
  "enginePort": 4100,
  "publicBaseUrl": "http://100.x.y.z:3100",
  "llm": {
    "provider": "anthropic",
    "model": "claude-opus-4-7",
    "apiKeyRef": "ANTHROPIC_API_KEY"
  },
  "vcs": {
    "github": {
      "enabled": false
    }
  },
  "notifications": {
    "telegram": {
      "enabled": false,
      "botTokenEnv": "TELEGRAM_BOT_TOKEN",
      "defaultChatId": ""
    }
  },
  "browser": {
    "enabled": false
  }
}
```

Supported env overrides:

- `BEERENGINEER_CONFIG_PATH`
- `BEERENGINEER_DATA_DIR`
- `BEERENGINEER_ALLOWED_ROOTS`
- `BEERENGINEER_ENGINE_PORT`
- `BEERENGINEER_PUBLIC_BASE_URL`
- `BEERENGINEER_LLM_PROVIDER`
- `BEERENGINEER_LLM_MODEL`
- `BEERENGINEER_LLM_API_KEY_REF`
- `BEERENGINEER_GITHUB_ENABLED`
- `BEERENGINEER_TELEGRAM_ENABLED`
- `BEERENGINEER_TELEGRAM_BOT_TOKEN_ENV`
- `BEERENGINEER_TELEGRAM_DEFAULT_CHAT_ID`
- `BEERENGINEER_TELEGRAM_API_BASE_URL`
- `BEERENGINEER_BROWSER_ENABLED`

## Notifications

Telegram notifications depend on two sources of configuration:

- App config stores whether Telegram is enabled, which env var contains the bot token, the default chat id, and the externally reachable `publicBaseUrl`.
- The bot token itself stays in the environment and is never persisted into `config.json`.

The `notifications` doctor group reports:

- whether `publicBaseUrl` exists and is a valid non-loopback `http(s)` URL
- whether Telegram notifications are enabled
- which env var is expected for the bot token
- whether that env var is currently present
- whether a default chat id is configured

Operational notes:

- `publicBaseUrl` must be reachable by the person receiving the Telegram message. In practice this usually means a Tailscale IP or DNS name, not `localhost` and not `127.0.0.1`.
- The settings page reads this same status via `GET /setup/status?group=notifications`.
- The settings page can trigger a smoke test and show recent delivery rows from `notification_deliveries`.
- `GET /notifications/deliveries` and `POST /notifications/test/telegram` expose the same data/actions over HTTP.

## Report semantics

- `overall = blocked` means at least one required group is unsatisfied and `doctor` exits non-zero.
- `overall = warning` means required groups pass and only recommended tooling is missing.
- `overall = ok` means all active required groups pass and recommended tooling hit its ideal target.

## Schema migrations

`applySchema` stamps `PRAGMA user_version = REQUIRED_MIGRATION_LEVEL` only when the
current value is ≤ the required level. A newer binary opening an older DB runs the
idempotent `ALTER TABLE` migrations and bumps the version; a newer DB opened by an
older binary is left untouched. When introducing level 2+, add a real
`migrate(from, to)` runner keyed off `user_version` instead of stamping the constant.

## Harness JSON protocol (driving the engine programmatically)

For agents (Claude Code, Codex, custom wrappers) that drive the engine
non-interactively:

```bash
beerengineer --json [--workspace <key>] [--verbose]
beerengineer run --json [--workspace <key>] [--verbose]
```

Stdout is one JSON event per line. Two modes:

**Agent mode (default, no `--verbose`).** The first line is a one-shot
`workflow_started` handshake that documents the reply protocol inline:

```json
{"type":"workflow_started","version":1,"protocol":{"wake_on":["prompt_requested"],"reply":"{\"type\":\"prompt_answered\",\"promptId\":\"<from prompt_requested>\",\"answer\":\"<your answer>\"}","terminal_events":["run_finished","run_blocked","run_failed","cli_finished"]}}
```

After the handshake, only events on the agent allowlist are emitted:
`prompt_requested`, `prompt_answered`, `run_started`, `run_finished`,
`run_blocked`, `run_failed`. Lifecycle chatter (`chat_message`,
`presentation`, `log`, `stage_started`, …) is suppressed — the agent
just filters on `type === "prompt_requested"`. Each open prompt also
prints a compact stderr signpost `⏸  beerengineer waiting on prompt
[p-…]: <text>` (prompt text truncated at 120 chars) so shell wrappers
that don't parse stdout still see where the run is blocked.

**Firehose mode (`--verbose`).** Stdout mirrors every bus event for
debugging or replay.

The harness reads `prompt_requested` events from stdout and replies on
stdin with one JSON line per answer:

```json
{"type":"prompt_answered","promptId":"<from prompt_requested>","answer":"<your answer>"}
```

Human-readable output goes to stderr in both modes. The run terminates
with `{"type":"cli_finished","runId":"…"}`.

The allowlist and handshake live in
`apps/engine/src/core/renderers/ndjson.ts`; the `--json` / `--verbose`
flag handling is in `apps/engine/src/index.ts`.

## Tests

- Fast unit tests run by default: `npm test --workspace=@beerengineer2/engine`.
- The end-to-end CLI smoke test (`start_brainstorm runs to completion`) is gated behind
  `BE2_RUN_SLOW_TESTS=1` because it drives scripted stdin through the real workflow and
  is sensitive to prompt-count changes.

## Test pyramid (engine)

- **Engine unit tests** — `apps/engine/test/*.test.ts`, run under
  `node:test --import tsx`. Several hundred tests across ~45 files
  covering: stage→board column mapping, bus-subscriber lifecycle,
  pending-prompt round-trip, `AsyncLocalStorage` isolation across
  parallel runs, real-git branch operations including
  `abandonStoryBranch`, base-branch resolution, API-route integration
  (`apiIntegration.test.ts`), the Ralph runtime
  (`ralphRuntime.test.ts`), the hosted-CLI adapter (retry + JSON
  recovery), the cross-process bridge, and resume-with-remediation.
- **UI E2E** — none today. The previous Playwright suite under
  `apps/ui/tests/e2e/` was removed with the UI teardown
  (see [`ui-design-notes.md`](./ui-design-notes.md)). End-to-end tests
  return with the UI rebuild.
