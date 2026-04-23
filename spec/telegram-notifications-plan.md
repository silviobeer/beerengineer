# Telegram Notifications Implementation Plan

## Goal

Add Telegram notifications as a pure outbound notification channel for BeerEngineer runs.

The notification system must:

- never control workflow execution
- never answer prompts
- never introduce a second orchestration path
- always use absolute links based on a configured public base URL
- support Tailscale access by prefixing links with the configured reachable IP/host
- be set up through a CLI-first operator flow under `beerengineer setup`

## Core Requirements

### Setup experience

Telegram setup must start in the CLI setup flow.

This is a hard requirement.

The operator should be guided through setup with clear text that explains:

- what Telegram notifications are for
- what they are not for
- how to create a bot
- how to get a chat id
- how to configure the externally reachable base URL
- why Tailscale requires absolute non-localhost links

The setup flow must not assume prior Telegram knowledge.

`beerengineer setup` should be able to:

- explain the setup steps
- collect the relevant config values
- validate the entered values
- persist non-secret config
- tell the operator what still needs to be exported as environment variables

### Notification scope

Telegram is notification-only.

It may report:

- run started
- stage completed
- run blocked
- run finished
- optionally later: prompt requested

It must not:

- start runs
- resume runs
- answer prompts
- mutate workflow state

### Source of truth

Notifications must be driven from the central event/persistence layer.

Do not send Telegram messages directly from:

- stage code
- UI handlers
- ad hoc CLI branches

Preferred architecture:

- workflow emits normal events
- events are persisted into DB / stage logs
- notification worker consumes canonical events
- Telegram delivery happens asynchronously

This keeps CLI, UI, DB, and Telegram aligned to the same truth.

### Link policy

All Telegram links must be absolute and must use a configured external base URL.

This is mandatory because the operator connects through Tailscale.

Examples:

- `http://100.x.y.z:3100/runs/<runId>`
- `http://100.x.y.z:3100/items/<itemId>`

Rules:

- never emit `localhost` or `127.0.0.1` in Telegram messages
- never emit relative links
- all shared links must come from one central helper

Recommended config field:

- `publicBaseUrl`

Example:

- `http://<tailscale-ip>:3100`

### Config and secret split

Telegram configuration must separate durable config from secrets.

Store in config:

- whether Telegram is enabled
- which env var contains the bot token
- the default chat id
- the public base URL used to build links

Do not store in config:

- the Telegram bot token itself

Recommended config fields:

- `publicBaseUrl`
- `notifications.telegram.enabled`
- `notifications.telegram.botTokenEnv`
- `notifications.telegram.defaultChatId`

## Architecture

### 0. Close the existing scaffolding gap (do this first)

`apps/engine/src/setup/types.ts` already declares `publicBaseUrl`, `notifications.telegram.*`, and the matching `SetupOverrides` fields (`telegramEnabled`, `telegramBotTokenEnv`, `telegramDefaultChatId`). But `apps/engine/src/setup/config.ts` does not handle any of them: `defaultAppConfig`, `validateConfig`, `resolveMergedConfig`, and `envOverrides` all skip these fields, so any persisted value is silently dropped on the next write.

Step 0 must:

- extend `validateConfig` to accept and normalize `publicBaseUrl` and `notifications.telegram.*`
- extend `resolveMergedConfig` to merge CLI/env overrides for these fields
- extend `envOverrides` to read `BEERENGINEER_PUBLIC_BASE_URL`, `BEERENGINEER_TELEGRAM_ENABLED`, `BEERENGINEER_TELEGRAM_BOT_TOKEN_ENV`, `BEERENGINEER_TELEGRAM_DEFAULT_CHAT_ID`
- include the new values in `writeConfigFile` output (already handled by JSON serialization, but the round-trip must be covered by a test)
- add a `notifications` entry to `KNOWN_GROUP_IDS` in `config.ts`

Without step 0, every other phase reads a config that silently discards the fields on write.

### 1. Config

Extend config with notification settings.

