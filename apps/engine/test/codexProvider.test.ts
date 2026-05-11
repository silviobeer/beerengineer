import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildCodexCommand, codexSandboxBypassEnabled } from "../src/llm/hosted/providers/codex.js"
import type { HostedProviderInvokeInput } from "../src/llm/hosted/providerRuntime.js"
import { invokeCodex } from "../src/llm/hosted/providers/codex.js"
import { resetCodexSandboxPolicyForTests } from "../src/llm/hosted/providers/codexSandboxPolicy.js"

function inputFor(policyMode: "no-tools" | "safe-readonly" | "safe-workspace-write" | "unsafe-autonomous-write", opts: { resume?: boolean } = {}): HostedProviderInvokeInput {
  return {
    prompt: "hi",
    session: opts.resume ? { sessionId: "thr-1" } : null,
    runtime: {
      workspaceRoot: "/tmp/ws",
      policy: { mode: policyMode } as never,
      model: undefined,
    } as HostedProviderInvokeInput["runtime"],
  }
}

const STATE = () => ({ streamedSummary: false, tempDir: null, responsePath: null })

function makeStubBin(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, "utf8")
  chmodSync(path, 0o755)
  return path
}

test("codexSandboxBypassEnabled accepts 1 / true / yes (case-insensitive); ignores everything else", () => {
  for (const v of ["1", "true", "TRUE", "yes", "Yes"]) {
    assert.equal(codexSandboxBypassEnabled({ BEERENGINEER_CODEX_SANDBOX_BYPASS: v }), true, `expected true for ${v}`)
  }
  for (const v of ["", "0", "false", "no", undefined as unknown as string]) {
    assert.equal(codexSandboxBypassEnabled({ BEERENGINEER_CODEX_SANDBOX_BYPASS: v }), false, `expected false for ${JSON.stringify(v)}`)
  }
  assert.equal(codexSandboxBypassEnabled({}), false)
})

test("buildCodexCommand: bypass off + safe-workspace-write fresh exec → --sandbox workspace-write, no bypass flag", () => {
  const cmd = buildCodexCommand(inputFor("safe-workspace-write"), STATE(), "/tmp/codex-1", {})
  assert.ok(cmd.includes("--sandbox"), "expected --sandbox flag")
  assert.equal(cmd[cmd.indexOf("--sandbox") + 1], "workspace-write")
  assert.ok(!cmd.includes("--full-auto"))
  assert.ok(!cmd.includes("--dangerously-bypass-approvals-and-sandbox"))
})

test("buildCodexCommand: bypass on + safe-workspace-write fresh exec → --dangerously-bypass-approvals-and-sandbox alone (no --full-auto, codex rejects both together)", () => {
  const cmd = buildCodexCommand(
    inputFor("safe-workspace-write"),
    STATE(),
    "/tmp/codex-2",
    { BEERENGINEER_CODEX_SANDBOX_BYPASS: "1" },
  )
  assert.ok(!cmd.includes("--sandbox"), "must drop --sandbox when bypass is on")
  assert.ok(!cmd.includes("--full-auto"), "codex enforces mutual exclusion with the bypass flag")
  assert.ok(cmd.includes("--dangerously-bypass-approvals-and-sandbox"))
})

test("buildCodexCommand: bypass on + safe-readonly fresh exec → bypass flag alone", () => {
  const cmd = buildCodexCommand(
    inputFor("safe-readonly"),
    STATE(),
    "/tmp/codex-3",
    { BEERENGINEER_CODEX_SANDBOX_BYPASS: "true" },
  )
  assert.ok(!cmd.includes("--sandbox"))
  assert.ok(!cmd.includes("--full-auto"))
  assert.ok(cmd.includes("--dangerously-bypass-approvals-and-sandbox"))
})

test("buildCodexCommand: bypass on + safe-workspace-write resume → bypass flag, no -c sandbox_mode", () => {
  const cmd = buildCodexCommand(
    inputFor("safe-workspace-write", { resume: true }),
    STATE(),
    "/tmp/codex-4",
    { BEERENGINEER_CODEX_SANDBOX_BYPASS: "yes" },
  )
  assert.ok(!cmd.some(arg => arg.includes("sandbox_mode")), "must not push -c sandbox_mode= when bypass is on")
  assert.ok(!cmd.includes("--full-auto"))
  assert.ok(cmd.includes("--dangerously-bypass-approvals-and-sandbox"))
})

