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

/** Why the loop terminated without a `done` outcome. */
export type ExhaustionReason =
  /** Loop ran the configured `maxCycles` without a terminal cycle. */
  | { kind: "max-cycles-reached"; lastCycle: number }
  /** A cycle reported `{ kind: "exhausted", reason }` and short-circuited. */
  | { kind: "cycle-exhausted"; lastCycle: number; reason: string }

/** What a single cycle reports back to the loop. */
export type CycleOutcome<R> =
  /** Terminal: the loop should exit and return this result. */
  | { kind: "done"; result: R }
  /** Continue to the next cycle, optionally with feedback that seeds the next iteration. */
  | { kind: "continue"; nextFeedback?: string }
  /** Cycle gave up without reaching a terminal state — short-circuit to `onAllCyclesExhausted`. */
  | { kind: "exhausted"; reason: string }

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
   * or when a cycle reports `exhausted`. The {@link ExhaustionReason}
   * argument lets the handler discriminate between "ran all cycles
   * without success" and "a single cycle gave up early" so it can
   * attribute the cause correctly (e.g. story_error vs review_limit
   * in Ralph). Must produce the loop's terminal result (typically a
   * "blocked" record).
   */
  onAllCyclesExhausted: (reason: ExhaustionReason) => Promise<R>
}

/**
 * Execute a bounded iterate-then-review loop.
 *
 * Termination semantics:
 *   - `done`      → return result.
 *   - `continue`  → advance cycle, carry `nextFeedback` to next call.
 *   - `exhausted` → stop early; return `onAllCyclesExhausted({ kind:
 *     "cycle-exhausted", lastCycle, reason })`.
 *   - cycles > maxCycles → return `onAllCyclesExhausted({ kind:
 *     "max-cycles-reached", lastCycle })`.
 */
export async function runCycledLoop<R>(config: CycleConfig<R>): Promise<R> {
  let feedback: string | undefined = config.initialFeedback
  let lastCycle = (config.startCycle ?? 0) - 1
  for (
    let cycle = config.startCycle ?? 0;
    cycle < config.maxCycles;
    cycle++
  ) {
    lastCycle = cycle
    const outcome = await config.runCycle({ cycle, feedback })
    if (outcome.kind === "done") return outcome.result
    if (outcome.kind === "exhausted") {
      return config.onAllCyclesExhausted({
        kind: "cycle-exhausted",
        lastCycle: cycle,
        reason: outcome.reason,
      })
    }
    feedback = outcome.nextFeedback
  }
  return config.onAllCyclesExhausted({ kind: "max-cycles-reached", lastCycle })
}
