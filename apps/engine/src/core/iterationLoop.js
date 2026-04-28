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
export async function runCycledLoop(config) {
    let feedback = config.initialFeedback;
    let lastCycle = (config.startCycle ?? 0) - 1;
    for (let cycle = config.startCycle ?? 0; cycle < config.maxCycles; cycle++) {
        lastCycle = cycle;
        const outcome = await config.runCycle({ cycle, feedback });
        if (outcome.kind === "done")
            return outcome.result;
        if (outcome.kind === "exhausted") {
            return config.onAllCyclesExhausted({
                kind: "cycle-exhausted",
                lastCycle: cycle,
                reason: outcome.reason,
            });
        }
        feedback = outcome.nextFeedback;
    }
    return config.onAllCyclesExhausted({ kind: "max-cycles-reached", lastCycle });
}
