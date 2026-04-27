import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import {
  RALPH_LOOP_CAPS,
  RALPH_LOOP_DEFAULTS,
  resolveRalphLoopConfig,
  _resetLoopConfigWarnings,
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

  it("clamps env values above the sanity caps to the cap (with stderr warning)", () => {
    _resetLoopConfigWarnings()
    process.env.BEERENGINEER_MAX_ITERATIONS_PER_CYCLE = "999999"
    process.env.BEERENGINEER_MAX_REVIEW_CYCLES = String(RALPH_LOOP_CAPS.maxReviewCycles + 5)
    const originalWrite = process.stderr.write.bind(process.stderr)
    const warnings: string[] = []
    process.stderr.write = ((chunk: unknown) => {
      warnings.push(typeof chunk === "string" ? chunk : String(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      const cfg = resolveRalphLoopConfig()
      assert.equal(cfg.maxIterationsPerCycle, RALPH_LOOP_CAPS.maxIterationsPerCycle)
      assert.equal(cfg.maxReviewCycles, RALPH_LOOP_CAPS.maxReviewCycles)
    } finally {
      process.stderr.write = originalWrite
    }
    assert.ok(
      warnings.some(line => line.includes("BEERENGINEER_MAX_ITERATIONS_PER_CYCLE=999999")),
      "expected a stderr warning naming the offending env var",
    )
  })

  it("clamps explicit override values above the cap", () => {
    _resetLoopConfigWarnings()
    const originalWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (() => true) as typeof process.stderr.write
    try {
      const cfg = resolveRalphLoopConfig({
        maxIterationsPerCycle: RALPH_LOOP_CAPS.maxIterationsPerCycle + 100,
      })
      assert.equal(cfg.maxIterationsPerCycle, RALPH_LOOP_CAPS.maxIterationsPerCycle)
    } finally {
      process.stderr.write = originalWrite
    }
  })

  it("ignores non-positive overrides and falls back to env/default", () => {
    _resetLoopConfigWarnings()
    process.env.BEERENGINEER_MAX_ITERATIONS_PER_CYCLE = "6"
    const originalWrite = process.stderr.write.bind(process.stderr)
    const warnings: string[] = []
    process.stderr.write = ((chunk: unknown) => {
      warnings.push(typeof chunk === "string" ? chunk : String(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      // Zero, negative, fractional, NaN, Infinity — all rejected, env wins.
      for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        const cfg = resolveRalphLoopConfig({ maxIterationsPerCycle: bad })
        assert.equal(
          cfg.maxIterationsPerCycle,
          6,
          `expected fallback to env=6 when override=${bad}, got ${cfg.maxIterationsPerCycle}`,
        )
      }
    } finally {
      process.stderr.write = originalWrite
    }
    assert.ok(
      warnings.some(line => line.includes("override maxIterationsPerCycle")),
      "expected a stderr warning naming the rejected override",
    )
  })
})
