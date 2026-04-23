# Claude CLI Live Event Streaming

## Status

Implemented in Apr 2026.

Validated locally against `Claude Code 2.1.118`:

- `stream-json` currently requires `--verbose` with `--print`
- the observed stream envelope is top-level JSONL records such as `system`, `assistant`, `user`, `rate_limit_event`, and `result`
- tool-use events were observed in `assistant.message.content[*]` entries with `type: "tool_use"`
- `--bare` was not made the default because the local probe returned `Not logged in · Please run /login` under subscription-auth

## Problem

`apps/engine/src/llm/hosted/providers/claude.ts` invokes the Claude CLI
with `claude --print --output-format json`. That format buffers the
entire agent loop internally and only emits **one** JSON document at
close. The user sees nothing between "Ralph implements STORY-X…" and the
final "→ Implemented STORY-X …" summary — even though Claude is actively
reading, editing, and running tests during that window.

With Haiku 4.5 a story-implementation round routinely stays "dark" for
3–8 minutes. Three concrete costs:

1. **Debuggability**: when Ralph gets stuck, there is no visible signal
   until the hosted CLI throws or the subprocess is reaped.
2. **Trust**: users reasonably wonder whether the engine is still alive,
   and the only safe assumption is "wait longer".
3. **Parallel observability**: planned parallel waves cannot be
   visually interleaved in the UI because per-story progress is opaque.

We solved this for Codex via `--json` event stream + a stdout line
callback in `spawnCommand` (commit `7db189a`). This spec proposes the
equivalent for Claude.

## Goal

When Claude is invoked from the engine, emit live events through the
existing workflow bus so the UI transcript shows agent-loop progress —
tool calls, turn boundaries, and token usage — as they happen, instead
of only at completion.

This spec has two distinct outcomes:

1. **Faster feedback**: users should see Claude progress while the run is
   ongoing.
2. **Faster scripted startup**: non-interactive Claude invocations should
   avoid unnecessary initialization work where that does not change
   engine behavior.

Streaming primarily improves perceived responsiveness, not raw
wall-clock execution time. Actual runtime reduction requires separate
startup and prompt-size controls.

Specifically:

- Each `claude --print` invocation uses a streaming format.
- Scripted invocations prefer startup-time reductions documented by
  Anthropic, especially `--bare`, when compatibility allows.
- Progress events arrive in the UI transcript with `presentation` /
  `kind: "dim"` (or a dedicated kind for tool boundaries).
- Transient-retry behavior is preserved: if the stream terminates
  abnormally, retry semantics from commit `adadb0c` still apply.
- Session-resume, cache stats, and `outputText` extraction still work.
- No behavioral regression for callers of `invokeClaude`.

## Non-Goals

- Re-implementing the agent loop. We only mirror events Claude CLI
  already emits.
- Claiming that streaming alone materially reduces wall-clock runtime.
  It does not; it improves time-to-first-visible-progress.
