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

Runtime env knobs (read at resolve time, no restart needed for next
run):

```
# Subscription path (default): nothing extra needed.
# Hybrid API path: set both to enable.
ANTHROPIC_API_KEY=sk-ant-…              # user-scoped secret, NOT in workspace.json
BEERENGINEER_REVIEWER_TRANSPORT=api     # workspace-scoped opt-in
```

Optional tuning knobs:

- `BEERENGINEER_REVIEWER_MODEL` — override reviewer model without
  touching profile config. Defaults to the profile's configured model.
- `BEERENGINEER_REVIEWER_MAX_TOKENS` — cap output tokens. Default 2048
  is plenty for JSON envelopes.

### Where the API key lives

`ANTHROPIC_API_KEY` is a secret. It must **never** be written into
`workspace.json` (which is committed) and the setup must be explicit
about where it goes. Recommended precedence, highest wins:

1. Process env (CI / ad-hoc `ANTHROPIC_API_KEY=… npx beerengineer …`)
2. User-scoped `~/.config/beerengineer/.env`
3. Workspace `.env.local` — gitignored; only if the user explicitly
   chose per-workspace during setup

The workspace `.env.local` option is there for users who want a
workspace-local override (e.g. testing with a sandbox key) but setup
must verify `.env.local` is covered by `.gitignore` before writing.
Refuse to write the key into any file that is not gitignored.

`BEERENGINEER_REVIEWER_TRANSPORT=api` is not secret and can live
anywhere. Put it in `.env.local` by default.

## Setup Integration

The subscription path must remain the zero-config default. Users who
only have Claude Pro / Max see no new prompts and nothing changes.

Users who opt in get a new step during `beerengineer workspace add`
and in `beerengineer setup`. Concretely:

### New interactive step: reviewer transport

Slots in after the SonarCloud / CodeRabbit preflight, before the final
workspace.json write:

```
Reviewer transport:
  [1] Subscription (default) — Claude Code CLI for coders and reviewers
      Works with Claude Pro / Max. Slowest option on Haiku because every
      reviewer call pays CLI startup.
  [2] Hybrid (faster) — Claude Code CLI for coders, Anthropic API for reviewers
      Needs an Anthropic Console API key (separate from the subscription).
      Reviewer calls skip CLI boot → ~2-3x faster on Haiku.
      Estimated additional cost: ~$0.01 per run with Haiku (tracked below).

Choose (1/2) [1]:
```

If user picks (2):

1. Prompt for `ANTHROPIC_API_KEY` (hidden input). Accept empty →
   downgrade to (1) with a warning.
2. Validate the key with a minimal live call:
   `messages.create({ model: haiku-4-5, max_tokens: 1, messages: [{role: "user", content: "ok"}] })`.
   If it fails (401, network, quota), show the error and offer retry
   or downgrade.
3. Ask where to persist:
   - `[a]` user-scoped `~/.config/beerengineer/.env` (recommended;
     applies to all workspaces)
   - `[b]` workspace `.env.local` (only this workspace; must be
     gitignored)
4. Write `BEERENGINEER_REVIEWER_TRANSPORT=api` to workspace `.env.local`
   either way.

If user picks (1) or opts out: write
`BEERENGINEER_REVIEWER_TRANSPORT=cli` (or just omit) and move on.

### Non-interactive setup

`beerengineer setup --no-interactive` honors env variables already
present:

- If `ANTHROPIC_API_KEY` is set **and** `BEERENGINEER_REVIEWER_TRANSPORT`
  is unset → emit a note recommending `=api` but default to `cli`. Do
  not silently opt in.
- If both are set → validate key and persist preflight accordingly.
- If transport is `api` but no key is available → fail the preflight
  with a clear error.

### workspace.json changes

Add one non-secret field to the preflight block:

```json
{
  "preflight": {
    "reviewerTransport": "cli" | "messages-api",
    "reviewerTransportValidatedAt": "2026-04-23T…"
  }
}
```