test("buildCodexCommand: bypass on + no-tools policy still pins --sandbox read-only (bypass deliberately does not weaken no-tools)", () => {
  const cmd = buildCodexCommand(
    inputFor("no-tools"),
    STATE(),
    "/tmp/codex-5",
    { BEERENGINEER_CODEX_SANDBOX_BYPASS: "1" },
  )
  assert.ok(cmd.includes("--sandbox"), "no-tools must keep --sandbox even with bypass on")
  assert.equal(cmd[cmd.indexOf("--sandbox") + 1], "read-only")
  assert.ok(!cmd.includes("--full-auto"))
  assert.ok(!cmd.includes("--dangerously-bypass-approvals-and-sandbox"))
})

test("buildCodexCommand: unsafe-autonomous-write emits bypass flag alone (existing behavior preserved, --full-auto removed for codex compat)", () => {
  const cmd = buildCodexCommand(inputFor("unsafe-autonomous-write"), STATE(), "/tmp/codex-6", {})
  assert.ok(!cmd.includes("--full-auto"))
  assert.ok(cmd.includes("--dangerously-bypass-approvals-and-sandbox"))
})

test("invokeCodex retries once with bypass after a known bwrap networking failure", async () => {
  resetCodexSandboxPolicyForTests()
  const dir = mkdtempSync(join(tmpdir(), "be2-codex-provider-"))
  const binDir = join(dir, "bin")
  const attemptsPath = join(dir, "attempts.log")
  const previousPath = process.env.PATH
  const previousBypass = process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS

  try {
    delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
    makeStubBin(
      binDir,
      "codex",
      `
count=0
if [ -f "${attemptsPath}" ]; then
  count="$(wc -l < "${attemptsPath}")"
fi
count="$((count + 1))"
printf '%s\n' "$*" >> "${attemptsPath}"
if [ "$count" -eq 1 ]; then
  printf '%s\n' 'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted' >&2
  exit 1
fi
response=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--output-last-message" ]; then
    response="$arg"
    break
  fi
  prev="$arg"
done
printf '{"summary":"done"}' > "$response"
printf '%s\n' '{"type":"thread.started","thread_id":"thread-1"}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'
`,
    )
    process.env.PATH = `${binDir}:${previousPath ?? ""}`

    const result = await invokeCodex({
      prompt: "hello",
      runtime: {
        harness: "codex",
        runtime: "cli",
        provider: "openai",
        workspaceRoot: dir,
        policy: { mode: "safe-workspace-write" },
      } as HostedProviderInvokeInput["runtime"],
      session: null,
    })

    const attempts = readFileSync(attemptsPath, "utf8").trim().split(/\r?\n/)
    assert.equal(attempts.length, 2)
    assert.match(attempts[0] ?? "", /--sandbox workspace-write/)
    assert.doesNotMatch(attempts[0] ?? "", /--dangerously-bypass-approvals-and-sandbox/)
    assert.match(attempts[1] ?? "", /--dangerously-bypass-approvals-and-sandbox/)
    assert.equal(result.outputText, "{\"summary\":\"done\"}")
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousBypass === undefined) delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
    else process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS = previousBypass
    rmSync(dir, { recursive: true, force: true })
    resetCodexSandboxPolicyForTests()
  }
})

test("invokeCodex does not retry generic non-networking launch failures", async () => {
  resetCodexSandboxPolicyForTests()
  const dir = mkdtempSync(join(tmpdir(), "be2-codex-provider-"))
  const binDir = join(dir, "bin")
  const attemptsPath = join(dir, "attempts.log")
  const previousPath = process.env.PATH
  const previousBypass = process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS

  try {
    delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
    makeStubBin(
      binDir,
      "codex",
      `
printf '%s\n' "$*" >> "${attemptsPath}"
printf '%s\n' 'generic launch failure' >&2
exit 1
`,
    )
    process.env.PATH = `${binDir}:${previousPath ?? ""}`

    await assert.rejects(
      () =>
        invokeCodex({
          prompt: "hello",
          runtime: {
            harness: "codex",
            runtime: "cli",
            provider: "openai",
            workspaceRoot: dir,
            policy: { mode: "safe-workspace-write" },
          } as HostedProviderInvokeInput["runtime"],
          session: null,
        }),
      /generic launch failure/,
    )

    const attempts = readFileSync(attemptsPath, "utf8").trim().split(/\r?\n/)
    assert.equal(attempts.length, 1)
    assert.doesNotMatch(attempts[0] ?? "", /--dangerously-bypass-approvals-and-sandbox/)
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousBypass === undefined) delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
    else process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS = previousBypass
    rmSync(dir, { recursive: true, force: true })
    resetCodexSandboxPolicyForTests()
  }
})
