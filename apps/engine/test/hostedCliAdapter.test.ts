import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { HostedStageAdapter } from "../src/llm/hosted/hostedCliAdapter.js"
import { resetCodexSandboxPolicyForTests } from "../src/llm/hosted/providers/codexSandboxPolicy.js"

function makeStubBin(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, "utf8")
  chmodSync(path, 0o755)
  return path
}

test("hosted stage adapter retries semantically invalid stage envelopes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-hosted-stage-"))
  const binDir = join(dir, "bin")
  const counterPath = join(dir, "attempt.txt")
  const previousPath = process.env.PATH

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
printf '%s\n' '{"type":"system","subtype":"init","session_id":"session-semantic-retry"}'
if [ "$count" -eq 1 ]; then
  printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"result":"{\\"kind\\":\\"message\\",\\"message\\":\\"\\"}","session_id":"session-semantic-retry","usage":{"input_tokens":1,"cache_read_input_tokens":0,"output_tokens":1}}'
  exit 0
fi
printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"result":"{\\"kind\\":\\"artifact\\",\\"artifact\\":{\\"ok\\":true}}","session_id":"session-semantic-retry","usage":{"input_tokens":1,"cache_read_input_tokens":0,"output_tokens":1}}'
`,
    )
    process.env.PATH = `${binDir}:${previousPath ?? ""}`

    const adapter = new HostedStageAdapter<{ item: string }, { ok: boolean }>({
      stageId: "qa",
      harness: "claude",
      runtime: "cli",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      workspaceRoot: dir,
      runtimePolicy: { mode: "safe-workspace-write" },
    })

    const response = await adapter.step({
      kind: "begin",
      state: { item: "demo" },
      stageContext: { turnCount: 1, phase: "begin" },
    })

    assert.deepEqual(response, { kind: "artifact", artifact: { ok: true } })
    assert.equal(readFileSync(counterPath, "utf8"), "2")
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    rmSync(dir, { recursive: true, force: true })
  }
})

test("qa hosted stage surfaces worker start failures with recovery-friendly wording", async () => {
  resetCodexSandboxPolicyForTests()
  const dir = mkdtempSync(join(tmpdir(), "be2-hosted-stage-"))
  const binDir = join(dir, "bin")
  const previousPath = process.env.PATH

  try {
    makeStubBin(
      binDir,
      "codex",
      `
printf '%s\n' 'generic launch failure' >&2
exit 1
`,
    )
    process.env.PATH = `${binDir}:${previousPath ?? ""}`

    const adapter = new HostedStageAdapter<{ item: string }, { ok: boolean }>({
      stageId: "qa",
      harness: "codex",
      runtime: "cli",
      provider: "openai",
      model: "gpt-5.4",
      workspaceRoot: dir,
      runtimePolicy: { mode: "safe-workspace-write" },
    })

    await assert.rejects(
      () =>
        adapter.step({
          kind: "begin",
          state: { item: "demo" },
          stageContext: { turnCount: 1, phase: "begin" },
        }),
      /worker start failed: .*generic launch failure/i,
    )
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    rmSync(dir, { recursive: true, force: true })
    resetCodexSandboxPolicyForTests()
  }
})

test("qa hosted stage keeps semantic output errors distinct from worker start failures", async () => {
  resetCodexSandboxPolicyForTests()
  const dir = mkdtempSync(join(tmpdir(), "be2-hosted-stage-"))
  const binDir = join(dir, "bin")
  const previousPath = process.env.PATH

  try {
    makeStubBin(
      binDir,
      "codex",
      `
printf '%s\n' '{"type":"thread.started","thread_id":"thread-qa-semantic"}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'
`,
    )
    process.env.PATH = `${binDir}:${previousPath ?? ""}`

    const adapter = new HostedStageAdapter<{ item: string }, { ok: boolean }>({
      stageId: "qa",
      harness: "codex",
      runtime: "cli",
      provider: "openai",
      model: "gpt-5.4",
      workspaceRoot: dir,
      runtimePolicy: { mode: "safe-workspace-write" },
    })

    await assert.rejects(
      () =>
        adapter.step({
          kind: "begin",
          state: { item: "demo" },
          stageContext: { turnCount: 1, phase: "begin" },
        }),
      error =>
        error instanceof Error
        && !/worker start failed/i.test(error.message)
        && /non-empty message/i.test(error.message),
    )
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    rmSync(dir, { recursive: true, force: true })
    resetCodexSandboxPolicyForTests()
  }
})
