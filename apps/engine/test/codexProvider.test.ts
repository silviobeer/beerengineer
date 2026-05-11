import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildCodexCommand, codexSandboxBypassEnabled } from "../src/llm/hosted/providers/codex.js"
import type { HostedProviderInvokeInput } from "../src/llm/hosted/providerRuntime.js"
import { invokeCodex } from "../src/llm/hosted/providers/codex.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import {
  markCodexSandboxCapabilitySupported,
  markCodexSandboxCapabilityUnsupported,
  resetCodexSandboxPolicyForTests,
  setCodexSandboxCapabilityStore,
} from "../src/llm/hosted/providers/codexSandboxPolicy.js"

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

test("buildCodexCommand: bypass off + safe-readonly fresh exec → --sandbox read-only", () => {
  const cmd = buildCodexCommand(inputFor("safe-readonly"), STATE(), "/tmp/codex-ro", {})
  assert.ok(cmd.includes("--sandbox"), "expected --sandbox flag")
  assert.equal(cmd[cmd.indexOf("--sandbox") + 1], "read-only")
  assert.ok(!cmd.includes("--dangerously-bypass-approvals-and-sandbox"))
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
  markCodexSandboxCapabilitySupported()
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

test("invokeCodex retries once with bypass after a missing-bwrap runtime failure for a non-default provider id", async () => {
  resetCodexSandboxPolicyForTests()
  markCodexSandboxCapabilitySupported()
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
  printf '%s\n' 'bwrap: command not found' >&2
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
printf '%s\n' '{"type":"thread.started","thread_id":"thread-bwrap-missing"}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'
`,
    )
    process.env.PATH = `${binDir}:${previousPath ?? ""}`

    const result = await invokeCodex({
      prompt: "hello",
      runtime: {
        harness: "codex",
        runtime: "cli",
        provider: "openai-secondary",
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

test("invokeCodex keeps supported safe-readonly launches on the existing read-only sandbox mode", async () => {
  resetCodexSandboxPolicyForTests()
  markCodexSandboxCapabilitySupported()
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
printf '%s\n' '{"type":"thread.started","thread_id":"thread-readonly"}'
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
        policy: { mode: "safe-readonly" },
      } as HostedProviderInvokeInput["runtime"],
      session: null,
    })

    const attempts = readFileSync(attemptsPath, "utf8").trim().split(/\r?\n/)
    assert.equal(attempts.length, 1)
    assert.match(attempts[0] ?? "", /--sandbox read-only/)
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

test("invokeCodex bypasses immediately when cached capability is unsupported", async () => {
  resetCodexSandboxPolicyForTests()
  markCodexSandboxCapabilityUnsupported()
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
printf '%s\n' '{"type":"thread.started","thread_id":"thread-unsupported"}'
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
    assert.equal(attempts.length, 1)
    assert.doesNotMatch(attempts[0] ?? "", /--sandbox/)
    assert.match(attempts[0] ?? "", /--dangerously-bypass-approvals-and-sandbox/)
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

test("explicit bypass override does not destroy detected supported capability across later runs", async () => {
  resetCodexSandboxPolicyForTests()
  markCodexSandboxCapabilitySupported()
  const dir = mkdtempSync(join(tmpdir(), "be2-codex-provider-"))
  const binDir = join(dir, "bin")
  const attemptsPath = join(dir, "attempts.log")
  const previousPath = process.env.PATH
  const previousBypass = process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS

  try {
    makeStubBin(
      binDir,
      "codex",
      `
printf '%s\n' "$*" >> "${attemptsPath}"
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
printf '%s\n' '{"type":"thread.started","thread_id":"thread-override"}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'
`,
    )
    process.env.PATH = `${binDir}:${previousPath ?? ""}`

    process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS = "true"
    await invokeCodex({
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

    delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
    await invokeCodex({
      prompt: "hello again",
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
    assert.match(attempts[0] ?? "", /--dangerously-bypass-approvals-and-sandbox/)
    assert.doesNotMatch(attempts[1] ?? "", /--dangerously-bypass-approvals-and-sandbox/)
    assert.match(attempts[1] ?? "", /--sandbox workspace-write/)
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousBypass === undefined) delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
    else process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS = previousBypass
    rmSync(dir, { recursive: true, force: true })
    resetCodexSandboxPolicyForTests()
  }
})

test("recognized sandbox failure disables later sandbox use until revalidation", async () => {
  resetCodexSandboxPolicyForTests()
  const dir = mkdtempSync(join(tmpdir(), "be2-codex-provider-"))
  const binDir = join(dir, "bin")
  const attemptsPath = join(dir, "attempts.log")
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  const previousPath = process.env.PATH
  const previousBypass = process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS

  try {
    setCodexSandboxCapabilityStore({
      load: () => repos.getCodexSandboxCapabilitySnapshot()?.capability ?? null,
      persist: capability => {
        repos.setCodexSandboxCapabilitySnapshot(capability)
      },
    })
    markCodexSandboxCapabilitySupported()
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
printf '%s\n' '{"type":"thread.started","thread_id":"thread-runtime-fallback"}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'
`,
    )
    process.env.PATH = `${binDir}:${previousPath ?? ""}`

    await invokeCodex({
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

    resetCodexSandboxPolicyForTests()
    setCodexSandboxCapabilityStore({
      load: () => repos.getCodexSandboxCapabilitySnapshot()?.capability ?? null,
      persist: capability => {
        repos.setCodexSandboxCapabilitySnapshot(capability)
      },
    })
    await invokeCodex({
      prompt: "hello again",
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
    assert.equal(attempts.length, 3)
    assert.match(attempts[0] ?? "", /--sandbox workspace-write/)
    assert.match(attempts[1] ?? "", /--dangerously-bypass-approvals-and-sandbox/)
    assert.match(attempts[2] ?? "", /--dangerously-bypass-approvals-and-sandbox/)
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousBypass === undefined) delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
    else process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS = previousBypass
    db.close()
    rmSync(dir, { recursive: true, force: true })
    resetCodexSandboxPolicyForTests()
  }
})

test("invokeCodex launch wiring consults persisted capability state before choosing sandbox mode", async () => {
  resetCodexSandboxPolicyForTests()
  const dir = mkdtempSync(join(tmpdir(), "be2-codex-provider-"))
  const binDir = join(dir, "bin")
  const attemptsPath = join(dir, "attempts.log")
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  const previousPath = process.env.PATH
  const previousBypass = process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS

  try {
    makeStubBin(
      binDir,
      "codex",
      `
printf '%s\n' "$*" >> "${attemptsPath}"
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
printf '%s\n' '{"type":"thread.started","thread_id":"thread-persisted-state"}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'
`,
    )
    process.env.PATH = `${binDir}:${previousPath ?? ""}`
    delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS

    repos.setCodexSandboxCapabilitySnapshot("supported")
    setCodexSandboxCapabilityStore({
      load: () => repos.getCodexSandboxCapabilitySnapshot()?.capability ?? null,
      persist: capability => {
        repos.setCodexSandboxCapabilitySnapshot(capability)
      },
    })
    await invokeCodex({
      prompt: "hello supported",
      runtime: {
        harness: "codex",
        runtime: "cli",
        provider: "openai",
        workspaceRoot: dir,
        policy: { mode: "safe-workspace-write" },
      } as HostedProviderInvokeInput["runtime"],
      session: null,
    })

    resetCodexSandboxPolicyForTests()
    repos.setCodexSandboxCapabilitySnapshot("unsupported")
    setCodexSandboxCapabilityStore({
      load: () => repos.getCodexSandboxCapabilitySnapshot()?.capability ?? null,
      persist: capability => {
        repos.setCodexSandboxCapabilitySnapshot(capability)
      },
    })
    await invokeCodex({
      prompt: "hello unsupported",
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
    assert.match(attempts[1] ?? "", /--dangerously-bypass-approvals-and-sandbox/)
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousBypass === undefined) delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
    else process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS = previousBypass
    db.close()
    rmSync(dir, { recursive: true, force: true })
    resetCodexSandboxPolicyForTests()
  }
})

test("invokeCodex retries once with bypass after a CAP_NET_ADMIN sandbox-capability failure", async () => {
  resetCodexSandboxPolicyForTests()
  markCodexSandboxCapabilitySupported()
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
  printf '%s\n' 'bwrap: missing capability CAP_NET_ADMIN for loopback setup' >&2
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
printf '%s\n' '{"type":"thread.started","thread_id":"thread-cap-net-admin"}'
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

test("invokeCodex does not retry or downgrade generic non-networking launch failures", async () => {
  resetCodexSandboxPolicyForTests()
  markCodexSandboxCapabilitySupported()
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
printf '%s\n' 'generic launch failure' >&2
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
printf '%s\n' '{"type":"thread.started","thread_id":"thread-generic"}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'
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

    await invokeCodex({
      prompt: "hello again",
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
    assert.match(attempts[1] ?? "", /--sandbox workspace-write/)
    assert.doesNotMatch(attempts[0] ?? "", /--dangerously-bypass-approvals-and-sandbox/)
    assert.doesNotMatch(attempts[1] ?? "", /--dangerously-bypass-approvals-and-sandbox/)
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousBypass === undefined) delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
    else process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS = previousBypass
    rmSync(dir, { recursive: true, force: true })
    resetCodexSandboxPolicyForTests()
  }
})

test("invokeCodex surfaces the retry failure when bypass recovery also fails", async () => {
  resetCodexSandboxPolicyForTests()
  markCodexSandboxCapabilitySupported()
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
printf '%s\n' 'retry command failed' >&2
exit 42
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
      error =>
        error instanceof Error
        && /exited with code 42/i.test(error.message)
        && /retry command failed/i.test(error.message)
        && !/sandbox retry failed/i.test(error.message),
    )

    const attempts = readFileSync(attemptsPath, "utf8").trim().split(/\r?\n/)
    assert.equal(attempts.length, 2)
    assert.match(attempts[0] ?? "", /--sandbox workspace-write/)
    assert.match(attempts[1] ?? "", /--dangerously-bypass-approvals-and-sandbox/)
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousBypass === undefined) delete process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS
    else process.env.BEERENGINEER_CODEX_SANDBOX_BYPASS = previousBypass
    rmSync(dir, { recursive: true, force: true })
    resetCodexSandboxPolicyForTests()
  }
})
