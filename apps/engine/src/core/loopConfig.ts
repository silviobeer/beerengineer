/**
 * Configuration for the Ralph implementation loop.
 *
 * Pulls the previously hard-coded MAX_ITERATIONS_PER_CYCLE / MAX_REVIEW_CYCLES
 * constants out of `stages/execution/ralphRuntime.ts` and into a typed
 * config that can be overridden per run, per call site, or per environment.
 *
 * The defaults match the historical hard-coded values exactly, so existing
 * runs are unaffected unless an override is supplied.
 *
 * Future Phase 4.x: this same shape can power any other stage that wants
 * an iterate-then-review loop (a hypothetical "requirements-refinement"
 * loop, design polish, etc.) without each one re-implementing the cadence.
 */

/** Tunable bounds for an iterate→review loop. */
export type LoopConfig = {
  /** Max implementation iterations within a single review cycle. */
  maxIterationsPerCycle: number
  /** Max review cycles before declaring the loop blocked. */
  maxReviewCycles: number
}

export const RALPH_LOOP_DEFAULTS: LoopConfig = {
  maxIterationsPerCycle: 4,
  maxReviewCycles: 3,
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Resolve the active Ralph loop configuration.
 * Precedence: explicit `override` > env vars > built-in defaults.
 */
export function resolveRalphLoopConfig(override?: Partial<LoopConfig>): LoopConfig {
  const fromEnv: LoopConfig = {
    maxIterationsPerCycle: readPositiveIntEnv(
      "BEERENGINEER_MAX_ITERATIONS_PER_CYCLE",
      RALPH_LOOP_DEFAULTS.maxIterationsPerCycle,
    ),
    maxReviewCycles: readPositiveIntEnv(
      "BEERENGINEER_MAX_REVIEW_CYCLES",
      RALPH_LOOP_DEFAULTS.maxReviewCycles,
    ),
  }
  return {
    maxIterationsPerCycle: override?.maxIterationsPerCycle ?? fromEnv.maxIterationsPerCycle,
    maxReviewCycles: override?.maxReviewCycles ?? fromEnv.maxReviewCycles,
  }
}
