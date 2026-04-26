import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { runCycledLoop, type CycleOutcome } from "../src/core/iterationLoop.ts"

describe("runCycledLoop", () => {
  it("returns the result when a cycle reports done", async () => {
    const calls: number[] = []
    const result = await runCycledLoop<string>({
      maxCycles: 5,
      runCycle: async ({ cycle }) => {
        calls.push(cycle)
        if (cycle === 2) return { kind: "done", result: "ok" }
        return { kind: "continue" }
      },
      onAllCyclesExhausted: async () => "exhausted",
    })
    assert.equal(result, "ok")
    assert.deepEqual(calls, [0, 1, 2])
  })

  it("threads feedback from one cycle to the next", async () => {
    const seen: Array<string | undefined> = []
    await runCycledLoop<string>({
      maxCycles: 4,
      initialFeedback: "seed",
      runCycle: async ({ cycle, feedback }) => {
        seen.push(feedback)
        if (cycle === 2) return { kind: "done", result: "ok" }
        return { kind: "continue", nextFeedback: `from-${cycle}` }
      },
      onAllCyclesExhausted: async () => "x",
    })
    assert.deepEqual(seen, ["seed", "from-0", "from-1"])
  })

  it("runs onAllCyclesExhausted when no cycle terminates", async () => {
    const result = await runCycledLoop<string>({
      maxCycles: 3,
      runCycle: async (): Promise<CycleOutcome<string>> => ({ kind: "continue" }),
      onAllCyclesExhausted: async () => "exhausted",
    })
    assert.equal(result, "exhausted")
  })

  it("short-circuits to onAllCyclesExhausted when a cycle reports exhausted", async () => {
    const calls: number[] = []
    const result = await runCycledLoop<string>({
      maxCycles: 10,
      runCycle: async ({ cycle }) => {
        calls.push(cycle)
        if (cycle === 1) return { kind: "exhausted" }
        return { kind: "continue" }
      },
      onAllCyclesExhausted: async () => "stopped",
    })
    assert.equal(result, "stopped")
    assert.deepEqual(calls, [0, 1])
  })

  it("respects startCycle for resume support", async () => {
    const calls: number[] = []
    await runCycledLoop<string>({
      maxCycles: 5,
      startCycle: 3,
      runCycle: async ({ cycle }) => {
        calls.push(cycle)
        return { kind: "continue" }
      },
      onAllCyclesExhausted: async () => "done",
    })
    assert.deepEqual(calls, [3, 4])
  })
})
