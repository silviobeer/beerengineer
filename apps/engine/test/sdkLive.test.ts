import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { invokeClaudeSdk } from "../src/llm/hosted/providers/claudeSdk.js"
import { invokeCodexSdk } from "../src/llm/hosted/providers/codexSdk.js"

/**
 * Live SDK smoke tests.
 *
 * Default: skipped. They cost real money and need a network round-trip per
 * call, so they MUST stay opt-in. Set both:
 *
 *   BEERENGINEER_SDK_LIVE=1
 *   ANTHROPIC_API_KEY=...   (for the claude:sdk smoke)
 *   OPENAI_API_KEY=...      (for the codex:sdk smoke)
 *
 * Run only this file:
 *   BEERENGINEER_SDK_LIVE=1 node --test --import tsx apps/engine/test/sdkLive.test.ts
 *
 * Each test is intentionally tiny — we're checking that the engine ↔ SDK
 * wiring is correct (auth, dispatch, event normalization, session shape),
 * not that the model itself is good. A single 1-2 turn round-trip suffices.
 *
 * The acceptance bar is "the call returned a non-empty `outputText` and a
 * session handle, and didn't throw" — not text equality, since model output
 * varies turn to turn.
 */

const liveEnabled = process.env.BEERENGINEER_SDK_LIVE === "1"

test("claude:sdk live smoke — round-trips a tiny prompt and returns text + session", { skip: !liveEnabled || !process.env.ANTHROPIC_API_KEY }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-claudesdk-live-"))
  try {
    const result = await invokeClaudeSdk({
      prompt: 'Reply with exactly the JSON object {"ok":true} and nothing else.',
      runtime: {
        harness: "claude",
        runtime: "sdk",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        workspaceRoot: dir,
        policy: { mode: "no-tools" },
      },
      session: null,
    })
    assert.ok(result.outputText.length > 0, "expected non-empty outputText")
    assert.equal(result.session.harness, "claude")
    // session.sessionId may be null when the SDK doesn't return a server
    // handle on a no-tools turn — in that case the replay helper persists
    // local history instead.
    if (!result.session.sessionId) {
      assert.ok(result.session.messages && result.session.messages.length >= 2, "no server handle: expected replay history")
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("codex:sdk live smoke — round-trips a tiny prompt and returns text + thread id", { skip: !liveEnabled || !process.env.OPENAI_API_KEY }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-codexsdk-live-"))
  try {
    const result = await invokeCodexSdk({
      prompt: 'Reply with exactly the JSON object {"ok":true} and nothing else.',
      runtime: {
        harness: "codex",
        runtime: "sdk",
        provider: "openai",
        model: "gpt-4o-mini",
        workspaceRoot: dir,
        policy: { mode: "safe-readonly" },
      },
      session: null,
    })
    assert.ok(result.outputText.length > 0, "expected non-empty outputText")
    assert.equal(result.session.harness, "codex")
    assert.ok(result.session.sessionId, "codex:sdk should always return a thread id after the first turn")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("claude:sdk fails fast with a clear error when ANTHROPIC_API_KEY is missing", { skip: liveEnabled }, async () => {
  // Deliberately runs in the *non-live* lane so we don't need a real key.
  // We unset the key for this call and expect the adapter to throw before
  // touching the network.
  const previous = process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  try {
    await assert.rejects(
      invokeClaudeSdk({
        prompt: "noop",
        runtime: {
          harness: "claude",
          runtime: "sdk",
          provider: "anthropic",
          workspaceRoot: ".",
          policy: { mode: "no-tools" },
        },
        session: null,
      }),
      (err: Error) => {
        assert.match(err.message, /ANTHROPIC_API_KEY/)
        // Regression: the error used to claim `.env.local` was a supported
        // discovery path. It isn't (the loader doesn't exist yet), so the
        // message must not promise it.
        assert.match(err.message, /not yet implemented/)
        return true
      },
    )
  } finally {
    if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous
  }
})

test("codex:sdk fails fast with a clear error when OPENAI_API_KEY is missing", { skip: liveEnabled }, async () => {
  const previous = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  try {
    await assert.rejects(
      invokeCodexSdk({
        prompt: "noop",
        runtime: {
          harness: "codex",
          runtime: "sdk",
          provider: "openai",
          workspaceRoot: ".",
          policy: { mode: "safe-readonly" },
        },
        session: null,
      }),
      (err: Error) => {
        assert.match(err.message, /OPENAI_API_KEY/)
        assert.match(err.message, /not yet implemented/)
        return true
      },
    )
  } finally {
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous
  }
})
