import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { runWithWorkflowIO, type WorkflowEvent, type WorkflowIO } from "../src/core/io.js"
import { runWithActiveRun } from "../src/core/runContext.js"
import { invokeClaude } from "../src/llm/hosted/providers/claude.js"

function makeStubBin(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, "utf8")
  chmodSync(path, 0o755)
  return path
}

function collectEvents(): { io: WorkflowIO; events: WorkflowEvent[] } {
  const events: WorkflowEvent[] = []
  return {
    events,
    io: {
      async ask() {
        return ""
      },
      emit(event) {
        events.push(event)
      },
    },
  }
}

const testDir = dirname(fileURLToPath(import.meta.url))
const sampleFixturePath = resolve(testDir, "fixtures/claude-stream-sample.jsonl")

test("invokeClaude streams live events, preserves stageRunId, and parses final result", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-claude-provider-"))
  const binDir = join(dir, "bin")
  const previousPath = process.env.PATH
  const { io, events } = collectEvents()

  try {
    makeStubBin(
      binDir,
      "claude",
      `
cat "${sampleFixturePath}"
`
    )
    process.env.PATH = `${binDir}:${previousPath ?? ""}`

    const result = await runWithWorkflowIO(io, async () =>
      runWithActiveRun({ runId: "run-1", itemId: "item-1", stageRunId: "stage-1" }, async () =>
        invokeClaude({
          prompt: "hello",
          runtime: {
            harness: "claude",
            runtime: "cli",
            provider: "anthropic",
            workspaceRoot: dir,
            policy: { mode: "safe-workspace-write" },
            model: "claude-haiku-4-5",
          },
          session: null,
        })
      )
    )

    assert.deepEqual(result.command.slice(0, 5), ["claude", "--print", "--verbose", "--output-format", "stream-json"])
    assert.equal(result.outputText, "{\"summary\":\"done\"}")
    assert.equal(result.session.sessionId, "session-123")
    assert.deepEqual(result.cacheStats, { cachedInputTokens: 55, totalInputTokens: 12 })

    const presentations = events.filter((event): event is Extract<WorkflowEvent, { type: "presentation" }> => event.type === "presentation")
    assert.ok(presentations.some(event => event.text === "claude: session started"))
    assert.ok(presentations.some(event => event.text === "claude: tool Bash"))
    assert.ok(presentations.some(event => event.text.includes("claude: run completed")))
    assert.ok(presentations.every(event => event.stageRunId === "stage-1"))
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("invokeClaude falls back to assistant text when the stream ends successfully without a result event", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-claude-provider-"))
  const binDir = join(dir, "bin")
  const previousPath = process.env.PATH

  try {
    makeStubBin(
      binDir,
      "claude",
      `
printf '%s\n' '{"type":"system","subtype":"init","session_id":"session-456"}'
printf '%s\n' '{"type":"assistant","message":{"id":"msg-text","role":"assistant","content":[{"type":"text","text":"{\\"summary\\":\\"fallback\\"}"}],"usage":{"input_tokens":7,"cache_read_input_tokens":33,"output_tokens":4}},"session_id":"session-456"}'
`
    )
    process.env.PATH = `${binDir}:${previousPath ?? ""}`

    const result = await invokeClaude({
      prompt: "hello",
      runtime: {
        harness: "claude",
        runtime: "cli",
        provider: "anthropic",
        workspaceRoot: dir,
        policy: { mode: "safe-readonly" },
      },
      session: null,
    })

    assert.equal(result.outputText, "{\"summary\":\"fallback\"}")
    assert.equal(result.session.sessionId, "session-456")
    assert.deepEqual(result.cacheStats, { cachedInputTokens: 33, totalInputTokens: 7 })
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("invokeClaude emits a retry marker after partial streamed output on transient failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-claude-provider-"))
  const binDir = join(dir, "bin")
  const previousPath = process.env.PATH
  const previousRetryDelays = process.env.BEERENGINEER_HOSTED_RETRY_DELAYS_MS
  const fixture = readFileSync(sampleFixturePath, "utf8")
  const counterPath = join(dir, "attempt.txt")
  const { io, events } = collectEvents()

  try {
    makeStubBin(
      binDir,
      "claude",
      `
count=0
if [ -f "${counterPath}" ]; then
  count="$(cat "${counterPath}")"
fi
count="$((count + 1))"
printf '%s' "$count" > "${counterPath}"
if [ "$count" -eq 1 ]; then
  printf '%s\n' '{"type":"system","subtype":"init","session_id":"retry-session"}'
  printf '%s\n' '{"type":"assistant","message":{"id":"msg-tool","role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"pwd"}}]}}'
  exit 143
fi
cat <<'EOF'
${fixture}
EOF
`
    )
    process.env.PATH = `${binDir}:${previousPath ?? ""}`
    process.env.BEERENGINEER_HOSTED_RETRY_DELAYS_MS = "0"

    const result = await runWithWorkflowIO(io, async () =>
      runWithActiveRun({ runId: "run-2", itemId: "item-2", stageRunId: "stage-2" }, async () =>
        invokeClaude({
          prompt: "hello",
          runtime: {
            harness: "claude",
            runtime: "cli",
            provider: "anthropic",
            workspaceRoot: dir,
            policy: { mode: "safe-workspace-write" },
          },
          session: null,
        })
      )
    )

    assert.equal(result.outputText, "{\"summary\":\"done\"}")
    const retryMarkers = events
      .filter((event): event is Extract<WorkflowEvent, { type: "presentation" }> => event.type === "presentation")
      .map(event => event.text)
      .filter(text => text.includes("claude: local retry"))
    assert.deepEqual(retryMarkers, ["claude: local retry 2/2 in 0 ms"])
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousRetryDelays === undefined) delete process.env.BEERENGINEER_HOSTED_RETRY_DELAYS_MS
    else process.env.BEERENGINEER_HOSTED_RETRY_DELAYS_MS = previousRetryDelays
    rmSync(dir, { recursive: true, force: true })
  }
})
