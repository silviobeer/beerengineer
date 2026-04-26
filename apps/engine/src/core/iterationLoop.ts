/**
 * A small "iterate-then-review with feedback" loop helper.
 *
 * Many engine workflows share the same shape: run up to N review cycles,
 * each producing either a terminal `done` result, a `continue` outcome
 * with feedback to seed the next cycle, or an explicit `exhausted`
 * outcome that short-circuits the loop. The Ralph implementation loop
 * was the first concrete user; future stages (e.g. requirements
 * refinement, design polish) can reuse the same cadence without
 * re-implementing the counter + feedback threading.
 *
 * The helper deliberately keeps the cycle body opaque — callers do all
 * state mutation inside `runCycle`. This avoids the trap of trying to
 * generalise too deeply (every stage's "state" is different).
 */

/** What a single cycle reports back to the loop. */
export type CycleOutcome<R> =
  /** Terminal: the loop should exit and return this result. */
  | { kind: "done"; result: R }
  /** Continue to the next cycle, optionally with feedback that seeds the next iteration. */
  | { kind: "continue"; nextFeedback?: string }
  /** Cycle gave up without reaching a terminal state — fall through to `onAllCyclesExhausted`. */
  | { kind: "exhausted" }

export type CycleConfig<R> = {
  /** Hard upper bound on cycles. */
  maxCycles: number
  /** Cycle index to start from (resume support). Defaults to 0. */
  startCycle?: number
  /** Optional feedback to seed the very first cycle. */
  initialFeedback?: string
  /**
   * Run one cycle. May mutate caller-owned state. Returns a tagged outcome
   * that tells the loop whether to terminate, continue, or fall through to
   * `onAllCyclesExhausted`.
   */
  runCycle: (args: {
    cycle: number
    feedback: string | undefined
  }) => Promise<CycleOutcome<R>>
  /**
   * Called when the loop runs out of cycles without a `done` outcome,
   * or when a cycle reports `exhausted`. Must produce the loop's
   * terminal result (typically a "blocked" record).
   */
  onAllCyclesExhausted: () => Promise<R>
}

/**
 * Execute a bounded iterate-then-review loop.
 *
 * Termination semantics:
 *   - `done`      → return result.
 *   - `continue`  → advance cycle, carry `nextFeedback` to next call.
 *   - `exhausted` → stop early; return `onAllCyclesExhausted()`.
 *   - cycles > maxCycles → return `onAllCyclesExhausted()`.
 */
export async function runCycledLoop<R>(config: CycleConfig<R>): Promise<R> {
  let feedback: string | undefined = config.initialFeedback
  for (
    let cycle = config.startCycle ?? 0;
    cycle < config.maxCycles;
    cycle++
  ) {
    const outcome = await config.runCycle({ cycle, feedback })
    if (outcome.kind === "done") return outcome.result
    if (outcome.kind === "exhausted") return config.onAllCyclesExhausted()
    feedback = outcome.nextFeedback
  }
  return config.onAllCyclesExhausted()
}
