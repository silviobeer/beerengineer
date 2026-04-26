import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import {
  RALPH_LOOP_DEFAULTS,
  resolveRalphLoopConfig,
} from "../src/core/loopConfig.ts"

describe("resolveRalphLoopConfig", () => {
  let original: Record<string, string | undefined>

  beforeEach(() => {
    original = {
      iter: process.env.BEERENGINEER_MAX_ITERATIONS_PER_CYCLE,
      cycles: process.env.BEERENGINEER_MAX_REVIEW_CYCLES,
    }
    delete process.env.BEERENGINEER_MAX_ITERATIONS_PER_CYCLE
    delete process.env.BEERENGINEER_MAX_REVIEW_CYCLES
  })

  afterEach(() => {
    if (original.iter === undefined) delete process.env.BEERENGINEER_MAX_ITERATIONS_PER_CYCLE
    else process.env.BEERENGINEER_MAX_ITERATIONS_PER_CYCLE = original.iter
    if (original.cycles === undefined) delete process.env.BEERENGINEER_MAX_REVIEW_CYCLES
    else process.env.BEERENGINEER_MAX_REVIEW_CYCLES = original.cycles
  })

  it("returns historical defaults (4, 3) with no env or override", () => {
    assert.deepEqual(resolveRalphLoopConfig(), RALPH_LOOP_DEFAULTS)
    assert.equal(RALPH_LOOP_DEFAULTS.maxIterationsPerCycle, 4)
    assert.equal(RALPH_LOOP_DEFAULTS.maxReviewCycles, 3)
  })

  it("env vars override the defaults", () => {
    process.env.BEERENGINEER_MAX_ITERATIONS_PER_CYCLE = "7"
    process.env.BEERENGINEER_MAX_REVIEW_CYCLES = "5"
    assert.deepEqual(resolveRalphLoopConfig(), {
      maxIterationsPerCycle: 7,
      maxReviewCycles: 5,
    })
  })

  it("explicit override beats env vars", () => {
    process.env.BEERENGINEER_MAX_ITERATIONS_PER_CYCLE = "7"
    process.env.BEERENGINEER_MAX_REVIEW_CYCLES = "5"
    assert.deepEqual(
      resolveRalphLoopConfig({ maxIterationsPerCycle: 1, maxReviewCycles: 2 }),
      { maxIterationsPerCycle: 1, maxReviewCycles: 2 },
    )
  })

  it("ignores non-positive or non-numeric env values, falls back to defaults", () => {
    process.env.BEERENGINEER_MAX_ITERATIONS_PER_CYCLE = "abc"
    process.env.BEERENGINEER_MAX_REVIEW_CYCLES = "-3"
    assert.deepEqual(resolveRalphLoopConfig(), RALPH_LOOP_DEFAULTS)
  })
})
