# Messages API Reviewer Path (Hybrid Provider Mode)

## Problem

Haiku per-token is fast, but every Claude Code CLI invocation pays a
fixed startup cost of ~1–3 seconds: Node boot, runtime init, hook /
skill / plugin / MCP-server discovery, CLAUDE.md + auto-memory load,
`--add-dir` filesystem scan, permission graph setup. For short-response
roles like reviewers on Haiku, that overhead is a majority of wall
clock. A typical wave pays this overhead ~6–12 times per story:

- test-writer coder + reviewer
- ralph (one or more cycles)
- ralph review-fix cycles after CodeRabbit / Sonar findings
- per-stage reviewer for brainstorm / requirements / architecture /
  planning / project-review / qa / documentation

Reviewers specifically do **not** need tool use. They receive an
artifact + context and must emit a JSON envelope (`pass / revise /
block`). The full Claude Code agent loop is overkill.

## Goal

Offer a second, opt-in provider path for the reviewer role that skips
Claude Code entirely and calls the Anthropic Messages API
(`@anthropic-ai/sdk`) directly. Expected wall-clock improvement per
reviewer call on Haiku: **2–3×** (no CLI boot, no `--add-dir`, no
permission layer).

The existing Claude Code CLI path **must remain the default** because
that is what the Claude Pro / Max subscription covers. Users who only
have a subscription see no behavioral change.

## Non-Goals

- Replacing Claude Code for coder roles (test-writer, ralph, stage
  agents that create artifacts via tool use). Those still need the
  agent-loop runtime that Claude Code provides.
- Migrating stage agents (brainstorm, requirements, architecture,
  planning) to the API. Those produce artifacts and are currently CLI;
  moving them later is possible but out of scope here.
- Any work that would make subscription auth stop working for the
  default path. Subscription users must keep running end-to-end on
  Claude Code CLI unchanged.

## Provider Model

### Auth modes

| Mode | How selected | Coder path | Reviewer path | Billing |
|---|---|---|---|---|
| `subscription` (default) | no env / no API key | Claude Code CLI | Claude Code CLI | Claude Pro / Max included |
| `hybrid-api` | `ANTHROPIC_API_KEY` set AND `BEERENGINEER_REVIEWER_TRANSPORT=api` | Claude Code CLI | Messages API | Coder tokens on subscription; reviewer tokens billed on Console |

Other combinations (API-key only, CLI-only coders via API) can be added
later; this spec sticks to the two modes above.

### Detection

`apps/engine/src/llm/registry.ts` already resolves `(stage, role) →
runtime descriptor`. Extend the descriptor with an optional
`transport: "cli" | "messages-api"` field.

Selection logic at resolve time:

```ts
if (
  role === "reviewer" &&
  process.env.ANTHROPIC_API_KEY &&
  process.env.BEERENGINEER_REVIEWER_TRANSPORT === "api"
) {
  return { ...base, transport: "messages-api" }
}
return { ...base, transport: "cli" }
```

The env-var gate is explicit rather than auto-enabling whenever an API
key exists, because the user might have an API key for other tools
(e.g. the root Claude Code installation does not need one) and we
should not silently spend Console credits.

### Adapter layering

A new `apps/engine/src/llm/hosted/providers/claude-messages.ts`
implements `HostedProviderAdapter` but against `@anthropic-ai/sdk`
instead of spawning `claude`. It lives next to the existing
`providers/claude.ts`.

`hostedCliAdapter.ts` picks which provider adapter to use based on
`runtime.transport`:

```ts
function providerAdapter(provider: HostedProviderId, transport?: "cli" | "messages-api"): HostedProviderAdapter {
  if (provider === "claude-code" && transport === "messages-api") {
    return { invoke: invokeClaudeMessages }
  }
  switch (provider) {
    case "claude-code": return { invoke: invokeClaude }
    case "codex":       return { invoke: invokeCodex }
    case "opencode":    return { invoke: invokeOpenCode }
  }
}
```

The reviewer's `HostedReviewAdapter` already has a strict JSON contract
(`HostedReviewOutputEnvelope`). The new provider just needs to:

1. Build a Messages API call: `system = <stage reviewer prompt>`,
   `user = <artifact + review context>`, `max_tokens` bounded.
2. Accept optional `session` (ignored — Messages API has no thread
   resume; the review loop still resends context each cycle, matching
   how the CLI reviewer already behaves when its session is fresh).
3. Parse the assistant's JSON output with the same `parseJsonObject`
   helper used by the CLI path.

### Session resume

Messages API has no server-side thread resume equivalent to Claude
Code's `--resume <id>`. That is fine for reviewers because:

- Every review cycle already assembles the artifact + review context
  from scratch (see `ReviewContext { cycle, maxReviews, isFinalCycle,
  priorFeedback }`).
