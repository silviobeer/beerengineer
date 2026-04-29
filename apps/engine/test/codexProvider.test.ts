import { test } from "node:test"
import assert from "node:assert/strict"

import { buildCodexCommand, codexSandboxBypassEnabled } from "../src/llm/hosted/providers/codex.js"
import type { HostedProviderInvokeInput } from "../src/llm/hosted/providerRuntime.js"

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
