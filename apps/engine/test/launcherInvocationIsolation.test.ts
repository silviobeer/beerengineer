import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"

const testDir = dirname(fileURLToPath(import.meta.url))
const engineRoot = resolve(testDir, "..")
const repoRoot = resolve(engineRoot, "..", "..")
const probeFile = "test/launcherProbe.test.ts"
const command = ["test", "--workspace=@beerengineer/engine"]
const inheritedOverrideRoot = mkdtempSync(resolve(tmpdir(), "be2-launcher-shared-overrides-"))
const inheritedSharedEnv = {
  BEERENGINEER_API_TOKEN_FILE: resolve(inheritedOverrideRoot, "shared", "api.token"),
  BEERENGINEER_DATA_DIR: resolve(inheritedOverrideRoot, "shared", "data"),
  BEERENGINEER_ENGINE_PID_FILE: resolve(inheritedOverrideRoot, "shared", "engine.pid"),
  BEERENGINEER_ENGINE_PORT: "4100",
  PORT: "4100",
  XDG_STATE_HOME: resolve(inheritedOverrideRoot, "shared", "state"),
}

test("documented engine test command stays isolated across parallel, rerun, and interrupted invocations", async () => {
  const baseline = await runLauncherCommand("baseline", {}, { extraEnv: inheritedSharedEnv })
  assert.equal(baseline.code, 0, describeResult(baseline))
  assert.equal(baseline.probe.ready.length, 1, describeResult(baseline))
  assertInheritedOverridesCleared(baseline)

  const parallel = await Promise.all([
    runLauncherCommand("parallel-a", {}, { extraEnv: inheritedSharedEnv }),
    runLauncherCommand("parallel-b", {}, { extraEnv: inheritedSharedEnv }),
    runLauncherCommand("parallel-c", {}, { extraEnv: inheritedSharedEnv }),
  ])
  for (const result of parallel) {
    assert.equal(result.code, baseline.code, describeResult(result))
    assert.equal(result.probe.ready.length, 1, describeResult(result))
    assert.equal(result.probe.complete.length, 1, describeResult(result))
    assertInheritedOverridesCleared(result)
  }
  assertUniqueInvocationState(parallel)

  const rerun = await runLauncherCommand("rerun", {}, { extraEnv: inheritedSharedEnv })
  assert.equal(rerun.code, baseline.code, describeResult(rerun))
  assert.equal(rerun.probe.ready.length, 1, describeResult(rerun))
  assertInheritedOverridesCleared(rerun)

  const interruptedA = runLauncherCommand("interrupt-a", { holdMs: 10_000 }, { waitForReady: true, extraEnv: inheritedSharedEnv })
  const interruptedB = runLauncherCommand("interrupt-b", { holdMs: 10_000 }, { waitForReady: true, extraEnv: inheritedSharedEnv })
  await Promise.all([interruptedA.ready, interruptedB.ready])
  interruptedA.proc.kill("SIGINT")
  const [killed, survivor] = await Promise.all([interruptedA.result, interruptedB.result])
  assert.notEqual(killed.code, baseline.code, describeResult(killed))
  assert.equal(survivor.code, baseline.code, describeResult(survivor))
  assertInheritedOverridesCleared(survivor)

  const afterInterrupt = await runLauncherCommand("after-interrupt", {}, { extraEnv: inheritedSharedEnv })
  assert.equal(afterInterrupt.code, baseline.code, describeResult(afterInterrupt))
  assertInheritedOverridesCleared(afterInterrupt)

  const terminatedA = runLauncherCommand("terminate-a", { holdMs: 10_000 }, { waitForReady: true, extraEnv: inheritedSharedEnv })
  const terminatedB = runLauncherCommand("terminate-b", { holdMs: 10_000 }, { waitForReady: true, extraEnv: inheritedSharedEnv })
  await Promise.all([terminatedA.ready, terminatedB.ready])
  terminatedA.proc.kill("SIGKILL")
  const [terminated, survivedCrash] = await Promise.all([terminatedA.result, terminatedB.result])
  assert.notEqual(terminated.code, baseline.code, describeResult(terminated))
  assert.equal(survivedCrash.code, baseline.code, describeResult(survivedCrash))
  assertInheritedOverridesCleared(survivedCrash)

  const afterTerminate = await runLauncherCommand("after-terminate", {}, { extraEnv: inheritedSharedEnv })
  assert.equal(afterTerminate.code, baseline.code, describeResult(afterTerminate))
  assertInheritedOverridesCleared(afterTerminate)
}, 60_000)

