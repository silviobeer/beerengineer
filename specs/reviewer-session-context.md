# LLM Session Resume (All Stages, All Roles)

## Status

Active plan. Quality-first: symmetric treatment of every hosted LLM call
site (stage agents, reviewers, Ralph, test-writer). Builds on top of — does
not replace — `specs/reviewer-loop-awareness.md`.

## Why

BE2 today invokes every LLM through a fresh subprocess (`claude --print …`,
`codex exec …`, etc.). The full conversation has to be re-packed into the
payload on every turn. Two concrete costs:

1. **Context fidelity.** Claude-Haiku and comparable models lose coherence on
   long re-packed payloads; native conversation threading is markedly more
   consistent in multi-turn stages (brainstorm, Ralph iterations).
2. **Token cost.** Every turn pays full input-token cost. Prompt caching is
   left on the table. On long runs (execution + full review chain) this is
   measurable.

Native session resume on the provider side fixes both.

## Scope — every hosted LLM call site

BE2 drives four kinds of hosted LLM calls; all four get session resume:

| Call site                       | File                                        | Turns per instance | Gain     |
| ------------------------------- | ------------------------------------------- | ------------------ | -------- |
| Stage agent (produce artifact)  | `llm/hosted/hostedCliAdapter.ts` → `step`   | 1–4 (brainstorm up to ~8) | **huge** for brainstorm; solid elsewhere |
| Reviewer (pass/revise/block)    | same file → `review`                        | 1–4 per stage      | moderate — cache on stable prefix, native memory of own prior verdicts |
| Ralph (story implementer)       | `stages/execution/ralphRuntime.ts`          | 10–30 per story    | **huge** — iterative, heavy payload re-pack today |
| Test-writer (stage agent variant) | `stages/execution/index.ts`              | 1–4 per story      | moderate |

External review tools (CodeRabbit CLI, sonar-scanner) are not LLM calls and
are out of scope.

## Per-stage impact

| Stage          | Stage agent turns     | Reviewer cycles | Ralph iterations (execution) | Session ROI |
| -------------- | --------------------- | --------------- | ---------------------------- | ----------- |
| brainstorm     | 3–8 (Q&A with user)   | 1–4             | —                            | **very high** |
| requirements   | 1–4                   | 1–4             | —                            | moderate    |
| architecture   | 1–4                   | 1–4             | —                            | moderate    |
| planning       | 1–4                   | 1–4             | —                            | moderate    |
| execution      | 1 (coordinator)       | 1–4 per story (test-writer) | 10–30 per story | **very high** (Ralph) |
| project-review | 1                     | 1–4             | —                            | low         |
| qa             | 1–4                   | 1–4             | —                            | low         |
| documentation  | 1–4                   | 1–4             | —                            | low         |

## Architecture — two orthogonal layers

Session resume and structured context are **independent** and both stay
active. Neither replaces the other.

### Layer 1 — Session resume (free-form thread)

Anthropic / OpenAI host the conversation. We capture the provider's
session-id on turn 1 and pass it on every subsequent turn. Claims:

- natural memory of prior turns;
- prompt-cache hit on stable prefix;
- no serialisation of conversation state on our side.

### Layer 2 — Structured context payload (deterministic bookkeeping)

Even when a session is alive, we inject structured counters + history into
the payload. See `reviewer-loop-awareness.md` for the reviewer-side struct;
symmetric structs exist for stage agents and Ralph.

Why we keep this layer even with sessions:

1. **LLMs count badly.** "Which cycle am I on?" is too important to trust
   to heuristic session reasoning.
2. **`isFinalCycle` is a hard trigger.** Converting `revise` → `block` on
   the final cycle must be deterministic.
3. **Session loss is possible.** Anthropic/OpenAI session TTLs, process
   crashes, provider-less setups (opencode, fake) — the structured context
   is the durable source of truth.
4. **Audit trail.** `priorFeedback` / `priorAttempts` as structured arrays
   are reconstructible from `stage_logs`; session memory is not audit-able.

## Provider support

Verified via CLI probes on 2026-04-23:

- **claude (`@anthropic-ai/claude-code`)**
  - Session-id source: `claude --print --output-format json` emits
    `result.session_id` (UUID).
  - Resume: `claude --print --resume <session-id> -p "<prompt>"`.
  - Cache stats: `usage.cache_creation_input_tokens`,
    `usage.cache_read_input_tokens`.

- **codex (`@openai/codex`)**
  - Session-id source: `codex exec --json` emits
    `{"type":"thread.started","thread_id":"<UUID>"}` as the first event.
  - Resume: `codex exec resume <uuid> "<prompt>"`.
  - Cache stats: `turn.completed.usage.cached_input_tokens`.

- **opencode** — session support status TBD; probe during implementation.
  Falls back to stateless-with-context if no resume mechanism exists.

- **fake (tests)** — `sessionId` is always `null`; `resumeSession` is never
  reached.

## Unified abstraction

Add to `apps/engine/src/llm/hosted/`:

