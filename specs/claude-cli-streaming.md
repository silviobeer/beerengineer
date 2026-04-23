# Claude CLI Live Event Streaming

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

Specifically:

- Each `claude --print` invocation uses a streaming format.
- Progress events arrive in the UI transcript with `presentation` /
  `kind: "dim"` (or a dedicated kind for tool boundaries).
- Transient-retry behavior is preserved: if the stream terminates
  abnormally, retry semantics from commit `adadb0c` still apply.
- Session-resume, cache stats, and `outputText` extraction still work.
- No behavioral regression for callers of `invokeClaude`.

## Non-Goals

- Re-implementing the agent loop. We only mirror events Claude CLI
  already emits.
- Introducing a persistent long-lived Claude process ("one session,
  many prompts"). Still one subprocess per logical invocation.
- Surfacing every low-level token delta. The signal should be at agent
  turn / tool-call granularity to match the UI pace.

## Background: Claude CLI output formats

`claude --print` supports several `--output-format` values. Relevant
here:

| Format | Shape | Emits during run? |
|---|---|---|
| `text` | plain text at end | no |
| `json` | single JSON object at end (what we use today) | no |
| `stream-json` | newline-delimited JSON events during run, then a final usage object | **yes** |

The `stream-json` event shape (as documented / observable) is something
like:

```jsonl
{"type":"message_start", "message":{...}}
{"type":"content_block_start", "index":0, "content_block":{"type":"text"}}
{"type":"content_block_delta", "index":0, "delta":{"type":"text_delta","text":"…"}}
{"type":"content_block_stop", "index":0}
{"type":"tool_use_start", "index":1, "tool":"Read", "name":"Read"}
{"type":"content_block_stop", "index":1}
{"type":"message_stop"}
{"type":"result", "result":"final assistant text", "session_id":"…", "usage":{…}}
```

Exact event names must be confirmed from the CLI at implementation time
— we should NOT rely on memorized shapes. See **Validation** below.

## Design

### Two things change

1. **Command construction** (`buildClaudeCommand`): swap
   `--output-format json` for `--output-format stream-json`. Add
   `--include-partial-messages` only if we decide we want
   per-token granularity; probably not.
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

- `message_start` — "claude: turn started"
- `tool_use_start` — "claude: tool <name>"
- `message_stop` — "claude: turn completed"
- `result` — "claude: run completed (in=… out=… cache=…)"

Partial text deltas should NOT become presentation events (too noisy).
They feed only the `outputText` accumulator.

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
   `content_block_delta` events whose enclosing `content_block_start`
   was `type: "text"`. Ignore deltas inside tool_use blocks.

Implement both: trust `result.result` if the event exists; otherwise
reconstruct from deltas. Validate at startup that at least one path
produced non-empty text; if both are empty, fall back to the current
single-JSON path (re-run with `--output-format json`) before failing.

### Error handling

- If a stream line is not valid JSON, ignore it (same as the Codex
  callback). Do not throw.
- If the subprocess exits with a non-zero code, existing transient-retry
  + unknown-session logic still applies. The accumulated stdout is
  available for error context.
- If `result` event is never seen but exit is 0: treat as malformed
  output; retry once with `--output-format json` (degraded-mode
  fallback) before raising.

## Implementation Plan

1. **Probe**: run `claude --print --output-format stream-json --model
   claude-haiku-4-5 -p "hi"` against the CLI we're targeting. Capture
   actual event names + shapes into a fixture under
   `apps/engine/test/fixtures/claude-stream-sample.jsonl`. All type
   guessing in this spec must be validated against that sample before
   coding.
2. **Shared stream helper**: `providers/_stream.ts` exporting
   `makeStreamCallback<TEvent>(summarize)` that returns `onStdoutLine`.
3. **Claude adapter changes**:
   - `buildClaudeCommand`: use `stream-json`.
   - `invokeClaude`: collect stream events; reconstruct outputText,
     session, usage; emit bus events.
4. **Codex refactor** (optional same PR): migrate to the shared helper
   so we don't have two divergent stream plumbings.
5. **Tests**:
   - Unit: given the captured stream fixture, `invokeClaude` (with
     `spawn` mocked) produces the right outputText, session, usage.
   - Unit: stream parser tolerates interleaved non-JSON noise.
   - Integration: run a no-op prompt end-to-end with the real CLI
     (local-only test, gated by env flag) and assert at least one
     intermediate presentation event arrived.
6. **Rollout**:
   - Gate behind `CLAUDE_STREAM=1` env var for one run, verify UI
     behavior, then flip default.
   - Keep a fallback code path that switches to `json` format on
     repeated stream parse failures.

## Risks

- **CLI version drift**: `stream-json` event shapes may change between
  Claude Code CLI releases. Mitigate by (a) the probe/fixture step,
  (b) degraded-mode fallback, (c) tolerating unknown event types
  silently.
- **Buffer pressure**: very long tool output could bloat stdoutChunks.
  Already a latent concern with the current JSON mode; stream mode is
  not worse. Out of scope.
- **Partial-message chattiness**: emitting every `content_block_delta`
  to the bus would flood the transcript. Spec explicitly limits bus
  emission to turn/tool boundaries.
- **Session-resume compatibility**: current flow writes `session_id`
  from the final `result` event. stream mode must still surface it at
  stream end; verify in the probe step.

## Open Questions

- Is there a way to signal Claude CLI to also emit token deltas we want
  to forward without also emitting deltas inside tool args (those are
  noisy and harmful to display)? The probe should answer this.
- Should we gate this per stage-agent vs reviewer role? Reviewers
  produce one JSON blob, streaming adds little. Possibly skip stream
  mode for `reviewer` role and keep it only for `coder` to minimize
  code paths. Default recommendation: apply to both for consistency
  unless probe data shows reviewer-mode output is incompatible.
- Do we want dedicated `data-kind` values (e.g., `tool-use`) in the UI
  timeline, or keep everything under `dim`? UI-side decision; not a
  blocker for this engine change.

## Acceptance Criteria

1. Running a Ralph story with Claude-code provider produces at least
   one intermediate presentation event per tool call visible in the UI
   transcript, without requiring a page refresh.
2. `outputText` for the same prompt matches what `--output-format json`
   would have returned, character-for-character, when not-degraded.
3. Existing hosted-CLI tests still pass. New tests cover the stream
   path + the degraded-mode fallback.
4. No measurable wall-clock regression on a simple prompt (<5%
   overhead from stream parsing).
5. Session resume works across a streamed run (subsequent invocation
   with `--resume <id>` succeeds).

## Out of Scope (Follow-Ups)

- Streaming for OpenCode provider (same pattern, separate spec once
  OpenCode is wired up).
- Replacing the whole "spawn per invocation" model with a persistent
  Claude daemon. Separate, bigger spec.
- Per-tool `data-kind` / severity UI styling for tool events. Covered
  by a future UI-side spec.
