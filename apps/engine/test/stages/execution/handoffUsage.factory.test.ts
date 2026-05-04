import { test } from "node:test"
import assert from "node:assert/strict"
import { createHandoffUsageDetector } from "../../../src/stages/execution/handoffUsage.js"

test("PROJ-4 BUG-014: detector evicts oldest entry when maxEntries is exceeded", () => {
  const detector = createHandoffUsageDetector({ maxEntries: 3 })
  // Insert 3 entries — all should be tracked.
  assert.notEqual(detector.detect({ runId: "run", waveId: "wave", workerId: "w1", line: "[supabase] a" }), null)
  assert.notEqual(detector.detect({ runId: "run", waveId: "wave", workerId: "w2", line: "[supabase] b" }), null)
  assert.notEqual(detector.detect({ runId: "run", waveId: "wave", workerId: "w3", line: "[supabase] c" }), null)
  // 4th entry triggers eviction of oldest (w1).
  assert.notEqual(detector.detect({ runId: "run", waveId: "wave", workerId: "w4", line: "[supabase] d" }), null)
  // w1 was evicted, so it can be re-detected as a new entry.
  assert.notEqual(detector.detect({ runId: "run", waveId: "wave", workerId: "w1", line: "[supabase] a-again" }), null)
  // w4 is still tracked, so a duplicate returns null.
  assert.equal(detector.detect({ runId: "run", waveId: "wave", workerId: "w4", line: "[supabase] d-again" }), null)
  detector.dispose()
})

test("PROJ-4 BUG-014: dispose stops the cleanup timer", () => {
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  const intervals: { id: unknown; cleared: boolean }[] = []
  const setSpy = ((handler: (...args: unknown[]) => void, ms: number) => {
    const id = realSetInterval(handler, ms)
    const entry = { id, cleared: false }
    intervals.push(entry)
    if (typeof (id as { unref?: () => void }).unref === "function") {
      ;(id as { unref?: () => void }).unref!()
    }
    return id
  }) as typeof globalThis.setInterval
  const clearSpy = ((id: unknown) => {
    for (const entry of intervals) {
      if (entry.id === id) entry.cleared = true
    }
    return realClearInterval(id as Parameters<typeof realClearInterval>[0])
  }) as typeof globalThis.clearInterval
  globalThis.setInterval = setSpy
  globalThis.clearInterval = clearSpy
  try {
    const detector = createHandoffUsageDetector({ ttlMs: 1000 })
    // Trigger first detect to start the timer.
    detector.detect({ runId: "r", waveId: "w", workerId: "wx", line: "[supabase] hi" })
    assert.equal(intervals.length, 1, "expected timer to be created on first detect")
    assert.equal(intervals[0]!.cleared, false)
    detector.dispose()
    assert.equal(intervals[0]!.cleared, true, "expected dispose to clear the timer")
    // Calling dispose again is a no-op.
    detector.dispose()
  } finally {
    globalThis.setInterval = realSetInterval
    globalThis.clearInterval = realClearInterval
  }
})