```ts
export type HostedSession = {
  provider: HostedProviderId
  sessionId: string | null
}

export interface HostedProviderAdapter {
  // Existing: build a command for a single-shot invocation.
  buildCommand(input: {...}): string[]

  // New: start OR resume a session. Returns the (possibly-new) session id.
  invoke(input: {
    prompt: string
    session?: HostedSession   // falsy → start fresh
    runtime: { ...existing... }
  }): Promise<{
    session: HostedSession    // always returned, even if null (provider-less)
    outputText: string
    cacheStats?: {
      cachedInputTokens: number
      totalInputTokens: number
    }
  }>
}
```

Providers that lack a session concept return `{session: {provider, sessionId: null}, outputText}` and the engine falls back to stateless payload-injection automatically.

## Data model

Schema additions on `stage_runs` (idempotent migration in `db/connection.ts`):

```sql
ALTER TABLE stage_runs ADD COLUMN stage_agent_session_id TEXT;
ALTER TABLE stage_runs ADD COLUMN reviewer_session_id TEXT;
```

Test-writer turns are persisted under the same `stage_agent_session_id`
mechanism when they execute through the stage-agent path. No separate DB
column is needed unless implementation later proves test-writer to have an
independent runtime identity.

For Ralph iterations: store session id on whatever per-story state file
`ralphRuntime.ts` already persists under
`.beerengineer/workspaces/<slug>/…/stories/<id>/implementation.json` — add
a `coderSessionId?: string` field. No schema migration needed.

## Structured context payloads

Three context structs, injected on every turn regardless of session status:

```ts
// Stage agent (all stages)
type StageContext = {
  turnCount: number        // 1-based; number of step() calls so far including this one
  turnLimit?: number       // present for stages with a soft cap (e.g. brainstorm targetQuestions + slack)
  phase: "begin" | "user-message" | "review-feedback"
  priorFeedback?: Array<{cycle: number; outcome: string; text: string}>  // only on review-feedback
}

// Reviewer (all stages) — defined in reviewer-loop-awareness.md
type ReviewContext = {
  cycle: number
  maxReviews: number
  isFinalCycle: boolean
  priorFeedback: Array<{cycle: number; outcome: "revise"|"block"; text: string}>
}

// Ralph (execution coder)
type IterationContext = {
  iteration: number        // 1-based
  maxIterations: number
  reviewCycle: number      // 1-based
  maxReviewCycles: number
  priorAttempts: Array<{
    iteration: number
    summary: string
    outcome: "passed" | "failed" | "blocked"
  }>
}
```

These are embedded into the `Payload:` JSON of the prompt envelope (see
`promptEnvelope.ts`).

Important limit: `StageContext` is deterministic bookkeeping, not a full
conversation transcript. It preserves turn/cycle semantics, but on
dialog-heavy stages (especially brainstorm) it is **not** sufficient by
itself to recreate the exact prior conversation after provider-side session
loss. For those stages, correctness after session loss requires rebuilding a
compact transcript from persisted stage logs or message history and injecting
it into the prompt envelope alongside `StageContext`.

## Prompt changes

Three existing locations get a "Session & Cycle discipline" block appended:

- `prompts/system/_default.md` → stage-agent default system prompt picks up:
  "If this is not your first turn, the previous turns of this stage are in
  your session. The payload's `stageContext` gives you the authoritative turn
  counters. Do not repeat questions you have already asked the user."

- `prompts/reviewers/_default.md` → as specified in
  `reviewer-loop-awareness.md` (cycle discipline, final-cycle handling,
  contradiction check).

- `prompts/workers/execution.md` (Ralph) → "If this is not your first
  iteration, prior iterations of this story are in your session. The
  payload's `iterationContext` gives you the authoritative counters and a
  summary of prior failed attempts. Do not re-attempt a strategy that prior
  attempts already failed with."

## Recovery / resume semantics

Session loss is a normal operational condition, not an error:

1. After a process crash, a run resumes from the persisted `stage_runs`
   row and whatever is on disk. The `stage_agent_session_id` /
   `reviewer_session_id` column is read.
2. The engine attempts `resumeSession(sessionId, prompt)`. If the provider
   returns an explicit "unknown session" / "expired session" style error,
   the adapter falls back to `invoke({prompt, session: null})` and persists
   the new session id over the old.
3. Transient or infrastructural failures (network errors, provider 5xx,
   rate limits, local CLI failure) do **not** trigger a silent fresh-session
   fallback. Those follow the normal retry/fail path so operational problems
   remain visible.
4. The structured context payload (Layer 2) is always rebuilt from durable
   state. For reviewers, this is enough to restore cycle/feedback history on
   a fresh session. For dialog-heavy stage agents, the engine must also
   rebuild and inject a compact prior transcript from persisted logs/history;
   otherwise only the counters survive, not the prior discussion itself.
5. Ralph recovery follows the same rule: persisted `priorAttempts` must come
   from durable per-story state, not heuristic summarisation at resume time.

## Ralph persistence requirement