Proposed shape:

```json
{
  "publicBaseUrl": "http://100.x.y.z:3100",
  "notifications": {
    "telegram": {
      "enabled": true,
      "botTokenEnv": "TELEGRAM_BOT_TOKEN",
      "defaultChatId": "123456789"
    }
  }
}
```

Notes:

- bot token should come from env or secret storage, not be hardcoded in repo
- `publicBaseUrl` must be treated as required for outbound notifications
- `publicBaseUrl` validation must parse with the WHATWG `URL` constructor and reject loopback hostnames — `localhost`, `127.0.0.1`, `::1`, `0.0.0.0`, and any `*.local` — not just a substring match on `"localhost"`

### 1a. Setup flow

Add a Telegram section to `beerengineer setup`.

Suggested flow:

1. Explain what Telegram notifications do
2. Ask whether the operator wants to enable Telegram notifications
3. If enabled:
   - ask for `publicBaseUrl`
   - ask for the bot-token env var name
   - ask for the default chat id
4. Print exact next steps for the operator

Suggested operator text shape:

- short explanation
- step-by-step actions
- example commands
- one short warning about `localhost`

Example guidance content:

1. Open Telegram and talk to `@BotFather`
2. Create a bot and copy the token
3. Put the token into an environment variable, for example:
   - `export TELEGRAM_BOT_TOKEN=...`
4. Start a chat with the bot or add it to a group
5. Send at least one message to the bot
6. Find the target chat id
7. Set `publicBaseUrl` to the Tailscale-reachable UI address, for example:
   - `http://100.x.y.z:3100`

The setup flow should explain why each of these is needed.

### 2. Link builder

Create one shared helper to build external links.

Responsibilities:

- normalize `publicBaseUrl` (strip trailing slashes in exactly one place)
- build run links
- build item links
- build workspace links if needed

No notification channel should construct URLs itself.

### 3. Telegram client

Create a small Telegram delivery module.

Responsibilities:

- call Telegram Bot API `sendMessage` with `parse_mode` unset (plain text only — MarkdownV2/HTML escaping bugs on stage names containing `_`, `*`, `[`, etc. are not worth the formatting)
- enforce timeout (suggested: 5 s)
- return structured success/failure
- on HTTP 429, honor the `retry_after` header exactly once, then drop and log; no exponential backoff
- never throw unhandled errors into workflow execution path

Delivery failures must be logged, not allowed to fail runs.

Message content hygiene:

- truncate any free-text field (item title, blocking summary, error strings) to a fixed character budget (suggested: 500 chars per field, 3500 chars per message)
- redact obvious secret-like substrings before send — minimum: anything matching `sk-[A-Za-z0-9_-]{16,}`, `ghp_[A-Za-z0-9]{20,}`, `xox[baprs]-[A-Za-z0-9-]+`, and the configured bot token value itself
- document that the operator is responsible for the privacy of the target chat

### 4. Notification dispatcher

Add a dispatcher layer that maps canonical workflow events to notification messages.

Suggested inputs:

- `run_started`
- `stage_completed`
- `run_blocked`
- `run_finished`

Suggested outputs:

- message text
- target chat id
- dedup key

Event payload completeness:

- `run_started` already carries `title` (see `apps/engine/src/core/runOrchestrator.ts:390`)
- `run_finished` and `run_blocked` currently do not; the dispatcher must either receive an enriched event (preferred — extend the `WorkflowEvent` union with `title` and `itemId` on these variants) or look up the run/item via the repos layer
- pick one approach up front and stick to it; mixing both means the dispatcher has two code paths for the same concern

### 5. Async delivery path

Notification sending must be asynchronous.

Possible implementations:

- lightweight in-process subscriber with fire-and-log behavior
- durable notification jobs table plus worker

Recommended direction:

- start simple with an async subscriber
- add durable queue only if reliability requirements grow

Concrete subscriber contract:

```ts
bus.subscribe(event => {
  void dispatcher.deliver(event).catch(logDeliveryError)
})
```

