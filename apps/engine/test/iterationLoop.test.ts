import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { runCycledLoop, type CycleOutcome, type ExhaustionReason } from "../src/core/iterationLoop.ts"

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

  it("runs onAllCyclesExhausted with kind=max-cycles-reached when no cycle terminates", async () => {
    let received: ExhaustionReason | undefined
    const result = await runCycledLoop<string>({
      maxCycles: 3,
      runCycle: async (): Promise<CycleOutcome<string>> => ({ kind: "continue" }),
      onAllCyclesExhausted: async reason => {
        received = reason
        return "exhausted"
      },
    })
    assert.equal(result, "exhausted")
    assert.deepEqual(received, { kind: "max-cycles-reached", lastCycle: 2 })
  })

  it("short-circuits with kind=cycle-exhausted when a cycle reports exhausted, carrying the reason and lastCycle", async () => {
    const calls: number[] = []
    let received: ExhaustionReason | undefined
    const result = await runCycledLoop<string>({
      maxCycles: 10,
      runCycle: async ({ cycle }) => {
        calls.push(cycle)
        if (cycle === 1) return { kind: "exhausted", reason: "out-of-budget" }
        return { kind: "continue" }
      },
      onAllCyclesExhausted: async reason => {
        received = reason
        return "stopped"
      },
    })
    assert.equal(result, "stopped")
    assert.deepEqual(calls, [0, 1])
    assert.deepEqual(received, { kind: "cycle-exhausted", lastCycle: 1, reason: "out-of-budget" })
  })

  it("respects startCycle for resume support", async () => {
    const calls: number[] = []
    let received: ExhaustionReason | undefined
    await runCycledLoop<string>({
      maxCycles: 5,
      startCycle: 3,
      runCycle: async ({ cycle }) => {
        calls.push(cycle)
        return { kind: "continue" }
      },
      onAllCyclesExhausted: async reason => {
        received = reason
        return "done"
      },
    })
    assert.deepEqual(calls, [3, 4])
    assert.deepEqual(received, { kind: "max-cycles-reached", lastCycle: 4 })
  })
})