type ProbeEvent = {
  event: "ready" | "complete"
  label: string
  configPath: string
  dataDir: string
  enginePort: number
  xdgStateHome: string | null
  tokenPath: string
  pidPath: string
  inheritedDataDir: string | null
  inheritedEnginePort: string | null
  inheritedApiTokenFile: string | null
  inheritedPidFile: string | null
  inheritedPort: string | null
}

type CommandResult = {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  probe: {
    ready: ProbeEvent[]
    complete: ProbeEvent[]
  }
}

function assertUniqueInvocationState(results: CommandResult[]): void {
  const ready = results.flatMap(result => result.probe.ready)
  assert.equal(ready.length, results.length)
  assert.equal(new Set(ready.map(event => event.configPath)).size, results.length)
  assert.equal(new Set(ready.map(event => event.dataDir)).size, results.length)
  assert.equal(new Set(ready.map(event => event.enginePort)).size, results.length)
  assert.equal(new Set(ready.map(event => event.tokenPath)).size, results.length)
  assert.equal(new Set(ready.map(event => event.pidPath)).size, results.length)
}

function describeResult(result: CommandResult): string {
  return [
    `exit=${result.code} signal=${result.signal}`,
    result.stdout,
    result.stderr,
  ].join("\n")
}

function assertInheritedOverridesCleared(result: CommandResult): void {
  for (const event of result.probe.ready) {
    assert.equal(event.inheritedDataDir, null, describeResult(result))
    assert.equal(event.inheritedEnginePort, null, describeResult(result))
    assert.equal(event.inheritedApiTokenFile, null, describeResult(result))
    assert.equal(event.inheritedPidFile, null, describeResult(result))
    assert.equal(event.inheritedPort, null, describeResult(result))
  }
}

function runLauncherCommand(
  label: string,
  opts: { holdMs?: number } = {},
  control: { waitForReady?: boolean; extraEnv?: NodeJS.ProcessEnv } = {},
):
  | Promise<CommandResult>
  | { proc: ChildProcess; ready: Promise<void>; result: Promise<CommandResult> } {
  const child = spawn("npm", command, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...control.extraEnv,
      BEERENGINEER_TEST_SELECTION: probeFile,
      BEERENGINEER_TEST_LAUNCHER_PROBE: "1",
      BEERENGINEER_TEST_LAUNCHER_LABEL: label,
      ...(opts.holdMs ? { BEERENGINEER_TEST_LAUNCHER_HOLD_MS: String(opts.holdMs) } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout?.setEncoding("utf8")
  child.stderr?.setEncoding("utf8")

  let stdout = ""
  let stderr = ""
  const probe = { ready: [] as ProbeEvent[], complete: [] as ProbeEvent[] }
  let readySeen = false
  let readyResolve = () => {}
  let readyReject = (_error: Error) => {}
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })

  const onChunk = (chunk: string) => {
    const lines = chunk.split(/\r?\n/)
    for (const line of lines) {
      const marker = "LAUNCHER_PROBE:"
      const index = line.indexOf(marker)
      if (index === -1) continue
      const payload = line.slice(index + marker.length).trim()
      if (!payload) continue
      const event = JSON.parse(payload) as ProbeEvent
      if (event.event === "ready") {
        probe.ready.push(event)
        if (!readySeen) {
          readySeen = true
          readyResolve()
        }
      } else if (event.event === "complete") {
        probe.complete.push(event)
      }
    }
  }

  child.stdout?.on("data", chunk => {
    const text = String(chunk)
    stdout += text
    onChunk(text)
  })
  child.stderr?.on("data", chunk => {
    const text = String(chunk)
    stderr += text
    onChunk(text)
  })

  const result = new Promise<CommandResult>((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (!readySeen) readyReject(new Error(`probe never became ready for ${label}\n${stdout}\n${stderr}`))
      resolve({ code, signal, stdout, stderr, probe })
    })
  })

  if (!control.waitForReady) return result
  const readyWithTimeout = Promise.race([
    ready,
    delay(20_000).then(() => {
      throw new Error(`probe ready timeout for ${label}\n${stdout}\n${stderr}`)
    }),
  ])
  return { proc: child, ready: readyWithTimeout, result }
}