- Cache read on Messages API is turn-local, but because reviewer calls
  share a prompt prefix (system + artifact bones), the Anthropic
  platform's prompt caching can still amortize cost.

For coders we would lose `--resume` if we moved them, which is a real
regression — hence the non-goal above.

### Retry + transient-failure parity

Reuse `isTransientFailure` and the existing retry delays. The Messages
API throws `APIError` with a `status` field for network / rate-limit /
server issues. Treat `status in {408, 409, 500, 502, 503, 504}` as
transient plus network / timeout errors. Unknown-session fallback is a
no-op here.

### Streaming

Messages API streaming is trivial (`client.messages.stream(...)`). Do
it by default and emit the same `presentation / kind: "dim"` events as
the stream-json Claude CLI path:

- `message_start` → `claude: turn started` (prefix matches existing
  stream so UI styling is consistent).
- each `content_block_start` with `type: "tool_use"` → irrelevant for
  reviewers, but pass through for completeness.
- `message_stop` → `claude: turn completed (in=… out=… cache=…)`
- final result → `claude: run completed (…)`

Reuse the existing stream helper in `_stream.ts`; the Messages API
events map 1:1 to the CLI's `stream_event` envelope we already handle.

## Envelope Parity

`HostedReviewOutputEnvelope` = `{ kind: "pass" | "revise" | "block", ... }`.
The reviewer prompt already instructs the model to emit exactly one JSON
object. Reuse `parseJsonObject` + `mapReviewEnvelopeToResponse`
unchanged; the new transport is invisible to the review loop.

## Configuration

`.env.local` example:

```
# Subscription path (default): nothing extra needed.
# Hybrid API path: set both to enable.
ANTHROPIC_API_KEY=sk-ant-…
BEERENGINEER_REVIEWER_TRANSPORT=api
```

Optional tuning knobs:

- `BEERENGINEER_REVIEWER_MODEL` — override reviewer model without
  touching profile config. Defaults to the profile's configured model.
- `BEERENGINEER_REVIEWER_MAX_TOKENS` — cap output tokens. Default 2048
  is plenty for JSON envelopes.

`beerengineer doctor` prints which reviewer transport is active and
flags if `BEERENGINEER_REVIEWER_TRANSPORT=api` is set without a key.

## CLI / UX surface

No change to `beerengineer` commands. The setup preflight just gains
one new line:

```
Reviewer transport: messages-api  (using ANTHROPIC_API_KEY)
```

or:

```
Reviewer transport: cli  (subscription path; set BEERENGINEER_REVIEWER_TRANSPORT=api for faster reviewers)
```

## Testing

- Unit: `invokeClaudeMessages` with a mocked SDK asserts happy path
  (JSON envelope round-trips), retry path (408 → retry → success),
  non-transient path (400 → throw).
- Unit: registry resolves `transport` correctly given combinations of
  env vars.
- Integration (local-only, gated by env flag): run a small stage
  end-to-end against the live Messages API. Assert reviewer events
  emitted and JSON envelope parsed.
- Regression: subscription-only path (no API key) uses CLI for everything
  and passes existing end-to-end tests.

## Rollout Plan

1. Implement `providers/claude-messages.ts` alongside `claude.ts`,
   reusing `_retry.ts` and `_stream.ts`.
2. Extend runtime descriptor with `transport`, wire registry selection.
3. Wire `hostedCliAdapter.providerAdapter` to dispatch by transport.
4. Add doctor + setup preflight messaging.
5. Document in README + `docs/features-doc.md`: "hybrid reviewer
   transport (opt-in)".
6. Land behind the env-var flag; run the helloworld driver with and
   without the flag to measure wall-clock delta.

## Expected Wall-Clock Savings

Rough estimate for a 3-story run on Haiku where reviewers run 4 times
per stage-agent (stage review) + 2 times per ralph cycle:

- ~12 reviewer calls × ~2.5 s CLI-boot overhead = ~30 s saved per run
  floor
- Plus no `--add-dir` scan per reviewer (workspace size dependent, can
  be several seconds more on bigger repos)

Won't change agent-loop wall-clock for coders. Pairs well with
`--max-turns` + tighter coder prompts (separate specs) to get the
compound effect.

## Open Questions

- Should the setup wizard prompt for `ANTHROPIC_API_KEY` when the user
  has both subscription and an interest in faster runs? Default: no
  (explicit opt-in only); reconsider once the feature is proven.
- Do we want a third mode "coders on API too"? Useful when subscription
  is not available at all; covered in a follow-up spec if needed.
- Should reviewer transport be settable per-stage (e.g. project-review
  on CLI for full-repo awareness, brainstorm review on API)? Probably
  yes, but not in v1 — global flag keeps the cognitive load low.

## Rollback

Unset `BEERENGINEER_REVIEWER_TRANSPORT` or remove `ANTHROPIC_API_KEY`
from env. Engine falls back to CLI reviewer on the next run.
