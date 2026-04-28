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
 * Resolution semantics: callers invoke {@link resolveRalphLoopConfig} once
 * per *story* (not once per module load), so an env-var change between
 * runs takes effect on the next story without restarting the engine.
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

/**
 * Sanity caps on operator-supplied overrides. A typo like `=99999` in
 * an env file would otherwise let a single story spend essentially
 * unbounded time inside a coder iteration with no visible signal; these
 * caps clamp obviously-wrong values back to a safe maximum and emit a
 * single warning so the operator notices.
 */
export const RALPH_LOOP_CAPS: LoopConfig = {
  maxIterationsPerCycle: 50,
  maxReviewCycles: 20,
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Normalise an override value through the same "positive integer or
 * fall back" filter env-var inputs go through. Returns `undefined` for
 * non-positive / non-finite / non-integer values so the caller can
 * fall back to the env-derived value instead of accepting nonsense
 * like `0` or `-3` and forcing immediate exhaustion.
 */
function normalizePositiveIntOverride(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    if (!warnedFor.has(`override-invalid:${name}`)) {
      warnedFor.add(`override-invalid:${name}`)
      process.stderr.write(
        `[loopConfig] override ${name}=${value} is not a positive integer; ignoring and falling back to env/default\n`,
      )
    }
    return undefined
  }
  return value
}

const warnedFor = new Set<string>()
function clampWithWarning(value: number, cap: number, source: string, name: string): number {
  if (value <= cap) return value
  // Warn once per (source, name) so noisy stories don't flood logs.
  const key = `${source}:${name}`
  if (!warnedFor.has(key)) {
    warnedFor.add(key)
    process.stderr.write(
      `[loopConfig] ${name}=${value} from ${source} exceeds cap ${cap}; clamping to ${cap}\n`,
    )
  }
  return cap
}

/**
 * Resolve the active Ralph loop configuration.
 *
 * Precedence: explicit `override` > env vars > built-in defaults.
 *
 * `override` is the per-story / per-run hook: callers (currently the
 * Ralph runtime; future: a stage that wants a tighter cadence for a
 * specific story type) can supply a partial override that wins over the
 * env. No production caller passes one yet; the parameter exists so the
 * shape is in place when {@link RunLlmConfig} grows a `loopConfig`
 * field, or when a future stage wants its own cadence.
 *
 * Operator-supplied values (override or env) above {@link RALPH_LOOP_CAPS}
 * are clamped, with a one-shot stderr warning per unique (source, name).
 */
export function resolveRalphLoopConfig(override?: Partial<LoopConfig>): LoopConfig {
  const fromEnv: LoopConfig = {
    maxIterationsPerCycle: clampWithWarning(
      readPositiveIntEnv(
        "BEERENGINEER_MAX_ITERATIONS_PER_CYCLE",
        RALPH_LOOP_DEFAULTS.maxIterationsPerCycle,
      ),
      RALPH_LOOP_CAPS.maxIterationsPerCycle,
      "env",
      "BEERENGINEER_MAX_ITERATIONS_PER_CYCLE",
    ),
    maxReviewCycles: clampWithWarning(
      readPositiveIntEnv(
        "BEERENGINEER_MAX_REVIEW_CYCLES",
        RALPH_LOOP_DEFAULTS.maxReviewCycles,
      ),
      RALPH_LOOP_CAPS.maxReviewCycles,
      "env",
      "BEERENGINEER_MAX_REVIEW_CYCLES",
    ),
  }
  // Normalise overrides through the same positive-int guard env inputs use,
  // *then* upper-clamp through RALPH_LOOP_CAPS. A negative or zero override
  // would otherwise force immediate exhaustion and surface as a confusing
  // "blocked at cycle -1 of 0" recovery state.
  const overrideIter = normalizePositiveIntOverride(
    override?.maxIterationsPerCycle,
    "maxIterationsPerCycle",
  )
  const overrideCycles = normalizePositiveIntOverride(
    override?.maxReviewCycles,
    "maxReviewCycles",
  )
  return {
    maxIterationsPerCycle: overrideIter === undefined
      ? fromEnv.maxIterationsPerCycle
      : clampWithWarning(
          overrideIter,
          RALPH_LOOP_CAPS.maxIterationsPerCycle,
          "override",
          "maxIterationsPerCycle",
        ),
    maxReviewCycles: overrideCycles === undefined
      ? fromEnv.maxReviewCycles
      : clampWithWarning(
          overrideCycles,
          RALPH_LOOP_CAPS.maxReviewCycles,
          "override",
          "maxReviewCycles",
        ),
  }
}

/** Test-only: clear the de-dup state of the cap warning. */
export function _resetLoopConfigWarnings(): void {
  warnedFor.clear()
}