- Introducing a persistent long-lived Claude process ("one session,
  many prompts"). Still one subprocess per logical invocation.
- Surfacing every low-level token delta. The signal should be at agent
  turn / tool-call granularity to match the UI pace.

## Background: Claude CLI output formats and speed levers

`claude --print` supports several `--output-format` values. Relevant
here:

| Format | Shape | Emits during run? |
|---|---|---|
| `text` | plain text at end | no |
| `json` | single JSON object at end (what we use today) | no |
| `stream-json` | newline-delimited JSON events during run, then a final usage object | **yes** |

Anthropic's current Claude Code docs also recommend `--bare` for
scripted / SDK calls to reduce startup time by skipping hooks, skills,
plugins, MCP server discovery, auto memory, and `CLAUDE.md` loading.
That is the main documented lever for making `claude -p` itself start
faster.

The official CLI streaming docs show a Claude Code-specific event stream
that includes top-level CLI events such as `system/init` and
`system/api_retry`, plus streamed content events. Their example filters
streamed text from `stream_event` envelopes with nested `.event`
payloads.

The exact `stream-json` event shape must therefore be treated as an
implementation-time contract to validate, not something we infer from
the lower-level Messages API or memory. At minimum we should expect:

```jsonl
{"type":"system","subtype":"init","session_id":"…", ...}
{"type":"stream_event","event":{"type":"message_start", ...}}
{"type":"stream_event","event":{"type":"content_block_start", ...}}
{"type":"stream_event","event":{"type":"content_block_delta", ...}}
{"type":"stream_event","event":{"type":"message_delta", ...}}
{"type":"stream_event","event":{"type":"message_stop"}}
{"type":"result","result":"final assistant text","session_id":"…","usage":{…}}
{"type":"system","subtype":"api_retry","attempt":1,"retry_delay_ms":1000, ...}
```

Exact field names and result-event presence must be confirmed from the
CLI at implementation time. We should NOT rely on memorized shapes or on
the raw Messages API event contract. See **Validation** below.

## Design

### Two things change

1. **Command construction** (`buildClaudeCommand`): swap
   `--output-format json` for `--output-format stream-json`. Add
   `--include-partial-messages` only if we decide we want
   per-token granularity; probably not. Also evaluate `--bare` as the
   default for engine-driven non-interactive runs because Anthropic
   documents it as the recommended startup-time optimization for scripts.
2. **Result handling** (`invokeClaude`): replace the single-JSON parse
   with a stream-aware accumulator that:
   - Subscribes to `spawnCommand`'s existing `onStdoutLine` callback.
   - Parses each JSON line as it arrives.
   - Emits summarizing `presentation` events to the workflow bus for
     tool-use, turn boundaries, and errors (mirror what Codex does now).
   - Accumulates assistant text from `text_delta` events to reconstruct
     `outputText` (the final JSON content envelope our adapters parse).
   - Captures session_id + usage from the terminal `result` event (or
     equivalent stream-final event).

### Separate "faster" from "more visible"

This work should explicitly distinguish:

- **Perceived speed**: delivered by `stream-json` and intermediate
  presentation events.
- **Actual runtime reduction**: delivered by reducing Claude startup and
  prompt/context overhead.

Concrete speed-oriented changes to evaluate in the same implementation or
immediately after:

- Use `--bare` for engine-launched scripted runs unless we confirm the
  engine depends on project/user hooks, plugins, MCP discovery, auto
  memory, or `CLAUDE.md`.
- Re-check the default model choice for story implementation versus
  review, since Anthropic's model guidance treats Haiku-class models as
  the fastest option and recommends choosing the right model for the
  task.
- Keep prompts and requested outputs tight; Anthropic's latency docs
  explicitly recommend reducing prompt/output length.
- Consider `--max-turns` for bounded tasks if current prompts sometimes
  let Claude wander too long.

### Shared helpers to factor out

The retry logic (`isTransientFailure`, `TRANSIENT_RETRY_DELAYS_MS`,
`sleep`, attempt counter) is now duplicated between `claude.ts` and
`codex.ts`. A small shared helper would be welcome but is not strictly
required for this spec; scope strictly to the streaming change plus a
minimal refactor if it keeps the diff clean.

Bus-emission helper (`summarizeStreamEvent`) already exists in
`codex.ts`. Generalize to accept a provider-specific mapping function
so we do not copy the callback plumbing. File layout options:

- `providers/_stream.ts` — shared stream callback factory that takes a
  `summarize(event): { kind, text } | null` mapper.
- Both `claude.ts` and `codex.ts` import it and supply their own
  `summarizeClaudeEvent` / `summarizeCodexEvent`.

### Minimal viable summarizer (Claude)

The first cut should emit a dim event for each:

- `system/init` — "claude: session started"
- `message_start` — "claude: turn started"
- tool-use start event — "claude: tool <name>"
- `message_stop` — "claude: turn completed"
- `result` — "claude: run completed (in=… out=… cache=…)"
- `system/api_retry` — "claude: retrying (attempt X/Y in Z ms)"

Partial text deltas should NOT become presentation events (too noisy).
They feed only the `outputText` accumulator.

Unknown stream event types must be ignored silently. Anthropic's
streaming docs explicitly warn that new event types may be added.

Presentation events must preserve the current `stageRunId` so parallel
story/reviewer runs remain attributable in the UI and persisted logs.
Do not copy Codex's current `stageRunId: null` behavior into Claude.

### outputText reconstruction

Today `invokeClaude` does:

```ts
const parsed = JSON.parse(result.stdout.trim()) as { result?: string, session_id?: string, usage?: {…} }
return { ..., outputText: parsed.result ?? "" }
```

In stream mode, we need to collect the final assistant message text. Two
routes:

1. Prefer the terminal `result` event if present: it should carry the
   full final text. Use that directly — same as today.
2. Fall back to concatenating `text_delta.text` values from all
   streamed `content_block_delta` events whose enclosing
   `content_block_start` was `type: "text"`. Ignore deltas inside
   tool-use / input-json / thinking blocks.

Implement both: trust `result.result` if the event exists; otherwise
reconstruct from deltas.

Do **not** automatically replay the full Claude invocation in `json`
mode merely because the streamed run ended with malformed output or a
missing terminal `result`. For mutating coder-style runs, replay could
repeat edits, tests, or external side effects. If the process exited 0
but the stream was malformed, prefer:

1. returning reconstructed text if available;
2. surfacing a malformed-stream error with captured stdout/stderr if not;
3. only using a degraded re-run in explicitly safe/read-only contexts.

### Error handling

- If a stream line is not valid JSON, ignore it (same as the Codex
  callback). Do not throw.
- If the subprocess exits with a non-zero code, existing transient-retry
  + unknown-session logic still applies. The accumulated stdout is
  available for error context.
- If Claude emits an official `system/api_retry` stream event, surface it
  to the UI instead of inferring retry progress only from local wrapper
  logic.
- If `result` event is never seen but exit is 0: treat as malformed
  output, but do not blindly re-run mutating jobs in degraded mode.
- If our wrapper retries after partial streaming output was already
  emitted, add an explicit retry marker so duplicate attempt output is
  understandable in the UI transcript.

## Implementation Plan

1. **Probe**: run `claude --print --output-format stream-json --model
   claude-haiku-4-5 -p "hi"` against the CLI we're targeting. Capture
   actual event names + shapes into a fixture under
   `apps/engine/test/fixtures/claude-stream-sample.jsonl`. All type
   guessing in this spec must be validated against that sample before
   coding. Also probe with `--verbose` and, separately,
   `--include-partial-messages` so we know exactly which envelope shape
   the engine should support.
2. **Shared stream helper**: `providers/_stream.ts` exporting
   `makeStreamCallback<TEvent>(summarize)` that returns `onStdoutLine`.
3. **Claude adapter changes**:
   - `buildClaudeCommand`: use `stream-json`.
   - Evaluate `--bare` as default for engine-managed runs. If we cannot
     enable it yet, document exactly which loaded features block it.
   - `invokeClaude`: collect stream events; reconstruct outputText,
     session, usage; emit bus events with the active `stageRunId`.
   - Consume documented `system/init` and `system/api_retry` events when
     present.
4. **Codex refactor** (optional same PR): migrate to the shared helper
   so we don't have two divergent stream plumbings.
5. **Tests**:
   - Unit: given the captured stream fixture, `invokeClaude` (with
     `spawn` mocked) produces the right outputText, session, usage.
   - Unit: stream parser tolerates interleaved non-JSON noise.
   - Unit: unknown event types are ignored.
   - Unit: retry marker emission is correct when the first attempt
     already emitted streamed progress.
   - Unit: presentation events preserve `stageRunId`.
   - Unit: malformed successful streams do not trigger unsafe automatic
     replay for mutating runs.
   - Integration: run a no-op prompt end-to-end with the real CLI
     (local-only test, gated by env flag) and assert at least one
     intermediate presentation event arrived.
6. **Rollout**:
   - Gate behind `CLAUDE_STREAM=1` env var for one run, verify UI
     behavior, then flip default.
   - Independently gate `CLAUDE_BARE=1` to verify startup-time wins
     before making it default.
   - Do not keep an unsafe automatic replay path for mutating jobs.

## Risks

- **CLI version drift**: `stream-json` event shapes may change between
  Claude Code CLI releases. Mitigate by (a) the probe/fixture step,
  (b) degraded-mode fallback, (c) tolerating unknown event types
  silently.
- **Wrong envelope assumption**: Claude Code CLI stream output may wrap
  message events in a higher-level envelope such as `stream_event`,
  `system/init`, and `system/api_retry`. Mitigate by treating the
  official CLI docs plus captured fixture as the contract, not the raw
  Messages API docs.
- **Buffer pressure**: very long tool output could bloat stdoutChunks.
  Already a latent concern with the current JSON mode; stream mode is
  not worse. Out of scope.
- **Partial-message chattiness**: emitting every `content_block_delta`
  to the bus would flood the transcript. Spec explicitly limits bus
  emission to turn/tool boundaries.
- **Session-resume compatibility**: current flow writes `session_id`
  from the final `result` event. stream mode must still surface it at
  stream end; verify in the probe step.
- **Unsafe degraded replay**: rerunning a mutating Claude invocation to
  recover a missing `result` could repeat file edits or other side
  effects. Avoid automatic replay outside explicitly safe/read-only
  contexts.
- **False speed claims**: streaming may improve perceived responsiveness
  while leaving total runtime unchanged. Mitigate by measuring startup
  time separately and evaluating `--bare` independently.

## Open Questions

- Can we safely enable `--bare` for all engine-driven Claude runs, or do
  current workflows depend on hooks, plugins, MCP servers, auto memory,
  or `CLAUDE.md` instructions being loaded from the local environment?
- Which exact top-level event envelope does the installed Claude Code
  CLI emit in `stream-json` mode: raw message events, `stream_event`
  wrappers, or a mix depending on flags like `--verbose`?
- Is there a way to signal Claude CLI to emit the text deltas we want
  without also flooding the stream with noisy partial tool-argument
  deltas? The probe should answer this.
- Should we gate this per stage-agent vs reviewer role? Reviewers
  produce one JSON blob, streaming adds little. Possibly skip stream
  mode for `reviewer` role and keep it only for `coder` to minimize
  code paths. Default recommendation: apply to both for consistency
  unless probe data shows reviewer-mode output is incompatible.
- Should retry attempts be visually grouped in the UI, or is an explicit
  `claude: retrying` presentation event sufficient?
- Do we want dedicated `data-kind` values (e.g., `tool-use`) in the UI
  timeline, or keep everything under `dim`? UI-side decision; not a
  blocker for this engine change.

## Acceptance Criteria

1. Running a Ralph story with Claude-code provider produces at least
   one intermediate presentation event per tool call visible in the UI
   transcript, without requiring a page refresh.
2. Those intermediate presentation events are attributed to the active
   `stageRunId`, so parallel stories/reviewers remain distinguishable in
   UI and persisted logs.
3. `claude -p` startup time is measured before/after the change, and
   `--bare` is either adopted with a documented compatibility rationale
   or explicitly rejected with a documented blocker.
4. `outputText` for the same prompt matches what `--output-format json`
   would have returned, character-for-character, when not-degraded.
5. Existing hosted-CLI tests still pass. New tests cover the stream
   path + the degraded-mode fallback.
6. No measurable wall-clock regression on a simple prompt from stream
   parsing alone (<5% overhead), while noting that streaming is not the
   primary runtime optimization.
7. Session resume works across a streamed run (subsequent invocation
   with `--resume <id>` succeeds).

## Out of Scope (Follow-Ups)

- Streaming for OpenCode provider (same pattern, separate spec once
  OpenCode is wired up).
- Replacing the whole "spawn per invocation" model with a persistent
  Claude daemon. Separate, bigger spec.
- Per-tool `data-kind` / severity UI styling for tool events. Covered
  by a future UI-side spec.