- never `await` inside the subscriber
- the promise must not be returned to the bus
- `dispatcher.deliver` owns its own timeout and never throws

Process ownership (this is a hard constraint):

- delivery runs in the **engine process only**, alongside the `dbSync` subscriber
- CLI clients and any process attached via `core/crossProcessBridge.ts` must not attach the Telegram subscriber — otherwise a single logical event is delivered twice
- the subscriber attachment site should be the same place `dbSync` is wired; co-locate them so the "only in the engine process" invariant is trivially auditable

Ordering vs. DB commit:

- the bus emits in `runOrchestrator.ts` independently of repo writes, so a Telegram link to `/runs/<id>` can race the DB insert
- subscribe **after** the persistence subscriber (document the ordering contract in `core/bus.ts`), or consume a post-commit stream if one is added
- without this, MVP links can 404 on fast clicks

## Message Design

### MVP events

#### Run started

Include:

- item title
- run id
- workspace if useful
- direct run link

Example:

```text
BeerEngineer run started
Item: Add browser page title smoke check
Run: a3f735d4-d747-4fba-b6c9-437b8b4c83f5
Open: http://100.x.y.z:3100/runs/a3f735d4-d747-4fba-b6c9-437b8b4c83f5
```

#### Stage completed

Include:

- item or run id
- stage name
- outcome
- run link

#### Run blocked

Include:

- item title
- run id
- blocking summary
- scope if available
- run link

This is the highest-value alert.

#### Run finished

Include:

- item title
- run id
- final status
- run or item link

### Phase 2 events

Optional later:

- `prompt_requested`
- `run_resumed`
- `external_remediation_recorded`

These are useful, but should not delay MVP.

## Deduplication

Telegram messages must not duplicate when:

- the same event is replayed
- a worker restarts
- DB subscribers re-read historical rows

Add a stable dedup key per notification, for example:

- `<runId>:run_started`
- `<runId>:stage_completed:<stageKey>`
- `<runId>:run_blocked:<scope>`
- `<runId>:run_finished`

### Phase 1 dedup decision (pick one explicitly)

Option A — **no replay to notifier**: in-memory subscriber only; historical rows are never fed back into the bus; on engine restart, past events are not re-delivered. Simplest, matches "start simple." Document this behavior in the notifications module header.

Option B — **durable delivery table from day one**: `notification_deliveries(dedup_key PRIMARY KEY, channel, chat_id, attempt_count, last_attempt_at, status)`. Dispatcher inserts with `ON CONFLICT(dedup_key) DO NOTHING` before calling the client; skips if the row already exists.

The current plan defers B to "later." Pick now — leaving this ambiguous is a latent duplicate-message bug the moment someone adds a replay/backfill feature.

Recommendation: Option A for MVP, with a short comment in the code stating the invariant so a future replay feature triggers review.

## CLI / Setup / Doctor

### Setup

Extend setup/config validation to include:

- `publicBaseUrl`
- telegram enabled/disabled
- presence of bot token env if enabled
- presence of chat id if enabled

Setup should also guide the user interactively through these fields.

Interactive setup behavior:

- if Telegram is disabled, store disabled state and continue
- if Telegram is enabled, require enough information to make the config meaningful
- do not require the raw bot token to be typed into setup
- instead, require or suggest the env var name that will hold it

Non-interactive behavior:

- do not prompt
- report missing Telegram config as warnings or blockers depending on enablement
- print exact remediation text

Enable-time checks in setup:

