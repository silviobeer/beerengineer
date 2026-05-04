import { test } from "node:test"
import assert from "node:assert/strict"
import { parseRetryAfter, RETRY_AFTER_CEILING_MS } from "../../../src/core/supabase/retryAfter.js"

test("PROJ-4 QA-027: parseRetryAfter returns null for undefined input", () => {
  assert.equal(parseRetryAfter(undefined), null)
})

test("PROJ-4 QA-027: parseRetryAfter parses numeric seconds to milliseconds", () => {
  assert.equal(parseRetryAfter("3"), 3_000)
  assert.equal(parseRetryAfter("0"), 0)
})

test("PROJ-4 QA-027: parseRetryAfter parses RFC 7231 HTTP-date format", () => {
  const now = new Date("2026-05-04T12:00:00Z")
  const future = "Mon, 04 May 2026 12:00:30 GMT"
  const result = parseRetryAfter(future, now)
  assert.equal(result, 30_000)
})

test("PROJ-4 QA-027: parseRetryAfter clamps past HTTP-date to 0", () => {
  const now = new Date("2026-05-04T12:00:30Z")
  const past = "Mon, 04 May 2026 12:00:00 GMT"
  assert.equal(parseRetryAfter(past, now), 0)
})

test("PROJ-4 QA-027: parseRetryAfter returns null for garbage input", () => {
  assert.equal(parseRetryAfter("not-a-date"), null)
  assert.equal(parseRetryAfter(""), null)
})

test("PROJ-4 QA-027: parseRetryAfter returns null for negative numeric input", () => {
  assert.equal(parseRetryAfter("-5"), null)
})

test("PROJ-4 QA-027: parseRetryAfter clamps to ceiling so a hostile header cannot block forever", () => {
  // 24 hours = 86400 seconds — should be clamped to ceiling
  const result = parseRetryAfter("86400")
  assert.equal(result, RETRY_AFTER_CEILING_MS)
  assert.ok(RETRY_AFTER_CEILING_MS <= 5 * 60_000)
})

test("PROJ-4 QA-027: parseRetryAfter clamps a far-future HTTP-date to ceiling", () => {
  const now = new Date("2026-05-04T12:00:00Z")
  const farFuture = "Tue, 05 May 2026 12:00:00 GMT" // +24h
  const result = parseRetryAfter(farFuture, now)
  assert.equal(result, RETRY_AFTER_CEILING_MS)
})