`IterationContext.priorAttempts` must be reconstructed deterministically.
That means each Ralph attempt needs a persisted summary/outcome record in the
story state as it happens; stage logs alone are not assumed to contain a
sufficiently stable summary. If current `implementation.json` does not yet
store this, extend it with something like:

```ts
type RalphAttemptRecord = {
  iteration: number
  summary: string
  outcome: "passed" | "failed" | "blocked"
}
```

and persist it incrementally so resume can rebuild `priorAttempts` without
LLM-side or runtime-side guesswork.

## Telemetry

Emit on every hosted invocation:

```
llm.invocation  provider=claude session=resumed cachedTokens=10624 totalTokens=12006
llm.invocation  provider=claude session=started cachedTokens=0 totalTokens=34891
```

This lets us measure cache-hit ratio per provider/stage and decide whether
the investment pays off.

## README / docs updates

This change alters operator-visible runtime behaviour and internal engine
architecture, so the landing should explicitly include documentation updates
instead of treating them as optional cleanup.

Update at least:

- `README.md` — document that hosted providers may now resume native sessions
  across stage-agent, reviewer, Ralph, and test-writer turns; mention the
  operational benefit (better multi-turn coherence, lower repeated prompt
  cost) and that providers without session support still fall back to the
  existing stateless prompt envelope.
- `apps/engine/docs/technical-doc.md` — document the two-layer design:
  1. provider-native session resume for conversational continuity/cache hits;
  2. structured context payloads as the deterministic source of truth for
     cycle counters, final-cycle semantics, and crash recovery.
- If repo-root `docs/technical-doc.md` is still surfaced to users or kept as
  a parallel canonical reference, update it in the same change; otherwise do
  not split ownership between the two files.
- Any setup or troubleshooting doc that covers hosted providers should add a
  short note on recovery semantics: persisted session ids are best-effort,
  explicit "unknown/expired session" is handled by starting a fresh session,
  and other provider/runtime failures do not silently downgrade into a new
  session.

Docs should avoid overselling provider parity. `opencode` remains explicitly
documented as "resume support TBD / stateless fallback if unsupported" until
implementation proves otherwise.

## Files touched

| File                                                           | Change |
| -------------------------------------------------------------- | ------ |
| `apps/engine/src/llm/hosted/hostedCliAdapter.ts`               | drop current single-call path; route through `invoke` |
| `apps/engine/src/llm/hosted/providers/{claude-code,codex,opencode}.ts` | implement `invoke` with resume semantics |
| `apps/engine/src/llm/hosted/promptEnvelope.ts`                 | embed `stageContext`/`reviewContext`/`iterationContext` |
| `apps/engine/src/core/adapters.ts`                             | extend `StageAgentInput` with `stageContext`; review input gets `reviewContext` (from loop-awareness spec) |
| `apps/engine/src/core/stageRuntime.ts`                         | own session lifecycle for stage agent + reviewer; persist session ids to `stage_runs` |
| `apps/engine/src/stages/execution/ralphRuntime.ts`             | own session lifecycle for Ralph; persist `coderSessionId` in implementation.json |
| `apps/engine/src/db/schema.sql` + `db/connection.ts`           | idempotent migrate of two new columns |
| `prompts/system/_default.md`                                   | new "Session & Turn discipline" block |
| `prompts/reviewers/_default.md`                                | new "Cycle discipline" block (from loop-awareness spec) |
| `prompts/workers/execution.md`                                 | new "Iteration & Session discipline" block |
| `README.md`                                                    | describe hosted session resume and fallback semantics at a user/operator level |
| `apps/engine/docs/technical-doc.md`                               | document the layered session-resume architecture and recovery model |
| `docs/technical-doc.md`                                           | update only if it is still treated as user-facing or canonical in this repo |
| tests                                                          | new integration tests exercising resume path + fallback path |

## Relation to `reviewer-loop-awareness.md`

The two specs are additive, not alternative:

- **Loop-awareness** is the narrower, self-contained fix: inject structured
  cycle + feedback into reviewer payload; convert `revise` on final cycle
  to `block`. Can land standalone in ~1 hour and fixes 80% of the
  immediate reviewer pain without any session infrastructure.
- **Session-resume** (this doc) is the broader quality investment: native
  conversation memory + cache discount for every hosted LLM call site.
  Requires schema change, provider abstractions, and prompt updates.

Recommended landing order:

1. Ship loop-awareness first — low risk, immediate reviewer behaviour
   improvement.
2. Ship session-resume next — carries the structured-context plumbing
   through, adds native memory on top.

## Effort

Rough estimate, end-to-end:

- Schema migration + adapter abstraction: ~2h
- claude + codex resume implementation + tests: ~3h
- Ralph + test-writer + reviewer integration: ~2h
- Prompt updates + telemetry + fallback tests: ~2h
- README + technical-doc updates: ~0.5h
- End-to-end verification against helloworld: ~1h

**Total: ~10.5h focused work.** Loop-awareness (1h) stays its own separate
landing as a fast-follow risk-reducer.