- if Telegram is enabled and `process.env[botTokenEnv]` is empty, emit a **warning** (not a blocker) — the env may be provisioned later by a service manager (systemd, launchd, a shell profile the CLI doesn't source)
- always emit the precise remediation line (`export <NAME>=<value>`) so copy-paste works

### Doctor

Add diagnostics:

- warn if `publicBaseUrl` is missing
- warn if `publicBaseUrl` resolves to a loopback hostname (`localhost`, `127.0.0.1`, `::1`, `0.0.0.0`, `*.local`) via `URL` parse, not substring match
- validate Telegram config shape
- optionally test a dry auth request (`getMe`)

Recommended notification checks:

- `notifications.public-base-url`
- `notifications.telegram.enabled`
- `notifications.telegram.bot-token-env`
- `notifications.telegram.bot-token-present`
- `notifications.telegram.default-chat-id`

These checks belong to a new `notifications` group. Add it to `KNOWN_GROUP_IDS` in `apps/engine/src/setup/config.ts`.

Each failed check must include a concrete remedy.

### Optional test command

Add a command like:

```text
beerengineer notifications test telegram
```

Behavior:

- build one test message
- send to configured chat
- print success/failure

## UI

UI should not own Telegram delivery, but it should expose status.

Recommended UI support:

- settings/setup panel shows whether Telegram notifications are configured
- optional “send test notification” action later
- visible display of configured public base URL

Do not build a second notification execution path in UI.

## Testing

Use the existing in-process `EventBus` (`apps/engine/src/core/bus.ts`) as the test harness — no new scaffolding. Attach the notification subscriber to a freshly created bus, emit events, assert on the stub client's received calls.

### Unit tests

Add tests for:

- event to message mapping
- link generation from `publicBaseUrl` (trailing slash normalization, loopback rejection)
- Telegram payload formatting (truncation, secret redaction, plain-text escaping non-issues)
- config round-trip: write → read → compare, covering `publicBaseUrl` and `notifications.telegram.*` (guards the step 0 fix)

### Integration tests

Add tests for:

- `run_started` generates a notification request
- `run_blocked` generates a notification request
- `run_finished` generates a notification request
- loopback base URLs (`localhost`, `127.0.0.1`, `::1`, `0.0.0.0`) are rejected or warned
- when Telegram is disabled in config, the subscriber is not attached (verify by counting bus listeners)
- 429 from the stub client is honored once via `retry_after`, then dropped

### No live Telegram dependency in main suite

Regular CI tests should use a mocked HTTP endpoint or stub client.

Real Telegram send should be limited to:

- manual smoke test command
- optional opt-in integration environment

## Rollout Plan

### Phase 1

Implement:

- **step 0: reconcile `setup/config.ts` with `setup/types.ts`** (validator, merger, env overrides, defaults, `KNOWN_GROUP_IDS`)
- config (publicBaseUrl + notifications.telegram.*)
- public link builder (with loopback rejection and trailing-slash normalization)
- Telegram client (plain text, 5 s timeout, single 429 retry, secret redaction, field truncation)
- `WorkflowEvent` enrichment: add `title` and `itemId` to `run_finished` / `run_blocked`
- dispatcher for `run_started`, `run_blocked`, `run_finished`
- async subscriber wired in the engine process only, co-located with `dbSync`, ordered after the persistence subscriber
- doctor/setup validation with new `notifications` group

### Phase 2

Add:

- `stage_completed`
- optional test command
- UI status surface

### Phase 3

Evaluate:

- prompt notifications
- durable notification queue
- per-workspace or per-user routing

## Guardrails

- Telegram must never block workflow execution
- Telegram must never become a second control plane
- all URLs must use `publicBaseUrl`
- all outbound links must be absolute
- for Tailscale use, `publicBaseUrl` must point to the reachable Tailscale IP/host
- no direct sends from stage implementations
- delivery attaches in exactly one process (engine) — cross-process bridges never attach the subscriber
- when `notifications.telegram.enabled !== true`, the subscriber is not attached at all (no dead-code branch inside the handler)
- the notification subscriber runs after the persistence subscriber, so every emitted link points at committed state
- message content is plain text, truncated, with secret-like substrings redacted before send

## Recommended MVP Decision

Build the first version with:

- one global Telegram target chat
- one global `publicBaseUrl`
- CLI-first setup flow under `beerengineer setup`
- notifications for `run_started`, `run_blocked`, `run_finished`

This gives immediate value with minimal architectural risk.
