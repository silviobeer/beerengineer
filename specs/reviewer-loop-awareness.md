# Reviewer Loop Awareness (Simple Fix)

## Problem

Reviewer LLMs in `runStage` are called fresh each review cycle via
`ReviewAgentAdapter.review({ artifact, state })`. They see the current artifact
and stage-specific state, but **not**:

- which review cycle they are on (1st, 2nd, …);
- how many cycles remain before `maxReviews` is exhausted and the run blocks;
- what they themselves said in previous cycles.

Three observable consequences:

1. **Ping-pong** — cycle 1 asks for "more error handling", cycle 2 (without
   memory) calls the same code "over-engineered" and asks for removal. Cycles
   3+ repeat the oscillation until the run is blocked.
2. **Repeated nitpicks** — without `priorFeedback`, later cycles re-raise
   points the stage already addressed, wasting the cycle budget.
3. **No convergence pressure** — the reviewer has no notion of "this is the
   final cycle", so it keeps asking for revisions on non-material issues until
   `maxReviews` hard-cuts the run into `blocked`.

## Non-Goals

- **No long-lived LLM sessions.** The existing stateless-per-call architecture
  stays; sessions are tracked separately in
  `specs/reviewer-session-context.md`.
- **No automatic "fix log" persistence** beyond what the reviewer is told in
  `priorFeedback`. Diff and commit log remain the source of truth for what
  actually changed.
- **No hard "approve if final cycle" shortcut.** Convergence pressure is a
  prompt hint, not a control-flow override — real blockers must still block.

## Design

### New type: `ReviewContext`

Added to `apps/engine/src/core/adapters.ts`:

```ts
export type ReviewContext = {
  cycle: number              // 1-based — "this is your Nth review"
  maxReviews: number         // hard cap for this stage
  isFinalCycle: boolean      // cycle === maxReviews
  priorFeedback: Array<{
    cycle: number
    outcome: "revise" | "block"
    text: string             // feedback or reason from that earlier cycle
  }>
}
```

### Signature change

`ReviewAgentAdapter.review` gains an optional `reviewContext`:

```ts
interface ReviewAgentAdapter<S, A> {
  review(input: {
    artifact: A
    state: S
    reviewContext?: ReviewContext
  }): Promise<ReviewAgentResponse>
}
```

Optional for backwards compatibility with fake adapters in tests.

### Runtime plumbing

`core/stageRuntime.ts` already owns `run.reviewIteration` and logs every
`review_revise` and `review_block` entry into `run.logs`. We:

1. Maintain a per-stage `priorFeedback: Array<{cycle, outcome, text}>` while
   the loop runs (populated after each non-pass review).
2. Before calling `definition.reviewer.review(...)`, construct
   `reviewContext = { cycle: run.reviewIteration + 1, maxReviews,
   isFinalCycle: run.reviewIteration + 1 === maxReviews, priorFeedback }`
   and pass it.
3. After the reviewer returns `revise`/`block`, append
   `{cycle: run.reviewIteration, outcome, text}` to `priorFeedback`.

`priorFeedback` can be reconstructed on resume from `run.logs` (which survive
restarts), so the simple-fix does not introduce any new persisted state.

### Revise-on-final-cycle handling

If the reviewer returns `{kind: "revise"}` while `isFinalCycle === true`,
`runStage` logs a warning and converts it to `{kind: "block", reason:
"reviewer returned revise on the final cycle: <feedback>"}`. The revise text
is not lost — it lands in the stage's `blocked` reason and in the resume UI.

Pseudocode:

```ts
if (review.kind === "revise" && run.reviewIteration >= definition.maxReviews) {
  pushLog(run, { type: "review_revise_on_final", message: review.feedback })
  setStatus(run, "blocked")
  await persistRun(run)
  const reason = `reviewer returned revise on final cycle: ${review.feedback}`
  await recordStageBlocked(run, "review_revise_on_final", reason,
                            { detail: review.feedback })
  throw new Error(reason)
}
```

### Hosted adapter (claude/codex/opencode)

`HostedReviewAdapter.review` forwards the context into the review envelope:

```ts
buildReviewPrompt({
  stageId, provider, model, runtimePolicy,
  request: { artifact, state },
  reviewContext,          // NEW
})
```

`buildReviewPrompt` embeds two new JSON-addressable sections in the prompt:

```
Review Cycle:
{ "cycle": 2, "maxReviews": 4, "isFinalCycle": false, "remainingCycles": 2 }

Prior Feedback (most recent first):
[
  { "cycle": 1, "outcome": "revise",
    "text": "Users array too generic — list concrete user types." }
]
```

Absent when `reviewContext` is undefined (preserves current test semantics for
fake adapters).

### Prompt changes

`prompts/reviewers/_default.md` gets a new **Cycle Discipline** block that
applies to all reviewers:

```
## Cycle discipline

You are called repeatedly until you return "pass", you return "block", or the
cycle budget is exhausted. Read the "Review Cycle" and "Prior Feedback"
sections in the payload before you respond.

- Do not repeat points that were addressed between cycles. If the diff shows
  the feedback from cycle N-1 was applied, acknowledge and move on.
- Contradiction check: do not reverse your own prior opinion unless something
  material changed. If the stage followed your earlier guidance, that guidance
  is now a commitment — not a new debate.
- On the final cycle (`isFinalCycle: true`), "revise" is effectively "block"
  — the stage will fail. Prefer "pass" on clean-but-imperfect artifacts; only
  block if something is materially broken or unsafe.
- Prior feedback that was already satisfied must not drive a new revise.
```

Per-stage reviewer prompts (`brainstorm.md`, `requirements.md`, …) stay
unchanged. The cross-cutting discipline sits in `_default.md` alongside the
existing role/focus language.

### Fake adapters

`src/llm/fake/*Review.ts` receive the `reviewContext` argument but may ignore
it. Tests that assert deterministic revise/pass sequences remain unchanged —
fake logic is driven by `input.reviewCycle` / story id already.

### Test coverage

New unit tests:

- `stageRuntime` passes a `reviewContext` with correct `cycle`, `maxReviews`,
  `isFinalCycle`, and a growing `priorFeedback` list across a 3-cycle revise
  sequence.
- `revise` on the final cycle is converted to `block` and the feedback text is
  preserved in the `blocked` reason.
- Existing fake-review tests stay green (backwards compatible).

## Files touched

| File                                                           | Change |
| -------------------------------------------------------------- | ------ |
| `apps/engine/src/core/adapters.ts`                             | add `ReviewContext`; optional param on `review()` |
| `apps/engine/src/core/stageRuntime.ts`                         | build + pass context; convert revise-on-final to block |
| `apps/engine/src/llm/hosted/hostedCliAdapter.ts`               | thread `reviewContext` into `buildReviewPrompt` |
| `apps/engine/src/llm/hosted/promptEnvelope.ts`                 | accept + embed `reviewContext` in the prompt |
| `apps/engine/prompts/reviewers/_default.md`                    | add "Cycle discipline" block |
| `apps/engine/test/stageRuntime.test.ts` (or new file)          | new unit tests |

Fake-adapter files do not need changes — the new param is optional.

## Out of scope

Everything related to stateful LLM sessions, interactive `claude` processes,
Messages-API migration, or prompt caching is in
`specs/reviewer-session-context.md`.

## Effort

~1 hour. Single-file change per layer, mostly additive. No schema migration.
165 existing tests should stay green; ~5 new tests for the loop-awareness
plumbing.