`reviewerTransportValidatedAt` is the timestamp of the last successful
live probe. Stale > 30 days → doctor re-probes.

### doctor checks

Add a "Reviewer transport" check group:

- **transport declared**: workspace.json has the field set (warns on
  missing → offers to default to "cli").
- **api key present** (only if transport = api): key is readable from
  user-scoped or workspace env.
- **api key valid** (only if transport = api): probe with a 1-token
  messages call; pass / fail.
- **fallback reachable**: `claude --version` works, so a fallback to
  CLI reviewer is possible if the API path breaks.
- **cost tracking hint** (info, not pass/fail): print cumulative
  reviewer-token cost over the last 7 days if the engine has been
  logging it.

Existing workspaces without the field get an info-level nudge:
"Fast reviewers available: run `beerengineer workspace upgrade
--reviewer-transport` to opt in." No forced migration.

### Graceful degradation at runtime

If the live reviewer call fails with 401 / 403 (key invalidated) or
sustained 429 (rate limit) despite retries, the hybrid adapter
transparently falls back to the CLI reviewer for that call, emits a
`presentation / kind: "warn"` event explaining the downgrade, and
continues. The run does not fail for a reviewer-transport hiccup.

The registry exposes both adapters; the hybrid adapter orchestrates the
fallback so the upstream review loop is unaware.

### Cost transparency

Before opt-in, the setup wizard shows a rough estimate based on
profile + typical story count:

```
Estimated additional reviewer cost with messages-api transport:
  Haiku:         ~$0.005 – $0.02 per run
  Sonnet:        ~$0.03 – $0.10 per run
  Opus:          ~$0.20 – $0.60 per run
(tracked automatically in workspace.json after each run)
```

After each run with transport=api, the engine records actual
reviewer-token spend and updates a rolling 7-day total in
`workspace.json.preflight.reviewerCost7d`. Doctor surfaces this.

### Security guardrails

- Setup refuses to write `ANTHROPIC_API_KEY` into any file unless it
  verified the path is gitignored.
- The engine redacts `sk-ant-…` prefixes in every log emit path.
- `beerengineer doctor --redact-keys` (existing behavior) continues to
  work; extend it to wipe the new env variables from any captured
  diagnostics.

### Profile orthogonality

`profile.mode` (fast / balanced / thorough) stays one-dimensional and
controls model/policy choices per role. `reviewerTransport` is
orthogonal: every (profile × transport) combination is legal.

| profile.mode | reviewerTransport | Intended use |
|---|---|---|
| fast | cli | Subscription-only demos, smallest dep surface |
| fast | messages-api | Subscription + a bit of API spend for faster reviewers |
| thorough | cli | Subscription with stronger coder models; reviewers are CLI too |
| thorough | messages-api | Mixed: heavy coder calls on subscription, light reviewers on API |

### Documentation impact

- `README.md`: one paragraph describing the two modes and when to
  choose which.
- `docs/features-doc.md`: add to the provider-resilience section.
- `docs/setup-for-dummies.md`: new "Reviewer transport" subsection
  with step-by-step for picking + where to get an API key
  (console.anthropic.com).
- `docs/known-issues.md`: note that the hybrid mode does not use
  subscription billing for reviewer tokens and that the first-run
  probe costs a token.

### Rollout order (revised)

1. Implement `providers/claude-messages.ts` + registry `transport`
   selection (backward compatible: nothing changes for existing runs).
2. Add workspace.json `preflight.reviewerTransport` field with default
   `"cli"`; migration emits a note on first doctor run.
3. Extend `workspace add` + `setup` with the new interactive step.
4. Doctor + preflight output.
5. Docs updates + setup-for-dummies.
6. Flip rollout flag; run helloworld driver with + without API mode to
   measure wall-clock delta and publish in the spec's "Expected Wall-
   Clock Savings" section.

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
